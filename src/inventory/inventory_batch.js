#!/usr/bin/env bun

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, stat, unlink } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { fixRomByteOrder } from '../endian.js';
import { emulatorVersion, inventoryOptions, inventorySettings, loadInputScript, restoreInventorySettings, runInventory } from './inventory_runner.js';
import { inputScriptHelp } from './inventory_input.js';

// Conventional shell exit statuses: 128 + signal number (SIGINT = 2, SIGTERM = 15).
const EXIT_CODE_SIGINT = 130;
const EXIT_CODE_SIGTERM = 143;

const usage = `Usage: bun run inventory-batch <rom-or-directory>... --output-dir <directory> [options]
       bun run inventory-batch --resume <scan-directory> [--resume <scan-directory>...]

  --output-dir <path>  Inventory root; creates runs/<scan-id>/manifest.json
  --resume <path>      Resume saved inputs/settings; repeat for multiple scans
  --seed <uint32>      Random seed (default: 1); repeat for multiple seeds
  --frames <count>     VI retraces per ROM (default: 600)
  --max-cycles <n>     CPU cycle limit per ROM (default: 5000000000)
  --timeout-ms <ms>    Wall-clock limit per emulator run (default: 60000)
  --input-script <path> JSON menu sequence applied to every ROM and seed
  --help              Show this help

Directories are searched recursively for .z64, .v64 and .n64 files. Directory
symlinks are not followed. ROMs run sequentially; errors and timeouts are saved
and do not stop later ROMs or seeds. Each seed gets a separate scan directory;
duplicate ROM contents share a canonical SHA-256 report within each scan.
Seeds run in argument order; repeated seed values are ignored. All manifests are
saved before emulation starts, so seeds not yet started can also be resumed.
Scan directories are printed one per line on stdout before emulation starts;
diagnostics and progress go to stderr. Repeat --resume to resume them together.

Resume skips saved terminal results (including failures) and retries interrupted
or missing results. It requires the same emulator source, revision, runtime and
settings. Use a new scan for new settings or to retry failures. SIGINT/SIGTERM
save progress and stop the active worker. After an ungraceful termination, remove
the scan's .lock file only after confirming no batch process is still using it.

Exit codes: 0 all ROMs completed; 1 scan finished with ROM failures; 2 command or
storage error; ${EXIT_CODE_SIGINT} interrupted by SIGINT; ${EXIT_CODE_SIGTERM} interrupted by SIGTERM.

${inputScriptHelp}
Batch manifests embed the script; --resume does not read the original file.`;

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
  const root = fileURLToPath(new URL('../../', import.meta.url));
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
  restoreInventorySettings(manifest.settings);
  for (const [index, entry] of manifest.entries.entries()) {
    if (typeof entry.path !== 'string' || !isAbsolute(entry.path) ||
        (entry.sha256 !== null && !/^[a-f0-9]{64}$/.test(entry.sha256)) ||
        (entry.report !== null && entry.report !== `${entry.sha256 ?? `error-${index}`}.json`)) {
      throw new Error('Invalid ROM entry in scan manifest');
    }
  }
}

async function prepareEntry(scanDirectory, manifest, index) {
  const entry = manifest.entries[index];
  await checkSource(manifest);
  const sha256 = await romHash(entry.path).catch(() => null);
  if (entry.sha256 && sha256 !== entry.sha256) {
    throw new Error(`ROM changed since this scan started: ${entry.path}`);
  }
  entry.sha256 = sha256;
  entry.report = `${sha256 ?? `error-${index}`}.json`;
  entry.status = 'pending';
  await writeJSON(join(scanDirectory, 'manifest.json'), manifest);
}

async function collectEntry(scanDirectory, manifest, index, signal) {
  const entry = manifest.entries[index];
  let report = await savedReport(scanDirectory, manifest, entry);
  if (terminal.has(report?.result.status)) return report;

  await prepareEntry(scanDirectory, manifest, index);
  // Other paths or byte orders of the same ROM reuse its first result.
  report = await savedReport(scanDirectory, manifest, entry);
  if (terminal.has(report?.result.status)) return report;

  console.error(`[${index + 1}/${manifest.entries.length}] Running ${entry.path}`);
  report = await runInventory(entry.path, manifest.settings, { signal });
  await checkSource(manifest);
  if (report.rom?.sha256 && report.rom.sha256 !== entry.sha256) {
    throw new Error(`ROM changed while being inventoried: ${entry.path}`);
  }
  await writeJSON(join(scanDirectory, entry.report), report);
  return report;
}

