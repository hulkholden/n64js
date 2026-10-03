import { describe, expect, test } from 'bun:test';
import { Matrix4x4 } from '../graphics/Matrix4x4.js';
import { NullRenderer } from './null_renderer.js';
import { RSPState } from './rsp_state.js';
import { T3DUX } from './t3dux.js';
import { Turbo3D } from './turbo3d.js';

for (const [Type, variant] of [[Turbo3D], [T3DUX, false], [T3DUX, true]]) {
  describe(`${Type.name} affine projection (${variant ?? 'SDK'})`, () => {
    function fixture(w, count = 1) {
      const ram = new DataView(new ArrayBuffer(1024));
      const state = new RSPState();
      state.reset(ram, 0);
      const microcode = new Type(state, ram, variant);
      microcode.renderer = new NullRenderer(state);
      state.viewport.transform = microcode.renderer.nativeTransform.viTransform;
      state.geometryMode.shadeSmooth = false;
      const turbo = Type === Turbo3D;
      [[-2, -2], [6, -2], [-2, 10]].forEach(([x, y], i) => {
        const offset = i * (turbo ? 16 : 8);
        ram.setInt16(offset, x);
        ram.setInt16(offset + 2, y);
        ram.setInt16(offset + 4, w[i]);
      });
      // x/y unchanged, z=0, homogeneous w comes from the input z.
      microcode.transform = new Matrix4x4([1, 0, 0, 0, 0, 1, 0, 0,
        0, 0, 0, 0, 0, 0, 1, 0]);
      if (turbo) {
        microcode.loadObjectVertices(0, 0, 3, 0);
      } else {
        microcode.loadVertices(0, 0, 3, 0);
        microcode.attributeValid[0] = 1;
      }
      for (let i = 0; i < count; i++) {
        ram.setUint32(64 + i * (turbo ? 4 : 8), 0x00010200);
      }
      const draws = [];
      microcode.renderer.flushTris = (tb, options) => {
        if (!tb.empty()) {
          draws.push({ positions: [...tb.positions.slice(0, tb.numTris * 12)], options });
        }
        tb.reset();
      };
      const draw = () => turbo ? microcode.drawObjectTriangles(64, count) : microcode.drawTriangles(64, count, 0);
      const vertices = (turbo ? state.projectedVertices : microcode.vertices).slice(0, 3);
      return { state, vertices, draw, draws, ram };
    }

    for (const w of [[0, 0, 0], [2, 2, 0], [2, 2, -2], [-2, -2, -2], [1, 2, 4]]) {
      test(`keeps finite homogeneous positions through submission for w=${w}`, () => {
        const { vertices, draw, draws } = fixture(w);
        for (let i = 0; i < 3; i++) {
          expect([...vertices[i].pos.elems].every(Number.isFinite)).toBe(true);
          expect(vertices[i].pos.w).toBe(w[i]);
        }
        draw();
        // T3DUX rejects the all-eye-plane triangle as degenerate.
        if (Type === Turbo3D || w.some(value => value !== 0)) {
          expect(draws).toHaveLength(1);
          expect(draws[0].positions).toEqual(vertices.flatMap(v => [...v.pos.elems]));
          expect(draws[0].options).toEqual({ affineUV: true });
        }
      });
    }

    test('retains affine mode on capacity flushes', () => {
      const { draw, draws } = fixture([1, 2, 4], 65);
      draw();
      expect(draws.map(d => d.positions.length / 12)).toEqual([64, 1]);
      expect(draws.every(d => d.options.affineUV)).toBe(true);
    });

    if (Type === T3DUX) {
      test('culls by the visible winding when a vertex is on or behind the eye plane', () => {
        for (const w of [[2, 2, 0], [2, 2, -2], [1, 2, 4]]) {
          const { state, ram, draw, draws } = fixture(w);
          state.geometryMode.cullBack = true;
          draw();
          expect(draws).toHaveLength(1);
          ram.setUint32(64, 0x00020100);
          draw();
          expect(draws).toHaveLength(1);
        }
      });
    }
  });
}
