#!/usr/bin/env bun

/* global n64js */

// Investigation harness for #103. The optional time override is a causal
// experiment, not an emulator fix: it changes one osGetTime return value.
import { createHash } from 'node:crypto';
import { createHeadlessEmulator, loadROMFile } from './headless_env.js';
import { controlBadVAddr, controlCause, controlEPC } from './cpu0reg.js';

const images = new Map([
  ['c5b7cf3523de025e3f18e2c8df2deb0eced5613e7c46cb8c6c5a4f22644ead3f', {
    name: 'BattleTanx (USA)',
    contInit: 0x80110fe0, createViManager: 0x80121ba0, timerInit: 0x801215a0,
    timerPointer: 0x80146110, sentinel: 0x803c7620,
  }],
  ['88268ce770ff39f2ca839848b842c87866df6c5ddaf775f180b2522c18ff6221', {
    name: 'BattleTanx - Global Assault (USA)',
    contInit: 0x801033f0, createViManager: 0x80111560, timerInit: 0x80110f20,
    timerPointer: 0x80126f00, sentinel: 0x803b0550,
  }],
  ['8c0f538d32243d7d230ff28432326fbb17ea59bec2e2d9815dc04317dbe70db0', {
    name: 'BattleTanx - Global Assault (Europe) (En,Fr,De)',
    contInit: 0x801003c0, createViManager: 0x8010e600, timerInit: 0x8010dfc0,
    timerPointer: 0x801228a0, sentinel: 0x803cbc00,
  }],
]);

function hex(value) { return '0x' + (value >>> 0).toString(16).padStart(8, '0'); }

