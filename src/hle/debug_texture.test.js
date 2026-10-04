import { expect, test } from 'bun:test';
import { createTilePreview, decodeTile } from './debug_texture.js';
import * as gbi from './gbi.js';
import { Tile } from './tile.js';
import { TMEM } from './tmem.js';

function fixture() {
  const tmem = new TMEM(), tile = new Tile();
  tile.set(0, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0);
  tile.setSize(0, 0, 0, 0);
  return { tmem, tile };
}

test('on-demand previews preserve transparent RGB and observe edits without invalidation', () => {
  const { tmem, tile } = fixture();
  tmem.tmemData.set([0xf8, 0]);
  expect(Array.from(decodeTile(tmem, tile, 0).pixels)).toEqual([255, 0, 0, 0]);
  tmem.tmemData.set([0x07, 0xc1]);
  expect(Array.from(decodeTile(tmem, tile, 0).pixels)).toEqual([0, 255, 0, 255]);
});

for (const [format, size, plain] of [
  [0, 0, [238, 238, 238, 238]], [0, 1, [14, 14, 14, 14]],
  [3, 0, [255, 255, 255, 0]], [3, 1, [0, 0, 0, 238]],
  [4, 0, [238, 238, 238, 238]], [4, 1, [14, 14, 14, 14]],
]) {
  test(`preview format ${format}/${size} follows current TLUT mode and palette contents`, () => {
    const { tmem, tile } = fixture();
    tile.format = format; tile.size = size; tile.palette = 7;
    tmem.tmemData[0] = size === 0 ? 0xe0 : 0x0e;
    const entry = 2048 + (size === 0 ? 7 * 16 + 14 : 14) * 8;
    tmem.tmemData.set([0xf8, 1], entry);
    const pixel = mode => Array.from(decodeTile(tmem, tile, mode).pixels);
    expect(pixel(0)).toEqual(plain);
    expect(pixel(gbi.TextureLUT.G_TT_RGBA16)).toEqual([255, 0, 0, 255]);
    expect(pixel(gbi.TextureLUT.G_TT_IA16)).toEqual([248, 248, 248, 1]);
    expect(pixel(0)).toEqual(plain);
    tmem.tmemData.set([7, 0xc1], entry);
    expect(pixel(gbi.TextureLUT.G_TT_RGBA16)).toEqual([0, 255, 0, 255]);
    expect(pixel(gbi.TextureLUT.G_TT_IA16)).toEqual([7, 7, 7, 193]);
  });
}

test('previews support zero stride and return null for unset, empty or unsupported tiles', () => {
  const { tmem, tile } = fixture();
  tile.line = 0;
  expect(decodeTile(tmem, tile, 0)).not.toBeNull();
  tile.format = -1;
  expect(decodeTile(tmem, tile, 0)).toBeNull();
  tile.format = 0; tile.setSize(0, 0, -4, 0);
  expect(decodeTile(tmem, tile, 0)).toBeNull();
  tile.setSize(0, 0, 0, 0); tile.format = 1; tile.size = 0;
  expect(decodeTile(tmem, tile, 0)).toBeNull();
});

test('scaled tile previews create only a canvas and preserve per-pixel bytes', () => {
  const { tmem, tile } = fixture();
  tmem.tmemData.set([0xf8, 0]);
  let written;
  const canvas = { style: {}, getContext: kind => {
    expect(kind).toBe('2d');
    return { createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: image => { written = image.data; } };
  } };
  const saved = globalThis.document;
  try {
    globalThis.document = { createElement: kind => { expect(kind).toBe('canvas'); return canvas; } };
    expect(createTilePreview(tmem, tile, 0, 2)).toBe(canvas);
    expect([canvas.width, canvas.height]).toEqual([2, 2]);
    expect(Array.from(written)).toEqual(Array(4).fill([255, 0, 0, 0]).flat());
  } finally { globalThis.document = saved; }
});
