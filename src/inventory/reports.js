import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  REPORT_SCHEMA_VERSION,
  ignoreMissing,
  isPlainObject,
  validateManifest,
  validateReport,
} from './schema.js';

export { validateReport };

async function readJSON(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function makeScanSummary(manifestPath, manifest) {
  return {
    path: manifestPath,
    id: manifest.id,
    createdAt: manifest.createdAt,
    status: manifest.status,
    sourceSha256: manifest.sourceSha256,
  };
}

async function scanSources(directory) {
  const manifestPath = join(directory, 'manifest.json');
  const manifest = await readJSON(manifestPath);
  validateManifest(manifest);

  const scan = makeScanSummary(manifestPath, manifest);
  const sources = new Map();
  for (const [index, entry] of manifest.entries.entries()) {
    // A pending entry without a report still needs to appear as unknown.
    const key = entry.report ?? `pending-${index}`;
    let source = sources.get(key);
    if (!source) {
      source = {
        reportPath: entry.report ? join(directory, entry.report) : null,
        paths: [],
        sha256: entry.sha256,
        manifest,
        scan,
      };
      sources.set(key, source);
    }
    if (!source.paths.includes(entry.path)) {
      source.paths.push(entry.path);
    }
  }
  return [...sources.values()];
}

async function listSubdirectories(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
}

async function discoverSources(input, errors) {
  const info = await stat(input);
  if (info.isFile()) {
    return [{ reportPath: input, paths: [], scan: null }];
  }

  const manifest = await stat(join(input, 'manifest.json')).catch(ignoreMissing);
  if (manifest) {
    return scanSources(input);
  }

  const runsDir = join(input, 'runs');
  const sources = [];
  for (const name of await listSubdirectories(runsDir)) {
    const directory = join(runsDir, name);
    try {
      sources.push(...await scanSources(directory));
    } catch (error) {
      errors.push({ path: join(directory, 'manifest.json'), message: String(error.message ?? error) });
    }
  }
  return sources;
}

function resultRow(source, report) {
  return {
    rom: report?.rom ?? (source.sha256 ? { sha256: source.sha256, name: null } : null),
    paths: source.paths,
    reportPath: source.reportPath,
    scan: source.scan,
    emulator: report?.emulator ?? source.manifest?.emulator ?? null,
    settings: report?.settings ?? source.manifest?.settings ?? null,
    result: report?.result ?? null,
    ...(report?.replayOf ? { replayOf: report.replayOf } : {}),
  };
}

function hasValidSchemaVersion(report) {
  return isPlainObject(report) && Number.isSafeInteger(report.schemaVersion) && report.schemaVersion >= 1;
}

async function readSource(source) {
  let report;
  if (source.reportPath) {
    report = await readJSON(source.reportPath).catch(ignoreMissing);
  }
  if (report !== undefined && !hasValidSchemaVersion(report)) {
    throw new Error('Invalid inventory report');
  }
  const reportVersion = report?.schemaVersion ?? null;
  if (reportVersion !== REPORT_SCHEMA_VERSION) {
    return { ...resultRow(source, null), reportVersion, collectors: null };
  }
  validateReport(report, source);
  return { ...resultRow(source, report), reportVersion, collectors: report.collectors };
}

// Keep historical reports readable without consulting the checkout or ROM files.
// Missing/future reports retain manifest provenance, but their fields are not read.
export async function readInventory(input) {
  const runs = [];
  const errors = [];
  let sources = [];
  try {
    sources = await discoverSources(input, errors);
  } catch (error) {
    errors.push({ path: input, message: String(error.message ?? error) });
  }
  for (const source of sources) {
    try {
      runs.push(await readSource(source));
    } catch (error) {
      errors.push({ path: source.reportPath, message: String(error.message ?? error) });
    }
  }
  return { runs, errors };
}
