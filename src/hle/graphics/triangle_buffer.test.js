import { expect, test } from 'bun:test';
import { ProjectedVertex } from './projected_vertex.js';
import { TriangleBuffer } from './triangle_buffer.js';

for (const batchSize of [1, 2, 4]) {
  test(`fills all 64 triangles with batches of ${batchSize}`, () => {
    const buffer = new TriangleBuffer(64);
    const vertex = new ProjectedVertex();

    // Match the command handlers: append a batch, then check for the next one.
    do {
      for (let i = 0; i < batchSize; ++i) {
        expect(buffer.pushTri(vertex, vertex, vertex)).toBe(true);
      }
    } while (buffer.hasCapacity(batchSize));

    expect(buffer.numTris).toBe(64);
    expect(buffer.hasCapacity(1)).toBe(false);
    expect(buffer.pushTri(vertex, vertex, vertex)).toBe(false);
    expect(buffer.pushTriWithUV(vertex, vertex, vertex, 0, 0, 1, 0, 0, 1)).toBe(false);
    expect(buffer.numTris).toBe(64);

    buffer.reset();
    expect(buffer.empty()).toBe(true);
    expect(buffer.hasCapacity(64)).toBe(true);
    expect(buffer.hasCapacity(65)).toBe(false);
  });
}
