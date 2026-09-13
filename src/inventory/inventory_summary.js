#!/usr/bin/env bun

import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { collectorSpecs, inspectCollector, readInventory } from './inventory_reports.js';

const usage = `Usage: bun run inventory-summary <inventory-root|scan-directory|report.json>
  --help  Show this help

Read saved inventories without starting emulation or checking ROM availability.
JSON output counts runs, distinct known ROM hashes, run outcomes, and runs with
observations in each known graphics collector. Per-run rows retain recorded ROM
paths, emulator/settings, completion status, and collector records.

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

const specs = Object.values(collectorSpecs).flat();

function summarizeRun({ collectors, ...row }) {
  row.collectors = Object.fromEntries(specs.map(spec => {
    if (!collectors) return [spec.name, {
      state: 'unknown', reason: row.reportVersion === null ? 'missing-report' : 'unsupported-report-version',
    }];
    const { collector, matches: records, ...observation } = inspectCollector({ collectors }, spec, () => true);
    return [collector, { ...observation, ...(records ? { records } : {}) }];
  }));
  return row;
}

async function summarize(input) {
  const { runs, errors } = await readInventory(input);
  const rows = runs.map(summarizeRun);
  const statuses = new Map();
  const collectors = Object.fromEntries(specs.map(spec => [spec.name, { observed: 0, notObserved: 0, unknown: 0 }]));
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

try {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2), allowPositionals: true, options: { help: { type: 'boolean' } },
  });
  if (values.help) {
    console.log(usage);
  } else {
    if (positionals.length !== 1) throw new Error('Expected one inventory root, scan directory, or report path');
    const output = await summarize(resolve(positionals[0]));
    console.log(JSON.stringify(output, null, 2));
    process.exitCode = output.errors.length ? 2 : 0;
  }
} catch (error) {
  console.error(`${error.message ?? error}\n${usage}`);
  process.exitCode = 2;
}
