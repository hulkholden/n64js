import { describe, expect, test } from 'bun:test';
import { Matrix4x4 } from './Matrix4x4.js';
import { Vector3 } from './Vector3.js';
import { Vector4 } from './Vector4.js';

function matrix(values) {
  return new Matrix4x4(new Float64Array(values));
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

  test('preserves Number precision in signed dot products without modifying either input', () => {
    const a = matrix(Array.from({ length: 16 }, (_, i) => (i - 7) / 3));
    const b = matrix(Array.from({ length: 16 }, (_, i) => (9 - i) / 7));
    const beforeA = a.elems.slice();
    const beforeB = b.elems.slice();
    const result = a.multiply(b);
    for (let r = 0; r < 4; ++r) {
      for (let c = 0; c < 4; ++c) {
        let sum = 0;
        for (let k = 0; k < 4; ++k) {
          sum += a.elems[4 * r + k] * b.elems[4 * k + c];
        }
        expect(result.elems[4 * r + c]).toBe(sum);
      }
    }
    expect(result.elems).toBeInstanceOf(Float64Array);
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

describe('Matrix4x4 precision', () => {
  const ulp = 1 / 65536;

  test('constructors and factories provide full precision storage for later writes', () => {
    for (const matrix of [
      new Matrix4x4(),
      new Matrix4x4(new Float32Array(16)),
      new Matrix4x4(Array(16).fill(0)),
      new Matrix4x4(new Float64Array(16)),
      Matrix4x4.identity(),
      Matrix4x4.makeOrtho(-1, 1, -1, 1, -1, 1),
    ]) {
      matrix.elems[0] = 256 + ulp;
      expect(matrix.elems[0]).toBe(256 + ulp);
    }
  });

  test('multiplication retains fractional products and cancellation within a dot product', () => {
    const a = new Matrix4x4([
      256, ulp, -256, ulp,
      -256, -ulp, 256, -ulp,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]);
    const b = new Matrix4x4([
      1, 0, 0, 0,
      1, 1, 0, 0,
      1, 0, 1, 0,
      1, 0, 0, 1,
    ]);
    const product = a.multiply(b);
    expect(product.elems[0]).toBe(2 * ulp);
    expect(product.elems[4]).toBe(-2 * ulp);
    const scale = Matrix4x4.identity();
    scale.elems[0] = 0.5;
    expect(product.multiply(scale).elems[0]).toBe(ulp);
    expect(product.multiply(scale).elems[4]).toBe(-ulp);
  });
});
