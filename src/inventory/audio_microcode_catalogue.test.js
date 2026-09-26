import { describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AudioMicrocodeCapture } from './audio_microcode_capture.js';
import { catalogueAudioCaptures, catalogueMarkdown, compareAudioImages, differenceRanges, readCaptureTask } from './audio_microcode_catalogue.js';

function image() {
  const code = new Uint8Array(64), data = new Uint8Array(64);
  new DataView(code.buffer).setUint32(0, 13); // BREAK; every following word is unreachable.
  return {
    code, data, loader: 'direct', loadAddress: 0x1000, issues: [],
    declared: { boot: 4096, code: 64, data: 64 },
    raw: { code: code.slice(), data: data.slice(), imem: new Uint8Array(4096), task: new Uint8Array(64) },
  };
}

async function fixture(callback) {
  const root = await mkdtemp(join(tmpdir(), 'n64js-audio-catalogue-'));
  const capture = async (name, images, partial = false) => {
    const directory = join(root, name);
    await mkdir(directory);
    await writeFile(join(directory, 'tasks.jsonl.gz'), '');
    const writer = new AudioMicrocodeCapture(directory);
    for (const [i, snapshot] of images.entries()) writer.observe(snapshot, { frame: i + 1, cycles: (i + 1) * 100 });
    writer.flush();
    await writeFile(join(directory, 'report.json'), JSON.stringify({
      schemaVersion: 1, sourceSha256: 'a'.repeat(64), rom: { name, sha256: 'b'.repeat(64) }, emulator: {}, settings: {},
      result: { status: partial ? 'timeout' : 'completed', checkpointOnly: partial }, collectors: {}, audioCapture: writer.snapshot(),
    }));
    return directory;
  };
  try { await callback(capture, root); }
  finally { await rm(root, { recursive: true, force: true }); }
}

