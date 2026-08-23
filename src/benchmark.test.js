import { describe, expect, test } from 'bun:test';
import { median, medianAbsoluteDeviation, parseArgs } from './benchmark.js';

describe('benchmark argument parsing', () => {
  test('requires a ROM', () => {
    expect(() => parseArgs([])).toThrow('at least one --rom');
  });

  test('accepts multiple ROMs and numeric options', () => {
    expect(parseArgs([
      '--rom', 'one.z64',
      '--rom', 'two.v64',
      '--cycles', '1000',
      '--warmup-cycles', '100',
      '--samples', '3',
      '--json',
    ])).toMatchObject({
      roms: ['one.z64', 'two.v64'],
      cycles: 1000,
      warmupCycles: 100,
      samples: 3,
      json: true,
    });
  });

  test('rejects invalid numeric options', () => {
    expect(() => parseArgs(['--rom', 'one.z64', '--samples', '0'])).toThrow('positive integer');
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
