#!/usr/bin/env bun

import { readFile, readdir, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { ImageFormat, ImageSize } from '../hle/gbi.js';

const usage = `Usage: bun run inventory-query <inventory-root|scan-directory|report.json> [filters]
  --microcode <family>  Match a handler family, e.g. GBI2 (case insensitive)
  --texture <format>    Match a texture format, e.g. CI4 or RGBA16
  --help                Show this help

Specify at least one filter. Both filters must be observed in the same report;
observations from different runs are not combined. Microcode searches include
task starts and HLE loads, including in-list switches. Texture searches use the
numeric format/size fields from HLE draws. Microcode fallback classifications
are included, with their detection method retained in the evidence.

JSON output contains matching reports, a count of reports where the requested
combination was not observed, and unknown results when collector data is missing
or cannot be interpreted. Partial runs can supply matches; their status and checkpoint flag are
retained. Not observed does not establish that a ROM never uses a feature.
Multiple paths for a report are grouped; different runs remain separate.
ROM paths are those recorded by the scan and are not checked for availability.

Queries read saved data from any emulator revision without starting emulation.
Malformed files are listed as errors while other reports are still queried.
Exit codes: 0 matches found; 1 no confirmed matches; 2 argument or data error.`;

const collectorSpecs = {
  microcode: [
    { name: 'graphics.taskMicrocodes', scope: 'task-start', records: 'microcodes', count: 'tasks' },
    { name: 'graphics.microcodeLoads', scope: 'hle-load', records: 'microcodes', count: 'loads' },
  ],
  texture: [{ name: 'graphics.textureFormats', scope: 'hle-draw', records: 'formats' }],
};

function parseFilters(values) {
  const filters = {};
  if (values.microcode !== undefined) {
    if (!values.microcode.trim()) throw new Error('Expected a microcode family');
    filters.microcode = values.microcode.trim().toUpperCase();
  }
  if (values.texture !== undefined) {
    const name = values.texture.trim().toUpperCase();
    const match = /^(RGBA|YUV|CI|IA|I)(4|8|16|32)$/.exec(name);
    if (!match) throw new Error('Expected a texture format such as CI4 or RGBA16');
    filters.texture = {
      name, format: ImageFormat[`G_IM_FMT_${match[1]}`], size: ImageSize[`G_IM_SIZ_${match[2]}b`],
    };
  }
  if (!Object.keys(filters).length) throw new Error('Specify --microcode or --texture');
  return filters;
}

function inspectCollector(report, spec, predicate) {
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

function assess(report, filters) {
  const checks = {};
  for (const [feature, value] of Object.entries(filters)) {
    const predicate = feature === 'microcode'
      ? record => record.family.toUpperCase() === value
      : record => record.format === value.format && record.size === value.size;
    const collectors = collectorSpecs[feature].map(spec => inspectCollector(report, spec, predicate));
    const state = collectors.some(item => item.state === 'observed') ? 'observed'
      : collectors.some(item => item.state === 'unknown') ? 'unknown' : 'not-observed';
    checks[feature] = { state, collectors };
  }
  const states = Object.values(checks).map(check => check.state);
  const state = states.includes('not-observed') ? 'not-observed' : states.includes('unknown') ? 'unknown' : 'observed';
  return { state, checks };
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

function validateReport(report, source) {
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

function resultRow(source, report, checks) {
  return {
    rom: report?.rom ?? (source.sha256 ? { sha256: source.sha256, name: null } : null),
    paths: source.paths, reportPath: source.reportPath, scan: source.scan,
    emulator: report?.emulator ?? source.manifest?.emulator ?? null,
    settings: report?.settings ?? source.manifest?.settings ?? null,
    result: report?.result ?? null, checks,
  };
}

async function querySource(source, filters) {
  let report;
  if (source.reportPath) {
    report = await readJSON(source.reportPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  if (report !== undefined && (!isObject(report) || !Number.isSafeInteger(report.schemaVersion) || report.schemaVersion < 1)) {
    throw new Error('Invalid inventory report');
  }
  if (report === undefined || report.schemaVersion !== 1) {
    const reason = report ? 'unsupported-report-version' : 'missing-report';
    const checks = Object.fromEntries(Object.keys(filters).map(feature => [feature, {
      state: 'unknown', reason, reportVersion: report?.schemaVersion ?? null,
    }]));
    return { state: 'unknown', row: resultRow(source, null, checks) };
  }
  validateReport(report, source);
  const { state, checks } = assess(report, filters);
  return { state, row: resultRow(source, report, checks) };
}

async function query(input, filters) {
  const output = {
    schemaVersion: 1,
    filters: { ...filters, ...(filters.texture ? { texture: filters.texture.name } : {}) },
    summary: { matched: 0, notObserved: 0, unknown: 0, errors: 0 },
    matches: [], unknown: [], errors: [],
  };
  let sources = [];
  try {
    sources = await discoverSources(input, output.errors);
  } catch (error) {
    output.errors.push({ path: input, message: String(error.message ?? error) });
  }
  for (const source of sources) {
    try {
      const { state, row } = await querySource(source, filters);
      if (state === 'observed') output.matches.push(row);
      else if (state === 'unknown') output.unknown.push(row);
      else output.summary.notObserved++;
    } catch (error) {
      output.errors.push({ path: source.reportPath, message: String(error.message ?? error) });
    }
  }
  output.summary.matched = output.matches.length;
  output.summary.unknown = output.unknown.length;
  output.summary.errors = output.errors.length;
  return output;
}

try {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2), allowPositionals: true,
    options: { microcode: { type: 'string' }, texture: { type: 'string' }, help: { type: 'boolean' } },
  });
  if (values.help) {
    console.log(usage);
  } else {
    if (positionals.length !== 1) throw new Error('Expected one inventory root, scan directory, or report path');
    const output = await query(resolve(positionals[0]), parseFilters(values));
    console.log(JSON.stringify(output, null, 2));
    process.exitCode = output.errors.length ? 2 : output.matches.length ? 0 : 1;
  }
} catch (error) {
  console.error(`${error.message ?? error}\n${usage}`);
  process.exitCode = 2;
}
