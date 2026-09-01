#!/usr/bin/env bun

import { createHeadlessEmulator, loadROMFile } from './headless_env.js';

const romPath = Bun.argv[2];
const maxCycles = Number(Bun.argv[3] ?? 5_000_000_000);
const cyclesPerRun = 100_000_000;

if (!romPath) {
  console.error('Usage: bun run headless <rom-path> [max-cycles]');
  process.exit(2);
}

if (!Number.isSafeInteger(maxCycles) || maxCycles <= 0) {
  console.error(`Invalid cycle limit: ${Bun.argv[3]}`);
  process.exit(2);
}

let emulator = null;
let result = null;

const originalLog = console.log.bind(console);
console.log = (...args) => {
  originalLog(...args);
  const line = args.map(String).join(' ');
  const match = line.match(/Done! Tests:\s*(\d+)\. Failed:\s*(\d+)/);
  if (match) {
    result = { tests: Number(match[1]), failed: Number(match[2]) };
    emulator?.cpu0.breakExecution();
  }
};

try {
  const loadedROM = await loadROMFile(romPath);
  emulator = await createHeadlessEmulator(loadedROM, {
    onHalt: message => console.error(message),
    onWarning: message => console.error(message),
    onCheckFailure: message => console.error(message),
  });
  const { cpu0 } = emulator;

  console.error(`Running ${loadedROM.rominfo.name || romPath} (${loadedROM.rominfo.cic}) headlessly`);

  while (!result && !emulator.fatalError() && cpu0.getOpsExecuted() < maxCycles) {
    const remaining = maxCycles - cpu0.getOpsExecuted();
    cpu0.run(Math.min(cyclesPerRun, remaining));
    // Give Bun an opportunity to deliver signals between emulation frames.
    await Bun.sleep(0);
  }

  if (emulator.fatalError()) {
    process.exitCode = 2;
  } else if (!result) {
    console.error(`Timed out after ${cpu0.getOpsExecuted()} cycles`);
    process.exitCode = 3;
  } else {
    console.error(`Completed ${result.tests} tests with ${result.failed} failures`);
    process.exitCode = result.failed === 0 ? 0 : 1;
  }
} catch (error) {
  console.error(error?.stack ?? error);
  process.exitCode = 2;
}
