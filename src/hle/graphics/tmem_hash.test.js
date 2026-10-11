import { expect, test } from 'bun:test';
import { TMEM } from './tmem.js';

// Materialize little-endian words independently of the production hash loop.
function referenceHash(tmem) {
  const bytes = new Uint8Array(4096), view = new DataView(bytes.buffer);
  for (let i = 0; i < 1024; i++) {
    view.setInt32(i * 4, tmem.tmemData32[i], true);
  }
  return Bun.hash.xxHash32(bytes);
}

test('full TMEM hashes match independent XXH32 for blank and varied snapshots', () => {
  const tmem = new TMEM();
  expect(tmem.hashContents()).toBe(referenceHash(tmem));
  for (const seed of [1, 17, 0x80000000, 0xffffffff]) {
    for (let i = 0; i < 1024; i++) {
      tmem.tmemData32[i] = Math.imul(i + seed, 0x9e3779b1);
    }
    expect(tmem.hashContents()).toBe(referenceHash(tmem));
  }
});

test('snapshot hashing observes every physical word, including unused texels and palettes', () => {
  const tmem = new TMEM(), blank = tmem.hashContents();
  for (let i = 0; i < 1024; i++) {
    tmem.tmemData32[i] = 0x80000001;
    expect(tmem.hashContents()).toBe(referenceHash(tmem));
    expect(tmem.hashContents()).not.toBe(blank);
    tmem.tmemData32[i] = 0;
  }
});

for (const [name, first, second] of [
  ['compensating word values', [1, 0], [0, 17]],
  ['high bits in adjacent words', [0, 0], [0x80000000, 0x80000000]],
]) {
  test(`snapshot key distinguishes ${name}`, () => {
    const tmem = new TMEM();
    tmem.tmemData32.set(first);
    const before = tmem.hashContents();
    tmem.tmemData32.set(second);
    expect(tmem.hashContents()).not.toBe(before);
  });
}
