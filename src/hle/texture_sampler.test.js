import { afterEach, expect, test } from 'bun:test';
import * as gbi from './gbi.js';
import { graphicsOptions } from './graphics_options.js';
import { Renderer } from './renderer.js';
import { RSPState } from './rsp_state.js';
import { Tile } from './tile.js';

afterEach(() => { graphicsOptions.emulatedTextureSampler = false; });

function fixture(emulatedTextureSampler = true) {
  const values = new Map();
  const record = (name, ...args) => values.set(name, args);
  const gl = {
    activeTexture() {}, bindTexture: (...args) => record('texture', ...args),
    uniform1i: record, uniform2i: record, uniform2f: record, uniform4f: record,
    texParameteri: (target, param, value) => record(param, value),
    TEXTURE_2D: 'texture2D', TEXTURE_MIN_FILTER: 'min', TEXTURE_MAG_FILTER: 'mag',
    TEXTURE_WRAP_S: 'wrapS', TEXTURE_WRAP_T: 'wrapT', NEAREST: 'nearest',
    NEAREST_MIPMAP_NEAREST: 'nearestMip', LINEAR: 'linear', LINEAR_MIPMAP_NEAREST: 'linearMip',
    CLAMP_TO_EDGE: 'clamp', MIRRORED_REPEAT: 'mirror', REPEAT: 'repeat',
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
  const shader = {
    emulatedTextureSampler,
    tileUniforms: [0, 1].map(i => ({ bounds: `bounds${i}`, mask: `mask${i}`, mode: `mode${i}`, enabled: `enabled${i}` })),
  };
  const bind = (slot = 0, tex = texture, texgen = false) =>
    renderer.bindTexture(slot, slot, tile, tex, texgen, `sampler${slot}`, `scale${slot}`, `offset${slot}`, shader);
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
  expect(values.get('min')).toEqual(['nearest']);
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

test('legacy sampling retains normalized coordinates and hardware filtering', () => {
  const { values, state, bind } = fixture(false);
  state.rdpOtherModeH = gbi.TextureFilter.G_TF_BILERP;
  bind();
  expect(values.get('scale0')).toEqual([0.0625, 2]);
  expect(values.get('offset0')).toEqual([1.25, 2.5]);
  expect(values.get('min')).toEqual(['linearMip']);
  expect(values.has('enabled0')).toBe(false);
});

test('experimental sampler defaults to disabled', () => {
  expect(graphicsOptions.emulatedTextureSampler).toBe(false);
});
