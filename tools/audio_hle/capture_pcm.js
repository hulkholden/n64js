#!/usr/bin/env bun
// Record the live AI stream from a fresh boot. Compare independent HLE and LLE
// runs: a task-start RAM snapshot cannot reproduce concurrent CPU/PI writes.
import { closeSync, openSync, writeFileSync, writeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createHeadlessEmulator, loadROMFile } from '../../src/headless/headless_env.js';
import { SP_STATUS_BROKE } from '../../src/devices/sp_constants.js';
import { audioOptions } from '../../src/hle/audio_options.js';
import { TASK_OFFSET, TASK_SIZE, TASK_ADDRESS_MASK, TaskOffsets } from '../../src/hle/rsp_task_constants.js';

const [romPath, mode, frameArg, prefix, inputPath] = Bun.argv.slice(2);
const frames = Number(frameArg);
if (!romPath || !['HLE', 'LLE'].includes(mode) || !Number.isSafeInteger(frames) || frames <= 0 || !prefix) {
  throw new Error('Usage: bun tools/audio_hle/capture_pcm.js <rom> <HLE|LLE> <VI-frames> <output-prefix> [input.json]');
}
const inputs = inputPath ? await Bun.file(inputPath).json() : [];
if (!Array.isArray(inputs) || inputs.some(e => !Number.isSafeInteger(e.frame) || e.frame < 0 || !Number.isInteger(e.buttons) || e.buttons < 0 || e.buttons > 65535)) {
  throw new Error('Invalid input events');
}
inputs.sort((a, b) => a.frame - b.frame);

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const pcmHash = createHash('sha256');
const report = { mode, tasks: [], blocks: [], pcmBytes: 0, nonzeroSamples: 0, fallbackTasks: 0 };
let emulator, pending = null, nextInput = 0;
audioOptions.emulationMode = mode;
emulator = await createHeadlessEmulator(await loadROMFile(romPath), {
  executeGraphics: true,
  onVerticalBlank(frame) {
    while (nextInput < inputs.length && inputs[nextInput].frame <= frame) emulator.inputs[0].buttons = inputs[nextInput++].buttons;
  },
  onAudioTask(info) {
    if (pending) throw new Error('Audio task started before its predecessor completed');
    const h = emulator.hardware, task = new DataView(h.sp_mem.u8.buffer, TASK_OFFSET, TASK_SIZE);
    const address = task.getUint32(TaskOffsets.dataPtr) & TASK_ADDRESS_MASK;
    const size = task.getUint32(TaskOffsets.dataSize);
    pending = { frame: h.verticalBlankCount, identity: info.identity, address, size,
      hash: hash(h.ram.u8.subarray(address, address + size)), lle: false,
      piBusy: h.piRegDevice.busy(), piDMAGeneration: h.piRegDevice.dmaGeneration };
    report.tasks.push(pending);
  },
});

const h = emulator.hardware;
const unhalt = h.rsp.unhalt.bind(h.rsp);
h.rsp.unhalt = () => {
  if (pending && !pending.lle) {
    pending.lle = true;
    if (mode === 'HLE') report.fallbackTasks++;
  }
  unhalt();
};
const status = h.spRegDevice.setStatusBits.bind(h.spRegDevice);
h.spRegDevice.setStatusBits = bits => {
  if (bits & SP_STATUS_BROKE) pending = null;
  status(bits);
};

const ai = h.aiRegDevice, playback = ai.startPlayback.bind(ai);
const fd = openSync(`${prefix}.pcm`, 'w');
ai.startPlayback = () => {
  const address = ai.dmaAddresses[0], length = ai.dmaLengths[0];
  const bytes = h.ram.u8.subarray(address, address + length);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let p = 0; p < length; p += 2) if (view.getInt16(p)) report.nonzeroSamples++;
  writeSync(fd, bytes);
  pcmHash.update(bytes);
  report.pcmBytes += length;
  report.blocks.push({ frame: h.verticalBlankCount, task: report.tasks.length,
    address, length, frequency: ai.frequency, hash: hash(bytes) });
  playback();
};

try {
  while (h.verticalBlankCount < frames && emulator.cpu0.getOpsExecuted() < frames * 5_000_000 + 100_000_000 && !emulator.fatalError()) {
    emulator.cpu0.run(10_000_000);
    await Bun.sleep(0);
  }
} finally {
  closeSync(fd);
}
if (emulator.fatalError() || h.verticalBlankCount < frames) throw new Error(emulator.fatalError() ?? 'Cycle limit reached');
if (pending || !report.tasks.length || !report.blocks.length) throw new Error('Incomplete audio capture');
report.frames = h.verticalBlankCount;
report.pcmSha256 = pcmHash.digest('hex');
writeFileSync(`${prefix}.json`, JSON.stringify(report));
console.log(JSON.stringify({ ...report, tasks: report.tasks.length, blocks: report.blocks.length }));
