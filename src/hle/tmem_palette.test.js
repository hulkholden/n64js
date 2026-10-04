import { convertTexels } from './debug_texture.js';
import { describe, expect, test } from 'bun:test';
import * as gbi from './gbi.js';
import { TMEM } from './tmem.js';

function writePaletteEntry(tmem, palette, index, value) {
  // TLUT loads duplicate each 16-bit entry across all four banks.
  const offset = 0x800 + (palette * 16 + index) * 8;
  for (let bank = 0; bank < 4; ++bank) {
    tmem.tmemData[offset + bank * 2] = value >>> 8;
    tmem.tmemData[offset + bank * 2 + 1] = value & 0xff;
  }
}

function pixel(tmem, tile) {
  const dst = new Uint8ClampedArray(4);
  expect(convertTexels(dst, 1, tmem.tmemData, tile, gbi.TextureLUT.G_TT_RGBA16)).toBe(true);
  return Array.from(dst);
}

describe('4-bit palette hashing', () => {
  for (const [name, format] of [
    ['CI4', gbi.ImageFormat.G_IM_FMT_CI],
    ['RGBA4 with TLUT', gbi.ImageFormat.G_IM_FMT_RGBA],
    ['IA4 with TLUT', gbi.ImageFormat.G_IM_FMT_IA],
    ['I4 with TLUT', gbi.ImageFormat.G_IM_FMT_I],
  ]) {
    for (let palette = 0; palette < 16; ++palette) {
      test(`${name} palette ${palette} colour changes update the snapshot key`, () => {
        for (const index of [0, 15]) {
          const tmem = new TMEM();
          const tile = { format, size: gbi.ImageSize.G_IM_SIZ_4b, tmem: 0, line: 1,
            width: 1, height: 1, palette };
          tmem.tmemData[0] = index << 4;
          writePaletteEntry(tmem, palette, index, 0xf801);
          const before = tmem.hashContents();
          expect(pixel(tmem, tile)).toEqual([255, 0, 0, 255]);

          writePaletteEntry(tmem, palette, index, 0x07c1);
          // Snapshot identity observes palette bytes without explicit invalidation.
          expect(pixel(tmem, tile)).toEqual([0, 255, 0, 255]);
          expect(tmem.hashContents()).not.toBe(before);
        }
      });
    }

    test(`${name} hashes other palettes without changing the selected tile`, () => {
      const tmem = new TMEM();
      const tile = { format, size: gbi.ImageSize.G_IM_SIZ_4b, tmem: 0, line: 1,
        width: 1, height: 1, palette: 1 };
      writePaletteEntry(tmem, 1, 0, 0xf801);
      const before = tmem.hashContents();

      writePaletteEntry(tmem, 0, 15, 0x07c1);
      writePaletteEntry(tmem, 2, 0, 0x07c1);
      expect(pixel(tmem, tile)).toEqual([255, 0, 0, 255]);
      expect(tmem.hashContents()).not.toBe(before);
    });
  }
});
