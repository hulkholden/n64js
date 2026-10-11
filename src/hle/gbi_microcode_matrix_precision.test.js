import { describe, expect, test } from 'bun:test';
import { Matrix4x4 } from '../graphics/Matrix4x4.js';
import { Vector3 } from '../graphics/Vector3.js';
import { Vector4 } from '../graphics/Vector4.js';
import { GBIMicrocode } from './gbi_microcode.js';
import { ProjectedVertex } from './projected_vertex.js';
import { TriangleBuffer } from './triangle_buffer.js';

const ulp = 1 / 65536;

function loadMatrix(values) {
  const address = 64;
  const ram = new DataView(new ArrayBuffer(address + 64));
  values.forEach((value, i) => {
    const offset = address + (i % 4) * 8 + (i >> 2) * 2;
    const fixed = value * 65536;
    ram.setInt16(offset, fixed >> 16);
    ram.setUint16(offset + 32, fixed & 0xffff);
  });
  return new GBIMicrocode(null, ram).loadMatrix(address, 64);
}

describe('GBIMicrocode matrix precision', () => {
  test('loads signed 16.16 values across float32 precision boundaries', () => {
    const values = [
      128 - ulp, 128 + ulp, 256 - ulp, 256 + ulp,
      -128 - ulp, -128 + ulp, -256 - ulp, -256 + ulp,
      512 + ulp, -512 - ulp, 16384 + ulp, -16384 - ulp,
      32768 - ulp, -32768, ulp, -ulp,
    ];
    const matrix = loadMatrix(values);
    expect([...matrix.elems]).toEqual(values);
    expect([...matrix.copy().elems]).toEqual(values);
    expect([...matrix.multiply(Matrix4x4.identity()).elems]).toEqual(values);
    expect([...Matrix4x4.identity().multiply(matrix).elems]).toEqual(values);
    const copy = matrix.copy();
    copy.elems[0] = 0;
    expect(matrix.elems[0]).toBe(values[0]);
  });

  test('preserves small positive homogeneous w through copies, products and rendering storage', () => {
    const values = Array(16).fill(0);
    values[0] = 256 + ulp;
    values[12] = 256 + ulp;
    values[15] = -256;
    const matrix = loadMatrix(values);
    for (const m of [matrix, matrix.copy(), matrix.multiply(Matrix4x4.identity())]) {
      const result = new Vector4();
      m.transformPoint(new Vector3(1, 0, 0), result);
      expect(result.w).toBe(ulp);
      // Float32 vertex/rendering storage may round x, but only after the
      // complete matrix dot product has preserved the cancellation in w.
      expect(result.x).toBe(Math.fround(256 + ulp));
      const vertex = new ProjectedVertex();
      vertex.pos = result;
      const buffer = new TriangleBuffer(1);
      buffer.pushTri(vertex, vertex, vertex);
      expect(buffer.positions).toBeInstanceOf(Float32Array);
      expect(buffer.positions[3]).toBe(ulp);
    }
  });
});
