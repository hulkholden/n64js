import * as gbi from '../gbi.js';

const kOneToEight = [
  0x00, // 0 -> 00 00 00 00
  0xff, // 1 -> 11 11 11 11
];

const kThreeToEight = [
  0x00, // 000 -> 00 00 00 00
  0x24, // 001 -> 00 10 01 00
  0x49, // 010 -> 01 00 10 01
  0x6d, // 011 -> 01 10 11 01
  0x92, // 100 -> 10 01 00 10
  0xb6, // 101 -> 10 11 01 10
  0xdb, // 110 -> 11 01 10 11
  0xff, // 111 -> 11 11 11 11
];

const kFourToEight = [
  0x00, 0x11, 0x22, 0x33,
  0x44, 0x55, 0x66, 0x77,
  0x88, 0x99, 0xaa, 0xbb,
  0xcc, 0xdd, 0xee, 0xff,
];

const kFiveToEight = [
  0x00, // 00000 -> 00000000
  0x08, // 00001 -> 00001000
  0x10, // 00010 -> 00010000
  0x18, // 00011 -> 00011000
  0x21, // 00100 -> 00100001
  0x29, // 00101 -> 00101001
  0x31, // 00110 -> 00110001
  0x39, // 00111 -> 00111001
  0x42, // 01000 -> 01000010
  0x4a, // 01001 -> 01001010
  0x52, // 01010 -> 01010010
  0x5a, // 01011 -> 01011010
  0x63, // 01100 -> 01100011
  0x6b, // 01101 -> 01101011
  0x73, // 01110 -> 01110011
  0x7b, // 01111 -> 01111011

  0x84, // 10000 -> 10000100
  0x8c, // 10001 -> 10001100
  0x94, // 10010 -> 10010100
  0x9c, // 10011 -> 10011100
  0xa5, // 10100 -> 10100101
  0xad, // 10101 -> 10101101
  0xb5, // 10110 -> 10110101
  0xbd, // 10111 -> 10111101
  0xc6, // 11000 -> 11000110
  0xce, // 11001 -> 11001110
  0xd6, // 11010 -> 11010110
  0xde, // 11011 -> 11011110
  0xe7, // 11100 -> 11100111
  0xef, // 11101 -> 11101111
  0xf7, // 11110 -> 11110111
  0xff, // 11111 -> 11111111
];

/**
 * Converts an IA16 pixel to the native RGBA format.
 * @param {number} value An IA16 value
 * @return {number}
 */
function convertIA16Pixel(value) {
  var i = (value >>> 8) & 0xff;
  let a = (value) & 0xff;

  return (i << 24) | (i << 16) | (i << 8) | a;
}

/**
 * Converts an RGBA16 pixel to the native RGBA format.
 * @param {number} value An IA16 value
 * @return {number}
 */
function convertRGBA16Pixel(value) {
  let r = kFiveToEight[(value >>> 11) & 0x1f];
  let g = kFiveToEight[(value >>> 6) & 0x1f];
  let b = kFiveToEight[(value >>> 1) & 0x1f];
  let a = (value & 0x01) ? 255 : 0;

  return (r << 24) | (g << 16) | (b << 8) | a;
}

/**
 * Converts N64 RGBA32 texels to the native RGBA format.
 * @param {!ImageData} dstData
 * @param {!Uint8Array} src
 * @param {!Tile} tile
 */
function convertRGBA32(dstData, src, tile) {
  let dst = dstData.data;
  let dstRowStride = dstData.width * 4; // Might not be the same as width, due to power of 2
  let dstRowOffset = 0;

  let srcRowStride = tile.line << 3;
  let srcRowOffset = tile.tmem << 3;

  // NB! RGBA/32 line needs to be doubled.
  srcRowStride *= 2;

  let rowSwizzle = 0;
  for (let y = 0; y < tile.height; ++y) {
    let srcOffset = srcRowOffset;
    let dstOffset = dstRowOffset;

    for (let x = 0; x < tile.width; ++x) {
      let index = srcOffset ^ rowSwizzle;

      dst[dstOffset + 0] = src[index];
      dst[dstOffset + 1] = src[index + 1];
      dst[dstOffset + 2] = src[index + 2];
      dst[dstOffset + 3] = src[index + 3];

      srcOffset += 4;
      dstOffset += 4;
    }
    srcRowOffset += srcRowStride;
    dstRowOffset += dstRowStride;

    rowSwizzle ^= 0x4; // Alternate lines are word-swapped
  }
}

