#!/usr/bin/env bun
// Local ROM research artifacts only: never check captures or disassembly into git.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createHeadlessEmulator, loadROMFile } from '../../src/headless/headless_env.js';
import { captureAudioTask, classifyAudioTask } from '../../src/hle/hle_audio.js';
import { disassembleRemappedRange } from '../../src/rsp/disassemble_rsp.js';
import { MemoryRegion } from '../../src/memory/memory_region.js';

const [romPath, directory, frameArg = '600', intervalArg = '50', inputPath] = Bun.argv.slice(2);
const frames = Number(frameArg), interval = Number(intervalArg);
if (!romPath || !directory || !Number.isSafeInteger(frames) || frames <= 0 || !Number.isSafeInteger(interval) || interval <= 0) {
  throw new Error('Usage: bun tools/audio_hle/capture.js <rom> <output-directory> [VI-frames=600] [sample-every=50] [input.json]');
}
// Optional input events: [{frame: 700, buttons: 4096}, {frame: 708, buttons: 0}].
const inputs = inputPath ? await Bun.file(inputPath).json() : [];
if (!Array.isArray(inputs) || inputs.some(e => !Number.isSafeInteger(e.frame) || e.frame < 0 || !Number.isInteger(e.buttons) || e.buttons < 0 || e.buttons > 65535)) {
  throw new Error('Invalid input events');
}
inputs.sort((a, b) => a.frame - b.frame);
mkdirSync(directory, { recursive: true });
const loaded = await loadROMFile(romPath);
const report = { rom: loaded.rominfo, romSha256: createHash('sha256').update(new Uint8Array(loaded.romBuffer)).digest('hex'), framesRequested: frames, inputs, captures: [], opcodes: {}, tasks: 0 };
const seenCommands = new Set(), seenPrograms = new Set();
let emulator, nextInput = 0;
emulator = await createHeadlessEmulator(loaded, {
  executeGraphics: true,
  onVerticalBlank(frame) {
    while (nextInput < inputs.length && inputs[nextInput].frame <= frame) emulator.inputs[0].buttons = inputs[nextInput++].buttons;
  },
  onAudioTask() {
    const hardware = emulator.hardware, raw = captureAudioTask(hardware), classification = classifyAudioTask(hardware, raw);
    const task = new DataView(raw.task.buffer), ram = hardware.ram.u8;
    const address = task.getUint32(0x30) & 0x1fffffff, size = task.getUint32(0x34);
    if (!size || size % 8 || address + size > ram.length) throw new Error('Invalid audio list');
    const list = new DataView(ram.buffer, ram.byteOffset + address, size);
    let capture = ++report.tasks % interval === 0;
    for (let p = 0; p < size; p += 8) {
      const opcode = list.getUint32(p) >>> 24, key = list.getUint32(p) >>> 16;
      report.opcodes[opcode] = (report.opcodes[opcode] ?? 0) + 1;
      if (!seenCommands.has(key)) { seenCommands.add(key); capture = true; }
    }
    if (!capture) return;
    const prefix = join(directory, String(report.tasks));
    for (const [key, bytes] of Object.entries({ ...raw, ram, vectors: new Uint8Array(hardware.rsp.vpr.buffer), dmem: hardware.sp_mem.u8.subarray(0, 4096) })) {
      writeFileSync(`${prefix}-${key}.bin`, bytes);
    }
    const commands = Array.from({ length: size / 8 }, (_, i) => ({ offset: i * 8, opcode: list.getUint32(i * 8) >>> 24,
      w0: list.getUint32(i * 8).toString(16).padStart(8, '0'), w1: list.getUint32(i * 8 + 4).toString(16).padStart(8, '0') }));
    writeFileSync(`${prefix}-commands.json`, JSON.stringify(commands, null, 2));
    if (!seenPrograms.has(classification.identity)) {
      const mem = new MemoryRegion(raw.code.buffer);
      const direct = classification.bootstrap === 'direct-imem';
      const disassembly = disassembleRemappedRange(mem, direct ? 0x1000 : 0x1080, 0, direct ? 0x1000 : 0xf80);
      writeFileSync(`${prefix}-disassembly.txt`, disassembly.map(d => `${d.address.toString(16)} ${d.disassembly}`).join('\n'));
      seenPrograms.add(classification.identity);
    }
    report.captures.push({ prefix, frame: hardware.verticalBlankCount, classification, commands: size / 8 });
  },
});
const maxCycles = frames * 5_000_000 + 100_000_000;
while (emulator.hardware.verticalBlankCount < frames && emulator.cpu0.getOpsExecuted() < maxCycles && !emulator.fatalError()) {
  emulator.cpu0.run(10_000_000);
  await Bun.sleep(0);
}
Object.assign(report, { frames: emulator.hardware.verticalBlankCount, cycles: emulator.cpu0.getOpsExecuted(), fatalError: emulator.fatalError() });
writeFileSync(join(directory, 'capture.json'), JSON.stringify(report, null, 2));
if (report.fatalError || report.frames < frames) throw new Error(report.fatalError ?? 'Cycle limit reached');
console.log(JSON.stringify({ tasks: report.tasks, captures: report.captures.length, frames: report.frames, opcodes: report.opcodes }));
