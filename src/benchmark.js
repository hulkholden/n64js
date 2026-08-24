#!/usr/bin/env bun

import { createHeadlessEmulator, loadROMFile, runCycles, runFrames } from './headless_env.js';
import { getPerformanceProfile, performanceProfileDelta, setPerformanceProfiling } from './performance_profile.js';

const defaults = {
  mode: 'game',
  warmupFrames: 120,
  frames: 600,
  maxCycles: 5_000_000_000,
  warmupCycles: 25_000_000,
  cycles: 250_000_000,
  samples: 7,
  chunkCycles: 10_000_000,
  json: false,
  profile: false,
};

function usage() {
  return `Usage: bun run benchmark --rom <path> [--rom <path> ...] [options]

Options:
  --mode <game|cpu>     Benchmark mode (default: ${defaults.mode})
  --warmup-frames <n>  VI retraces before each game sample (default: ${defaults.warmupFrames})
  --frames <n>         Timed VI retraces per game sample (default: ${defaults.frames})
  --max-cycles <n>     Cycle safety ceiling per frame phase (default: ${defaults.maxCycles})
  --warmup-cycles <n>  Emulated cycles before each CPU sample (default: ${defaults.warmupCycles})
  --cycles <n>         Timed emulated cycles per CPU sample (default: ${defaults.cycles})
  --samples <n>        Number of fresh-emulator samples (default: ${defaults.samples})
  --chunk-cycles <n>   Maximum cycles passed to cpu.run at once (default: ${defaults.chunkCycles})
  --json               Emit machine-readable JSON
  --profile            Include emulation profiling counters for each timed sample
  --help                Show this help

ROM paths are runtime inputs and are never stored by the benchmark harness.`;
}

function parsePositiveInteger(value, option) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error(`${option} must be a positive integer, got: ${value}`);
  }
  return number;
}

