// CPU decoding is used only for debugger previews and independent test references.
import { assert } from '../assert.js';
import * as gbi from './gbi.js';
import { convertRGBA16Pixel, getTexturePaletteFormat } from './texture_format.js';

const kTMEMAddressMask = 0xfff;
// CI indices occupy the lower half of TMEM; the upper half contains the TLUT.
const kCIAddressMask = 0x7ff;

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

// Write table entries through bytes so the resulting Uint32 values have the
// host byte order needed for one packed store into RGBA output.
function pixelTable(count, convert) {
  const table = new Uint32Array(count);
  const bytes = new Uint8Array(table.buffer);
  for (let value = 0; value < count; value++) {
    const rgba = convert(value);
    bytes[value * 4 + 0] = rgba >>> 24;
    bytes[value * 4 + 1] = rgba >>> 16;
    bytes[value * 4 + 2] = rgba >>> 8;
    bytes[value * 4 + 3] = rgba;
  }
  return table;
}

const rgba16Pixels = pixelTable(65536, convertRGBA16Pixel);
const ia16Pixels = pixelTable(65536, convertIA16Pixel);
const ia8Pixels = pixelTable(256, value =>
  convertIA16Pixel((kFourToEight[value >>> 4] << 8) | kFourToEight[value & 15]));
const ia4Pixels = pixelTable(16, value =>
  convertIA16Pixel((kThreeToEight[value >>> 1] << 8) | kOneToEight[value & 1]));
const i8Pixels = pixelTable(256, value => value * 0x01010101);
const i4Pixels = pixelTable(16, value => kFourToEight[value] * 0x01010101);

// Converted CI palettes use the same native-endian packed representation.
const tempPal = new Uint32Array(256);

function packedOutput(data) {
  return new Uint32Array(data.buffer, data.byteOffset, data.byteLength >>> 2);
}

/**
 * Converts an IA16 pixel to the native RGBA format.
 * @param {number} value An IA16 value
 * @return {number}
 */
export function convertIA16Pixel(value) {
  const i = (value >>> 8) & 0xff;
  const a = (value) & 0xff;

  return (i << 24) | (i << 16) | (i << 8) | a;
}

/**
 * Converts N64 RGBA32 texels to the native RGBA format.
 * @param {!(Uint8Array|Uint8ClampedArray)} dstData RGBA output bytes.
 * @param {number} dstWidth Destination row width in pixels, including padding.
 * @param {!Uint8Array} src
 * @param {!Tile} tile
 */
function convertRGBA32(dstData, dstWidth, src, tile) {
  const width = tile.width;
  const height = tile.height;
  const stride = tile.line << 3;
  let row = tile.tmem << 3;
  let out = 0;
  for (let y = 0; y < height; y++) {
    const swizzle = (y & 1) << 2;
    for (let x = 0; x < width; x++) {
      const address = ((row + x * 2) ^ swizzle) & 0x7ff;
      const dst = out + x * 4;
      dstData[dst + 0] = src[address];
      dstData[dst + 1] = src[address + 1];
      dstData[dst + 2] = src[address | 0x800];
      dstData[dst + 3] = src[(address | 0x800) + 1];
    }
    row += stride;
    out += dstWidth * 4;
  }
}

/**
 * Converts N64 16-bit texels using a native-endian packed colour table.
 * @param {!(Uint8Array|Uint8ClampedArray)} dstData RGBA output bytes.
 * @param {number} dstWidth Destination row width in pixels, including padding.
 * @param {!Uint8Array} src
 * @param {!Tile} tile
 * @param {!Uint32Array} pixels Native-endian RGBA expansion table.
 */
function convert16b(dstData, dstWidth, src, tile, pixels) {
  const dst = packedOutput(dstData);
  const width = tile.width;
  const height = tile.height;
  const stride = tile.line << 3;
  // TMEM wraps after 4 KiB. Once both the row address and odd-row swizzle
  // repeat, the remaining rows are identical. Tetrisphere's intro uses tall
  // tiles with a small stride, so decode one period and copy the rest.
  const rowPeriod = stride ? Math.max(2, 4096 / (stride & -stride)) : 2;
  const decodedRows = Math.min(height, rowPeriod);
  let row = tile.tmem << 3;
  let out = 0;
  for (let y = 0; y < decodedRows; y++) {
    const swizzle = (y & 1) << 2;
    for (let x = 0; x < width; x++) {
      const index = ((row + x * 2) ^ swizzle) & kTMEMAddressMask;
      dst[out + x] = pixels[(src[index] << 8) | src[index + 1]];
    }
    row += stride;
    out += dstWidth;
  }
  if (dstWidth === width) {
    for (let rows = decodedRows; rows < height; rows *= 2) {
      dst.copyWithin(rows * width, 0, Math.min(rows, height - rows) * width);
    }
  } else {
    // Preserve padding when the destination rows are wider than the tile.
    for (let y = decodedRows; y < height; y++) {
      const source = (y % decodedRows) * dstWidth;
      dst.copyWithin(y * dstWidth, source, source + width);
    }
  }
}

