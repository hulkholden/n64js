#!/usr/bin/env bun
// Compare the live HLE result with an isolated execution of each original RSP
// task. This verifies the real SP completion path as well as DSP output.
import { createHash } from 'node:crypto';
import { createHeadlessEmulator, loadROMFile } from '../../src/headless/headless_env.js';
import { audioOptions } from '../../src/hle/audio_options.js';
import { getAudioHLEClass } from '../../src/hle/hle_audio.js';
import { initRSP } from '../../src/rsp/rsp.js';
import { createReplay } from './rsp_replay.js';

const [romPath, frameArg = '600', inputPath] = Bun.argv.slice(2);
const frames = Number(frameArg);
if (!romPath || !Number.isSafeInteger(frames) || frames <= 0) {
  throw new Error('Usage: bun tools/audio_hle/validate_rom.js <rom> [VI-frames=600] [input.json]');
}
const inputs = inputPath ? await Bun.file(inputPath).json() : [];
if (!Array.isArray(inputs) || inputs.some(e => !Number.isSafeInteger(e.frame) || e.frame < 0 || !Number.isInteger(e.buttons) || e.buttons < 0 || e.buttons > 65535)) {
  throw new Error('Invalid input events');
}
inputs.sort((a, b) => a.frame - b.frame);
const pcmHash = createHash('sha256');
const results = { tasks: 0, checked: 0, fallbackTasks: 0, oracleInstructions: 0, pcmBytes: 0, nonzeroBytes: 0 };
let emulator, pending = null, nextInput = 0;
audioOptions.emulationMode = 'HLE';
emulator = await createHeadlessEmulator(await loadROMFile(romPath), {
  executeGraphics: true,
  onVerticalBlank(frame) {
    while (nextInput < inputs.length && inputs[nextInput].frame <= frame) emulator.inputs[0].buttons = inputs[nextInput++].buttons;
  },
  onAudioTask(info) {
    if (pending) throw new Error('Audio task started before previous task completed');
    if (!getAudioHLEClass(info.identity)) throw new Error(`Unreviewed identity: ${info.identity}`);
    results.tasks++;
    const h = emulator.hardware;
    const oracle = createReplay({ ram: h.ram.u8.slice(), dmem: h.sp_mem.u8.slice(0, 4096), imem: h.sp_mem.u8.slice(4096) });
    try {
      let instructions = 0;
      while (!oracle.rsp.halted && instructions++ < 10_000_000) oracle.rsp.step();
      if (!oracle.rsp.halted) throw new Error('RSP instruction budget exhausted');
      results.oracleInstructions += instructions;
      pending = { ...oracle, liveInstructions: 0 };
    } finally {
      // n64js's RSP interpreter has a module-global active instance.
      initRSP(h);
    }
  },
});
const hardware = emulator.hardware;
const step = hardware.rsp.step.bind(hardware.rsp);
hardware.rsp.step = () => {
  if (pending) pending.liveInstructions++;
  step();
};
const status = hardware.spRegDevice.setStatusBits.bind(hardware.spRegDevice);
hardware.spRegDevice.setStatusBits = bits => {
  if (pending && (bits & 0x200)) {
    for (const { address, size } of pending.writes) {
      for (let p = address; p < address + size; p++) if (hardware.ram.u8[p] !== pending.ram[p]) {
        throw new Error(`Task ${results.tasks}, RDRAM ${p.toString(16)}: RSP ${pending.ram[p]}, HLE ${hardware.ram.u8[p]}`);
      }
    }
    if (pending.liveInstructions) results.fallbackTasks++;
    results.checked++;
    pending = null;
  }
  status(bits);
};
const ai = hardware.aiRegDevice, playback = ai.startPlayback.bind(ai);
ai.startPlayback = () => {
  const address = ai.dmaAddresses[0], length = ai.dmaLengths[0];
  const bytes = hardware.ram.u8.subarray(address, address + length);
  results.pcmBytes += bytes.length;
  for (const byte of bytes) if (byte) results.nonzeroBytes++;
  pcmHash.update(bytes);
  playback();
};
while (hardware.verticalBlankCount < frames && emulator.cpu0.getOpsExecuted() < frames * 5_000_000 + 100_000_000 && !emulator.fatalError()) {
  emulator.cpu0.run(10_000_000);
  await Bun.sleep(0);
}
if (emulator.fatalError() || hardware.verticalBlankCount < frames) throw new Error(emulator.fatalError() ?? 'Cycle limit reached');
if (pending || !results.tasks || results.checked !== results.tasks || results.fallbackTasks) throw new Error(`Incomplete HLE validation: ${JSON.stringify(results)}`);
console.log(JSON.stringify({ ...results, frames: hardware.verticalBlankCount, pcmSha256: pcmHash.digest('hex') }));
