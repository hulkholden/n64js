#!/usr/bin/env bun

import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { collectorSpecs, inspectCollector, readInventory } from './inventory_reports.js';
import { ImageFormat, ImageSize } from '../hle/gbi.js';

const usage = `Usage: bun run inventory-query <inventory-root|scan-directory|report.json> [filters]
  --microcode <family>  Match a handler family, e.g. GBI2 (case insensitive)
  --audio-microcode <family>  Match an audio family: ABI1, NAUDIO, NEAD, Unknown
  --texture <format>    Match a texture format, e.g. CI4 or RGBA16
  --help                Show this help

Specify at least one filter. All filters must be observed in the same report;
observations from different runs are not combined. Graphics microcode searches
include task starts and HLE loads, including in-list switches. Texture searches
use the numeric format/size fields from HLE draws. Microcode fallback
classifications are included, with their detection method retained in the evidence.
Audio searches use task starts and identify task images and structural families,
not HLE support. An observed Unknown family is distinct from missing collector
data. Audio HLE execution is not implemented yet.

JSON output contains matching reports, a count of reports where the requested
combination was not observed, and unknown results when collector data is missing
or cannot be interpreted. Partial runs can supply matches; their status and checkpoint flag are
retained. Not observed does not establish that a ROM never uses a feature.
Multiple paths for a report are grouped; different runs remain separate.
ROM paths are those recorded by the scan and are not checked for availability.

Queries read saved data from any emulator revision without starting emulation.
Malformed files are listed as errors while other reports are still queried.
Exit codes: 0 matches found; 1 no confirmed matches; 2 argument or data error.`;

function parseFilters(values) {
  const filters = {};
  if (values['audio-microcode'] !== undefined) {
    if (!values['audio-microcode'].trim()) throw new Error('Expected an audio microcode family');
    filters.audioMicrocode = values['audio-microcode'].trim().toUpperCase();
  }
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
  if (!Object.keys(filters).length) throw new Error('Specify --microcode, --audio-microcode or --texture');
  return filters;
}

function assess(report, filters) {
  const checks = {};
  for (const [feature, value] of Object.entries(filters)) {
    const predicate = feature !== 'texture'
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

async function query(input, filters) {
  const output = {
    schemaVersion: 1,
    filters: { ...filters, ...(filters.texture ? { texture: filters.texture.name } : {}) },
    summary: { matched: 0, notObserved: 0, unknown: 0, errors: 0 },
    matches: [], unknown: [], errors: [],
  };
  const { runs, errors } = await readInventory(input);
  output.errors = errors;
  for (const { collectors, reportVersion, ...row } of runs) {
    const { state, checks } = collectors ? assess({ collectors }, filters) : {
      state: 'unknown',
      checks: Object.fromEntries(Object.keys(filters).map(feature => [feature, {
        state: 'unknown', reason: reportVersion === null ? 'missing-report' : 'unsupported-report-version', reportVersion,
      }])),
    };
    row.checks = checks;
    if (state === 'observed') output.matches.push(row);
    else if (state === 'unknown') output.unknown.push(row);
    else output.summary.notObserved++;
  }
  output.summary.matched = output.matches.length;
  output.summary.unknown = output.unknown.length;
  output.summary.errors = output.errors.length;
  return output;
}

try {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2), allowPositionals: true,
    options: { microcode: { type: 'string' }, 'audio-microcode': { type: 'string' }, texture: { type: 'string' }, help: { type: 'boolean' } },
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
