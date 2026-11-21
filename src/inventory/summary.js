#!/usr/bin/env bun

import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { allCollectorSpecs, inspectCollector, unknownReportReason } from './collectors.js';
import { readInventory } from './reports.js';
import { runInventoryCLI } from './cli.js';

const usage = `Usage: bun run inventory-summary <inventory-root|scan-directory|report.json>
  --help  Show this help

Read saved inventories without starting emulation or checking ROM availability.
JSON output counts runs, distinct known ROM hashes, run outcomes, and runs with
observations in each known graphics/audio collector. Per-run rows retain recorded
ROM paths, emulator/settings, completion status, and collector records.

ROM aliases in a scan share a row; different seeds/scans remain separate runs.
Missing reports and pending entries are included. Missing, unsupported or invalid
collector data is unknown; a supported empty collector means not observed during
that run. Completed means the frame budget was reached. Task starts, HLE loads
and texture selections do not establish visible pixels or gameplay progress.

Malformed files and report/manifest mismatches are listed as errors while other
runs are still summarized. Those errors are excluded from run counts. Outcomes
are taken from reports; missing/unsupported reports have an unknown outcome.
Exit codes: 0 summary read successfully (even with failed ROM runs); 2 argument
or data error.`;

function summarizeCollector(collectors, spec, reportVersion) {
  if (!collectors) {
    return {
      state: 'unknown',
      reason: unknownReportReason(reportVersion),
    };
  }
  const { version, scope, state, reason, matches } = inspectCollector(collectors, spec);
  const observation = { version, scope, state };
  if (reason !== undefined) {
    observation.reason = reason;
  }
  if (matches !== undefined) {
    observation.records = matches;
  }
  return observation;
}

/** Normalizes collector observations for a single run row. */
export function summarizeRun({ collectors, ...row }) {
  const normalized = {};
  for (const spec of allCollectorSpecs) {
    normalized[spec.name] = summarizeCollector(collectors, spec, row.reportVersion);
  }
  row.collectors = normalized;
  return row;
}

function createCollectorCounters() {
  const counters = {};
  for (const spec of allCollectorSpecs) {
    counters[spec.name] = { observed: 0, notObserved: 0, unknown: 0 };
  }
  return counters;
}

function sortCounts(countsMap) {
  const sorted = [...countsMap.entries()].sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(sorted);
}

/** Summarizes all saved runs and collector counts in an inventory path. */
export async function summarizeInventory(input) {
  const { runs, errors } = await readInventory(input);
  const rows = runs.map(summarizeRun);
  const statuses = new Map();
  const distinctRoms = new Set();
  const collectors = createCollectorCounters();
  let unidentifiedRuns = 0;

  for (const row of rows) {
    const status = row.result?.status ?? 'unknown';
    statuses.set(status, (statuses.get(status) ?? 0) + 1);

    if (row.rom?.sha256) {
      distinctRoms.add(row.rom.sha256);
    } else {
      unidentifiedRuns++;
    }

    for (const [name, observation] of Object.entries(row.collectors)) {
      const bucket = observation.state === 'not-observed' ? 'notObserved' : observation.state;
      collectors[name][bucket]++;
    }
  }

  return {
    schemaVersion: 1,
    summary: {
      runs: rows.length,
      roms: distinctRoms.size,
      unidentifiedRuns,
      statuses: sortCounts(statuses),
      collectors,
      errors: errors.length,
    },
    runs: rows,
    errors,
  };
}

/** Parses CLI arguments and prints an inventory summary as JSON. */
export async function runInventorySummaryCommand(argv = Bun.argv.slice(2)) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { help: { type: 'boolean' } },
  });
  if (values.help) {
    console.log(usage);
    return 0;
  }
  if (positionals.length !== 1) {
    throw new Error('Expected one inventory root, scan directory, or report path');
  }
  const output = await summarizeInventory(resolve(positionals[0]));
  console.log(JSON.stringify(output, null, 2));
  return output.errors.length ? 2 : 0;
}

if (import.meta.main) {
  await runInventoryCLI(usage, runInventorySummaryCommand);
}
