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
  for (const [name, first, second] of [
    ['compensating word values', [1, 0], [0, 17]],
    ['high bits in adjacent words', [0, 0], [0x80000000, 0x80000000]],
  ]) {
    test(`does not reuse a stale texture when ${name} change`, () => {
      const { renderer, state, tile, uploads } = fixture();
      tile.setSize(0, 0, 12, 0);
      state.tmem.tmemData32.set(first);
      const before = renderer.lookupTexture(0);
      state.tmem.tmemData32.set(second);
      state.invalidateTileHashes();
      const after = renderer.lookupTexture(0);
      expect(after).not.toBe(before);
      expect(after.pixels).not.toEqual(before.pixels);
      expect(uploads).toHaveLength(2);
    });
  }

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

  for (const [name, format, size, direct] of [
    ['RGBA4', gbi.ImageFormat.G_IM_FMT_RGBA, gbi.ImageSize.G_IM_SIZ_4b, [238, 238, 238, 238]],
    ['RGBA8', gbi.ImageFormat.G_IM_FMT_RGBA, gbi.ImageSize.G_IM_SIZ_8b, [14, 14, 14, 14]],
    ['IA4', gbi.ImageFormat.G_IM_FMT_IA, gbi.ImageSize.G_IM_SIZ_4b, [255, 255, 255, 0]],
    ['IA8', gbi.ImageFormat.G_IM_FMT_IA, gbi.ImageSize.G_IM_SIZ_8b, [0, 0, 0, 238]],
    ['I4', gbi.ImageFormat.G_IM_FMT_I, gbi.ImageSize.G_IM_SIZ_4b, [238, 238, 238, 238]],
    ['I8', gbi.ImageFormat.G_IM_FMT_I, gbi.ImageSize.G_IM_SIZ_8b, [14, 14, 14, 14]],
  ]) {
    test(`${name} uses the enabled TLUT and caches palette changes and mode switches`, () => {
      const { renderer, state, tile } = fixture();
      const palette = 7;
      tile.set(format, size, 1, 0, palette, 0, 0, 0, 0, 0, 0);
      tile.setSize(0, 0, 0, 0);
      // Bio FREAKS uses even indices whose IA4 alpha bit would be zero.
      state.tmem.tmemData[0] = size === gbi.ImageSize.G_IM_SIZ_4b ? 0xe0 : 0x0e;
      const entry = 0x800 + (size === gbi.ImageSize.G_IM_SIZ_4b ? palette * 16 + 14 : 14) * 8;
      state.tmem.tmemData.set([0xf8, 0x01], entry);
      const plain = renderer.lookupTexture(0);
      expect(Array.from(plain.pixels)).toEqual(direct);

      // SetOtherMode can toggle TLUT without invalidating the tile hash.
      state.rdpOtherModeH = gbi.TextureLUT.G_TT_RGBA16;
      const rgba = renderer.lookupTexture(0);
      expect(Array.from(rgba.pixels)).toEqual([255, 0, 0, 255]);
      state.rdpOtherModeH = gbi.TextureLUT.G_TT_IA16;
      const ia = renderer.lookupTexture(0);
      expect(Array.from(ia.pixels)).toEqual([248, 248, 248, 1]);
      state.rdpOtherModeH = gbi.TextureLUT.G_TT_NONE;
      expect(renderer.lookupTexture(0)).toBe(plain);

      // Reload the palette while TLUT is disabled, then re-enable it. The
      // cached direct-texture hash must not hide the changed palette bytes.
      state.tmem.tmemData.set([0x07, 0xc1], entry);
      state.invalidateTileHashes();
      expect(renderer.lookupTexture(0)).toBe(plain);
      state.rdpOtherModeH = gbi.TextureLUT.G_TT_RGBA16;
      const green = renderer.lookupTexture(0);
      expect(green).not.toBe(rgba);
      expect(Array.from(green.pixels)).toEqual([0, 255, 0, 255]);
      state.rdpOtherModeH = gbi.TextureLUT.G_TT_IA16;
      expect(Array.from(renderer.lookupTexture(0).pixels)).toEqual([7, 7, 7, 193]);
      state.rdpOtherModeH = gbi.TextureLUT.G_TT_RGBA16;
      expect(renderer.lookupTexture(0)).toBe(green);
    });
  }

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

test('RGBA32 cache reuses relocated bank contents regardless of base parity', () => {
  const { renderer, state, tile } = fixture();
  tile.size = gbi.ImageSize.G_IM_SIZ_32b;
  tile.setSize(0, 0, 0, 4);
  const data = state.tmem.tmemData;
  data.set(Uint8Array.from({ length: 16 }, (_, i) => i));
  data.set(Uint8Array.from({ length: 16 }, (_, i) => 32 + i), 0x800);
  const before = renderer.lookupTexture(0);
  const hash = tile.hash;
  data.copyWithin(8, 0, 16);
  data.copyWithin(0x808, 0x800, 0x810);
  tile.tmem = 1;
  state.invalidateTileHashes();
  const after = renderer.lookupTexture(0);
  expect(tile.hash).toBe(hash);
  expect(Array.from(before.pixels)).toEqual([0, 1, 32, 33, 12, 13, 44, 45]);
  expect(after).toBe(before);
});
