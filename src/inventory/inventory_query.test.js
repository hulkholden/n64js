import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('./inventory_query.js', import.meta.url));
const summaryCLI = fileURLToPath(new URL('./inventory_summary.js', import.meta.url));
const ci4 = { format: 2, size: 0, name: 'CI4' };
const rgba16 = { format: 0, size: 2, name: 'RGBA16' };

function makeReport(id, { family = 'GBI2', loaded = [family], formats = [], seed = 1 } = {}) {
  return {
    schemaVersion: 1,
    rom: { sha256: String(id).repeat(64), name: `ROM ${id}` },
    emulator: { revision: 'a'.repeat(40), dirty: false, runtime: 'bun', runtimeVersion: 'old-runtime' },
    settings: { seed, frames: 600, maxCycles: 10000000, timeoutMs: 30000, inputPolicy: { name: 'random-controller', version: 1 } },
    result: { status: 'completed', frames: 600, cycles: 123456, checkpointOnly: false, message: null },
    collectors: {
      'graphics.taskMicrocodes': { version: 1, scope: 'task-start', tasks: 1, microcodes: [{ family, detection: 'string', tasks: 1 }] },
      'graphics.microcodeLoads': { version: 1, scope: 'hle-load', loads: loaded.length, microcodes: loaded.map(family => ({ family, detection: 'string', loads: 1 })) },
      'graphics.textureFormats': { version: 1, scope: 'hle-draw', formats },
    },
  };
}

async function writeScan(root, id, reports) {
  const directory = join(root, 'runs', id);
  const manifest = {
    schemaVersion: 1, id, createdAt: '2026-09-13T00:00:00.000Z', status: 'completed', sourceSha256: 'f'.repeat(64),
    emulator: reports[0].emulator, settings: reports[0].settings,
    entries: reports.map(report => ({
      path: `/roms/${report.rom.name}.z64`, sha256: report.rom.sha256, report: `${report.rom.sha256}.json`, status: report.result.status,
    })),
  };
  for (const report of reports) await Bun.write(join(directory, `${report.rom.sha256}.json`), JSON.stringify(report));
  await Bun.write(join(directory, 'manifest.json'), JSON.stringify(manifest));
  return { directory, manifest };
}

async function invoke(args, command = cli) {
  const child = Bun.spawn([process.execPath, command, ...args], { stdout: 'pipe', stderr: 'pipe' });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { code, stdout, stderr, output: stdout ? JSON.parse(stdout) : null };
}

async function withDirectory(fn) {
  const root = await mkdtemp(join(tmpdir(), 'n64js-inventory-query-'));
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}