// Keep YUV samples as U,V,Y,255 in the host texture. The shader applies SetConvert
// after sampling, so changing coefficients does not require decoding it again.
// TMEM holds UV pairs in its lower half and the corresponding Y bytes above.
// The shader restores the YUV alpha (Y) after sampling; opaque storage also
// preserves chroma in debug canvas previews.
function convertYUV16(dstData, dstWidth, src, tile) {
  const width = tile.width;
  const height = tile.height;
  for (let y = 0; y < height; y++) {
    const row = (tile.tmem << 3) + y * (tile.line << 3);
    const swizzle = (y & 1) ? 4 : 0;
    for (let x = 0; x < width; x++) {
      const pair = ((row + (x & ~1)) ^ swizzle) & 0x7ff;
      const luma = src[(((row + x) ^ swizzle) & 0x7ff) | 0x800];
      const dst = (y * dstWidth + x) * 4;
      dstData[dst + 0] = src[pair];
      dstData[dst + 1] = src[pair + 1];
      dstData[dst + 2] = luma;
      dstData[dst + 3] = 255;
    }
  }
}

// Intensity, intensity/alpha and CI formats share their addressing and only
// differ in the table used to expand each texel. CI indices wrap at 2 KiB.
function convert8b(dstData, dstWidth, src, tile, pixels, addressMask = kTMEMAddressMask) {
  const dst = packedOutput(dstData);
  const width = tile.width;
  const height = tile.height;
  const stride = tile.line << 3;
  let row = tile.tmem << 3;
  let out = 0;
  for (let y = 0; y < height; y++) {
    const swizzle = (y & 1) << 2;
    for (let x = 0; x < width; x++) {
      dst[out + x] = pixels[src[((row + x) ^ swizzle) & addressMask]];
    }
    row += stride;
    out += dstWidth;
  }
}

function convert4b(dstData, dstWidth, src, tile, pixels, addressMask = kTMEMAddressMask) {
  const dst = packedOutput(dstData);
  const width = tile.width;
  const height = tile.height;
  const stride = tile.line << 3;
  let row = tile.tmem << 3;
  let out = 0;
  for (let y = 0; y < height; y++) {
    const swizzle = (y & 1) << 2;
    let x = 0;
    for (; x + 1 < width; x += 2) {
      const value = src[((row + (x >>> 1)) ^ swizzle) & addressMask];
      dst[out + x] = pixels[value >>> 4];
      dst[out + x + 1] = pixels[value & 15];
    }
    // An odd final texel consumes only the high nibble, preserving row padding.
    if (x < width) {
      const value = src[((row + (x >>> 1)) ^ swizzle) & addressMask];
      dst[out + x] = pixels[value >>> 4];
    }
    row += stride;
    out += dstWidth;
  }
}

function convertPalette(src, palette, count, pixels) {
  // TLUT entries are replicated across four banks. Match the existing decoder
  // by sampling bank zero, starting at the selected 16-entry palette for CI4.
  let offset = 0x800 + palette * 16 * 8;
  for (let i = 0; i < count; i++, offset += 8) {
    tempPal[i] = pixels[(src[offset] << 8) | src[offset + 1]];
  }
  return tempPal;
}

function convertCI8(dstData, dstWidth, src, tile, pixels) {
  convert8b(dstData, dstWidth, src, tile, convertPalette(src, 0, 256, pixels), kCIAddressMask);
}

function convertCI4(dstData, dstWidth, src, tile, pixels) {
  convert4b(dstData, dstWidth, src, tile, convertPalette(src, tile.palette, 16, pixels), kCIAddressMask);
}

