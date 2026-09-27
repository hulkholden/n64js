import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAudioReferenceClassifier, classifyAudioReference } from './audio_reference.js';
import { audioReferenceManifest } from './audio_reference_manifest.js';
import { auditAudioReferences } from './audio_reference_audit.js';
import { AudioMicrocodeCapture } from './audio_microcode_capture.js';
import { readCaptureTask } from './audio_microcode_catalogue.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const clone = raw => Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v.slice()]));

// Deterministic synthetic bytes, not captured game code. A test manifest lets
// us exercise every matching boundary without copying a ROM into the repository.
function fixture() {
  const bytes = seed => Uint8Array.from({ length: 4096 }, (_, i) => (i * 73 + seed) & 255);
  const raw = { task: new Uint8Array(64), imem: bytes(17), code: bytes(39), data: bytes(61) };
  const task = new DataView(raw.task.buffer);
  task.setUint32(0, 2); task.setUint32(0x10, 0x1000); task.setUint32(0x18, 0x3000); task.setUint32(0x1c, 2048);
  const second = clone(raw);
  second.code[0x1dc] ^= 1; // Same data/dispatch bytes, different program body.
  const manifest = { version: 1,
    bootstraps: [{ id: 'test-loader', bytes: 0xd0, sha256: hash(raw.imem.subarray(0, 0xd0)) }],
    programs: [raw, second].map((r, n) => ({ id: `test-${n}`, family: 'ABI1',
      codeBytes: 0x200, codeSha256: hash(r.code.subarray(0, 0x200)),
      dataBytes: 0x2c0, dataSha256: hash(r.data.subarray(0, 0x2c0)),
    })),
  };
  return { raw, second, manifest, classify: createAudioReferenceClassifier(manifest) };
}

describe('offline audio reference classifier', () => {
  test('separates programs with identical dispatch data and ignores interpreted metadata', () => {
    const { raw, second, classify } = fixture();
    expect(classify(raw)).toMatchObject({ status: 'known', identity: 'test-0', bootstrap: 'test-loader' });
    expect(classify(second).identity).toBe('test-1');
    expect(classify({ ...raw, family: 'NAUDIO', loader: 'unknown', fingerprint: 'forged' })).toEqual(classify(raw));
    expect(classifyAudioReference(raw)).toMatchObject({ status: 'unknown', reason: 'unreviewed-bootstrap' });
  });

  test('rejects a changed byte anywhere in reviewed bootstrap, code or constants', () => {
    const { raw, classify } = fixture();
    for (const [field, end] of [['imem', 0xd0], ['code', 0x200], ['data', 0x2c0]]) {
      const changed = clone(raw);
      for (let i = 0; i < end; i++) {
        changed[field][i] ^= 0x80;
        expect(classify(changed).status).toBe('unknown');
        changed[field][i] ^= 0x80;
      }
    }
  });

  test('keeps excluded tails, previous IMEM and task addresses out of identity', () => {
    const { raw, classify } = fixture();
    const changed = clone(raw);
    changed.imem.fill(0xff, 0xd0); changed.code.fill(0x55, 0x200); changed.data.fill(0x66, 0x2c0);
    const task = new DataView(changed.task.buffer);
    task.setUint32(4, 2); task.setUint32(0x10, 0x80005000); task.setUint32(0x18, 0x80006000);
    task.setUint32(0x14, 0xdeadbeef); // This bootstrap never reads ucode_size.
    task.setUint32(0x30, 0x123456); task.setUint32(0x34, 0x500);
    expect(classify(changed)).toEqual(classify(raw));
  });

  test('uses DMA rounding and requires the full copied source windows', () => {
    const { raw, classify } = fixture();
    const changed = clone(raw), task = new DataView(changed.task.buffer);
    task.setUint32(0x1c, 0x2bf); changed.data = changed.data.slice(0, 0x2c0);
    expect(classify(changed).status).toBe('known'); // Rounded to 0x2c0 bytes.
    task.setUint32(0x1c, 0x2b8);
    expect(classify(changed).reason).toBe('unreviewed-constants');
    task.setUint32(0x1c, 0x2c1);
    expect(classify(changed).reason).toBe('unsupported-task-layout');
    expect(classify({ ...raw, code: raw.code.slice(0, 0xf78) }).status).toBe('unknown');
    expect(classify({ ...raw, data: raw.data.slice(0, 0x2c0) }).status).toBe('unknown');
  });

  test('rejects source misalignment, null pointers and a data DMA overlapping the task header', () => {
    const { raw, classify } = fixture();
    for (const [offset, value] of [[0x10, 0], [0x18, 0], [0x10, 0x1001], [0x18, 0x3004], [0x1c, 0], [0x1c, 0xfc1], [0x1c, 0xffffffff]]) {
      const changed = clone(raw); new DataView(changed.task.buffer).setUint32(offset, value);
      expect(classify(changed).reason).toBe('unsupported-task-layout');
    }
  });

  test('handles malformed buffers and non-audio tasks without reading past a window', () => {
    const { raw, classify } = fixture();
    for (const bad of [null, {}, { ...raw, task: raw.task.slice(1) }, { ...raw, imem: raw.imem.slice(1) },
      { ...raw, code: [] }, { ...raw, data: new Uint8Array(4097) }]) {
      expect(classify(bad).reason).toBe('invalid-snapshot');
    }
    const changed = clone(raw); new DataView(changed.task.buffer).setUint32(0, 1);
    expect(classify(changed).reason).toBe('not-audio-task');
    // Views can start at a nonzero ArrayBuffer offset.
    const buffer = new Uint8Array(80); buffer.set(raw.task, 8);
    expect(classify({ ...raw, task: buffer.subarray(8, 72) })).toEqual(classify(raw));
  });

  test('reports overlapping identities and bootstrap definitions instead of choosing the first', () => {
    const { raw, manifest } = fixture();
    manifest.programs.push({ ...manifest.programs[0], id: 'duplicate' });
    expect(createAudioReferenceClassifier(manifest)(raw)).toMatchObject({ status: 'ambiguous', candidates: ['duplicate', 'test-0'] });
    manifest.bootstraps.push({ ...manifest.bootstraps[0], id: 'another-loader' });
    expect(createAudioReferenceClassifier(manifest)(raw).reason).toBe('ambiguous-bootstrap');
  });

  test('validates manifests and snapshots definitions when compiling', () => {
    expect(() => createAudioReferenceClassifier(audioReferenceManifest)).not.toThrow();
    const { raw, manifest, classify } = fixture();
    manifest.programs[0].codeSha256 = 'invalid';
    expect(() => createAudioReferenceClassifier(manifest)).toThrow('Invalid audio reference manifest');
    expect(classify(raw).identity).toBe('test-0');
    expect(() => createAudioReferenceClassifier({ version: 1, bootstraps: [], programs: [] })).toThrow();
  });
});

