import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInputDriver, createRandom } from './inventory_input.js';

const cli = fileURLToPath(new URL('./inventory.js', import.meta.url));

async function invoke(directory, args) {
  const child = Bun.spawn([process.execPath, cli, ...args], { cwd: directory, stdout: 'pipe', stderr: 'pipe' });
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
  const version = new TextEncoder().encode('RSP Gfx ucode F3DEX fifo 2.0\0');
  const paddedVersion = new Uint8Array((version.length + 3) & ~3);
  paddedVersion.set(version);
  const versionWords = new DataView(paddedVersion.buffer);
  for (let offset = 0; offset < paddedVersion.length; offset += 4) {
    store(0x2000 + offset, versionWords.getUint32(offset));
  }
  store(0x3000, graphics === 'loop' ? 0xde010000 : 0xdf000000);
  store(0x3004, graphics === 'loop' ? 0x3000 : 0);

  // This task header is copied into RSP DMEM along with the bootstrap code.
  for (const [offset, value] of [
    [0x00, 1], [0x10, 0x80001000], [0x14, 4],
    [0x18, 0x80002000], [0x1c, version.length],
    [0x30, graphics === 'invalid' ? 0x1000000 : 0x3000],
  ]) view.setUint32(0xfc0 + offset, value);
  if (graphics !== 'none') {
    code.push(0x3c08a404); // t0 = SP registers.
    store(0x10, 1); // Clear HALT to dispatch the task.
    store(0x10, 1); // Start the same task again to exercise aggregation.
  }
  if (vi) {
    code.push(0x3c08a440); // t0 = VI registers.
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
      await Bun.write(join(directory, 'test.z64'), makeROM({ graphics: 'invalid' }));
      const halted = await invoke(directory, ['test.z64']);
      expect(halted.code).toBe(2);
      const report = JSON.parse(halted.stdout);
      expect(report.result).toMatchObject({ status: 'halted', checkpointOnly: false });
      expect(report.result.message).toBeTruthy();
      expect(report.collectors['graphics.taskMicrocodes'].tasks).toBe(1);
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
