import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { Breakpoints } from './debug/breakpoints.js';
import { compatibilityHacks } from './compatibility_hacks.js';
import { controlStatus } from './cpu/cpu0reg.js';
import { createHeadlessEmulator } from './headless_env.js';

const { getFragmentMap } = await import('./cpu/fragments.js');
const { invalidateCode } = await import('./cpu/r4300.js');

// Exercise the patch mechanism independently of the production ROM database.
const id = 'compatibility-test';
const address = 0x80001000;
const original = 0x14200031; // BNE at, zero, +0x31
const replacement = 0x10000031; // B +0x31

async function fixture(id, options = {}) {
  const emulator = await createHeadlessEmulator({
    romBuffer: new ArrayBuffer(0x1000),
    rominfo: { id, name: 'Renamed ROM', cic: '6102', tvType: 1, save: 'Eeprom4k' },
  }, options);
  emulator.cpu0.setControlU32(controlStatus, 0);
  emulator.cpu0.cop1ControlChanged();
  emulator.cpu0.setRegU64(1, 0n); // Original BNE would not take the branch.
  emulator.cpu0.setRegU64(8, 0n);
  return emulator;
}

function putBranch(hardware, address, instruction = original) {
  hardware.ram.set32(address - 0x80000000, instruction);
  hardware.ram.set32(address - 0x80000000 + 4, 0x25080001); // ADDIU t0, t0, 1 (delay slot)
}

