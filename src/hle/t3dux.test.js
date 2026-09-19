import { describe, expect, test } from 'bun:test';
import { executeDisplayList } from './display_list.js';
import { identifyMicrocode, MicrocodeId } from './microcode_identifier.js';
import { create } from './microcodes.js';
import { NullRenderer } from './null_renderer.js';
import { RSPState } from './rsp_state.js';

const hashes = [0x26da8a4c, 0xdd560323];
function words(dv, address, values) {
  values.forEach((value, i) => dv.setUint32(address + i * 4, value));
}
function setup(dv, hash) {
  const state = new RSPState();
  state.reset(dv, 0x100);
  const microcode = create({ detectVersionString: () => '', computeMicrocodeHash: () => hash }, state, dv);
  microcode.renderer = new NullRenderer(state);
  const draws = [];
  microcode.renderer.flushTris = tb => {
    if (!tb.empty()) draws.push({
      positions: Array.from(tb.positions.slice(0, tb.numTris * 12)),
      colors: Array.from(tb.colours.slice(0, tb.numTris * 3)),
      uv: Array.from(tb.coords.slice(0, tb.numTris * 6)),
      palette: state.tiles[state.texture.tile].palette,
      texture: state.geometryMode.texture,
    });
    tb.reset();
  };
  return { state, microcode, draws };
}

// Synthetic data only: object headers use different count/flag offsets from
// Turbo3D, and each eight-byte triangle has separate color/UV indices.
function fixture() {
  const dv = new DataView(new ArrayBuffer(0x2000));
  words(dv, 0x100, [
    0x200, 0x01000300, 0x01000600, 0x01000700, 0x01000800, 0x500,
    0, 0x01000380, 0, 0x01000720, 0, 0x500,
    0, 0, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff,
    0xdeadbeef, 0xffffffff,
  ]);
  // Install segment 1 (and a nonzero segment 0) before resolving the object.
  dv.setUint32(0x210, 0x1000);
  dv.setUint32(0x214, 0x1000);
  dv.setUint32(0x260, 0x01000900);
  words(dv, 0x1300, [0, 0x00020300, 0x02030900, 0x01000920, 0xef000000, 0]);
  words(dv, 0x1380, [0, 0x02010000, 0x01010000, 0, 0xef000000, 0]);
  [[0, 0], [1280, 0], [0, 960]].forEach(([x, y], i) => {
    words(dv, 0x1600 + i * 8, [(x << 16) | y, 0x01ff0000]);
  });
  words(dv, 0x1700, [0x00010203, 0x04050689, 0x00020103, 0x07060500]);
  words(dv, 0x1720, [0x00010200, 0]);
  words(dv, 0x1800, [0xff0000ff, 0x00ff00ff, 0x0000ffff, 0x11223344,
    0xffe00040, 0x0060ff80, 0x00a000c0, 0x00e00100, 0]);
  words(dv, 0x1900, [0xf7000000, 0x11223344, 0, 0xdeadbeef]);
  words(dv, 0x1920, [
    0xe4040020, 0, 0x00200040, 0x04000400,
    0xf5000000, 0x00500000, 0xe9000000, 0, 0, 0,
  ]);
  return dv;
}

