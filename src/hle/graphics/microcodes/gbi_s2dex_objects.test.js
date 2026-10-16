import { describe, expect, test } from 'bun:test';
import { drawS2DEXObject, s2dexObjectCases } from '../../../../tools/s2dex_object_cases.js';
import { RSPState } from '../rsp_state.js';
import { GBI1SDEX, GBI2SDEX } from './gbi_s2dex.js';

function harness(Type) {
  const ram = new DataView(new ArrayBuffer(1024));
  const state = new RSPState();
  state.reset(ram, 0);
  const microcode = new Type(state, ram);
  const rectangles = [], sprites = [], warnings = [];
  microcode.renderer = {
    texRect: (...args) => rectangles.push(args),
    texRectRot: (...args) => sprites.push(args),
  };
  microcode.warn = (...args) => warnings.push(args);
  return { ram, state, microcode, rectangles, sprites, warnings };
}

for (const Type of [GBI1SDEX, GBI2SDEX]) {
  describe(`${Type.name} object coordinates`, () => {
    for (const { options, rect } of s2dexObjectCases) {
      test(`matches microcode RDP output: ${JSON.stringify(options)}`, () => {
        const h = harness(Type);
        drawS2DEXObject(h, options);
        const [x0, y0, x1, y1, s0, t0, ds, dt] = rect;
        expect(h.rectangles).toEqual([[0, x0, y0, x1, y1, s0, t0,
          s0 + (x1 - x0) * ds, t0 + (y1 - y0) * dt, false]]);
        expect(h.warnings).toEqual([]);
        expect(h.state.tiles[0]).toMatchObject({ cmS: 2, cmT: 2, lrs: 28, lrt: 12 });
      });
    }

    for (const flags of [0, 1, 16, 17]) {
      test(`rotated sprite reverses UVs without reversing its geometry, flags=${flags}`, () => {
        const h = harness(Type);
        const options = { rot: true, matrix: { a: 0, b: -1, c: 1, d: 0, x: 32 } };
        drawS2DEXObject(h, options);
        drawS2DEXObject(h, { ...options, flags });
        const [normal, flipped] = h.sprites;
        // S2DEX 1.07's emitted triangle edges for this synthetic 90° matrix.
        expect(normal.slice(0, 9)).toEqual([0, 12.5, 9.5, 12.5, 17.5, 8.5, 9.5, 8.5, 17.5]);
        expect(flipped.slice(0, 9)).toEqual(normal.slice(0, 9));
        expect(flipped.slice(9)).toEqual([
          normal[flags & 1 ? 11 : 9], normal[flags & 16 ? 12 : 10],
          normal[flags & 1 ? 9 : 11], normal[flags & 16 ? 10 : 12],
        ]);
        expect(h.warnings).toEqual([]);
      });
    }

    test('zero scales remain finite and shrink modes cannot produce inverted rectangles', () => {
      const h = harness(Type);
      drawS2DEXObject(h, { scale: 0 });
      expect(h.rectangles[0].slice(0, -1).every(Number.isFinite)).toBe(true);
      drawS2DEXObject(h, { mode: 32, width: 1, height: 1 });
      expect(h.rectangles).toHaveLength(1);
    });
  });
}
