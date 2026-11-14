#!/usr/bin/env bun

import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { collectorSpecs, inspectCollector, parseTextureFormat, unknownReportReason } from './inventory_collectors.js';
import { readInventory } from './inventory_reports.js';
import { runInventoryCLI } from './inventory_cli.js';

const usage = `Usage: bun run inventory-query <inventory-root|scan-directory|report.json> [filters]
  --microcode <family>  Match a handler family, e.g. GBI2 (case insensitive)
  --audio-microcode <family>  Match an audio family (ABI1, NAUDIO, NEAD, Unknown)
  --texture <format>    Match a texture format, e.g. CI4 or RGBA16
  --blend-mode <value>  Match the 16-bit blender mux, decimal or 0x-prefixed hex
  --cycle-type <type>   Match 1cycle, 2cycle, copy, or fill
  --help                Show this help

Graphics mode searches use state at headless draws (HLE and raw RDP).
Blend mode is the complete upper 16 bits of otherModeL, including both cycles;
it describes configured blender inputs, not whether blending affects pixels.
Blend and cycle filters must match the same recorded state. Other filters need
only occur in the same run. Clears count as draws; empty triangle batches do not.

Specify at least one filter. All filters must be observed in the same report;
observations from different runs are not combined. Graphics microcode searches
include task starts and HLE loads, including in-list switches. Texture searches
use the numeric format/size fields from HLE draws. Microcode fallback
classifications are included, with their detection method retained in the evidence.
Audio searches use task starts and reviewed microcode hashes. An observed
Unknown family is distinct from missing collector data. A known identity does
not imply HLE support; audio HLE support is a work in progress.

JSON output contains matching reports, a count of reports where the requested
combination was not observed, and unknown results when collector data is missing
or cannot be interpreted. Partial runs can supply matches; their status and checkpoint flag are
retained. Not observed does not establish that a ROM never uses a feature.
Multiple paths for a report are grouped; different runs remain separate.
ROM paths are those recorded by the scan and are not checked for availability.

Queries read saved data from any emulator revision without starting emulation.
Malformed files are listed as errors while other reports are still queried.
Exit codes: 0 matches found; 1 no confirmed matches; 2 argument or data error.`;

/** Parses and validates inventory query filter options from parseArgs values. */
export function parseFilters(values) {
  const filters = {};
  const graphicsMode = {};
  if (values['blend-mode'] !== undefined) {
    const value = values['blend-mode'].trim();
    if (!/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(value) || Number(value) > 0xffff) {
      throw new Error('Expected a 16-bit blend mode (0–65535 or 0x0000–0xffff)');
    }
    graphicsMode.blendMode = Number(value);
  }
  if (values['cycle-type'] !== undefined) {
    const name = values['cycle-type'].trim().toLowerCase();
    const index = ['1cycle', '2cycle', 'copy', 'fill'].indexOf(name);
    if (index < 0) {
      throw new Error('Expected cycle type 1cycle, 2cycle, copy, or fill');
    }
    graphicsMode.cycleType = index;
  }
  if (Object.keys(graphicsMode).length) {
    filters.graphicsMode = graphicsMode;
  }
  if (values['audio-microcode'] !== undefined) {
    if (!values['audio-microcode'].trim()) {
      throw new Error('Expected an audio microcode family');
    }
    filters.audioMicrocode = values['audio-microcode'].trim().toUpperCase();
  }
  if (values.microcode !== undefined) {
    if (!values.microcode.trim()) {
      throw new Error('Expected a microcode family');
    }
    filters.microcode = values.microcode.trim().toUpperCase();
  }
  if (values.texture !== undefined) {
    filters.texture = parseTextureFormat(values.texture);
  }
  if (!Object.keys(filters).length) {
    throw new Error('Specify --microcode, --audio-microcode, --texture, --blend-mode or --cycle-type');
  }
  return filters;
}

const featurePredicates = {
  graphicsMode: value => record =>
    (value.blendMode === undefined || (record.otherModeL >>> 16) === value.blendMode) &&
    (value.cycleType === undefined || ((record.otherModeH >>> 20) & 3) === value.cycleType),
  audioMicrocode: value => record => record.family.toUpperCase() === value,
  microcode: value => record => record.family.toUpperCase() === value,
  texture: value => record => record.format === value.format && record.size === value.size,
};

/** Evaluates parsed query filters against a report's collectors map. */
export function assessReport(collectors, filters) {
  const checks = {};
  for (const [feature, value] of Object.entries(filters)) {
    const predicate = featurePredicates[feature](value);
    const inspected = collectorSpecs[feature].map(spec => inspectCollector(collectors, spec, predicate));
    const state = inspected.some(item => item.state === 'observed') ? 'observed'
      : inspected.some(item => item.state === 'unknown') ? 'unknown' : 'not-observed';
    checks[feature] = { state, collectors: inspected };
  }
  const states = Object.values(checks).map(check => check.state);
  const state = states.includes('not-observed') ? 'not-observed' : states.includes('unknown') ? 'unknown' : 'observed';
  return { state, checks };
}

/** Queries an inventory root, scan directory, or report path with normalized filters. */
export async function queryInventory(input, filters) {
  const output = {
    schemaVersion: 1,
    filters: { ...filters, ...(filters.texture ? { texture: filters.texture.name } : {}) },
    summary: { matched: 0, notObserved: 0, unknown: 0, errors: 0 },
    matches: [], unknown: [], errors: [],
  };
  const { runs, errors } = await readInventory(input);
  output.errors = errors;
  for (const { collectors, reportVersion, ...row } of runs) {
    const { state, checks } = collectors ? assessReport(collectors, filters) : {
      state: 'unknown',
      checks: Object.fromEntries(Object.keys(filters).map(feature => [feature, {
        state: 'unknown', reason: unknownReportReason(reportVersion), reportVersion,
      }])),
    };
    row.checks = checks;
    if (state === 'observed') {
      output.matches.push(row);
    } else if (state === 'unknown') {
      output.unknown.push(row);
    } else {
      output.summary.notObserved++;
    }
  }
  output.summary.matched = output.matches.length;
  output.summary.unknown = output.unknown.length;
  output.summary.errors = output.errors.length;
  return output;
}

/** Parses CLI arguments and prints matching inventory reports as JSON. */
export async function runInventoryQueryCommand(argv = Bun.argv.slice(2)) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      'blend-mode': { type: 'string' },
      'cycle-type': { type: 'string' },
      microcode: { type: 'string' },
      'audio-microcode': { type: 'string' },
      texture: { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(usage);
    return 0;
  }
  if (positionals.length !== 1) {
    throw new Error('Expected one inventory root, scan directory, or report path');
  }
  const output = await queryInventory(resolve(positionals[0]), parseFilters(values));
  console.log(JSON.stringify(output, null, 2));
  return output.errors.length ? 2 : output.matches.length ? 0 : 1;
}

if (import.meta.main) {
  await runInventoryCLI(usage, runInventoryQueryCommand);
}