describe('ROM compatibility instruction patches', () => {
  beforeEach(() => {
    compatibilityHacks[id] = {
      name: 'Test ROM',
      enabled: true,
      instructionPatches: [{ address, expected: original, replacement }],
    };
  });

  afterEach(() => {
    delete compatibilityHacks[id];
  });

  test('patches on execution, preserving delay-slot and cycle behavior', async () => {
    const { cpu0: cpu, hardware } = await fixture(id);
    putBranch(hardware, address);
    // Loading, data reads and executing unrelated code must not patch code
    // prematurely: IPL3 needs to checksum the original loaded bytes first.
    expect(hardware.memMap.readMemoryInternal32(address)).toBe(original);
    cpu.pc = 0x80002000;
    cpu.run(1);
    expect(hardware.ram.getU32(address - 0x80000000)).toBe(original);

    cpu.pc = address;
    const count = cpu.controlCountValue;
    cpu.addEvent('Compatibility test deadline', 3, () => {});
    cpu.run(2);
    expect(cpu.pc).toBe(address + 0xc8);
    expect(cpu.getRegU64(8)).toBe(1n);
    expect(cpu.controlCountValue - count).toBe(2);
    expect(cpu.getCyclesUntilEvent('Compatibility test deadline')).toBe(1);
    expect(hardware.ram.getU32(address - 0x80000000)).toBe(replacement);

    // It is a one-time startup patch, not a persistent memory-write override.
    putBranch(hardware, address);
    cpu.pc = address;
    cpu.run(2);
    expect(cpu.pc).toBe(address + 8);
    expect(hardware.ram.getU32(address - 0x80000000)).toBe(original);
  });

  test('leaves unknown IDs and explicitly disabled runs unchanged across resets', async () => {
    for (const [romId, options, enabled] of [
      ['unknown', {}, true], [undefined, {}, true],
      [id, { enableCompatibilityHacks: false }, true], [id, {}, false],
    ]) {
      compatibilityHacks[id].enabled = enabled;
      const { cpu0: cpu, hardware } = await fixture(romId, options);
      for (let boot = 0; boot < 2; boot++) {
        putBranch(hardware, address);
        cpu.pc = address;
        cpu.run(2);
        expect(cpu.pc).toBe(address + 8);
        expect(hardware.ram.getU32(address - 0x80000000)).toBe(original);
        hardware.reset();
      }
    }
  });

  test('a changed instruction is left intact and warned about only once', async () => {
    const { cpu0: cpu, hardware } = await fixture(id);
    const warning = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      putBranch(hardware, address, 0x14200030);
      cpu.pc = address;
      cpu.run(2);
      expect(cpu.pc).toBe(address + 8);
      expect(hardware.ram.getU32(address - 0x80000000)).toBe(0x14200030);
      expect(warning).toHaveBeenCalledTimes(1);
      putBranch(hardware, address);
      cpu.pc = address;
      cpu.run(2);
      expect(hardware.ram.getU32(address - 0x80000000)).toBe(original);
      expect(warning).toHaveBeenCalledTimes(1);
    } finally {
      warning.mockRestore();
    }
  });

  test('reset rearms patches and changing the loaded ROM discards the old selection', async () => {
    const { cpu0: cpu, hardware } = await fixture(id);
    for (let boot = 0; boot < 2; boot++) {
      hardware.reset();
      putBranch(hardware, address);
      cpu.pc = address;
      cpu.run(2);
      expect(cpu.pc).toBe(address + 0xc8);
      expect(hardware.ram.getU32(address - 0x80000000)).toBe(replacement);
    }
    hardware.rominfo.id = 'unknown';
    hardware.reset();
    putBranch(hardware, address);
    cpu.pc = address;
    cpu.run(2);
    expect(cpu.pc).toBe(address + 8);
    expect(hardware.ram.getU32(address - 0x80000000)).toBe(original);
  });

  test('a debugger breakpoint still stops and single-step patches the restored instruction', async () => {
    const { cpu0: cpu, hardware } = await fixture(id);
    putBranch(hardware, address);
    const breakpoints = new Breakpoints(hardware, invalidateCode);
    const previous = n64js.breakpoints;
    n64js.breakpoints = () => breakpoints;
    try {
      breakpoints.toggle(address);
      cpu.pc = address;
      cpu.run(2);
      expect(cpu.pc).toBe(address);
      expect(breakpoints.getInstruction(address)).toBe(original);
      n64js.singleStep();
      expect(breakpoints.isBreakpoint(address)).toBe(true);
      expect(breakpoints.getInstruction(address)).toBe(replacement);
      cpu.run(1); // Execute the branch delay slot.
      expect(cpu.pc).toBe(address + 0xc8);
      breakpoints.toggle(address);
      expect(hardware.ram.getU32(address - 0x80000000)).toBe(replacement);
    } finally {
      n64js.breakpoints = previous;
    }
  });

  test('compiled code executes the replacement with the same delay slots and timing', async () => {
    const { cpu0: cpu, hardware } = await fixture(id);
    putBranch(hardware, address);
    hardware.ram.set32(address - 0x80000000 + 0xc8, 0x03e00008); // JR ra
    cpu.setRegS32Extend(31, address);
    cpu.pc = address;
    const count = cpu.controlCountValue;
    cpu.run(16000); // 4,000 trips through B / delay slot / JR / delay slot.
    expect(cpu.getRegU64(8)).toBe(4000n);
    expect(cpu.controlCountValue - count).toBe(16000);
    expect(cpu.pc).toBe(address);
    const fragment = getFragmentMap().get(address);
    expect(fragment?.executionCount).toBeGreaterThan(0);
  });

  test('code previously compiled through an uncached alias executes the patched branch', async () => {
    const alias = address + 0x20000000;
    const offset = address - 0x80000000;
    const { cpu0: cpu, hardware } = await fixture(id);
    putBranch(hardware, address);
    hardware.ram.set32(offset + 8, 0x03e00008); // JR ra on the original fall-through path
    hardware.ram.set32(offset + 0xc8, 0x25290001); // ADDIU t1, t1, 1 on the patched path
    hardware.ram.set32(offset + 0xcc, 0x03e00008); // JR ra
    cpu.setRegU64(9, 0n);
    cpu.setRegS32Extend(31, alias);
    cpu.pc = alias;
    cpu.run(16000);
    expect(cpu.getRegU64(9)).toBe(0n);
    expect(getFragmentMap().get(alias)?.executionCount).toBeGreaterThan(0);

    cpu.pc = address;
    cpu.run(2); // Apply the configured patch via the cached address.
    cpu.pc = alias;
    cpu.run(20); // Four five-instruction loops through the replacement branch.
    expect(cpu.getRegU64(9)).toBe(4n);
  });
});
