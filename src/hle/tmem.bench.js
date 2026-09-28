import { bench, run } from 'mitata';
import * as gbi from './gbi.js';
import { TMEM } from './tmem.js';

// Run with: bun src/hle/tmem.bench.js
// Force invalidation so these measure hashing, including wrapping and palettes.
const tmem = new TMEM();
for (let i = 0; i < 1024; i++) tmem.tmemData32[i] = Math.imul(i + 1, 0x9e3779b1);
const tiles = [];
for (const [name, format, size, width, height, line, offset] of [
  ['RGBA16 4x1 (8 bytes)', 0, 2, 4, 1, 1, 0],
  ['RGBA16 8x8 (128 bytes)', 0, 2, 8, 8, 2, 0],
  ['RGBA16 32x32 (2 KiB)', 0, 2, 32, 32, 8, 0],
  ['RGBA32 32x32 (4 KiB)', 0, 3, 32, 32, 8, 0],
  ['RGBA16 32x32 (wrapped)', 0, 2, 32, 32, 8, 509],
  ['RGBA16 505x233 (one TMEM period)', 0, 2, 505, 233, 16, 509],
  ['CI4 32x32 + palette', 2, 0, 32, 32, 2, 253],
  ['CI8 32x32 + palette', 2, 1, 32, 32, 4, 253],
]) {
  const tile = { format, size, width, height, line, tmem: offset, palette: 7, hash: 0 };
  tiles.push(tile);
  bench(name, () => {
    tile.hash = 0;
    return tmem.calculateCRC(tile);
  });
}
const blank = new TMEM();
const blankTile = { format: gbi.ImageFormat.G_IM_FMT_RGBA, size: gbi.ImageSize.G_IM_SIZ_16b,
  width: 32, height: 32, line: 8, tmem: 0, palette: 0, hash: 0 };
blank.calculateCRC(blankTile);
bench('unchanged blank texture (cached hash)', () => blank.calculateCRC(blankTile));
await run({});
console.log('Hash checksum:', tiles.reduce((sum, tile) => sum + tile.hash, 0));
