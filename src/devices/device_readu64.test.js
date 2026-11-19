import { describe, expect, test } from 'bun:test';
import { createHeadlessEmulator } from '../headless/headless_env.js';
import { MemoryRegion } from '../memory/memory_region.js';
import { OS_TV_NTSC } from '../system_constants.js';
import { Device } from './device.js';

describe('Device.readU64', () => {
  test('returns BigInt 0n for out-of-bounds reads', () => {
    const mem = new MemoryRegion(new ArrayBuffer(16));
    mem.set64(0, 0x0123456789abcdefn);
    const device = new Device('Test', null, mem, 0xa4300000, 0xa4300010);

    expect(device.readU64(0xa4300000)).toBe(0x0123456789abcdefn);
    expect(device.readU64(0xa430000c)).toBe(0n);
    expect(device.readU64(0xa4300010)).toBe(0n);
  });

  test('CPU 64-bit loads past device backing length receive 0n without TypeError', async () => {
    const { cpu0, hardware, fatalError } = await createHeadlessEmulator({
      romBuffer: new ArrayBuffer(0x1000),
      rominfo: { cic: '6102', tvType: OS_TV_NTSC, save: 'Eeprom4k' },
    });

    // RDRamRegDevice backs 0x30 bytes at 0xa3f00000 with ea = address & 0xff.
    cpu0.setRegS32Extend(3, 0xa3f00040);

    cpu0.setRegU64(2, 0x1122334455667788n);
    cpu0.execLD(2, 3, 0);
    expect(cpu0.getRegU64(2)).toBe(0n);

    cpu0.setRegU64(2, 0x1122334455667788n);
    cpu0.execLDL(2, 3, 0);
    expect(cpu0.getRegU64(2)).toBe(0n);

    cpu0.setRegU64(2, 0x1122334455667788n);
    cpu0.execLDR(2, 3, 7);
    expect(cpu0.getRegU64(2)).toBe(0n);

    hardware.cpu1.store64(hardware.cpu1.copRegIdx64(2), 0x1122334455667788n);
    cpu0.execLDC1Unchecked(2, 3, 0);
    expect(hardware.cpu1.loadU64(hardware.cpu1.copRegIdx64(2))).toBe(0n);

    expect(fatalError()).toBeNull();
  });
});
