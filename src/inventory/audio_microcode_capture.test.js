import { describe, expect, test } from 'bun:test';
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { MemoryRegion } from '../memory/memory_region.js';
import { snapshotAudioMicrocode } from '../hle/audio_microcode.js';
import { AudioMicrocodeCapture, captureFile, readAudioCapture } from './audio_microcode_capture.js';
import { AudioMicrocodeCollector } from './audio_microcode_collector.js';
import { replayAudioCapture } from './audio_microcode_replay.js';

function taskImage() {
  const ram = new Uint8Array(0x8000);
  const imem = new Uint8Array(0x1000);
  const task = new MemoryRegion(new ArrayBuffer(64));
  for (const [offset, value] of [[8, 0x2000], [12, 0x1000], [16, 0x2000], [20, 0x1000], [24, 0x4000], [28, 0x100]]) task.set32(offset, value);
  new DataView(imem.buffer).setUint32(0, 0x0000000d); // BREAK: the rest is unreachable.
  return { ram, imem, task, snapshot: () => snapshotAudioMicrocode(ram, task, imem) };
}

async function withCapture(fn) {
  const directory = await mkdtemp(join(tmpdir(), 'n64js-audio-capture-'));
  try {
    await writeFile(join(directory, captureFile), '');
    const capture = new AudioMicrocodeCapture(directory);
    const collector = new AudioMicrocodeCollector();
    const observe = image => {
      capture.observe(image, { frame: collector.tasks, cycles: collector.tasks * 10 });
      collector.observe(image);
    };
    const saveReport = async () => {
      capture.flush();
      await writeFile(join(directory, 'report.json'), JSON.stringify({
        schemaVersion: 1, sourceSha256: 'a'.repeat(64), rom: null, emulator: {}, settings: {},
        result: { status: 'completed', checkpointOnly: false },
        audioCapture: capture.snapshot(), collectors: { 'audio.taskMicrocodes': collector.snapshot() },
      }));
    };
    await fn({ directory, capture, collector, observe, saveReport });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const collect = async (directory, metadata) => {
  const tasks = [];
  for await (const task of readAudioCapture(directory, metadata)) tasks.push(task);
  return tasks;
};

describe('raw audio microcode corpus', () => {
  test('preserves copied raw evidence even when declared sizes/loaders are unsupported', () => {
    const source = taskImage();
    source.task.set32(12, 0);
    source.task.set32(28, 0xffffffff);
    source.ram[0x4fff] = 99;
    const image = source.snapshot();
    expect(image.loader).toBe('unknown');
    expect(image.data).toHaveLength(0);
    expect(image.raw.data).toHaveLength(4096);
    expect(image.raw.data[4095]).toBe(99);
    source.ram.fill(0);
    source.imem.fill(1);
    source.task.u8.fill(1);
    expect(image.raw.data[4095]).toBe(99);
    expect(image.raw.imem[0]).toBe(0);
    expect(new DataView(image.raw.task.buffer).getUint32(28)).toBe(0xffffffff);
  });

  test('round trips every distinct raw snapshot independently of structural fingerprints', async () => {
    await withCapture(async ({ directory, capture, collector, observe, saveReport }) => {
      const source = taskImage();
      const expected = [];
      const record = () => { const image = source.snapshot(); expected.push(image); observe(image); };
      record(); record(); // Exact duplicate snapshots reuse one image record.
      capture.flush(); // Replay must cross gzip member boundaries.
      source.imem[0xfff] = 1; record(); // Unreachable code.
      source.ram[0x4080] = 1; record(); // Non-dispatch constants/scratch.
      source.ram[0x4fff] = 1; record(); // Beyond declared data size.
      source.task.set32(0x30, 0x7000); record(); // Task metadata, no command-list read.
      await saveReport();
      expect(capture.snapshot()).toMatchObject({ tasks: 6, images: 5 });
      expect(collector.snapshot().microcodes).toHaveLength(1);
      const replayed = await collect(directory, capture.snapshot());
      expect(replayed.map(task => task.image)).toEqual(expected);
      expect(replayed.map(task => [task.task, task.frame, task.cycles])).toEqual(expected.map((_, i) => [i + 1, i, i * 10]));
      expect((await replayAudioCapture(directory)).matchesRecorded).toBe(true);
    });
  });

  test('replays exactly the published prefix after an interrupted append', async () => {
    await withCapture(async ({ directory, capture, observe, saveReport }) => {
      observe(taskImage().snapshot());
      await saveReport();
      observe(taskImage().snapshot()); // Still pending; not part of the saved report.
      expect(capture.snapshot().tasks).toBe(1);
      await appendFile(join(directory, captureFile), 'partial or unpublished gzip member');
      const replay = await replayAudioCapture(directory);
      expect(replay.matchesRecorded).toBe(true);
      expect(replay.audioMicrocodes.tasks).toBe(1);
    });
  });

  test('distinguishes zero observations from missing data and rejects truncated/corrupt bytes', async () => {
    await withCapture(async ({ directory, capture, observe, saveReport }) => {
      await saveReport();
      expect((await replayAudioCapture(directory)).audioMicrocodes.tasks).toBe(0);
      observe(taskImage().snapshot());
      await saveReport();
      const path = join(directory, captureFile);
      const original = await readFile(path);
      await writeFile(path, original.subarray(0, original.length - 1));
      await expect(replayAudioCapture(directory)).rejects.toThrow('Truncated audio capture');
      const corrupt = Buffer.from(original);
      corrupt[corrupt.length - 8] ^= 1; // Gzip CRC.
      await writeFile(path, corrupt);
      await expect(replayAudioCapture(directory)).rejects.toThrow();
      await writeFile(path, original);
      await expect(collect(directory, { ...capture.snapshot(), tasks: 2 })).rejects.toThrow('counts do not match');
    });
  });

  test('rejects image tampering, invalid task references and incompatible schemas', async () => {
    await withCapture(async ({ directory, capture, observe, saveReport }) => {
      observe(taskImage().snapshot());
      await saveReport();
      const path = join(directory, captureFile);
      const records = gunzipSync(await readFile(path)).toString().trim().split('\n').map(line => JSON.parse(line));
      for (const mutate of [
        rows => { rows[0].image.raw.code = 'AAAA'; },
        rows => { rows[1].image = 'unknown'; },
        rows => { rows[1].task = 3; },
      ]) {
        const changed = structuredClone(records);
        mutate(changed);
        const bytes = gzipSync(changed.map(row => JSON.stringify(row)).join('\n') + '\n');
        await writeFile(path, bytes);
        await expect(collect(directory, { ...capture.snapshot(), bytes: bytes.length })).rejects.toThrow();
      }
      const reportPath = join(directory, 'report.json');
      const report = JSON.parse(await readFile(reportPath));
      report.audioCapture.version = 2;
      await writeFile(reportPath, JSON.stringify(report));
      await expect(replayAudioCapture(directory)).rejects.toThrow('Invalid audio capture report');
    });
  });

  test('does not publish counts or bytes when storing a checkpoint fails', async () => {
    await withCapture(async ({ directory, capture, observe }) => {
      const path = join(directory, captureFile);
      await rm(path);
      await mkdir(path); // Appending must fail even when tests run as root.
      observe(taskImage().snapshot());
      expect(() => capture.flush()).toThrow();
      expect(capture.snapshot()).toMatchObject({ bytes: 0, tasks: 0, images: 0 });
    });
  });
});
