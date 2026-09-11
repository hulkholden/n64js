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
  const dst = { width: 1, data: new Uint8ClampedArray(4) };
  expect(tmem.convertTexels(tile, gbi.TextureLUT.G_TT_RGBA16, dst)).toBe(true);
  return Array.from(dst.data);
}

describe('CI4 palette hashing', () => {
  for (const [name, format] of [
    ['CI4', gbi.ImageFormat.G_IM_FMT_CI],
    ['RGBA4 (CI4 alias)', gbi.ImageFormat.G_IM_FMT_RGBA],
  ]) {
    for (let palette = 0; palette < 16; ++palette) {
      test(`${name} palette ${palette} colour changes invalidate the texture cache key`, () => {
        for (const index of [0, 15]) {
          const tmem = new TMEM();
          const tile = { format, size: gbi.ImageSize.G_IM_SIZ_4b, tmem: 0, line: 1,
            width: 1, height: 1, palette, hash: 0 };
          tmem.tmemData[0] = index << 4;
          writePaletteEntry(tmem, palette, index, 0xf801);
          const before = tmem.calculateCRC(tile);
          expect(pixel(tmem, tile)).toEqual([255, 0, 0, 255]);

          writePaletteEntry(tmem, palette, index, 0x07c1);
          // TMEM loads clear this cached value before the next texture lookup.
          tile.hash = 0;
          expect(pixel(tmem, tile)).toEqual([0, 255, 0, 255]);
          expect(tmem.calculateCRC(tile)).not.toBe(before);
        }
      });
    }

    test(`${name} excludes entries belonging to other palettes`, () => {
      const tmem = new TMEM();
      const tile = { format, size: gbi.ImageSize.G_IM_SIZ_4b, tmem: 0, line: 1,
        width: 1, height: 1, palette: 1, hash: 0 };
      writePaletteEntry(tmem, 1, 0, 0xf801);
      const before = tmem.calculateCRC(tile);

      writePaletteEntry(tmem, 0, 15, 0x07c1);
      writePaletteEntry(tmem, 2, 0, 0x07c1);
      tile.hash = 0;
      expect(pixel(tmem, tile)).toEqual([255, 0, 0, 255]);
      expect(tmem.calculateCRC(tile)).toBe(before);
    });
  }
});
