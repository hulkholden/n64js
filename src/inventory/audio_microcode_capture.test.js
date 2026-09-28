import { describe, expect, test } from 'bun:test';
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { MemoryRegion } from '../memory/memory_region.js';
import { snapshotAudioMicrocode } from '../hle/audio_microcode.js';
import { AudioMicrocodeCapture, captureFile, readAudioCapture, readAudioCaptureEvents } from './audio_microcode_capture.js';
import { catalogueAudioCaptures, readCaptureTask, compareInstructionLoads } from './audio_microcode_catalogue.js';
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

async function withCapture(fn, options) {
  const directory = await mkdtemp(join(tmpdir(), 'n64js-audio-capture-'));
  try {
    await writeFile(join(directory, captureFile), '');
    const capture = new AudioMicrocodeCapture(directory, options);
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

const instructionLoad = (task = 1, value = 0) => ({
  task, rspPC: 0x20, source: 0x2000, destination: 0x1ff8, length: 16, count: 2, skip: 8,
  imem: new Uint8Array(4096).fill(value),
});
const when = { frame: 1, cycles: 100 };

describe('instruction DMA evidence', () => {
  test('retains repeated loads, order and queued ownership across tasks/checkpoints', async () => {
    await withCapture(async ({ directory, capture, observe, saveReport }) => {
      observe(taskImage().snapshot());
      capture.observeInstructionLoad(instructionLoad(), when);
      capture.observeInstructionLoad(instructionLoad(), when);
      await saveReport();
      observe(taskImage().snapshot());
      const delayed = instructionLoad(1, 7);
      capture.observeInstructionLoad(delayed, when); // Queued by task 1, copied after task 2 starts.
      delayed.imem.fill(99); // The writer must already own its encoded bytes.
      capture.observeInstructionLoad(instructionLoad(2), when);
      await saveReport();
      expect(capture.snapshot()).toMatchObject({ version: 2, tasks: 2, loads: 4, instructionImages: 2 });
      const events = [];
      for await (const event of readAudioCaptureEvents(directory, capture.snapshot())) events.push(event);
      expect(events.map(e => [e.type, e.task])).toEqual([
        ['task', 1], ['instruction-load', 1], ['instruction-load', 1], ['task', 2], ['instruction-load', 1], ['instruction-load', 2],
      ]);
      expect(events[4].image[0]).toBe(7);
      expect(events[1].imageId).toBe(events[2].imageId);
      const replay = await replayAudioCapture(directory);
      expect(replay.matchesRecorded).toBe(true);
      expect(replay.instructionLoads).toMatchObject({ loads: 4, tasksWithLoads: 2 });
      expect(replay.instructionLoads.sequences.map(s => s.loads.length).sort()).toEqual([1, 3]);
      const selected = await readCaptureTask(directory, 1);
      const comparison = compareInstructionLoads(selected, selected, 1, 3);
      expect(comparison.imem.ranges).toEqual([[0, 4096]]);
      expect(comparison.imem.words[0].right.address).toBe(0x1000);
      expect((await catalogueAudioCaptures([directory])).summary).toMatchObject({ instructionCaptureRuns: 1, instructionLoads: 4, instructionImages: 2 });
    }, { instructionLoads: true });
  });

  test('distinguishes old captures from observed zero loads', async () => {
    for (const instructionLoads of [false, true]) await withCapture(async ({ directory, observe, saveReport }) => {
      observe(taskImage().snapshot()); await saveReport();
      const replay = await replayAudioCapture(directory);
      expect(replay.instructionLoads?.loads ?? null).toBe(instructionLoads ? 0 : null);
      const task = await readCaptureTask(directory);
      expect(() => compareInstructionLoads(task, task, 1, 0)).toThrow(instructionLoads ? 'not found' : 'not recorded');
    }, { instructionLoads });
  });

  test('validates instruction images, DMA geometry, references, counts and event order', async () => {
    await withCapture(async ({ directory, capture, observe, saveReport }) => {
      observe(taskImage().snapshot());
      capture.observeInstructionLoad(instructionLoad(), when);
      await saveReport();
      const path = join(directory, captureFile);
      const original = await readFile(path);
      const records = gunzipSync(original).toString().trim().split('\n').map(JSON.parse);
      for (const mutate of [
        rows => { rows[2].imem = 'AAAA'; },
        rows => { rows[3].task = 2; },
        rows => { rows[3].load = 2; },
        rows => { rows[3].image = 'missing'; },
        rows => { rows[3].destination = 0x0000; },
        rows => { rows[3].length = 7; },
        rows => { rows[3].count = 257; },
        rows => { rows[3].source = 3; },
        rows => { rows[3].skip = 4096; },
        rows => { rows[3].rspPC = 3; },
      ]) {
        const changed = structuredClone(records); mutate(changed);
        const bytes = gzipSync(changed.map(row => JSON.stringify(row)).join('\n') + '\n');
        await writeFile(path, bytes);
        await expect(collect(directory, { ...capture.snapshot(), bytes: bytes.length })).rejects.toThrow();
      }
      await writeFile(path, original);
      await expect(collect(directory, { ...capture.snapshot(), loads: 2 })).rejects.toThrow('Instruction capture counts');
      // The task-only API also rejects corrupt instruction data after task 1.
      await expect(collect(directory, { ...capture.snapshot(), instructionImages: 2 })).rejects.toThrow('Instruction capture counts');
    }, { instructionLoads: true });
  });

  test('publishes only flushed instruction observations and rejects orphan loads', async () => {
    await withCapture(async ({ directory, capture, observe, saveReport }) => {
      expect(() => capture.observeInstructionLoad(instructionLoad(), when)).toThrow('Invalid instruction DMA');
      observe(taskImage().snapshot());
      capture.observeInstructionLoad(instructionLoad(), when);
      await saveReport();
      capture.observeInstructionLoad(instructionLoad(1, 9), when);
      await appendFile(join(directory, captureFile), 'unpublished tail');
      const replay = await replayAudioCapture(directory);
      expect(replay.instructionLoads.loads).toBe(1);
      expect(replay.instructionLoads.images).toHaveLength(1);
    }, { instructionLoads: true });
  });
});
