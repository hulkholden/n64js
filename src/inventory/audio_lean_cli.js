#!/usr/bin/env bun
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, platform, arch } from 'node:os';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { createAudioMicrocodeClassifier } from '../hle/audio_microcode_classifier.js';
import { classifyAudioReference } from './audio_reference.js';
import { audioReferenceManifest } from './audio_reference_manifest.js';
import { audioReferenceExamples } from './audio_reference_examples.js';
import { readAudioCapture, readCaptureReport } from './audio_microcode_capture.js';
import { captureDirectories } from './audio_microcode_replay.js';
import { benchmarkLeanSamples, leanFactories, leanStrategies, verifyLeanSamples } from './audio_lean_measure.js';
import { emulatorVersion } from './inventory_runner.js';
import { sourceHash } from './inventory_source.js';

const usage = `Usage: bun run audio-microcode-lean <corpus-or-run>... --output <new-directory> [--browser]
Compare every captured task with the independent reference, then benchmark only
classification over a bounded sample. --browser adds Chromium validation/timing.
Unknown results are expected. Missing reviewed examples fail the full-corpus check.
Outputs include raw benchmark samples: keep them local, outside version control.
Exit: 0 validated; 1 mismatch/missing examples; 2 invalid arguments/capture data.
`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const writeJSON = (path, data) => writeFile(path, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });

try {
  const { values, positionals } = parseArgs({ args: Bun.argv.slice(2), allowPositionals: true,
    options: { output: { type: 'string' }, browser: { type: 'boolean' }, help: { type: 'boolean' } },
  });
  if (values.help) console.log(usage);
  else {
    if (!values.output || !positionals.length) throw new Error('Expected input corpus and new output directory');
    const output = resolve(values.output);
    await mkdir(output); // Exclusive: never overwrite an earlier evidence run.
    const directories = [...new Set((await Promise.all(positionals.map(captureDirectories))).flat())].sort();
    const analyzer = { ...emulatorVersion(), sourceSha256: await sourceHash(), platform: platform(), arch: arch(), cpu: cpus()[0]?.model };
    const strategies = leanStrategies.map(s => ({ ...s, classify: createAudioMicrocodeClassifier(undefined, s.options) }));
    const examples = audioReferenceExamples.map(e => ({ ...e, observations: 0, mismatches: 0 }));
    const samples = [], runs = [], mismatches = [];
    let mismatchCount = 0;
    const started = performance.now();
    for (const directory of directories) {
      const { report, reportSha256 } = await readCaptureReport(directory);
      const seen = new Map(), counts = { known: 0, unknown: 0, ambiguous: 0 };
      let tasks = 0;
      for await (const task of readAudioCapture(directory, report.audioCapture)) {
        const raw = task.image.raw;
        if (!seen.has(task.imageId)) seen.set(task.imageId, classifyAudioReference(raw));
        const expected = seen.get(task.imageId);
        counts[expected.status]++; tasks++;
        for (const strategy of strategies) {
          const actual = strategy.classify(raw);
          if (!isDeepStrictEqual(actual, expected)) {
            mismatchCount++;
            if (mismatches.length < 20) mismatches.push({ directory, task: task.task, imageId: task.imageId, strategy: strategy.name, expected, actual });
          }
        }
        const example = examples.find(e => e.romSha256 === report.rom?.sha256 && e.imageId === task.imageId);
        if (example) {
          example.observations++;
          if (example.identity !== expected.identity || expected.status !== (example.identity === null ? 'unknown' : 'known')) example.mismatches++;
        }
        // First four consecutive occurrences per run, plus each reviewed case.
        // Labels and capture IDs are attached AFTER classification, never inputs.
        if (tasks <= 4 || example?.observations === 1) samples.push({ run: runs.length, directory,
          task: task.task, imageId: task.imageId, expected, example: example?.observations === 1 ? example.description : null, raw });
      }
      runs.push({ directory, reportSha256, source: { rom: report.rom, emulator: report.emulator, sourceSha256: report.sourceSha256 },
        capture: report.audioCapture, tasks, images: seen.size, ...counts });
      if (runs.length % 100 === 0) console.error(`Validated ${runs.length}/${directories.length} runs`);
    }
    const audit = { schemaVersion: 1, analyzer, manifestSha256: hash(JSON.stringify(audioReferenceManifest)),
      readAndVerifyMs: performance.now() - started, strategies: leanStrategies,
      summary: { runs: runs.length, tasks: runs.reduce((n, r) => n + r.tasks, 0), images: runs.reduce((n, r) => n + r.images, 0),
        known: runs.reduce((n, r) => n + r.known, 0), unknown: runs.reduce((n, r) => n + r.unknown, 0), ambiguous: runs.reduce((n, r) => n + r.ambiguous, 0),
        mismatches: mismatchCount, missingExamples: examples.filter(e => !e.observations).length, mismatchedExamples: examples.filter(e => e.mismatches).length },
      examples, mismatches, runs };
    await writeJSON(join(output, 'audit.json'), audit);
    console.error(JSON.stringify(audit.summary));
    if (mismatches.length || audit.summary.missingExamples || audit.summary.mismatchedExamples) process.exitCode = 1;
    else {
      // Deduplicate review markers across corpora, preserving every sampled task.
      const marked = new Set();
      for (const s of samples) { if (marked.has(s.example)) s.example = null; else if (s.example) marked.add(s.example); }
      const encoded = samples.map(s => ({ ...s, raw: Object.fromEntries(Object.entries(s.raw).map(([k, v]) => [k, Buffer.from(v).toString('base64')])) }));
      const json = JSON.stringify(encoded);
      await writeFile(join(output, 'samples.json'), json, { flag: 'wx' });
      const verification = verifyLeanSamples(samples);
      const benchmark = benchmarkLeanSamples(samples, [{ name: 'native-reference', create: () => classifyAudioReference }, ...leanFactories()]);
      await writeJSON(join(output, 'bun.json'), { analyzer, samplesSha256: hash(json), verification, benchmark });
      if (values.browser) {
        const build = await Bun.build({ entrypoints: [new URL('./audio_lean_browser.js', import.meta.url).pathname], target: 'browser', format: 'iife', minify: true });
        if (!build.success) throw new Error('Browser benchmark bundle failed');
        const bundle = await build.outputs[0].text();
        await writeFile(join(output, 'browser.js'), bundle, { flag: 'wx' });
        const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('<!doctype html><title>Audio classifier benchmark</title>', { headers: { 'Content-Type': 'text/html' } }) });
        let browser;
        try {
          browser = await chromium.launch();
          const page = await browser.newPage();
          await page.goto(`http://127.0.0.1:${server.port}`);
          await page.addScriptTag({ content: bundle });
          const result = await page.evaluate(samples => globalThis.runAudioLeanBenchmark(samples), encoded);
          await writeJSON(join(output, 'chromium.json'), { analyzer, chromium: browser.version(), bundleSha256: hash(bundle), samplesSha256: hash(json), ...result });
        } finally {
          if (browser) await browser.close();
          server.stop(true);
        }
      }
    }
  }
} catch (error) {
  console.error(`${error?.stack ?? error}\n${usage}`);
  process.exitCode = 2;
}
