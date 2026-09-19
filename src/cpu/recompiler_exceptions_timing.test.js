import { describe, expect, test } from 'bun:test';
import { createHeadlessEmulator } from '../headless_env.js';
import * as regs from './cpu0reg.js';
import { getPerformanceProfile, setPerformanceProfiling } from '../performance_profile.js';

const { getFragmentMap, lookupFragment } = await import('./fragments.js');
const pc = 0x80001000;
const runCycles = 12;

async function compareExecutions(instructions, prepare = () => {}, train = () => {}, profiled = false) {
  const emulator = await createHeadlessEmulator({
    romBuffer: new ArrayBuffer(0x1000),
    rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' },
  });
  const { cpu0: cpu, hardware } = emulator;
  n64js.getSyncFlow = () => null;
  const words = [...instructions];
  while (words.length < runCycles) words.push(0);

  function setup(prepareState) {
    cpu.reset();
    cpu.controlCountValue = 0;
    cpu.opsExecuted = 0;
    cpu.llBit = 0;
    cpu.lastControlRegWrite = 0n;
    cpu.setControlU32(regs.controlStatus, 0x20000000);
    cpu.cop1ControlChanged();
    hardware.cpu1.reset();
    cpu.pc = pc;
    hardware.ram.u8.fill(0);
    words.forEach((word, i) => hardware.ram.set32(0x1000 + i * 4, word));
    cpu.setRegS32Extend(4, 0x80003000);
    prepareState(cpu, hardware);
  }

  function snapshot() {
    expect(emulator.fatalError()).toBeNull();
    return {
      pc: cpu.pc,
      delayPC: cpu.delayPC,
      gpr: [...cpu.gprU64],
      cause: cpu.getControlU32(regs.controlCause),
      epc: cpu.getControlU32(regs.controlEPC),
      badVAddr: cpu.getControlU32(regs.controlBadVAddr),
      status: cpu.getControlU32(regs.controlStatus),
      fcsr: hardware.cpu1.control[31],
      fpr: Array.from({ length: 32 }, (_, i) => hardware.cpu1.loadU32(hardware.cpu1.fdRegIdx32(i))),
      countCycles: cpu.controlCountValue,
      compareCycles: cpu.getCyclesUntilEvent('Compare'),
    };
  }

  try {
    setPerformanceProfiling(false);
    setup(prepare);
    cpu.run(runCycles);
    const interpreted = snapshot();

    // Use the production tracer/compiler, with safe inputs so a memory exception
    // does not prevent the training trace from completing.
    setup(train);
    for (let i = 0; i < 499; i++) lookupFragment(pc);
    cpu.run(runCycles);
    const fragment = getFragmentMap().get(pc);
    expect(fragment?.func).toBeFunction();

    setup(prepare);
    getFragmentMap().set(pc, fragment);
    setPerformanceProfiling(profiled);
    cpu.run(runCycles);
    expect(fragment.executionCount).toBe(1);
    expect(snapshot()).toEqual(interpreted);
    return { ...interpreted, profile: getPerformanceProfile() };
  } finally {
    setPerformanceProfiling(false);
  }
}

