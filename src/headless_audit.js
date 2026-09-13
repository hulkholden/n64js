#!/usr/bin/env bun

import { basename } from 'node:path';
import { createHeadlessEmulator, loadROMFile } from './headless_env.js';

const [path, duration = '30', mode = 'neutral'] = Bun.argv.slice(2);
const seconds = Number(duration);
if (!path || !Number.isFinite(seconds) || seconds <= 0 || !['neutral', 'input'].includes(mode)) {
  console.error('Usage: bun src/headless_audit.js <rom-path> [seconds=30] [neutral|input]');
  process.exit(2);
}

// Keep stdout machine readable; emulator diagnostics go to stderr.
const print = console.log.bind(console);
console.log = console.error.bind(console);
const hex = value => '0x' + (Number(value) >>> 0).toString(16).padStart(8, '0');

try {
  const rom = await loadROMFile(path);
  const sha256 = new Bun.CryptoHasher('sha256').update(rom.romBuffer).digest('hex');
  let graphics = 0, audio = 0, firstGraphics = null;
  let elapsed = () => 0;
  const emulator = await createHeadlessEmulator(rom, {
    onGraphicsTask: () => {
      graphics++;
      firstGraphics ??= elapsed();
    },
    onHalt: console.error,
    onWarning: console.error,
    onCheckFailure: console.error,
  });
  const { cpu0: cpu, hardware } = emulator;
  const budget = Math.round(seconds * hardware.systemFrequency);
  if (!Number.isSafeInteger(budget) || budget <= 0) throw new Error('Duration is outside the cycle range');
  const deadline = 'Boot audit deadline';
  let reached = false, seed = 1;
  const elapsedCycles = () => reached ? budget : budget - cpu.getCyclesUntilEvent(deadline);
  elapsed = () => elapsedCycles() / hardware.systemFrequency;
  cpu.setRandomSource(() => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  });

  const ai = hardware.aiRegDevice;
  const pushDMA = ai.pushDMA;
  ai.pushDMA = function (...args) {
    audio++;
    return pushDMA.apply(this, args);
  };

  hardware.onVerticalBlank = () => {
    const time = elapsed();
    let buttons = 0;
    if (mode === 'input') {
      if ([3, 6, 9].some(start => time >= start && time < start + 0.25)) buttons |= 0x1000;
      if ([12, 15, 18, 21, 24, 27].some(start => time >= start && time < start + 0.25)) buttons |= 0x8000;
    }
    emulator.inputs[0].buttons = buttons;
  };

  // COUNT is guest writable. Measure elapsed time using a separate CPU event.
  cpu.addEvent(deadline, budget, () => {
    reached = true;
    cpu.breakExecution();
  });
  while (!reached && !emulator.fatalError()) {
    const before = elapsedCycles();
    cpu.run(Math.min(10_000_000, budget - before));
    if (elapsedCycles() <= before && !emulator.fatalError()) throw new Error('No CPU-cycle progress');
    await Bun.sleep(0);
  }

  const events = [];
  for (let event = cpu.eventQueue.firstEvent; event; event = event.next) {
    events.push({ name: event.type, cycles: cpu.getCyclesUntilEvent(event.type) });
  }
  const vi = hardware.viRegDevice;
  print(JSON.stringify({
    name: basename(path), sha256, mode,
    seconds: elapsed(), graphics, audio, firstGraphics,
    viRetraces: hardware.verticalBlankCount,
    error: emulator.fatalError(),
    cpu: {
      pc: hex(cpu.pc),
      delayPC: cpu.delayPC === null ? null : hex(cpu.delayPC),
      status: hex(cpu.getControlU32(12)),
      cause: hex(cpu.getControlU32(13)),
      epc: hex(cpu.getControlU32(14)),
      badVAddr: hex(cpu.getControlU32(8)),
      count: hex(cpu.moveFromControl(9)),
      compare: hex(cpu.getControlU32(11)),
    },
    rsp: { pc: hex(hardware.rsp.pc), status: hex(hardware.sp_reg.getU32(0x10)) },
    interrupts: { miPending: hex(hardware.mi_reg.getU32(8)), miMask: hex(hardware.mi_reg.getU32(12)), events },
    vi: { control: hex(vi.controlReg), origin: hex(vi.dramAddrReg), width: vi.hWidthReg, sync: vi.vSyncReg, intr: vi.vIntrReg },
    piStatus: hex(hardware.pi_reg.getU32(0x10)),
    siStatus: hex(hardware.si_reg.getU32(0x18)),
  }, null, 2));
  process.exitCode = emulator.fatalError() ? 1 : 0;
} catch (error) {
  console.error(error?.stack ?? error);
  process.exitCode = 2;
} finally {
  console.log = print;
}
