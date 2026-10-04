import { expect, test } from 'bun:test';
import { TMEM } from './tmem.js';
import { TMEMTexture } from './tmem_texture.js';

function fixture(maxEntries) {
  const images = [], updates = [], deleted = [], bindings = [];
  let bound;
  const gl = {
    TEXTURE0: 100, TEXTURE_2D: 200, R8UI: 300, RED_INTEGER: 400, UNSIGNED_BYTE: 500,
    createTexture: () => ({}), deleteTexture: value => deleted.push(value),
    activeTexture: value => bindings.push(value),
    bindTexture: (target, texture) => { bound = texture; },
    texParameteri() {},
    texImage2D: (...args) => { images.push(args); bound.bytes = args[8].slice(); },
    texSubImage2D: (...args) => { updates.push(args); bound.bytes = args[8].slice(); },
  };
  const gpu = new TMEMTexture(gl, maxEntries), tmem = new TMEM();
  const load = value => { tmem.tmemData.fill(value); gpu.bind(tmem); return gpu.texture; };
  return { gpu, tmem, load, images, updates, deleted, bindings, gl };
}

test('TMEM uploads exact integer bytes and skips hashing unchanged snapshots', () => {
  const { gpu, tmem, images, updates, bindings, gl } = fixture();
  let hashes = 0;
  const hash = tmem.hashContents.bind(tmem);
  tmem.hashContents = () => { hashes++; return hash(); };
  tmem.tmemData[0] = 0x81;
  gpu.bind(tmem);
  expect(images[0]).toEqual([gl.TEXTURE_2D, 0, gl.R8UI, 64, 64, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, tmem.tmemData]);
  expect(bindings).toEqual([102]);
  gpu.bind(tmem, 3);
  tmem.tmemData.fill(0);
  tmem.tmemData[0] = 0x81; // An identical reload needs no hash or upload.
  gpu.bind(tmem);
  expect(bindings).toEqual([102, 103, 102]);
  expect(hashes).toBe(1);
  expect(images).toHaveLength(1);
  expect(updates).toHaveLength(0);
});

test('TMEM cache detects edits in either bank without tile hash invalidation', () => {
  const { gpu, tmem, images, updates } = fixture();
  gpu.bind(tmem);
  for (const address of [0, 2048, 4095]) {
    const previous = gpu.texture;
    tmem.tmemData[address]++;
    gpu.bind(tmem);
    expect(gpu.texture).not.toBe(previous);
    expect(gpu.texture.bytes).toEqual(tmem.tmemData);
    gpu.bind(tmem);
  }
  expect(images).toHaveLength(4);
  expect(updates).toHaveLength(0);
});

test('returning to an earlier snapshot reuses its GPU texture without uploading', () => {
  const { gpu, load, images, updates } = fixture();
  const first = load(0x12), second = load(0x34);
  expect(first.bytes[0]).toBe(0x12);
  expect(second.bytes[0]).toBe(0x34);
  expect(load(0x12)).toBe(first);
  expect(load(0x34)).toBe(second);
  expect(images).toHaveLength(2);
  expect(updates).toHaveLength(0);
  expect(gpu.hits).toBe(2);
  expect(gpu.misses).toBe(2);
});

test('a full cache recycles the least recently used texture, including after cache hits', () => {
  const { gpu, load, images, updates, deleted } = fixture(2);
  const first = load(1), second = load(2);
  expect(load(1)).toBe(first); // Protect the older allocation by visiting it.
  expect(load(3)).toBe(second); // Evict snapshot 2 and reuse its allocation.
  expect(first.bytes[0]).toBe(1);
  expect(second.bytes[0]).toBe(3);
  expect(load(3)).toBe(second); // Unchanged draws must leave it newest.
  expect(load(2)).toBe(first); // Snapshot 2 was evicted and must be uploaded.
  expect(first.bytes[0]).toBe(2);
  expect(gpu.entries.size).toBe(2);
  expect(gpu.evictions).toBe(2);
  expect(images).toHaveLength(2);
  expect(updates).toHaveLength(2);
  expect(deleted).toHaveLength(0);
});

test('one-entry cache keeps reusing the same allocation on every changed snapshot', () => {
  const { gpu, load, tmem, images, updates, gl } = fixture(1);
  const texture = load(0);
  expect(load(1)).toBe(texture);
  expect(load(0)).toBe(texture);
  expect(images).toHaveLength(1);
  expect(updates).toHaveLength(2);
  expect(updates[0]).toEqual([gl.TEXTURE_2D, 0, 0, 0, 64, 64, gl.RED_INTEGER, gl.UNSIGNED_BYTE, tmem.tmemData]);
  expect(gpu.entries.size).toBe(1);
});

test('zero is a valid hash-only cache key', () => {
  const { gpu, load, tmem, images } = fixture();
  tmem.hashContents = () => 0;
  const texture = load(1);
  expect(load(2)).toBe(texture);
  expect(images).toHaveLength(1);
  expect(gpu.hits).toBe(1);
});

test('reset releases all textures and forces a fresh upload even for unchanged bytes', () => {
  const { gpu, load, tmem, images, deleted } = fixture(2);
  const first = load(1), second = load(2);
  load(3); // Recycles first; reset must not delete an allocation twice.
  gpu.reset();
  gpu.reset();
  expect(new Set(deleted)).toEqual(new Set([first, second]));
  expect(deleted).toHaveLength(2);
  expect(gpu.entries.size).toBe(0);
  expect(gpu.hits).toBe(0);
  expect(gpu.misses).toBe(0);
  expect(gpu.evictions).toBe(0);
  gpu.bind(tmem);
  expect(gpu.texture).not.toBe(first);
  expect(gpu.texture).not.toBe(second);
  expect(images).toHaveLength(3);
});

test('TMEM cache rejects capacities that cannot retain a current snapshot', () => {
  for (const capacity of [0, -1, 0.5, NaN]) {
    expect(() => fixture(capacity)).toThrow(RangeError);
  }
});