describe('inventory query', () => {
  test('matches in-list switches and numeric texture formats while retaining partial-run evidence and ROM aliases', async () => {
    await withDirectory(async root => {
      const switched = makeReport('1', { family: 'GBI1', loaded: ['GBI1', 'GBI2'], formats: [{ ...ci4, name: 'legacy label' }] });
      switched.result = { ...switched.result, status: 'timeout', checkpointOnly: true, message: 'Wall-clock limit reached' };
      const misleadingLabel = makeReport('2', { formats: [{ ...rgba16, name: 'CI4' }] });
      const otherFamily = makeReport('3', { family: 'GBI1', formats: [ci4] });
      const { directory, manifest } = await writeScan(root, 'scan', [switched, misleadingLabel, otherFamily]);
      manifest.entries.push({ ...manifest.entries[0], path: '/roms/alternate.v64' });
      // A report can be published before its manifest status is updated.
      manifest.entries[0].status = 'pending';
      await Bun.write(join(directory, 'manifest.json'), JSON.stringify(manifest));
      const result = await invoke([root, '--microcode', 'gbi2', '--texture', 'ci4']);
      expect(result.code).toBe(0);
      expect(result.output.summary).toEqual({ matched: 1, notObserved: 2, unknown: 0, errors: 0 });
      const match = result.output.matches[0];
      expect(match).toMatchObject({
        rom: switched.rom, paths: ['/roms/ROM 1.z64', '/roms/alternate.v64'],
        emulator: switched.emulator, settings: switched.settings, result: switched.result,
        scan: { id: 'scan', sourceSha256: manifest.sourceSha256 },
      });
      expect(match.checks.microcode.collectors.map(item => item.state)).toEqual(['not-observed', 'observed']);
      expect(match.checks.microcode.collectors[1].matches).toEqual([{ family: 'GBI2', detection: 'string', loads: 1 }]);
      expect(match.checks.texture.collectors[0].matches).toEqual(switched.collectors['graphics.textureFormats'].formats);
      expect((await invoke([directory, '--microcode', 'GBI2', '--texture', 'CI4'])).output).toEqual(result.output);

      const single = await invoke([match.reportPath, '--texture', 'CI4']);
      expect(single.code).toBe(0);
      expect(single.output.matches[0]).toMatchObject({ rom: switched.rom, paths: [], scan: null, result: switched.result });
    });
  });

  test('keeps seeds separate and does not assemble a combined match from different runs', async () => {
    await withDirectory(async root => {
      await writeScan(root, 'seed-1', [makeReport('1', { formats: [rgba16], seed: 1 })]);
      await writeScan(root, 'seed-2', [makeReport('1', { family: 'GBI1', formats: [ci4], seed: 2 })]);
      await writeScan(root, 'seed-3', [makeReport('1', { family: 'GBI1', formats: [ci4], seed: 3 })]);
      const combined = await invoke([root, '--microcode', 'GBI2', '--texture', 'CI4']);
      expect(combined.code).toBe(1);
      expect(combined.output.summary).toEqual({ matched: 0, notObserved: 3, unknown: 0, errors: 0 });
      const texture = await invoke([root, '--texture', 'CI4']);
      expect(texture.code).toBe(0);
      expect(texture.output.matches.map(match => match.settings.seed)).toEqual([2, 3]);
    });
  });

  test('distinguishes absent observations from missing collectors and still accepts positive task-start evidence', async () => {
    await withDirectory(async root => {
      const legacy = makeReport('1', { family: 'GBI1' });
      const positive = makeReport('2');
      delete legacy.collectors['graphics.microcodeLoads'];
      delete positive.collectors['graphics.microcodeLoads'];
      const negative = makeReport('3', { family: 'GBI1' });
      const { directory, manifest } = await writeScan(root, 'scan', [legacy, positive, negative]);
      manifest.entries.push({ path: '/roms/pending.z64', sha256: null, report: null, status: 'pending' });
      manifest.entries.push({ path: '/roms/missing.z64', sha256: '4'.repeat(64), report: `${'4'.repeat(64)}.json`, status: 'pending' });
      await Bun.write(join(directory, 'manifest.json'), JSON.stringify(manifest));
      const result = await invoke([root, '--microcode', 'GBI2']);
      expect(result.code).toBe(0);
      expect(result.output.summary).toEqual({ matched: 1, notObserved: 1, unknown: 3, errors: 0 });
      expect(result.output.matches[0].rom).toEqual(positive.rom);
      expect(result.output.unknown[0].checks.microcode.collectors[1]).toMatchObject({ state: 'unknown', reason: 'missing-collector' });
      expect(result.output.unknown.slice(1).every(row => row.checks.microcode.reason === 'missing-report')).toBe(true);

      positive.collectors['graphics.taskMicrocodes'].microcodes = [{ family: 'GBI0', detection: 'fallback', tasks: 1 }];
      await Bun.write(join(directory, `${positive.rom.sha256}.json`), JSON.stringify(positive));
      const fallback = await invoke([root, '--microcode', 'GBI0']);
      expect(fallback.output.matches[0].checks.microcode.collectors[0].matches[0].detection).toBe('fallback');
    });
  });

  test('does not interpret unsupported report versions, collector versions, scopes, or malformed records', async () => {
    await withDirectory(async root => {
      const path = join(root, 'report.json');
      for (const [change, reason] of [
        [{ version: 2 }, 'unsupported-version'],
        [{ scope: 'configured-tile' }, 'unsupported-scope'],
        [{ formats: 'invalid' }, 'invalid-records'],
      ]) {
        const report = makeReport('1', { formats: [ci4] });
        Object.assign(report.collectors['graphics.textureFormats'], change);
        await Bun.write(path, JSON.stringify(report));
        const result = await invoke([path, '--texture', 'CI4']);
        expect(result.code).toBe(1);
        expect(result.output.summary).toEqual({ matched: 0, notObserved: 0, unknown: 1, errors: 0 });
        expect(result.output.unknown[0].checks.texture.collectors[0]).toMatchObject({ state: 'unknown', reason });
      }
      await Bun.write(path, JSON.stringify({ ...makeReport('1'), schemaVersion: 2 }));
      const future = await invoke([path, '--microcode', 'GBI2']);
      expect(future.code).toBe(1);
      expect(future.output.unknown[0].checks.microcode).toMatchObject({ reason: 'unsupported-report-version', reportVersion: 2 });
    });
  });

  test('reports malformed data and mismatched provenance while continuing to query other reports', async () => {
    await withDirectory(async root => {
      const reports = [makeReport('1', { formats: [ci4] }), makeReport('2'), makeReport('3')];
      const { directory } = await writeScan(root, 'valid-manifest', reports);
      await Bun.write(join(directory, `${reports[1].rom.sha256}.json`), '{broken');
      reports[2].settings.seed = 99;
      await Bun.write(join(directory, `${reports[2].rom.sha256}.json`), JSON.stringify(reports[2]));
      const unsafe = await writeScan(root, 'invalid-manifest', [makeReport('4')]);
      unsafe.manifest.entries[0].report = '../outside.json';
      await Bun.write(join(unsafe.directory, 'manifest.json'), JSON.stringify(unsafe.manifest));
      const result = await invoke([root, '--texture', 'CI4']);
      expect(result.code).toBe(2);
      expect(result.output.matches.map(row => row.rom.sha256)).toEqual([reports[0].rom.sha256]);
      expect(result.output.errors).toHaveLength(3);
      expect(result.output.errors.some(error => error.message === 'Report does not match its scan manifest')).toBe(true);
      expect(result.output.errors.some(error => error.message === 'Invalid ROM entry in scan manifest')).toBe(true);
      await Bun.write(join(root, 'null.json'), 'null');
      expect((await invoke([join(root, 'null.json'), '--texture', 'CI4'])).code).toBe(2);
    });
  });

  test('rejects missing or invalid filters', async () => {
    for (const filters of [[], ['--texture', 'RGBBAD'], ['--microcode', ' '], ['--unknown']]) {
      const result = await invoke(['/unused/inventory', ...filters]);
      expect(result.code).toBe(2);
      expect(result.stdout).toBe('');
    }
  });
});

