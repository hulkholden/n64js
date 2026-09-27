import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { createMicrocodeHash } from './audio_microcode_hash.js';
import { createAudioMicrocodeClassifier } from './audio_microcode_classifier.js';
import { createAudioReferenceClassifier } from '../inventory/audio_reference.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const clone = raw => Object.fromEntries(Object.entries(raw).map(([key, bytes]) => [key, bytes.slice()]));
const variants = [{ cache: false }, {}];

// Synthetic programs with two overlapping code lengths and one constants table.
function fixture() {
  let state = 12345;
  const random = n => Uint8Array.from({ length: n }, () => { state = (Math.imul(state, 1664525) + 1013904223) | 0; return state >>> 24; });
  const raw = { task: new Uint8Array(64), imem: random(4096), code: random(4096), data: random(4096) };
  const task = new DataView(raw.task.buffer);
  task.setUint32(0, 2); task.setUint32(0x10, 0x1000); task.setUint32(0x18, 0x3000); task.setUint32(0x1c, 0x800);
  const second = clone(raw); second.code[0x81] ^= 1;
  const manifest = { version: 1, bootstraps: [{ id: 'boot', bytes: 0xcc, sha256: hash(raw.imem.subarray(0, 0xcc)) }],
    programs: [raw, second].map((r, i) => ({ id: `program-${i}`, family: 'ABI1',
      codeBytes: 0x200 + i * 4, codeSha256: hash(r.code.subarray(0, 0x200 + i * 4)),
      dataBytes: 0x2c0, dataSha256: hash(r.data.subarray(0, 0x2c0)),
    })),
  };
  return { raw, second, manifest };
}

describe('bounded browser SHA-256', () => {
  test('matches native SHA-256 at every supported length, including padding and unaligned views', () => {
    const digest = createMicrocodeHash();
    expect(digest(new Uint8Array())).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(digest(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const bytes = new Uint8Array(4100);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 73 + (i >>> 3)) & 255;
    // Descending sizes catch residual scratch bytes from previous hashes.
    for (let n = 4096; n >= 0; n--) expect(digest(bytes.subarray(3, n + 3))).toBe(hash(bytes.subarray(3, n + 3)));
    expect(() => digest(new Uint8Array(4097))).toThrow();
    expect(() => digest([])).toThrow();
  });
});

describe('browser audio classifier', () => {
  test('all strategies agree through cache hits, misses and mutations of the same buffer', () => {
    const { raw, second, manifest } = fixture();
    const reference = createAudioReferenceClassifier(manifest);
    for (const options of variants) {
      const classify = createAudioMicrocodeClassifier(manifest, options);
      expect(classify(raw)).toEqual(reference(raw));
      expect(classify(second)).toEqual(reference(second));
      for (const [field, end] of [['imem', 0xcc], ['code', 0x200], ['data', 0x2c0]]) {
        for (let p = 0; p < end; p++) {
          raw[field][p] ^= 0x80;
          expect(classify(raw)).toEqual(reference(raw));
          expect(classify(raw).status).toBe('unknown');
          raw[field][p] ^= 0x80;
          expect(classify(raw)).toEqual(reference(raw));
        }
      }
      const changed = clone(raw);
      changed.imem.fill(0xff, 0xcc); changed.code.fill(0x11, 0x200); changed.data.fill(0x22, 0x2c0);
      expect(classify(changed)).toEqual(reference(changed));
      const views = Object.fromEntries(Object.entries(raw).map(([key, bytes]) => {
        const buffer = new Uint8Array(bytes.length + 3); buffer.set(bytes, 1);
        return [key, buffer.subarray(1, bytes.length + 1)];
      }));
      expect(classify(views)).toEqual(reference(raw));
    }
  });

  test('revalidates headers and short windows even with warm caches', () => {
    const { raw, manifest } = fixture(), reference = createAudioReferenceClassifier(manifest);
    for (const options of variants) {
      const classify = createAudioMicrocodeClassifier(manifest, options);
      classify(raw);
      for (const [offset, values] of [[0, [1, 3]], [0x10, [0, 0x1001, 0x80002000]], [0x18, [0, 0x3004]],
        [0x1c, [0, 0x2b8, 0x2bf, 0xfc0, 0xfc1, 0xffffffff]], [0x14, [0, 0xffffffff]]]) {
        for (const value of values) {
          const changed = clone(raw); new DataView(changed.task.buffer).setUint32(offset, value);
          expect(classify(changed)).toEqual(reference(changed));
        }
      }
      for (const field of ['task', 'imem', 'code', 'data']) {
        for (const size of [0, 7, 64, 0x2c0, 0xf7f, 4097]) {
          const changed = { ...raw, [field]: new Uint8Array(size) };
          expect(classify(changed)).toEqual(reference(changed));
        }
      }
      for (const bad of [null, {}, { ...raw, code: [] }]) expect(classify(bad)).toEqual(reference(bad));
    }
  });

  test('preserves ambiguity including longer overlapping bootstraps on warm caches', () => {
    const { raw, manifest } = fixture();
    manifest.programs.push({ ...manifest.programs[0], id: 'overlap' });
    for (const options of variants) {
      const classify = createAudioMicrocodeClassifier(manifest, options), reference = createAudioReferenceClassifier(manifest);
      expect(classify(raw)).toEqual(reference(raw));
      expect(classify(raw).status).toBe('ambiguous');
    }
    manifest.bootstraps.push({ id: 'longer', bytes: 0xd0, sha256: hash(raw.imem.subarray(0, 0xd0)) });
    const classify = createAudioMicrocodeClassifier(manifest), reference = createAudioReferenceClassifier(manifest);
    expect(classify(raw)).toEqual(reference(raw));
    raw.imem[0xcc] ^= 1;
    expect(classify(raw)).toEqual(reference(raw));
    raw.imem[0xcc] ^= 1;
    expect(classify(raw).reason).toBe('ambiguous-bootstrap');
  });

  test('copies manifest definitions and isolates cached results from caller mutation', () => {
    const { raw, manifest } = fixture();
    const classify = createAudioMicrocodeClassifier(manifest);
    const result = classify(raw); result.identity = 'wrong';
    manifest.programs[0].codeSha256 = 'bad'; manifest.bootstraps[0].id = 'wrong';
    expect(classify(raw)).toMatchObject({ identity: 'program-0', bootstrap: 'boot' });
    expect(() => createAudioMicrocodeClassifier(manifest)).toThrow('Invalid audio reference manifest');
    for (const bad of [null, {}, { version: 1, bootstraps: [null], programs: [] }]) expect(() => createAudioMicrocodeClassifier(bad)).toThrow();
  });
});
