#!/usr/bin/env bun

import { fork, spawnSync } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { inputPolicy } from './inventory_input.js';

const usage = `Usage: bun run inventory <rom-path> [options]
  --seed <uint32>       Random seed (default: 1)
  --frames <count>      VI retraces to run (default: 600)
  --max-cycles <count>  CPU cycle limit (default: 5000000000)
  --timeout-ms <ms>     Wall-clock limit including ROM startup (default: 60000)
  --output <path>       JSON report destination (default: stdout; '-' also works)
  --help               Show this help

Exit codes: 0 completed; 2 invalid arguments or emulation error; 3 cycle limit;
124 timeout. Timeouts contain only the last received checkpoint. Microcode
observations cover graphics-task starts; in-list switches are not collected.`;

function integer(value, name, minimum, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new Error(`Invalid ${name}: ${value}`);
  }
  return number;
}

function emulatorVersion() {
  const cwd = fileURLToPath(new URL('../', import.meta.url));
  const git = args => spawnSync('git', args, { cwd, encoding: 'utf8' });
  const revision = git(['rev-parse', 'HEAD']);
  const changes = git(['status', '--porcelain']);
  return {
    revision: revision.status === 0 ? revision.stdout.trim() : null,
    dirty: changes.status === 0 ? changes.stdout.length > 0 : null,
    runtime: 'bun',
    runtimeVersion: Bun.version,
  };
}

async function runInventory(romPath, settings) {
  const report = {
    schemaVersion: 1,
    rom: null,
    emulator: emulatorVersion(),
    settings: { ...settings, randomAlgorithm: 'mulberry32', inputPolicy, graphics: 'HLE' },
    result: { status: 'error', frames: 0, cycles: 0, checkpointOnly: true, message: null },
    // Missing collector = not run. An empty microcode list means no task starts
    // were observed during this run, not that the ROM never uses graphics.
    collectors: {},
  };
  return new Promise(resolveReport => {
    const child = fork(fileURLToPath(new URL('./inventory_worker.js', import.meta.url)), [JSON.stringify({ romPath, settings })], {
      execArgv: [],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    // Emulator diagnostics must not contaminate the JSON stream on stdout.
    child.stdout.pipe(process.stderr);
    child.stderr.pipe(process.stderr);
    let timedOut = false;
    let finished = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, settings.timeoutMs);
    child.on('message', update => {
      report.rom = update.rom;
      report.collectors = update.collectors;
      report.result.frames = update.frames;
      report.result.cycles = update.cycles;
      if (update.type === 'result') {
        finished = true;
        report.result.status = update.status;
        report.result.message = update.message;
        report.result.checkpointOnly = false;
      }
    });
    child.on('error', error => { report.result.message = error.message; });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (!finished) {
        report.result.status = timedOut ? 'timeout' : 'error';
        report.result.message ??= timedOut ? `Wall-clock limit of ${settings.timeoutMs} ms reached` : `Emulator exited without a result (${signal ?? code})`;
      }
      resolveReport(report);
    });
  });
}

try {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: {
      seed: { type: 'string', default: '1' },
      frames: { type: 'string', default: '600' },
      'max-cycles': { type: 'string', default: '5000000000' },
      'timeout-ms': { type: 'string', default: '60000' },
      output: { type: 'string', default: '-' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(usage);
  } else {
    if (positionals.length !== 1) throw new Error('Expected one ROM path');
    const settings = {
      seed: integer(values.seed, 'seed', 0, 0xffffffff),
      frames: integer(values.frames, 'frames', 1),
      maxCycles: integer(values['max-cycles'], 'max-cycles', 1),
      timeoutMs: integer(values['timeout-ms'], 'timeout-ms', 1, 0x7fffffff),
    };
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
