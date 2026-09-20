import { describe, expect, test } from 'bun:test';
import { Matrix4x4 } from './Matrix4x4.js';
import { Vector3 } from './Vector3.js';
import { Vector4 } from './Vector4.js';

function matrix(values) {
  return new Matrix4x4(new Float32Array(values));
}

describe('Matrix4x4.multiply', () => {
  test('retains small terms when large terms cancel in every row and column', () => {
    const a = matrix([
      256, 1, -256, 0,
      -256, -1, 256, 0,
      256, 2, -256, 0,
      -256, -2, 256, 0,
    ]);
    const b = matrix([
      256, -256, 256, -256,
      1 / 1024, -1 / 1024, 1 / 65536, -1 / 65536,
      256, -256, 256, -256,
      0, 0, 0, 0,
    ]);
    expect([...a.multiply(b).elems]).toEqual([
      1 / 1024, -1 / 1024, 1 / 65536, -1 / 65536,
      -1 / 1024, 1 / 1024, -1 / 65536, 1 / 65536,
      2 / 1024, -2 / 1024, 2 / 65536, -2 / 65536,
      -2 / 1024, 2 / 1024, -2 / 65536, 2 / 65536,
    ]);
  });

  test('matches once-rounded signed dot products without modifying either input', () => {
    const a = matrix(Array.from({ length: 16 }, (_, i) => (i - 7) / 3));
    const b = matrix(Array.from({ length: 16 }, (_, i) => (9 - i) / 7));
    const beforeA = a.elems.slice();
    const beforeB = b.elems.slice();
    const result = a.multiply(b);
    for (let r = 0; r < 4; ++r) {
      for (let c = 0; c < 4; ++c) {
        let sum = 0;
        for (let k = 0; k < 4; ++k) sum += a.elems[4 * r + k] * b.elems[4 * k + c];
        expect(result.elems[4 * r + c]).toBe(Math.fround(sum));
      }
    }
    expect(result.elems).toBeInstanceOf(Float32Array);
    expect(a.elems).toEqual(beforeA);
    expect(b.elems).toEqual(beforeB);
    expect(a.multiply(Matrix4x4.identity()).elems).toEqual(beforeA);
    expect(Matrix4x4.identity().multiply(a).elems).toEqual(beforeA);
  });

  test('composes scale, rotation and translation in the expected order', () => {
    const scale = matrix([2, 0, 0, 0, 0, -3, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 1]);
    const rotate = matrix([0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const translate = matrix([1, 0, 0, 7, 0, 1, 0, -11, 0, 0, 1, 13, 0, 0, 0, 1]);
    const combined = translate.multiply(rotate).multiply(scale);
    expect([...combined.elems]).toEqual([0, 3, 0, 7, 2, 0, 0, -11, 0, 0, 0.5, 13, 0, 0, 0, 1]);
    const point = new Vector4();
    combined.transformPoint(new Vector3(2, -4, 6), point);
    expect([...point.elems]).toEqual([-5, -7, 16, 1]);
  });
});