async function scan(scanDirectory, signal) {
  const lockPath = join(scanDirectory, '.lock');
  const lock = await open(lockPath, 'wx').catch(error => {
    if (error.code === 'EEXIST') throw new Error(`Scan is locked: ${lockPath}. See --help for recovery.`);
    throw error;
  });
  try {
    await lock.writeFile(`${process.pid}\n`);
    const manifestPath = join(scanDirectory, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    validateManifest(manifest);
    await checkSource(manifest);
    manifest.status = 'running';
    await writeJSON(manifestPath, manifest);

    for (const [index, entry] of manifest.entries.entries()) {
      if (signal.aborted) break;
      const report = await collectEntry(scanDirectory, manifest, index, signal);
      entry.status = report.result.status;
      await writeJSON(manifestPath, manifest);
      console.error(`[${index + 1}/${manifest.entries.length}] ${entry.status}: ${entry.path}`);
    }

    manifest.status = manifest.entries.every(entry => terminal.has(entry.status)) ? 'completed' : 'interrupted';
    await writeJSON(manifestPath, manifest);
    return manifest.entries.every(entry => entry.status === 'completed') ? 0 : 1;
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

async function scanAll(scanDirectories) {
  const controller = new AbortController();
  let interruptCode = EXIT_CODE_SIGINT;
  const onInterrupt = () => controller.abort();
  const onTerminate = () => { interruptCode = EXIT_CODE_SIGTERM; controller.abort(); };
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onTerminate);
  try {
    for (const directory of scanDirectories) console.log(directory);
    let exitCode = 0;
    for (const directory of scanDirectories) {
      if (controller.signal.aborted) break;
      console.error(`Scanning ${directory}`);
      const code = await scan(directory, controller.signal);
      if (code !== 0) exitCode = code;
    }
    return controller.signal.aborted ? interruptCode : exitCode;
  } finally {
    process.off('SIGINT', onInterrupt);
    process.off('SIGTERM', onTerminate);
  }
}

async function createScans(outputDirectory, paths, settingsList) {
  const emulator = emulatorVersion();
  const sourceSha256 = await sourceHash();
  const directories = [];
  for (const settings of settingsList) {
    const id = randomUUID();
    const directory = resolve(outputDirectory, 'runs', id);
    const manifest = {
      schemaVersion: 1, id, createdAt: new Date().toISOString(),
      emulator, sourceSha256, settings,
      status: 'pending',
      entries: paths.map(path => ({ path, sha256: null, report: null, status: 'pending' })),
    };
    await mkdir(dirname(directory), { recursive: true });
    await mkdir(directory);
    await writeJSON(join(directory, 'manifest.json'), manifest);
    directories.push(directory);
  }
  return directories;
}

try {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2), allowPositionals: true,
    options: {
      ...inventoryOptions, seed: { type: 'string', multiple: true },
      'output-dir': { type: 'string' }, resume: { type: 'string', multiple: true }, help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(usage);
  } else if (values.resume !== undefined) {
    if (values.resume.some(path => !path) || positionals.length || Object.keys(values).some(key => key !== 'resume')) {
      throw new Error('--resume takes only scan directories; inputs and settings come from their manifests');
    }
    process.exitCode = await scanAll([...new Set(values.resume.map(path => resolve(path)))]);
  } else {
    if (!values['output-dir'] || !positionals.length) throw new Error('Expected ROM paths/directories and --output-dir');
    const script = await loadInputScript(values['input-script']);
    const settings = (values.seed ?? ['1']).map(seed => inventorySettings({ ...values, seed }, script));
    const uniqueSettings = [...new Map(settings.map(value => [value.seed, value])).values()];
    const paths = await discover(positionals);
    const directories = await createScans(values['output-dir'], paths, uniqueSettings);
    process.exitCode = await scanAll(directories);
  }
} catch (error) {
  console.error(`${error?.message ?? error}\n${usage}`);
  process.exitCode = 2;
}
