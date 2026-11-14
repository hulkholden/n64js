#!/usr/bin/env bun

import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { allCollectorSpecs, inspectCollector, unknownReportReason } from './inventory_collectors.js';
import { readInventory } from './inventory_reports.js';
import { runInventoryCLI } from './inventory_cli.js';

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

/** Normalizes collector observations for a single run row. */
export function summarizeRun({ collectors, ...row }) {
  row.collectors = Object.fromEntries(allCollectorSpecs.map(spec => {
    if (!collectors) {
      return [spec.name, {
        state: 'unknown', reason: unknownReportReason(row.reportVersion),
      }];
    }
    const { collector, matches: records, ...observation } = inspectCollector(collectors, spec);
    return [collector, { ...observation, ...(records ? { records } : {}) }];
  }));
  return row;
}

/** Summarizes all saved runs and collector counts in an inventory path. */
export async function summarizeInventory(input) {
  const { runs, errors } = await readInventory(input);
  const rows = runs.map(summarizeRun);
  const statuses = new Map();
  const collectors = Object.fromEntries(allCollectorSpecs.map(spec => [spec.name, { observed: 0, notObserved: 0, unknown: 0 }]));
  for (const row of rows) {
    const status = row.result?.status ?? 'unknown';
    statuses.set(status, (statuses.get(status) ?? 0) + 1);
    for (const [name, observation] of Object.entries(row.collectors)) {
      const key = observation.state === 'not-observed' ? 'notObserved' : observation.state;
      collectors[name][key]++;
    }
  }
  return {
    schemaVersion: 1,
    summary: {
      runs: rows.length,
      roms: new Set(rows.map(row => row.rom?.sha256).filter(Boolean)).size,
      unidentifiedRuns: rows.filter(row => !row.rom?.sha256).length,
      statuses: Object.fromEntries([...statuses.entries()].sort(([left], [right]) => left.localeCompare(right))),
      collectors, errors: errors.length,
    },
    runs: rows, errors,
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
