import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInputDriver, createRandom } from './inventory_input.js';
import { CycleType, ImageFormat, ImageSize } from '../hle/gbi.js';

const cli = fileURLToPath(new URL('./inventory.js', import.meta.url));
const batchCLI = fileURLToPath(new URL('./inventory_batch.js', import.meta.url));

async function invoke(directory, args, command = cli) {
  const child = Bun.spawn([process.execPath, command, ...args], { cwd: directory, stdout: 'pipe', stderr: 'pipe' });
  const [code, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

async function withDirectory(fn) {
  const directory = await mkdtemp(join(tmpdir(), 'n64js-inventory-'));
  try {
    await fn(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

// A synthetic bootstrap starts real HLE tasks, then spins with optional VI
// interrupts. No copyrighted ROM or emulator mocks are needed by the CLI tests.
function makeROM({ vi = false, graphics = 'end', rewriteCount = false } = {}) {
  const bytes = new Uint8Array(0x1000);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x80371240);
  bytes.set(new TextEncoder().encode('INVENTORY TEST'), 32);
  bytes[62] = 0x45;
  const code = [0x40806000]; // mtc0 zero, Status: disable guest interrupts.
  const store = (offset, value) => {
    code.push(0x3c090000 | (value >>> 16), 0x35290000 | (value & 0xffff), 0xad090000 | offset);
  };
  code.push(0x3c08a000); // t0 = uncached RDRAM base.
  const writeVersion = (address, text) => {
    const version = new TextEncoder().encode(text + '\0');
    const padded = new Uint8Array((version.length + 3) & ~3);
    padded.set(version);
    const words = new DataView(padded.buffer);
    for (let offset = 0; offset < padded.length; offset += 4) {
      store(address + offset, words.getUint32(offset));
    }
    return version.length;
  };
  const versionSize = writeVersion(0x2000, 'RSP Gfx ucode F3DEX fifo 2.0');
  let commands = [[graphics === 'loop' ? 0xde010000 : 0xdf000000, graphics === 'loop' ? 0x3000 : 0]];
  if (graphics === 'switch') {
    const gbi1Size = writeVersion(0x5000, 'RSP Gfx ucode F3DEX 1.23');
    commands = [
      [0xe1000000, 0x80005000],
      [0xdd000000 | (gbi1Size - 1), 0x80004000], // GBI2 -> GBI1.
      [0xb4000000, 0x80002000],
      [0xaf000000 | (versionSize - 1), 0x80001000], // GBI1 -> GBI2.
      [0xdf000000, 0],
    ];
  }
  if (graphics === 'textures') {
    const tile = (index, format, size, line = 1) => [0xf5000000 | (format << 21) | (size << 19) | (line << 9), index << 24];
    commands = [
      tile(0, ImageFormat.G_IM_FMT_CI, ImageSize.G_IM_SIZ_8b), // Replaced before drawing.
      tile(0, ImageFormat.G_IM_FMT_CI, ImageSize.G_IM_SIZ_4b),
      tile(1, ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b),
      tile(2, ImageFormat.G_IM_FMT_I, ImageSize.G_IM_SIZ_8b), // Never selected.
      tile(3, ImageFormat.G_IM_FMT_IA, ImageSize.G_IM_SIZ_8b, 0), // Empty tile.
      [0xef000000 | CycleType.G_CYC_2CYCLE, 0],
      [0xe4020020, 0], [0xe1000000, 0], [0xf1000000, 0x04000400],
      [0xe5020020, 0], [0xe1000000, 0], [0xf1000000, 0x04000400],
      [0xef000000 | CycleType.G_CYC_1CYCLE, 0],
      [0xe4020020, 3 << 24], [0xe1000000, 0], [0xf1000000, 0x04000400],
      [0xdf000000, 0],
    ];
  }
  commands.forEach(([cmd0, cmd1], index) => {
    store(0x3000 + index * 8, cmd0);
    store(0x3004 + index * 8, cmd1);
  });

  // This task header is copied into RSP DMEM along with the bootstrap code.
  for (const [offset, value] of [
    [0x00, 1], [0x10, 0x80001000], [0x14, 4],
    [0x18, 0x80002000], [0x1c, versionSize],
    [0x30, graphics === 'invalid' ? 0x1000000 : 0x3000],
  ]) view.setUint32(0xfc0 + offset, value);
  if (graphics !== 'none') {
    code.push(0x3c08a404); // t0 = SP registers.
    store(0x10, 1); // Clear HALT to dispatch the task.
    store(0x10, 1); // Start the same task again to exercise aggregation.
  }
  if (vi) {
    code.push(0x3c08a440); // t0 = VI registers.
    store(0x0c, 0); // Select an interrupt line independently of boot defaults.
    store(0x18, 525); // Start VI interrupts.
  }
  if (rewriteCount) {
    code.push(0x40804800, 0x1000fffe, 0); // Repeatedly write CP0 COUNT=0.
  } else {
    code.push(0x1000ffff, 0); // Infinite CPU loop, with an ordinary NOP delay slot.
  }
  code.forEach((instruction, index) => view.setUint32(0x40 + index * 4, instruction));
  return bytes;
}

describe('inventory input', () => {
  test('replays holds and releases independently of CPU random consumption', () => {
    function sequence(seed, cpuReads) {
      const random = createRandom(seed);
      const update = createInputDriver(seed);
      const input = { buttons: 0, stick_x: 0, stick_y: 0 };
      return Array.from({ length: 1200 }, (_, index) => {
        for (let i = 0; i < cpuReads; i++) random();
        update(index + 1, input);
        return { ...input };
      });
    }
    const replay = sequence(0, 0);
    const random = createRandom(0);
    expect(Array.from({ length: 1000 }, random).every(value => value >= 0 && value < 1)).toBe(true);
    expect(sequence(0, 3)).toEqual(replay);
    expect(sequence(123, 0)).not.toEqual(replay);
    expect(replay.some(input => input.buttons === 0x1000)).toBe(true);
    expect(replay.some(input => input.buttons === 0x8000)).toBe(true);
    expect(replay.every(input => Math.abs(input.stick_x) <= 80 && Math.abs(input.stick_y) <= 80)).toBe(true);
    expect(replay.some((input, index) => input.buttons && input.buttons === replay[index + 1]?.buttons)).toBe(true);
    expect(replay.some((input, index) => index > 0 && replay[index - 1].buttons && input.buttons === 0 && input.stick_x === 0 && input.stick_y === 0)).toBe(true);
  });
});

describe('inventory batch command', () => {
  test('scans nested directories, shares reports across ROM byte orders, and continues after failures', async () => {
    await withDirectory(async directory => {
      const rom = makeROM({ vi: true });
      const swapped = rom.slice();
      for (let offset = 0; offset < swapped.length; offset += 2) {
        [swapped[offset], swapped[offset + 1]] = [swapped[offset + 1], swapped[offset]];
      }
      await Bun.write(join(directory, 'roms/a-bad.n64'), 'invalid');
      await Bun.write(join(directory, 'roms/b-good.z64'), rom);
      await Bun.write(join(directory, 'roms/sub/c-copy.V64'), swapped);
      await Bun.write(join(directory, 'roms/ignored.txt'), 'not a ROM');
      await symlink('.', join(directory, 'roms/directory-loop'));
      const result = await invoke(directory, ['roms', 'missing.z64', '--output-dir', 'inventory', '--frames', '1'], batchCLI);
      expect(result.code).toBe(1);
      const scanDirectory = result.stdout.trim();
      const manifestPath = join(scanDirectory, 'manifest.json');
      const manifest = await Bun.file(manifestPath).json();
      expect(manifest.status).toBe('completed');
      expect(manifest.entries).toHaveLength(4);
      const good = manifest.entries.filter(entry => entry.status === 'completed');
      const bad = manifest.entries.filter(entry => entry.status === 'error');
      expect(good).toHaveLength(2);
      expect(bad).toHaveLength(2);
      const hash = createHash('sha256').update(rom).digest('hex');
      expect(good.every(entry => entry.sha256 === hash && entry.report === `${hash}.json`)).toBe(true);
      const report = await Bun.file(join(scanDirectory, good[0].report)).json();
      expect(report.settings).toEqual(manifest.settings);
      expect(report.rom.sha256).toBe(hash);
      expect(report.collectors['graphics.taskMicrocodes'].tasks).toBe(2);
      for (const entry of bad) {
        expect(await Bun.file(join(scanDirectory, entry.report)).json()).toMatchObject({
          rom: null, collectors: {}, result: { status: 'error' },
        });
      }

      // Recover a published report whose manifest update did not finish.
      good[0].status = 'pending';
      await Bun.write(manifestPath, JSON.stringify(manifest));
      const files = [...new Set(manifest.entries.map(entry => entry.report))];
      const inodes = await Promise.all(files.map(file => stat(join(scanDirectory, file)).then(info => info.ino)));
      const resumed = await invoke(directory, ['--resume', scanDirectory], batchCLI);
      expect(resumed.code).toBe(1);
      expect((await Bun.file(manifestPath).json()).entries.every(entry => entry.status !== 'pending')).toBe(true);
      expect(await Promise.all(files.map(file => stat(join(scanDirectory, file)).then(info => info.ino)))).toEqual(inodes);

      const second = await invoke(directory, ['roms/b-good.z64', '--output-dir', 'inventory', '--frames', '1', '--seed', '2'], batchCLI);
      expect(second.code).toBe(0);
      expect(second.stdout.trim()).not.toBe(scanDirectory);
      expect((await Bun.file(join(second.stdout.trim(), `${hash}.json`)).json()).settings.seed).toBe(2);
      expect(await Bun.file(join(scanDirectory, `${hash}.json`)).json()).toEqual(report);
    });
  });

  test('saves interruption, resumes unfinished ROMs, and repairs missing reports', async () => {
    await withDirectory(async directory => {
      await Bun.write(join(directory, 'roms/a-good.z64'), makeROM({ vi: true }));
      await Bun.write(join(directory, 'roms/b-loop.z64'), makeROM({ graphics: 'loop' }));
      await Bun.write(join(directory, 'roms/c-textures.z64'), makeROM({ vi: true, graphics: 'textures' }));
      const child = Bun.spawn([process.execPath, batchCLI, 'roms', '--output-dir', 'inventory', '--frames', '1', '--timeout-ms', '2000'], {
        cwd: directory, stdout: 'pipe', stderr: 'pipe',
      });
      const stdout = new Response(child.stdout).text();
      const stderr = new Response(child.stderr).text();
      let scanDirectory;
      try {
        let ready = false;
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
          const runs = await readdir(join(directory, 'inventory/runs')).catch(() => []);
          if (runs.length) {
            scanDirectory = join(directory, 'inventory/runs', runs[0]);
            const manifest = await Bun.file(join(scanDirectory, 'manifest.json')).json().catch(() => null);
            if (manifest?.entries[0].status === 'completed' && manifest.entries[1].report) {
              ready = true;
              break;
            }
          }
          await Bun.sleep(10);
        }
        expect(ready).toBe(true);
        child.kill('SIGTERM');
        expect(await child.exited).toBe(143);
        const manifestPath = join(scanDirectory, 'manifest.json');
        const stopped = await Bun.file(manifestPath).json();
        expect(stopped.status).toBe('interrupted');
        expect(stopped.entries.map(entry => entry.status)).toEqual(['completed', 'interrupted', 'pending']);
        const goodPath = join(scanDirectory, stopped.entries[0].report);
        const before = await stat(goodPath);
        const resumed = await invoke(directory, ['--resume', scanDirectory], batchCLI);
        expect(resumed.code).toBe(1);
        expect((await stat(goodPath)).ino).toBe(before.ino);
        expect((await Bun.file(manifestPath).json()).entries.map(entry => entry.status)).toEqual(['completed', 'timeout', 'completed']);

        await rm(goodPath);
        const repaired = await invoke(directory, ['--resume', scanDirectory], batchCLI);
        expect(repaired.code).toBe(1);
        expect((await Bun.file(goodPath).json()).result.status).toBe('completed');
      } finally {
        child.kill();
        await child.exited;
        await Promise.all([stdout, stderr]);
      }
    });
  }, 15000);

  test('rejects conflicting resumes and changed provenance without altering saved results', async () => {
    await withDirectory(async directory => {
      await Bun.write(join(directory, 'test.z64'), makeROM({ vi: true }));
      const result = await invoke(directory, ['test.z64', '--output-dir', 'inventory', '--frames', '1'], batchCLI);
      expect(result.code).toBe(0);
      const scanDirectory = result.stdout.trim();
      const manifestPath = join(scanDirectory, 'manifest.json');
      const original = await readFile(manifestPath, 'utf8');
      const manifest = JSON.parse(original);
      const reportPath = join(scanDirectory, manifest.entries[0].report);
      const report = await readFile(reportPath, 'utf8');

      await Bun.write(join(scanDirectory, '.lock'), 'another scanner');
      const locked = await invoke(directory, ['--resume', scanDirectory], batchCLI);
      expect(locked.code).toBe(2);
      expect(locked.stderr).toContain('Scan is locked');
      await rm(join(scanDirectory, '.lock'));
      const settings = await invoke(directory, ['--resume', scanDirectory, '--seed', '2'], batchCLI);
      expect(settings.code).toBe(2);
      expect(await readFile(manifestPath, 'utf8')).toBe(original);

      manifest.sourceSha256 = '0'.repeat(64);
      await Bun.write(manifestPath, JSON.stringify(manifest));
      const changed = await invoke(directory, ['--resume', scanDirectory], batchCLI);
      expect(changed.code).toBe(2);
      expect(changed.stderr).toContain('Emulator source, revision or runtime changed');
      manifest.entries[0].report = '../outside.json';
      await Bun.write(manifestPath, JSON.stringify(manifest));
      const invalid = await invoke(directory, ['--resume', scanDirectory], batchCLI);
      expect(invalid.code).toBe(2);
      expect(invalid.stderr).toContain('Invalid ROM entry');
      expect(await readFile(reportPath, 'utf8')).toBe(report);
    });
  });
});

describe('inventory command', () => {
  test('produces replayable reports, aggregates task starts, and normalizes ROM byte order', async () => {
    await withDirectory(async directory => {
      const rom = makeROM({ vi: true });
      await Bun.write(join(directory, 'test.z64'), rom);
      const options = ['--seed', '123', '--frames', '3', '--max-cycles', '10000000'];
      const first = await invoke(directory, ['test.z64', ...options, '--output', 'report.json']);
      expect(first.code).toBe(0);
      expect(first.stdout).toBe('');
      const report = JSON.parse(await readFile(join(directory, 'report.json'), 'utf8'));
      const replay = await invoke(directory, ['test.z64', ...options]);
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

      const swapped = rom.slice();
      for (let offset = 0; offset < swapped.length; offset += 2) {
        [swapped[offset], swapped[offset + 1]] = [swapped[offset + 1], swapped[offset]];
      }
      await Bun.write(join(directory, 'test.v64'), swapped);
      const otherOrder = await invoke(directory, ['test.v64', ...options]);
      expect(otherOrder.code).toBe(0);
      expect(JSON.parse(otherOrder.stdout)).toEqual(report);
    });
  });

  test('counts initial and in-list loads separately from task starts across repeated tasks', async () => {
    await withDirectory(async directory => {
      await Bun.write(join(directory, 'switch.z64'), makeROM({ vi: true, graphics: 'switch' }));
      const result = await invoke(directory, ['switch.z64', '--frames', '1']);
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

  test('collects distinct formats used by draws, excluding unused and empty tiles', async () => {
    await withDirectory(async directory => {
      await Bun.write(join(directory, 'textures.z64'), makeROM({ vi: true, graphics: 'textures' }));
      for (let run = 0; run < 2; run++) {
        const result = await invoke(directory, ['textures.z64', '--frames', '1']);
        expect(result.code).toBe(0);
        expect(JSON.parse(result.stdout).collectors['graphics.textureFormats']).toEqual({
          version: 1,
          scope: 'hle-draw',
          formats: [
            { format: ImageFormat.G_IM_FMT_CI, size: ImageSize.G_IM_SIZ_4b, name: 'CI4' },
            { format: ImageFormat.G_IM_FMT_RGBA, size: ImageSize.G_IM_SIZ_16b, name: 'RGBA16' },
          ],
        });
      }
    });
  });

  test('enforces the cycle limit through guest COUNT writes and skipped idle loops', async () => {
    await withDirectory(async directory => {
      for (const options of [{ rewriteCount: true }, { vi: true }]) {
        await Bun.write(join(directory, 'test.z64'), makeROM(options));
        const result = await invoke(directory, ['test.z64', '--max-cycles', '10000']);
        expect(result.code).toBe(3);
        const report = JSON.parse(result.stdout);
        expect(report.result).toMatchObject({ status: 'cycle-limit', frames: 0, cycles: 10000, checkpointOnly: false });
        expect(report.collectors['graphics.taskMicrocodes'].tasks).toBe(2);
      }
    });
  });

  test('terminates a stuck display list and writes the last checkpoint', async () => {
    await withDirectory(async directory => {
      await Bun.write(join(directory, 'test.z64'), makeROM({ graphics: 'loop' }));
      const result = await invoke(directory, ['test.z64', '--timeout-ms', '2000']);
      expect(result.code).toBe(124);
      const report = JSON.parse(result.stdout);
      expect(report.rom.name).toBe('INVENTORY TEST');
      expect(report.result).toMatchObject({ status: 'timeout', checkpointOnly: true });
      expect(report.collectors['graphics.taskMicrocodes'].version).toBe(1);
    });
  });

  test('distinguishes unrun collectors, empty observations, and a halt during collection', async () => {
    await withDirectory(async directory => {
      const missing = await invoke(directory, ['missing.z64']);
      expect(missing.code).toBe(2);
      expect(JSON.parse(missing.stdout)).toMatchObject({ rom: null, collectors: {}, result: { status: 'error' } });
      await Bun.write(join(directory, 'test.z64'), makeROM({ graphics: 'none', vi: true }));
      const empty = await invoke(directory, ['test.z64', '--frames', '1']);
      expect(empty.code).toBe(0);
      expect(JSON.parse(empty.stdout).collectors['graphics.taskMicrocodes']).toMatchObject({ version: 1, tasks: 0, microcodes: [] });
      expect(JSON.parse(empty.stdout).collectors['graphics.microcodeLoads']).toMatchObject({ version: 1, loads: 0, microcodes: [] });
      expect(JSON.parse(empty.stdout).collectors['graphics.textureFormats']).toEqual({ version: 1, scope: 'hle-draw', formats: [] });
      await Bun.write(join(directory, 'test.z64'), makeROM({ graphics: 'invalid' }));
      const halted = await invoke(directory, ['test.z64']);
      expect(halted.code).toBe(2);
      const report = JSON.parse(halted.stdout);
      expect(report.result).toMatchObject({ status: 'halted', checkpointOnly: false });
      expect(report.result.message).toBeTruthy();
      expect(report.collectors['graphics.taskMicrocodes'].tasks).toBe(1);
      expect(report.collectors['graphics.microcodeLoads'].loads).toBe(1);
      expect(report.collectors['graphics.textureFormats'].formats).toEqual([]);
    });
  });

  test('rejects invalid limits and refuses to overwrite the input ROM', async () => {
    await withDirectory(async directory => {
      for (const options of [
        ['--seed', '4294967296'], ['--frames', '0'], ['--max-cycles', 'NaN'], ['--timeout-ms', '2147483648'], ['--unknown'],
      ]) {
        const invalid = await invoke(directory, ['test.z64', ...options]);
        expect(invalid.code).toBe(2);
        expect(invalid.stdout).toBe('');
      }
      const rom = makeROM();
      await Bun.write(join(directory, 'test.z64'), rom);
      const overwrite = await invoke(directory, ['test.z64', '--output', './test.z64']);
      expect(overwrite.code).toBe(2);
      expect(new Uint8Array(await readFile(join(directory, 'test.z64')))).toEqual(rom);
    });
  });
});
