import { bench, run } from 'mitata';
import { Matrix4x4 } from './Matrix4x4.js';

// Run with: bun src/graphics/Matrix4x4.bench.js
// Vary signed, fractional inputs and consume every result outside the timing.
const matrices = Array.from({ length: 64 }, (_, n) => new Matrix4x4(
  Float64Array.from({ length: 16 }, (_, i) => ((n * 37 + i * 19) % 257 - 128) / 64),
));
const results = new Array(matrices.length);

bench('64 matrix products', () => {
  for (let i = 0; i < matrices.length; ++i) {
    results[i] = matrices[i].multiply(matrices[(i + 1) % matrices.length]);
  }
});

bench('64 three-matrix transform chains', () => {
  for (let i = 0; i < matrices.length; ++i) {
    results[i] = matrices[i].multiply(matrices[(i + 1) % matrices.length])
      .multiply(matrices[(i + 2) % matrices.length]);
  }
});

await run({});
console.log('Matrix checksum:', results.reduce((sum, matrix) =>
  sum + matrix.elems.reduce((total, value) => total + value, 0), 0));
