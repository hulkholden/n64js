import { describe, expect, test } from 'bun:test';
import { Renderer } from './renderer.js';
import { RSPState } from './rsp_state.js';
import * as gbi from './gbi.js';

function fixture() {
  const deleted = [];
  const uploads = [];
  const gl = {
    createTexture: () => ({}), deleteTexture: texture => deleted.push(texture),
    activeTexture() {}, bindTexture() {}, texParameteri() {},
    texImage2D: (...args) => uploads.push(args),
  };
  const state = new RSPState();
  state.reset(new DataView(new ArrayBuffer(8)), 0);
  const textureCache = new Map();
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    gl, state, textureCache, renderTargets: { reset() {} }, hleHalt() {},
  });
  const tile = state.tiles[0];
  tile.set(gbi.ImageFormat.G_IM_FMT_RGBA, gbi.ImageSize.G_IM_SIZ_16b, 1, 0, 0, 0, 0, 0, 0, 0, 0);
  tile.setSize(0, 0, 4, 4);
  return { renderer, state, tile, cache: textureCache, deleted, uploads };
}

describe('texture lookup and decoding', () => {
  test('reuses identical content after a TMEM reload and uploads bytes directly', () => {
    const { renderer, state, uploads } = fixture();
    state.tmem.tmemData.set([0xf8, 0x00]); // Transparent red must retain its RGB.
    const texture = renderer.lookupTexture(0);
    state.invalidateTileHashes();
    expect(renderer.lookupTexture(0)).toBe(texture);
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toHaveLength(9);
    expect(uploads[0][8]).toBe(texture.pixels);
    expect(Array.from(texture.pixels.slice(0, 4))).toEqual([255, 0, 0, 0]);
    state.tmem.tmemData[0] = 0x07;
    state.invalidateTileHashes();
    expect(renderer.lookupTexture(0)).not.toBe(texture);
  });

  test('palette decoding mode is part of the key, even without a TMEM load', () => {
    const { renderer, state, tile } = fixture();
    tile.set(gbi.ImageFormat.G_IM_FMT_CI, gbi.ImageSize.G_IM_SIZ_4b, 1, 0, 0, 0, 0, 0, 0, 0, 0);
    state.tmem.tmemData.set([0xf8, 0x01], 0x800);
    state.rdpOtherModeH = gbi.TextureLUT.G_TT_RGBA16;
    const rgba = renderer.lookupTexture(0);
    expect(Array.from(rgba.pixels.slice(0, 4))).toEqual([255, 0, 0, 255]);
    state.rdpOtherModeH = gbi.TextureLUT.G_TT_IA16;
    const ia = renderer.lookupTexture(0);
    expect(Array.from(ia.pixels.slice(0, 4))).toEqual([248, 248, 248, 1]);
    expect(ia).not.toBe(rgba);
    state.rdpOtherModeH = gbi.TextureLUT.G_TT_RGBA16;
    expect(renderer.lookupTexture(0)).toBe(rgba);
  });

  test('different row strides cannot alias under the same content hash', () => {
    const { renderer, state, tile } = fixture();
    // A hash describes the memory contents, not their row interpretation.
    state.tmem.calculateCRC = () => 1;
    const first = renderer.lookupTexture(0);
    tile.line = 2;
    expect(renderer.lookupTexture(0)).not.toBe(first);
  });

  test('expanded wrap hashes are reused, invalidated by loads, and separated from clamp extents', () => {
    const { renderer, state, tile } = fixture();
    tile.maskS = tile.maskT = 3;
    let reads = 0;
    state.tmem.tmemData32 = new Proxy(state.tmem.tmemData32, {
      get(target, property) { reads++; return target[property]; },
    });
    state.tmem.tmemData[0] = 0xff;
    const expanded = renderer.lookupTexture(0);
    const firstReads = reads;
    expect(firstReads).toBeGreaterThan(0);
    expect(renderer.lookupTexture(0)).toBe(expanded);
    expect(reads).toBe(firstReads);
    state.tmem.tmemData[32] = 0xff;
    state.invalidateTileHashes();
    expect(renderer.lookupTexture(0)).not.toBe(expanded);
    tile.cmS = tile.cmT = gbi.G_TX_CLAMP;
    const clamped = renderer.lookupTexture(0);
    expect(clamped.width).toBe(2);
    state.rdpOtherModeH = gbi.CycleType.G_CYC_COPY;
    expect(renderer.lookupTexture(0).width).toBe(8);
  });

  test('failed conversion releases the allocation and does not cache it', () => {
    const { renderer, tile, cache, deleted, uploads } = fixture();
    tile.format = -1;
    expect(renderer.lookupTexture(0)).toBeNull();
    expect(cache.size).toBe(0);
    expect(deleted).toHaveLength(1);
    expect(uploads).toHaveLength(0);
  });
});

test('RGBA32 cache identity includes the base alignment used by odd-row swizzling', () => {
  const { renderer, state, tile } = fixture();
  tile.size = gbi.ImageSize.G_IM_SIZ_32b;
  tile.setSize(0, 0, 0, 4);
  const data = state.tmem.tmemData;
  data.set(Uint8Array.from({ length: 32 }, (_, i) => i));
  const before = renderer.lookupTexture(0);
  const hash = tile.hash;
  data.copyWithin(8, 0, 32);
  tile.tmem = 1;
  state.invalidateTileHashes();
  const after = renderer.lookupTexture(0);
  expect(tile.hash).toBe(hash); // Identical raw bytes, different swizzle layout.
  expect(Array.from(before.pixels)).toEqual([0, 1, 2, 3, 24, 25, 26, 27]);
  expect(Array.from(after.pixels)).toEqual([0, 1, 2, 3, 8, 9, 10, 11]);
});
