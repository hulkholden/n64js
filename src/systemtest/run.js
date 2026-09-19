#!/usr/bin/env bun
import { RunStatus } from './status.js';
// Run this same harness against either checkout, in a fresh process per category.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SystemTestOutput } from './output.js';
import { runHeadless } from '../headless.js';

const [checkout, rom, outputPath, cycleArg = '5000000000'] = Bun.argv.slice(2);
const maxCycles = Number(cycleArg);
if (!checkout || !rom || !outputPath || !Number.isSafeInteger(maxCycles) || maxCycles <= 0) {
  throw new Error('Usage: run.js <checkout> <rom> <result.json> [max-cycles]');
}
const result = new SystemTestOutput();
try {
  const runtimePath = pathToFileURL(resolve(checkout, 'src/headless_env.js')).href;
  const runtime = await import(runtimePath);
  const execution = await runHeadless(rom, {
    runtime,
    maxCycles,
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
} finally {
  await Bun.write(outputPath, JSON.stringify(result, null, 2) + '\n');
}
console.error(`${result.status}: ${result.tests} completed test cases, ${Object.values(result.failures).reduce((a, b) => a + b, 0)} failure reports; last test: ${result.currentTest}`);
process.exitCode = result.status === RunStatus.COMPLETE ? (result.failed ? 1 : 0) : 2;
