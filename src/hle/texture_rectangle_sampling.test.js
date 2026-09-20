import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { textureRectOptions } from '../options.js';
import * as gbi from './gbi.js';
import { NativeTransform } from './native_transform.js';
import { Renderer } from './renderer.js';
import { RSPState } from './rsp_state.js';
import { Tile } from './tile.js';
import { textureRectDebug } from './texture_rectangle_debug.js';

function harness() {
  const params = new Map();
  const gl = {
    TEXTURE_WRAP_S: 'wrapS', TEXTURE_WRAP_T: 'wrapT',
    CLAMP_TO_EDGE: 'clamp', REPEAT: 'repeat', MIRRORED_REPEAT: 'mirror',
    activeTexture() {}, bindTexture() {}, uniform1i() {}, uniform2f() {},
    useProgram() {}, uniform1f() {}, uniform4f() {}, uniform2i() {},
    disable() {}, depthMask() {}, drawArrays() {}, bindVertexArray() {},
    texParameteri(target, name, value) { params.set(name, value); },
  };
  const renderer = Object.create(Renderer.prototype);
  renderer.gl = gl;
  renderer.nativeTransform = new NativeTransform();
  renderer.state = new RSPState();
  renderer.state.rdpOtherModeH = gbi.TextureFilter.G_TF_BILERP;
  renderer.setGLBlendMode = () => {};
  renderer.markFramebufferDirty = () => {};
  renderer.getCurrentN64Shader = () => ({ vertexArray: {
    bind() {}, setPosData() {}, setColorData() {}, setUVData() {},
  } });
  const textureFor = tile => ({ texture: {}, width: tile.width, height: tile.height });
  renderer.lookupTexture = tileIdx => textureFor(renderer.state.tiles[tileIdx]);
  const wrapping = () => [params.get('wrapS'), params.get('wrapT')];
  const bind = (tile, uvs = null, slot = 0, texGenEnabled = false) => {
    renderer.bindTexture(slot, slot, tile, textureFor(tile), texGenEnabled, null, null, null, uvs);
    return wrapping();
  };
  return { renderer, bind, wrapping };
}

function menuTile() {
  const tile = new Tile();
  // Mario Kart's GAME SELECT heading: a 200-pixel-wide strip, four rows
  // per draw, with an extra loaded row/column and wrapping enabled.
  tile.set(gbi.ImageFormat.G_IM_FMT_RGBA, gbi.ImageSize.G_IM_SIZ_16b,
    51, 0, 0, gbi.G_TX_WRAP, 8, 0, gbi.G_TX_WRAP, 2, 0);
  tile.setSize(0, 16, 800, 32);
  return tile;
}

