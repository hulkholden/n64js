import { describe, expect, test } from 'bun:test';
import {
  MANIFEST_SCHEMA_VERSION,
  REPORT_EXIT_CODES,
  REPORT_SCHEMA_VERSION,
  TERMINAL_STATUSES,
  entryReportName,
  ignoreMissing,
  isPlainObject,
  isSha256,
  sameEmulator,
  sha256Hex,
  validateManifest,
  validateReport,
} from './inventory_schema.js';
import { ci4, makeReport } from './test_helpers.js';

describe('inventory schema helpers', () => {
  test('exposes expected schema constants and terminal exit codes', () => {
    expect(REPORT_SCHEMA_VERSION).toBe(1);
    expect(MANIFEST_SCHEMA_VERSION).toBe(1);
    expect([...TERMINAL_STATUSES]).toEqual(['completed', 'cycle-limit', 'timeout', 'halted', 'error']);
    expect(REPORT_EXIT_CODES).toEqual({
      completed: 0,
      'cycle-limit': 3,
      timeout: 124,
      halted: 2,
      error: 2,
    });
  });

  test('isPlainObject distinguishes plain objects from primitives, null, and arrays', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
    for (const value of [null, undefined, [], ['a'], 'object', 42, true]) {
      expect(isPlainObject(value)).toBe(false);
    }
  });

  test('isSha256 and sha256Hex validate and compute lowercase 64-hex digests', () => {
    const digest = sha256Hex(new Uint8Array([1, 2, 3]));
    expect(isSha256(digest)).toBe(true);
    expect(isSha256('a'.repeat(64))).toBe(true);
    for (const invalid of ['A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), null, 123, {}]) {
      expect(isSha256(invalid)).toBe(false);
    }
  });

  test('ignoreMissing suppresses ENOENT and rethrows other errors', () => {
    const missing = Object.assign(new Error('not found'), { code: 'ENOENT' });
    expect(ignoreMissing(missing)).toBeUndefined();

    const denied = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    expect(() => ignoreMissing(denied)).toThrow('permission denied');
    expect(() => ignoreMissing(null)).toThrow();
  });

  test('sameEmulator compares revision, runtime, and runtimeVersion while ignoring dirty', () => {
    const base = { revision: 'a'.repeat(40), dirty: false, runtime: 'bun', runtimeVersion: '1.3.14' };
    expect(sameEmulator(base, { ...base, dirty: true })).toBe(true);
    expect(sameEmulator(base, { ...base, revision: 'b'.repeat(40) })).toBe(false);
    expect(sameEmulator(base, { ...base, runtime: 'node' })).toBe(false);
    expect(sameEmulator(base, { ...base, runtimeVersion: '1.3.13' })).toBe(false);
    expect(sameEmulator(base, null)).toBe(false);
  });

  test('entryReportName derives canonical and error-indexed filenames', () => {
    const hash = 'f'.repeat(64);
    expect(entryReportName(hash, 0)).toBe(`${hash}.json`);
    expect(entryReportName(null, 3)).toBe('error-3.json');
  });

  test('validateManifest enforces manifest shape and entry invariants', () => {
    const hash = '1'.repeat(64);
    const valid = {
      schemaVersion: 1,
      emulator: { revision: 'a'.repeat(40), dirty: false, runtime: 'bun', runtimeVersion: '1.3.14' },
      settings: { seed: 1 },
      entries: [
        { path: '/roms/good.z64', sha256: hash, report: `${hash}.json`, status: 'completed' },
        { path: '/roms/bad.z64', sha256: null, report: 'error-1.json', status: 'error' },
        { path: '/roms/pending.z64', sha256: null, report: null, status: 'pending' },
      ],
    };
    expect(() => validateManifest(valid)).not.toThrow();

    for (const invalid of [null, []]) {
      expect(() => validateManifest(invalid)).toThrow('Invalid or unsupported scan manifest');
    }

    for (const mutate of [
      manifest => { manifest.schemaVersion = 2; },
      manifest => { manifest.entries = 'bad'; },
      manifest => { manifest.settings = []; },
      manifest => { manifest.emulator = null; },
    ]) {
      const copy = structuredClone(valid);
      mutate(copy);
      expect(() => validateManifest(copy)).toThrow('Invalid or unsupported scan manifest');
    }

    for (const badEntry of [
      null,
      { path: 'relative/rom.z64', sha256: null, report: null },
      { path: '/roms/bad.z64', sha256: 'not-a-hash', report: null },
      { path: '/roms/bad.z64', sha256: { toString: () => hash }, report: null },
      { path: '/roms/bad.z64', sha256: hash, report: 'other.json' },
      { path: '/roms/bad.z64', sha256: null, report: 'error-99.json' },
    ]) {
      const copy = structuredClone(valid);
      copy.entries[0] = badEntry;
      expect(() => validateManifest(copy)).toThrow('Invalid ROM entry in scan manifest');
    }
  });

  test('validateReport rejects non-object reports and mismatches against a scan manifest', () => {
    const report = makeReport('1', { formats: [ci4] });
    expect(() => validateReport(null)).toThrow('Invalid inventory report');
    expect(() => validateReport([])).toThrow('Invalid inventory report');
    expect(() => validateReport({ ...report, rom: [] })).toThrow('Invalid inventory report');

    const manifest = {
      schemaVersion: 1,
      emulator: { ...report.emulator, dirty: true },
      settings: structuredClone(report.settings),
    };
    expect(() => validateReport(report, { manifest, sha256: report.rom.sha256 })).not.toThrow();
  });
});
