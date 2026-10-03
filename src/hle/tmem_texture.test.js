import { expect, test } from 'bun:test';
import { TMEM } from './tmem.js';
import { TMEMTexture } from './tmem_texture.js';

function fixture() {
  const images = [], updates = [], deleted = [], bindings = [];
  const gl = {
    TEXTURE0: 100, TEXTURE_2D: 200, R8UI: 300, RED_INTEGER: 400, UNSIGNED_BYTE: 500,
    createTexture: () => ({}), deleteTexture: value => deleted.push(value),
    activeTexture: value => bindings.push(value), bindTexture() {}, texParameteri() {},
    texImage2D: (...args) => images.push(args), texSubImage2D: (...args) => updates.push(args),
  };
  return { gpu: new TMEMTexture(gl), tmem: new TMEM(), images, updates, deleted, bindings, gl };
}

test('TMEM uploads exact integer bytes once and reuses unchanged snapshots', () => {
  const { gpu, tmem, images, updates, bindings, gl } = fixture();
  tmem.tmemData[0] = 0x81;
  gpu.bind(tmem);
  expect(images[0]).toEqual([gl.TEXTURE_2D, 0, gl.R8UI, 64, 64, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, tmem.tmemData]);
  expect(bindings).toEqual([102]);
  gpu.bind(tmem);
  tmem.tmemData.fill(0);
  tmem.tmemData[0] = 0x81; // An identical reload needs no upload.
  gpu.bind(tmem);
  expect(images).toHaveLength(1);
  expect(updates).toHaveLength(0);
});

test('TMEM upload detects edits in either bank without tile hash invalidation', () => {
  const { gpu, tmem, updates, gl } = fixture();
  gpu.bind(tmem);
  for (const address of [0, 2048, 4095]) {
    tmem.tmemData[address]++;
    gpu.bind(tmem);
    gpu.bind(tmem);
  }
  expect(updates).toHaveLength(3);
  expect(updates[0]).toEqual([gl.TEXTURE_2D, 0, 0, 0, 64, 64, gl.RED_INTEGER, gl.UNSIGNED_BYTE, tmem.tmemData]);
});

test('reset releases the texture and forces a fresh upload even for unchanged bytes', () => {
  const { gpu, tmem, images, deleted } = fixture();
  gpu.bind(tmem);
  const previous = gpu.texture;
  gpu.reset();
  gpu.reset();
  expect(deleted).toEqual([previous]);
  gpu.bind(tmem);
  expect(gpu.texture).not.toBe(previous);
  expect(images).toHaveLength(2);
});
