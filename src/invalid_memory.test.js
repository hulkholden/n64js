import { describe, expect, test, spyOn } from 'bun:test';
import './headless_env.js';
import { InvalidMemDevice } from './devices/ram.js';
import * as memory from './memaccess.js';

const { Hardware } = await import('./hardware.js');
const hardware = new Hardware({ save: 'Eeprom4k' }, { headless: true });

describe('invalid memory', () => {
  test('all load/store widths use the invalid-access handlers without backing memory', () => {
    const device = new InvalidMemDevice(hardware, 0x80000000, 0xa0000000);
    const read = spyOn(device, 'read').mockReturnValue(0);
    const write = spyOn(device, 'write').mockImplementation(() => {});
    const address = 0x83f00000;
    expect(device.readU64(address)).toBe(0n);
    expect(device.readU32(address)).toBe(0);
    expect(device.readU16(address)).toBe(0);
    expect(device.readU8(address)).toBe(0);
    expect(read).toHaveBeenCalledTimes(4);
    expect(read).toHaveBeenLastCalledWith(address);
    device.write64(address, 0x123456789abcdef0n);
    device.write32(address, 0x12345678);
    device.write16(address, 0x1234);
    device.write8(address, 0x12);
    device.write64masked(address, 0x123456789abcdef0n, 0xffn);
    device.write32masked(address, 0x12345678, 0xff);
    expect(write).toHaveBeenCalledTimes(6);
    expect(device.mem).toBeNull();
    read.mockRestore();
    write.mockRestore();
  });

  test('cached RDRAM-register and unmapped uncached accesses do not throw', () => {
    memory.reset(hardware, hardware.cpu0);
    const log = spyOn(console, 'log').mockImplementation(() => {});
    try {
      for (const address of [0x83f00000, 0xa1000000]) {
        expect(hardware.memMap.getMemoryHandler(address)).toBeInstanceOf(InvalidMemDevice);
        expect(memory.loadU64fast(address | 0)).toBe(0n);
        memory.store64fast(address | 0, 0xffffffffffffffffn);
        memory.store64masked(address, 0xffffffffffffffffn, 0xffffffffn);
        memory.store32masked(address, 0xffffffff, 0xffff);
        expect(memory.loadU64fast(address | 0)).toBe(0n);
        expect(hardware.memMap.readMemoryInternal32(address)).toBe(0xdddddddd);
        hardware.memMap.writeMemoryInternal32(address, 0x12345678);
      }
    } finally {
      log.mockRestore();
    }
  });

  test('debugger accesses are silent and do not call emulated read/write handlers', () => {
    const device = hardware.invalidCachedMemDevice;
    const read = spyOn(device, 'read');
    const write = spyOn(device, 'write');
    expect(device.readInternal32(0x83f00000)).toBe(0xdddddddd);
    device.writeInternal32(0x83f00000, 0x12345678);
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    read.mockRestore();
    write.mockRestore();
  });
});