export function parseArgs(args) {
  const options = { ...defaults, roms: [] };
  for (let i = 0; i < args.length; ++i) {
    const arg = args[i];
    switch (arg) {
      case '--rom':
        if (!args[i + 1]) throw new Error('--rom requires a path');
        options.roms.push(args[++i]);
        break;
      case '--mode':
        options.mode = args[++i];
        if (options.mode !== 'game' && options.mode !== 'cpu') {
          throw new Error(`--mode must be game or cpu, got: ${options.mode}`);
        }
        break;
      case '--warmup-frames':
        options.warmupFrames = parsePositiveInteger(args[++i], arg);
        break;
      case '--frames':
        options.frames = parsePositiveInteger(args[++i], arg);
        break;
      case '--max-cycles':
        options.maxCycles = parsePositiveInteger(args[++i], arg);
        break;
      case '--warmup-cycles':
        options.warmupCycles = parsePositiveInteger(args[++i], arg);
        break;
      case '--cycles':
        options.cycles = parsePositiveInteger(args[++i], arg);
        break;
      case '--samples':
        options.samples = parsePositiveInteger(args[++i], arg);
        break;
      case '--chunk-cycles':
        options.chunkCycles = parsePositiveInteger(args[++i], arg);
        break;
      case '--json':
        options.json = true;
        break;
      case '--profile':
        options.profile = true;
        break;
      case '--help':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (!options.help && options.roms.length === 0) {
    throw new Error('at least one --rom argument is required');
  }
  return options;
}

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length & 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function medianAbsoluteDeviation(values) {
  const centre = median(values);
  return median(values.map(value => Math.abs(value - centre)));
}

function stateFingerprint(cpu0) {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < 32; ++i) {
    hash ^= cpu0.getRegU64(i);
    hash = BigInt.asUintN(64, hash * prime);
  }
  hash ^= BigInt(cpu0.pc >>> 0);
  hash = BigInt.asUintN(64, hash * prime);
  return hash.toString(16).padStart(16, '0');
}

async function benchmarkROM(romPath, options) {
  const loadedROM = await loadROMFile(romPath);
  const samples = [];

  for (let index = 0; index < options.samples; ++index) {
    const emulator = await createHeadlessEmulator(loadedROM);
    setPerformanceProfiling(options.profile);
    if (options.mode === 'game') {
      runFrames(emulator, options.warmupFrames, options.maxCycles, options.chunkCycles);
    } else {
      runCycles(emulator, options.warmupCycles, options.chunkCycles);
    }

    const startCycles = emulator.cpu0.getOpsExecuted();
    const startFrames = emulator.hardware.verticalBlankCount;
    const startProfile = options.profile ? getPerformanceProfile() : undefined;
    const start = Bun.nanoseconds();
    if (options.mode === 'game') {
      runFrames(emulator, options.frames, options.maxCycles, options.chunkCycles);
    } else {
      runCycles(emulator, options.cycles, options.chunkCycles);
    }
    const elapsedNanoseconds = Bun.nanoseconds() - start;
    const executedCycles = emulator.cpu0.getOpsExecuted() - startCycles;
    const executedFrames = emulator.hardware.verticalBlankCount - startFrames;
    const seconds = elapsedNanoseconds / 1_000_000_000;
    const sample = {
      index: index + 1,
      seconds,
      cycles: executedCycles,
      frames: executedFrames,
      cyclesPerSecond: executedCycles / seconds,
      framesPerSecond: executedFrames / seconds,
      state: stateFingerprint(emulator.cpu0),
    };
    if (startProfile) {
      sample.profile = performanceProfileDelta(startProfile);
    }
    samples.push(sample);
  }

  const rates = samples.map(sample => options.mode === 'game' ? sample.framesPerSecond : sample.cyclesPerSecond);
  const states = new Set(samples.map(sample => sample.state));
  return {
    rom: romPath,
    name: loadedROM.rominfo.name,
    cic: loadedROM.rominfo.cic,
    mode: options.mode,
    warmupFrames: options.mode === 'game' ? options.warmupFrames : undefined,
    measuredFrames: options.mode === 'game' ? options.frames : undefined,
    warmupCycles: options.mode === 'cpu' ? options.warmupCycles : undefined,
    measuredCycles: options.mode === 'cpu' ? options.cycles : undefined,
    medianFramesPerSecond: options.mode === 'game' ? median(rates) : undefined,
    medianCyclesPerSecond: options.mode === 'cpu' ? median(rates) : undefined,
    medianAbsoluteDeviation: medianAbsoluteDeviation(rates),
    deterministicState: states.size === 1,
    samples,
  };
}

function formatRate(value) {
  return `${(value / 1_000_000).toFixed(2)} Mcycles/s`;
}

function formatFrames(value) {
  return `${value.toFixed(2)} VI/s`;
}

async function main() {
  let options;
  try {
    options = parseArgs(Bun.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    process.exit(2);
  }
  if (options.help) {
    console.log(usage());
    return;
  }

  const originalLog = console.log;
  const originalWarn = console.warn;
  const results = [];
  for (const rom of options.roms) {
    console.error(`Benchmarking ${rom}`);
    console.log = () => {};
    console.warn = () => {};
    try {
      results.push(await benchmarkROM(rom, options));
    } finally {
      console.log = originalLog;
      console.warn = originalWarn;
    }
  }

  const report = {
    schemaVersion: 1,
    runtime: { bun: Bun.version, platform: process.platform, arch: process.arch },
    results,
  };
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  for (const result of results) {
    const format = result.mode === 'game' ? formatFrames : formatRate;
    const medianRate = result.mode === 'game' ? result.medianFramesPerSecond : result.medianCyclesPerSecond;
    console.log(`${result.name || result.rom}: ${format(medianRate)} (MAD ${format(result.medianAbsoluteDeviation)})`);
    if (!result.deterministicState) {
      console.log('  warning: final CPU state differs between samples');
    }
    for (const sample of result.samples) {
      const rate = result.mode === 'game' ? sample.framesPerSecond : sample.cyclesPerSecond;
      console.log(`  #${sample.index}: ${format(rate)}, ${sample.seconds.toFixed(3)}s, ${formatRate(sample.cyclesPerSecond)}, state ${sample.state}`);
      if (sample.profile) {
        const p = sample.profile;
        console.log(`    CPU: ${p.compiledOps} compiled ops, ${p.interpretedOps} interpreted ops, ${p.fragmentRuns} fragment runs`);
        console.log(`    fragments: ${p.fragmentCompilations} compiled, ${p.fragmentInvalidations} invalidated`);
        console.log(`    speedhack: ${p.speedHackActivations}/${p.speedHackAttempts} activated, ${p.speedHackSkippedCycles} cycles skipped (${p.speedHackRSPActive} RSP-active, ${p.speedHackNonNopDelay} non-NOP delay-slot rejections)`);
        console.log(`    RSP: ${p.rspInstructions} instructions, ${p.rspTasks} tasks`);
      }
    }
  }
}

if (import.meta.main) {
  await main();
}
