#!/usr/bin/env bun
import { createReplay } from './rsp_replay.js';
import { getAudioHLEClass } from '../../src/hle/hle_audio.js';
import { createAudioMicrocodeClassifier } from '../../src/hle/audio_microcode_classifier.js';

const prefix = Bun.argv[2];
if (!prefix) throw new Error('Usage: bun tools/audio_hle/differential.js <capture-prefix>');
const read = async key => new Uint8Array(await Bun.file(`${prefix}-${key}.bin`).arrayBuffer());
const code = await read('code'), constants = await read('data');
const identity = createAudioMicrocodeClassifier()({ task: await read('task'), imem: await read('imem'), code, data: constants });
const Audio = getAudioHLEClass(identity.identity);
if (!Audio) throw new Error('Expected a supported audio program');

let seed = 73537;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed;
};
const randomBytes = length => Uint8Array.from({ length }, () => random() >>> 24);
const imem = new Uint8Array(4096);
imem.set(code.subarray(0, 0xf80), 0x80);

for (let trial = 0; trial < 1000; trial++) {
  for (const op of [1, 3, 5, 12, 14]) {
    const dmem = randomBytes(4096), ram = randomBytes(0x4000);
    dmem.set(constants.subarray(0, 0x2c0));
    dmem.fill(0, 0x320, 0x360);
    const view = new DataView(dmem.buffer), ramView = new DataView(ram.buffer);
    const set = (p, value) => view.setUint16(p, value);
    const count = [32, 48, 64, 80, 128][trial % 5];
    set(0x360, 0x600); set(0x362, 0x900); set(0x364, count);
    set(0x36a, 0xa00); set(0x36c, 0xb00); set(0x36e, 0xc00);
    const flags = op === 3 ? (trial % 2) | ((trial & 2) << 2) : trial % 4;
    let w0 = (op << 24) | (flags << 16) | (random() & 0xffff);
    const w1 = op === 12 ? 0x00400340 : 0x1000;
    if (op === 1) {
      view.setUint32(0x370, 0x1100); // Loop history separate from output state.
      w0 = (op << 24) | (flags << 16);
      for (let i = 0; i < 8; i++) dmem[0x600 + i * 9] &= 0xf7;
    }
    if (op === 5) {
      // Legal saved alignment for OUT; random fractions exercise all phases.
      ramView.setUint16(0x100a, (trial % 8) * 2);
      set(0xf9a, (trial % 8) * 2);
    }
    if (op === 3) {
      for (const offset of [0x370, 0x376]) {
        set(offset, random() & 0x7fff);
        set(offset + 2, trial % 3 === 0 ? 0 : 1);
        set(offset + 4, random() & 0xffff);
      }
      set(0x366, random() & 0x7fff); set(0x368, random() & 0x7fff);
      // Continued state: positive envelopes with increasing/decreasing rates.
      for (let i = 0; i < 32; i++) ramView.setUint16(0x1000 + i * 2, random() & 0x7fff);
      for (const offset of [0x1040, 0x1046]) {
        ramView.setUint16(offset, random() & 0x7fff);
        ramView.setUint16(offset + 2, trial % 3 === 0 ? 0 : 1);
        ramView.setUint16(offset + 4, random() & 0xffff);
      }
    }
    const { rsp } = createReplay({ ram, dmem, imem });
    rsp.pc = view.getUint16(0x10 + op * 2) & 4095;
    rsp.gprU32[24] = 0x360;
    rsp.gprU32[23] = 0xf90;
    rsp.gprU32[26] = w0;
    rsp.gprU32[25] = w1;
    const hle = new Audio(ram.slice(), dmem);
    hle.execute(w0, w1);
    let steps = 0;
    while (rsp.pc !== 0x118 && !rsp.halted && steps++ < 100_000) rsp.step();
    if (steps >= 100_000 || rsp.halted) throw new Error('RSP did not return to dispatch');
    const compare = (space, expected, actual, start, end) => {
      for (let p = start; p < end; p++) if (expected[p] !== actual[p]) {
        throw new Error(JSON.stringify({ trial, op, w0: w0.toString(16), space,
          address: p.toString(16), expected: expected[p], actual: actual[p] }));
      }
    };
    compare('DMEM parameters', rsp.dmem.u8, hle.dmem, 0x320, 0x380);
    compare('DMEM audio', rsp.dmem.u8, hle.dmem, 0x4c0, 0xf90);
    compare('RDRAM', ram, hle.ram, 0, ram.length);
  }
}
console.log(`${identity.identity}: 5000 DSP trials passed`);
