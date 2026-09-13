import { readFile, readdir, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export const collectorSpecs = {
  microcode: [
    { name: 'graphics.taskMicrocodes', scope: 'task-start', records: 'microcodes', count: 'tasks' },
    { name: 'graphics.microcodeLoads', scope: 'hle-load', records: 'microcodes', count: 'loads' },
  ],
  texture: [{ name: 'graphics.textureFormats', scope: 'hle-draw', records: 'formats' }],
};

export function inspectCollector(report, spec, predicate) {
  const data = report.collectors[spec.name];
  const result = { collector: spec.name, version: data?.version ?? null, scope: data?.scope ?? null, state: 'unknown' };
  if (!data) return { ...result, reason: 'missing-collector' };
  if (data.version !== 1) return { ...result, reason: 'unsupported-version' };
  if (data.scope !== spec.scope) return { ...result, reason: 'unsupported-scope' };
  const records = data[spec.records];
  const validRecord = spec.count
    ? record => typeof record?.family === 'string' && Number.isSafeInteger(record[spec.count]) && record[spec.count] > 0
    : record => Number.isInteger(record?.format) && Number.isInteger(record?.size);
  if (!Array.isArray(records) || !records.every(validRecord)) return { ...result, reason: 'invalid-records' };
  const matches = records.filter(predicate);
  return { ...result, state: matches.length ? 'observed' : 'not-observed', matches };
}

async function readJSON(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function scanSources(directory) {
  const manifestPath = join(directory, 'manifest.json');
  const manifest = await readJSON(manifestPath);
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.entries) || !manifest.settings || !manifest.emulator) {
    throw new Error('Invalid or unsupported scan manifest');
  }
  const sources = new Map();
  for (const [index, entry] of manifest.entries.entries()) {
    if (typeof entry?.path !== 'string' || !isAbsolute(entry.path) ||
        (entry.sha256 !== null && !/^[a-f0-9]{64}$/.test(entry.sha256)) ||
        (entry.report !== null && entry.report !== `${entry.sha256 ?? `error-${index}`}.json`)) {
      throw new Error('Invalid ROM entry in scan manifest');
    }
    // A pending entry without a report still needs to appear as unknown.
    const key = entry.report ?? `pending-${index}`;
    if (!sources.has(key)) {
      sources.set(key, {
        reportPath: entry.report ? join(directory, entry.report) : null,
        paths: [], sha256: entry.sha256, manifest,
        scan: { path: manifestPath, id: manifest.id, createdAt: manifest.createdAt, status: manifest.status, sourceSha256: manifest.sourceSha256 },
      });
    }
    const paths = sources.get(key).paths;
    if (!paths.includes(entry.path)) paths.push(entry.path);
  }
  return [...sources.values()];
}

async function discoverSources(input, errors) {
  const info = await stat(input);
  if (info.isFile()) return [{ reportPath: input, paths: [], scan: null }];
  const manifest = await stat(join(input, 'manifest.json')).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (manifest) return scanSources(input);

  const runs = join(input, 'runs');
  const directories = (await readdir(runs, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  const sources = [];
  for (const name of directories) {
    const directory = join(runs, name);
    try {
      sources.push(...await scanSources(directory));
    } catch (error) {
      errors.push({ path: join(directory, 'manifest.json'), message: String(error.message ?? error) });
    }
  }
  return sources;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateReport(report, source = {}) {
  if (!isObject(report.collectors) || !isObject(report.result) || !isObject(report.settings) || !isObject(report.emulator) ||
      typeof report.result.status !== 'string' || typeof report.result.checkpointOnly !== 'boolean' ||
      (report.rom !== null && (typeof report.rom?.name !== 'string' || !/^[a-f0-9]{64}$/.test(report.rom?.sha256)))) {
    throw new Error('Invalid inventory report');
  }
  if (source.manifest && (!isDeepStrictEqual(report.settings, source.manifest.settings) ||
      !['revision', 'runtime', 'runtimeVersion'].every(key => report.emulator[key] === source.manifest.emulator[key]) ||
      (report.rom?.sha256 && report.rom.sha256 !== source.sha256))) {
    throw new Error('Report does not match its scan manifest');
  }
}

function resultRow(source, report) {
  return {
    rom: report?.rom ?? (source.sha256 ? { sha256: source.sha256, name: null } : null),
    paths: source.paths, reportPath: source.reportPath, scan: source.scan,
    emulator: report?.emulator ?? source.manifest?.emulator ?? null,
    settings: report?.settings ?? source.manifest?.settings ?? null,
    result: report?.result ?? null,
    ...(report?.replayOf ? { replayOf: report.replayOf } : {}),
  };
}

async function readSource(source) {
  let report;
  if (source.reportPath) {
    report = await readJSON(source.reportPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  if (report !== undefined && (!isObject(report) || !Number.isSafeInteger(report.schemaVersion) || report.schemaVersion < 1)) {
    throw new Error('Invalid inventory report');
  }
  const reportVersion = report?.schemaVersion ?? null;
  if (reportVersion !== 1) {
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
