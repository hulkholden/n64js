import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { EmulationMode } from '../hle/emulation_mode.js';
import {
  emulatorVersion,
  inventorySettings,
  loadInputScript,
  restoreInventorySettings,
  runInventory,
} from './inventory_runner.js';
import { withDirectory } from './test_helpers.js';

describe('inventory runner settings and helpers', () => {
  test('builds default and boundary settings', () => {
    expect(inventorySettings({})).toEqual({
      seed: 1,
      frames: 600,
      maxCycles: 5_000_000_000,
      timeoutMs: 60_000,
      randomAlgorithm: 'mulberry32',
      inputPolicy: { name: 'random-controller', version: 1 },
      graphics: EmulationMode.HLE,
    });

    expect(inventorySettings({
      seed: '0',
      frames: '1',
      'max-cycles': '1',
      'timeout-ms': '2147483647',
    })).toMatchObject({
      seed: 0,
      frames: 1,
      maxCycles: 1,
      timeoutMs: 2147483647,
    });

    expect(inventorySettings({ seed: '4294967295' }).seed).toBe(4294967295);
  });

  test('rejects invalid numeric setting formats and bounds', () => {
    for (const [option, invalid] of [
      ['seed', '-1'],
      ['seed', '0x10'],
      ['seed', '1e3'],
      ['seed', '1.5'],
      ['seed', ''],
      ['seed', '4294967296'],
      ['frames', '0'],
      ['max-cycles', '0'],
      ['max-cycles', String(Number.MAX_SAFE_INTEGER + 1)],
      ['timeout-ms', '0'],
      ['timeout-ms', '2147483648'],
    ]) {
      expect(() => inventorySettings({ [option]: invalid })).toThrow();
    }
  });

  test('restores valid settings and rejects unsupported or tampered policies', () => {
    const baseline = inventorySettings({});
    expect(restoreInventorySettings(structuredClone(baseline))).toEqual(baseline);

    const scripted = inventorySettings({ seed: '7', frames: '120' }, {
      version: 1,
      steps: [{ frames: 10, buttons: ['start'] }],
    });
    expect(restoreInventorySettings(structuredClone(scripted))).toEqual(scripted);

    for (const invalid of [null, undefined, [], 'text']) {
      expect(() => restoreInventorySettings(invalid)).toThrow('Invalid inventory settings');
    }

    for (const mutate of [
      settings => { settings.randomAlgorithm = 'lcg'; },
      settings => { settings.graphics = EmulationMode.LLE; },
      settings => { settings.inputPolicy.version = 2; },
      settings => { settings.extra = true; },
    ]) {
      const copy = structuredClone(baseline);
      mutate(copy);
      expect(() => restoreInventorySettings(copy)).toThrow('Unsupported inventory settings or input policy');
    }

    const zeroTimeout = structuredClone(baseline);
    zeroTimeout.timeoutMs = 0;
    expect(() => restoreInventorySettings(zeroTimeout)).toThrow('Invalid timeout-ms: 0');

    const tamperedScripted = structuredClone(scripted);
    tamperedScripted.inputPolicy.after = { name: 'random-controller', version: 2 };
    expect(() => restoreInventorySettings(tamperedScripted)).toThrow('Unsupported inventory settings or input policy');

    const invalidScript = structuredClone(scripted);
    invalidScript.inputPolicy.script.steps[0].frames = 0;
    expect(() => restoreInventorySettings(invalidScript)).toThrow();
  });

  test('loads optional input scripts from disk and rejects missing or malformed JSON', async () => {
    expect(await loadInputScript(undefined)).toBeUndefined();

    await withDirectory('n64js-runner-', async directory => {
      const validPath = join(directory, 'script.json');
      const payload = { version: 1, steps: [{ frames: 5, buttons: ['A'] }] };
      await Bun.write(validPath, JSON.stringify(payload));
      expect(await loadInputScript(validPath)).toEqual(payload);

      const brokenPath = join(directory, 'broken.json');
      await Bun.write(brokenPath, '{');
      await expect(loadInputScript(brokenPath)).rejects.toThrow();
      await expect(loadInputScript(join(directory, 'missing.json'))).rejects.toThrow();
    });
  });

  test('reports emulator git revision and Bun runtime metadata', () => {
    const version = emulatorVersion();
    expect(version.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(typeof version.dirty).toBe('boolean');
    expect(version.runtime).toBe('bun');
    expect(version.runtimeVersion).toBe(Bun.version);
  });

  test('handles a pre-aborted AbortSignal cleanly', async () => {
    await withDirectory('n64js-runner-', async directory => {
      const romPath = join(directory, 'unused.z64');
      const settings = inventorySettings({ frames: '1', 'timeout-ms': '5000' });
      const report = await runInventory(romPath, settings, { signal: AbortSignal.abort() });
      expect(report).toMatchObject({
        schemaVersion: 1,
        rom: null,
        settings,
        collectors: {},
        result: {
          status: 'interrupted',
          frames: 0,
          cycles: 0,
          checkpointOnly: true,
          message: 'Inventory interrupted',
        },
      });
      expect(report.result.failure).toBeUndefined();
    });
  });
});
