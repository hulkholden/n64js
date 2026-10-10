import { describe, expect, test } from 'bun:test';
import { MemoryActivity, pixelAddress } from './memory_activity.js';
import { createHeadlessEmulator } from '../headless/headless_env.js';
import * as mem from '../memory/memaccess.js';
import { PI_CART_ADDR_REG, PI_DRAM_ADDR_REG, PI_WR_LEN_REG } from '../devices/pi.js';
import { SI_DRAM_ADDR_REG, SI_PIF_ADDR_RD64B_REG } from '../devices/si.js';
import { getFragmentMap, lookupFragment } from '../cpu/fragments.js';

const sourceAt = (capture, address) => capture.sources[capture.index(address)];
async function fixture() {
  const emulator = await createHeadlessEmulator({
    romBuffer: new ArrayBuffer(0x1000),
    rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' },
  });
  emulator.hardware.memoryActivity = new MemoryActivity(emulator.hardware.ram.length);
  return emulator;
}

describe('experimental RAM activity', () => {
  test('Morton layout round trips every byte for both RAM sizes', () => {
    for (const size of [4, 8]) {
      const c = new MemoryActivity(size * 1024 * 1024);
      let valid = true;
      for (let a = 0; a < c.size; a++) {
        const index = c.index(a);
        if (index >= c.size || pixelAddress(index % c.width, Math.floor(index / c.width)) !== a) {
          valid = false;
          break;
        }
      }
      expect(valid).toBe(true);
    }
  });

  test('latest writer, clipping, frame aging, freeze and reset', () => {
    const c = new MemoryActivity(4 * 1024 * 1024);
    c.markRange(-2, 4, 2);
    c.advance();
    c.markRange(1, 1, 1);
    expect(sourceAt(c, 0)).toBe(2);
    expect(sourceAt(c, 1)).toBe(1);
    expect(c.times[c.index(1)]).toBe(1);
    c.paused = true;
    c.advance();
    c.markRange(1, 1, 4);
    expect(c.frame).toBe(1);
    expect(sourceAt(c, 1)).toBe(1);
    c.reset();
    expect(sourceAt(c, 1)).toBe(0);
    expect(c.dirtyRows.size).toBe(2048);
  });

  test('CPU fast, uncached, mapped and masked writes track only selected bytes', async () => {
    const { hardware: h, cpu0 } = await fixture();
    const c = h.memoryActivity;
    for (const [store, bytes, value] of [[mem.store8fast, 1, 5], [mem.store16fast, 2, 5], [mem.store32fast, 4, 5], [mem.store64fast, 8, 5n]]) {
      c.reset();
      store(0x80001000 | 0, value);
      store(0xa0001020 | 0, value);
      for (const base of [0x1000, 0x1020]) {
        expect(Array.from({ length: bytes }, (_, i) => sourceAt(c, base + i))).toEqual(Array(bytes).fill(1));
        expect(sourceAt(c, base + bytes)).toBe(0);
      }
    }
    c.reset();
    mem.store32masked(0x80001000, 0xffffffff, 0x00ffff00);
    mem.store64masked(0xa0001020, 0xffffffffffffffffn, 0x0000ffffff000000n);
    expect(Array.from({ length: 4 }, (_, i) => sourceAt(c, 0x1000 + i))).toEqual([0, 1, 1, 0]);
    expect(Array.from({ length: 8 }, (_, i) => sourceAt(c, 0x1020 + i))).toEqual([0, 0, 1, 1, 1, 0, 0, 0]);
    const original = cpu0.translateWrite;
    cpu0.translateWrite = () => 0x2000;
    try {
      mem.store32fast(0x4000, 123);
      expect(sourceAt(c, 0x2000)).toBe(1);
      expect(sourceAt(c, 0x4000)).toBe(0);
    } finally {
      cpu0.translateWrite = original;
    }
  });

  test('PI, SI and strided SP DMA record their destinations', async () => {
    const { hardware: h } = await fixture();
    const c = h.memoryActivity;
    h.piRegDevice.write32(0xa4600000 + PI_DRAM_ADDR_REG, 0x1000);
    h.piRegDevice.write32(0xa4600000 + PI_CART_ADDR_REG, 0x10000100);
    h.piRegDevice.write32(0xa4600000 + PI_WR_LEN_REG, 7);
    expect(sourceAt(c, 0x1000)).toBe(2);
    expect(sourceAt(c, 0x1007)).toBe(2);
    expect(sourceAt(c, 0x1008)).toBe(0);
    h.siRegDevice.write32(0xa4800000 + SI_DRAM_ADDR_REG, 0x2000);
    h.siRegDevice.write32(0xa4800000 + SI_PIF_ADDR_RD64B_REG, 0x1fc007c0);
    expect(sourceAt(c, 0x2000)).toBe(3);
    expect(sourceAt(c, 0x203f)).toBe(3);
    expect(sourceAt(c, 0x2040)).toBe(0);
    h.spRegDevice.spCopyToRDRAM(0, 0x3000, (8 << 20) | (1 << 12) | 7);
    expect(Array.from({ length: 32 }, (_, i) => sourceAt(c, 0x3000 + i))).toEqual([
      ...Array(8).fill(4), ...Array(8).fill(0), ...Array(8).fill(4), ...Array(8).fill(0),
    ]);
  });

  test('compiled CPU stores remain visible when capture is enabled after compilation', async () => {
    const { hardware: h, cpu0: cpu } = await fixture();
    n64js.getSyncFlow = () => null;
    h.memoryActivity = null;
    // SW t0, 0(t1); J 0x80001000; NOP.
    [0xad280000, 0x08000400, 0].forEach((op, i) => h.ram.set32(0x1000 + i * 4, op));
    cpu.setRegS32Extend(9, 0x80003000);
    cpu.pc = 0x80001000;
    for (let i = 0; i < 499; i++) {
      lookupFragment(0x80001000);
    }
    cpu.run(16);
    const fragment = getFragmentMap().get(0x80001000);
    expect(fragment?.func).toBeFunction();
    const before = fragment.executionCount;
    h.memoryActivity = new MemoryActivity(h.ram.length);
    cpu.run(16);
    expect(fragment.executionCount).toBeGreaterThan(before);
    expect(sourceAt(h.memoryActivity, 0x3000)).toBe(1);
  });
});

