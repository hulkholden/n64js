#!/usr/bin/env bun
// Random command inputs run against the captured program's actual RSP handlers.
import { createReplay } from './rsp_replay.js';
import { getAudioHLEClass } from '../../src/hle/hle_audio.js';
import { createAudioMicrocodeClassifier } from '../../src/hle/audio_microcode_classifier.js';

const prefix = Bun.argv[2], trials = Number(Bun.argv[3] ?? 300);
if (!prefix) throw new Error('Usage: bun tools/audio_hle/differential_nead.js <capture-prefix> [trials=300]');
const read = async name => new Uint8Array(await Bun.file(`${prefix}-${name}.bin`).arrayBuffer());
const code = await read('code'), data = await read('data');
const identity = createAudioMicrocodeClassifier()({ task: await read('task'), imem: await read('imem'), code, data });
const Audio = getAudioHLEClass(identity.identity);
const direct = identity.bootstrap === 'direct-imem', kart = identity.identity === 'nead-mario-kart';
const fzero = identity.identity === 'nead-f-zero';
const oldInterleave = kart || identity.identity.startsWith('nead-star-fox');
const returnPCs = { 'nead-mario-kart': 0x118, 'nead-star-fox': 0x104, 'nead-star-fox-revision': 0x118,
  'nead-wave-race-shindou': 0x104, 'nead-mario-shindou': 0x104, 'nead-yoshi-story': 0x88,
  'nead-1080': 0x88, 'nead-ocarina': 0x8c, 'nead-majora-stadium': 0x94,
  'nead-animal-forest': 0x94, 'nead-f-zero': 0xa8 };
