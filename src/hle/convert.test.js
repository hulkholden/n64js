import { describe, expect, test } from 'bun:test';
import { convertTexels } from './convert.js';
import * as gbi from './gbi.js';

const formats = [
  ['YUV16', gbi.ImageFormat.G_IM_FMT_YUV, gbi.ImageSize.G_IM_SIZ_16b, 2048],
  ['RGBA32', gbi.ImageFormat.G_IM_FMT_RGBA, gbi.ImageSize.G_IM_SIZ_32b, 2048],
  ['RGBA16', gbi.ImageFormat.G_IM_FMT_RGBA, gbi.ImageSize.G_IM_SIZ_16b, 4096],
  ['IA16', gbi.ImageFormat.G_IM_FMT_IA, gbi.ImageSize.G_IM_SIZ_16b, 4096],
  ['IA8', gbi.ImageFormat.G_IM_FMT_IA, gbi.ImageSize.G_IM_SIZ_8b, 4096],
  ['IA4', gbi.ImageFormat.G_IM_FMT_IA, gbi.ImageSize.G_IM_SIZ_4b, 4096],
  ['I8', gbi.ImageFormat.G_IM_FMT_I, gbi.ImageSize.G_IM_SIZ_8b, 4096],
  ['I4', gbi.ImageFormat.G_IM_FMT_I, gbi.ImageSize.G_IM_SIZ_4b, 4096],
  ['CI8', gbi.ImageFormat.G_IM_FMT_CI, gbi.ImageSize.G_IM_SIZ_8b, 2048],
  ['CI4', gbi.ImageFormat.G_IM_FMT_CI, gbi.ImageSize.G_IM_SIZ_4b, 2048],
  ['RGBA8', gbi.ImageFormat.G_IM_FMT_RGBA, gbi.ImageSize.G_IM_SIZ_8b, 4096],
  ['RGBA4', gbi.ImageFormat.G_IM_FMT_RGBA, gbi.ImageSize.G_IM_SIZ_4b, 4096],
];

describe('TMEM texel wrapping', () => {
  for (const [name, format, size, boundary] of formats) {
    test(`${name} wraps within rows and across swizzled rows`, () => {
      const src = Uint8Array.from({ length: 4096 }, (_, i) => (i * 37 + (i >>> 8) * 13) & 0xff);
      const reference = src.slice();
      // Relocate the end of TMEM and the following wrapped bytes to one ordinary,
      // contiguous region. Palette bytes stay in the upper half in both buffers.
      reference.set(src.subarray(boundary - 16, boundary), 0);
      reference.set(src.subarray(0, 128), 16);
      if (name === 'YUV16' || name === 'RGBA32') {
        reference.set(src.subarray(4096 - 16, 4096), 2048);
        reference.set(src.subarray(2048, 2048 + 128), 2048 + 16);
      }
      const tile = {
        format, size, tmem: (boundary - 16) / 8, line: 2, palette: 7,
        // The first row crosses the boundary; 4-bit formats also have an odd tail.
        width: [43, 21, 11, 6][size],
        height: 3,
      };
      // Include padding so a trailing 4-bit texel must not overwrite the next pixel.
      const dstWidth = tile.width + 3;
      const actual = new Uint8ClampedArray(dstWidth * tile.height * 4).fill(0x55);
      const expected = actual.slice();
      expect(convertTexels(actual, dstWidth, src, tile, gbi.TextureLUT.G_TT_NONE)).toBe(true);
      expect(convertTexels(expected, dstWidth, reference, { ...tile, tmem: 0 }, gbi.TextureLUT.G_TT_NONE)).toBe(true);
      expect(actual).toEqual(expected);
    });
  }

  test('CI texel addresses in the upper half alias the lower half, with an IA16 palette', () => {
    const src = new Uint8Array(4096);
    src[0] = 0x7f;
    src[0x800 + 0x7f * 8] = 0xab;
    src[0x800 + 0x7f * 8 + 1] = 0xcd;
    const tile = { format: gbi.ImageFormat.G_IM_FMT_CI, size: gbi.ImageSize.G_IM_SIZ_8b,
      tmem: 256, line: 1, width: 1, height: 1, palette: 0 };
    const dst = new Uint8ClampedArray(4);
    expect(convertTexels(dst, 1, src, tile, gbi.TextureLUT.G_TT_IA16)).toBe(true);
    expect(Array.from(dst)).toEqual([0xab, 0xab, 0xab, 0xcd]);
  });
});