/**
 * Converts N64 RGBA16 texels to the native RGBA format.
 * @param {!ImageData} dstData
 * @param {!Uint8Array} src
 * @param {!Tile} tile
 */
function convertRGBA16(dstData, src, tile) {
  let dst = dstData.data;
  let dstRowStride = dstData.width * 4; // Might not be the same as width, due to power of 2
  let dstRowOffset = 0;

  let srcRowStride = tile.line << 3;
  let srcRowOffset = tile.tmem << 3;

  let rowSwizzle = 0;
  for (let y = 0; y < tile.height; ++y) {
    let srcOffset = srcRowOffset;
    let dstOffset = dstRowOffset;

    for (let x = 0; x < tile.width; ++x) {
      let index = srcOffset ^ rowSwizzle;
      let srcPixel = (src[index] << 8) | src[index + 1];

      dst[dstOffset + 0] = kFiveToEight[(srcPixel >>> 11) & 0x1f];
      dst[dstOffset + 1] = kFiveToEight[(srcPixel >>> 6) & 0x1f];
      dst[dstOffset + 2] = kFiveToEight[(srcPixel >>> 1) & 0x1f];
      dst[dstOffset + 3] = (srcPixel & 0x01) ? 255 : 0;

      srcOffset += 2;
      dstOffset += 4;
    }
    srcRowOffset += srcRowStride;
    dstRowOffset += dstRowStride;

    rowSwizzle ^= 0x4; // Alternate lines are word-swapped
  }
}

/**
 * Converts N64 IA16 texels to the native RGBA format.
 * @param {!ImageData} dstData
 * @param {!Uint8Array} src
 * @param {!Tile} tile
 */
function convertIA16(dstData, src, tile) {
  let dst = dstData.data;
  let dstRowStride = dstData.width * 4; // Might not be the same as width, due to power of 2
  let dstRowOffset = 0;

  let srcRowStride = tile.line << 3;
  let srcRowOffset = tile.tmem << 3;

  let rowSwizzle = 0;
  for (let y = 0; y < tile.height; ++y) {
    let srcOffset = srcRowOffset;
    let dstOffset = dstRowOffset;

    for (let x = 0; x < tile.width; ++x) {
      let index = srcOffset ^ rowSwizzle;
      let i = src[index];
      let a = src[index + 1];

      dst[dstOffset + 0] = i;
      dst[dstOffset + 1] = i;
      dst[dstOffset + 2] = i;
      dst[dstOffset + 3] = a;

      srcOffset += 2;
      dstOffset += 4;
    }
    srcRowOffset += srcRowStride;
    dstRowOffset += dstRowStride;

    rowSwizzle ^= 0x4; // Alternate lines are word-swapped
  }
}

/**
 * Converts N64 IA8 texels to the native RGBA format.
 * @param {!ImageData} dstData
 * @param {!Uint8Array} src
 * @param {!Tile} tile
 */
function convertIA8(dstData, src, tile) {
  let dst = dstData.data;
  let dstRowStride = dstData.width * 4; // Might not be the same as width, due to power of 2
  let dstRowOffset = 0;

  let srcRowStride = tile.line << 3;
  let srcRowOffset = tile.tmem << 3;

  let rowSwizzle = 0;
  for (let y = 0; y < tile.height; ++y) {
    let srcOffset = srcRowOffset;
    let dstOffset = dstRowOffset;

    for (let x = 0; x < tile.width; ++x) {
      let index = srcOffset ^ rowSwizzle;
      let srcPixel = src[index];

      let i = kFourToEight[(srcPixel >>> 4) & 0xf];
      let a = kFourToEight[srcPixel & 0xf];

      dst[dstOffset + 0] = i;
      dst[dstOffset + 1] = i;
      dst[dstOffset + 2] = i;
      dst[dstOffset + 3] = a;

      srcOffset += 1;
      dstOffset += 4;
    }
    srcRowOffset += srcRowStride;
    dstRowOffset += dstRowStride;

    rowSwizzle ^= 0x4; // Alternate lines are word-swapped
  }
}

