import { describe, expect, test } from 'bun:test';
import { executeDisplayList } from './display_list.js';
import { create } from './microcodes.js';
import { NullRenderer } from './null_renderer.js';
import { RSPState } from './rsp_state.js';

function words(dv, address, values) {
  values.forEach((value, i) => dv.setUint32(address + i * 4, value));
}

function makeMicrocode(dv, pc) {
  const state = new RSPState();
  state.reset(dv, pc);
  const microcode = create({
    detectVersionString: () => '', computeMicrocodeHash: () => 0x6d8bec3e,
  }, state, dv);
  microcode.renderer = new NullRenderer(state);
  return { state, microcode };
}

describe('Turbo3D object lists', () => {
  test('executes a screen-space quad and raw RDP blocks, then stops at the null object', () => {
    // The shape of Dark Rift's first Turbo3D task: global setup, a quad,
    // a final RDP block, and a null object. No ROM bytes are required.
    const dv = new DataView(new ArrayBuffer(0x2000));
    words(dv, 0x100, [
      0x200, 0x80000300, 0, 0,
      0, 0x01000360, 0x01000600, 0x01000680,
      0, 0x01000400, 0, 0,
      0, 0, 0xffffffff, 0xffffffff,
      0xdeadbeef, 0xffffffff, 0, 0, // Must never be interpreted as a command.
    ]);
    words(dv, 0x208, [0xef000000, 0]);
    dv.setUint32(0x214, 0x1000); // Segment 1 is installed by the global state.
    dv.setUint32(0x260, 0x01000500);
    words(dv, 0x300, [0, 0, 1, 0, 0xef000000, 0]); // No matrix/vertices/triangles.
    words(dv, 0x1360, [0x202, 3, 0x04000203, 0x01000520, 0xef000000, 0]);
    words(dv, 0x1400, [0, 0, 1, 0x01000700, 0xef000000, 0]);
    words(dv, 0x1500, [0xf7000000, 0x11223344, 0, 0]);
    words(dv, 0x1520, [
      0xe4040020, 0x03000000, 0x00200040, 0x04000400, // Raw 16-byte rectangle.
      0xfa000000, 0xaabbccdd, 0, 0,
    ]);
    words(dv, 0x1700, [0xfb000000, 0x55667788, 0, 0]);
    const colors = [0xff0000ff, 0x00ff00ff, 0x0000ffff, 0xffffffff];
    [[0, 0], [1280, 0], [0, 960], [1280, 960]].forEach(([x, y], i) => {
      words(dv, 0x1600 + i * 16, [(x << 16) | y, 0x01ff0000, 0, colors[i]]);
    });
    words(dv, 0x1680, [0x00010200, 0x02010300]);

    for (const disassemble of [false, true]) {
      const { state, microcode } = makeMicrocode(dv, 0x100);
      const draws = [];
      const rects = [];
      microcode.renderer.flushTris = tb => {
        if (!tb.empty()) draws.push({
          positions: Array.from(tb.positions.slice(0, tb.numTris * 12)),
          colors: Array.from(tb.colours.slice(0, tb.numTris * 3)),
          tile: state.texture.tile,
        });
        tb.reset();
      };
      microcode.renderer.texRect = (...args) => rects.push(args);
      let rows = 0;
      const disassembler = disassemble ? {
        begin() { rows++; }, text() {}, tip() {}, end() {},
        rgba8888: String, rgba5551: String,
      } : null;
      executeDisplayList(state, microcode, { disassembler });
      expect(draws).toEqual([{
        positions: [-1, 1, 0, 1, 1, 1, 0, 1, -1, -1, 0, 1,
          -1, -1, 0, 1, 1, 1, 0, 1, 1, -1, 0, 1],
        colors: [0xff0000ff, 0xff00ff00, 0xffff0000, 0xffff0000, 0xff00ff00, 0xffffffff],
        tile: 3,
      }]);
      expect(rects).toEqual([[3, 0, 0, 16, 8, 1, 2, 17, 10, false]]);
      expect(state.fillColor).toBe(0x11223344);
      expect(state.primColor).toBe(0xaabbccdd);
      expect(state.envColor).toBe(0x55667788);
      expect(state.pc).toBe(0);
      expect(state.currentOp).toBe(4);
      if (disassemble) expect(rows).toBe(4);
    }
  });

  test('reuses the matrix and cached vertices across objects and honours the debug stop', () => {
    const dv = new DataView(new ArrayBuffer(0x800));
    words(dv, 0x100, [
      0, 0x200, 0x400, 0,
      0, 0x300, 0, 0x500,
      0, 0x340, 0x400, 0x500,
      0, 0, 0, 0,
    ]);
    // Put three transformed vertices at the very end of the 64-entry cache.
    words(dv, 0x200, [0x200, 0, 0x033d0000, 0, 0xef000000, 0]);
    for (let i = 0; i < 4; i++) dv.setInt16(0x218 + i * 10, 1); // Identity matrix.
    dv.setInt16(0x236, 2); // w = 2: the output must still use affine interpolation.
    words(dv, 0x300, [0x200, 0, 0x00000101, 0, 0xef000000, 0]);
    words(dv, 0x340, [0x200, 0, 0x033d0101, 0, 0xef000000, 0]);
    words(dv, 0x400, [0xffff0001, 0, 0, 0xffffffff, 0x00010001, 0, 0, 0xffffffff,
      0xffffffff, 0, 0, 0xffffffff]);
    words(dv, 0x500, [0x3d3e3f00]);
    const { state, microcode } = makeMicrocode(dv, 0x100);
    const draws = [];
    microcode.renderer.flushTris = tb => {
      if (!tb.empty()) draws.push(Array.from(tb.positions.slice(0, tb.numTris * 12)));
      tb.reset();
    };
    executeDisplayList(state, microcode, { bailAfter: 0 });
    expect(draws).toEqual([]);
    expect(state.pc).toBe(0x110);
    expect(state.projectedVertices[63].set).toBe(true);
    executeDisplayList(state, microcode);
    const triangle = [-0.5, 0.5, -511 / 512, 1, 0.5, 0.5, -511 / 512, 1,
      -0.5, -0.5, -511 / 512, 1];
    expect(draws).toEqual([triangle, triangle]);
    expect(state.pc).toBe(0);
  });
});