// Verify every packed-table entry against bit replication, including nonzero
// aligned destination offsets and row padding.
for (const [name, format] of [['RGBA16', gbi.ImageFormat.G_IM_FMT_RGBA], ['IA16', gbi.ImageFormat.G_IM_FMT_IA]]) {
  test(`${name} packed conversion preserves every colour and alpha bit`, () => {
    const src = new Uint8Array(4096);
    const tile = { format, size: gbi.ImageSize.G_IM_SIZ_16b,
      width: 512, height: 4, line: 128, tmem: 0 };
    const stride = (tile.width + 1) * 4;
    for (const offset of [0, 4]) {
      for (let base = 0; base < 65536; base += 2048) {
        const data = new Uint8Array(new ArrayBuffer(stride * tile.height + offset), offset).fill(0x55);
        const expected = data.slice();
        for (let y = 0; y < tile.height; y++) {
          for (let x = 0; x < tile.width; x++) {
            const value = base + y * tile.width + x;
            const index = ((y * tile.width + x) * 2) ^ ((y & 1) << 2);
            src[index] = value >>> 8;
            src[index + 1] = value & 255;
            const r = (value >>> 11) & 31, g = (value >>> 6) & 31, b = (value >>> 1) & 31;
            expected.set(format === gbi.ImageFormat.G_IM_FMT_IA
              ? [value >>> 8, value >>> 8, value >>> 8, value & 255]
              : [(r << 3) | (r >>> 2), (g << 3) | (g >>> 2), (b << 3) | (b >>> 2), (value & 1) * 255],
            y * stride + x * 4);
          }
        }
        expect(convertTexels(data, tile.width + 1, src, tile, 0)).toBe(true);
        expect(data).toEqual(expected);
      }
    }
  });
}

test('RGBA16 repeating TMEM rows match scalar conversion and preserve destination padding', () => {
  const src = Uint8Array.from({ length: 4096 }, (_, i) => (i * 37 + (i >>> 8) * 13) & 255);
  for (const line of [0, 1, 16, 64, 256, 511]) {
    for (const padding of [0, 3]) {
      const tile = { format: gbi.ImageFormat.G_IM_FMT_RGBA, size: gbi.ImageSize.G_IM_SIZ_16b,
        width: 505, height: 233, line, tmem: 509 };
      const width = tile.width + padding;
      const data = Uint8Array.from({ length: width * tile.height * 4 }, (_, i) => i & 255);
      // Compare the repeated rows with an independent scalar decoder.
      const reference = data.slice();
      convertTexels(data, width, src, tile, 0);
      referenceTexels(reference, width, src, tile, 0);
      expect(data).toEqual(reference);
    }
  }
});

