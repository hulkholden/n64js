#!/usr/bin/env bun
import { readCapture } from './replay.js';
import { classifyAudioTask, hleProcessAudioTask } from '../../src/hle/hle_audio.js';

const prefix = Bun.argv[2];
if (!prefix) throw new Error('Usage: bun tools/audio_hle/fallbacks.js <capture-prefix>');
const raw = await readCapture(prefix);
const sp = new Uint8Array(8192);
let semaphoreWrites = 0, spStatus = 0;
const hardware = { ram: { u8: raw.ram.slice() }, sp_mem: { u8: sp }, rsp: { pc: 0 },
  dpcDevice: { statusReg: 0 }, spRegDevice: { readRegU32: () => spStatus, writeReg32() { semaphoreWrites++; } } };
function restoreTask() {
  hardware.ram.u8.set(raw.ram);
  sp.set(raw.dmem); sp.set(raw.imem, 4096);
  hardware.rsp.pc = 0;
  hardware.dpcDevice.statusReg = 0;
  semaphoreWrites = 0;
  spStatus = 0;
}
restoreTask();
const identity = classifyAudioTask(hardware);
const naudio = identity.family === 'NAUDIO';
if (!hleProcessAudioTask(hardware)) throw new Error('Expected a supported capture');
const expected = hardware.ram.u8.slice();
const cases = [
  ['yield', h => { if (naudio) spStatus = 0x80; else new DataView(h.sp_mem.u8.buffer).setUint32(0xfc4, 1); }],
  ['entry', h => { h.rsp.pc = 4; }],
  ...(!naudio ? [['unknown task flag', h => new DataView(h.sp_mem.u8.buffer).setUint32(0xfc4, 4)]] : [
    ['busy XBUS', h => { new DataView(h.sp_mem.u8.buffer).setUint32(0xfc4, 0); h.dpcDevice.statusReg = 0x101; }],
    ['unknown SP status', () => { spStatus = undefined; }],
  ]),
  ['DP wait while busy', h => {
    new DataView(h.sp_mem.u8.buffer).setUint32(0xfc4, 2);
    h.dpcDevice.statusReg = 0x100;
  }],
  ['DP wait without status', h => {
    new DataView(h.sp_mem.u8.buffer).setUint32(0xfc4, 2);
    h.dpcDevice.statusReg = undefined;
  }],
  ['code mutation', (h, t) => { h.ram.u8[(t.getUint32(0x10) & 0x1fffffff) + 0x200] ^= 1; }],
  ['constants mutation', (h, t) => { h.ram.u8[(t.getUint32(0x18) & 0x1fffffff) + 0x2af] ^= 1; }],
  ['empty list', (h, t) => t.setUint32(0x34, 0)],
  ['unaligned list', (h, t) => t.setUint32(0x30, t.getUint32(0x30) + 1)],
  ['bad opcode', (h, t) => new DataView(h.ram.u8.buffer).setUint32(t.getUint32(0x30) & 0x1fffffff, 0xff000000)],
  ['rollback after save', (h, t) => {
    const v = new DataView(h.ram.u8.buffer), p = t.getUint32(0x30) & 0x1fffffff;
    // A real store must be undone if a later command cannot be handled.
    const words = naudio ? [0x06010000, 0x00001000, 0xff000000, 0]
      : [0x08000000, 0x00000010, 0x06000000, 0x00001000, 0xff000000, 0];
    words.forEach((w, i) => v.setUint32(p + i * 4, w));
  }],
];
for (const [name, mutate] of cases) {
  restoreTask();
  mutate(hardware, new DataView(sp.buffer, 0xfc0, 64));
  const beforeRam = hardware.ram.u8.slice(), beforeSP = sp.slice();
  if (hleProcessAudioTask(hardware) || semaphoreWrites || Buffer.compare(beforeRam, hardware.ram.u8) || Buffer.compare(beforeSP, sp)) {
    throw new Error(`Fallback modified machine state: ${name}`);
  }
  restoreTask();
  if (!hleProcessAudioTask(hardware) || semaphoreWrites !== 1 || Buffer.compare(expected, hardware.ram.u8)) {
    throw new Error(`Task reuse after fallback failed: ${name}`);
  }
}
console.log(`${cases.length} atomic fallback and task reuse cases passed`);
restoreTask();
new DataView(sp.buffer).setUint32(0xfc4, 2);
const beforeRam = hardware.ram.u8.slice(), beforeSP = sp.slice();
const handled = hleProcessAudioTask(hardware);
if (identity.bootstrap === 'rspboot-208' || naudio) {
  if (!handled || semaphoreWrites !== 1 || Buffer.compare(expected, hardware.ram.u8)) {
    throw new Error('Idle DP wait changed task output');
  }
  console.log('Idle reviewed bootstrap DP wait passed');
} else if (handled || semaphoreWrites || Buffer.compare(beforeRam, hardware.ram.u8) || Buffer.compare(beforeSP, sp)) {
  throw new Error('Unreviewed bootstrap DP wait did not fall back atomically');
} else {
  console.log('Unreviewed bootstrap DP wait fell back atomically');
}

if (naudio) {
  for (const flags of [1, 4, 0x8066f084]) {
    restoreTask();
    new DataView(sp.buffer).setUint32(0xfc4, flags);
    hardware.dpcDevice.statusReg = 0x100; // DMA busy alone does not wait.
    if (!hleProcessAudioTask(hardware) || Buffer.compare(expected, hardware.ram.u8)) {
      throw new Error('Ignored task flags or non-XBUS DMA changed NAudio output');
    }
  }
  console.log('Ignored flags and non-XBUS DMA busy passed');
}