describe('inventory summary', () => {
  test('counts distinct ROMs separately from runs and preserves empty, partial and aliased observations', async () => {
    await withDirectory(async root => {
      const active = makeReport('1', { formats: [ci4] });
      const empty = makeReport('2', { loaded: [] });
      empty.collectors['graphics.taskMicrocodes'] = { version: 1, scope: 'task-start', tasks: 0, microcodes: [] };
      const partial = makeReport('3', { formats: [rgba16] });
      partial.result = { ...partial.result, status: 'timeout', frames: 120, checkpointOnly: true };
      const { directory, manifest } = await writeScan(root, 'seed-1', [active, empty, partial]);
      manifest.entries.push({ ...manifest.entries[0], path: '/roms/alias.v64' });
      manifest.entries[0].status = 'pending'; // Published report is newer than the manifest status.
      await Bun.write(join(directory, 'manifest.json'), JSON.stringify(manifest));
      const otherSeed = makeReport('1', { seed: 2 });
      otherSeed.settings.inputPolicy = { name: 'scripted-prefix', version: 1, script: { version: 1, steps: [{ frames: 120 }] } };
      await writeScan(root, 'seed-2', [otherSeed]);

      const result = await invoke([root], summaryCLI);
      expect(result.code).toBe(0);
      expect(result.output.summary).toEqual({
        runs: 4, roms: 3, unidentifiedRuns: 0, statuses: { completed: 3, timeout: 1 }, errors: 0,
        collectors: {
          'graphics.taskMicrocodes': { observed: 3, notObserved: 1, unknown: 0 },
          'graphics.microcodeLoads': { observed: 3, notObserved: 1, unknown: 0 },
          'graphics.textureFormats': { observed: 2, notObserved: 2, unknown: 0 },
        },
      });
      expect(result.output.runs[0]).toMatchObject({
        rom: active.rom, paths: ['/roms/ROM 1.z64', '/roms/alias.v64'], reportVersion: 1,
        settings: active.settings, emulator: active.emulator, result: active.result,
      });
      expect(result.output.runs[1].collectors['graphics.taskMicrocodes']).toMatchObject({ state: 'not-observed', records: [] });
      expect(result.output.runs[2]).toMatchObject({ result: partial.result, collectors: {
        'graphics.textureFormats': { state: 'observed', records: [rgba16] },
      } });
      expect(result.output.runs[3].settings).toEqual(otherSeed.settings);
      expect((await invoke([directory], summaryCLI)).output.runs).toEqual(result.output.runs.slice(0, 3));
      const standalone = await invoke([result.output.runs[0].reportPath], summaryCLI);
      expect(standalone.output.runs[0]).toMatchObject({ rom: active.rom, paths: [], scan: null, result: active.result });
    });
  });

  test('keeps unknown data distinct from empty observations and continues past invalid saved data', async () => {
    await withDirectory(async root => {
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

      const result = await invoke([root], summaryCLI);
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
      expect(Object.values(result.output.runs[1].collectors).map(item => item.reason)).toEqual(['unsupported-version', 'unsupported-scope', 'invalid-records']);
      expect(result.output.runs[2]).toMatchObject({ reportVersion: 2, result: null, rom: { sha256: future.rom.sha256, name: null } });
      expect(result.output.runs[2].collectors['graphics.taskMicrocodes'].reason).toBe('unsupported-report-version');
      expect(result.output.runs.slice(3).every(row => row.collectors['graphics.taskMicrocodes'].reason === 'missing-report')).toBe(true);
      expect(result.output.errors).toHaveLength(3);
      expect((await invoke([join(directory, `${future.rom.sha256}.json`)], summaryCLI)).code).toBe(0);
    });
  });

  test('summarizes empty inventories and failed ROM runs successfully while rejecting invalid arguments', async () => {
    await withDirectory(async root => {
      await mkdir(join(root, 'runs'));
      const empty = await invoke([root], summaryCLI);
      expect(empty.code).toBe(0);
      expect(empty.output.summary).toMatchObject({ runs: 0, roms: 0, unidentifiedRuns: 0, statuses: {}, errors: 0 });
      const failed = makeReport('1');
      failed.rom = null;
      failed.result = { status: 'error', frames: 0, cycles: 0, checkpointOnly: true, message: 'ROM could not be loaded' };
      failed.collectors = {};
      const path = join(root, 'failed.json');
      await Bun.write(path, JSON.stringify(failed));
      const result = await invoke([path], summaryCLI);
      expect(result.code).toBe(0);
      expect(result.output.summary).toMatchObject({ runs: 1, roms: 0, unidentifiedRuns: 1, statuses: { error: 1 }, errors: 0 });
      expect(result.output.runs[0].result).toEqual(failed.result);
    });
    for (const args of [[], ['/one', '/two'], ['--unknown']]) {
      const invalid = await invoke(args, summaryCLI);
      expect(invalid.code).toBe(2);
      expect(invalid.stdout).toBe('');
    }
  });
});