for (const profiled of [false, true]) {
  describe(`compiled exceptions and timing${profiled ? ' with profiling' : ''}`, () => {
    const compare = (words, prepare, train) => compareExecutions(words, prepare, train, profiled);

    for (const [name, word, address, cause] of [
      ['LW alignment', 0x8c820000, 0x80003001, 0x10],
      ['SW alignment', 0xac820000, 0x80003001, 0x14],
      ['LL alignment', 0xc0820000, 0x80003001, 0x10],
      ['LW TLB miss', 0x8c820000, 0x00400000, 0x08],
      ['SW TLB miss', 0xac820000, 0x00400000, 0x0c],
      ['LWC1 TLB miss', 0xc4820000, 0x00400000, 0x08],
    ]) {
      test(`${name} preserves the branch EPC and BD`, async () => {
        const result = await compare([0x10000001, word], c => c.setRegS32Extend(4, address));
        expect(result.cause).toBe((0x80000000 | cause) >>> 0);
        expect(result.epc).toBe(pc);
        expect(result.badVAddr).toBe(address);
        if (profiled) expect(result.profile.compiledOps).toBe(2);
      });
    }

    test('a successful delay-slot load clears the delay before a later fault', async () => {
      const result = await compare([0x10000001, 0x8c820000, 0x8ca30000],
        c => c.setRegS32Extend(5, 0x80003001), c => c.setRegS32Extend(5, 0x80003004));
      expect(result.cause).toBe(0x10);
      expect(result.epc).toBe(pc + 8);
    });

    const noFPE = c => c.setRegS32Extend(4, 0);
    for (const fcsr of [0x20000, 0x10800]) {
      for (const delay of [false, true]) {
        test(`CTC1 raises FPE for FCSR=${fcsr.toString(16)}${delay ? ' in a delay slot' : ''}`, async () => {
          const result = await compare(
            [0x44020000, 0, delay ? 0x10000001 : 0, 0x44c4f800, 0x34030077],
            c => c.setRegS32Extend(4, fcsr), noFPE);
          expect(result.cause).toBe(delay ? 0x8000003c : 0x3c);
          expect(result.epc).toBe(pc + (delay ? 8 : 12));
          expect(result.gpr[3]).toBe(0n);
        });
      }
    }

    test('a nontrapping CTC1 continues through the fragment', async () => {
      const result = await compare([0x44020000, 0, 0x44c4f800, 0x34030077], noFPE, noFPE);
      expect(result.gpr[3]).toBe(119n);
      expect(result.cause).toBe(0);
    });

    // FIFA's startup sequence (#109). n64-systemtest's CvtW cases establish
    // that converting infinity is Unimplemented, even with Invalid disabled:
    // https://github.com/lemmy-64/n64-systemtest/blob/main/src/tests/cop1/mod.rs
    for (const invalidEnabled of [false, true]) {
      for (const negativeZero of [false, true]) {
        test(`TRUNC.W.S after DIV.S by ${negativeZero ? '-0' : '+0'}, Invalid ${invalidEnabled ? 'enabled' : 'disabled'}`, async () => {
          const fcsr = 0x01000004 | (invalidEnabled ? 0x800 : 0);
          const setup = (c, h, divisor) => {
            const f = h.cpu1;
            f.control[31] = fcsr;
            f.store32(f.fsRegIdx32(18), 0x46ac3e00); // 22047.0f
            f.store32(f.fsRegIdx32(8), divisor);
            f.store32(f.fdRegIdx32(10), 0x12345678);
          };
          const result = await compare(
            [0x46089003, 0x4600028d, 0x44035000], // DIV.S; TRUNC.W.S; MFC1
            (c, h) => setup(c, h, negativeZero ? 0x80000000 : 0),
            (c, h) => setup(c, h, 0x42700000)); // Train with 60.0f.
          expect(result.cause).toBe(0x3c);
          expect(result.epc).toBe(pc + 4);
          expect(result.fcsr).toBe(fcsr | 0x20020); // Unimplemented cause + sticky Divide-by-zero.
          expect(result.fpr[0]).toBe(negativeZero ? 0xff800000 : 0x7f800000);
          expect(result.fpr[10]).toBe(0x12345678); // Faulting conversion does not write fd.
          expect(result.gpr[3]).toBe(0n); // The dependent MFC1 must not execute.
        });
      }
    }

    for (const [name, read, write] of [
      ['32-bit', 0x40024800, 0x40844800],
      ['64-bit', 0x40224800, 0x40a44800],
    ]) {
      for (const phase of [0, 1]) {
        test(`${name} Count reads include preceding instructions, phase ${phase}`, async () => {
          const result = await compare([0, 0, read, 0, read | (1 << 16)], c => {
            c.controlCountValue = phase;
          });
          expect(result.gpr[2]).toBe(1n);
          expect(result.gpr[3]).toBe(2n);
          expect(result.countCycles).toBe(runCycles + phase);
        });
      }

      test(`${name} Count writes discard cycles preceding the write`, async () => {
        const setup = c => c.setRegS32Extend(4, 100);
        const result = await compare([0, 0, write], setup, setup);
        expect(result.countCycles).toBe(210);
        expect(result.compareCycles).toBe(0x200000000 - 210);
      });
    }

    for (const [name, word, initialCompare, value] of [
      ['MTC0 Compare', 0x40845800, null, 2],
      ['DMTC0 Compare', 0x40a45800, null, 2],
      ['MTC0 Count', 0x40844800, 102, 100],
      ['DMTC0 Count', 0x40a44800, 102, 100],
    ]) {
      test(`${name} respects a newly shortened timer deadline`, async () => {
        const setup = c => {
          c.setRegS32Extend(4, value);
          c.setControlU32(regs.controlStatus, 0x20008001);
          c.statusRegisterChanged();
          if (initialCompare !== null) c.setCompare(initialCompare);
        };
        const words = [0, 0, word, 0, ...(initialCompare === null ? [] : [0, 0]), 0x34030077];
        const result = await compare(words, setup, c => c.setRegS32Extend(4, 1000));
        expect(result.gpr[3]).toBe(0n);
        expect(result.epc).toBe(pc + (initialCompare === null ? 16 : 24));
        expect(result.cause & 0x8000).toBe(0x8000);
      });
    }

    for (const prefix of [0, 2, 11]) {
      test(`a memory fault charges ${prefix} completed fragment instructions`, async () => {
        const words = [...Array(prefix).fill(0), 0x8c820000];
        const result = await compare(words, (c, hardware) => {
          c.setRegS32Extend(4, 0x80003001);
          for (let i = 0; i < runCycles; i++) hardware.ram.set32(0x180 + 4 * i, 0x64630001);
        });
        expect(result.gpr[3]).toBe(BigInt(runCycles - prefix - 1));
        expect(result.countCycles).toBe(runCycles);
        if (profiled) expect(result.profile.compiledOps).toBe(prefix + 1);
      });
    }

    test('a fault after a Count read does not charge synchronized cycles twice', async () => {
      const result = await compare([0, 0, 0x40024800, 0, 0x8c830000], (c, hardware) => {
        c.setRegS32Extend(4, 0x80003001);
        for (let i = 0; i < runCycles; i++) hardware.ram.set32(0x180 + 4 * i, 0x65080001);
      });
      expect(result.gpr[2]).toBe(1n);
      expect(result.gpr[8]).toBe(7n);
      expect(result.countCycles).toBe(runCycles);
    });

    test('a breakpoint charges preceding instructions without charging the stopped instruction', async () => {
      const result = await compare([0, 0, 0x70000000],
        () => { n64js.breakpoints = () => ({ isBreakpoint: () => true }); },
        () => { n64js.breakpoints = () => ({ isBreakpoint: () => false }); });
      expect(result.pc).toBe(pc + 8);
      expect(result.countCycles).toBe(2);
      if (profiled) expect(result.profile.compiledOps).toBe(2);
    });

    for (const [name, branch] of [['BEQ', 0x1000ffff], ['J', 0x08000403]]) {
      test(`${name} idle-loop skipping uses the current event countdown`, async () => {
        const setup = c => c.addEvent('Stop idle loop', 100, () => c.breakExecution());
        const result = await compare([0, 0, 0, branch, 0], setup, setup);
        expect(result.countCycles).toBe(100);
      });
    }
  });
}
