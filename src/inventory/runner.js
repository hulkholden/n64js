import { fork, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { captureFailure } from './failure.js';
import { REPORT_SCHEMA_VERSION } from './schema.js';

const WORKER_PATH = fileURLToPath(new URL('./worker.js', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

export function emulatorVersion() {
  const git = args => spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
  const revision = git(['rev-parse', 'HEAD']);
  const changes = git(['status', '--porcelain']);
  return {
    revision: revision.status === 0 ? revision.stdout.trim() : null,
    dirty: changes.status === 0 ? changes.stdout.length > 0 : null,
    runtime: 'bun',
    runtimeVersion: Bun.version,
  };
}

function createEmptyReport(settings, replayOf) {
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    rom: null,
    emulator: emulatorVersion(),
    settings,
    ...(replayOf ? { replayOf } : {}),
    result: { status: 'error', frames: 0, cycles: 0, checkpointOnly: true, message: null },
    // Missing collector = not run. An empty list means no matching
    // events were observed during this run, not that the ROM never uses graphics.
    collectors: {},
  };
}

function applyWorkerUpdate(report, update) {
  report.rom = update.rom;
  report.collectors = update.collectors;
  report.result.frames = update.frames;
  report.result.cycles = update.cycles;
  if (update.type !== 'result') {
    return false;
  }
  report.result.status = update.status;
  report.result.message = update.message;
  if (update.failure) {
    report.result.failure = update.failure;
  }
  report.result.checkpointOnly = false;
  return true;
}

function finalizeIncompleteResult(report, { interrupted, timedOut, timeoutMs, code, exitSignal }) {
  if (interrupted) {
    report.result.status = 'interrupted';
    report.result.message ??= 'Inventory interrupted';
    return;
  }
  if (timedOut) {
    report.result.status = 'timeout';
    report.result.message ??= `Wall-clock limit of ${timeoutMs} ms reached`;
    return;
  }
  report.result.status = 'error';
  report.result.message ??= `Emulator exited without a result (${exitSignal ?? code})`;
  report.result.failure ??= { version: 1, kind: 'worker-exit', code, signal: exitSignal };
}

export async function runInventory(romPath, settings, { signal, replayOf } = {}) {
  const report = createEmptyReport(settings, replayOf);
  const workerPayload = JSON.stringify({ romPath, settings, expectedRomSha256: replayOf?.romSha256 });

  return new Promise(resolveReport => {
    const child = fork(WORKER_PATH, [workerPayload], {
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
    if (signal?.aborted) {
      interrupt();
    }

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, settings.timeoutMs);

    child.on('message', update => {
      if (applyWorkerUpdate(report, update)) {
        finished = true;
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
        finalizeIncompleteResult(report, {
          interrupted,
          timedOut,
          timeoutMs: settings.timeoutMs,
          code,
          exitSignal,
        });
      }
      resolveReport(report);
    });
  });
}
