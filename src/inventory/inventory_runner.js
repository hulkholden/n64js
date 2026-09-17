import { fork, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { inputPolicy, parseInputScript } from './inventory_input.js';
import { captureFailure } from './inventory_failure.js';

export const inventoryOptions = {
  seed: { type: 'string' },
  frames: { type: 'string' },
  'max-cycles': { type: 'string' },
  'timeout-ms': { type: 'string' },
  'input-script': { type: 'string' },
};

export async function loadInputScript(path) {
  return path === undefined ? undefined : JSON.parse(await readFile(path, 'utf8'));
}

export function inventorySettings(values, script) {
  return {
    seed: integer(values.seed ?? '1', 'seed', 0, 0xffffffff),
    frames: integer(values.frames ?? '600', 'frames', 1),
    maxCycles: integer(values['max-cycles'] ?? '5000000000', 'max-cycles', 1),
    timeoutMs: integer(values['timeout-ms'] ?? '60000', 'timeout-ms', 1, 0x7fffffff),
    randomAlgorithm: 'mulberry32',
    inputPolicy: script === undefined ? inputPolicy : {
      name: 'scripted-prefix', version: 1, script: parseInputScript(script), after: inputPolicy,
    },
    graphics: 'HLE',
  };
}

// Reject settings this version cannot reproduce, including changed input policies.
export function restoreInventorySettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Invalid inventory settings');
  const expected = inventorySettings({
    seed: String(settings.seed), frames: String(settings.frames),
    'max-cycles': String(settings.maxCycles), 'timeout-ms': String(settings.timeoutMs),
  }, settings.inputPolicy?.script);
  if (!isDeepStrictEqual(settings, expected)) throw new Error('Unsupported inventory settings or input policy');
  return expected;
}

function integer(value, name, minimum, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new Error(`Invalid ${name}: ${value}`);
  }
  return number;
}

export function emulatorVersion() {
  const cwd = fileURLToPath(new URL('../../', import.meta.url));
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

export async function runInventory(romPath, settings, { signal, replayOf } = {}) {
  const report = {
    schemaVersion: 1,
    rom: null,
    emulator: emulatorVersion(),
    settings,
    ...(replayOf ? { replayOf } : {}),
    result: { status: 'error', frames: 0, cycles: 0, checkpointOnly: true, message: null },
    // Missing collector = not run. An empty list means no matching
    // events were observed during this run, not that the ROM never uses graphics.
    collectors: {},
  };
  return new Promise(resolveReport => {
    const child = fork(fileURLToPath(new URL('./inventory_worker.js', import.meta.url)), [JSON.stringify({ romPath, settings, expectedRomSha256: replayOf?.romSha256 })], {
      execArgv: [],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    // Emulator diagnostics must not contaminate the JSON stream on stdout.
    child.stdout.pipe(process.stderr);
    child.stderr.pipe(process.stderr);
    let timedOut = false;
    let interrupted = false;
    let finished = false;
    const interrupt = () => {
      interrupted = true;
      child.kill('SIGKILL');
    };
    signal?.addEventListener('abort', interrupt, { once: true });
    if (signal?.aborted) interrupt();
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
        if (update.failure) report.result.failure = update.failure;
        report.result.checkpointOnly = false;
      }
    });
    child.on('error', error => {
      report.result.message = error.message;
      report.result.failure = captureFailure('exception', error);
    });
    child.on('close', (code, exitSignal) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', interrupt);
      if (!finished) {
        report.result.status = interrupted ? 'interrupted' : timedOut ? 'timeout' : 'error';
        report.result.message ??= interrupted ? 'Inventory interrupted' : timedOut ? `Wall-clock limit of ${settings.timeoutMs} ms reached` : `Emulator exited without a result (${exitSignal ?? code})`;
        if (!interrupted && !timedOut) {
          report.result.failure ??= { version: 1, kind: 'worker-exit', code, signal: exitSignal };
        }
      }
      resolveReport(report);
    });
  });
}