async function withCapture(callback, version = 2) {
  const root = await mkdtemp(join(tmpdir(), 'n64js-audio-reference-'));
  const { raw, classify } = fixture();
  const changed = clone(raw); changed.data[0x120] ^= 0x80;
  const image = raw => ({ raw, code: Uint8Array.of(0, 0, 0, 13), data: new Uint8Array(64),
    loader: 'direct', loadAddress: 0x1000, declared: { boot: 4096, code: 4, data: 64 }, issues: [] });
  try {
    await writeFile(join(root, 'tasks.jsonl.gz'), '');
    const capture = new AudioMicrocodeCapture(root, { instructionLoads: version === 2 });
    for (const [n, r] of [raw, raw, changed].entries()) {
      capture.observe(image(r), { frame: n + 1, cycles: n * 100 });
      if (version === 2) capture.observeInstructionLoad({ task: n + 1, rspPC: 0x20, source: 0x1000,
        destination: 0x1080, length: 0xf80, count: 1, skip: 0, imem: new Uint8Array(4096) }, { frame: n + 1, cycles: n * 100 + 1 });
    }
    capture.flush();
    const report = { schemaVersion: 1, sourceSha256: 'a'.repeat(64), rom: { sha256: 'b'.repeat(64) },
      emulator: {}, settings: {}, result: { status: 'completed', checkpointOnly: false }, audioCapture: capture.snapshot(), collectors: {} };
    await writeFile(join(root, 'report.json'), JSON.stringify(report));
    const first = await readCaptureTask(root, 1);
    await callback({ root, classify, report, first });
  } finally { await rm(root, { recursive: true, force: true }); }
}

describe('reference corpus audit', () => {
  test('counts occurrences, checks examples after classification and exposes structural disagreement', async () => {
    await withCapture(async ({ root, classify, first }) => {
      const examples = [{ romSha256: first.rom.sha256, imageId: first.imageId, identity: 'test-0' },
        { romSha256: first.rom.sha256, imageId: 'c'.repeat(64), identity: null }];
      const result = await auditAudioReferences([root, root], { classify, examples });
      expect(result.summary).toMatchObject({ runs: 1, tasks: 3, images: 2, knownTasks: 2, unknownTasks: 1,
        ambiguousTasks: 0, familyDisagreements: 2, matchedExamples: 1, missingExamples: 1, mismatchedExamples: 0 });
      expect(result.examples[0].observations).toBe(2);
      expect(result.runs[0].capture.loads).toBe(3); // Post-DMA zero bytes do not change classification.
      examples[0].identity = null;
      expect((await auditAudioReferences([root], { classify, examples })).summary.mismatchedExamples).toBe(1);
    });
  });

  test('legacy streams remain classifiable without instruction observations', async () => {
    await withCapture(async ({ root, classify }) => {
      expect((await auditAudioReferences([root], { classify, examples: [] })).summary).toMatchObject({ knownTasks: 2, unknownTasks: 1 });
    }, 1);
  });

  test('validates records after reviewed examples, including the instruction record counts', async () => {
    await withCapture(async ({ root, report }) => {
      report.audioCapture.loads++;
      await writeFile(join(root, 'report.json'), JSON.stringify(report));
      await expect(auditAudioReferences([root])).rejects.toThrow('Instruction capture counts');
    });
  });

  test('CLI records provenance, protects outputs and fails --check when examples are missing', async () => {
    await withCapture(async ({ root }) => {
      const cli = new URL('./audio_reference_cli.js', import.meta.url).pathname;
      const invoke = async args => {
        const child = Bun.spawn([process.execPath, cli, ...args], { stdout: 'pipe', stderr: 'pipe' });
        const [output, error, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
        return { output, error, exit };
      };
      const reportBefore = await readFile(join(root, 'report.json'), 'utf8');
      const result = await invoke([root]);
      expect(result.exit).toBe(0);
      const analysis = JSON.parse(result.output);
      expect(analysis.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(analysis.analyzer.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(analysis.summary).toMatchObject({ tasks: 3, knownTasks: 0, unknownTasks: 3 });
      expect((await invoke([root, '--check'])).exit).toBe(1);
      expect((await invoke([root, '--output', join(root, 'report.json')])).exit).toBe(2);
      expect(await readFile(join(root, 'report.json'), 'utf8')).toBe(reportBefore);
      expect((await invoke([])).exit).toBe(2);
    });
  });
});
