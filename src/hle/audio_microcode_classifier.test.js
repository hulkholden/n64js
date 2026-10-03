import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { createMicrocodeHash } from './audio_microcode_hash.js';
import { createAudioMicrocodeClassifier } from './audio_microcode_classifier.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const clone = raw => Object.fromEntries(Object.entries(raw).map(([key, bytes]) => [key, bytes.slice()]));
const variants = [{ cache: false }, {}];
const known = (identity = 'program-0', family = 'ABI1') => ({ status: 'known', identity, family, bootstrap: 'boot' });
const unknown = reason => ({ status: 'unknown', identity: null, family: 'Unknown', reason });

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
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = (i * 73 + (i >>> 3)) & 255;
    }
    // Descending sizes catch residual scratch bytes from previous hashes.
    for (let n = 4096; n >= 0; n--) {
      expect(digest(bytes.subarray(3, n + 3))).toBe(hash(bytes.subarray(3, n + 3)));
    }
    expect(() => digest(new Uint8Array(4097))).toThrow();
    expect(() => digest([])).toThrow();
  });
});

describe('browser audio classifier', () => {
  test('constructs the reviewed runtime manifest without inventory dependencies', () => {
    expect(createAudioMicrocodeClassifier()(null)).toEqual(unknown('invalid-snapshot'));
  });

  test('entry hashes only select candidates; complete code still separates shared entries', () => {
    const { raw, second, manifest } = fixture();
    for (const p of manifest.programs) {
      p.entrySha256 = hash(raw.code.subarray(0, 0x80));
    }
    manifest.programs[0].family = 'NAUDIO'; manifest.programs[1].family = 'NEAD';
    for (const options of variants) {
      const classify = createAudioMicrocodeClassifier(manifest, options);
      expect(classify(raw)).toMatchObject({ identity: 'program-0', family: 'NAUDIO' });
      expect(classify(second)).toMatchObject({ identity: 'program-1', family: 'NEAD' });
      raw.code[0x1ff] ^= 1; // Same entry hash, neither full program.
      expect(classify(raw)).toEqual(unknown('unreviewed-code'));
      raw.code[0x1ff] ^= 1;
      expect(classify(raw)).toEqual(known('program-0', 'NAUDIO'));
    }
    // An unmatched entry selector cannot establish identity on its own.
    manifest.programs[0].entrySha256 = '0'.repeat(64);
    expect(createAudioMicrocodeClassifier(manifest)(raw).status).toBe('unknown');
  });

  test('direct programs use actual IMEM, encoded data lengths and isolated loading layouts', () => {
    const { raw, manifest } = fixture(), task = new DataView(raw.task.buffer);
    task.setUint32(0x08, 0x1000); task.setUint32(0x0c, 0x1000); task.setUint32(0x1c, 0x2df);
    manifest.programs.push({ id: 'direct-nead', family: 'NEAD', loader: 'direct',
      entrySha256: hash(raw.imem.subarray(0, 0x80)), codeBytes: 4096, codeSha256: hash(raw.imem),
      dataBytes: 0x2e0, dataSha256: hash(raw.data.subarray(0, 0x2e0)) });
    // Same full code/constants in the wrong loading layout must not make the
    // direct match ambiguous or match an rspboot task by accident.
    manifest.programs.push({ ...manifest.programs.at(-1), id: 'rspboot-copy', loader: 'rspboot',
      codeBytes: 0xf80, codeSha256: hash(raw.imem.subarray(0, 0xf80)) });
    const expected = { status: 'known', identity: 'direct-nead', family: 'NEAD', bootstrap: 'direct-imem' };
    for (const classify of variants.map(v => createAudioMicrocodeClassifier(manifest, v))) {
      expect(classify(raw)).toEqual(expected);
      const changed = clone(raw), header = new DataView(changed.task.buffer);
      changed.code = new Uint8Array(); // RDRAM's code copy is not used by direct entry.
      changed.data = changed.data.slice(0, 0x2e0);
      expect(classify(changed)).toEqual(expected);
      changed.imem[4095] ^= 1;
      expect(classify(changed).reason).toBe('unreviewed-code');
      changed.imem[4095] ^= 1;
      changed.data[0x2df] ^= 1; // The byte beyond declared size is actually DMA'd.
      expect(classify(changed).reason).toBe('unreviewed-constants');
      changed.data[0x2df] ^= 1;
      header.setUint32(0x1c, 0x2e0); // Encoded length loads 0x2e8, not 0x2e0.
      expect(classify(changed).reason).toBe('unsupported-task-layout');
      header.setUint32(0x1c, 0x2d7);
      expect(classify(changed).reason).toBe('unreviewed-constants');
      header.setUint32(0x1c, 0xfc0);
      expect(classify(changed).reason).toBe('unsupported-task-layout');
      header.setUint32(0x1c, 0x2df);
      expect(classify(changed)).toEqual(expected);
      header.setUint32(0x08, 0x2000);
      expect(classify(changed).status).toBe('unknown');
    }
    for (const update of [{ loader: 'unreviewed' }, { family: 'guessed' }, { entrySha256: 'bad' }, { codeBytes: 0x1004 }]) {
      const bad = structuredClone(manifest); Object.assign(bad.programs.at(-2), update);
      expect(() => createAudioMicrocodeClassifier(bad)).toThrow();
    }
  });

  test('recognizes cache hits and misses and rejects mutations of every protected byte', () => {
    const { raw, second, manifest } = fixture();
    for (const options of variants) {
      const classify = createAudioMicrocodeClassifier(manifest, options);
      expect(classify(raw)).toEqual(known());
      expect(classify(second)).toEqual(known('program-1'));
      for (const [field, end] of [['imem', 0xcc], ['code', 0x200], ['data', 0x2c0]]) {
        for (let p = 0; p < end; p++) {
          raw[field][p] ^= 0x80;
          expect(classify(raw).status).toBe('unknown');
          raw[field][p] ^= 0x80;
          expect(classify(raw)).toEqual(known());
        }
      }
      const changed = clone(raw);
      changed.imem.fill(0xff, 0xcc); changed.code.fill(0x11, 0x200); changed.data.fill(0x22, 0x2c0);
      expect(classify(changed)).toEqual(known());
      const views = Object.fromEntries(Object.entries(raw).map(([key, bytes]) => {
        const buffer = new Uint8Array(bytes.length + 3); buffer.set(bytes, 1);
        return [key, buffer.subarray(1, bytes.length + 1)];
      }));
      expect(classify(views)).toEqual(known());
    }
  });

  test('revalidates headers and short windows even with warm caches', () => {
    const { raw, manifest } = fixture();
    for (const options of variants) {
      const classify = createAudioMicrocodeClassifier(manifest, options);
      classify(raw);
      for (const [offset, values, reason] of [[0, [1, 3], 'not-audio-task'],
        [0x10, [0, 0x1001], 'unsupported-task-layout'], [0x18, [0, 0x3004], 'unsupported-task-layout'],
        [0x1c, [0, 0xfc1, 0xffffffff], 'unsupported-task-layout'], [0x1c, [0x2b8], 'unreviewed-constants']]) {
        for (const value of values) {
          const changed = clone(raw); new DataView(changed.task.buffer).setUint32(offset, value);
          expect(classify(changed)).toEqual(unknown(reason));
        }
      }
      // Addresses may differ while their copied bytes match; ucode_size is
      // ignored by rspboot. The data DMA rounds up and may end at OSTask.
      for (const [offset, value] of [[0x10, 0x80002000], [0x1c, 0x2bf], [0x1c, 0xfc0], [0x14, 0], [0x14, 0xffffffff]]) {
        const changed = clone(raw); new DataView(changed.task.buffer).setUint32(offset, value);
        expect(classify(changed)).toEqual(known());
      }
      for (const [field, size, reason] of [['task', 63, 'invalid-snapshot'], ['imem', 4095, 'invalid-snapshot'],
        ['code', 4097, 'invalid-snapshot'], ['data', 4097, 'invalid-snapshot'],
        ['code', 0xf7f, 'unsupported-task-layout'], ['data', 0x7ff, 'unsupported-task-layout']]) {
        const changed = { ...raw, [field]: new Uint8Array(size) };
        expect(classify(changed)).toEqual(unknown(reason));
      }
      for (const bad of [null, {}, { ...raw, code: [] }]) {
        expect(classify(bad)).toEqual(unknown('invalid-snapshot'));
      }
      expect(classify(raw)).toEqual(known());
    }
  });

  test('preserves ambiguity including longer overlapping bootstraps on warm caches', () => {
    const { raw, manifest } = fixture();
    manifest.programs.push({ ...manifest.programs[0], id: 'overlap' });
    for (const options of variants) {
      const classify = createAudioMicrocodeClassifier(manifest, options);
      expect(classify(raw)).toEqual({ ...unknown('ambiguous-identity'), status: 'ambiguous', candidates: ['overlap', 'program-0'] });
    }
    manifest.bootstraps.push({ id: 'longer', bytes: 0xd0, sha256: hash(raw.imem.subarray(0, 0xd0)) });
    const classify = createAudioMicrocodeClassifier(manifest);
    expect(classify(raw)).toEqual({ ...unknown('ambiguous-bootstrap'), status: 'ambiguous', candidates: ['boot', 'longer'] });
    raw.imem[0xcc] ^= 1;
    expect(classify(raw).reason).toBe('ambiguous-identity');
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
    for (const bad of [null, {}, { version: 1, bootstraps: [null], programs: [] }]) {
      expect(() => createAudioMicrocodeClassifier(bad)).toThrow();
    }
  });

  test('reuses an explicit result without retaining stale identity or ambiguity fields', () => {
    const { raw, manifest } = fixture();
    manifest.bootstraps.push({ id: 'longer', bytes: 0xd0, sha256: hash(raw.imem.subarray(0, 0xd0)) });
    const classify = createAudioMicrocodeClassifier(manifest), result = {};
    raw.imem[0xcc] ^= 1;
    expect(classify(raw, result)).toBe(result);
    expect(result).toEqual(known());
    raw.code[0] ^= 1;
    classify(raw, result);
    expect(result).toEqual(unknown('unreviewed-code'));
    raw.code[0] ^= 1;
    raw.imem[0xcc] ^= 1;
    classify(raw, result);
    expect(result).toEqual({ ...unknown('ambiguous-bootstrap'), status: 'ambiguous', candidates: ['boot', 'longer'] });
    raw.imem[0xcc] ^= 1;
    classify(raw, result);
    expect(result).toEqual(known());
    const owned = classify(raw);
    expect(owned).not.toBe(result);
    expect(classify(null, result)).toEqual(unknown('invalid-snapshot'));
    expect(owned).toEqual(known());
  });
});
