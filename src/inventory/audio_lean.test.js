import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AudioMicrocodeCapture } from './audio_microcode_capture.js';
import { benchmarkLeanSamples } from './audio_lean_measure.js';
import { audioReferenceExamples } from './audio_reference_examples.js';

test('benchmark consumes results and excludes construction from timing', () => {
  let constructions = 0, calls = 0;
  const factories = [{ name: 'test', create: () => { constructions++; return () => { calls++; return { status: 'unknown' }; }; } }];
  const result = benchmarkLeanSamples([{ run: 0, raw: {} }], factories, { rounds: 3, targetMs: 0 });
  expect(result.results.map(r => r.workload)).toEqual(['rom-blocks', 'shuffled-images']);
  expect(constructions).toBe(2);
  expect(calls).toBe((64 + 1) * (2 + 3)); // Warmup, calibration and three timed passes.
  expect(result.checksum).toBe(calls * 'unknown'.length);
  expect(result.results.every(r => r.strategies[0].microsecondsPerCall.length === 3)).toBe(true);
});

test('audit CLI checks full streams, reports missing cases and protects existing output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'audio-lean-'));
  const cli = new URL('./audio_lean_cli.js', import.meta.url).pathname;
  const invoke = async output => {
    const child = Bun.spawn([process.execPath, cli, root, '--output', output], { stdout: 'pipe', stderr: 'pipe' });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return { code, stdout, stderr };
  };
  try {
    const raw = { task: new Uint8Array(64), imem: new Uint8Array(4096), code: new Uint8Array(4096), data: new Uint8Array(4096) };
    const task = new DataView(raw.task.buffer);
    task.setUint32(0, 2); task.setUint32(0x10, 0x1000); task.setUint32(0x18, 0x3000); task.setUint32(0x1c, 0x800);
    const capture = new AudioMicrocodeCapture(root, { instructionLoads: true });
    const image = { raw, code: raw.code, data: raw.data, loadAddress: null, loader: 'unknown', declared: { boot: 0, code: 0, data: 0 }, issues: [] };
    capture.observe(image, { frame: 1, cycles: 1 });
    capture.observe(image, { frame: 2, cycles: 2 });
    capture.flush();
    const report = { schemaVersion: 1, rom: { sha256: '1'.repeat(64) }, sourceSha256: '2'.repeat(64),
      emulator: {}, settings: {}, result: {}, collectors: {}, audioCapture: capture.snapshot() };
    await writeFile(join(root, 'report.json'), JSON.stringify(report));
    const output = join(root, 'result');
    expect((await invoke(output)).code).toBe(1);
    const saved = await readFile(join(output, 'audit.json'), 'utf8'), audit = JSON.parse(saved);
    expect(audit.summary).toMatchObject({ runs: 1, tasks: 2, images: 1, unknown: 2, mismatches: 0, missingExamples: audioReferenceExamples.length });
    expect(audit.analyzer.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect((await invoke(output)).code).toBe(2);
    expect(await readFile(join(output, 'audit.json'), 'utf8')).toBe(saved);
    report.audioCapture.loads++;
    await writeFile(join(root, 'report.json'), JSON.stringify(report));
    const failed = await invoke(join(root, 'corrupt'));
    expect(failed.code).toBe(2);
    expect(failed.stderr).toContain('Instruction capture counts');
  } finally { await rm(root, { recursive: true, force: true }); }
});
