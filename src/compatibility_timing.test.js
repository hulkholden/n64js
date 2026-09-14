import { afterEach, describe, expect, spyOn, test } from 'bun:test';
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
    expect(cpu.compatibilityHacks).toBeNull();
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
      expect(cpu.compatibilityHacks).toBeNull();
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
      expect(cpu.compatibilityHacks).toBeNull();
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
      expect(cpu.compatibilityHacks.has(address)).toBe(true);
      n64js.singleStep();
      expect(cpu.pc).toBe(address + 4);
      expect(cpu.controlCountValue).toBe(65);
      expect(cpu.compatibilityHacks).toBeNull();
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
    expect(cpu.compatibilityHacks).toBeNull();
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

describe('combined compatibility hacks', () => {
  const id = 'compatibility-mixed-test';
  const delaySlot = 0x25080001; // ADDIU t0, t0, 1
  const patchedDelaySlot = 0x25080002; // ADDIU t0, t0, 2

  afterEach(() => {
    delete compatibilityHacks[id];
  });

  test('keeps remaining hacks pending when patches and delays execute in either order', async () => {
    for (const delayFirst of [true, false]) {
      compatibilityHacks[id] = {
        name: 'Mixed test ROM',
        enabled: true,
        instructionDelays: [{
          address: delayFirst ? address : address + 4,
          expected: delayFirst ? original : delaySlot,
          cycles: 64,
        }],
        instructionPatches: [{
          address: delayFirst ? address + 4 : address,
          expected: delayFirst ? delaySlot : original,
          replacement: delayFirst ? patchedDelaySlot : original + 1,
        }],
      };
      const { cpu0: cpu, hardware } = await fixture(id);
      const expectedTarget = delayFirst ? target : target + 4;
      cpu.run(delayFirst ? 65 : 1);
      expect(cpu.compatibilityHacks.size).toBe(1);
      expect(cpu.compatibilityHacks.has(address + 4)).toBe(true);
      expect(cpu.pc).toBe(address + 4);
      expect(cpu.delayPC).toBe(expectedTarget);
      expect(cpu.controlCountValue).toBe(delayFirst ? 65 : 1);

      cpu.run(delayFirst ? 1 : 65);
      expect(cpu.compatibilityHacks).toBeNull();
      expect(cpu.controlCountValue).toBe(66);
      expect(cpu.pc).toBe(expectedTarget);
      expect(cpu.getRegU32Lo(8)).toBe(delayFirst ? 2 : 1);
      expect(hardware.ram.getU32(address - 0x80000000)).toBe(delayFirst ? original : original + 1);
      expect(hardware.ram.getU32(address - 0x80000000 + 4)).toBe(delayFirst ? patchedDelaySlot : delaySlot);
    }
  });

  test('applies a patch and delay at the same address against the original instruction', async () => {
    compatibilityHacks[id] = {
      name: 'Mixed test ROM',
      enabled: true,
      instructionDelays: [{ address, expected: original, cycles: 64 }],
      instructionPatches: [{ address, expected: original, replacement: original + 1 }],
    };
    const { cpu0: cpu, hardware } = await fixture(id);
    cpu.run(65);
    expect(cpu.compatibilityHacks).toBeNull();
    expect(cpu.controlCountValue).toBe(65);
    expect(cpu.delayPC).toBe(target + 4);
    expect(hardware.ram.getU32(address - 0x80000000)).toBe(original + 1);
    cpu.run(1);
    expect(cpu.pc).toBe(target + 4);
    expect(cpu.getRegU32Lo(8)).toBe(1);
    cpu.pc = address;
    cpu.run(2);
    expect(cpu.controlCountValue).toBe(68);
    expect(cpu.pc).toBe(target + 4);
  });

  test('consumes mismatched entries without clearing other pending hacks or retrying them', async () => {
    compatibilityHacks[id] = {
      name: 'Mixed test ROM',
      enabled: true,
      instructionDelays: [{ address, expected: original + 1, cycles: 64 }],
      instructionPatches: [{ address: address + 4, expected: 0, replacement: patchedDelaySlot }],
    };
    const { cpu0: cpu, hardware } = await fixture(id);
    const warning = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      cpu.run(1);
      expect(cpu.compatibilityHacks.size).toBe(1);
      expect(cpu.compatibilityHacks.has(address + 4)).toBe(true);
      expect(warning).toHaveBeenCalledTimes(1);
      cpu.run(1);
      expect(cpu.compatibilityHacks).toBeNull();
      expect(cpu.controlCountValue).toBe(2);
      expect(cpu.pc).toBe(target);
      expect(hardware.ram.getU32(address - 0x80000000 + 4)).toBe(delaySlot);
      expect(warning).toHaveBeenCalledTimes(2);
      cpu.pc = address;
      cpu.run(2);
      expect(warning).toHaveBeenCalledTimes(2);
    } finally { warning.mockRestore(); }
  });

  test('starts with no pending map when an enabled config has no entries', async () => {
    for (const entries of [{}, { instructionDelays: [], instructionPatches: [] }]) {
      compatibilityHacks[id] = { name: 'Empty test ROM', enabled: true, ...entries };
      const { cpu0: cpu } = await fixture(id);
      expect(cpu.compatibilityHacks).toBeNull();
      cpu.run(2);
      expect(cpu.controlCountValue).toBe(2);
      expect(cpu.pc).toBe(target);
    }
  });
});
