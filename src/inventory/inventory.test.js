import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { link, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseInputScript } from './inventory_input.js';
import { CycleType, ImageFormat, ImageSize } from '../hle/graphics/gbi.js';
import { invokeCLI, makeROM, swapRomBytes16, swapRomBytes32, withDirectory } from './test_helpers.js';

const cli = fileURLToPath(new URL('./inventory.js', import.meta.url));
const queryCLI = fileURLToPath(new URL('./inventory_query.js', import.meta.url));

describe('inventory command', () => {
  test('prints usage with --help and validates CLI positional and output options', async () => {
    const help = await invokeCLI(cli, ['--help']);
    expect(help.code).toBe(0);
    expect(help.stderr).toBe('');
    expect(help.stdout).toContain('Usage: bun run inventory');

    await withDirectory('n64js-inventory-', async directory => {
      for (const args of [[], ['a.z64', 'b.z64']]) {
        const missing = await invokeCLI(cli, args, { cwd: directory });
        expect(missing.code).toBe(2);
        expect(missing.stderr).toContain('Expected one ROM path');
        expect(missing.stdout).toBe('');
      }

      const emptyOut = await invokeCLI(cli, ['test.z64', '--output', ''], { cwd: directory });
      expect(emptyOut.code).toBe(2);
      expect(emptyOut.stderr).toContain('Output path must not be empty');
      expect(emptyOut.stdout).toBe('');

      await Bun.write(join(directory, 'test.z64'), makeROM({ vi: true }));
      const stdoutExplicit = await invokeCLI(cli, ['test.z64', '--frames', '1', '--output', '-'], { cwd: directory });
      expect(stdoutExplicit.code).toBe(0);
      expect(JSON.parse(stdoutExplicit.stdout).result.status).toBe('completed');
    });
  });

  test('collects and aggregates unknown audio microcode through the real worker and report query', async () => {
    await withDirectory('n64js-inventory-', async directory => {
      await Bun.write(join(directory, 'audio.z64'), makeROM({ vi: true, audio: true }));
      const result = await invokeCLI(cli, ['audio.z64', '--frames', '1', '--output', 'report.json'], { cwd: directory });
      expect(result.code).toBe(0);
      const report = JSON.parse(await readFile(join(directory, 'report.json'), 'utf8'));
      expect(report.collectors['audio.taskMicrocodes']).toEqual({
        version: 1, scope: 'task-start', tasks: 2,
        microcodes: [{ family: 'Unknown', detection: 'unknown', tasks: 2 }],
      });
      expect(report.collectors['graphics.taskMicrocodes'].tasks).toBe(0);
      const query = await invokeCLI(queryCLI, ['report.json', '--audio-microcode', 'unknown'], { cwd: directory });
      expect(query.code).toBe(0);
      expect(JSON.parse(query.stdout).summary.matched).toBe(1);
    });
  });

  test('replays saved settings from boot across ROM byte orders and retains original provenance', async () => {
    await withDirectory('n64js-inventory-', async directory => {
      const rom = makeROM({ vi: true, waitForInput: true });
      await Bun.write(join(directory, 'test.z64'), rom);
      const script = { version: 1, steps: [{ frames: 2 }, { frames: 3, buttons: ['START'], stickX: 80, stickY: -48 }] };
      await Bun.write(join(directory, 'menu.json'), JSON.stringify(script));
      const first = await invokeCLI(cli, ['test.z64', '--seed', '123', '--frames', '5', '--max-cycles', '10000000', '--timeout-ms', '5000', '--input-script', 'menu.json'], { cwd: directory });
      expect(first.code).toBe(0);
      const expected = JSON.parse(first.stdout);
      const original = structuredClone(expected);
      original.emulator = { revision: 'a'.repeat(40), dirty: false, runtime: 'bun', runtimeVersion: 'old-runtime' };
      original.result = { ...original.result, status: 'timeout', frames: 2, checkpointOnly: true };
      const saved = JSON.stringify(original, null, 2) + '\n';
      await Bun.write(join(directory, 'original.json'), saved);
      await rm(join(directory, 'menu.json'));
      await rm(join(directory, 'test.z64'));
      await Bun.write(join(directory, 'moved.v64'), swapRomBytes16(rom));

      const result = await invokeCLI(cli, ['moved.v64', '--replay', 'original.json', '--output', 'replayed.json'], { cwd: directory });
      expect(result.code).toBe(0);
      expect(result.stdout).toBe('');
      const report = await Bun.file(join(directory, 'replayed.json')).json();
      expect(report).toMatchObject({ rom: expected.rom, settings: expected.settings, result: expected.result, collectors: expected.collectors });
      expect(report.emulator).toEqual(expected.emulator);
      expect(report.collectors['graphics.taskMicrocodes'].tasks).toBe(2);
      expect(report.replayOf).toEqual({
        reportSha256: createHash('sha256').update(saved).digest('hex'),
        romSha256: original.rom.sha256, emulator: original.emulator,
      });
      expect(await readFile(join(directory, 'original.json'), 'utf8')).toBe(saved);
      const query = await invokeCLI(queryCLI, ['replayed.json', '--microcode', 'GBI2'], { cwd: directory });
      expect(JSON.parse(query.stdout).matches[0].replayOf).toEqual(report.replayOf);
    });
  });

  test('rejects a different ROM before executing its code', async () => {
    await withDirectory('n64js-inventory-', async directory => {
      await Bun.write(join(directory, 'test.z64'), makeROM({ vi: true }));
      const first = await invokeCLI(cli, ['test.z64', '--frames', '1', '--output', 'original.json'], { cwd: directory });
      expect(first.code).toBe(0);
      const original = await Bun.file(join(directory, 'original.json')).json();
      const other = makeROM({ vi: true, graphics: 'textures' });
      await Bun.write(join(directory, 'other.z64'), other);
      const result = await invokeCLI(cli, ['other.z64', '--replay', 'original.json'], { cwd: directory });
      expect(result.code).toBe(2);
      const report = JSON.parse(result.stdout);
      expect(report.result).toMatchObject({ status: 'error', frames: 0, cycles: 0, message: 'ROM SHA-256 does not match the replay report' });
      expect(report.collectors).toEqual({});
      expect(report.rom.sha256).toBe(createHash('sha256').update(other).digest('hex'));
      expect(report.replayOf.romSha256).toBe(original.rom.sha256);
    });
  });

  test('rejects unsupported replay settings and conflicting overrides before running', async () => {
    await withDirectory('n64js-inventory-', async directory => {
      await Bun.write(join(directory, 'test.z64'), makeROM({ vi: true }));
      const first = await invokeCLI(cli, ['test.z64', '--frames', '1'], { cwd: directory });
      expect(first.code).toBe(0);
      const original = JSON.parse(first.stdout);
      for (const change of [
        report => { report.schemaVersion = 2; },
        report => { report.rom = null; },
        report => { report.settings.randomAlgorithm = 'unknown'; },
        report => { report.settings.inputPolicy.version = 2; },
        report => { report.settings.timeoutMs = 0; },
        report => { report.settings.newOption = true; },
      ]) {
        const report = structuredClone(original);
        change(report);
        await Bun.write(join(directory, 'original.json'), JSON.stringify(report));
        const result = await invokeCLI(cli, ['test.z64', '--replay', 'original.json'], { cwd: directory });
        expect(result.code).toBe(2);
        expect(result.stdout).toBe('');
      }
      await Bun.write(join(directory, 'original.json'), first.stdout);
      for (const option of ['--seed', '--frames', '--max-cycles', '--timeout-ms', '--input-script']) {
        const result = await invokeCLI(cli, ['test.z64', '--replay', 'original.json', option, '1'], { cwd: directory });
        expect(result.code).toBe(2);
        expect(result.stderr).toContain('--replay cannot be combined');
        expect(result.stdout).toBe('');
      }
      expect(await readFile(join(directory, 'original.json'), 'utf8')).toBe(first.stdout);
    });
  });

  test('protects replay reports and input ROMs from output paths that name or alias them', async () => {
    await withDirectory('n64js-inventory-', async directory => {
      const rom = makeROM({ vi: true });
      const romPath = join(directory, 'test.z64');
      await Bun.write(romPath, rom);
      const first = await invokeCLI(cli, ['test.z64', '--frames', '1', '--output', 'original.json'], { cwd: directory });
      expect(first.code).toBe(0);
      const originalPath = join(directory, 'original.json');
      const original = await readFile(originalPath, 'utf8');
      await symlink(originalPath, join(directory, 'symlink.json'));
      await link(originalPath, join(directory, 'hardlink.json'));
      for (const output of ['original.json', 'symlink.json', 'hardlink.json']) {
        const result = await invokeCLI(cli, ['test.z64', '--replay', 'original.json', '--output', output], { cwd: directory });
        expect(result.code).toBe(2);
        expect(result.stderr).toContain('must not overwrite the replay report');
        expect(result.stdout).toBe('');
        expect(await readFile(originalPath, 'utf8')).toBe(original);
      }

      await symlink(romPath, join(directory, 'rom-symlink.z64'));
      await link(romPath, join(directory, 'rom-hardlink.z64'));
      for (const output of ['test.z64', 'rom-symlink.z64', 'rom-hardlink.z64']) {
        const result = await invokeCLI(cli, ['test.z64', '--output', output], { cwd: directory });
        expect(result.code).toBe(2);
        expect(result.stderr).toContain('must not overwrite the ROM');
        expect(result.stdout).toBe('');
        expect(new Uint8Array(await readFile(romPath))).toEqual(rom);
      }
    });
  });

  test('uses scripted controller input to reach graphics and honors the total frame limit', async () => {
    await withDirectory('n64js-inventory-', async directory => {
      await Bun.write(join(directory, 'test.z64'), makeROM({ vi: true, waitForInput: true }));
      for (const [script, tasks] of [
        [{ version: 1, steps: [{ frames: 10 }] }, 0],
        [{ version: 1, steps: [{ frames: 2 }, { frames: 3, buttons: ['START'], stickX: 80, stickY: -48 }] }, 2],
      ]) {
        await Bun.write(join(directory, 'menu.json'), JSON.stringify(script));
        const result = await invokeCLI(cli, ['test.z64', '--frames', '5', '--input-script', 'menu.json'], { cwd: directory });
        expect(result.code).toBe(0);
        const report = JSON.parse(result.stdout);
        expect(report.result).toMatchObject({ status: 'completed', frames: 5 });
        expect(report.collectors['graphics.taskMicrocodes'].tasks).toBe(tasks);
        expect(report.settings.inputPolicy).toEqual({
          name: 'scripted-prefix', version: 1, script: parseInputScript(script),
          after: { name: 'random-controller', version: 1 },
        });
      }
    });
  });

  test('rejects missing, malformed and invalid scripts before running or creating scans', async () => {
    const batchCLI = fileURLToPath(new URL('./inventory_batch.js', import.meta.url));
    await withDirectory('n64js-inventory-', async directory => {
      await Bun.write(join(directory, 'malformed.json'), '{');
      await Bun.write(join(directory, 'invalid.json'), JSON.stringify({ version: 1, steps: [{ frames: 0 }] }));
      for (const path of ['missing.json', 'malformed.json', 'invalid.json']) {
        for (const command of [cli, batchCLI]) {
          const args = ['missing.z64', '--input-script', path];
          if (command === batchCLI) {
            args.push('--output-dir', 'inventory');
          }
          const result = await invokeCLI(command, args, { cwd: directory });
          expect(result.code).toBe(2);
          expect(result.stdout).toBe('');
        }
      }
      expect((await readdir(directory)).sort()).toEqual(['invalid.json', 'malformed.json']);
    });
  });

  test('produces replayable reports, aggregates task starts, and normalizes ROM byte order', async () => {
    await withDirectory('n64js-inventory-', async directory => {
      const rom = makeROM({ vi: true });
      await Bun.write(join(directory, 'test.z64'), rom);
      const options = ['--seed', '123', '--frames', '3', '--max-cycles', '10000000'];
      const first = await invokeCLI(cli, ['test.z64', ...options, '--output', 'report.json'], { cwd: directory });
      expect(first.code).toBe(0);
      expect(first.stdout).toBe('');
      const report = JSON.parse(await readFile(join(directory, 'report.json'), 'utf8'));
      const replay = await invokeCLI(cli, ['test.z64', ...options], { cwd: directory });
      expect(replay.code).toBe(0);
      expect(JSON.parse(replay.stdout)).toEqual(report);
      expect(report.rom).toMatchObject({ name: 'INVENTORY TEST', bytes: rom.length, sha256: createHash('sha256').update(rom).digest('hex') });
      expect(report.emulator).toMatchObject({ runtime: 'bun', runtimeVersion: Bun.version });
      expect(report.emulator.revision).toMatch(/^[0-9a-f]{40}$/);
      expect(report.result).toMatchObject({ status: 'completed', frames: 3, checkpointOnly: false });
      expect(report.collectors['graphics.taskMicrocodes']).toMatchObject({
        version: 1, scope: 'task-start', tasks: 2,
        microcodes: [{ family: 'GBI2', tasks: 2 }],
      });

      await Bun.write(join(directory, 'test.v64'), swapRomBytes16(rom));
      const v64 = await invokeCLI(cli, ['test.v64', ...options], { cwd: directory });
      expect(v64.code).toBe(0);
      expect(JSON.parse(v64.stdout)).toEqual(report);

      await Bun.write(join(directory, 'test.n64'), swapRomBytes32(rom));
      const n64 = await invokeCLI(cli, ['test.n64', ...options], { cwd: directory });
      expect(n64.code).toBe(0);
      expect(JSON.parse(n64.stdout)).toEqual(report);
    });
  });

  test('counts initial and in-list loads separately from task starts across repeated tasks', async () => {
    await withDirectory('n64js-inventory-', async directory => {
      await Bun.write(join(directory, 'switch.z64'), makeROM({ vi: true, graphics: 'switch' }));
      const result = await invokeCLI(cli, ['switch.z64', '--frames', '1'], { cwd: directory });
      expect(result.code).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report.collectors['graphics.taskMicrocodes']).toMatchObject({
        version: 1, scope: 'task-start', tasks: 2,
        microcodes: [{ family: 'GBI2', tasks: 2 }],
      });
      expect(report.collectors['graphics.microcodeLoads']).toMatchObject({
        version: 1, scope: 'hle-load', loads: 6,
        microcodes: [{ family: 'GBI2', loads: 4 }, { family: 'GBI1', loads: 2 }],
      });
    });
  });

  test('collects formats used by draws, including zero-stride tiles and excluding unused tiles', async () => {
    await withDirectory('n64js-inventory-', async directory => {
      await Bun.write(join(directory, 'textures.z64'), makeROM({ vi: true, graphics: 'textures' }));
      for (let run = 0; run < 2; run++) {
        const result = await invokeCLI(cli, ['textures.z64', '--frames', '1'], { cwd: directory });
        expect(result.code).toBe(0);
        expect(JSON.parse(result.stdout).collectors['graphics.drawModes']).toEqual({
          version: 1, scope: 'headless-draw', modes: [
            { otherModeH: CycleType.G_CYC_2CYCLE, otherModeL: 0, combineHi: 0, combineLo: 0, draws: 4 },
            { otherModeH: CycleType.G_CYC_1CYCLE, otherModeL: 0, combineHi: 0, combineLo: 0, draws: 2 },
          ],
        });
        expect(JSON.parse(result.stdout).collectors['graphics.textureFormats']).toEqual({
          version: 1,
          scope: 'hle-draw',
          formats: [
            { format: ImageFormat.G_IM_FMT_CI, size: ImageSize.G_IM_SIZ_4b, name: 'CI4' },
            { format: ImageFormat.G_IM_FMT_RGBA, size: ImageSize.G_IM_SIZ_16b, name: 'RGBA16' },
            { format: ImageFormat.G_IM_FMT_IA, size: ImageSize.G_IM_SIZ_8b, name: 'IA8' },
          ],
        });
      }
    });
  });

  test('enforces the cycle limit through guest COUNT writes and skipped idle loops', async () => {
    await withDirectory('n64js-inventory-', async directory => {
      for (const options of [{ rewriteCount: true }, { vi: true }]) {
        await Bun.write(join(directory, 'test.z64'), makeROM(options));
        const result = await invokeCLI(cli, ['test.z64', '--max-cycles', '10000'], { cwd: directory });
        expect(result.code).toBe(3);
        const report = JSON.parse(result.stdout);
        expect(report.result).toMatchObject({ status: 'cycle-limit', frames: 0, cycles: 10000, checkpointOnly: false });
        expect(report.collectors['graphics.taskMicrocodes'].tasks).toBe(2);
      }
    });
  });

  test('enforces the emulated cycle budget while HLE waits for a CPU patch', async () => {
    await withDirectory('n64js-inventory-', async directory => {
      await Bun.write(join(directory, 'test.z64'), makeROM({ graphics: 'wait' }));
      const result = await invokeCLI(cli, ['test.z64', '--max-cycles', '10000'], { cwd: directory });
      expect(result.code).toBe(3);
      expect(JSON.parse(result.stdout).result).toMatchObject({
        status: 'cycle-limit', cycles: 10000, checkpointOnly: false,
      });
    });
  });

  test('reports a runaway display list with terminal exception evidence', async () => {
    await withDirectory('n64js-inventory-', async directory => {
      await Bun.write(join(directory, 'test.z64'), makeROM({ graphics: 'loop' }));
      const result = await invokeCLI(cli, ['test.z64', '--timeout-ms', '2000'], { cwd: directory });
      expect(result.code).toBe(2);
      const report = JSON.parse(result.stdout);
      expect(report.result).toMatchObject({ status: 'halted', checkpointOnly: false });
      expect(report.result.failure.exception.name).toBe('DisplayListLimitError');
      expect(report.result.failure.exception.message).toContain('0x00003000; stack depth 0');
      expect(report.result.failure.exception.stack).toContain('display_list.js');
      expect(report.collectors['graphics.taskMicrocodes'].tasks).toBe(1);
    });
  });

  test('terminates an unpatched producer wait and writes the last checkpoint', async () => {
    await withDirectory('n64js-inventory-', async directory => {
      await Bun.write(join(directory, 'test.z64'), makeROM({ graphics: 'wait' }));
      const result = await invokeCLI(cli, ['test.z64', '--max-cycles', '5000000000000', '--timeout-ms', '2000'], { cwd: directory });
      expect(result.code).toBe(124);
      const report = JSON.parse(result.stdout);
      expect(report.rom.name).toBe('INVENTORY TEST');
      expect(report.result).toMatchObject({ status: 'timeout', checkpointOnly: true });
      expect(report.collectors['graphics.taskMicrocodes'].version).toBe(1);
    });
  });

  test('distinguishes unrun collectors, empty observations, and a halt during collection', async () => {
    await withDirectory('n64js-inventory-', async directory => {
      const missing = await invokeCLI(cli, ['missing.z64'], { cwd: directory });
      expect(missing.code).toBe(2);
      expect(JSON.parse(missing.stdout)).toMatchObject({ rom: null, collectors: {}, result: { status: 'error' } });
      const startupFailure = JSON.parse(missing.stdout).result.failure;
      expect(startupFailure).toMatchObject({ version: 1, kind: 'exception', exception: { name: 'Error', message: 'ROM not found: ' + join(directory, 'missing.z64') } });
      expect(startupFailure.exception.stack).toContain('loadROMFile');
      expect(startupFailure.context).toBeUndefined();
      await Bun.write(join(directory, 'test.z64'), makeROM({ graphics: 'none', vi: true }));
      const empty = await invokeCLI(cli, ['test.z64', '--frames', '1'], { cwd: directory });
      expect(empty.code).toBe(0);
      expect(JSON.parse(empty.stdout).result.failure).toBeUndefined();
      expect(JSON.parse(empty.stdout).collectors['audio.taskMicrocodes']).toEqual({ version: 1, scope: 'task-start', tasks: 0, microcodes: [] });
      expect(JSON.parse(empty.stdout).collectors['graphics.taskMicrocodes']).toMatchObject({ version: 1, tasks: 0, microcodes: [] });
      expect(JSON.parse(empty.stdout).collectors['graphics.microcodeLoads']).toMatchObject({ version: 1, loads: 0, microcodes: [] });
      expect(JSON.parse(empty.stdout).collectors['graphics.textureFormats']).toEqual({ version: 1, scope: 'hle-draw', formats: [] });
      await Bun.write(join(directory, 'test.z64'), makeROM({ graphics: 'invalid' }));
      const halted = await invokeCLI(cli, ['test.z64'], { cwd: directory });
      expect(halted.code).toBe(2);
      const report = JSON.parse(halted.stdout);
      expect(report.result).toMatchObject({ status: 'halted', checkpointOnly: false });
      expect(report.result.message).toBeTruthy();
      expect(report.result.failure).toMatchObject({
        version: 1, kind: 'exception', exception: { name: 'RangeError' },
      });
      expect(typeof report.result.failure.exception.message).toBe('string');
      const { cpu, rsp } = report.result.failure.context;
      for (const pc of [cpu.pc, cpu.nextPC, cpu.delayPC, rsp.pc]) {
        expect(Number.isInteger(pc)).toBe(true);
      }
      expect(typeof rsp.halted).toBe('boolean');
      // An actual invalid display-list read must retain its original stack
      // across CPU halt handling and worker IPC, not a stack from serialization.
      expect(report.result.failure.exception.stack).toContain('nextCommand');
      expect(report.result.failure.exception.stack).toContain('rsp_state.js');
      await Bun.write(join(directory, 'failure.json'), JSON.stringify(report));
      const queried = await invokeCLI(queryCLI, ['failure.json', '--microcode', 'GBI2'], { cwd: directory });
      expect(queried.code).toBe(0);
      expect(JSON.parse(queried.stdout).matches[0].result.failure).toEqual(report.result.failure);
      expect(report.collectors['graphics.taskMicrocodes'].tasks).toBe(1);
      expect(report.collectors['graphics.microcodeLoads'].loads).toBe(1);
      expect(report.collectors['graphics.textureFormats'].formats).toEqual([]);
    });
  });

  test('rejects invalid limits and refuses to overwrite the input ROM', async () => {
    await withDirectory('n64js-inventory-', async directory => {
      for (const options of [
        ['--seed', '4294967296'], ['--frames', '0'], ['--max-cycles', 'NaN'], ['--timeout-ms', '2147483648'], ['--unknown'],
      ]) {
        const invalid = await invokeCLI(cli, ['test.z64', ...options], { cwd: directory });
        expect(invalid.code).toBe(2);
        expect(invalid.stdout).toBe('');
      }
      const rom = makeROM();
      await Bun.write(join(directory, 'test.z64'), rom);
      const overwrite = await invokeCLI(cli, ['test.z64', '--output', './test.z64'], { cwd: directory });
      expect(overwrite.code).toBe(2);
      expect(new Uint8Array(await readFile(join(directory, 'test.z64')))).toEqual(rom);
    });
  });
});
