import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { collectorSpecs, inspectCollector, readInventory, validateReport } from './inventory_reports.js';
import { ci4, makeReport, withDirectory } from './test_helpers.js';

describe('inventory reports', () => {
  test('inspectCollector classifies missing, invalid, not-observed, and observed states', () => {
    const modeSpec = collectorSpecs.graphicsMode[0];
    const audioSpec = collectorSpecs.audioMicrocode[0];
    const textureSpec = collectorSpecs.texture[0];
    const validMode = { otherModeH: 1 << 20, otherModeL: 0xc8110000, combineHi: 0, combineLo: 0, draws: 3 };

    expect(inspectCollector({ collectors: {} }, modeSpec, () => true)).toMatchObject({
      collector: 'graphics.drawModes', version: null, scope: null, state: 'unknown', reason: 'missing-collector',
    });

    expect(inspectCollector({
      collectors: { 'graphics.drawModes': { version: 2, scope: 'headless-draw', modes: [] } },
    }, modeSpec, () => true)).toMatchObject({
      version: 2, scope: 'headless-draw', state: 'unknown', reason: 'unsupported-version',
    });

    expect(inspectCollector({
      collectors: { 'graphics.drawModes': { version: 1, scope: 'other-scope', modes: [] } },
    }, modeSpec, () => true)).toMatchObject({
      version: 1, scope: 'other-scope', state: 'unknown', reason: 'unsupported-scope',
    });

    for (const badCollector of [
      { version: 1, scope: 'headless-draw', modes: [{ ...validMode, draws: 0 }] },
      { version: 1, scope: 'headless-draw', modes: [{ ...validMode, otherModeL: -1 }] },
      { version: 1, scope: 'headless-draw', modes: [{ ...validMode, otherModeH: 0x1_0000_0000 }] },
      { version: 1, scope: 'headless-draw', modes: [null] },
    ]) {
      expect(inspectCollector({ collectors: { 'graphics.drawModes': badCollector } }, modeSpec, () => true)).toMatchObject({
        state: 'unknown', reason: 'invalid-records',
      });
    }

    expect(inspectCollector({
      collectors: { 'graphics.textureFormats': { version: 1, scope: 'hle-draw', formats: [{ format: 'CI', size: 0 }] } },
    }, textureSpec, () => true)).toMatchObject({ state: 'unknown', reason: 'invalid-records' });

    expect(inspectCollector({
      collectors: { 'audio.taskMicrocodes': { version: 1, scope: 'task-start', tasks: 1, microcodes: [{ family: 'ABI1', tasks: 0 }] } },
    }, audioSpec, () => true)).toMatchObject({ state: 'unknown', reason: 'invalid-records' });

    expect(inspectCollector({
      collectors: { 'graphics.drawModes': { version: 1, scope: 'headless-draw', modes: [validMode] } },
    }, modeSpec, () => false)).toEqual({
      collector: 'graphics.drawModes', version: 1, scope: 'headless-draw', state: 'not-observed', matches: [],
    });

    expect(inspectCollector({
      collectors: { 'graphics.drawModes': { version: 1, scope: 'headless-draw', modes: [validMode] } },
    }, modeSpec, record => record.draws === 3)).toEqual({
      collector: 'graphics.drawModes', version: 1, scope: 'headless-draw', state: 'observed', matches: [validMode],
    });
  });

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
