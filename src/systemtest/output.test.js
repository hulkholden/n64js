import { RunStatus } from './status.js';

import { expect, test } from 'bun:test';
import { SystemTestOutput } from './output.js';
import { compare } from './compare.js';

function parse(lines) {
  const output = new SystemTestOutput();
  for (const line of lines) output.consume(line);
  return output;
}

test('legacy completion and storm termination', () => {
  expect(parse(['Done! Tests: 10. Failed: 0'])).toMatchObject({ status: RunStatus.COMPLETE, tests: 10, failed: 0 });
  expect(parse(['Running TLB test...', 'Exception storm detected. Aborting.'])).toMatchObject({ status: RunStatus.STORM, currentTest: 'TLB test' });
  expect(parse(['Done, but no tests were executed']).status).toBe(RunStatus.EMPTY);
});

test('current summary waits for its end and sums categories', () => {
  const output = parse([
    "Test 'LW' with value 1 failed: mismatch",
    "Test 'LW' with value 2 failed with exception: TLBL",
    "Test 'LW' with value 3 failed with unknown exception: 31",
    'n64-systemtest 3.0.0 (base=1 timing=1 cycle=0 cp0-hazards=0)',
    'Finished in 1.0s. Base: Failed 2 of 10 tests (80% success rate)',
    'Timing: Failed 1 of 5 tests (80% success rate)',
  ]);
  expect(output.status).toBe(RunStatus.RUNNING);
  output.consume('Slowest tests: LW (0.01s)');
  expect(output).toMatchObject({ status: RunStatus.COMPLETE, tests: 15, failed: 3 });
  expect(Object.keys(output.failures)).toHaveLength(3);
});

const complete = () => ({ status: RunStatus.COMPLETE, tests: 10, failed: 1, headings: ['A', 'B'], failures: { A: 1 }, currentTest: 'B' });
test('a fixed test cannot mask a new failure with the same total count', () => {
  const result = compare(complete(), { ...complete(), failures: { B: 1 } });
  expect(result.regressions).toEqual(['B: 0 → 1 failures']);
  expect(result.fixes).toEqual(['A: 1 → 0 failures']);
});
test('known storms require identical progress; errors and lost coverage fail', () => {
  const storm = { ...complete(), status: RunStatus.STORM };
  expect(compare(storm, storm).regressions).toEqual([]);
  expect(compare(storm, { ...storm, currentTest: 'A', headings: ['A'] }).regressions.length).toBeGreaterThan(0);
  expect(compare(complete(), storm).regressions.length).toBeGreaterThan(0);
  expect(compare({ ...storm, status: RunStatus.TIMEOUT }, complete()).regressions.length).toBeGreaterThan(0);
  expect(compare(complete(), { ...complete(), tests: 9 }).regressions.length).toBeGreaterThan(0);
  expect(compare(complete(), { ...complete(), failures: {} }).regressions).toContain('Unparsed failure reports in PR');
});

test('failures newly reached beyond a baseline storm are not called regressions', () => {
  const base = { ...complete(), status: RunStatus.STORM, currentTest: 'B' };
  const pr = { ...complete(), tests: 12, failed: 2, headings: ['A', 'B', 'C'], failures: { A: 1, C: 1 }, failureTests: { A: 'A', C: 'C' } };
  const result = compare(base, pr);
  expect(result.regressions).toEqual([]);
  expect(result.newlyExposed).toEqual(['C: 0 → 1 failures']);
});