// Deliberately expand one pixel at a time, without packed writes, lookup tables,
// or row-period copies, to check the optimized converters independently.
function referenceTexels(dstData, dstWidth, src, tile, tlutFormat) {
  const palette = tile.size < 2 && (tile.format === gbi.ImageFormat.G_IM_FMT_CI ||
    (tlutFormat !== 0 && (tile.format === gbi.ImageFormat.G_IM_FMT_RGBA ||
      tile.format === gbi.ImageFormat.G_IM_FMT_IA || tile.format === gbi.ImageFormat.G_IM_FMT_I)));
  const rgba32 = tile.format === gbi.ImageFormat.G_IM_FMT_RGBA && tile.size === 3;
  const yuv = tile.format === gbi.ImageFormat.G_IM_FMT_YUV;
  const stride = tile.line * 8;
  const mask = palette ? 0x7ff : 0xfff;
  const expand5 = v => (v << 3) | (v >>> 2);
  const rgba16 = v => [expand5(v >>> 11), expand5((v >>> 6) & 31), expand5((v >>> 1) & 31), (v & 1) * 255];
  const ia16 = v => [v >>> 8, v >>> 8, v >>> 8, v & 255];
  for (let y = 0; y < tile.height; y++) {
    const row = tile.tmem * 8 + y * stride;
    const swizzle = (y & 1) * 4;
    for (let x = 0; x < tile.width; x++) {
      const address = ((row + Math.floor(x * (4 << tile.size) / 8)) ^ swizzle) & mask;
      const value = tile.size === 0 ? (src[address] >>> ((x & 1) ? 0 : 4)) & 15
        : tile.size === 2 ? src[address] * 256 + src[(address + 1) & mask] : src[address];
      let pixel;
      if (palette) {
        const index = tile.size === 0 ? tile.palette * 16 + value : value;
        const entry = src[0x800 + index * 8] * 256 + src[0x801 + index * 8];
        pixel = tlutFormat === gbi.TextureLUT.G_TT_IA16 ? ia16(entry) : rgba16(entry);
      } else if (rgba32) {
        const rg = ((row + x * 2) ^ swizzle) & 2047;
        pixel = [src[rg], src[rg + 1], src[rg + 2048], src[rg + 2049]];
      } else if (yuv) {
        const chroma = ((row + x - (x % 2)) ^ swizzle) & 2047;
        const luma = ((row + x) ^ swizzle) & 2047;
        pixel = [src[chroma], src[chroma + 1], src[luma + 2048], 255];
      } else if (tile.format === gbi.ImageFormat.G_IM_FMT_RGBA && tile.size === 2) {
        pixel = rgba16(value);
      } else if (tile.format === gbi.ImageFormat.G_IM_FMT_I || tile.format === gbi.ImageFormat.G_IM_FMT_RGBA) {
        pixel = Array(4).fill(tile.size === 0 ? value * 17 : value);
      } else if (tile.size === 2) {
        pixel = ia16(value);
      } else {
        const i = tile.size === 1 ? (value >>> 4) * 17 : ((value >>> 1) << 5) | ((value >>> 1) << 2) | (value >>> 2);
        const a = tile.size === 1 ? (value & 15) * 17 : (value & 1) * 255;
        pixel = [i, i, i, a];
      }
      dstData.set(pixel, (y * dstWidth + x) * 4);
    }
  }
}

for (const [name, format, size, boundary] of formats) {
  test(`${name} packed output matches scalar pixels with wrapping, odd widths, padding and aligned byte views`, () => {
    for (const [width, height, line] of [[13, 5, 1], [5, 65, 256], [64, 64, 8]]) {
      for (const tlut of [gbi.TextureLUT.G_TT_NONE, gbi.TextureLUT.G_TT_RGBA16, gbi.TextureLUT.G_TT_IA16]) {
        for (const [offset, palette] of [[0, 0], [4, 7], [8, 15]]) {
          const src = new Uint8Array(new ArrayBuffer(4096 + offset), offset, 4096);
          src.set(Uint8Array.from({ length: 4096 }, (_, i) => (i * 37 + (i >>> 8) * 13) & 255));
          const tile = { format, size, line, tmem: (boundary - 8) / 8,
            width, height, palette };
          const stride = width + 3;
          const length = stride * height * 4;
          const storage = new Uint8Array(length + offset + 8).fill(0x77);
          const data = new Uint8ClampedArray(storage.buffer, offset, length);
          data.set(Uint8Array.from({ length }, (_, i) => (i * 13) & 255));
          const expected = new Uint8Array(data);
          referenceTexels(expected, stride, src, tile, tlut);
          expect(convertTexels(data, stride, src, tile, tlut)).toBe(true);
          expect(Array.from(data)).toEqual(Array.from(expected));
          expect(Array.from(storage.slice(0, offset))).toEqual(Array(offset).fill(0x77));
          expect(Array.from(storage.slice(-8))).toEqual(Array(8).fill(0x77));
        }
      }
    }
  });
}

test('4/8-bit RGBA, IA and I without TLUT expand every possible source value', () => {
  for (const [format, size] of [[0, 1], [0, 0], [3, 1], [3, 0], [4, 1], [4, 0]]) {
    const src = new Uint8Array(4096);
    for (let i = 0; i < 256; i++) src[i] = i;
    const tile = { format, size, width: size === 0 ? 512 : 256, height: 1, line: 32, tmem: 0 };
    const actual = new Uint8Array(tile.width * 4);
    const expected = actual.slice();
    referenceTexels(expected, tile.width, src, tile, 0);
    convertTexels(actual, tile.width, src, tile, 0);
    expect(actual).toEqual(expected);
  }
});
