import { describe, expect, test } from 'bun:test';
import * as gbi from './gbi.js';
import { TMEM } from './tmem.js';

function rgbaTile(offset, length) {
  return { format: gbi.ImageFormat.G_IM_FMT_RGBA, size: gbi.ImageSize.G_IM_SIZ_16b,
    tmem: offset / 8, line: 1, width: 4, height: length / 8, palette: 0, hash: 0 };
}

// Materialise the logical word sequence independently of the masked hash loop.
// XXH32 consumes little-endian words; TMEM's host-endian hash is only used locally.
function referenceHash(tmem, offset, length, seed = 0, mask = 0xfff) {
  const bytes = new Uint8Array(Math.min(length, mask + 1));
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < bytes.length; i += 4) {
    view.setInt32(i, tmem.tmemData32[((offset + i) & mask) / 4], true);
  }
  return Bun.hash.xxHash32(bytes, seed);
}

describe('TMEM content hashes', () => {
  test('matches independent XXH32 for short, striped, tail and wrapped spans', () => {
    const tmem = new TMEM();
    for (let i = 0; i < 1024; i++) tmem.tmemData32[i] = Math.imul(i + 1, 0x9e3779b1);
    for (const offset of [0, 8, 2040, 2048, 4080, 4088]) {
      for (const length of [0, 8, 16, 24, 32, 40, 128, 512, 2048, 4096]) {
        expect(tmem.calculateCRC(rgbaTile(offset, length))).toBe(referenceHash(tmem, offset, length) + 1);
      }
    }
  });

  test('chains index and enabled palette hashes with the correct wrap boundary', () => {
    const tmem = new TMEM();
    for (let i = 0; i < 1024; i++) tmem.tmemData32[i] = Math.imul(i + 1, 0x85ebca77);
    for (const format of [gbi.ImageFormat.G_IM_FMT_CI, gbi.ImageFormat.G_IM_FMT_RGBA,
      gbi.ImageFormat.G_IM_FMT_IA, gbi.ImageFormat.G_IM_FMT_I]) {
      for (const size of [gbi.ImageSize.G_IM_SIZ_4b, gbi.ImageSize.G_IM_SIZ_8b]) {
        for (const palette of [0, 7, 15]) {
          for (const length of [8, 24, 2048, 4096]) {
            const tile = { ...rgbaTile(2040, length), format, size, palette };
            const indices = referenceHash(tmem, 2040, length, 0, 0x7ff);
            const offset = size === gbi.ImageSize.G_IM_SIZ_4b ? 0x800 + palette * 128 : 0x800;
            const bytes = size === gbi.ImageSize.G_IM_SIZ_4b ? 128 : 2048;
            expect(tmem.calculateCRC(tile, tile, gbi.TextureLUT.G_TT_RGBA16)).toBe(referenceHash(tmem, offset, bytes, indices) + 1);
          }
        }
      }
    }
  });

  for (const [name, words] of [['blank texture', [0, 0]], ['zero XXH32 digest', [0, 0x2b219cdc]]]) {
    test(`${name} reuses its cached hash`, () => {
      const tmem = new TMEM();
      tmem.tmemData32.set(words);
      const expected = referenceHash(tmem, 0, 8) + 1;
      const tile = rgbaTile(0, 8);
      let reads = 0;
      tmem.tmemData32 = new Proxy(tmem.tmemData32, {
        get(target, property) { reads++; return target[property]; },
      });
      expect(tmem.calculateCRC(tile)).toBe(expected);
      expect(reads).toBe(2);
      expect(tmem.calculateCRC(tile)).toBe(expected);
      expect(reads).toBe(2);
    });
  }
});