/**
 * Converts N64 IA4 texels to the native RGBA format.
 * @param {!ImageData} dstData
 * @param {!Uint8Array} src
 * @param {!Tile} tile
 */
function convertIA4(dstData, src, tile) {
  let dst = dstData.data;
  let dstRowStride = dstData.width * 4; // Might not be the same as width, due to power of 2
  let dstRowOffset = 0;

  let srcRowStride = tile.line << 3;
  let srcRowOffset = tile.tmem << 3;

  let rowSwizzle = 0;

  for (let y = 0; y < tile.height; ++y) {
    let srcOffset = srcRowOffset;
    let dstOffset = dstRowOffset;

    // Process 2 pixels at a time
    for (let x = 0; x + 1 < tile.width; x += 2) {
      let index = srcOffset ^ rowSwizzle;
      let srcPixel = src[index];

      let i0 = kThreeToEight[(srcPixel & 0xe0) >>> 5];
      let a0 = kOneToEight[(srcPixel & 0x10) >>> 4];

      let i1 = kThreeToEight[(srcPixel & 0x0e) >>> 1];
      let a1 = kOneToEight[(srcPixel & 0x01) >>> 0];

      dst[dstOffset + 0] = i0;
      dst[dstOffset + 1] = i0;
      dst[dstOffset + 2] = i0;
      dst[dstOffset + 3] = a0;

      dst[dstOffset + 4] = i1;
      dst[dstOffset + 5] = i1;
      dst[dstOffset + 6] = i1;
      dst[dstOffset + 7] = a1;

      srcOffset += 1;
      dstOffset += 8;
    }

    // Handle trailing pixel, if odd width
    if (tile.width & 1) {
      let index = srcOffset ^ rowSwizzle;
      let srcPixel = src[index];

      let i0 = kThreeToEight[(srcPixel & 0xe0) >>> 5];
      let a0 = kOneToEight[(srcPixel & 0x10) >>> 4];

      dst[dstOffset + 0] = i0;
      dst[dstOffset + 1] = i0;
      dst[dstOffset + 2] = i0;
      dst[dstOffset + 3] = a0;

      srcOffset += 1;
      dstOffset += 4;
    }

    srcRowOffset += srcRowStride;
    dstRowOffset += dstRowStride;

    rowSwizzle ^= 0x4; // Alternate lines are word-swapped
  }
}

/**
 * Converts N64 I8 texels to the native RGBA format.
 * @param {!ImageData} dstData
 * @param {!Uint8Array} src
 * @param {!Tile} tile
 */
function convertI8(dstData, src, tile) {
  let dst = dstData.data;
  let dstRowStride = dstData.width * 4; // Might not be the same as width, due to power of 2
  let dstRowOffset = 0;

  let srcRowStride = tile.line << 3;
  let srcRowOffset = tile.tmem << 3;

  let rowSwizzle = 0;
  for (let y = 0; y < tile.height; ++y) {
    let srcOffset = srcRowOffset;
    let dstOffset = dstRowOffset;

    for (let x = 0; x < tile.width; ++x) {
      let i = src[srcOffset ^ rowSwizzle];

      dst[dstOffset + 0] = i;
      dst[dstOffset + 1] = i;
      dst[dstOffset + 2] = i;
      dst[dstOffset + 3] = i;

      srcOffset += 1;
      dstOffset += 4;
    }
    srcRowOffset += srcRowStride;
    dstRowOffset += dstRowStride;

    rowSwizzle ^= 0x4; // Alternate lines are word-swapped
  }
}

/**
 * Converts N64 I4 texels to the native RGBA format.
 * @param {!ImageData} dstData
 * @param {!Uint8Array} src
 * @param {!Tile} tile
 */
