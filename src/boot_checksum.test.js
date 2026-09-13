import { describe, expect, test } from 'bun:test';
import { calculateIPL3BootState } from './boot_checksum.js';
import { MemoryRegion } from './memory_region.js';

// Captured by executing the original PIF MIPS instructions, including delay
// slots, on synthetic IPL3 buffers. No original ROM is needed to run these tests.
// Reference SHA-256: fab6131e6aca93c30d8f1380a12428b06bd40afbec112f083f0d447b89eb1224.
const fields = ["at", "v0", "a0", "a1", "t4", "t5", "t6", "t7", "t8", "t9", "hi", "lo"];
const vectors = [
  ['zero', 0x3f, [0x0, 0xf8652982, 0x2982, 0xad8c201d, 0xd3655a9b, 0xdd2e2691, 0x7ee97a86, 0x106667be, 0x0, 0x3db984d, 0x8cb9140, 0x106667be]],
  ['ones', 0x3f, [0x1, 0xf54e0f74, 0xf74, 0xe8302797, 0x5759ff39, 0x5759ff39, 0xbf69d8ae, 0x8052aede, 0x0, 0x7baae45e, 0x75a0be52, 0x8052aede]],
  ['ascending', 0x3f, [0x1, 0x9f0a4962, 0x4962, 0x269518c5, 0x165e798d, 0x165e798d, 0x30cb6148, 0xee854080, 0x0, 0x92b3e920, 0x8d8f89e2, 0xee854080]],
  ['rotations', 0x3f, [0x0, 0x3566ce68, 0xce68, 0xf51ac386, 0x7a51c800, 0x7a51c800, 0x8f4b0b86, 0x1dbf0a88, 0x2, 0x1c22cfd3, 0x5325d8f0, 0x1dbf0a88]],
  ['zero', 0x0, [0x0, 0x425ec51a, 0xc51a, 0xc0bfd64, 0x9f36e926, 0x71572f36, 0x933d1442, 0x1564bae, 0x0, 0x60bebceb, 0x43b510c8, 0x1564bae]],
  ['ascending', 0x91, [0x0, 0x8571032f, 0x32f, 0x5f38cfdf, 0xdb5ed6d1, 0xdb5ed6d1, 0x8466190e, 0x8a9ea597, 0x0, 0x49900a6d, 0x100fa8c6, 0x8a9ea597]],
  ['rotations', 0xff, [0x0, 0xd5a14be7, 0x4be7, 0xb653e29c, 0xc089ab73, 0xc089ab73, 0x76da49ef, 0x66c640ec, 0x0, 0x27c58ec9, 0x3c678cd3, 0x66c640ec]],
];

function input(kind) {
  const memory = new MemoryRegion(new ArrayBuffer(0xfc0));
  if (kind === 'ones') memory.u8.fill(0xff);
  if (kind === 'ascending') {
    for (let i = 0; i < memory.length; ++i) memory.u8[i] = i & 0xff;
  }
  if (kind === 'rotations') {
    const words = [0, 1, 31, 32, 0x80000000, 0xffffffff];
    for (let i = 0; i < 1008; ++i) memory.set32(i * 4, words[i % words.length]);
  }
  return memory;
}

describe('IPL2 checksum register results', () => {
  for (const [kind, seed, expected] of vectors) {
    test(`${kind} with seed ${seed.toString(16)} matches PIF execution`, () => {
      const result = calculateIPL3BootState(input(kind), seed);
      expect(fields.map(field => result[field])).toEqual(expected);
    });
  }
});
