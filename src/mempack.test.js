import { describe, expect, test } from 'bun:test';
import { Mempack } from './mempack.js';

function createMempack(item) {
  const mempack = new Mempack();
  mempack.init(item);
  return mempack;
}

describe('new Controller Pak filesystem', () => {
  test('has four matching ID blocks with valid checksums and one writable bank', () => {
    const { data } = createMempack();
    const view = new DataView(data.buffer);
    expect(data.length).toBe(0x8000);

    for (const offset of [0x20, 0x60, 0x80, 0xc0]) {
      expect(data.subarray(offset, offset + 32)).toEqual(data.subarray(0x20, 0x40));
      expect(view.getUint16(offset + 0x18) & 1).toBe(1);
      expect(data[offset + 0x1a]).toBe(1);

      // PFS checks both the sum of the first 14 big-endian words and
      // the sum of their one's complements, each truncated to 16 bits.
      let sum = 0;
      let inverseSum = 0;
      for (let i = 0; i < 28; i += 2) {
        const word = view.getUint16(offset + i);
        sum += word;
        inverseSum += word ^ 0xffff;
      }
      expect(view.getUint16(offset + 0x1c)).toBe(sum & 0xffff);
      expect(view.getUint16(offset + 0x1e)).toBe(inverseSum & 0xffff);
    }
  });

  test('has matching allocation tables with 123 free pages and valid checksums', () => {
    const { data } = createMempack();
    expect(data.subarray(0x100, 0x200)).toEqual(data.subarray(0x200, 0x300));

    for (const offset of [0x100, 0x200]) {
      const view = new DataView(data.buffer, offset, 256);
      const entries = Array.from({ length: 128 }, (_, page) => view.getUint16(page * 2));
      expect(entries.filter(entry => entry === 0x0003).length).toBe(123);
      expect(entries.slice(1, 5)).toEqual([0, 0, 0, 0]);
      expect(entries.slice(5).every(entry => entry === 0x0003)).toBe(true);
      const checksum = data.subarray(offset + 10, offset + 256).reduce((sum, byte) => sum + byte, 0) & 0xff;
      expect(view.getUint16(0)).toBe(checksum);
      expect(checksum).toBe(0x71);
    }
  });

  test('starts with 16 empty notes and cleared data pages', () => {
    const { data, dirty } = createMempack();
    expect(data.subarray(0x300, 0x500)).toEqual(new Uint8Array(16 * 32));
    expect(data.subarray(0x500).every(byte => byte === 0)).toBe(true);
    expect(dirty).toBe(false);
  });

  test('reinitializes the same backing memory when no saved pak is supplied', () => {
    const mempack = createMempack();
    const backingMemory = mempack.data;
    const original = mempack.data.slice();
    mempack.data.fill(0xff);
    mempack.dirty = true;
    mempack.init(null);
    expect(mempack.data).toBe(backingMemory);
    expect(mempack.data).toEqual(original);
    expect(mempack.dirty).toBe(false);
  });
});

describe('saved Controller Paks', () => {
  test('restores every saved byte, including invalid filesystem metadata', () => {
    const saved = Uint8Array.from({ length: 0x8000 }, (_, i) => (i * 17 + 3) & 0xff);
    const mempack = createMempack();
    mempack.dirty = true;
    mempack.init({ data: saved.toBase64() });
    expect(mempack.data).toEqual(saved);
    expect(mempack.dirty).toBe(false);
  });

  test('preserves an existing all-zero pak instead of silently formatting it', () => {
    const saved = new Uint8Array(0x8000);
    expect(createMempack({ data: saved.toBase64() }).data).toEqual(saved);
  });

  test('pads short saves with zeroes and truncates oversized saves', () => {
    const short = new Uint8Array([1, 2, 3]);
    const mempack = createMempack();
    mempack.init({ data: short.toBase64() });
    expect(mempack.data.subarray(0, 3)).toEqual(short);
    expect(mempack.data.subarray(3).every(byte => byte === 0)).toBe(true);

    const oversized = new Uint8Array(0x8020).fill(0x5a);
    mempack.init({ data: oversized.toBase64() });
    expect(mempack.data.length).toBe(0x8000);
    expect(mempack.data).toEqual(oversized.subarray(0, 0x8000));
  });
});
