import { describe, expect, test } from 'bun:test';
import { median, medianAbsoluteDeviation, parseArgs } from './benchmark.js';
import { getPerformanceProfile, performanceProfile, performanceProfileDelta, setPerformanceProfiling } from './performance_profile.js';

describe('benchmark argument parsing', () => {
  test('requires a ROM', () => {
    expect(() => parseArgs([])).toThrow('at least one --rom');
  });

  test('accepts multiple ROMs and numeric options', () => {
    expect(parseArgs([
      '--rom', 'one.z64',
      '--rom', 'two.v64',
      '--mode', 'cpu',
      '--cycles', '1000',
      '--warmup-cycles', '100',
      '--samples', '3',
      '--json',
      '--profile',
    ])).toMatchObject({
      roms: ['one.z64', 'two.v64'],
      mode: 'cpu',
      cycles: 1000,
      warmupCycles: 100,
      samples: 3,
      json: true,
      profile: true,
    });
  });

  test('rejects invalid numeric options', () => {
    expect(() => parseArgs(['--rom', 'one.z64', '--samples', '0'])).toThrow('positive integer');
  });

  test('defaults to frame-based game mode', () => {
    expect(parseArgs(['--rom', 'one.z64'])).toMatchObject({
      mode: 'game',
      warmupFrames: 120,
      frames: 600,
    });
  });

  test('rejects unknown modes', () => {
    expect(() => parseArgs(['--rom', 'one.z64', '--mode', 'other'])).toThrow('game or cpu');
  });
});

describe('benchmark statistics', () => {
  test('calculates medians for odd and even sample counts', () => {
    expect(median([9, 1, 5])).toBe(5);
    expect(median([9, 1, 7, 3])).toBe(5);
  });

  test('calculates median absolute deviation', () => {
    expect(medianAbsoluteDeviation([1, 2, 3, 100, 101])).toBe(2);
  });
});

describe('performance profiling', () => {
  test('is opt-in and reports counter deltas', () => {
    setPerformanceProfiling(true);
    const start = getPerformanceProfile();
    performanceProfile.counters.compiledOps += 12;
    performanceProfile.counters.rspTasks += 2;

    expect(performanceProfileDelta(start)).toMatchObject({
      compiledOps: 12,
      rspTasks: 2,
      speedHackAttempts: 0,
    });

    setPerformanceProfiling(false);
    expect(performanceProfile.enabled).toBe(false);
  });
});
