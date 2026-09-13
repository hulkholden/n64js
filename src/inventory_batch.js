#!/usr/bin/env bun

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, stat, unlink } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { fixRomByteOrder } from './endian.js';
import { emulatorVersion, inventoryOptions, inventorySettings, runInventory } from './inventory_runner.js';

const usage = `Usage: bun run inventory-batch <rom-or-directory>... --output-dir <directory> [options]
       bun run inventory-batch --resume <scan-directory>

  --output-dir <path>  Inventory root; creates runs/<scan-id>/manifest.json
  --resume <path>      Resume a scan with its saved inputs and settings
  --seed <uint32>      Random seed (default: 1)
  --frames <count>     VI retraces per ROM (default: 600)
  --max-cycles <n>     CPU cycle limit per ROM (default: 5000000000)
  --timeout-ms <ms>    Wall-clock limit per emulator run (default: 60000)
  --help              Show this help

Directories are searched recursively for .z64, .v64 and .n64 files. Directory
symlinks are not followed. ROMs run sequentially; errors and timeouts are saved
and do not stop the scan. Duplicate ROM contents share a canonical SHA-256 report.
The scan directory is printed on stdout; diagnostics and progress go to stderr.

Resume skips saved terminal results (including failures) and retries interrupted
or missing results. It requires the same emulator source, revision, runtime and
settings. Use a new scan for new settings or to retry failures. SIGINT/SIGTERM
save progress and stop the active worker. After an ungraceful termination, remove
the scan's .lock file only after confirming no batch process is still using it.

Exit codes: 0 all ROMs completed; 1 scan finished with ROM failures; 2 command or
storage error; 130 interrupted by SIGINT; 143 interrupted by SIGTERM.`;

const terminal = new Set(['completed', 'cycle-limit', 'timeout', 'halted', 'error']);

// Publish complete JSON before advancing the manifest. On resume an already
// published report can be recovered even if the manifest update was interrupted.
async function writeJSON(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await Bun.write(temporary, JSON.stringify(value, null, 2) + '\n');
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

async function directoryFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await directoryFiles(path));
    else if (entry.isFile()) files.push(path);
    else if (entry.isSymbolicLink()) {
      const target = await stat(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
      if (!target || target.isFile()) files.push(path);
    }
  }
  return files.sort();
}

async function discover(inputs) {
  const files = new Set();
  for (const input of inputs) {
    const path = resolve(input);
    const info = await stat(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (info?.isDirectory()) {
      for (const file of await directoryFiles(path)) {
        if (['.z64', '.v64', '.n64'].includes(extname(file).toLowerCase())) files.add(file);
      }
    } else {
      // Explicit missing/bad files get an error report, like the single-ROM CLI.
      files.add(path);
    }
  }
  if (!files.size) throw new Error('No ROM files found');
  return [...files].sort();
}

async function sourceHash() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const files = (await directoryFiles(join(root, 'src'))).filter(path => path.endsWith('.js') && !path.endsWith('.test.js'));
  files.push(join(root, 'package.json'), join(root, 'bun.lock'));
  const hash = createHash('sha256');
  for (const path of files.sort()) {
    hash.update(relative(root, path) + '\0').update(await readFile(path)).update('\0');
  }
  return hash.digest('hex');
}

function sameEmulator(left, right) {
  // The source hash covers dirty emulator edits. Unrelated worktree changes
  // (including generated reports) may change the dirty flag without changing code.
  return ['revision', 'runtime', 'runtimeVersion'].every(key => left?.[key] === right?.[key]);
}

async function checkSource(manifest) {
  if (!sameEmulator(manifest.emulator, emulatorVersion()) || manifest.sourceSha256 !== await sourceHash()) {
    throw new Error('Emulator source, revision or runtime changed; start a new scan');
  }
}

async function romHash(path) {
  const buffer = await Bun.file(path).arrayBuffer();
  fixRomByteOrder(buffer);
  return createHash('sha256').update(new Uint8Array(buffer)).digest('hex');
}

async function savedReport(scanDirectory, manifest, entry) {
  if (!entry.report) return null;
  const path = join(scanDirectory, entry.report);
  const json = await readFile(path, 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (json === undefined) return null;
  const report = JSON.parse(json);
  if (report.schemaVersion !== 1 || !sameEmulator(report.emulator, manifest.emulator) ||
      !isDeepStrictEqual(report.settings, manifest.settings) ||
      (report.rom?.sha256 && report.rom.sha256 !== entry.sha256) ||
      (!terminal.has(report.result?.status) && report.result?.status !== 'interrupted')) {
    throw new Error(`Report does not match this scan: ${path}`);
  }
  return report;
}

function validateManifest(manifest) {
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.entries) || !manifest.settings) {
    throw new Error('Invalid scan manifest');
  }
  const settings = manifest.settings;
  const expected = inventorySettings({
    seed: String(settings.seed), frames: String(settings.frames),
    'max-cycles': String(settings.maxCycles), 'timeout-ms': String(settings.timeoutMs),
  });
  if (!isDeepStrictEqual(settings, expected)) throw new Error('Scan settings or input policy changed; start a new scan');
  for (const [index, entry] of manifest.entries.entries()) {
    if (typeof entry.path !== 'string' || !isAbsolute(entry.path) ||
        (entry.sha256 !== null && !/^[a-f0-9]{64}$/.test(entry.sha256)) ||
        (entry.report !== null && entry.report !== `${entry.sha256 ?? `error-${index}`}.json`)) {
      throw new Error('Invalid ROM entry in scan manifest');
    }
  }
}

