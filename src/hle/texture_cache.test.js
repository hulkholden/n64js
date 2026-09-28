import { describe, expect, test } from 'bun:test';
import { TextureCache } from './texture_cache.js';
import { Renderer } from './renderer.js';
import { RSPState } from './rsp_state.js';
import * as gbi from './gbi.js';

function fixture(maxBytes, maxEntries) {
  const deleted = [];
  const gl = {
    createTexture: () => ({}), deleteTexture: texture => deleted.push(texture),
  };
  const state = new RSPState();
  state.reset(new DataView(new ArrayBuffer(8)), 0);
  const cache = new TextureCache(gl, maxBytes, maxEntries);
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    gl, state, textureCache: cache, renderTargets: { reset() {} },
    // Exercise real lookup/invalidation and cache ownership without requiring
    // a browser canvas. The GPU suite covers production decoding and deletion.
    decodeTexture: tile => ({ width: tile.width, height: tile.height, texture: gl.createTexture() }),
  });
  state.tiles[0].set(gbi.ImageFormat.G_IM_FMT_RGBA, gbi.ImageSize.G_IM_SIZ_16b,
    1, 0, 0, 0, 0, 0, 0, 0, 0);
  state.tiles[0].setSize(0, 0, 4, 4);
  return { renderer, state, cache, deleted };
}

describe('texture cache ownership', () => {
  test('evicts the least recently used texture by bytes and explicitly releases GPU storage', () => {
    const { renderer, state, cache, deleted } = fixture(32, 10);
    const textures = [];
    for (const value of [1, 2]) {
      state.tmem.tmemData[0] = value;
      state.invalidateTileHashes();
      textures.push(renderer.lookupTexture(0));
    }
    state.tmem.tmemData[0] = 1;
    state.invalidateTileHashes();
    expect(renderer.lookupTexture(0)).toBe(textures[0]);
    state.tmem.tmemData[0] = 3;
    state.invalidateTileHashes();
    renderer.lookupTexture(0);
    expect(cache.size).toBe(2);
    expect(cache.byteLength).toBe(32);
    expect(deleted).toEqual([textures[1].texture]);
    renderer.reset();
    expect(cache.size).toBe(0);
    expect(cache.byteLength).toBe(0);
    expect(new Set(deleted).size).toBe(3);
    renderer.reset();
    expect(deleted).toHaveLength(3);
  });

  test('bounds tiny textures by entry count during a long stream of unique uploads', () => {
    const { renderer, state, cache, deleted } = fixture(1024, 3);
    for (let value = 0; value < 10000; value++) {
      state.tmem.tmemData[0] = value >>> 8;
      state.tmem.tmemData[1] = value & 255;
      state.invalidateTileHashes();
      renderer.lookupTexture(0);
      if (cache.size > 3 || cache.byteLength > 48) throw new Error('Unbounded cache');
    }
    expect(cache.size).toBe(3);
    expect(deleted).toHaveLength(9997);
    expect(cache.evictions).toBe(9997);
  });

  test('reuses identical content after reload and exposes only resident entries', () => {
    const { renderer, state, cache } = fixture();
    const first = renderer.lookupTexture(0);
    state.invalidateTileHashes();
    expect(renderer.lookupTexture(0)).toBe(first);
    expect(cache.hits).toBe(1);
    expect(cache.misses).toBe(1);
    expect(Array.from(cache, ([, texture]) => texture)).toEqual([first]);
    renderer.reset();
    expect(Array.from(cache)).toEqual([]);
  });

  test('does not retain failed decodes', () => {
    const { renderer, cache } = fixture();
    renderer.decodeTexture = () => null;
    expect(renderer.lookupTexture(0)).toBeNull();
    expect(cache.size).toBe(0);
    expect(cache.byteLength).toBe(0);
  });
});