describe('audio microcode evidence catalogue', () => {
  test('retains unreachable code and non-dispatch data, without turning raw tail changes into programs', async () => {
    await fixture(async capture => {
      const a = image(), b = image(), c = image(), d = image();
      b.code[15] = 1; // Same structural fingerprint, distinct full code.
      c.data[32] = 2; // Same structural fingerprint AND code, distinct data.
      d.raw.data[63] = 3; // Outside the interpreted evidence; still audited.
      const run = await capture('one', [a, a, b, c, d]);
      const catalogue = await catalogueAudioCaptures([run]);
      expect(catalogue.summary).toMatchObject({ runs: 1, tasks: 5, images: 4, provisionalGroups: 1, exactVariants: 3 });
      expect(catalogue.variants.map(v => v.tasks).sort()).toEqual([1, 1, 3]);
      const group = catalogue.groups[0];
      expect(group.tasks).toBe(5);
      expect(group.bytes.code).toMatchObject({ variants: 2, varyingRanges: [[15, 16]] });
      expect(group.bytes.data).toMatchObject({ variants: 2, varyingRanges: [[32, 33]] });
      expect(group.bytes['raw.data']).toMatchObject({ variants: 2, varyingRanges: [[63, 64]] });
      const selected = await readCaptureTask(run, 3);
      expect(selected.image.code[15]).toBe(1);
      expect(catalogue.variants.find(v => v.reference.task === 3).reference.imageId).toBe(selected.imageId);
      expect(catalogueMarkdown(catalogue)).toContain('not a count of distinct programs');
    });
  });

  test('records between-ROM differences even when each ROM is stable; ordering and duplicates do not change IDs', async () => {
    await fixture(async capture => {
      const a = image(), b = image();
      b.data[40] = 1;
      const one = await capture('one', [a]);
      const two = await capture('two', [b, b], true);
      const empty = await capture('empty', []);
      const forward = await catalogueAudioCaptures([one, two, empty]);
      const reverse = await catalogueAudioCaptures([two, one, empty, two]);
      expect(forward).toEqual(reverse);
      expect(forward.summary).toMatchObject({ empty: 1, partial: 1, runs: 3, tasks: 3, exactVariants: 2 });
      expect(forward.groups[0].bytes.data.varyingRanges).toEqual([[40, 41]]);
      for (const run of forward.runs.filter(r => r.groups.length)) expect(run.groups[0].bytes.data.varyingRanges).toEqual([]);
      expect(forward.runs[0].reportSha256).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  test('loader interpretation and issue differences cannot share an exact variant', async () => {
    await fixture(async capture => {
      const a = image(), b = image(), c = image();
      b.loadAddress = null; b.loader = 'unknown';
      c.issues = ['invalid-data-range'];
      const run = await capture('one', [a, b, c]);
      expect((await catalogueAudioCaptures([run])).summary.exactVariants).toBe(3);
    });
  });

  test('empty and shortened windows record missing bytes, including growth beyond the first image', async () => {
    await fixture(async capture => {
      const a = image(), b = image(), c = image();
      a.raw.data = new Uint8Array(); b.raw.data = Uint8Array.of(0, 1); c.raw.data = Uint8Array.of(0);
      const catalogue = await catalogueAudioCaptures([await capture('one', [a, b, c])]);
      expect(catalogue.groups[0].bytes['raw.data']).toEqual({ lengths: [0, 1, 2], variants: 3, varyingBytes: 2, varyingRanges: [[0, 2]] });
    });
  });

  test('selecting an early task still verifies the complete published stream', async () => {
    await fixture(async capture => {
      const run = await capture('one', [image(), image()]);
      const reportPath = join(run, 'report.json');
      const report = JSON.parse(await readFile(reportPath, 'utf8'));
      report.audioCapture.tasks++;
      await writeFile(reportPath, JSON.stringify(report));
      await expect(readCaptureTask(run, 1)).rejects.toThrow();
      await expect(catalogueAudioCaptures([run])).rejects.toThrow();
    });
  });

  test('comparison preserves differences, gives instruction context and leaves unknown addresses unresolved', () => {
    const a = image(), b = image();
    new DataView(b.code.buffer).setUint32(4, 0x20080001); // ADDI t0, r0, 1.
    b.data[3] = 255;
    b.raw.code = b.code.slice();
    const fields = compareAudioImages(a, b);
    const code = fields.find(f => f.field === 'code');
    expect(code.ranges).toEqual([[4, 6], [7, 8]]);
    expect(code.words.map(w => w.offset)).toEqual([0, 4, 8]);
    expect(code.words[1].right).toMatchObject({ address: 0x1004, disassembly: 'ADDI      t0 = r0 + 0x0001' });
    expect(fields.find(f => f.field === 'data').changes).toEqual([{ start: 3, end: 4, left: '00', right: 'ff' }]);
    // Direct loader code is IMEM; its raw RDRAM window has no inferred mapping.
    expect(fields.find(f => f.field === 'raw.code').words[1].right.disassembly).toBeNull();
    b.loader = 'unknown'; b.loadAddress = null;
    expect(compareAudioImages(a, b)[0].words[1].right.address).toBeNull();
  });

  test('comparisons handle invalid instruction encodings and partial words without dropping bytes', () => {
    const a = image(), b = image();
    b.code = Uint8Array.of(0xff, 0xff, 0xff, 0xff, 0x12);
    const code = compareAudioImages(a, b)[0];
    expect(code.words[0].right.word).toBe(0xffffffff);
    expect(code.words[1].right).toBeNull();
    expect(code.words[1].rightHex).toBe('12');
    expect(code.ranges).toEqual([[0, 64]]);
    expect(differenceRanges(Uint8Array.of(0), new Uint8Array())).toEqual([[0, 1]]);
  });

  test('CLI rejects invalid ordinals and protects existing outputs', async () => {
    await fixture(async (capture, root) => {
      const run = await capture('one', [image()]);
      const output = join(root, 'existing.json');
      await writeFile(output, 'keep this');
      const cli = new URL('./audio_microcode_catalogue_cli.js', import.meta.url).pathname;
      const invoke = async args => {
        const child = Bun.spawn([process.execPath, cli, ...args], { stdout: 'pipe', stderr: 'pipe' });
        const [, error, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
        return { error, exit };
      };
      expect((await invoke(['--compare', run, run, '--left-task', '0'])).exit).toBe(2);
      expect((await invoke([run, '--output', output])).exit).toBe(2);
      expect(await readFile(output, 'utf8')).toBe('keep this');
    });
  });
});
