import { describe, expect, test } from 'bun:test';
import { convertTexels } from './convert.js';
import * as gbi from './gbi.js';

const formats = [
  ['RGBA32', gbi.ImageFormat.G_IM_FMT_RGBA, gbi.ImageSize.G_IM_SIZ_32b, 4096],
  ['RGBA16', gbi.ImageFormat.G_IM_FMT_RGBA, gbi.ImageSize.G_IM_SIZ_16b, 4096],
  ['IA16', gbi.ImageFormat.G_IM_FMT_IA, gbi.ImageSize.G_IM_SIZ_16b, 4096],
  ['IA8', gbi.ImageFormat.G_IM_FMT_IA, gbi.ImageSize.G_IM_SIZ_8b, 4096],
  ['IA4', gbi.ImageFormat.G_IM_FMT_IA, gbi.ImageSize.G_IM_SIZ_4b, 4096],
  ['I8', gbi.ImageFormat.G_IM_FMT_I, gbi.ImageSize.G_IM_SIZ_8b, 4096],
  ['I4', gbi.ImageFormat.G_IM_FMT_I, gbi.ImageSize.G_IM_SIZ_4b, 4096],
  ['CI8', gbi.ImageFormat.G_IM_FMT_CI, gbi.ImageSize.G_IM_SIZ_8b, 2048],
  ['CI4', gbi.ImageFormat.G_IM_FMT_CI, gbi.ImageSize.G_IM_SIZ_4b, 2048],
  ['RGBA8 (CI8 alias)', gbi.ImageFormat.G_IM_FMT_RGBA, gbi.ImageSize.G_IM_SIZ_8b, 2048],
  ['RGBA4 (CI4 alias)', gbi.ImageFormat.G_IM_FMT_RGBA, gbi.ImageSize.G_IM_SIZ_4b, 2048],
];

function imageData(tile) {
  // Include padding so a trailing 4-bit texel must not overwrite the next pixel.
  const width = tile.width + 3;
  return { width, data: new Uint8ClampedArray(width * tile.height * 4).fill(0x55) };
}

describe('TMEM texel wrapping', () => {
  for (const [name, format, size, boundary] of formats) {
    test(`${name} wraps within rows and across swizzled rows`, () => {
      const src = Uint8Array.from({ length: 4096 }, (_, i) => (i * 37 + (i >>> 8) * 13) & 0xff);
      const reference = src.slice();
      // Relocate the end of TMEM and the following wrapped bytes to one ordinary,
      // contiguous region. Palette bytes stay in the upper half in both buffers.
      reference.set(src.subarray(boundary - 16, boundary), 0);
      reference.set(src.subarray(0, 128), 16);
      const tile = {
        format, size, tmem: (boundary - 16) / 8, line: 2, palette: 7,
        // The first row crosses the boundary; 4-bit formats also have an odd tail.
        width: [43, 21, 11, 6][size],
        height: 3,
      };
      const actual = imageData(tile);
      const expected = imageData(tile);
      expect(convertTexels(actual, src, tile, gbi.TextureLUT.G_TT_RGBA16)).toBe(true);
      expect(convertTexels(expected, reference, { ...tile, tmem: 0 }, gbi.TextureLUT.G_TT_RGBA16)).toBe(true);
      expect(actual.data).toEqual(expected.data);
    });
  }

  test('CI texel addresses in the upper half alias the lower half, with an IA16 palette', () => {
    const src = new Uint8Array(4096);
    src[0] = 0x7f;
    src[0x800 + 0x7f * 8] = 0xab;
    src[0x800 + 0x7f * 8 + 1] = 0xcd;
    const tile = { format: gbi.ImageFormat.G_IM_FMT_CI, size: gbi.ImageSize.G_IM_SIZ_8b,
      tmem: 256, line: 1, width: 1, height: 1, palette: 0 };
    const dst = { width: 1, data: new Uint8ClampedArray(4) };
    expect(convertTexels(dst, src, tile, gbi.TextureLUT.G_TT_IA16)).toBe(true);
    expect(Array.from(dst.data)).toEqual([0xab, 0xab, 0xab, 0xcd]);
  });
});
