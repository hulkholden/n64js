#!/usr/bin/env bun
import * as defaultRuntime from './headless_env.js';

/**
 * Run a ROM with an optional output observer. Return true from onOutput to stop
 * execution immediately; the caller owns interpretation of the ROM's output.
 *
 * runtime can come from another checkout, allowing the same harness to compare
 * emulator revisions. Runs must be sequential: console capture and the emulator
 * runtime both use process-global state.
 */
export async function runHeadless(romPath, {
  maxCycles = 5_000_000_000,
  runtime = defaultRuntime,
  onOutput = () => false,
} = {}) {
  if (!Number.isSafeInteger(maxCycles) || maxCycles <= 0) {
    throw new Error(`Invalid cycle limit: ${maxCycles}`);
  }

  let emulator;
  let stopped = false;
  const originalLog = console.log;
  console.log = (...args) => {
    originalLog(...args);
    for (const line of args.map(String).join(' ').split('\n')) {
      if (onOutput(line)) stopped = true;
    }
    if (stopped) emulator?.cpu0.breakExecution();
  };

  try {
    const loadedROM = await runtime.loadROMFile(romPath);
    emulator = await runtime.createHeadlessEmulator(loadedROM, {
      onHalt: message => console.error(message),
      onWarning: message => console.error(message),
      onCheckFailure: message => console.error(message),
    });
    const { cpu0 } = emulator;

    while (!stopped && !emulator.fatalError() && cpu0.getOpsExecuted() < maxCycles) {
      const remaining = maxCycles - cpu0.getOpsExecuted();
      cpu0.run(Math.min(100_000_000, remaining));
      // Give Bun an opportunity to deliver signals between emulation chunks.
      await Bun.sleep(0);
    }
    return { stopped, cycles: cpu0.getOpsExecuted(), fatalError: emulator.fatalError() };
  } finally {
    console.log = originalLog;
  }
}

async function main() {
  const [romPath, cycleArg = '5000000000'] = Bun.argv.slice(2);
  if (!romPath) throw new Error('Usage: bun run headless <rom-path> [max-cycles]');

  const result = await runHeadless(romPath, { maxCycles: Number(cycleArg) });
  if (result.fatalError) {
    console.error(result.fatalError);
    process.exitCode = 2;
  } else {
    console.error(`Executed ${result.cycles} cycles`);
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error?.stack ?? error);
    process.exitCode = 2;
  }
}