/**
 * Converts N64 texels to the native RGBA format.
 * Source and destination views must start on 4-byte boundaries for packed access.
 * @param {!(Uint8Array|Uint8ClampedArray)} dstData RGBA output bytes.
 * @param {number} dstWidth Destination row width in pixels, including padding.
 * @param {!Uint8Array} tmem
 * @param {!Tile} tile
 * @param {number} tlutFormat
 * @return {boolean} Whether the texture format was handled.
 */
export function convertTexels(dstData, dstWidth, tmem, tile, tlutFormat) {
  assert((dstData.byteOffset & 3) === 0, 'Texture output must be 4-byte aligned');
  assert((tmem.byteOffset & 3) === 0, 'TMEM must be 4-byte aligned');

  const paletteFormat = getTexturePaletteFormat(tile, tlutFormat);
  if (paletteFormat !== gbi.TextureLUT.G_TT_NONE) {
    const pixels = paletteFormat === gbi.TextureLUT.G_TT_IA16 ? ia16Pixels : rgba16Pixels;
    if (tile.size === gbi.ImageSize.G_IM_SIZ_4b) {
      convertCI4(dstData, dstWidth, tmem, tile, pixels);
    } else {
      convertCI8(dstData, dstWidth, tmem, tile, pixels);
    }
    return true;
  }

  switch (tile.format) {
    case gbi.ImageFormat.G_IM_FMT_YUV:
      if (tile.size === gbi.ImageSize.G_IM_SIZ_16b) {
        convertYUV16(dstData, dstWidth, tmem, tile);
        return true;
      }
      break;
    case gbi.ImageFormat.G_IM_FMT_RGBA:
      switch (tile.size) {
        case gbi.ImageSize.G_IM_SIZ_32b:
          convertRGBA32(dstData, dstWidth, tmem, tile);
          return true;
        case gbi.ImageSize.G_IM_SIZ_16b:
          convert16b(dstData, dstWidth, tmem, tile, rgba16Pixels);
          return true;
        // With TLUT disabled, RGBA4/8 replicate intensity into all channels.
        case gbi.ImageSize.G_IM_SIZ_8b:
          convert8b(dstData, dstWidth, tmem, tile, i8Pixels);
          return true;
        case gbi.ImageSize.G_IM_SIZ_4b:
          convert4b(dstData, dstWidth, tmem, tile, i4Pixels);
          return true;
      }
      break;

    case gbi.ImageFormat.G_IM_FMT_IA:
      switch (tile.size) {
        case gbi.ImageSize.G_IM_SIZ_16b:
          convert16b(dstData, dstWidth, tmem, tile, ia16Pixels);
          return true;
        case gbi.ImageSize.G_IM_SIZ_8b:
          convert8b(dstData, dstWidth, tmem, tile, ia8Pixels);
          return true;
        case gbi.ImageSize.G_IM_SIZ_4b:
          convert4b(dstData, dstWidth, tmem, tile, ia4Pixels);
          return true;
      }
      break;

    case gbi.ImageFormat.G_IM_FMT_I:
      switch (tile.size) {
        case gbi.ImageSize.G_IM_SIZ_8b:
          convert8b(dstData, dstWidth, tmem, tile, i8Pixels);
          return true;
        case gbi.ImageSize.G_IM_SIZ_4b:
          convert4b(dstData, dstWidth, tmem, tile, i4Pixels);
          return true;
      }
      break;
  }

  return false;
}

// Previews show the tile's current bounds; rendering reads physical TMEM directly.
export function decodeTile(tmem, tile, tlutFormat) {
  if (tile.format < 0 || !tile.width || !tile.height) {
    return null;
  }
  const pixels = new Uint8Array(tile.width * tile.height * 4);
  if (!convertTexels(pixels, tile.width, tmem.tmemData, tile, tlutFormat)) {
    return null;
  }
  return { width: tile.width, height: tile.height, pixels };
}

export function createTilePreview(tmem, tile, tlutFormat, scale = 1) {
  const decoded = decodeTile(tmem, tile, tlutFormat);
  if (!decoded) {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = decoded.width * scale;
  canvas.height = decoded.height * scale;
  canvas.style.backgroundColor = 'black';
  const context = canvas.getContext('2d');
  const image = context.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const source = (Math.floor(y / scale) * decoded.width + Math.floor(x / scale)) * 4;
      image.data.set(decoded.pixels.subarray(source, source + 4), (y * canvas.width + x) * 4);
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}
