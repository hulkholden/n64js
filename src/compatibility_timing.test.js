import { describe, expect, spyOn, test } from 'bun:test';
import { Breakpoints } from './debug/breakpoints.js';
import { compatibilityHacks } from './compatibility_hacks.js';
import { controlCause, controlEPC, controlStatus } from './cpu/cpu0reg.js';
import { createHeadlessEmulator } from './headless/headless_env.js';

const { getFragmentMap } = await import('./cpu/fragments.js');
const { invalidateCode } = await import('./cpu/r4300.js');
const romId = 'c3cdfd6dc801e74d';
const address = 0x8000c924;
const original = 0x0c00f530; // JAL osGetTime
const target = 0x8003d4c0;

async function fixture(id = romId, options = {}) {
  const e = await createHeadlessEmulator({
    romBuffer: new ArrayBuffer(0x1000),
    rominfo: { id, cic: '6102', tvType: 1, save: 'Eeprom4k' },
  }, options);
  e.cpu0.setControlU32(controlStatus, 0);
  e.cpu0.cop1ControlChanged();
  e.cpu0.pc = address;
  e.hardware.ram.set32(address - 0x80000000, original);
  e.hardware.ram.set32(address - 0x80000000 + 4, 0x25080001); // ADDIU t0, t0, 1 (delay slot)
  e.cpu0.setRegU64(8, 0n);
  return e;
}

describe('compatibility startup timing', () => {
  test('delays the first call, keeping guest code, COUNT, events and branch state consistent', async () => {
    const { cpu0: cpu, hardware } = await fixture();
    const count = cpu.controlCountValue;
    let observed;
    cpu.addEvent('Observe delayed instruction', 60, () => {
      observed = { pc: cpu.pc, delay: cpu.delayPC, ra: cpu.getRegU32Lo(31) };
    });
    cpu.setCompare(Math.floor(count / 2) + 30);
    cpu.run(65);
    expect(observed).toEqual({ pc: address + 4, delay: target, ra: address + 8 });
    expect(cpu.controlCountValue - count).toBe(65);
    expect(cpu.getControlU32(controlCause) & 0x8000).toBe(0x8000);
    expect(cpu.instructionDelays).toBeNull();
    expect(hardware.ram.getU32(address - 0x80000000)).toBe(original);
    cpu.run(1);
    expect(cpu.pc).toBe(target);
    expect(cpu.getRegU32Lo(8)).toBe(1);

    cpu.pc = address;
    cpu.run(2);
    expect(cpu.pc).toBe(target);
    expect(cpu.getRegU32Lo(8)).toBe(2);
    expect(cpu.controlCountValue - count).toBe(68);
  });

  test('an interrupt during the delay records the pending branch delay slot correctly', async () => {
    const { cpu0: cpu } = await fixture();
    cpu.setControlU32(controlStatus, 0x8001);
    cpu.setCompare(10);
    cpu.run(65);
    expect(cpu.pc).toBe(0x80000180);
    expect(cpu.delayPC).toBeNull();
    expect(cpu.getControlU32(controlCause) >>> 31).toBe(1);
    expect(cpu.getControlU32(controlEPC)).toBe(address);
  });

  test('unknown and globally disabled ROMs retain the original timing', async () => {
    for (const [id, options] of [['unknown', {}], [romId, { enableCompatibilityHacks: false }]]) {
      const { cpu0: cpu } = await fixture(id, options);
      cpu.run(2);
      expect(cpu.pc).toBe(target);
      expect(cpu.controlCountValue).toBe(2);
      expect(cpu.instructionDelays).toBeNull();
    }
    const config = compatibilityHacks[romId];
    try {
      config.enabled = false;
      const { cpu0: cpu } = await fixture();
      cpu.run(2);
      expect(cpu.controlCountValue).toBe(2);
    } finally {
      config.enabled = true;
    }
  });

  test('a mismatched instruction is left untouched and warned about once', async () => {
    const { cpu0: cpu, hardware } = await fixture();
    hardware.ram.set32(address - 0x80000000, 0);
    const warning = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      cpu.run(1);
      expect(cpu.pc).toBe(address + 4);
      expect(cpu.controlCountValue).toBe(1);
      expect(cpu.instructionDelays).toBeNull();
      expect(hardware.ram.getU32(address - 0x80000000)).toBe(0);
      expect(warning).toHaveBeenCalledTimes(1);
      expect(warning.mock.calls[0][0]).toContain('expected 0x0c00f530, found 0x00000000');
      cpu.pc = address;
      cpu.run(1);
      expect(warning).toHaveBeenCalledTimes(1);
    } finally { warning.mockRestore(); }
  });

  test('breakpoints defer the delay until the original instruction is single-stepped', async () => {
    const { cpu0: cpu, hardware } = await fixture();
    const breakpoints = new Breakpoints(hardware, invalidateCode);
    const previous = n64js.breakpoints;
    n64js.breakpoints = () => breakpoints;
    try {
      breakpoints.toggle(address);
      cpu.run(1);
      expect(cpu.pc).toBe(address);
      expect(cpu.controlCountValue).toBe(0);
      expect(cpu.instructionDelays.has(address)).toBe(true);
      n64js.singleStep();
      expect(cpu.pc).toBe(address + 4);
      expect(cpu.controlCountValue).toBe(65);
      expect(cpu.instructionDelays).toBeNull();
      expect(breakpoints.getInstruction(address)).toBe(original);
      expect(breakpoints.isBreakpoint(address)).toBe(true);
    } finally { n64js.breakpoints = previous; }
  });

  test('reset rearms the delay, and changing ROMs drops the previous selection', async () => {
    const { cpu0: cpu, hardware } = await fixture();
    cpu.run(65);
    hardware.reset();
    hardware.ram.set32(address - 0x80000000, original);
    cpu.pc = address;
    const count = cpu.controlCountValue;
    cpu.run(65);
    expect(cpu.controlCountValue - count).toBe(65);
    expect(cpu.pc).toBe(address + 4);
    hardware.rominfo.id = 'unknown';
    hardware.reset();
    expect(cpu.instructionDelays).toBeNull();
  });

  test('compiled loops do not repeat the startup delay', async () => {
    const { cpu0: cpu, hardware } = await fixture();
    // The callee loops back to the call site, so hot traces include the JAL.
    hardware.ram.set32(target - 0x80000000, 0x08000000 | ((address >>> 2) & 0x3ffffff));
    cpu.run(16064);
    expect(cpu.controlCountValue).toBe(16064);
    expect(cpu.getRegU32Lo(8)).toBe(4000);
    expect(cpu.pc).toBe(address);
    expect(getFragmentMap().get(address)?.executionCount).toBeGreaterThan(0);
  });
});
