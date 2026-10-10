import { describe, expect, test } from 'bun:test';
import { createHeadlessEmulator } from '../headless/headless_env.js';
import { RSP } from '../rsp/rsp.js';
import { GoldenEyeAudioStream } from './audio_goldeneye_stream.js';
import { SP_SET_HALT, SP_SET_SSTEP, SP_STATUS_REG } from '../devices/sp_constants.js';
import { performanceProfile, setPerformanceProfiling } from '../debug/performance_profile.js';

const vector = (fn, d, s, t, e = 0) => (0x4a000000 | e << 21 | t << 16 | s << 11 | d << 6 | fn) >>> 0;
const addiu = (t, s, n) => (0x24000000 | s << 21 | t << 16 | n & 0xffff) >>> 0;

async function fixture(profiled = false) {
  const e = await createHeadlessEmulator({ romBuffer: new ArrayBuffer(4096), rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' } });
  const h = e.hardware, r = h.rsp;
  h.sp_mem.clear();
  r.pc = 0x9d8;
  r.halted = false;
  r.setRegS32(18, 32);
  setPerformanceProfiling(profiled);
  r.setPerformanceProfiling(profiled);
  // Synthetic local computation at the reviewed block addresses. No game
  // executable is included. The real instruction stream is checked separately
  // by the ROM differential harness.
  const put = (pc, word) => h.sp_mem.set32(0x1000 + pc, word);
  put(0x9d8, addiu(8, 8, 1));
  put(0x9dc, 0xac080100); // SW t0, 0x100(zero)
  put(0xac0, addiu(18, 18, -16));
  put(0xac8, 0x1a400003); // BLEZ s2, 0xad8
  put(0xad0, 0x08000676); // J 0x19d8
  put(0xad8, 0x0000000d); // BREAK
  for (let v = 0; v < 4; v++) {
    put([0xa38, 0xa40, 0xa48, 0xa54][v], vector(0, 8 - v, 16 - v * 2, 15 - v * 2));
    put([0xa5c, 0xa64, 0xa6c, 0xa74][v], vector(0x10, 8 - v, 8 - v, 8 - v, 3));
    put([0xa7c, 0xa84, 0xa8c, 0xa94][v], vector(0x10, 8 - v, 8 - v, 8 - v, 6));
  }
  put(0xa9c, vector(6, 4, 29, 8, 4)); // VMUDN overwrites accumulator
  for (let i = 0; i < r.vprU32.length; i++) {
    r.vprU32[i] = Math.imul(i + 1, 0x9876543);
  }
  const stream = new GoldenEyeAudioStream(r, r.imem.u8.subarray(0x80));
  return { ...e, r, stream };
}

function snapshot(r) {
  return {
    pc: r.pc, delayPC: r.delayPC, nextPC: r.nextPC, branchTarget: r.branchTarget,
    gpr: [...r.gprU32], vectors: [...r.vprU32], accumulator: [...r.vAccU32],
    vco: r.VCO, vcc: r.VCC, vce: r.VCE, memory: [...r.hardware.sp_mem.u8],
  };
}

function restore(r, s) {
  r.gprU32.set(s.gpr); r.vprU32.set(s.vectors); r.vAccU32.set(s.accumulator);
  r.hardware.sp_mem.u8.set(s.memory);
  for (const k of ['pc', 'delayPC', 'nextPC', 'branchTarget']) {
    r[k] = s[k];
  }
  r.VCO = s.vco; r.VCC = s.vcc; r.VCE = s.vce;
}

for (const profiled of [false, true]) {
  describe(`GoldenEye local DSP scheduling (profiled=${profiled})`, () => {
    test('commits at the same instruction boundary, including the last loop iteration', async () => {
      const { r, stream } = await fixture(profiled);
      const before = snapshot(r);
      for (let i = 0; i < 126; i++) {
        RSP.prototype.step.call(r);
      }
      const reference = snapshot(r);
      restore(r, before);
      r.setAudioHLE(stream);
      for (let i = 0; i < 63; i++) {
        r.step();
      }
      expect(snapshot(r)).toEqual(before);
      r.step();
      expect(r.hardware.sp_mem.getU32(0x100)).toBe(1);
      for (let i = 0; i < 62; i++) {
        r.step();
      }
      expect(snapshot(r)).toEqual(reference);
      expect(r.pc).toBe(0xad8);
      if (profiled) {
        expect(performanceProfile.counters.rspAudioHLEBlocks).toBe(2);
        expect(performanceProfile.counters.rspAudioHLECycles).toBe(126);
      }
      r.step();
      expect(r.halted).toBe(true);
      expect(r.audioHLE).toBeNull();
    });

    test('every interruption point materializes exactly the elapsed LLE instructions', async () => {
      const { r, stream } = await fixture(profiled);
      const before = snapshot(r);
      for (let elapsed = 1; elapsed < 64; elapsed++) {
        restore(r, before);
        for (let i = 0; i < elapsed; i++) {
          RSP.prototype.step.call(r);
        }
        const reference = snapshot(r);
        restore(r, before);
        r.setAudioHLE(stream);
        for (let i = 0; i < elapsed; i++) {
          r.step();
        }
        r.synchronizeAudioHLE();
        expect(snapshot(r)).toEqual(reference);
        expect(stream.remaining).toBe(0);
      }
    });

    test('SP reads and writes, PC reads, halt and single-step synchronize pending work', async () => {
      for (const action of ['read', 'write', 'pc', 'pcByte', 'halt', 'single']) {
        const { hardware: h, r, stream } = await fixture(profiled);
        r.setAudioHLE(stream);
        r.step(); r.step();
        expect(h.sp_mem.getU32(0x100)).toBe(0);
        if (action === 'read') {
          expect(h.spMemDevice.readU32(0xa4000100)).toBe(1);
        }
        if (action === 'write') {
          h.spMemDevice.write32(0xa4000100, 7);
        }
        if (action === 'pc') {
          expect(h.spIbistDevice.readU32(0xa4080000)).toBe(0x9e0);
        }
        if (action === 'pcByte') {
          // Only the existing 32-bit read synthesizes PC; narrow reads use
          // the backing register bank. Both must synchronize elapsed work.
          expect(h.spIbistDevice.readU8(0xa4080003)).toBe(0);
        }
        if (action === 'halt') {
          h.spRegDevice.writeReg32(SP_STATUS_REG, SP_SET_HALT);
        }
        if (action === 'single') {
          h.spRegDevice.writeReg32(SP_STATUS_REG, SP_SET_SSTEP);
        }
        expect(h.sp_mem.getU32(0x100)).toBe(action === 'write' ? 7 : 1);
        expect(r.pc).toBe(0x9e0);
      }
    });

    test('reset cancels uncommitted work and code changes retain LLE', async () => {
      const { r, stream, hardware: h } = await fixture(profiled);
      r.setAudioHLE(stream);
      r.step(); r.step();
      r.reset();
      expect(r.audioHLE).toBeNull();
      expect(h.sp_mem.getU32(0x100)).toBe(0);
      r.pc = 0x9d8; r.halted = false; r.setRegS32(18, 32);
      h.sp_mem.set32(0x19d8, addiu(8, 8, 5));
      h.spRegDevice.imemGeneration++;
      r.setAudioHLE(new GoldenEyeAudioStream(r, stream.code));
      r.step();
      expect(r.audioHLE).toBeNull();
      expect(r.getRegS32(8)).toBe(5);
    });
  });
}

test('fused envelope pairs preserve full accumulator including 32-bit carry and saturation', async () => {
  const { r, stream } = await fixture();
  for (const scale of [-32768, -32767, 0, 32767]) {
    for (const input of [-32768, -1, 0, 1, 32767]) {
      for (let lane = 0; lane < 8; lane++) {
        r.setVecS16(10, lane, scale);
        r.setVecS16(17, lane, input);
        r.setVecS16(16, lane, lane % 2 ? 32767 : -32768);
        r.setVecS16(29, lane, lane % 2 ? -32768 : 32767);
      }
      const before = snapshot(r);
      r.executeOp(vector(0, 29, 29, 10, 14));
      r.executeOp(vector(8, 29, 17, 16));
      const reference = snapshot(r);
      restore(r, before);
      stream.mix(29, 16);
      expect(snapshot(r)).toEqual(reference);
    }
  }
  setPerformanceProfiling(false);
});

test('sample DMA runs after active PI and an idle gap with a later transfer, at the LLE boundary', async () => {
  const results = [];
  for (const accelerated of [false, true]) {
    const { r, hardware: h, cpu0 } = await fixture();
    r.setRegS32(18, 48);
    const put = (pc, word) => h.sp_mem.set32(0x1000 + pc, word);
    // The original instruction path loads a sample after three local blocks.
    for (const [i, word] of [addiu(1, 0, 0x200), 0x40810000,
      addiu(2, 0, 0x5000), 0x40820800, addiu(3, 0, 15), 0x40831000, 13].entries()) {
      put(0xad8 + i * 4, word);
    }
    if (accelerated) {
      r.setAudioHLE(new GoldenEyeAudioStream(r, r.imem.u8.subarray(0x80)));
    }
    h.rom.u8.fill(0x37, 0x100, 0x110);
    h.rom.u8.fill(0x49, 0x200, 0x210);
    // One PI page, 54 cycles per sample transfer.
    for (const offset of [0x14, 0x18, 0x20]) {
      h.piRegDevice.write32(0xa4600000 + offset, 0);
    }
    h.piRegDevice.write32(0xa460001c, 15);
    const submit = offset => {
      h.piRegDevice.write32(0xa4600010, 2);
      h.piRegDevice.write32(0xa4600000, 0x5000);
      h.piRegDevice.write32(0xa4600004, 0x10000000 + offset);
      h.piRegDevice.write32(0xa460000c, 15);
    };
    submit(0x100);
    expect(h.piRegDevice.busy()).toBe(true);
    const reads = [];
    const copy = h.spRegDevice.spCopyFromRDRAM;
    h.spRegDevice.spCopyFromRDRAM = function (...args) {
      reads.push([cpu0.controlCountValue, ...args, h.piRegDevice.busy()]);
      return copy.apply(this, args);
    };
    for (let cycle = 0; cycle < 197; cycle++) {
      if (cycle === 70) {
        expect(h.piRegDevice.busy()).toBe(false);
        expect(reads).toEqual([]);
      }
      if (cycle === 80) {
        submit(0x200);
      }
      r.step();
      cpu0.incrementCount(1);
      cpu0.eventQueue.incrementCount(1);
    }
    expect(reads).toHaveLength(1);
    expect(reads[0].at(-1)).toBe(false);
    expect(h.sp_mem.u8.slice(0x200, 0x210)).toEqual(new Uint8Array(16).fill(0x49));
    expect(r.halted).toBe(true);
    results.push({ reads, state: snapshot(r), ram: [...h.ram.u8.subarray(0x5000, 0x5010)], status: [...h.sp_reg.u8] });
  }
  expect(results[1]).toEqual(results[0]);
});

test('an SP DMA materializes only elapsed work before reading DMEM', async () => {
  for (const elapsed of [1, 2]) {
    const { r, stream, hardware: h } = await fixture();
    r.setAudioHLE(stream);
    for (let i = 0; i < elapsed; i++) {
      r.step();
    }
    h.spRegDevice.writeReg32(0, 0x100);
    h.spRegDevice.writeReg32(4, 0x5000);
    h.spRegDevice.writeReg32(12, 7);
    expect(h.ram.getU32(0x5000)).toBe(elapsed === 1 ? 0 : 1);
    expect(r.getRegS32(8)).toBe(1);
    expect(r.pc).toBe(0x9d8 + elapsed * 4);
    expect(stream.remaining).toBe(0);
  }
});

test('an IMEM DMA revokes the reviewed code before another accelerated iteration', async () => {
  const { r, stream, hardware: h, cpu0 } = await fixture();
  r.setAudioHLE(stream);
  for (let i = 0; i < 10; i++) {
    r.step();
  }
  h.ram.set32(0x5000, addiu(8, 8, 5));
  h.ram.set32(0x5004, 0xac080100);
  h.spRegDevice.writeReg32(0, 0x19d8);
  h.spRegDevice.writeReg32(4, 0x5000);
  h.spRegDevice.writeReg32(8, 7);
  cpu0.eventQueue.incrementCount(1);
  expect(r.getRegS32(8)).toBe(1);
  for (let i = 10; i < 64; i++) {
    r.step();
  }
  expect(r.pc).toBe(0x9d8);
  r.step();
  expect(r.audioHLE).toBeNull();
  expect(r.getRegS32(8)).toBe(6);
});

test('unsupported block counts and other command PCs execute LLE immediately', async () => {
  const { r, stream } = await fixture();
  r.setRegS32(18, 15);
  r.setAudioHLE(stream);
  r.step();
  expect(r.getRegS32(8)).toBe(1);
  expect(stream.remaining).toBe(0);
  r.pc = 0x100;
  r.imemDV.setUint32(0x100, addiu(8, 8, 9));
  r.step();
  expect(r.getRegS32(8)).toBe(10);
});

test('every envelope branch path and loop exit retains the original instruction deadline', async () => {
  for (const count of [16, 32]) {
    for (const left of [-1, 1]) {
      for (const right of [-1, 1]) {
        const { r, hardware: h } = await fixture();
        r.pc = 0xcd0;
        r.setRegS32(14, count); r.setRegS32(21, left); r.setRegS32(20, right);
        const put = (pc, word) => h.sp_mem.set32(0x1000 + pc, word);
        put(0xcd0, 0x1ea00008); // BGTZ s5, 0xcf4
        put(0xcd8, addiu(8, 8, 1));
        put(0xcec, 0x08000742); // J 0x1d08
        put(0xcf4, addiu(8, 8, 5));
        put(0xd30, 0x1e800007); // BGTZ s4, 0xd50
        put(0xd38, addiu(9, 9, 1));
        put(0xd48, 0x08000758); // J 0x1d60
        put(0xd50, addiu(9, 9, 5));
        put(0xd64, addiu(14, 14, -16));
        put(0xd90, 0x19c00003); // BLEZ t6, 0xda0
        put(0xd98, 0x08000734); // J 0x1cd0
        put(0xd9c, addiu(2, 2, 1));
        for (const [start, end, dest, gain] of [[0xd18,0xd1c,29,16], [0xd24,0xd2c,27,15], [0xd70,0xd78,28,16], [0xd80,0xd84,26,15]]) {
          put(start, vector(0, dest, dest, 10, 14));
          put(end, vector(8, dest, 17, gain));
        }
        const stream = new GoldenEyeAudioStream(r, r.imem.u8.subarray(0x80));
        const before = snapshot(r);
        const cycles = 39 + (left < 0 ? 2 : 0) + (right < 0 ? 2 : 0) - (count === 16 ? 2 : 0);
        for (let i = 0; i < cycles; i++) {
          RSP.prototype.step.call(r);
        }
        const reference = snapshot(r);
        restore(r, before);
        r.setAudioHLE(stream);
        for (let i = 0; i < cycles - 1; i++) {
          r.step();
        }
        expect(snapshot(r)).toEqual(before);
        r.step();
        expect(snapshot(r)).toEqual(reference);
      }
    }
  }
});

test('RDP XBUS reads see the exact elapsed DMEM writes', async () => {
  const { r, stream, hardware: h } = await fixture();
  r.setAudioHLE(stream);
  r.step(); r.step();
  const observed = [];
  h.rdp.run = buffer => { observed.push(buffer.getU32(0)); };
  h.dpcDevice.statusReg = 1; // XBUS DMEM DMA
  h.dpcDevice.currentReg = 0x100;
  h.dpcDevice.endReg = 0x108;
  h.dpcDevice.processBuffer();
  expect(observed).toEqual([1]);
  expect(r.pc).toBe(0x9e0);
  expect(stream.remaining).toBe(0);
});
