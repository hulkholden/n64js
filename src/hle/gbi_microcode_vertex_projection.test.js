import { describe, expect, test } from 'bun:test';
import { Matrix4x4 } from '../graphics/Matrix4x4.js';
import { Transform4D } from '../graphics/Transform4D.js';
import { Vector3 } from '../graphics/Vector3.js';
import { Vector4 } from '../graphics/Vector4.js';
import { GBIMicrocode } from './gbi_microcode.js';
import { NativeTransform } from './native_transform.js';
import { ProjectedVertex } from './projected_vertex.js';

describe('homogeneous vertex projection', () => {
  test('preserves finite clip coordinates at the eye plane in the Mario head intro', () => {
    // Captured at graphics task 99: these vertices have clip w = 0. Dividing
    // by w before applying the viewport used to turn every component into NaN.
    const matrix = new Matrix4x4(new Float32Array([
      1.8106536865234375, 0, 0, 0,
      0, 2.4141998291015625, 0, 0,
      0, 0, -1.0120697021484375, -60.36216735839844,
      0, 0, -1, 0,
    ]));
    const viewport = new Transform4D(new Vector4(160, -120, 511, 1), new Vector4(160, 120, 511, 0));
    const native = new NativeTransform();
    native.initDimensions(320, 237);
    const microcode = new GBIMicrocode(null, null);
    for (const xyz of [new Vector3(-64, 0, 0), new Vector3(64, 0, 0), new Vector3(64, 128, 0)]) {
      const clip = new Vector4();
      matrix.transformPoint(xyz, clip);
      const vertex = new ProjectedVertex();
      microcode.projectInPlace(vertex, xyz, matrix, viewport, native.viTransform);
      expect([...vertex.pos.elems].every(Number.isFinite)).toBe(true);
      expect(vertex.pos.w).toBe(0);
      expect(vertex.pos.x).toBe(clip.x);
      expect(vertex.pos.y).toBeCloseTo(clip.y * 120 / 118.5, 4);
      expect(vertex.pos.z).toBeCloseTo(clip.z * 511 / 512, 4);
      expect(vertex.clipFlags).toBe(microcode.calculateClipFlags(clip));
    }
  });

  test('maps viewport scale and translation without changing homogeneous w or clip flags', () => {
    const viewport = new Transform4D(new Vector4(80, -60, 256, 1), new Vector4(120, 90, 127, 0));
    const native = new NativeTransform();
    const microcode = new GBIMicrocode(null, null);
    // Include both sides of the eye plane and a w too small for the old
    // Float32 perspective divide to represent its intermediate coordinates.
    for (const w of [2, -2, 1e-40]) {
      const matrix = Matrix4x4.identity();
      matrix.elems[15] = w;
      const vertex = new ProjectedVertex();
      const xyz = new Vector3(2, -4, 8);
      const clip = new Vector4();
      matrix.transformPoint(xyz, clip);
      microcode.projectInPlace(vertex, xyz, matrix, viewport, native.viTransform);
      expect(vertex.pos.w).toBe(clip.w);
      expect(vertex.pos.x).toBeCloseTo(1 - clip.w / 4, 6);
      expect(vertex.pos.y).toBeCloseTo(-2 + clip.w / 4, 6);
      expect(vertex.pos.z).toBeCloseTo(4 - clip.w * 0.75, 6);
      expect(vertex.clipFlags).toBe(microcode.calculateClipFlags(clip));
    }
  });
});