describe('RAM read activity', () => {
  test('read/write modes are isolated and switching clears history', () => {
    const c = new MemoryActivity(4 * 1024 * 1024);
    c.markRange(0, 4, 1);
    c.markRead(16, 4, 2);
    expect(sourceAt(c, 16)).toBe(0);
    c.setReadMode(true);
    expect(sourceAt(c, 0)).toBe(0);
    c.markRange(0, 4, 1);
    expect(sourceAt(c, 0)).toBe(0);
    c.markRead(16, 4, 2);
    expect(sourceAt(c, 16)).toBe(2);
    c.cpuReads = false;
    c.markRead(32, 4, 1);
    expect(sourceAt(c, 32)).toBe(0);
    c.paused = true;
    c.markRead(48, 4, 4);
    expect(sourceAt(c, 48)).toBe(0);
    c.setReadMode(false);
    expect(sourceAt(c, 16)).toBe(0);
  });

  test('CPU signed/unsigned, uncached and mapped loads retain values and record physical bytes', async () => {
    const { hardware: h, cpu0 } = await fixture();
    const c = h.memoryActivity;
    c.setReadMode(true);
    h.memoryReads = c;
    h.ram.u8.fill(0xff, 0x1000, 0x1040);
    for (const [load, bytes, expected] of [
      [mem.loadU8fast, 1, 255], [mem.loadS8fast, 1, -1],
      [mem.loadU16fast, 2, 65535], [mem.loadS16fast, 2, -1],
      [mem.loadU32fast, 4, 0xffffffff], [mem.loadS32fast, 4, -1],
      [mem.loadU64fast, 8, 0xffffffffffffffffn],
    ]) {
      c.reset();
      expect(load(0x80001000 | 0)).toBe(expected);
      expect(load(0xa0001020 | 0)).toBe(expected);
      for (const base of [0x1000, 0x1020]) {
        expect(Array.from({ length: bytes }, (_, i) => sourceAt(c, base + i))).toEqual(Array(bytes).fill(1));
        expect(sourceAt(c, base + bytes)).toBe(0);
      }
    }
    c.reset();
    mem.loadU32fast(0x80001000 | 0, false);
    mem.loadU32fast(0xa0001020 | 0, false);
    h.memMap.readMemoryInternal32(0x80001000);
    expect(sourceAt(c, 0x1000)).toBe(0);
    expect(sourceAt(c, 0x1020)).toBe(0);
    const original = cpu0.translateRead;
    cpu0.translateRead = () => 0x1000;
    try {
      expect(mem.loadU32fast(0x4000)).toBe(0xffffffff);
      expect(sourceAt(c, 0x1000)).toBe(1);
      expect(sourceAt(c, 0x4000)).toBe(0);
      c.reset();
      cpu0.translateRead = () => { throw new Error('TLB fault'); };
      expect(() => mem.loadU32fast(0x4000)).toThrow('TLB fault');
      expect(sourceAt(c, 0x1000)).toBe(0);
    } finally {
      cpu0.translateRead = original;
    }
  });

  test('DMA reads respect SP strides and do not count DMA writes', async () => {
    const { hardware: h } = await fixture();
    const c = h.memoryActivity;
    c.setReadMode(true);
    h.memoryReads = c;
    h.spRegDevice.spCopyFromRDRAM(0, 0x3000, (8 << 20) | (1 << 12) | 7);
    expect(Array.from({ length: 32 }, (_, i) => sourceAt(c, 0x3000 + i))).toEqual([
      ...Array(8).fill(4), ...Array(8).fill(0), ...Array(8).fill(4), ...Array(8).fill(0),
    ]);
    h.cpu0.eventQueue.incrementCount(2);
    h.spRegDevice.spCopyToRDRAM(0, 0x4000, 7);
    expect(sourceAt(c, 0x4000)).toBe(0);
    h.siRegDevice.write32(0xa4800000 + SI_DRAM_ADDR_REG, 0x2000);
    h.siRegDevice.copyFromRDRAM();
    expect(sourceAt(c, 0x2000)).toBe(3);
    expect(sourceAt(c, 0x203f)).toBe(3);
    expect(sourceAt(c, 0x2040)).toBe(0);
  });

  test('compiled loads are captured when read mode is enabled after compilation', async () => {
    const { hardware: h, cpu0: cpu } = await fixture();
    n64js.getSyncFlow = () => null;
    // LW t0, 0(t1); J 0x80001000; NOP.
    [0x8d280000, 0x08000400, 0].forEach((op, i) => h.ram.set32(0x1000 + i * 4, op));
    h.ram.set32(0x3000, 123);
    cpu.setRegS32Extend(9, 0x80003000);
    cpu.pc = 0x80001000;
    for (let i = 0; i < 499; i++) {
      lookupFragment(0x80001000);
    }
    cpu.run(16);
    const fragment = getFragmentMap().get(0x80001000);
    expect(fragment?.func).toBeFunction();
    const before = fragment.executionCount;
    h.memoryActivity.setReadMode(true);
    h.memoryReads = h.memoryActivity;
    cpu.run(16);
    expect(fragment.executionCount).toBeGreaterThan(before);
    expect(sourceAt(h.memoryActivity, 0x3000)).toBe(1);
    expect(sourceAt(h.memoryActivity, 0x1000)).toBe(0);
    expect(cpu.getRegU32Lo(8)).toBe(123);
  });
});
