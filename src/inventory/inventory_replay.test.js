import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { EmulationMode } from '../hle/emulation_mode.js';
import { loadReplayReport } from './inventory_replay.js';
import { withDirectory } from './test_helpers.js';

function makeReplayableReport() {
  return {
    schemaVersion: 1,
    rom: { sha256: 'a'.repeat(64), name: 'REPLAY TEST' },
    emulator: { revision: 'b'.repeat(40), dirty: true, runtime: 'bun', runtimeVersion: '1.0.0' },
    settings: {
      seed: 42,
      frames: 100,
      maxCycles: 1000000,
      timeoutMs: 10000,
      randomAlgorithm: 'mulberry32',
      inputPolicy: { name: 'random-controller', version: 1 },
      graphics: EmulationMode.HLE,
    },
    result: { status: 'timeout', frames: 5, cycles: 5000, checkpointOnly: true, message: 'Timed out' },
    collectors: {},
  };
}

describe('inventory replay loader', () => {
  test('loads valid report, restores settings, and hashes raw file bytes', async () => {
    await withDirectory('n64js-replay-', async directory => {
      const report = makeReplayableReport();
      // Deliberately use non-pretty JSON formatting to verify raw-byte SHA-256 hashing.
      const raw = `  ${JSON.stringify(report)}  \n`;
      const path = join(directory, 'report.json');
      await Bun.write(path, raw);

      const loaded = await loadReplayReport(path);
      expect(loaded).toEqual({
        settings: report.settings,
        replayOf: {
          reportSha256: createHash('sha256').update(raw).digest('hex'),
          romSha256: report.rom.sha256,
          emulator: report.emulator,
        },
      });
    });
  });

  test('rejects invalid versions, missing or invalid ROM SHA-256, malformed structure, and unsupported settings', async () => {
    await withDirectory('n64js-replay-', async directory => {
      await expect(loadReplayReport(join(directory, 'missing.json'))).rejects.toThrow();

      for (const mutate of [
        report => { report.schemaVersion = 2; },
        report => { report.rom = null; },
        report => { report.rom.sha256 = 'abc'; },
        report => { report.rom.sha256 = 'A'.repeat(64); },
        report => { report.collectors = []; },
        report => { report.result = null; },
        report => { report.emulator = null; },
        report => { report.result.checkpointOnly = 'false'; },
        report => { report.settings.randomAlgorithm = 'other'; },
      ]) {
        const copy = makeReplayableReport();
        mutate(copy);
        const path = join(directory, 'bad.json');
        await Bun.write(path, JSON.stringify(copy));
        await expect(loadReplayReport(path)).rejects.toThrow();
      }
    });
  });
});
