import { bench, run } from 'mitata';
import { convertTexels } from './convert.js';
import * as gbi from './gbi.js';
import { Tile } from './tile.js';

// Run with: bun src/hle/convert.bench.js
// Synthetic bytes covering Tetrisphere's intro layouts and the packed pixel formats.
const tmem = Uint8Array.from({ length: 4096 }, (_, i) => (i * 37 + (i >>> 8) * 13) & 255);
const outputs = [];
for (const [name, format, size, width, height, line] of [
  ['RGBA16 32x32', gbi.ImageFormat.G_IM_FMT_RGBA, gbi.ImageSize.G_IM_SIZ_16b, 32, 32, 8],
  ['RGBA16 505x233 (repeating TMEM rows)', gbi.ImageFormat.G_IM_FMT_RGBA, gbi.ImageSize.G_IM_SIZ_16b, 505, 233, 16],
  ['RGBA16 345x345', gbi.ImageFormat.G_IM_FMT_RGBA, gbi.ImageSize.G_IM_SIZ_16b, 345, 345, 11],
  ['CI8 320x6', gbi.ImageFormat.G_IM_FMT_CI, gbi.ImageSize.G_IM_SIZ_8b, 320, 6, 40],
  ['RGBA32 32x32', gbi.ImageFormat.G_IM_FMT_RGBA, gbi.ImageSize.G_IM_SIZ_32b, 32, 32, 8],
  ['IA16 32x32', gbi.ImageFormat.G_IM_FMT_IA, gbi.ImageSize.G_IM_SIZ_16b, 32, 32, 8],
  ['IA4 32x32', gbi.ImageFormat.G_IM_FMT_IA, gbi.ImageSize.G_IM_SIZ_4b, 32, 32, 2],
  ['I8 32x32', gbi.ImageFormat.G_IM_FMT_I, gbi.ImageSize.G_IM_SIZ_8b, 32, 32, 4],
  ['I4 32x32', gbi.ImageFormat.G_IM_FMT_I, gbi.ImageSize.G_IM_SIZ_4b, 32, 32, 2],
  ['CI4 32x32', gbi.ImageFormat.G_IM_FMT_CI, gbi.ImageSize.G_IM_SIZ_4b, 32, 32, 2],
  ['IA8 32x16', gbi.ImageFormat.G_IM_FMT_IA, gbi.ImageSize.G_IM_SIZ_8b, 32, 16, 4],
]) {
  const tile = new Tile();
  tile.set(format, size, line, 0, 0, 0, 0, 0, 0, 0, 0);
  tile.setSize(0, 0, (width - 1) * 4, (height - 1) * 4);
  const dst = { width, data: new Uint8Array(width * height * 4) };
  outputs.push(dst.data);
  bench(name, () => convertTexels(dst, tmem, tile, gbi.TextureLUT.G_TT_RGBA16));
  if (format === gbi.ImageFormat.G_IM_FMT_CI) {
    bench(`${name} (IA palette)`, () => convertTexels(dst, tmem, tile, gbi.TextureLUT.G_TT_IA16));
  }
}
await run({});
console.log('Pixel checksum:', outputs.reduce((sum, pixels) => sum + pixels.reduce((a, b) => a + b, 0), 0));
