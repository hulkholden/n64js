#!/usr/bin/env bun
// Run this same harness against either checkout, in a fresh process per category.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SystemTestOutput } from './output.js';
import { RunStatus } from './status.js';
import { runHeadless } from '../headless/headless.js';

const [checkout, rom, outputPath, cycleArg] = Bun.argv.slice(2);
if (!checkout || !rom || !outputPath) {
  throw new Error('Usage: run.js <checkout> <rom> <result.json> [max-cycles]');
}
const result = new SystemTestOutput();
try {
  // Older comparison checkouts keep the runtime directly under src/.
  const relocatedRuntime = resolve(checkout, 'src/headless/headless_env.js');
  const runtimePath = pathToFileURL(await Bun.file(relocatedRuntime).exists()
    ? relocatedRuntime
    : resolve(checkout, 'src/headless_env.js')).href;
  const runtime = await import(runtimePath);
  const execution = await runHeadless(rom, {
    runtime,
    maxCycles: cycleArg === undefined ? undefined : Number(cycleArg),
    onOutput: line => {
      result.consume(line);
      return result.status !== RunStatus.RUNNING;
    },
  });
  if (execution.fatalError) {
    result.status = RunStatus.ERROR;
    result.error = execution.fatalError;
  } else if (!execution.stopped) {
    result.status = RunStatus.TIMEOUT;
  }
} catch (error) {
  result.status = RunStatus.ERROR;
  result.error = String(error?.stack ?? error);
}
await Bun.write(outputPath, JSON.stringify(result, null, 2) + '\n');
const failureReports = Object.values(result.failures).reduce((total, count) => total + count, 0);
console.error(
  `${result.status}: ${result.tests} completed test cases, ` +
  `${failureReports} failure reports; last test: ${result.currentTest}`,
);
process.exitCode = result.status === RunStatus.COMPLETE ? (result.failed ? 1 : 0) : 2;
