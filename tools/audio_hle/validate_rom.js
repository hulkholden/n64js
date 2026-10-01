#!/usr/bin/env bun
// Compare the live HLE result with an isolated execution of each original RSP
// task. This verifies the real SP completion path as well as DSP output.
// The oracle freezes RAM at task start, so it cannot validate concurrent CPU/PI
// writes. Use capture_pcm.js for independent, from-reset HLE/LLE comparisons.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createHeadlessEmulator, loadROMFile } from '../../src/headless/headless_env.js';
import { audioOptions } from '../../src/hle/audio_options.js';
import { captureAudioTask, classifyAudioTask, getAudioHLEClass } from '../../src/hle/hle_audio.js';
import { SP_STATUS_REG, SP_STATUS_SIG0 } from '../../src/devices/sp_constants.js';
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
const results = { yieldRequests: 0, tasks: 0, checked: 0, fallbackTasks: 0, oracleInstructions: 0, pcmBytes: 0, nonzeroBytes: 0 };
let emulator, pending = null, nextInput = 0;
audioOptions.emulationMode = 'HLE';
emulator = await createHeadlessEmulator(await loadROMFile(romPath), {
  executeGraphics: true,
  onVerticalBlank(frame) {
    while (nextInput < inputs.length && inputs[nextInput].frame <= frame) emulator.inputs[0].buttons = inputs[nextInput++].buttons;
  },
  onAudioTask(info) {
    if (pending) throw new Error(`Audio task started before previous task completed: ${JSON.stringify(pending.meta)}`);
    if (!getAudioHLEClass(info.identity)) throw new Error(`Unreviewed identity: ${info.identity}`);
    const h = emulator.hardware;
    if ((h.spRegDevice.readRegU32(SP_STATUS_REG) & SP_STATUS_SIG0) && classifyAudioTask(h).bootstrap !== 'direct-imem') {
      results.yieldRequests++;
      return;
    }
    results.tasks++;
    const oracle = createReplay({ ram: h.ram.u8.slice(), dmem: h.sp_mem.u8.slice(0, 4096), imem: h.sp_mem.u8.slice(4096), vectors: new Uint8Array(h.rsp.vpr.buffer).slice() });
    try {
      let instructions = 0;
      while (!oracle.rsp.halted && instructions++ < 10_000_000) oracle.rsp.step();
      if (!oracle.rsp.halted) throw new Error('RSP instruction budget exhausted');
      results.oracleInstructions += instructions;
      pending = { ...oracle, liveInstructions: 0, meta: {frame:h.verticalBlankCount, task:results.tasks, spStatus:h.spRegDevice.readRegU32(SP_STATUS_REG), pc:h.rsp.pc, words:Array.from({length:16}, (_,i)=>h.sp_mem.getU32(0xfc0+i*4).toString(16))} };
    } finally {
      // n64js's RSP interpreter has a module-global active instance.
      initRSP(h);
    }
  },
});
const hardware = emulator.hardware;
const unhalt = hardware.rsp.unhalt.bind(hardware.rsp);
hardware.rsp.unhalt = () => {
  if (pending && process.env.N64JS_AUDIO_FAILURE_DIR) {
    const directory = process.env.N64JS_AUDIO_FAILURE_DIR;
    mkdirSync(directory, { recursive: true });
    const raw = captureAudioTask(hardware);
    for (const [key, value] of Object.entries({ ...raw, ram: hardware.ram.u8, dmem: hardware.sp_mem.u8.subarray(0, 4096), vectors: new Uint8Array(hardware.rsp.vpr.buffer) })) {
      writeFileSync(`${directory}/failure-${key}.bin`, value);
    }
    throw new Error(`Unexpected LLE fallback: ${JSON.stringify(pending.meta)}`);
  }
  unhalt();
};
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
