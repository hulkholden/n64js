import { expect, test } from 'bun:test';
import * as gbi from './gbi.js';
import { Renderer } from './renderer.js';
import { RSPState } from './rsp_state.js';
import { Tile } from './tile.js';
import { TMEM } from './tmem.js';
import { textureDecodeTile } from './texture_sampler.js';

function fixture() {
  const values = new Map();
  const record = (name, ...args) => values.set(name, args);
  const gl = {
    activeTexture() {}, bindTexture: (...args) => record('texture', ...args),
    uniform1i: record, uniform2i: record, uniform2f: record, uniform4f: record,
    TEXTURE0: 0, TEXTURE_2D: 'texture2D',
  };
  const state = new RSPState();
  const renderer = Object.assign(Object.create(Renderer.prototype), { gl, state });
  const tile = new Tile();
  tile.setSize(5, 10, 33, 38);
  tile.shiftS = 2;
  tile.shiftT = 12;
  tile.maskS = 2;
  tile.cmS = gbi.G_TX_MIRROR | gbi.G_TX_CLAMP;
  const texture = { width: 4, height: 8, texture: 'decodedTexture' };
  const uniforms = [0, 1].map(i => ({
    sampler: `sampler${i}`, scale: `scale${i}`, offset: `offset${i}`,
    bounds: `bounds${i}`, mask: `mask${i}`, mode: `mode${i}`, enabled: `enabled${i}`,
  }));
  const bind = (slot = 0, tex = texture, texgen = false) =>
    renderer.bindTexture(slot, tile, tex, texgen, uniforms[slot]);
  return { values, state, bind };
}

test('shader sampler receives shifts, fractional origins, masks and independent clamp extents', () => {
  const { values, bind } = fixture();
  bind();
  expect(values.get('scale0')).toEqual([0.25, 16]);
  expect(values.get('offset0')).toEqual([1.25, 2.5]);
  expect(values.get('bounds0')).toEqual([7, 7, 7, 7]);
  expect(values.get('mask0')).toEqual([2, 0]);
  expect(values.get('mode0')).toEqual([3, 2]);
});

test('generated coordinates are converted from normalized UVs back to texels', () => {
  const { values, bind } = fixture();
  bind(1, undefined, true);
  expect(values.get('scale1')).toEqual([1, 128]);
  expect(values.get('offset1')).toEqual([0, 0]);
  expect(values.get('sampler1')).toEqual([1]);
});

test('copy sampling bypasses clamping but preserves mirroring and masking', () => {
  const { values, state, bind } = fixture();
  state.rdpOtherModeH = gbi.CycleType.G_CYC_COPY;
  bind();
  expect(values.get('mode0')).toEqual([1, 0]);
  expect(values.get('mask0')).toEqual([2, 0]);
});

test('an absent second tile cannot reuse the previous draw or sampler zero', () => {
  const { values, bind } = fixture();
  bind(1);
  expect(values.get('enabled1')).toEqual([1]);
  bind(1, null);
  expect(values.get('enabled1')).toEqual([0]);
  expect(values.get('sampler1')).toEqual([1]);
  expect(values.get('texture')).toEqual(['texture2D', null]);
});

test('scrolling a wrapped tile retains its complete texture and original clamp bounds', () => {
  const tile = new Tile();
  tile.set(2, 0, 4, 0, 0, 0, 6, 0, 1, 6, 0);
  tile.setSize(128, 192, 256, 256);
  tile.hash = 123;
  const decoded = textureDecodeTile(tile);
  expect([decoded.width, decoded.height]).toEqual([64, 64]);
  expect([tile.width, tile.height, tile.left, tile.top, tile.hash]).toEqual([33, 17, 32, 48, 123]);
  expect(decoded.hash).toBe(0);
});

test('clamped axes keep their extent while copy mode exposes the full mask period', () => {
  const tile = new Tile();
  tile.set(2, 0, 4, 0, 0, 3, 6, 0, 2, 6, 0);
  tile.setSize(128, 192, 256, 256);
  expect(textureDecodeTile(tile)).toBe(tile);
  const copy = textureDecodeTile(tile, true);
  expect([copy.width, copy.height]).toEqual([64, 64]);
  tile.cmT = 1;
  const mixed = textureDecodeTile(tile);
  expect([mixed.width, mixed.height]).toEqual([33, 64]);
});

for (const [name, maskS, maskT, address, pixel] of [
  ['rows outside the clamp bounds', 3, 2, 28, 24],
  ['columns beyond the final row stride', 5, 1, 32, 60],
]) {
  test(`decoded texture hashing includes ${name}`, () => {
    const tmem = new TMEM();
    const tile = new Tile();
    tile.set(gbi.ImageFormat.G_IM_FMT_I, gbi.ImageSize.G_IM_SIZ_8b, 1, 0, 0, 0, maskS, 0, 0, maskT, 0);
    tile.setSize(0, 0, 12, 4);
    tmem.tmemData[0] = 17;
    tmem.calculateCRC(tile); // Cache a hash of the original, smaller image.
    const decoded = textureDecodeTile(tile);
    const before = tmem.calculateCRC(decoded);
    tmem.tmemData[address] = 255;
    const updated = textureDecodeTile(tile);
    expect(tmem.calculateCRC(updated)).not.toBe(before);
    const dst = { width: updated.width, data: new Uint8ClampedArray(updated.width * updated.height * 4) };
    expect(tmem.convertTexels(updated, 0, dst)).toBe(true);
    expect(Array.from(dst.data.slice(pixel * 4, pixel * 4 + 4))).toEqual([255, 255, 255, 255]);
  });
}
