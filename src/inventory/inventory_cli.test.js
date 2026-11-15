import { describe, expect, test } from 'bun:test';
import { runInventoryCLI } from './inventory_cli.js';

describe('inventory CLI runner', () => {
  test('applies returned exit codes and leaves exitCode untouched on undefined', async () => {
    const originalExitCode = process.exitCode;
    const originalError = console.error;
    const errors = [];
    console.error = (...args) => errors.push(args.join(' '));
    try {
      let seenArgv = null;
      await runInventoryCLI('USAGE', async argv => {
        seenArgv = argv;
        return 0;
      }, ['rom.z64', '--frames', '1']);
      expect(seenArgv).toEqual(['rom.z64', '--frames', '1']);
      expect(process.exitCode).toBe(0);

      await runInventoryCLI('USAGE', async () => 124, []);
      expect(process.exitCode).toBe(124);

      process.exitCode = 7;
      await runInventoryCLI('USAGE', async () => undefined, []);
      expect(process.exitCode).toBe(7);
      expect(errors).toEqual([]);
    } finally {
      console.error = originalError;
      process.exitCode = originalExitCode ?? 0;
    }
  });

  test('catches Error, string, and nullish throws, prints usage to stderr, and sets exitCode 2', async () => {
    const originalExitCode = process.exitCode;
    const originalError = console.error;
    const errors = [];
    console.error = (...args) => errors.push(args.join(' '));
    try {
      for (const [thrown, expected] of [
        [new Error('bad flag'), 'bad flag\nUSAGE'],
        ['string error', 'string error\nUSAGE'],
        [null, 'null\nUSAGE'],
      ]) {
        process.exitCode = 0;
        await runInventoryCLI('USAGE', async () => {
          throw thrown;
        }, []);
        expect(process.exitCode).toBe(2);
        expect(errors.pop()).toBe(expected);
      }
    } finally {
      console.error = originalError;
      process.exitCode = originalExitCode ?? 0;
    }
  });
});
