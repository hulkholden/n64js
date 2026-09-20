import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { link, mkdtemp, readFile, readdir, realpath, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInputDriver, createRandom, parseInputScript } from './inventory_input.js';
import { captureFailure } from './inventory_failure.js';
import { CycleType, ImageFormat, ImageSize } from '../hle/gbi.js';

const cli = fileURLToPath(new URL('./inventory.js', import.meta.url));
const batchCLI = fileURLToPath(new URL('./inventory_batch.js', import.meta.url));
const queryCLI = fileURLToPath(new URL('./inventory_query.js', import.meta.url));

async function invoke(directory, args, command = cli) {
  const child = Bun.spawn([process.execPath, command, ...args], { cwd: directory, stdout: 'pipe', stderr: 'pipe' });
  const [code, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

async function withDirectory(fn) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'n64js-inventory-')));
  try {
    await fn(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

// A synthetic bootstrap starts real RSP tasks, then spins with optional VI
// interrupts. No copyrighted ROM or emulator mocks are needed by the CLI tests.
function makeROM({ vi = false, graphics = 'end', audio = false, rewriteCount = false, waitForInput = false } = {}) {
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
  let commands = [[0xdf000000, 0]];
  if (graphics === 'loop') {
    // A multi-command cycle exercises the synchronous HLE command guard.
    commands = [[0xde010000, 0x3008], [0xde010000, 0x3000]];
  }
  if (graphics === 'wait') commands = [[0xde010000, 0x3000]];
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
  if (audio) {
    view.setUint32(0xfc0, 2);
    view.setUint32(0xfc8, 0x80004000);
    view.setUint32(0xfcc, 0x1000);
    view.setUint32(0xfd0, 0x80004000);
    view.setUint32(0xfd4, 0x1000);
    view.setUint32(0xfdc, 0x40);
    code.push(0x3c08a400); // SP memory: a minimal direct-loaded audio program.
    store(0x1000, 0x0000000d); // BREAK ends the task when the RSP executes it.
  }
  if (vi) {
    code.push(0x3c08a440); // t0 = VI registers.
    store(0x0c, 0); // Select an interrupt line independently of boot defaults.
    store(0x18, 525); // Start VI interrupts.
  }
  if (waitForInput) {
    code.push(0x3c08a000); // Set up a controller-1 read with an aligned response.
    store(0x6000, 0xff010401);
    store(0x6008, 0xfe000000);
    store(0x603c, 1);
    code.push(0x3c08a480); // SI registers: configure Joybus using a DMA write.
    store(0x00, 0x6000);
    store(0x10, 0x1fc007c0);
    code.push(0x3c10a430, 0x3c11a440, 0x3c12a480, 0x3c13a000); // MI, VI, SI, RAM bases.
    code.push(0x3c141000, 0x369450d0); // s4 = START, stick X=80, Y=-48.
    const poll = code.length;
    code.push(0x8e0a0008, 0x314a0008, 0x1140fffd, 0); // Wait for the next VI interrupt.
    code.push(0xae200010, 0xae400004, 0x8e6a6004); // Acknowledge VI; DMA/read controller response.
    code.push(0x15540000 | ((poll - code.length - 1) & 0xffff), 0); // Repeat until input matches.
  }
  if (graphics !== 'none') {
    code.push(0x3c08a404); // t0 = SP registers.
    store(0x10, 1); // Clear HALT to dispatch the task.
    if (audio) {
      // LLE tasks complete asynchronously. Wait for HALT, then rewind the RSP PC.
      code.push(0x8d0a0010, 0x314a0001, 0x1140fffd, 0);
      code.push(0x3c08a408);
      store(0, 0);
      code.push(0x3c08a404);
    }
    store(0x10, 1); // Start the same task again to exercise aggregation.
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
  test('holds complete scripted states for exact VI durations before starting the seeded sequence', () => {
    const script = parseInputScript({ version: 1, steps: [
      { frames: 2 }, { frames: 2, buttons: ['start'] }, { frames: 1 },
      { frames: 2, buttons: ['A', 'Z'], stickX: 80, stickY: -48 },
    ] });
    const drive = (seed, prefix, frames) => {
      const update = createInputDriver(seed, prefix);
      const input = { buttons: 0, stick_x: 0, stick_y: 0 };
      return Array.from({ length: frames }, (_, index) => {
        update(index + 1, input);
        return { ...input };
      });
    };
    const sequence = drive(123, script, 127);
    const neutral = { buttons: 0, stick_x: 0, stick_y: 0 };
    const start = { ...neutral, buttons: 0x1000 };
    const action = { buttons: 0xa000, stick_x: 80, stick_y: -48 };
    expect(sequence.slice(0, 7)).toEqual([neutral, neutral, start, start, neutral, action, action]);
    expect(sequence.slice(7)).toEqual(drive(123, undefined, 120));
    expect(drive(124, script, 127).slice(0, 7)).toEqual(sequence.slice(0, 7));
    expect(drive(124, script, 127).slice(7)).not.toEqual(sequence.slice(7));
  });

  test('rejects ambiguous or invalid scripts instead of silently changing their meaning', () => {
    for (const invalid of [
      null, { version: 2, steps: [{ frames: 1 }] }, { version: 1, steps: [] },
      { version: 1, steps: [{ frames: 1 }], loop: true },
      ...[null, { frames: 0 }, { frames: 1.5 }, { frames: '1' },
        { frames: 1, button: 'A' }, { frames: 1, buttons: ['STRAT'] },
        { frames: 1, buttons: null }, { frames: 1, stickX: 128 },
        { frames: 1, stickY: -129 }, { frames: 1, stickY: null },
      ].map(step => ({ version: 1, steps: [step] })),
      { version: 1, steps: [{ frames: Number.MAX_SAFE_INTEGER }, { frames: 1 }] },
    ]) expect(() => parseInputScript(invalid)).toThrow();
  });

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

test('failure evidence serializes non-Error throws without inventing a stack or leaking error properties', () => {
  for (const thrown of ['Read is out of range', null, undefined]) {
    expect(JSON.parse(JSON.stringify(captureFailure('exception', thrown))).exception).toEqual({
      name: null, message: String(thrown), stack: null,
    });
  }
  const error = new RangeError('outside buffer');
  error.circular = error;
  expect(JSON.parse(JSON.stringify(captureFailure('exception', error))).exception).toEqual({
    name: 'RangeError', message: error.message, stack: error.stack,
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
      const queried = await invoke(directory, [scanDirectory, '--microcode', 'GBI2'], queryCLI);
      expect(queried.code).toBe(0);
      const query = JSON.parse(queried.stdout);
      expect(query.summary).toEqual({ matched: 1, notObserved: 0, unknown: 2, errors: 0 });
      expect(query.matches[0]).toMatchObject({
        rom: report.rom, paths: good.map(entry => entry.path), settings: report.settings,
      });
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

  test('keeps seed scans independent, continues after failures, and resumes them together', async () => {
    await withDirectory(async directory => {
      const rom = makeROM({ vi: true, waitForInput: true });
      await Bun.write(join(directory, 'roms/a.z64'), rom);
      await Bun.write(join(directory, 'roms/b.z64'), rom);
      const script = { version: 1, steps: [{ frames: 2 }, { frames: 3, buttons: ['START'], stickX: 80, stickY: -48 }] };
      await Bun.write(join(directory, 'menu.json'), JSON.stringify(script));
      const result = await invoke(directory, [
        'roms', 'missing.z64', '--output-dir', 'inventory', '--frames', '5',
        '--seed', '2', '--seed', '0', '--seed', '02', '--input-script', 'menu.json',
      ], batchCLI);
      expect(result.code).toBe(1);
      const directories = result.stdout.trim().split('\n');
      expect(directories).toHaveLength(2);
      const manifests = await Promise.all(directories.map(path => Bun.file(join(path, 'manifest.json')).json()));
      expect(manifests.map(manifest => manifest.settings.seed)).toEqual([2, 0]);
      const reportPaths = [];
      for (const [index, manifest] of manifests.entries()) {
        expect(manifest.status).toBe('completed');
        const good = manifest.entries.filter(entry => entry.status === 'completed');
        expect(good).toHaveLength(2);
        expect(good[0].report).toBe(good[1].report);
        expect(manifest.entries.filter(entry => entry.status === 'error')).toHaveLength(1);
        const path = join(directories[index], good[0].report);
        reportPaths.push(path);
        const report = await Bun.file(path).json();
        expect(report.settings).toEqual(manifest.settings);
        expect(report.settings.inputPolicy.script).toEqual(parseInputScript(script));
        expect(report.collectors['graphics.taskMicrocodes'].tasks).toBe(2);
      }
      const queried = await invoke(directory, ['inventory', '--microcode', 'GBI2'], queryCLI);
      expect(queried.code).toBe(0);
      const query = JSON.parse(queried.stdout);
      expect(query.summary).toEqual({ matched: 2, notObserved: 0, unknown: 2, errors: 0 });
      expect(query.matches.map(match => match.settings.seed).sort()).toEqual([0, 2]);
      expect(query.matches.every(match => match.paths.length === 2)).toBe(true);

      // Force a worker to replay the embedded script after its source file is gone.
      const original = await Bun.file(reportPaths[0]).json();
      await rm(reportPaths[0]);
      await rm(join(directory, 'menu.json'));
      const before = await stat(reportPaths[1]);
      const resumed = await invoke(directory, [...directories, directories[0]].flatMap(path => ['--resume', path]), batchCLI);
      expect(resumed.code).toBe(1);
      expect(resumed.stdout.trim().split('\n')).toEqual(directories);
      expect(await Bun.file(reportPaths[0]).json()).toEqual(original);
      expect((await stat(reportPaths[1])).ino).toBe(before.ino);
    });
  });

  test('saves interruption, resumes unfinished ROMs and seeds, and repairs missing reports', async () => {
    await withDirectory(async directory => {
      await Bun.write(join(directory, 'roms/a-good.z64'), makeROM({ vi: true }));
      await Bun.write(join(directory, 'roms/b-loop.z64'), makeROM({ graphics: 'wait' }));
      await Bun.write(join(directory, 'roms/c-textures.z64'), makeROM({ vi: true, graphics: 'textures' }));
      const child = Bun.spawn([process.execPath, batchCLI, 'roms', '--output-dir', 'inventory', '--frames', '1', '--max-cycles', '5000000000000', '--timeout-ms', '2000', '--seed', '1', '--seed', '2'], {
        cwd: directory, stdout: 'pipe', stderr: 'pipe',
      });
      const stdout = new Response(child.stdout).text();
      const stderr = new Response(child.stderr).text();
      let scanDirectory;
      let laterDirectory;
      try {
        let ready = false;
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
          const runs = await readdir(join(directory, 'inventory/runs')).catch(() => []);
          for (const run of runs) {
            const path = join(directory, 'inventory/runs', run);
            const manifest = await Bun.file(join(path, 'manifest.json')).json().catch(() => null);
            if (manifest?.settings.seed === 2) laterDirectory = path;
            if (manifest?.settings.seed === 1 && manifest.entries[0].status === 'completed' && manifest.entries[1].report) {
              scanDirectory = path;
            }
          }
          if (scanDirectory && laterDirectory) {
            ready = true;
            break;
          }
          await Bun.sleep(10);
        }
        expect(ready).toBe(true);
        child.kill('SIGTERM');
        expect(await child.exited).toBe(143);
        expect((await stdout).trim().split('\n')).toEqual([scanDirectory, laterDirectory]);
        const manifestPath = join(scanDirectory, 'manifest.json');
        const stopped = await Bun.file(manifestPath).json();
        expect(stopped.status).toBe('interrupted');
        expect(stopped.entries.map(entry => entry.status)).toEqual(['completed', 'interrupted', 'pending']);
        const later = await Bun.file(join(laterDirectory, 'manifest.json')).json();
        expect(later.status).toBe('pending');
        expect(later.entries.every(entry => entry.status === 'pending' && entry.report === null)).toBe(true);
        expect(await Bun.file(join(scanDirectory, '.lock')).exists()).toBe(false);
        expect(await Bun.file(join(laterDirectory, '.lock')).exists()).toBe(false);
        const goodPath = join(scanDirectory, stopped.entries[0].report);
        const before = await stat(goodPath);
        const resumed = await invoke(directory, ['--resume', scanDirectory, '--resume', laterDirectory], batchCLI);
        expect(resumed.code).toBe(1);
        expect((await stat(goodPath)).ino).toBe(before.ino);
        expect((await Bun.file(manifestPath).json()).entries.map(entry => entry.status)).toEqual(['completed', 'timeout', 'completed']);
        expect((await Bun.file(join(laterDirectory, 'manifest.json')).json()).entries.map(entry => entry.status)).toEqual(['completed', 'timeout', 'completed']);

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

  test('validates every seed before creating scans', async () => {
    await withDirectory(async directory => {
      const invalid = await invoke(directory, [
        'missing.z64', '--output-dir', 'inventory', '--seed', '1', '--seed', '4294967296',
      ], batchCLI);
      expect(invalid.code).toBe(2);
      expect(invalid.stderr).toContain('Invalid seed');
      expect(invalid.stdout).toBe('');
      expect(await readdir(directory)).toEqual([]);
    });
  });
});

describe('inventory command', () => {
  test('collects and aggregates unknown audio microcode through the real worker and report query', async () => {
    await withDirectory(async directory => {
      await Bun.write(join(directory, 'audio.z64'), makeROM({ vi: true, audio: true }));
      const result = await invoke(directory, ['audio.z64', '--frames', '1', '--output', 'report.json']);
      expect(result.code).toBe(0);
      const report = JSON.parse(await readFile(join(directory, 'report.json'), 'utf8'));
      expect(report.collectors['audio.taskMicrocodes']).toEqual({
        version: 1, scope: 'task-start', tasks: 2,
        microcodes: [{ family: 'Unknown', detection: 'unknown', tasks: 2 }],
      });
      expect(report.collectors['graphics.taskMicrocodes'].tasks).toBe(0);
      const query = await invoke(directory, ['report.json', '--audio-microcode', 'unknown'], queryCLI);
      expect(query.code).toBe(0);
      expect(JSON.parse(query.stdout).summary.matched).toBe(1);
    });
  });

  test('replays saved settings from boot across ROM byte orders and retains original provenance', async () => {
    await withDirectory(async directory => {
      const rom = makeROM({ vi: true, waitForInput: true });
      await Bun.write(join(directory, 'test.z64'), rom);
      const script = { version: 1, steps: [{ frames: 2 }, { frames: 3, buttons: ['START'], stickX: 80, stickY: -48 }] };
      await Bun.write(join(directory, 'menu.json'), JSON.stringify(script));
      const first = await invoke(directory, ['test.z64', '--seed', '123', '--frames', '5', '--max-cycles', '10000000', '--timeout-ms', '5000', '--input-script', 'menu.json']);
      expect(first.code).toBe(0);
      const expected = JSON.parse(first.stdout);
      const original = structuredClone(expected);
      original.emulator = { revision: 'a'.repeat(40), dirty: false, runtime: 'bun', runtimeVersion: 'old-runtime' };
      original.result = { ...original.result, status: 'timeout', frames: 2, checkpointOnly: true };
      const saved = JSON.stringify(original, null, 2) + '\n';
      await Bun.write(join(directory, 'original.json'), saved);
      await rm(join(directory, 'menu.json'));
      await rm(join(directory, 'test.z64'));
      const swapped = rom.slice();
      for (let offset = 0; offset < swapped.length; offset += 2) {
        [swapped[offset], swapped[offset + 1]] = [swapped[offset + 1], swapped[offset]];
      }
      await Bun.write(join(directory, 'moved.v64'), swapped);

      const result = await invoke(directory, ['moved.v64', '--replay', 'original.json', '--output', 'replayed.json']);
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
      const query = await invoke(directory, ['replayed.json', '--microcode', 'GBI2'], queryCLI);
      expect(JSON.parse(query.stdout).matches[0].replayOf).toEqual(report.replayOf);
    });
  });

  test('rejects a different ROM before executing its code', async () => {
    await withDirectory(async directory => {
      await Bun.write(join(directory, 'test.z64'), makeROM({ vi: true }));
      const first = await invoke(directory, ['test.z64', '--frames', '1', '--output', 'original.json']);
      expect(first.code).toBe(0);
      const original = await Bun.file(join(directory, 'original.json')).json();
      const other = makeROM({ vi: true, graphics: 'textures' });
      await Bun.write(join(directory, 'other.z64'), other);
      const result = await invoke(directory, ['other.z64', '--replay', 'original.json']);
      expect(result.code).toBe(2);
      const report = JSON.parse(result.stdout);
      expect(report.result).toMatchObject({ status: 'error', frames: 0, cycles: 0, message: 'ROM SHA-256 does not match the replay report' });
      expect(report.collectors).toEqual({});
      expect(report.rom.sha256).toBe(createHash('sha256').update(other).digest('hex'));
      expect(report.replayOf.romSha256).toBe(original.rom.sha256);
    });
  });

  test('rejects unsupported replay settings and conflicting overrides before running', async () => {
    await withDirectory(async directory => {
      await Bun.write(join(directory, 'test.z64'), makeROM({ vi: true }));
      const first = await invoke(directory, ['test.z64', '--frames', '1']);
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
        const result = await invoke(directory, ['test.z64', '--replay', 'original.json']);
        expect(result.code).toBe(2);
        expect(result.stdout).toBe('');
      }
      await Bun.write(join(directory, 'original.json'), first.stdout);
      for (const option of ['--seed', '--frames', '--max-cycles', '--timeout-ms', '--input-script']) {
        const result = await invoke(directory, ['test.z64', '--replay', 'original.json', option, '1']);
        expect(result.code).toBe(2);
        expect(result.stderr).toContain('--replay cannot be combined');
        expect(result.stdout).toBe('');
      }
      expect(await readFile(join(directory, 'original.json'), 'utf8')).toBe(first.stdout);
    });
  });

  test('protects replay reports from output paths that name or alias them', async () => {
    await withDirectory(async directory => {
      await Bun.write(join(directory, 'test.z64'), makeROM({ vi: true }));
      const first = await invoke(directory, ['test.z64', '--frames', '1', '--output', 'original.json']);
      expect(first.code).toBe(0);
      const originalPath = join(directory, 'original.json');
      const original = await readFile(originalPath, 'utf8');
      await symlink(originalPath, join(directory, 'symlink.json'));
      await link(originalPath, join(directory, 'hardlink.json'));
      for (const output of ['original.json', 'symlink.json', 'hardlink.json']) {
        const result = await invoke(directory, ['test.z64', '--replay', 'original.json', '--output', output]);
        expect(result.code).toBe(2);
        expect(result.stderr).toContain('must not overwrite the replay report');
        expect(result.stdout).toBe('');
        expect(await readFile(originalPath, 'utf8')).toBe(original);
      }
    });
  });

  test('uses scripted controller input to reach graphics and honors the total frame limit', async () => {
    await withDirectory(async directory => {
      await Bun.write(join(directory, 'test.z64'), makeROM({ vi: true, waitForInput: true }));
      for (const [script, tasks] of [
        [{ version: 1, steps: [{ frames: 10 }] }, 0],
        [{ version: 1, steps: [{ frames: 2 }, { frames: 3, buttons: ['START'], stickX: 80, stickY: -48 }] }, 2],
      ]) {
        await Bun.write(join(directory, 'menu.json'), JSON.stringify(script));
        const result = await invoke(directory, ['test.z64', '--frames', '5', '--input-script', 'menu.json']);
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
    await withDirectory(async directory => {
      await Bun.write(join(directory, 'malformed.json'), '{');
      await Bun.write(join(directory, 'invalid.json'), JSON.stringify({ version: 1, steps: [{ frames: 0 }] }));
      for (const path of ['missing.json', 'malformed.json', 'invalid.json']) {
        for (const command of [cli, batchCLI]) {
          const args = ['missing.z64', '--input-script', path];
          if (command === batchCLI) args.push('--output-dir', 'inventory');
          const result = await invoke(directory, args, command);
          expect(result.code).toBe(2);
          expect(result.stdout).toBe('');
        }
      }
      expect((await readdir(directory)).sort()).toEqual(['invalid.json', 'malformed.json']);
    });
  });

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

  test('enforces the emulated cycle budget while HLE waits for a CPU patch', async () => {
    await withDirectory(async directory => {
      await Bun.write(join(directory, 'test.z64'), makeROM({ graphics: 'wait' }));
      const result = await invoke(directory, ['test.z64', '--max-cycles', '10000']);
      expect(result.code).toBe(3);
      expect(JSON.parse(result.stdout).result).toMatchObject({
        status: 'cycle-limit', cycles: 10000, checkpointOnly: false,
      });
    });
  });

  test('reports a runaway display list with terminal exception evidence', async () => {
    await withDirectory(async directory => {
      await Bun.write(join(directory, 'test.z64'), makeROM({ graphics: 'loop' }));
      const result = await invoke(directory, ['test.z64', '--timeout-ms', '2000']);
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
    await withDirectory(async directory => {
      await Bun.write(join(directory, 'test.z64'), makeROM({ graphics: 'wait' }));
      const result = await invoke(directory, ['test.z64', '--max-cycles', '5000000000000', '--timeout-ms', '2000']);
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
      const startupFailure = JSON.parse(missing.stdout).result.failure;
      expect(startupFailure).toMatchObject({ version: 1, kind: 'exception', exception: { name: 'Error', message: 'ROM not found: ' + join(directory, 'missing.z64') } });
      expect(startupFailure.exception.stack).toContain('loadROMFile');
      expect(startupFailure.context).toBeUndefined();
      await Bun.write(join(directory, 'test.z64'), makeROM({ graphics: 'none', vi: true }));
      const empty = await invoke(directory, ['test.z64', '--frames', '1']);
      expect(empty.code).toBe(0);
      expect(JSON.parse(empty.stdout).result.failure).toBeUndefined();
      expect(JSON.parse(empty.stdout).collectors['audio.taskMicrocodes']).toEqual({ version: 1, scope: 'task-start', tasks: 0, microcodes: [] });
      expect(JSON.parse(empty.stdout).collectors['graphics.taskMicrocodes']).toMatchObject({ version: 1, tasks: 0, microcodes: [] });
      expect(JSON.parse(empty.stdout).collectors['graphics.microcodeLoads']).toMatchObject({ version: 1, loads: 0, microcodes: [] });
      expect(JSON.parse(empty.stdout).collectors['graphics.textureFormats']).toEqual({ version: 1, scope: 'hle-draw', formats: [] });
      await Bun.write(join(directory, 'test.z64'), makeROM({ graphics: 'invalid' }));
      const halted = await invoke(directory, ['test.z64']);
      expect(halted.code).toBe(2);
      const report = JSON.parse(halted.stdout);
      expect(report.result).toMatchObject({ status: 'halted', checkpointOnly: false });
      expect(report.result.message).toBeTruthy();
      expect(report.result.failure).toMatchObject({
        version: 1, kind: 'exception', exception: { name: 'RangeError' },
      });
      expect(typeof report.result.failure.exception.message).toBe('string');
      const { cpu, rsp } = report.result.failure.context;
      for (const pc of [cpu.pc, cpu.nextPC, cpu.delayPC, rsp.pc]) expect(Number.isInteger(pc)).toBe(true);
      expect(typeof rsp.halted).toBe('boolean');
      // An actual invalid display-list read must retain its original stack
      // across CPU halt handling and worker IPC, not a stack from serialization.
      expect(report.result.failure.exception.stack).toContain('nextCommand');
      expect(report.result.failure.exception.stack).toContain('rsp_state.js');
      await Bun.write(join(directory, 'failure.json'), JSON.stringify(report));
      const queried = await invoke(directory, ['failure.json', '--microcode', 'GBI2'], queryCLI);
      expect(queried.code).toBe(0);
      expect(JSON.parse(queried.stdout).matches[0].result.failure).toEqual(report.result.failure);
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