function convertI4(dstData, src, tile) {
  let dst = dstData.data;
  let dstRowStride = dstData.width * 4; // Might not be the same as width, due to power of 2
  let dstRowOffset = 0;

  let srcRowStride = tile.line << 3;
  let srcRowOffset = tile.tmem << 3;

  let rowSwizzle = 0;

  for (let y = 0; y < tile.height; ++y) {
    let srcOffset = srcRowOffset;
    let dstOffset = dstRowOffset;

    // Process 2 pixels at a time
    for (let x = 0; x + 1 < tile.width; x += 2) {
      let srcPixel = src[srcOffset ^ rowSwizzle];
      let i0 = kFourToEight[(srcPixel & 0xf0) >>> 4];
      let i1 = kFourToEight[(srcPixel & 0x0f) >>> 0];

      dst[dstOffset + 0] = i0;
      dst[dstOffset + 1] = i0;
      dst[dstOffset + 2] = i0;
      dst[dstOffset + 3] = i0;

      dst[dstOffset + 4] = i1;
      dst[dstOffset + 5] = i1;
      dst[dstOffset + 6] = i1;
      dst[dstOffset + 7] = i1;

      srcOffset += 1;
      dstOffset += 8;
    }

    // Handle trailing pixel, if odd width
    if (tile.width & 1) {
      let srcPixel = src[srcOffset ^ rowSwizzle];
      let i0 = kFourToEight[(srcPixel & 0xf0) >>> 4];

      dst[dstOffset + 0] = i0;
      dst[dstOffset + 1] = i0;
      dst[dstOffset + 2] = i0;
      dst[dstOffset + 3] = i0;

      srcOffset += 1;
      dstOffset += 4;
    }

    srcRowOffset += srcRowStride;
    dstRowOffset += dstRowStride;

    rowSwizzle ^= 0x4; // Alternate lines are word-swapped
  }
}

/**
 * Converts N64 CI8 texels to the native RGBA format.
 * @param {!ImageData} dstData
 * @param {!Uint8Array} src
 * @param {!Tile} tile
 * @param {number} palAddress Palette address in src.
 * @param {function(number): number} palConv Palette conversion function.
 */
function convertCI8(dstData, src, tile, palAddress, palConv) {
  let dst = dstData.data;
  let dstRowStride = dstData.width * 4; // Might not be the same as width, due to power of 2
  let dstRowOffset = 0;

  let srcRowStride = tile.line << 3;
  let srcRowOffset = tile.tmem << 3;

  let palOffset = palAddress << 3;
  let pal = new Uint32Array(256);

  for (let i = 0; i < 256; ++i) {
    let srcPixel = (src[palOffset + i * 2 + 0] << 8) | src[palOffset + i * 2 + 1];
    pal[i] = palConv(srcPixel);
  }

  let rowSwizzle = 0;
  for (let y = 0; y < tile.height; ++y) {
    let srcOffset = srcRowOffset;
    let dstOffset = dstRowOffset;

    for (let x = 0; x < tile.width; ++x) {
      let srcPixel = pal[src[srcOffset ^ rowSwizzle]];

      dst[dstOffset + 0] = (srcPixel >> 24) & 0xff;
      dst[dstOffset + 1] = (srcPixel >> 16) & 0xff;
      dst[dstOffset + 2] = (srcPixel >> 8) & 0xff;
      dst[dstOffset + 3] = srcPixel & 0xff;

      srcOffset += 1;
      dstOffset += 4;
    }
    srcRowOffset += srcRowStride;
    dstRowOffset += dstRowStride;

    rowSwizzle ^= 0x4; // Alternate lines are word-swapped
  }
}

/**
 * Converts N64 CI4 texels to the native RGBA format.
 * @param {!ImageData} dstData
 * @param {!Uint8Array} src
 * @param {!Tile} tile
 * @param {number} palAddress Palette address in src.
 * @param {function(number): number} palConv Palette conversion function.
 */