async function scan(scanDirectory, initialManifest) {
  const lockPath = join(scanDirectory, '.lock');
  const lock = await open(lockPath, 'wx').catch(error => {
    if (error.code === 'EEXIST') throw new Error(`Scan is locked: ${lockPath}. See --help for recovery.`);
    throw error;
  });
  const controller = new AbortController();
  let interruptCode = 130;
  const onInterrupt = () => controller.abort();
  const onTerminate = () => { interruptCode = 143; controller.abort(); };
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onTerminate);
  try {
    await lock.writeFile(`${process.pid}\n`);
    const manifestPath = join(scanDirectory, 'manifest.json');
    const manifest = initialManifest ?? JSON.parse(await readFile(manifestPath, 'utf8'));
    validateManifest(manifest);
    await checkSource(manifest);
    manifest.status = 'running';
    await writeJSON(manifestPath, manifest);
    console.log(scanDirectory);

    for (const [index, entry] of manifest.entries.entries()) {
      if (controller.signal.aborted) break;
      let report = await savedReport(scanDirectory, manifest, entry);
      if (!terminal.has(report?.result.status)) {
        await checkSource(manifest);
        const sha256 = await romHash(entry.path).catch(() => null);
        if (entry.sha256 && sha256 !== entry.sha256) {
          throw new Error(`ROM changed since this scan started: ${entry.path}`);
        }
        entry.sha256 = sha256;
        entry.report = `${sha256 ?? `error-${index}`}.json`;
        entry.status = 'pending';
        await writeJSON(manifestPath, manifest);
        // Other paths or byte orders of the same ROM reuse its first result.
        report = await savedReport(scanDirectory, manifest, entry);
        if (!terminal.has(report?.result.status)) {
          console.error(`[${index + 1}/${manifest.entries.length}] Running ${entry.path}`);
          report = await runInventory(entry.path, manifest.settings, controller.signal);
          await checkSource(manifest);
          if (report.rom?.sha256 && report.rom.sha256 !== entry.sha256) {
            throw new Error(`ROM changed while being inventoried: ${entry.path}`);
          }
          await writeJSON(join(scanDirectory, entry.report), report);
        }
      }
      entry.status = report.result.status;
      await writeJSON(manifestPath, manifest);
      console.error(`[${index + 1}/${manifest.entries.length}] ${entry.status}: ${entry.path}`);
    }

    manifest.status = manifest.entries.every(entry => terminal.has(entry.status)) ? 'completed' : 'interrupted';
    await writeJSON(manifestPath, manifest);
    if (manifest.status === 'interrupted') return interruptCode;
    return manifest.entries.every(entry => entry.status === 'completed') ? 0 : 1;
  } finally {
    process.off('SIGINT', onInterrupt);
    process.off('SIGTERM', onTerminate);
    await lock.close();
    await unlink(lockPath);
  }
}

try {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2), allowPositionals: true,
    options: { ...inventoryOptions, 'output-dir': { type: 'string' }, resume: { type: 'string' }, help: { type: 'boolean' } },
  });
  if (values.help) {
    console.log(usage);
  } else if (values.resume !== undefined) {
    if (!values.resume || positionals.length || Object.keys(values).some(key => key !== 'resume')) {
      throw new Error('--resume takes only a scan directory; inputs and settings come from its manifest');
    }
    process.exitCode = await scan(resolve(values.resume));
  } else {
    if (!values['output-dir'] || !positionals.length) throw new Error('Expected ROM paths/directories and --output-dir');
    const settings = inventorySettings(values);
    const paths = await discover(positionals);
    const id = randomUUID();
    const scanDirectory = resolve(values['output-dir'], 'runs', id);
    const manifest = {
      schemaVersion: 1, id, createdAt: new Date().toISOString(),
      emulator: emulatorVersion(), sourceSha256: await sourceHash(), settings,
      status: 'running',
      entries: paths.map(path => ({ path, sha256: null, report: null, status: 'pending' })),
    };
    await mkdir(dirname(scanDirectory), { recursive: true });
    await mkdir(scanDirectory);
    process.exitCode = await scan(scanDirectory, manifest);
  }
} catch (error) {
  console.error(`${error?.message ?? error}\n${usage}`);
  process.exitCode = 2;
}
