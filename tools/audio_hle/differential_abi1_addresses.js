#!/usr/bin/env bun
// Resolve addresses by executing each captured RSP handler, never another HLE.
import { createReplay } from './rsp_replay.js';
import { getAudioHLEClass } from '../../src/hle/hle_audio.js';
import { createAudioMicrocodeClassifier } from '../../src/hle/audio_microcode_classifier.js';

const prefix = Bun.argv[2];
if (!prefix) throw new Error('Usage: bun tools/audio_hle/differential_abi1_addresses.js <capture-prefix>');
const read = async key => new Uint8Array(await Bun.file(`${prefix}-${key}.bin`).arrayBuffer());
const code = await read('code'), data = await read('data');
const identity = createAudioMicrocodeClassifier()({ task: await read('task'), imem: await read('imem'), code, data });
if (identity.family !== 'ABI1') throw new Error('Expected a reviewed ABI1 program');
const Audio = getAudioHLEClass(identity.identity);
const DMEM_BYTES = 0x1000, RAM_BYTES = 0x4000;
const CODE_START = 0x80, RETURN_PC = 0x118, DISPATCH_TABLE = 0x10;
const SEGMENT_TABLE = 0x320, SEGMENT_BYTES = 4, PARAMS = 0x360, SCRATCH = 0xf90;
const INPUT = 0x800, OUTPUT = 0x900, COUNT = 16, RAM_TARGET = 0x1000;
const ADDRESS_MASK = 0xffffff;
const OP_LOAD = 4, OP_SAVE = 6, OP_BOOK = 11, OP_LOOP = 15;
const imem = new Uint8Array(DMEM_BYTES);
imem.set(code.subarray(0, DMEM_BYTES - CODE_START), CODE_START);
let cases = 0;
for (let segment = 0; segment < 256; segment++) {
  for (const base of [0, 0x800, 0xfffffff0, 0x80000000]) {
    for (const opcode of [OP_LOAD, OP_SAVE, OP_BOOK, OP_LOOP]) {
      const dmem = Uint8Array.from({ length: DMEM_BYTES }, (_, p) => p * 31 + segment);
      const ram = Uint8Array.from({ length: RAM_BYTES }, (_, p) => p * 17 + segment);
      dmem.set(data.subarray(0, SEGMENT_TABLE));
      const view = new DataView(dmem.buffer);
      view.setUint32(SEGMENT_TABLE + segment * SEGMENT_BYTES, base);
      // Some indices alias these live parameters. Preserve valid buffers and
      // use the resulting word as the actual base, just as the RSP does.
      view.setUint16(PARAMS, INPUT);
      view.setUint16(PARAMS + 2, OUTPUT);
      view.setUint16(PARAMS + 4, COUNT);
      const actualBase = view.getUint32(SEGMENT_TABLE + segment * SEGMENT_BYTES);
      const offset = (RAM_TARGET - actualBase) & ADDRESS_MASK;
      const w0 = opcode << 24 | (opcode === OP_BOOK ? COUNT : 0);
      const w1 = segment << 24 | offset;
      const { rsp } = createReplay({ ram, dmem, imem });
      rsp.pc = view.getUint16(DISPATCH_TABLE + opcode * 2) & (DMEM_BYTES - 1);
      rsp.gprU32[24] = PARAMS;
      rsp.gprU32[23] = SCRATCH;
      rsp.gprU32[26] = w0;
      rsp.gprU32[25] = w1;
      const hle = new Audio(ram.slice(), dmem);
      hle.execute(w0, w1);
      let steps = 0;
      while (rsp.pc !== RETURN_PC && !rsp.halted && steps++ < 10000) rsp.step();
      if (rsp.pc !== RETURN_PC || Buffer.compare(rsp.dmem.u8, hle.dmem) || Buffer.compare(ram, hle.ram)) {
        throw new Error(`Address mismatch: ${identity.identity}, segment ${segment}, base ${base.toString(16)}, opcode ${opcode}`);
      }
      cases++;
    }
  }
}
console.log(`${identity.identity}: ${cases} address comparisons passed`);
