#!/usr/bin/env bun
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { captureDirectories } from './audio_microcode_replay.js';
import { catalogueAudioCaptures, catalogueMarkdown, compareAudioImages, readCaptureTask } from './audio_microcode_catalogue.js';
import { emulatorVersion } from './inventory_runner.js';
import { sourceHash } from './inventory_source.js';

const usage = `Usage:
  bun run audio-microcode-catalogue <corpus-or-run>... [--output new.json] [--markdown new.md]
  bun run audio-microcode-catalogue --compare <left-run> <right-run> [--left-task N] [--right-task N] [--output new.json]

Build an evidence catalogue or compare two task snapshots without running ROMs.
Task ordinals are one-based (default 1). Byte ranges are [start, end).
Comparisons include code disassembly and raw code/data/IMEM/task differences.
Unsupported loader addresses remain unresolved. Linear disassembly does not
establish reachability. Captures are read through their entire published prefix.
Outputs are created exclusively; captured reports and labels are never updated.
Exit codes: 0 success; 2 invalid arguments or missing/corrupt evidence.
`;

try {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2), allowPositionals: true,
    options: {
      output: { type: 'string' }, markdown: { type: 'string' }, compare: { type: 'boolean' },
      'left-task': { type: 'string' }, 'right-task': { type: 'string' }, help: { type: 'boolean' },
    },
  });
  if (values.help) console.log(usage);
  else {
    const started = performance.now();
    let analysis;
    if (values.compare) {
      if (positionals.length !== 2 || values.markdown) throw new Error('Comparison requires two run directories and does not accept --markdown');
      const left = await readCaptureTask(positionals[0], Number(values['left-task'] ?? 1));
      const right = await readCaptureTask(positionals[1], Number(values['right-task'] ?? 1));
      const metadata = ({ image, ...rest }) => ({ ...rest, loader: image.loader, loadAddress: image.loadAddress, declared: image.declared, issues: image.issues });
      analysis = { schemaVersion: 1, scope: 'task-start-byte-comparison', left: metadata(left), right: metadata(right), fields: compareAudioImages(left.image, right.image) };
    } else {
      if (!positionals.length || values['left-task'] !== undefined || values['right-task'] !== undefined) throw new Error('Expected corpus/run directories; task selectors require --compare');
      const directories = (await Promise.all(positionals.map(captureDirectories))).flat();
      analysis = await catalogueAudioCaptures(directories);
    }
    analysis.analyzer = { ...emulatorVersion(), sourceSha256: await sourceHash() };
    analysis.elapsedMs = performance.now() - started;
    const json = JSON.stringify(analysis, null, 2) + '\n';
    if (values.output !== undefined) await writeFile(values.output, json, { flag: 'wx' });
    else process.stdout.write(json);
    if (values.markdown !== undefined) await writeFile(values.markdown, catalogueMarkdown(analysis), { flag: 'wx' });
  }
} catch (error) {
  console.error(`${error?.message ?? error}\n${usage}`);
  process.exitCode = 2;
}
