#!/usr/bin/env bun

import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { inventoryOptions, inventorySettings, loadInputScript, runInventory } from './inventory_runner.js';
import { inputScriptHelp } from './inventory_input.js';
import { loadReplayReport } from './inventory_replay.js';

const usage = `Usage: bun run inventory <rom-path> [options]
       bun run inventory <rom-path> --replay <report.json> [--output <path>]
  --seed <uint32>       Random seed (default: 1)
  --frames <count>      VI retraces to run (default: 600)
  --max-cycles <count>  CPU cycle limit (default: 5000000000)
  --timeout-ms <ms>     Wall-clock limit including ROM startup (default: 60000)
  --input-script <path> JSON menu sequence before seeded random input
  --replay <path>       Replay saved settings with the current emulator code
  --output <path>       JSON report destination (default: stdout; '-' also works)
  --audio-corpus <path> Save raw audio task images for offline analysis
  --help               Show this help

Exit codes: 0 completed; 2 invalid arguments or emulation error; 3 cycle limit;
124 timeout. Timeouts contain only the last received checkpoint. Microcode
collectors report graphics/audio task starts and graphics HLE loads, including
in-list switches. Audio observations identify structural families, not HLE support.
Texture formats describe tiles selected by HLE draws, not visible pixels.
Terminal exceptions/halts include versioned result.failure details. Exceptions
retain their original type, message and stack; halt context records CPU/RSP
state. Timeouts retain only the last checkpoint and have no exception stack.

Replay starts from boot using the report's seed, limits and embedded input script.
The supplied ROM must have the same canonical SHA-256 (other byte orders work).
Settings options cannot be combined with --replay. Unsupported settings/policies
are rejected. The new report records current emulator provenance and replayOf
identifies the original report bytes and emulator. Code/runtime changes and
wall-clock limits can change the outcome. The original report is never overwritten.

${inputScriptHelp}`;

async function checkOutput(output, inputs) {
  if (!output) throw new Error('Output path must not be empty');
  if (output === '-') return;
  const destination = await stat(output).catch(() => null);
  for (const [path, label] of inputs) {
    const source = await stat(path).catch(() => null);
    if (resolve(output) === resolve(path) || (source && destination && source.dev === destination.dev && source.ino === destination.ino)) {
      throw new Error(`Output path must not overwrite the ${label}`);
    }
  }
}

try {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: {
      ...inventoryOptions,
      replay: { type: 'string' },
      'audio-corpus': { type: 'string' },
      output: { type: 'string', default: '-' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(usage);
  } else {
    if (positionals.length !== 1) throw new Error('Expected one ROM path');
    if (values.replay !== undefined && Object.keys(inventoryOptions).some(key => values[key] !== undefined)) {
      throw new Error('--replay cannot be combined with inventory settings options');
    }
    const replay = values.replay === undefined ? null : await loadReplayReport(values.replay);
    const settings = replay?.settings ?? inventorySettings(values, await loadInputScript(values['input-script']));
    const romPath = resolve(positionals[0]);
    const inputs = [[romPath, 'ROM']];
    if (replay) inputs.push([values.replay, 'replay report']);
    await checkOutput(values.output, inputs);
    const report = await runInventory(romPath, settings, { replayOf: replay?.replayOf, audioCorpus: values['audio-corpus'] });
    const json = JSON.stringify(report, null, 2) + '\n';
    if (values.output === '-') {
      process.stdout.write(json);
    } else {
      await Bun.write(values.output, json);
    }
    process.exitCode = { completed: 0, 'cycle-limit': 3, timeout: 124, halted: 2, error: 2 }[report.result.status];
  }
} catch (error) {
  console.error(`${error?.message ?? error}\n${usage}`);
  process.exitCode = 2;
}