async function main(args) {
  const [romPath, duration = '30', ...flags] = args;
  const seconds = Number(duration);
  const timeFlag = flags.find(flag => flag.startsWith('--time-ticks='));
  const timeTicks = timeFlag === undefined ? null : Number(timeFlag.split('=')[1]);
  if (!romPath || !Number.isFinite(seconds) || seconds <= 0 ||
      flags.some(flag => !['--input', '--step-startup', '--no-compatibility-hacks', timeFlag].includes(flag)) ||
      (timeTicks !== null && (!Number.isSafeInteger(timeTicks) || timeTicks < 0 || timeTicks > 0xffffffff))) {
    throw Error('Usage: bun src/headless_battletanx.js <ROM> [seconds] [--input] [--step-startup] [--no-compatibility-hacks] [--time-ticks=23437500]');
  }

  const loaded = await loadROMFile(romPath);
  const sha256 = createHash('sha256').update(new Uint8Array(loaded.romBuffer)).digest('hex');
  const config = images.get(sha256);
  if (!config) throw Error(`Unrecognized normalized ROM SHA-256: ${sha256}`);

  let graphics = 0, audio = 0, controllerCommands = 0, seed = 1;
  const emulator = await createHeadlessEmulator(loaded, {
    enableCompatibilityHacks: !flags.includes('--no-compatibility-hacks'),
    onHalt: console.error, onWarning: console.error, onCheckFailure: console.error,
    onGraphicsTask: () => graphics++,
  });
  const { cpu0: cpu, hardware } = emulator;
  const ram = hardware.ram.dataView;
  const readWord = address => DataView.prototype.getUint32.call(ram, address & 0x7fffff);
  const links = () => ({
    pointer: hex(readWord(config.timerPointer)),
    next: hex(readWord(config.sentinel)), prev: hex(readWord(config.sentinel + 4)),
  });
  cpu.setRandomSource(() => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  });

  const budget = Math.round(seconds * hardware.systemFrequency);
  if (!Number.isSafeInteger(budget) || budget <= 0) throw Error('Invalid cycle budget');
  const deadline = 'BattleTanx audit deadline';
  let reached = false;
  const elapsed = () => reached ? budget : budget - cpu.getCyclesUntilEvent(deadline);
  const stamp = () => ({ elapsedCycles: elapsed(), count: Math.floor(cpu.controlCountValue / 2) >>> 0 });
  const milestones = [];
  const bootStages = [];
  // All three hash-identified images share these IPL3 and entry-point PCs.
  const bootEntries = new Map([
    [0xa4000040, 'ipl3Entry'],
    [0xa4000060, 'rdramInit'],
    [0xa4000410, 'rdramInitSkipped'],
    [0xa4000458, 'afterRdramInit'],
    [0x80000000, 'relocatedIpl3'],
    [0x80000050, 'bootDmaStart'],
    [0x800000d8, 'bootDmaComplete'],
    [0x80071000, 'gameEntry'],
    [0x80071030, 'bssCleared'],
  ]);
  function observeBootStage() {
    const name = bootEntries.get(cpu.pc);
    if (name) {
      bootStages.push({ name, pc: hex(cpu.pc), ...stamp() });
      bootEntries.delete(cpu.pc);
    }
  }
  const sp = hardware.sp_mem.dataView;
  const spGetUint32 = sp.getUint32;
  sp.getUint32 = function (offset, littleEndian) {
    if (cpu.pc === offset + 0xa4000000) observeBootStage();
    return spGetUint32.call(this, offset, littleEndian);
  };
  const linkWrites = [];
  let controllerTime = null, firstFault = null;
  const entries = new Map([
    [config.contInit, 'osContInit'],
    [config.createViManager, 'osCreateViManager'],
    [config.timerInit, '__osTimerServicesInit'],
  ]);
  const getUint32 = ram.getUint32;
  ram.getUint32 = function (offset, littleEndian) {
    const value = getUint32.call(this, offset, littleEndian);
    // These startup entries are cold code; in stepped mode every instruction
    // is fetched here. Check PC as well to exclude ordinary data reads.
    if (cpu.pc === offset + 0x80000000) {
      observeBootStage();
      const name = entries.get(cpu.pc);
      if (name) {
        milestones.push({ name, pc: hex(cpu.pc), ...stamp(), ...links() });
        entries.delete(cpu.pc);
      }
      if (!controllerTime && cpu.pc === config.contInit + 0x3c) {
        controllerTime = { pc: hex(cpu.pc), ...stamp(), ticks: cpu.getRegU32Lo(3), ...links() };
        if (cpu.getRegU32Lo(2) !== 0) throw Error('Unexpected high word of startup osGetTime');
        if (timeTicks !== null) {
          // Only replace the result of osContInit's first osGetTime call.
          // Do not initialize the timer list, rewrite COUNT, or alter events.
          cpu.setRegS32Extend(3, timeTicks);
        }
      }
    }
    return value;
  };
  const setUint32 = ram.setUint32;
  ram.setUint32 = function (offset, value, littleEndian) {
    if (offset >= (config.sentinel & 0x7fffff) && offset < (config.sentinel & 0x7fffff) + 8 && linkWrites.length < 16) {
      linkWrites.push({ address: hex(offset + 0x80000000), value: hex(value), ...stamp() });
    }
    return setUint32.call(this, offset, value, littleEndian);
  };
  const raiseTLBException = cpu.raiseTLBException;
  cpu.raiseTLBException = function (vector, code, address) {
    firstFault ??= { pc: hex(this.pc), address: hex(address), code, ...stamp(), ...links() };
    return raiseTLBException.call(this, vector, code, address);
  };
  const pushDMA = hardware.aiRegDevice.pushDMA;
  hardware.aiRegDevice.pushDMA = function (...dmaArgs) { audio++; return pushDMA.apply(this, dmaArgs); };
  for (const channel of n64js.joybus().channels.slice(0, 4)) {
    const command = channel.joybusCommand;
    channel.joybusCommand = function (...commandArgs) { controllerCommands++; return command.apply(this, commandArgs); };
  }
  hardware.onVerticalBlank = () => {
    const t = elapsed() / hardware.systemFrequency;
    let buttons = 0;
    if (flags.includes('--input')) {
      if ([3, 6, 9].some(s => t >= s && t < s + 0.25)) buttons |= 0x1000;
      if ([12, 15, 18, 21, 24, 27].some(s => t >= s && t < s + 0.25)) buttons |= 0x8000;
    }
    emulator.inputs[0].buttons = buttons;
  };

  cpu.addEvent(deadline, budget, () => { reached = true; cpu.breakExecution(); });
  let startupTracing = true;
  const wallDeadline = Date.now() + 120_000;
  while (!reached && !emulator.fatalError()) {
    const before = elapsed();
    if (startupTracing && (firstFault || (controllerTime && entries.size === 0))) {
      // Drop instruction tracing once startup is characterized. Link stores
      // remain observed so the guest's later initialization is recorded.
      ram.getUint32 = getUint32;
      sp.getUint32 = spGetUint32;
      startupTracing = false;
    }
    cpu.run(flags.includes('--step-startup') && startupTracing ? 1 : Math.min(10_000_000, budget - before));
    if (elapsed() <= before && !emulator.fatalError()) throw Error('No CPU-cycle progress');
    if (Date.now() > wallDeadline) throw Error('120-second wall-time limit exceeded');
    if (!startupTracing || !flags.includes('--step-startup')) await Bun.sleep(0);
  }
  if (!controllerTime) throw Error('Did not reach the controller timing observation; increase the duration');
  return {
    name: config.name, sha256, seconds: elapsed() / hardware.systemFrequency,
    input: flags.includes('--input'), steppedStartup: flags.includes('--step-startup'),
    compatibilityHacks: hardware.enableCompatibilityHacks,
    diagnosticTimeTicks: timeTicks, controllerTime, bootStages, milestones, linkWrites, firstFault,
    graphics, audio, controllerCommands, viRetraces: hardware.verticalBlankCount,
    pc: hex(cpu.pc), epc: hex(cpu.getControlU32(controlEPC)),
    badVAddr: hex(cpu.getControlU32(controlBadVAddr)), cause: hex(cpu.getControlU32(controlCause)),
    error: emulator.fatalError(),
  };
}

// Keep emulator logging on stderr so stdout is a reusable JSON evidence file.
const print = console.log.bind(console);
console.log = (...args) => console.error(...args);
try {
  const result = await main(Bun.argv.slice(2));
  print(JSON.stringify(result, null, 2));
  process.exitCode = result.error ? 1 : 0;
} catch (error) {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
} finally {
  console.log = print;
}
