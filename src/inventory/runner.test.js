import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { emulatorVersion, runInventory } from './runner.js';
import { inventorySettings } from './settings.js';
import { withDirectory } from './test_helpers.js';

describe('inventory runner', () => {
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
