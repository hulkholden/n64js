import { describe, expect, test } from 'bun:test';
import { Transform4D } from '../graphics/Transform4D.js';
import { executeDisplayList } from './display_list.js';
import { GBI0 } from './gbi0.js';
import { GBI1 } from './gbi1.js';
import { GBI2 } from './gbi2.js';
import { GBI2SDEX } from './gbi_s2dex.js';
import { NullRenderer } from './null_renderer.js';
import { RSPState } from './rsp_state.js';

const base = [2, 0, 0, 7, 0, 3, 0, 0, 0, 0, 4, 0, 0, 0, 0, 1];
const translation = [1, 0, 0, 5, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const replacement = [7, 0, 0, 0, 0, 8, 0, 0, 0, 0, 9, 0, 0, 0, 0, 1];
const projection = [0.5, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function harness(Type) {
  const ramDV = new DataView(new ArrayBuffer(0x1000));
  // RSP matrices store transposed integer and fractional halves.
  [base, translation, replacement, projection].forEach((matrix, index) => {
    matrix.forEach((value, i) => {
      const offset = (i % 4) * 8 + (i >> 2) * 2;
      const fixed = value * 65536;
      ramDV.setInt16(0x400 + index * 64 + offset, fixed >> 16);
      ramDV.setUint16(0x420 + index * 64 + offset, fixed & 0xffff);
    });
  });
  [1, 2, 3].forEach((value, i) => ramDV.setInt16(0x600 + i * 2, value));
  ramDV.setUint32(0x60c, 0xffffffff);
  const state = new RSPState();
  state.reset(ramDV, 8);
  const renderer = new NullRenderer(state);
  // Keep vertex results in clip coordinates for direct numeric assertions.
  renderer.nativeTransform.viTransform = new Transform4D();
  state.viewport.transform = new Transform4D();
  const microcode = new Type(state, ramDV);
  microcode.renderer = renderer;
  const gbi2 = Type === GBI2;
  return {
    state, ramDV, renderer,
    matrix(address, { load = false, push = false, projection = false } = {}) {
      return [gbi2
        ? 0xda380000 | (push ? 0 : 1) | (load ? 2 : 0) | (projection ? 4 : 0)
        : 0x01000040 | ((load ? 2 : 0) | (push ? 4 : 0) | (projection ? 1 : 0)) << 16,
      address];
    },
    pop: gbi2 ? [0xd8380002, 64] : [0xbd000000, 0],
    vertex: [gbi2 ? 0x01001002 : Type === GBI0 ? 0x04000010 : 0x0400040f, 0x600],
    run(commands, options = {}) {
      [...commands, [gbi2 ? 0xdf000000 : 0xb8000000, 0]].forEach(([cmd0, cmd1], i) => {
        ramDV.setUint32(8 + i * 8, cmd0);
        ramDV.setUint32(12 + i * 8, cmd1);
      });
      state.pc = 8;
      executeDisplayList(state, microcode, options);
    },
  };
}

for (const Type of [GBI0, GBI1, GBI2]) {
  describe(`${Type.name} matrix stack commands`, () => {
    test('retains a loaded base through excess pops for both vertices and matrix multiplication', () => {
      const h = harness(Type);
      expect(h.state.modelview).toHaveLength(1);
      expect(h.state.projection).toHaveLength(1);
      h.run([
        h.matrix(0x4c0, { load: true, projection: true }),
        h.matrix(0x400, { load: true }),
        h.pop, h.pop, h.vertex,
      ]);
      expect([...h.state.modelview[0].elems]).toEqual(base);
      expect([...h.state.projectedVertices[0].pos.elems]).toEqual([4.5, 12, 12, 1]);
      h.run([h.matrix(0x440), h.vertex]);
      // Base * translation, not translation * base or an identity fallback.
      expect(h.state.modelview).toHaveLength(1);
      expect([...h.state.projectedVertices[0].pos.elems]).toEqual([9.5, 12, 12, 1]);
      h.run([h.pop, h.matrix(0x480, { load: true }), h.vertex]);
      expect(h.state.modelview).toHaveLength(1);
      expect(Object.hasOwn(h.state.modelview, '-1')).toBe(false);
      expect([...h.state.projectedVertices[0].pos.elems]).toEqual([3.5, 32, 27, 1]);
    });

    test('push saves the previous matrix for both MUL and LOAD; NOPUSH replaces only the top', () => {
      const h = harness(Type);
      h.run([h.matrix(0x400, { load: true }), h.matrix(0x440, { push: true })]);
      expect(h.state.modelview).toHaveLength(2);
      expect([...h.state.modelview[0].elems]).toEqual(base);
      expect(h.state.modelview[1].elems[3]).toBe(17);
      h.run([h.pop, h.matrix(0x480, { load: true, push: true }), h.matrix(0x440)]);
      expect(h.state.modelview).toHaveLength(2);
      expect(h.state.modelview[1].elems[0]).toBe(7);
      expect(h.state.modelview[1].elems[3]).toBe(35);
      h.run([h.pop, h.pop]);
      expect(h.state.modelview).toHaveLength(1);
      expect([...h.state.modelview[0].elems]).toEqual(base);
    });

    test('projection operations ignore PUSH and preserve the modelview stack', () => {
      const h = harness(Type);
      h.run([
        h.matrix(0x400, { load: true }), h.matrix(0x480, { load: true, push: true }),
        h.matrix(0x4c0, { load: true, push: true, projection: true }),
        h.matrix(0x440, { push: true, projection: true }),
      ]);
      expect(h.state.projection).toHaveLength(1);
      expect([...h.state.projection[0].elems]).toEqual([0.5, 0, 0, 2.5, 0, 2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
      expect(h.state.modelview).toHaveLength(2);
      expect([...h.state.modelview[1].elems]).toEqual(replacement);
      if (Type !== GBI2) {
        h.run([[0xbd000000, 1]]); // GBI0/1 projection pop is unsupported.
        expect(h.state.modelview).toHaveLength(2);
        expect(h.state.projection).toHaveLength(1);
      }
    });
  });
}

describe('F3DEX2 matrix stack', () => {
  test('decodes zero, multiple and excessive pop counts, including in disassembly', () => {
    const h = harness(GBI2);
    h.run([
      h.matrix(0x400, { load: true }),
      h.matrix(0x440, { push: true }),
      h.matrix(0x480, { load: true, push: true }),
      h.matrix(0x440, { push: true }),
      [0xd8380002, 0],
    ]);
    expect(h.state.modelview).toHaveLength(4);
    expect(h.state.modelview[3].elems[3]).toBe(35);
    const lines = [];
    h.run([[0xd8380002, 128]], {
      disassembler: { begin() {}, text: line => lines.push(line), end() {} },
    });
    expect(lines[0]).toBe('gsSPPopMatrixN(G_MTX_MODELVIEW, 2);');
    expect(h.state.modelview).toHaveLength(2);
    expect(h.state.modelview[1].elems[3]).toBe(17);
    h.run([[0xd8380002, 64 * 10], [0xd8380002, 64 * 10]]);
    expect(h.state.modelview).toHaveLength(1);
    expect([...h.state.modelview[0].elems]).toEqual(base);
  });

  test('preserves saved and current matrices across F3DEX2 / S2DEX2 loads', () => {
    const h = harness(GBI2);
    let loads = 0;
    h.run([
      h.matrix(0x4c0, { load: true, projection: true }),
      h.matrix(0x400, { load: true }), h.matrix(0x480, { load: true, push: true }),
      [0xe1000000, 0x800], [0xdd0007ff, 0x1000],
      [0xe1000000, 0x900], [0xdd0007ff, 0x2000],
      h.pop, h.pop, h.matrix(0x440), h.vertex,
    ], {
      loadMicrocode: () => {
        loads++;
        expect(h.state.modelview).toHaveLength(2);
        expect([...h.state.modelview[0].elems]).toEqual(base);
        expect([...h.state.modelview[1].elems]).toEqual(replacement);
        expect([...h.state.projection[0].elems]).toEqual(projection);
        const microcode = new (loads === 1 ? GBI2SDEX : GBI2)(h.state, h.ramDV);
        microcode.renderer = h.renderer;
        return microcode;
      },
    });
    expect(loads).toBe(2);
    expect(h.state.modelview).toHaveLength(1);
    expect([...h.state.projectedVertices[0].pos.elems]).toEqual([9.5, 12, 12, 1]);
  });
});
