import { describe, expect, test, spyOn } from 'bun:test';
import '../headless/headless_env.js';
import { InvalidMemDevice } from '../devices/ram.js';
import * as memory from './memaccess.js';

const { Hardware } = await import('../hardware.js');
const hardware = new Hardware({ save: 'Eeprom4k' }, { headless: true });

describe('invalid memory routing', () => {
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
});
