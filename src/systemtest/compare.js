#!/usr/bin/env bun
import { RunStatus } from './status.js';
import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const categories = ['main', 'tlb', 'tlb64'];

function sameTestSequence(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function failureCount(run) {
  return Object.values(run.failures).reduce((total, count) => total + count, 0);
}

function checkCoverage(base, pr) {
  const regressions = [];

  // A known storm is tolerated only at the same test with exactly the same
  // reached test sequence. Timeouts, empty runs and host errors never pass.
  const sameStorm = base.status === RunStatus.STORM && pr.status === RunStatus.STORM &&
    base.currentTest === pr.currentTest &&
    sameTestSequence(base.headings, pr.headings);

  if (pr.status !== RunStatus.COMPLETE && !sameStorm) {
    regressions.push(`Incomplete PR run: ${pr.status} at ${pr.currentTest}`);
  }
  if (![RunStatus.COMPLETE, RunStatus.STORM].includes(base.status)) {
    regressions.push(`Invalid baseline: ${base.status}`);
  }

  if (base.status === RunStatus.STORM && pr.status === RunStatus.COMPLETE) {
    const previouslyReached = pr.headings.slice(0, base.headings.length);
    if (!sameTestSequence(base.headings, previouslyReached)) {
      regressions.push('Previously reached test selection changed');
    }
  }

  if (base.status === RunStatus.COMPLETE && pr.status === RunStatus.COMPLETE) {
    if (base.tests !== pr.tests) {
      regressions.push(`Test count changed: ${base.tests} → ${pr.tests}`);
    }
    if (!sameTestSequence(base.headings, pr.headings)) {
      regressions.push('Executed test selection changed');
    }
  }

  return regressions;
}

export function compare(base, pr) {
  const regressions = checkCoverage(base, pr);
  const fixes = [];
  const newlyExposed = [];

  // The test interrupted by a baseline storm has no completed baseline result.
  const baselineHeadings = base.status === RunStatus.STORM
    ? base.headings.slice(0, -1)
    : base.headings;
  const baselineCoverage = new Set(baselineHeadings);
  const completedBeyondStorm = base.status === RunStatus.STORM && pr.status === RunStatus.COMPLETE;

  for (const [test, count] of Object.entries(pr.failures)) {
    const previous = base.failures[test] ?? 0;
    if (count <= previous) continue;

    const message = `${test}: ${previous} → ${count} failures`;
    const wasCovered = baselineCoverage.has(pr.failureTests?.[test]);
    if (completedBeyondStorm && !wasCovered) {
      newlyExposed.push(message);
    } else {
      regressions.push(message);
    }
  }

  for (const [test, count] of Object.entries(base.failures)) {
    const current = pr.failures[test] ?? 0;
    if (current < count && pr.status === RunStatus.COMPLETE) {
      fixes.push(`${test}: ${count} → ${current} failures`);
    }
  }

  for (const [label, run] of [['baseline', base], ['PR', pr]]) {
    if (run.status === RunStatus.COMPLETE && failureCount(run) !== run.failed) {
      regressions.push(`Unparsed failure reports in ${label}`);
    }
  }

  return { regressions, fixes, newlyExposed };
}

function describeRun(run) {
  const coverage = run.status === RunStatus.COMPLETE
    ? `${run.tests} cases`
    : `${run.headings.length} test headings reached`;
  return `${run.status}; ${coverage}; ${failureCount(run)} failures`;
}

function describeOutcome(comparison, pr) {
  if (comparison.regressions.length > 0) return 'Regression / incomplete';
  if (pr.status === RunStatus.STORM) return 'Known blocker (partial coverage)';
  return 'No regressions';
}

function formatDetails(category, comparison, pr) {
  const lines = [
    `### ${category}`,
    '',
    ...comparison.regressions.map(message => `- ${message}`),
    ...comparison.fixes.map(message => `- Fixed: ${message}`),
    ...comparison.newlyExposed.map(message =>
      `- Newly reached (no completed baseline): ${message}`),
  ];
  if (pr.status !== RunStatus.COMPLETE) {
    lines.push(`- Last test: ${pr.currentTest}`);
  }
  lines.push('');
  return lines;
}

async function readResult(directory, revision, category) {
  const path = resolve(directory, `${revision}-${category}.json`);
  return Bun.file(path).json();
}

async function createReport(directory, romRevision) {
  const lines = [
    '## N64 system tests',
    '',
    `ROM: \`${romRevision}\`; upstream \`base\` tests, isolated by subsystem.`,
    '',
    '| Category | Base | PR | Result |',
    '|---|---|---|---|',
  ];
  const details = [];
  let failed = false;

  for (const category of categories) {
    try {
      const base = await readResult(directory, 'base', category);
      const pr = await readResult(directory, 'pr', category);
      const comparison = compare(base, pr);
      failed ||= comparison.regressions.length > 0;

      const cells = [
        category,
        describeRun(base),
        describeRun(pr),
        describeOutcome(comparison, pr),
      ];
      lines.push(`| ${cells.join(' | ')} |`);
      details.push(...formatDetails(category, comparison, pr));
    } catch (error) {
      failed = true;
      lines.push(`| ${category} | — | — | Missing/invalid result |`);
      details.push(`- ${category}: ${String(error)}`);
    }
  }

  const summary = [...lines, '', ...details].join('\n') + '\n';
  return { summary, failed };
}

async function main() {
  const [directory, romRevision] = Bun.argv.slice(2);
  if (!directory || !romRevision) {
    throw new Error('Usage: compare.js <results-directory> <rom-revision>');
  }
  const { summary, failed } = await createReport(directory, romRevision);
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
  }
  process.exitCode = failed ? 1 : 0;
}

if (import.meta.main) {
  await main();
}
