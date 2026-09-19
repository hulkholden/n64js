import { describe, expect, test } from 'bun:test';
import { createHeadlessEmulator } from './headless/headless_env.js';

const images = [
  ['Europe', '8c6d9311434b2c6f', 0x80000aa4],
  ['Japan', 'a7893c05024306a5', 0x80000aa4],
  ['USA', 'bfea58ec69717cad', 0x80000a04],
];
const trap = 0x1462ffff; // BNE v1, v0, self; followed by a NOP delay slot.

async function fixture(id, address, options) {
  const emulator = await createHeadlessEmulator({
    romBuffer: new ArrayBuffer(0x1000),
    rominfo: { id, name: 'Renamed image', cic: '6105', tvType: 1, save: 'Eeprom16k' },
  }, options);
  const { cpu0: cpu, hardware } = emulator;
  cpu.pc = address;
  cpu.setRegS32Extend(2, 0); // Missing boot word.
  cpu.setRegS32Extend(3, 0xad170014); // Expected boot word.
  cpu.setRegS32Extend(8, 0);
  // Keep the disabled trap deterministic without skipping to the Compare event.
  cpu.speedHack = () => {};
  hardware.ram.set32(address - 0x80000000, trap);
  hardware.ram.set32(address - 0x80000000 + 4, 0);
  hardware.ram.set32(address - 0x80000000 + 8, 0x25080001); // ADDIU t0, t0, 1.
  return emulator;
}

describe('Donkey Kong 64 boot-word workaround', () => {
  for (const [region, id, address] of images) {
    test(`${region} resumes past the trap without seeding RAM or changing event timing`, async () => {
      const { cpu0: cpu, hardware, fatalError } = await fixture(id, address);
      // The word remains original until execution, after the boot checksum.
      expect(hardware.ram.getU32(address - 0x80000000)).toBe(trap);
      const count = cpu.controlCountValue;
      cpu.addEvent('Unrelated DMA deadline', 100, () => {});
      cpu.run(3);
      expect(cpu.pc).toBe(address + 12);
      expect(cpu.getRegU64(8)).toBe(1n);
      expect(cpu.controlCountValue - count).toBe(3);
      expect(cpu.getCyclesUntilEvent('Unrelated DMA deadline')).toBe(97);
      expect(hardware.ram.getU32(0x2fe1c0)).toBe(0);
      expect(hardware.ram.getU32(address - 0x80000000)).toBe(0);
      expect(fatalError()).toBeNull();
    });

    test(`${region} keeps the original trap when workarounds are disabled`, async () => {
      const { cpu0: cpu, hardware } = await fixture(id, address, { enableCompatibilityHacks: false });
      cpu.run(4);
      expect(cpu.pc).toBe(address);
      expect(cpu.getRegU64(8)).toBe(0n);
      expect(hardware.ram.getU32(address - 0x80000000)).toBe(trap);
    });

    test(`${region} leaves the trap untouched when the preceding boot-word check succeeds`, async () => {
      const { cpu0: cpu, hardware } = await fixture(id, address);
      // BEQ v1, t6, +5 at trap-16 skips the fallback load and trap.
      hardware.ram.set32(address - 0x80000000 - 16, 0x106e0005);
      cpu.setRegS32Extend(14, 0xad170014);
      cpu.pc = address - 16;
      cpu.run(3);
      expect(cpu.pc).toBe(address + 12);
      expect(cpu.getRegU64(8)).toBe(1n);
      expect(hardware.ram.getU32(address - 0x80000000)).toBe(trap);
    });
  }

  test('does not select the DK64 kiosk, Tonic Trouble, or unknown images', async () => {
    for (const id of ['ababd40d1ea9a2b5', '6e913f0998b60844', '14979eef7d2c3bc0', 'unknown']) {
      for (const address of [0x80000a04, 0x80000aa4]) {
        const { cpu0: cpu, hardware } = await fixture(id, address);
        cpu.run(4);
        expect(cpu.pc).toBe(address);
        expect(cpu.getRegU64(8)).toBe(0n);
        expect(hardware.ram.getU32(address - 0x80000000)).toBe(trap);
      }
    }
  });
});
