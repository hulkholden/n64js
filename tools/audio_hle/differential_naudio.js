#!/usr/bin/env bun
// Synthetic inputs executed by the captured RSP handlers, never another HLE.
import { createReplay } from './rsp_replay.js';
import { getAudioHLEClass } from '../../src/hle/hle_audio.js';
import { createAudioMicrocodeClassifier } from '../../src/hle/audio_microcode_classifier.js';

const prefix = Bun.argv[2];
if (!prefix) throw new Error('Usage: bun tools/audio_hle/differential_naudio.js <capture-prefix>');
const read = async key => new Uint8Array(await Bun.file(`${prefix}-${key}.bin`).arrayBuffer());
const code = await read('code'), constants = await read('data');
const identity = createAudioMicrocodeClassifier()({ task: await read('task'), imem: await read('imem'), code, data: constants });
if (identity.family !== 'NAUDIO') throw new Error('Expected reviewed NAudio');
const Audio = getAudioHLEClass(identity.identity);
const returnPC = identity.identity === 'naudio-donkey-kong-64' ? 0xe8
  : identity.identity === 'naudio-banjo-kazooie' ? 0xf0 : 0xec;
const imem = new Uint8Array(4096);
imem.set(code.subarray(0, 0xf80), 0x80);
let seed = 73537;
const random = () => seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
const randomBytes = length => Uint8Array.from({ length }, () => random() >>> 24);
const ops = [1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14, 15];
if (identity.identity === 'naudio-donkey-kong-64') ops.push(7, 8);
let cases = 0;
for (let trial = 0; trial < 1000; trial++) {
  for (const op of ops) {
    const dmem = randomBytes(4096), ram = randomBytes(0x4000);
    dmem.set(constants.subarray(0, 0x2b0));
    const view = new DataView(dmem.buffer);
    const flags = trial % 4;
    let w0 = (op << 24), w1 = 0;
    switch (op) {
      case 1: {
        const count = [0, 1, 31, 32, 33, 128, 368][trial % 7];
        const inputOffset = trial % 16;
        view.setUint32(0xe, 0x1100);
        w0 |= 0x1000;
        w1 = (flags << 28) | (count << 16) | (inputOffset << 12) | 0x210;
        for (let i = 0; i < 12; i++) dmem[0x4f0 + inputOffset + i * 9] &= 0xf7;
        break;
      }
      case 2: w0 |= trial % 16; w1 = trial % 65; break;
      case 3:
        w0 |= (flags << 16) | (random() & 0xffff); w1 = 0x1000;
        break;
      case 4:
      case 6: w0 |= ((trial % 65) << 12) | (trial % 16); w1 = 0x1000 + trial % 8; break;
      case 5: {
        // Two fixed outputs, all fractional phases, INIT and continuation.
        const pitch = random() & 0xffff;
        w0 |= 0x1000;
        w1 = ((trial % 4) << 30) | (pitch << 14) | (0x300 << 2) | (trial % 4);
        break;
      }
      case 9: w0 |= ((trial % 8) << 16) | (random() & 0xffff); w1 = random(); break;
      case 10: w0 |= trial % 16; w1 = ((trial % 3 ? 16 : 0) << 16) | (trial % 65); break;
      case 11: w0 |= 1 + trial % 256; w1 = 0x1000 + trial % 8; break;
      case 7:
      case 8:
      case 12: w0 |= random() & 0xffff; w1 = trial % 3 ? 0x03000600 : 0x03000300; break;
      case 13: break;
      case 14: w0 |= random() & 0xffff; w1 = random(); break;
      case 15: w1 = random(); break;
    }
    const { rsp } = createReplay({ ram, dmem, imem });
    rsp.pc = view.getUint16(op * 2) & 4095;
    rsp.gprU32[24] = 0xfa0;
    rsp.gprU32[26] = w0;
    rsp.gprU32[25] = w1;
    const scalar = random();
    rsp.gprU32[2] = scalar;
    const hle = new Audio(ram.slice(), dmem);
    hle.scalarV0 = scalar;
    hle.execute(w0, w1);
    let steps = 0;
    while (rsp.pc !== returnPC && !rsp.halted && steps++ < 100_000) rsp.step();
    if (steps >= 100_000 || rsp.halted) throw new Error(`RSP failed to return: ${trial}, ${op}`);
    const compare = (space, expected, actual, start, end) => {
      for (let p = start; p < end; p++) if (expected[p] !== actual[p]) {
        throw new Error(JSON.stringify({ trial, op, w0: w0.toString(16), w1: w1.toString(16), space,
          address: p.toString(16), expected: expected[p], actual: actual[p] }));
      }
    };
    if ((hle.scalarV0 >>> 0) !== rsp.gprU32[2]) throw new Error(`v0 ${trial}/${op}: RSP ${rsp.gprU32[2]}, HLE ${hle.scalarV0}`);
    compare('loop', rsp.dmem.u8, hle.dmem, 0xe, 0x12);
    compare('audio', rsp.dmem.u8, hle.dmem, 0x3f0, 0xfa0);
    compare('parameters', rsp.dmem.u8, hle.dmem, 0xfe0, 0xff2);
    compare('RDRAM', ram, hle.ram, 0, ram.length);
    cases++;
  }
}
console.log(`${identity.identity}: ${cases} synthetic command comparisons passed`);