describe('T3DUX object lists', () => {
  test('keeps both hash variants distinct from GBI1 and Turbo3D', () => {
    expect(identifyMicrocode('', hashes[0])).toMatchObject({ id: MicrocodeId.T3DUX, family: 'T3DUX', variant: '26da8a4c' });
    expect(identifyMicrocode('', hashes[1])).toMatchObject({ id: MicrocodeId.T3DUX_BRAVE, family: 'T3DUX', variant: 'dd560323' });
  });

  for (const hash of hashes) {
    test(`${hash.toString(16)} draws packed vertices with per-corner UVs, palette changes and cached attributes`, () => {
      for (const debug of [false, true]) {
        const { state, microcode, draws } = setup(fixture(), hash);
        const rectangles = [];
        microcode.renderer.texRect = (...args) => rectangles.push(args);
        let fullSyncs = 0;
        state.onFullSync = () => fullSyncs++;
        let rows = 0;
        const disassembler = debug ? {
          begin() { rows++; }, text() {}, tip() {}, end() {}, rgba8888: String, rgba5551: String,
        } : null;
        executeDisplayList(state, microcode, { disassembler });
        expect(draws).toHaveLength(2);
        expect(draws[0]).toEqual({
          positions: [-1, 1, 0, 1, 1, 1, 0, 1, -1, -1, 0, 1,
            -1, 1, 0, 1, -1, -1, 0, 1, 1, 1, 0, 1],
          colors: Array(6).fill(0x44332211),
          uv: [-1, 2, 3, -4, 5, 6, 7, 8, 5, 6, 3, -4],
          palette: 9, texture: true,
        });
        expect(draws[1].colors).toEqual([0xff0000ff, 0xff00ff00, 0xffff0000]);
        expect(draws[1].uv).toEqual([0, 0, 0, 0, 0, 0]);
        expect(draws[1].texture).toBe(false);
        expect(rectangles).toEqual([[0, 0, 0, 16, 8, 1, 2, 17, 10, false]]);
        expect(state.fillColor).toBe(0x11223344);
        expect(state.segments[0]).toBe(0x1000);
        expect(fullSyncs).toBe(debug ? 0 : 1);
        expect(state.pc).toBe(0);
        expect(state.currentOp).toBe(3);
        if (debug) expect(rows).toBe(3);
      }
    });

    test(`${hash.toString(16)} reuses a matrix and offset vertex/attribute loads across a debug stop`, () => {
      const dv = new DataView(new ArrayBuffer(0x1000));
      words(dv, 0x100, [0, 0x200, 0x400, 0, 0x500, 0x600,
        0, 0x300, 0x400, 0x600, 0, 0x600, 0, 0]);
      words(dv, 0x200, [0, 0x02010350, 0x00000302, 0, 0xef000000, 0]);
      for (let i = 0; i < 4; i++) dv.setInt16(0x218 + i * 10, 1);
      dv.setInt16(0x236, 2); // w=2 must be divided out for affine texturing.
      words(dv, 0x300, [0, 0x02010350, 0x01010000, 0, 0xef000000, 0]);
      words(dv, 0x400, [0xffff0001, 0, 0x00010001, 0, 0xffffffff, 0]);
      words(dv, 0x500, [0xff0000ff, 0x00ff00ff, 0x0000ffff]);
      words(dv, 0x600, [0x505152b2, 0]); // Signed smooth-color offset -78 => entries 2..4.
      const { state, microcode, draws } = setup(dv, hash);
      executeDisplayList(state, microcode, { bailAfter: 0 });
      expect(state.pc).toBe(0x118);
      expect(draws).toEqual([]);
      executeDisplayList(state, microcode);
      expect(draws[0].positions).toEqual([-0.5, 0.5, -511 / 512, 1,
        0.5, 0.5, -511 / 512, 1, -0.5, -0.5, -511 / 512, 1]);
      expect(draws[0].colors).toEqual([0xff0000ff, 0xff00ff00, 0xffff0000]);
      expect(state.pc).toBe(0);
    });
  }

  test('preserves the different palette-command length semantics', () => {
    const dv = fixture();
    dv.setUint8(0x1707, 0x99); // Later variant can select tile 1; Brave cannot emit 9 bytes.
    const later = setup(dv, hashes[0]);
    executeDisplayList(later.state, later.microcode);
    expect(later.state.tiles[1].palette).toBe(9);
    const brave = setup(dv, hashes[1]);
    expect(() => executeDisplayList(brave.state, brave.microcode)).toThrow('palette command length');
  });

  test('flushes before palette changes and preserves palette commands on rejected triangles', () => {
    const dv = fixture();
    // First triangle keeps palette 5, second selects 9.
    dv.setUint8(0x1707, 0);
    dv.setUint8(0x170f, 0x89);
    const { state, microcode, draws } = setup(dv, hashes[0]);
    executeDisplayList(state, microcode);
    expect(draws.map(draw => draw.palette)).toEqual([5, 9, 9]);
    expect(draws.map(draw => draw.positions.length)).toEqual([12, 12, 12]);

    const culledDV = fixture();
    culledDV.setUint8(0x1304, 0x20); // Back-face culling; the first triangle is clockwise.
    culledDV.setUint8(0x1707, 7); // Rejected path emits SetTile even without bit 7.
    culledDV.setUint8(0x170f, 0);
    const culled = setup(culledDV, hashes[0]);
    executeDisplayList(culled.state, culled.microcode);
    expect(culled.draws.map(draw => draw.palette)).toEqual([7, 7]);

    // The RSP rejection bit discards the triangle before attribute fetches,
    // but the rejected-triangle path still emits a nonzero palette byte.
    dv.setUint32(0x1604, 0x81ff0000);
    dv.setUint8(0x1707, 7);
    dv.setUint32(0x110, 0); // No attributes loaded.
    const rejected = setup(dv, hashes[0]);
    executeDisplayList(rejected.state, rejected.microcode);
    expect(rejected.draws).toEqual([]);
    expect(rejected.state.tiles[0].palette).toBe(9);
  });

  test('draws untextured objects with a palette flag before any SetTile', () => {
    for (const hash of hashes) {
      const dv = fixture();
      dv.setUint8(0x1305, 1); // Untextured, depth enabled.
      dv.setUint32(0x1920, 0); // No SetTile template has been loaded.
      const { state, microcode, draws } = setup(dv, hash);
      executeDisplayList(state, microcode);
      expect(draws).toHaveLength(2);
      expect(draws[0].colors).toEqual(Array(6).fill(0x44332211));
      expect(draws[0].texture).toBe(false);
      expect(draws[0].palette).toBe(0);
    }
  });

  test('rejects unsupported writeback and unloaded attributes or vertices explicitly', () => {
    for (const [offset, value, message] of [
      [0x1309, 4, 'transform-only RAM writeback'],
      [0x1704, 100, 'unloaded attribute'],
      [0x1700, 100, 'unloaded vertex'],
    ]) {
      const dv = fixture();
      dv.setUint8(offset, value);
      const { state, microcode } = setup(dv, hashes[0]);
      expect(() => executeDisplayList(state, microcode)).toThrow(message);
    }
  });
});
