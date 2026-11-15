import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ImageFormat, ImageSize } from '../hle/graphics/gbi.js';
import { parseFilters } from './inventory_query.js';
import { ci4, invokeCLI, makeReport, rgba16, withDirectory, writeScan } from './test_helpers.js';

const cli = fileURLToPath(new URL('./inventory_query.js', import.meta.url));

async function invokeQuery(args) {
  const result = await invokeCLI(cli, args);
  return { ...result, output: result.stdout ? JSON.parse(result.stdout) : null };
}

describe('inventory query', () => {
  test('prints usage with --help', async () => {
    const help = await invokeCLI(cli, ['--help']);
    expect(help.code).toBe(0);
    expect(help.stderr).toBe('');
    expect(help.stdout).toContain('Usage: bun run inventory-query');
  });

  test('queries blender and cycle state together, preserving legacy and invalid data as unknown', async () => {
    await withDirectory('n64js-inventory-query-', async root => {
      const mode = (blend, cycle) => ({ otherModeH: cycle << 20, otherModeL: blend * 65536 + 0x2078, combineHi: 0, combineLo: 0, draws: 2 });
      const reports = Array.from({ length: 6 }, (_, i) => makeReport(String(i + 1)));
      const records = [[mode(0xc811, 1)], [mode(0xc811, 0), mode(0, 1)], [], null, [{ ...mode(0xc811, 1), otherModeL: -1 }], [{ ...mode(0xc811, 1), draws: 0 }]];
      records.forEach((modes, i) => {
        if (modes) {
          reports[i].collectors['graphics.drawModes'] = { version: 1, scope: 'headless-draw', modes };
        }
      });
      await writeScan(root, 'modes', reports);
      const result = await invokeQuery([root, '--blend-mode', '0xC811', '--cycle-type', '2cycle']);
      expect(result.code).toBe(0);
      expect(result.output.summary).toEqual({ matched: 1, notObserved: 2, unknown: 3, errors: 0 });
      expect(result.output.matches[0].checks.graphicsMode.collectors[0].matches).toEqual(records[0]);
      const decimal = await invokeQuery([root, '--blend-mode', '51217']);
      expect(decimal.output.matches).toHaveLength(2);
    });
  });

  test('queries audio independently, retaining legacy absence, empty runs and unidentified observations', async () => {
    await withDirectory('n64js-inventory-query-', async root => {
      const reports = Array.from({ length: 4 }, (_, i) => makeReport(String(i + 1), { family: i === 2 ? 'GBI1' : 'GBI2' }));
      reports[0].collectors['audio.taskMicrocodes'] = { version: 1, scope: 'task-start', tasks: 2, microcodes: [{ family: 'Unknown', detection: 'unknown', tasks: 2 }] };
      reports[1].collectors['audio.taskMicrocodes'] = { version: 1, scope: 'task-start', tasks: 0, microcodes: [] };
      reports[2].collectors['audio.taskMicrocodes'] = { version: 1, scope: 'task-start', tasks: 1, microcodes: [{ family: 'Unknown', detection: 'unknown', tasks: 1 }] };
      await writeScan(root, 'audio', reports);
      const result = await invokeQuery([root, '--audio-microcode', 'unknown', '--microcode', 'gbi2']);
      expect(result.code).toBe(0);
      expect(result.output.summary).toEqual({ matched: 1, notObserved: 2, unknown: 1, errors: 0 });
      expect(result.output.matches[0].checks.audioMicrocode.collectors[0].matches).toEqual([{ family: 'Unknown', detection: 'unknown', tasks: 2 }]);
      const unknown = await invokeQuery([root, '--audio-microcode', 'Unknown']);
      expect(unknown.output.matches.map(x => x.rom.name)).toEqual(['ROM 1', 'ROM 3']);
      expect(unknown.output.unknown.map(x => x.rom.name)).toEqual(['ROM 4']);
    });
  });

  test('matches in-list switches and numeric texture formats while retaining partial-run evidence and ROM aliases', async () => {
    await withDirectory('n64js-inventory-query-', async root => {
      const switched = makeReport('1', { family: 'GBI1', loaded: ['GBI1', 'GBI2'], formats: [{ ...ci4, name: 'legacy label' }] });
      switched.result = { ...switched.result, status: 'timeout', checkpointOnly: true, message: 'Wall-clock limit reached' };
      const misleadingLabel = makeReport('2', { formats: [{ ...rgba16, name: 'CI4' }] });
      const otherFamily = makeReport('3', { family: 'GBI1', formats: [ci4] });
      const { directory, manifest } = await writeScan(root, 'scan', [switched, misleadingLabel, otherFamily]);
      manifest.entries.push({ ...manifest.entries[0], path: '/roms/alternate.v64' });
      // A report can be published before its manifest status is updated.
      manifest.entries[0].status = 'pending';
      await Bun.write(join(directory, 'manifest.json'), JSON.stringify(manifest));
      const result = await invokeQuery([root, '--microcode', 'gbi2', '--texture', 'ci4']);
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
      expect((await invokeQuery([directory, '--microcode', 'GBI2', '--texture', 'CI4'])).output).toEqual(result.output);

      const single = await invokeQuery([match.reportPath, '--texture', 'CI4']);
      expect(single.code).toBe(0);
      expect(single.output.matches[0]).toMatchObject({ rom: switched.rom, paths: [], scan: null, result: switched.result });
    });
  });

  test('keeps seeds separate and does not assemble a combined match from different runs', async () => {
    await withDirectory('n64js-inventory-query-', async root => {
      await writeScan(root, 'seed-1', [makeReport('1', { formats: [rgba16], seed: 1 })]);
      await writeScan(root, 'seed-2', [makeReport('1', { family: 'GBI1', formats: [ci4], seed: 2 })]);
      await writeScan(root, 'seed-3', [makeReport('1', { family: 'GBI1', formats: [ci4], seed: 3 })]);
      const combined = await invokeQuery([root, '--microcode', 'GBI2', '--texture', 'CI4']);
      expect(combined.code).toBe(1);
      expect(combined.output.summary).toEqual({ matched: 0, notObserved: 3, unknown: 0, errors: 0 });
      const texture = await invokeQuery([root, '--texture', 'CI4']);
      expect(texture.code).toBe(0);
      expect(texture.output.matches.map(match => match.settings.seed)).toEqual([2, 3]);
    });
  });

  test('distinguishes absent observations from missing collectors and still accepts positive task-start evidence', async () => {
    await withDirectory('n64js-inventory-query-', async root => {
      const legacy = makeReport('1', { family: 'GBI1' });
      const positive = makeReport('2');
      delete legacy.collectors['graphics.microcodeLoads'];
      delete positive.collectors['graphics.microcodeLoads'];
      const negative = makeReport('3', { family: 'GBI1' });
      const { directory, manifest } = await writeScan(root, 'scan', [legacy, positive, negative]);
      manifest.entries.push({ path: '/roms/pending.z64', sha256: null, report: null, status: 'pending' });
      manifest.entries.push({ path: '/roms/missing.z64', sha256: '4'.repeat(64), report: `${'4'.repeat(64)}.json`, status: 'pending' });
      await Bun.write(join(directory, 'manifest.json'), JSON.stringify(manifest));
      const result = await invokeQuery([root, '--microcode', 'GBI2']);
      expect(result.code).toBe(0);
      expect(result.output.summary).toEqual({ matched: 1, notObserved: 1, unknown: 3, errors: 0 });
      expect(result.output.matches[0].rom).toEqual(positive.rom);
      expect(result.output.unknown[0].checks.microcode.collectors[1]).toMatchObject({ state: 'unknown', reason: 'missing-collector' });
      expect(result.output.unknown.slice(1).every(row => row.checks.microcode.reason === 'missing-report')).toBe(true);

      positive.collectors['graphics.taskMicrocodes'].microcodes = [{ family: 'GBI0', detection: 'fallback', tasks: 1 }];
      await Bun.write(join(directory, `${positive.rom.sha256}.json`), JSON.stringify(positive));
      const fallback = await invokeQuery([root, '--microcode', 'GBI0']);
      expect(fallback.output.matches[0].checks.microcode.collectors[0].matches[0].detection).toBe('fallback');
    });
  });

  test('does not interpret unsupported report versions, collector versions, scopes, or malformed records', async () => {
    await withDirectory('n64js-inventory-query-', async root => {
      const path = join(root, 'report.json');
      for (const [change, reason] of [
        [{ version: 2 }, 'unsupported-version'],
        [{ scope: 'configured-tile' }, 'unsupported-scope'],
        [{ formats: 'invalid' }, 'invalid-records'],
      ]) {
        const report = makeReport('1', { formats: [ci4] });
        Object.assign(report.collectors['graphics.textureFormats'], change);
        await Bun.write(path, JSON.stringify(report));
        const result = await invokeQuery([path, '--texture', 'CI4']);
        expect(result.code).toBe(1);
        expect(result.output.summary).toEqual({ matched: 0, notObserved: 0, unknown: 1, errors: 0 });
        expect(result.output.unknown[0].checks.texture.collectors[0]).toMatchObject({ state: 'unknown', reason });
      }
      await Bun.write(path, JSON.stringify({ ...makeReport('1'), schemaVersion: 2 }));
      const future = await invokeQuery([path, '--microcode', 'GBI2']);
      expect(future.code).toBe(1);
      expect(future.output.unknown[0].checks.microcode).toMatchObject({ reason: 'unsupported-report-version', reportVersion: 2 });
    });
  });

  test('reports malformed data, mismatched provenance, and nonexistent input while continuing to query other reports', async () => {
    await withDirectory('n64js-inventory-query-', async root => {
      const missing = await invokeQuery([join(root, 'missing-inventory'), '--microcode', 'GBI2']);
      expect(missing.code).toBe(2);
      expect(missing.output.summary).toEqual({ matched: 0, notObserved: 0, unknown: 0, errors: 1 });
      expect(missing.output.errors).toHaveLength(1);

      const reports = [makeReport('1', { formats: [ci4] }), makeReport('2'), makeReport('3')];
      const { directory } = await writeScan(root, 'valid-manifest', reports);
      await Bun.write(join(directory, `${reports[1].rom.sha256}.json`), '{broken');
      reports[2].settings.seed = 99;
      await Bun.write(join(directory, `${reports[2].rom.sha256}.json`), JSON.stringify(reports[2]));
      const unsafe = await writeScan(root, 'invalid-manifest', [makeReport('4')]);
      unsafe.manifest.entries[0].report = '../outside.json';
      await Bun.write(join(unsafe.directory, 'manifest.json'), JSON.stringify(unsafe.manifest));
      const result = await invokeQuery([root, '--texture', 'CI4']);
      expect(result.code).toBe(2);
      expect(result.output.matches.map(row => row.rom.sha256)).toEqual([reports[0].rom.sha256]);
      expect(result.output.errors).toHaveLength(3);
      expect(result.output.errors.some(error => error.message === 'Report does not match its scan manifest')).toBe(true);
      expect(result.output.errors.some(error => error.message === 'Invalid ROM entry in scan manifest')).toBe(true);
      await Bun.write(join(root, 'null.json'), 'null');
      expect((await invokeQuery([join(root, 'null.json'), '--texture', 'CI4'])).code).toBe(2);
    });
  });

  test('rejects missing or invalid filters and positional arguments', async () => {
    for (const args of [
      ['/unused/inventory'],
      ['/one', '/two', '--microcode', 'GBI2'],
      ['--microcode', 'GBI2'],
      ['/unused/inventory', '--texture', 'RGBBAD'],
      ['/unused/inventory', '--microcode', ' '],
      ['/unused/inventory', '--audio-microcode', ' '],
      ['/unused/inventory', '--unknown'],
      ['/unused/inventory', '--blend-mode', '-1'],
      ['/unused/inventory', '--blend-mode', '0x10000'],
      ['/unused/inventory', '--blend-mode', '1.5'],
      ['/unused/inventory', '--blend-mode', ''],
      ['/unused/inventory', '--blend-mode', 'abcd'],
      ['/unused/inventory', '--cycle-type', '3cycle'],
    ]) {
      const result = await invokeQuery(args);
      expect(result.code).toBe(2);
      expect(result.stdout).toBe('');
    }
  });

  test('parseFilters normalizes blend modes, cycle types, microcodes, and textures directly', () => {
    expect(parseFilters({
      'blend-mode': ' 0xC811 ',
      'cycle-type': ' 2CYCLE ',
      microcode: ' gbi2 ',
      'audio-microcode': ' abi1 ',
      texture: ' ci4 ',
    })).toEqual({
      graphicsMode: { blendMode: 0xc811, cycleType: 1 },
      microcode: 'GBI2',
      audioMicrocode: 'ABI1',
      texture: { name: 'CI4', format: ImageFormat.G_IM_FMT_CI, size: ImageSize.G_IM_SIZ_4b },
    });

    for (const [cycleType, expected] of [['1cycle', 0], ['2cycle', 1], ['copy', 2], ['fill', 3]]) {
      expect(parseFilters({ 'cycle-type': cycleType })).toEqual({ graphicsMode: { cycleType: expected } });
    }
    expect(parseFilters({ 'blend-mode': '51217' })).toEqual({ graphicsMode: { blendMode: 51217 } });

    expect(() => parseFilters({})).toThrow('Specify --microcode, --audio-microcode, --texture, --blend-mode or --cycle-type');
    for (const badBlend of ['-1', '0x10000', '1.5', '', 'abcd']) {
      expect(() => parseFilters({ 'blend-mode': badBlend })).toThrow('Expected a 16-bit blend mode');
    }
    expect(() => parseFilters({ 'cycle-type': '3cycle' })).toThrow('Expected cycle type 1cycle, 2cycle, copy, or fill');
    expect(() => parseFilters({ microcode: '   ' })).toThrow('Expected a microcode family');
    expect(() => parseFilters({ 'audio-microcode': '   ' })).toThrow('Expected an audio microcode family');
    expect(() => parseFilters({ texture: 'RGBBAD' })).toThrow('Expected a texture format such as CI4 or RGBA16');
  });
});