const returnPC = returnPCs[identity.identity];
const imem = new Uint8Array(4096);
imem.set(code.subarray(0, direct ? 4096 : 3968), direct ? 0 : 128);
let seed = 73537, cases = 0;
const random = () => seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
const randomBytes = size => Uint8Array.from({ length: size }, () => random() >>> 24);
const ops = [1, 2, 5, 8, 10, 11, 12, 13, 15, 16, 17, 19, 20, 21];
if (!kart) ops.push(4, 23);
if (!kart && !fzero) ops.push(6);
if (!kart && !direct) ops.push(24, 25, 26);
if (direct && !fzero) ops.push(9, 14);
if (kart || identity.identity.startsWith('nead-star-fox')) ops.push(14);
if (direct && !fzero) ops.push(7);
if (identity.identity.includes('shindou')) ops.push(27);
for (let trial = 0; trial < trials; trial++) {
  for (const op of ops) {
    const dmem = randomBytes(4096), ram = randomBytes(0x4000);
    dmem.set(data.subarray(0, direct ? 0x2e0 : 0x330));
    const a = new Audio(ram.slice(), dmem);
    a.view.setUint32(0x320, 0); // Mario Kart segment zero.
    const input = 0x600, output = 0x900, address = 0x2000;
    const count = [0, 1, 16, 31, 32, 64, 128][trial % 7];
    a.put16(a.parameters, input); a.put16(a.parameters + 2, output); a.put16(a.parameters + 4, count);
    a.view.setUint32(a.parameters + a.loopParameter, address + 0x100);
    for (let i = 0; i < 16; i++) a.dmem[input + i * (direct && !fzero && trial & 4 ? 5 : 9)] &= 0xf0 | (a.bookSize / 32 - 1);
    // Continuation history adjustment is constrained to a reviewed buffer range.
    new DataView(ram.buffer).setUint16(address + 10, 0);
    a.ram.set(ram);
    a.put16(a.scratch + 10, 0);
    const { rsp } = createReplay({ ram, dmem: a.dmem, imem });
    rsp.gprU32[24] = a.parameters; rsp.gprU32[23] = a.scratch;
    for (let i = 0; i < 8; i++) rsp.setVecS16(31, i, random());
    a.initializeTask(rsp);
    a.put16(a.parameters, input); a.put16(a.parameters + 2, output);
    rsp.dmem.set16(a.parameters, input); rsp.dmem.set16(a.parameters + 2, output);
    const run = (w0, w1) => {
      const opcode = w0 >>> 24;
      rsp.pc = new DataView(data.buffer).getUint16(16 + opcode * 2) & 4095;
      rsp.delayPC = 0;
      rsp.gprU32[26] = w0; rsp.gprU32[25] = w1;
      a.execute(w0, w1);
      let steps = 0;
      while (rsp.pc !== returnPC && !rsp.halted && steps++ < 100_000) rsp.step();
      if (rsp.halted || steps >= 100_000) throw new Error(`RSP failed to return: ${trial}/${opcode}`);
      const compare = (space, expected, actual, start, end) => {
        for (let p = start; p < end; p++) if (expected[p] !== actual[p]) throw new Error(JSON.stringify({
          trial, op: opcode, w0: w0.toString(16), w1: w1.toString(16), space, address: p.toString(16), expected: expected[p], actual: actual[p] }));
      };
      compare('samples', rsp.dmem.u8, a.dmem, a.book, a.scratch);
      compare('parameters', rsp.dmem.u8, a.dmem, a.parameters, a.parameters + (a.loopParameter === 8 ? 12 : 20));
      compare('RDRAM', ram, a.ram, 0, ram.length);
      cases++;
    };
    let w0 = op << 24, w1 = 0;
    const offset = p => p - a.bufferBase;
    switch (op) {
      case 1: w0 |= (trial % (direct && !fzero ? 8 : 4)) << 16; w1 = address; break;
      case 2: w0 |= offset(input) + trial % 8; w1 = count; break;
      case 4: w0 |= (Math.max(1, count) << 12); w1 = input << 16 | output; break;
      case 5:
        // Resampler count zero executes one vector on RSP; HLE deliberately rejects it.
        if (!count) { a.put16(a.parameters + 4, 16); rsp.dmem.set16(a.parameters + 4, 16); }
        w0 |= (trial % (kart ? 4 : 8) << 16) | (random() & 0xffff); w1 = address; break;
      case 7: case 27:
        run((op << 24) | (2 << 16) | count, address + 0x200);
        w0 |= (trial % 2 << 16) | input; w1 = address; break;
      case 8: w0 |= (trial % 16 << 16) | offset(input); w1 = offset(output) << 16 | count; break;
      case 10: w0 |= offset(input); w1 = offset(input + (trial % 3) * 16) << 16 | count; break;
      case 11: w0 |= 1 + trial % a.bookSize; w1 = address + trial % 8; break;
      case 12: w0 |= (count << 12) | (random() & 0xffff); w1 = offset(input) << 16 | offset(trial % 2 ? input - 16 : output); break;
      case 13: w0 |= ((count & ~15) << 12) | output; w1 = offset(input) << 16 | offset(input + 0x100); break;
      case 14:
        if (direct) { w0 |= (trial % 256 << 16) | count; w1 = input << 16; }
        else { w0 |= (trial % 2 << 16) | (random() & 0xffff); w1 = address; }
        break;
      case 6: w0 |= random() & 0xffff; w1 = random() & 0xffff; break;
      case 23: w0 |= trial % 4 << 16; w1 = address; break;
      case 24: w0 |= (trial % 256 << 16) | count; w1 = input << 16; break;
      case 25: w0 |= (trial % 8 * 2 << 16) | count; w1 = input << 16 | 0xc00; break;
      case 9: case 26: w0 |= (trial % 4 << 16) | input; w1 = output << 16; break;
      case 15: w1 = address; break;
      case 16: w0 |= (trial % 4 << 16) | offset(input); w1 = offset(output) << 16 | count; break;
      case 17: w0 |= count; w1 = offset(input) << 16 | offset(output); break;
      case 19:
        run(18 << 24 | random() & 0xffffff, random());
        run(22 << 24, random());
        w0 |= ((0x500 - a.bufferBase) << 12) | (count << 8) | trial % 32;
        w1 = ((0x700 - a.bufferBase) << 20) | ((0x900 - a.bufferBase) << 12) | ((0xb00 - a.bufferBase) << 4) | ((0xd00 - a.bufferBase) >>> 4);
        // Relative packed buffers require aligned offsets.
        if (kart) w0 = 19 << 24 | 0x100 << 12 | count << 8 | trial % 32;
        break;
      case 20: case 21: w0 |= (Math.max(16, count & ~15) << 12) | offset(input) + trial % 8; w1 = address + trial % 8; break;
    }
    if (op === 13 && oldInterleave) w0 = 13 << 24;
    run(w0, w1);
    if (op === 19) run(w0, w1);
  }
}
console.log(`${identity.identity}: ${cases} synthetic commands passed`);
