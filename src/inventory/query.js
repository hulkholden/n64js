#!/usr/bin/env bun

import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { collectorSpecs, inspectCollector, parseTextureFormat, unknownReportReason } from './collectors.js';
import { readInventory } from './reports.js';
import { runInventoryCLI } from './cli.js';

const CYCLE_TYPES = ['1cycle', '2cycle', 'copy', 'fill'];
const MAX_BLEND_MODE = 0xffff;

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

function parseBlendMode(raw) {
  const value = raw.trim();
  if (!/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(value) || Number(value) > MAX_BLEND_MODE) {
    throw new Error('Expected a 16-bit blend mode (0–65535 or 0x0000–0xffff)');
  }
  return Number(value);
}

function parseCycleType(raw) {
  const index = CYCLE_TYPES.indexOf(raw.trim().toLowerCase());
  if (index < 0) {
    throw new Error('Expected cycle type 1cycle, 2cycle, copy, or fill');
  }
  return index;
}

function parseMicrocodeFamily(raw, label) {
  const family = raw.trim();
  if (!family) {
    throw new Error(`Expected ${label}`);
  }
  return family.toUpperCase();
}

/** Parses and validates inventory query filter options from parseArgs values. */
export function parseFilters(values) {
  const filters = {};
  const graphicsMode = {};
  if (values['blend-mode'] !== undefined) {
    graphicsMode.blendMode = parseBlendMode(values['blend-mode']);
  }
  if (values['cycle-type'] !== undefined) {
    graphicsMode.cycleType = parseCycleType(values['cycle-type']);
  }
  if (Object.keys(graphicsMode).length) {
    filters.graphicsMode = graphicsMode;
  }
  if (values['audio-microcode'] !== undefined) {
    filters.audioMicrocode = parseMicrocodeFamily(values['audio-microcode'], 'an audio microcode family');
  }
  if (values.microcode !== undefined) {
    filters.microcode = parseMicrocodeFamily(values.microcode, 'a microcode family');
  }
  if (values.texture !== undefined) {
    filters.texture = parseTextureFormat(values.texture);
  }
  if (!Object.keys(filters).length) {
    throw new Error('Specify --microcode, --audio-microcode, --texture, --blend-mode or --cycle-type');
  }
  return filters;
}

function extractBlendMode(record) {
  return record.otherModeL >>> 16;
}

function extractCycleType(record) {
  return (record.otherModeH >>> 20) & 3;
}

const featurePredicates = {
  graphicsMode: filter => record =>
    (filter.blendMode === undefined || extractBlendMode(record) === filter.blendMode) &&
    (filter.cycleType === undefined || extractCycleType(record) === filter.cycleType),
  audioMicrocode: family => record => record.family.toUpperCase() === family,
  microcode: family => record => record.family.toUpperCase() === family,
  texture: filter => record => record.format === filter.format && record.size === filter.size,
};

function combineCollectorStates(inspected) {
  if (inspected.some(item => item.state === 'observed')) {
    return 'observed';
  }
  if (inspected.some(item => item.state === 'unknown')) {
    return 'unknown';
  }
  return 'not-observed';
}

function combineFeatureStates(states) {
  if (states.includes('not-observed')) {
    return 'not-observed';
  }
  if (states.includes('unknown')) {
    return 'unknown';
  }
  return 'observed';
}

/** Evaluates parsed query filters against a report's collectors map. */
export function assessReport(collectors, filters) {
  const checks = {};
  for (const [feature, value] of Object.entries(filters)) {
    const predicate = featurePredicates[feature](value);
    const inspected = collectorSpecs[feature].map(spec => inspectCollector(collectors, spec, predicate));
    checks[feature] = {
      state: combineCollectorStates(inspected),
      collectors: inspected,
    };
  }
  const state = combineFeatureStates(Object.values(checks).map(check => check.state));
  return { state, checks };
}

function formatOutputFilters(filters) {
  return {
    ...filters,
    ...(filters.texture ? { texture: filters.texture.name } : {}),
  };
}

function buildUnknownChecks(filters, reportVersion) {
  const reason = unknownReportReason(reportVersion);
  const checks = {};
  for (const feature of Object.keys(filters)) {
    checks[feature] = { state: 'unknown', reason, reportVersion };
  }
  return checks;
}

/** Queries an inventory root, scan directory, or report path with normalized filters. */
export async function queryInventory(input, filters) {
  const { runs, errors } = await readInventory(input);
  const matches = [];
  const unknown = [];
  let notObserved = 0;

  for (const { collectors, reportVersion, ...row } of runs) {
    const assessment = collectors
      ? assessReport(collectors, filters)
      : { state: 'unknown', checks: buildUnknownChecks(filters, reportVersion) };
    row.checks = assessment.checks;
    if (assessment.state === 'observed') {
      matches.push(row);
    } else if (assessment.state === 'unknown') {
      unknown.push(row);
    } else {
      notObserved++;
    }
  }

  return {
    schemaVersion: 1,
    filters: formatOutputFilters(filters),
    summary: {
      matched: matches.length,
      notObserved,
      unknown: unknown.length,
      errors: errors.length,
    },
    matches,
    unknown,
    errors,
  };
}

function exitCodeForQuery(output) {
  if (output.errors.length) {
    return 2;
  }
  return output.matches.length ? 0 : 1;
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
  return exitCodeForQuery(output);
}

if (import.meta.main) {
  await runInventoryCLI(usage, runInventoryQueryCommand);
}
