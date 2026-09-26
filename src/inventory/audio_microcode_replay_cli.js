#!/usr/bin/env bun

import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { captureDirectories, replayAudioCapture } from './audio_microcode_replay.js';
import { emulatorVersion } from './inventory_runner.js';
import { sourceHash } from './inventory_source.js';

const usage = `Usage: bun run audio-microcode-replay <corpus-or-run-directory>... [options]
  --output <path>  Write analysis to a new file (default: stdout)
  --check          Exit 1 if an available live collector differs
  --help           Show this help

Reads saved task images without executing ROMs. Capture bytes and original
reports remain unchanged. Replays exactly the checkpoint prefix recorded in
each report, including timeout/error reports; a running capture is partial.
Records current analysis provenance separately from the original run. Structural
classifications are provisional observations, not verified HLE compatibility.
Exit codes: 0 replayed; 1 comparison mismatch; 2 arguments or corrupt/missing data.
`;

try {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2), allowPositionals: true,
    options: { output: { type: 'string' }, check: { type: 'boolean' }, help: { type: 'boolean' } },
  });
  if (values.help) {
    console.log(usage);
  } else {
    if (!positionals.length) throw new Error('Expected a corpus or run directory');
    const directories = [...new Set((await Promise.all(positionals.map(captureDirectories))).flat())];
    const started = performance.now();
    const runs = [];
    for (const directory of directories) runs.push(await replayAudioCapture(directory));
    const summary = {
      runs: runs.length,
      tasks: runs.reduce((total, run) => total + run.audioMicrocodes.tasks, 0),
      images: runs.reduce((total, run) => total + run.capture.images, 0),
      matched: runs.filter(run => run.matchesRecorded === true).length,
      mismatched: runs.filter(run => run.matchesRecorded === false).length,
      missingLiveCollector: runs.filter(run => run.matchesRecorded === null).length,
      partial: runs.filter(run => run.source.result.checkpointOnly).length,
    };
    const analysis = { schemaVersion: 1, analyzer: { ...emulatorVersion(), sourceSha256: await sourceHash() }, elapsedMs: performance.now() - started, summary, runs };
    const json = JSON.stringify(analysis, null, 2) + '\n';
    // Exclusive creation also protects input reports reached via links/aliases.
    if (values.output !== undefined) await writeFile(values.output, json, { flag: 'wx' });
    else process.stdout.write(json);
    process.exitCode = values.check && summary.mismatched ? 1 : 0;
  }
} catch (error) {
  console.error(`${error?.message ?? error}\n${usage}`);
  process.exitCode = 2;
}
