#!/usr/bin/env bun

import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { inventoryOptions, inventorySettings, runInventory } from './inventory_runner.js';

const usage = `Usage: bun run inventory <rom-path> [options]
  --seed <uint32>       Random seed (default: 1)
  --frames <count>      VI retraces to run (default: 600)
  --max-cycles <count>  CPU cycle limit (default: 5000000000)
  --timeout-ms <ms>     Wall-clock limit including ROM startup (default: 60000)
  --output <path>       JSON report destination (default: stdout; '-' also works)
  --help               Show this help

Exit codes: 0 completed; 2 invalid arguments or emulation error; 3 cycle limit;
124 timeout. Timeouts contain only the last received checkpoint. Microcode
collectors report task starts and HLE loads, including in-list switches.
Texture formats describe tiles selected by HLE draws, not visible pixels.`;

try {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: {
      ...inventoryOptions,
      output: { type: 'string', default: '-' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(usage);
  } else {
    if (positionals.length !== 1) throw new Error('Expected one ROM path');
    const settings = inventorySettings(values);
    if (!values.output) throw new Error('Output path must not be empty');
    const romPath = resolve(positionals[0]);
    if (values.output !== '-') {
      const [source, destination] = await Promise.all([
        stat(romPath).catch(() => null),
        stat(values.output).catch(() => null),
      ]);
      if (resolve(values.output) === romPath || (source && destination && source.dev === destination.dev && source.ino === destination.ino)) {
        throw new Error('Output path must not overwrite the ROM');
      }
    }
    const report = await runInventory(romPath, settings);
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
