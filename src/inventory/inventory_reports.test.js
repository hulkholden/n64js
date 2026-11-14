import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { readInventory, validateReport } from './inventory_reports.js';
import { ci4, makeReport, withDirectory } from './test_helpers.js';

describe('inventory reports', () => {
  test('validateReport checks structural invariants and manifest provenance while ignoring dirty flag', () => {
    const report = makeReport('1', { formats: [ci4] });
    const manifest = {
      schemaVersion: 1,
      emulator: { ...report.emulator, dirty: true },
      settings: structuredClone(report.settings),
    };
    expect(() => validateReport(report, { manifest, sha256: report.rom.sha256 })).not.toThrow();

    for (const mutate of [
      value => { value.collectors = null; },
      value => { value.result = []; },
      value => { value.settings = null; },
      value => { value.emulator = null; },
      value => { value.result.status = 123; },
      value => { value.result.checkpointOnly = 'true'; },
      value => { value.rom = { name: 123, sha256: '1'.repeat(64) }; },
      value => { value.rom = { name: 'bad', sha256: 'Z'.repeat(64) }; },
    ]) {
      const copy = structuredClone(report);
      mutate(copy);
      expect(() => validateReport(copy)).toThrow('Invalid inventory report');
    }

    for (const mutate of [
      value => { value.settings.seed = 999; },
      value => { value.emulator.revision = 'c'.repeat(40); },
      value => { value.emulator.runtime = 'node'; },
      value => { value.emulator.runtimeVersion = 'new-runtime'; },
      value => { value.rom.sha256 = '2'.repeat(64); },
    ]) {
      const copy = structuredClone(report);
      mutate(copy);
      expect(() => validateReport(copy, { manifest, sha256: report.rom.sha256 })).toThrow('Report does not match its scan manifest');
    }
  });

  test('readInventory captures nonexistent input path as an error without throwing', async () => {
    await withDirectory('n64js-reports-', async directory => {
      const missing = join(directory, 'does-not-exist');
      const result = await readInventory(missing);
      expect(result.runs).toEqual([]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].path).toBe(missing);
      expect(result.errors[0].message).toBeTruthy();
    });
  });
});