describe('texture rectangle sampling', () => {
  beforeEach(() => {
    textureRectOptions.clamp = true;
    textureRectOptions.instrument = false;
    textureRectDebug.reset();
  });
  afterEach(() => {
    textureRectOptions.clamp = false;
    textureRectOptions.instrument = false;
    textureRectDebug.reset();
  });

  test('switches between baseline and clamped sampling without recreating the renderer', () => {
    const { renderer, wrapping } = harness();
    renderer.state.tiles[0] = menuTile();
    for (const enabled of [false, true, false]) {
      textureRectOptions.clamp = enabled;
      renderer.texRect(0, 61, 21, 261, 25, 0, 4, 200, 8, false);
      expect(wrapping()).toEqual(enabled ? ['clamp', 'clamp'] : ['repeat', 'repeat']);
    }
    const stats = textureRectDebug.snapshot();
    expect(stats.baseline.bindings).toBe(0);
    expect(stats.clamp.bindings).toBe(0);
  });

  test('clamps the captured Mario Kart strip and restores wrapping for triangles', () => {
    const { renderer, bind, wrapping } = harness();
    const tile = menuTile();
    renderer.state.tiles[0] = tile;
    renderer.texRect(0, 61, 21, 261, 25, 0, 4, 200, 8, false);
    expect(wrapping()).toEqual(['clamp', 'clamp']);
    expect(bind(tile)).toEqual(['repeat', 'repeat']);
  });

  test('preserves wrapping independently on axes that repeat or cross a tile edge', () => {
    const { bind } = harness();
    const tile = menuTile();
    expect(bind(tile, [0, 4, 402, 4, 0, 8, 402, 8])).toEqual(['repeat', 'clamp']);
    expect(bind(tile, [0, 4, 200, 4, 0, 12, 200, 12])).toEqual(['clamp', 'repeat']);
    expect(bind(tile, [-1, 3, 200, 3, -1, 8, 200, 8])).toEqual(['repeat', 'repeat']);
    tile.cmT = gbi.G_TX_MIRROR;
    expect(bind(tile, [0, 4, 200, 4, 0, 12, 200, 12])).toEqual(['clamp', 'mirror']);
    tile.cmS = gbi.G_TX_CLAMP;
    tile.maskT = 0;
    expect(bind(tile, [-1, 3, 402, 3, -1, 12, 402, 12])).toEqual(['clamp', 'clamp']);
  });

  test('uses each texture slot\'s offsets and shifts, including flipped coordinates', () => {
    const { renderer, bind, wrapping } = harness();
    const tile = menuTile();
    tile.shiftS = 1;
    tile.shiftT = 15;
    const uvs = [402, 6, 0, 6, 402, 4, 0, 4];
    expect(bind(tile, uvs)).toEqual(['clamp', 'clamp']);
    const secondTile = menuTile();
    expect(bind(secondTile, uvs, 1)).toEqual(['repeat', 'clamp']);
    renderer.state.tiles[0] = tile;
    renderer.texRect(0, 0, 0, 4, 200, 402, 6, 0, 4, true);
    expect(wrapping()).toEqual(['clamp', 'clamp']);
    expect(bind(tile, uvs, 0, true)).toEqual(['repeat', 'repeat']);
  });

  test('instruments baseline candidates without altering sampling and separates enabled results', () => {
    const { bind } = harness();
    const tile = menuTile();
    const uvs = [0, 4, 200, 4, 0, 8, 200, 8];
    textureRectOptions.instrument = true;
    textureRectOptions.clamp = false;
    expect(bind(tile, uvs)).toEqual(['repeat', 'repeat']);
    textureRectOptions.clamp = true;
    expect(bind(tile, uvs, 1)).toEqual(['clamp', 'clamp']);
    // A repeated S axis should only count an override in T.
    expect(bind(tile, [0, 4, 402, 4, 0, 8, 402, 8])).toEqual(['repeat', 'clamp']);
    bind(tile, [0, 4, 402, 4, 0, 12, 402, 12]);
    bind(tile); // Triangles do not count as rectangle bindings.
    const stats = textureRectDebug.snapshot();
    expect(stats.baseline).toMatchObject({ bindings: 1, candidates: 1, candidateS: 1, candidateT: 1,
      changed: 0, changedS: 0, changedT: 0 });
    expect(stats.clamp).toMatchObject({ bindings: 3, candidates: 2, candidateS: 1, candidateT: 2,
      changed: 2, changedS: 1, changedT: 2 });
    expect(stats.clamp.samples[0]).toMatchObject({ slot: 1, textureSize: [201, 4], uvs,
      uvOffset: [0, 4], filter: gbi.TextureFilter.G_TF_BILERP });
    tile.setSize(0, 0, 4, 4);
    uvs[0] = 123;
    stats.clamp.samples[0].tile.ult = 99;
    const saved = textureRectDebug.snapshot().clamp.samples[0];
    expect(saved.tile.ult).toBe(16);
    expect(saved.uvs[0]).toBe(0);
    textureRectOptions.instrument = false;
    bind(menuTile(), [0, 4, 200, 4, 0, 8, 200, 8]);
    expect(textureRectDebug.snapshot().clamp.bindings).toBe(3);
  });

  test('bounds samples while continuing counts and resets them on emulator reset', () => {
    const { renderer, bind } = harness();
    textureRectOptions.instrument = true;
    for (let i = 0; i < 100; i++) bind(menuTile(), [0, 4, 200, 4, 0, 8, 200, 8]);
    const stats = textureRectDebug.snapshot();
    expect(stats.clamp.bindings).toBe(100);
    expect(stats.clamp.samples).toHaveLength(stats.maxSamplesPerMode);
    renderer.renderTargets = { reset() {} };
    renderer.textureCache = new Map();
    renderer.reset();
    expect(textureRectDebug.snapshot().clamp.bindings).toBe(0);
    expect(textureRectDebug.snapshot().clamp.samples).toEqual([]);
  });
});
