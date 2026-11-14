import { describe, expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ci4, invokeCLI, makeReport, rgba16, withDirectory, writeScan } from './test_helpers.js';

const summaryCLI = fileURLToPath(new URL('./inventory_summary.js', import.meta.url));

async function invokeSummary(args) {
  const result = await invokeCLI(summaryCLI, args);
  return { ...result, output: result.stdout ? JSON.parse(result.stdout) : null };
}

describe('inventory summary', () => {
  test('prints usage with --help', async () => {
    const help = await invokeCLI(summaryCLI, ['--help']);
    expect(help.code).toBe(0);
    expect(help.stderr).toBe('');
    expect(help.stdout).toContain('Usage: bun run inventory-summary');
  });

  test('counts distinct ROMs separately from runs and preserves empty, partial, aliased, and replayed observations', async () => {
    await withDirectory('n64js-inventory-summary-', async root => {
      const active = makeReport('1', { formats: [ci4] });
      active.collectors['graphics.drawModes'] = {
        version: 1,
        scope: 'headless-draw',
        modes: [{ otherModeH: 1 << 20, otherModeL: 0xc8112078, combineHi: 0, combineLo: 0, draws: 2 }],
      };
      active.collectors['audio.taskMicrocodes'] = {
        version: 1,
        scope: 'task-start',
        tasks: 1,
        microcodes: [{ family: 'ABI1', detection: 'hash', tasks: 1 }],
      };
      const empty = makeReport('2', { loaded: [] });
      empty.collectors['graphics.taskMicrocodes'] = { version: 1, scope: 'task-start', tasks: 0, microcodes: [] };
      const partial = makeReport('3', { formats: [rgba16] });
      partial.result = { ...partial.result, status: 'timeout', frames: 120, checkpointOnly: true };
      partial.replayOf = {
        reportSha256: 'c'.repeat(64),
        romSha256: partial.rom.sha256,
        emulator: { revision: 'd'.repeat(40), dirty: false, runtime: 'bun', runtimeVersion: '0.9.0' },
      };
      const { directory, manifest } = await writeScan(root, 'seed-1', [active, empty, partial]);
      manifest.entries.push({ ...manifest.entries[0], path: '/roms/alias.v64' });
      manifest.entries[0].status = 'pending'; // Published report is newer than the manifest status.
      await Bun.write(join(directory, 'manifest.json'), JSON.stringify(manifest));
      const otherSeed = makeReport('1', { seed: 2 });
      otherSeed.settings.inputPolicy = { name: 'scripted-prefix', version: 1, script: { version: 1, steps: [{ frames: 120 }] } };
      await writeScan(root, 'seed-2', [otherSeed]);

      const result = await invokeSummary([root]);
      expect(result.code).toBe(0);
      expect(result.output.summary).toEqual({
        runs: 4, roms: 3, unidentifiedRuns: 0, statuses: { completed: 3, timeout: 1 }, errors: 0,
        collectors: {
          'graphics.drawModes': { observed: 1, notObserved: 0, unknown: 3 },
          'audio.taskMicrocodes': { observed: 1, notObserved: 0, unknown: 3 },
          'graphics.taskMicrocodes': { observed: 3, notObserved: 1, unknown: 0 },
          'graphics.microcodeLoads': { observed: 3, notObserved: 1, unknown: 0 },
          'graphics.textureFormats': { observed: 2, notObserved: 2, unknown: 0 },
        },
      });
      expect(result.output.runs[0]).toMatchObject({
        rom: active.rom, paths: ['/roms/ROM 1.z64', '/roms/alias.v64'], reportVersion: 1,
        settings: active.settings, emulator: active.emulator, result: active.result,
      });
      expect(result.output.runs[0].collectors['graphics.drawModes'].records).toEqual(active.collectors['graphics.drawModes'].modes);
      expect(result.output.runs[0].collectors['audio.taskMicrocodes'].records).toEqual(active.collectors['audio.taskMicrocodes'].microcodes);
      expect(result.output.runs[1].collectors['graphics.taskMicrocodes']).toMatchObject({ state: 'not-observed', records: [] });
      expect(result.output.runs[2]).toMatchObject({
        result: partial.result,
        replayOf: partial.replayOf,
        collectors: {
          'graphics.textureFormats': { state: 'observed', records: [rgba16] },
        },
      });
      expect(result.output.runs[3].settings).toEqual(otherSeed.settings);
      expect((await invokeSummary([directory])).output.runs).toEqual(result.output.runs.slice(0, 3));
      const standalone = await invokeSummary([result.output.runs[0].reportPath]);
      expect(standalone.output.runs[0]).toMatchObject({ rom: active.rom, paths: [], scan: null, result: active.result });
    });
  });

  test('keeps unknown data distinct from empty observations and continues past invalid saved data', async () => {
    await withDirectory('n64js-inventory-summary-', async root => {
      const legacy = makeReport('1');
      delete legacy.collectors['graphics.microcodeLoads'];
      delete legacy.collectors['graphics.textureFormats'];
      const unsupported = makeReport('2');
      unsupported.collectors['graphics.taskMicrocodes'].version = 2;
      unsupported.collectors['graphics.microcodeLoads'].scope = 'unknown-scope';
      unsupported.collectors['graphics.textureFormats'].formats = 'invalid';
      const future = { ...makeReport('3'), schemaVersion: 2 };
      const broken = makeReport('4');
      const mismatched = makeReport('5');
      const { directory, manifest } = await writeScan(root, 'scan', [legacy, unsupported, future, broken, mismatched]);
      manifest.entries.push({ path: '/roms/pending.z64', sha256: null, report: null, status: 'pending' });
      manifest.entries.push({ path: '/roms/missing.z64', sha256: '6'.repeat(64), report: `${'6'.repeat(64)}.json`, status: 'completed' });
      await Bun.write(join(directory, 'manifest.json'), JSON.stringify(manifest));
      await Bun.write(join(directory, `${broken.rom.sha256}.json`), '{broken');
      mismatched.settings.seed = 99;
      await Bun.write(join(directory, `${mismatched.rom.sha256}.json`), JSON.stringify(mismatched));
      const unsafe = await writeScan(root, 'unsafe', [makeReport('7')]);
      unsafe.manifest.entries[0].report = '../outside.json';
      await Bun.write(join(unsafe.directory, 'manifest.json'), JSON.stringify(unsafe.manifest));

      const result = await invokeSummary([root]);
      expect(result.code).toBe(2);
      expect(result.output.summary).toMatchObject({
        runs: 5, roms: 4, unidentifiedRuns: 1, statuses: { completed: 2, unknown: 3 }, errors: 3,
        collectors: {
          'graphics.taskMicrocodes': { observed: 1, notObserved: 0, unknown: 4 },
          'graphics.microcodeLoads': { observed: 0, notObserved: 0, unknown: 5 },
          'graphics.textureFormats': { observed: 0, notObserved: 0, unknown: 5 },
        },
      });
      expect(result.output.runs[0].collectors['graphics.textureFormats'].reason).toBe('missing-collector');
      expect(Object.values(result.output.runs[1].collectors).map(item => item.reason)).toEqual(['missing-collector', 'missing-collector', 'unsupported-version', 'unsupported-scope', 'invalid-records']);
      expect(result.output.runs[2]).toMatchObject({ reportVersion: 2, result: null, rom: { sha256: future.rom.sha256, name: null } });
      expect(result.output.runs[2].collectors['graphics.taskMicrocodes'].reason).toBe('unsupported-report-version');
      expect(result.output.runs.slice(3).every(row => row.collectors['graphics.taskMicrocodes'].reason === 'missing-report')).toBe(true);
      expect(result.output.errors).toHaveLength(3);
      expect((await invokeSummary([join(directory, `${future.rom.sha256}.json`)])).code).toBe(0);
    });
  });

  test('summarizes empty inventories and failed ROM runs, reports missing paths, and rejects invalid arguments', async () => {
    await withDirectory('n64js-inventory-summary-', async root => {
      const missing = await invokeSummary([join(root, 'missing-inventory')]);
      expect(missing.code).toBe(2);
      expect(missing.output.summary).toMatchObject({ runs: 0, roms: 0, unidentifiedRuns: 0, statuses: {}, errors: 1 });
      expect(missing.output.errors).toHaveLength(1);

      await mkdir(join(root, 'runs'));
      const empty = await invokeSummary([root]);
      expect(empty.code).toBe(0);
      expect(empty.output.summary).toMatchObject({ runs: 0, roms: 0, unidentifiedRuns: 0, statuses: {}, errors: 0 });
      const failed = makeReport('1');
      failed.rom = null;
      failed.result = { status: 'error', frames: 0, cycles: 0, checkpointOnly: true, message: 'ROM could not be loaded' };
      failed.collectors = {};
      const path = join(root, 'failed.json');
      await Bun.write(path, JSON.stringify(failed));
      const result = await invokeSummary([path]);
      expect(result.code).toBe(0);
      expect(result.output.summary).toMatchObject({ runs: 1, roms: 0, unidentifiedRuns: 1, statuses: { error: 1 }, errors: 0 });
      expect(result.output.runs[0].result).toEqual(failed.result);
    });
    for (const args of [[], ['/one', '/two'], ['--unknown']]) {
      const invalid = await invokeSummary(args);
      expect(invalid.code).toBe(2);
      expect(invalid.stdout).toBe('');
    }
  });
});
