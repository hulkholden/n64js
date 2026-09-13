#!/usr/bin/env bun
// Reproduce #110 with local ROMs; outputs observations, never ROM bytes.
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { compatibilityHacks } from './compatibility_hacks.js';
import { createHeadlessEmulator, loadROMFile } from './headless_env.js';

const [path, ...args] = Bun.argv.slice(2);
const allowed = new Set(['--input', '--no-compat', '--execute-graphics']);
const secondsArg = args.find(arg => arg.startsWith('--seconds='));
const seconds = secondsArg ? Number(secondsArg.slice('--seconds='.length)) : 30;
if (!path || !Number.isFinite(seconds) || seconds <= 0 || args.some(arg => arg !== secondsArg && !allowed.has(arg))) {
  throw Error('Usage: bun src/headless_nhl.js ROM [--seconds=30] [--input] [--no-compat] [--execute-graphics]');
}
const rom = await loadROMFile(path);
const delay = compatibilityHacks[rom.rominfo.id]?.instructionDelays?.[0];
if (!delay) throw Error('This reproducer supports the four NHL Breakaway images configured for #110');
const enabled = !args.includes('--no-compat');
const input = args.includes('--input');
const executeGraphics = args.includes('--execute-graphics');
let graphics = 0, audio = 0, firstGraphics = null, reached = false, seed = 1;
const faults = [], startupCounts = [];
const emulator = await createHeadlessEmulator(rom, {
  enableCompatibilityHacks: enabled,
  executeGraphics,
  onGraphicsTask: () => { graphics++; firstGraphics ??= elapsed() / hardware.systemFrequency; },
});
const { cpu0: cpu, hardware } = emulator;
const budget = Math.round(seconds * hardware.systemFrequency);
const deadline = 'NHL startup audit';
if (!Number.isSafeInteger(budget)) throw Error('Duration exceeds the safe cycle range');
const elapsed = () => reached ? budget : budget - cpu.getCyclesUntilEvent(deadline);
const hex = value => `0x${(value >>> 0).toString(16).padStart(8, '0')}`;
cpu.setRandomSource(() => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
});

const readControl = cpu.moveFromControl;
cpu.moveFromControl = function (reg) {
  const value = readControl.call(this, reg);
  if (reg === 9 && startupCounts.length < 2) {
    // osGetTime saves its caller at sp+0x1c. Record only the first pair of
    // samples in the frame-rate loop, independent of other startup time reads.
    const sp = cpu.getRegU32Lo(29);
    if (sp >= 0x80000000 && sp < 0x807fffe0) {
      const caller = hardware.memMap.readMemoryInternal32(sp + 0x1c);
      const expected = startupCounts.length === 0 ? delay.address - 0x18 : delay.address + 8;
      if (caller === expected) startupCounts.push(Number(value));
    }
  }
  return value;
};
const raiseException = cpu.raiseException;
cpu.raiseException = function (mask, value, vector) {
  const code = (value & 0x7c) >>> 2;
  // Interrupts and lazy COP1 activation are normal guest execution.
  if (code !== 0 && code !== 11 && faults.length < 8) {
    faults.push({ seconds: elapsed() / hardware.systemFrequency, pc: hex(cpu.pc), code, a0: hex(cpu.getRegU32Lo(4)) });
  }
  return raiseException.call(this, mask, value, vector);
};
const pushDMA = hardware.aiRegDevice.pushDMA;
hardware.aiRegDevice.pushDMA = function (...values) { audio++; return pushDMA.apply(this, values); };
hardware.onVerticalBlank = () => {
  const t = elapsed() / hardware.systemFrequency;
  let buttons = 0;
  if (input) {
    if ([3, 6, 9].some(start => t >= start && t < start + 0.25)) buttons = 0x1000;
    if ([12, 15, 18, 21, 24, 27].some(start => t >= start && t < start + 0.25)) buttons = 0x8000;
  }
  emulator.inputs[0].buttons = buttons;
};
cpu.addEvent(deadline, budget, () => { reached = true; cpu.breakExecution(); });
while (!reached && !emulator.fatalError()) {
  const before = elapsed();
  cpu.run(Math.min(10_000_000, budget - before));
  if (elapsed() <= before && !emulator.fatalError()) throw Error('No CPU cycle progress');
  await Bun.sleep(0);
}
console.log(JSON.stringify({
  rom: basename(path), id: rom.rominfo.id,
  sha256: createHash('sha256').update(new Uint8Array(rom.romBuffer)).digest('hex'),
  enabled, input, executeGraphics, seed: 1,
  seconds: elapsed() / hardware.systemFrequency,
  startupCounts, startupTicks: startupCounts.length === 2 ? (startupCounts[1] - startupCounts[0]) >>> 0 : null,
  firstGraphics, graphics, audio, vi: hardware.verticalBlankCount, faults,
  pc: hex(cpu.pc), cause: hex(cpu.getControlU32(13)), epc: hex(cpu.getControlU32(14)),
  spStatus: hex(hardware.sp_reg.getU32(0x10)), error: emulator.fatalError(),
}, null, 2));
process.exitCode = emulator.fatalError() ? 1 : 0;