function convertCI4(dstData, src, tile, palAddress, palConv) {
  let dst = dstData.data;
  let dstRowStride = dstData.width * 4; // Might not be the same as width, due to power of 2
  let dstRowOffset = 0;

  let srcRowStride = tile.line << 3;
  let srcRowOffset = tile.tmem << 3;

  let palOffset = palAddress << 3;
  let pal = new Uint32Array(16);

  for (let i = 0; i < 16; ++i) {
    let srcPixel = (src[palOffset + i * 2 + 0] << 8) | src[palOffset + i * 2 + 1];
    pal[i] = palConv(srcPixel);
  }

  let rowSwizzle = 0;

  for (let y = 0; y < tile.height; ++y) {
    let srcOffset = srcRowOffset;
    let dstOffset = dstRowOffset;

    // Process 2 pixels at a time
    for (let x = 0; x + 1 < tile.width; x += 2) {
      let srcPixel = src[srcOffset ^ rowSwizzle];
      let c0 = pal[(srcPixel & 0xf0) >>> 4];
      let c1 = pal[(srcPixel & 0x0f) >>> 0];

      dst[dstOffset + 0] = (c0 >> 24) & 0xff;
      dst[dstOffset + 1] = (c0 >> 16) & 0xff;
      dst[dstOffset + 2] = (c0 >> 8) & 0xff;
      dst[dstOffset + 3] = c0 & 0xff;

      dst[dstOffset + 4] = (c1 >> 24) & 0xff;
      dst[dstOffset + 5] = (c1 >> 16) & 0xff;
      dst[dstOffset + 6] = (c1 >> 8) & 0xff;
      dst[dstOffset + 7] = c1 & 0xff;

      srcOffset += 1;
      dstOffset += 8;
    }

    // Handle trailing pixel, if odd width
    if (tile.width & 1) {
      let srcPixel = src[srcOffset ^ rowSwizzle];
      let c0 = pal[(srcPixel & 0xf0) >>> 4];

      dst[dstOffset + 0] = (c0 >> 24) & 0xff;
      dst[dstOffset + 1] = (c0 >> 16) & 0xff;
      dst[dstOffset + 2] = (c0 >> 8) & 0xff;
      dst[dstOffset + 3] = c0 & 0xff;

      srcOffset += 1;
      dstOffset += 4;
    }

    srcRowOffset += srcRowStride;
    dstRowOffset += dstRowStride;

    rowSwizzle ^= 0x4; // Alternate lines are word-swapped
  }
}

/**
 * Converts N64 texels to the native RGBA format.
 * @param {!ImageData} dstData
 * @param {!Uint8Array} tmem
 * @param {!Tile} tile
 */
export function convertTexels(dstData, tmem, tile, tlutFormat) {
  // NB: assume RGBA16 for G_TT_NONE
  var convFn = (tlutFormat === gbi.TextureLUT.G_TT_IA16) ?
                convertIA16Pixel : convertRGBA16Pixel;

  switch (tile.format) {
    case gbi.ImageFormat.G_IM_FMT_RGBA:
      switch (tile.size) {
        case gbi.ImageSize.G_IM_SIZ_32b:
          convertRGBA32(dstData, tmem, tile);
          return true;
        case gbi.ImageSize.G_IM_SIZ_16b:
          convertRGBA16(dstData, tmem, tile);
          return true;

          // Hack - Extreme-G specifies RGBA/8 RGBA/4 textures, but they're
          // really CI
        case gbi.ImageSize.G_IM_SIZ_8b:
          convertCI8(dstData, tmem, tile, 0x100, convFn);
          return true;
        case gbi.ImageSize.G_IM_SIZ_4b:
          convertCI4(dstData, tmem, tile, 0x100 + ((tile.palette * 16 * 2) >>> 3), convFn);
          return true;
      }
      break;

    case gbi.ImageFormat.G_IM_FMT_IA:
      switch (tile.size) {
        case gbi.ImageSize.G_IM_SIZ_16b:
          convertIA16(dstData, tmem, tile);
          return true;
        case gbi.ImageSize.G_IM_SIZ_8b:
          convertIA8(dstData, tmem, tile);
          return true;
        case gbi.ImageSize.G_IM_SIZ_4b:
          convertIA4(dstData, tmem, tile);
          return true;
      }
      break;

    case gbi.ImageFormat.G_IM_FMT_I:
      switch (tile.size) {
        case gbi.ImageSize.G_IM_SIZ_8b:
          convertI8(dstData, tmem, tile);
          return true;
        case gbi.ImageSize.G_IM_SIZ_4b:
          convertI4(dstData, tmem, tile);
          return true;
      }
      break;

    case gbi.ImageFormat.G_IM_FMT_CI:
      switch (tile.size) {
        case gbi.ImageSize.G_IM_SIZ_8b:
          convertCI8(dstData, tmem, tile, 0x100, convFn);
          return true;
        case gbi.ImageSize.G_IM_SIZ_4b:
          convertCI4(dstData, tmem, tile, 0x100 + ((tile.palette * 16 * 2) >>> 3), convFn);
          return true;
      }
      break;
  }

  return false;
}
