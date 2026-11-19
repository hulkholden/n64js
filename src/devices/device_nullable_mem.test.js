import { describe, expect, test } from 'bun:test';
import '../headless/headless_env.js';
import { createHeadlessEmulator } from '../headless/headless_env.js';
import { MemoryRegion } from '../memory/memory_region.js';
import { OS_TV_NTSC } from '../system_constants.js';
import { Device } from './device.js';
import { PIF_RAM_OFFSET } from './pif.js';

const { Hardware } = await import('../hardware.js');

describe('Device nullable backing memory and read-only write-through guards', () => {
  test('Device handles null backing memory and setMem(null) across all widths', () => {
    const device = new Device('Nullable', null, new MemoryRegion(new ArrayBuffer(16)), 0xa0000000, 0xa0000010);
    device.setMem(null);

    expect(device.mem).toBeNull();
    expect(device.u8).toBeNull();
    expect(device.readInternal32(0xa0000000)).toBe(0xdddddddd);
    expect(() => device.writeInternal32(0xa0000000, 0x12345678)).not.toThrow();
    expect(device.readU64(0xa0000000)).toBe(0n);
    expect(device.readU32(0xa0000000)).toBe(0);
    expect(device.readU16(0xa0000000)).toBe(0);
    expect(device.readU8(0xa0000000)).toBe(0);
    expect(() => device.write64(0xa0000000, 0x123456789abcdef0n)).not.toThrow();
    expect(() => device.write64masked(0xa0000000, 0x123456789abcdef0n, 0xffn)).not.toThrow();
    expect(() => device.write32masked(0xa0000000, 0x12345678, 0xff)).not.toThrow();
    expect(() => device.write32(0xa0000000, 0x12345678)).not.toThrow();
    expect(() => device.write16(0xa0000000, 0x1234)).not.toThrow();
    expect(() => device.write8(0xa0000000, 0x12)).not.toThrow();
  });

  test('ROM devices with null backing memory safely handle debugger and 64-bit/masked accesses', () => {
    const hardware = new Hardware({ save: 'Eeprom4k' }, { headless: true });

    for (const address of [0xa5000000, 0xa6000000, 0xa8000000, 0xb0000000, 0xbfd00000]) {
      expect(hardware.memMap.readMemoryInternal32(address)).toBe(0xdddddddd);
      expect(() => hardware.memMap.writeMemoryInternal32(address, 0xdeadbeef)).not.toThrow();
    }

    for (const device of [hardware.romD2A1Device, hardware.romD2A2Device]) {
      const address = device.rangeStart;
      expect(device.readU64(address)).toBe(0n);
      expect(() => device.write64(address, 0x123456789abcdef0n)).not.toThrow();
      expect(() => device.write64masked(address, 0x123456789abcdef0n, 0xffn)).not.toThrow();
      expect(() => device.write32masked(address, 0x12345678, 0xff)).not.toThrow();
    }
  });

  test('ROM and PIF devices do not bypass write guards on 64-bit or masked writes', async () => {
    const romBuffer = new ArrayBuffer(0x1000);
    new Uint8Array(romBuffer).fill(0xaa);
    const { hardware } = await createHeadlessEmulator({
      romBuffer,
      rominfo: { cic: '6102', tvType: OS_TV_NTSC, save: 'Eeprom4k' },
    });

    const romHeadBefore = hardware.rom.getU64(0);
    expect(() => hardware.romD1A1Device.write64(0xa6000000, 0x1122334455667788n)).toThrow('Writing to rom d1a1');
    expect(() => hardware.romD1A1Device.write64masked(0xa6000000, 0x1122334455667788n, 0xffffffffffffffffn)).toThrow('Writing to rom d1a1');
    expect(() => hardware.romD1A1Device.write32masked(0xa6000000, 0x11223344, 0xffffffff)).toThrow('Writing to rom d1a1');
    expect(hardware.rom.getU64(0)).toBe(romHeadBefore);

    hardware.romD1A2Device.write64masked(0xb0000000, 0x1122334455667788n, 0xffffffff00000000n);
    hardware.romD1A2Device.write32masked(0xb0000000, 0x11223344, 0xffff0000);
    expect(hardware.rom.getU64(0)).toBe(romHeadBefore);

    hardware.romD1A2Device.write32masked(0xb3ff0021, 0x11223344, 0x00ff0000);
    expect(hardware.romD1A2Device.debugBuffer.getU32(0)).toBe(0x00220000);
    hardware.romD1A2Device.write64masked(0xb3ff0028, 0x1122334455667788n, 0x0000ffff0000ffffn);
    expect(hardware.romD1A2Device.debugBuffer.getU64(8)).toBe(0x0000334400007788n);

    hardware.romD1A3Device.write64masked(0xbfd00000, 0x1122334455667788n, 0xffffffffffffffffn);
    hardware.romD1A3Device.write32masked(0xbfd00000, 0x11223344, 0xffffffff);
    expect(hardware.rom.getU64(0)).toBe(romHeadBefore);

    hardware.pif_mem.set64(0, 0xfedcba9876543210n);
    hardware.pifMemDevice.write64(0xbfc00000, 0x1122334455667788n);
    hardware.pifMemDevice.write64masked(0xbfc00000, 0x1122334455667788n, 0xffffffffffffffffn);
    hardware.pifMemDevice.write32masked(0xbfc00000, 0x11223344, 0xffffffff);
    expect(hardware.pif_mem.getU64(0)).toBe(0xfedcba9876543210n);

    const pifRamAddr = 0xbfc00000 + PIF_RAM_OFFSET;
    hardware.pif_mem.set64(PIF_RAM_OFFSET, 0n);
    hardware.pifMemDevice.write32masked(pifRamAddr + 1, 0x12345678, 0x00ffff00);
    expect(hardware.pif_mem.getU32(PIF_RAM_OFFSET)).toBe(0x00345600);
    hardware.pifMemDevice.write64masked(pifRamAddr + 8, 0x1122334455667788n, 0xff000000000000ffn);
    expect(hardware.pif_mem.getU64(PIF_RAM_OFFSET + 8)).toBe(0x1100000000000088n);
  });
});
