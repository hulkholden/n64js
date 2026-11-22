import { describe, expect, test } from 'bun:test';
import * as regs from './cpu0reg.js';
import * as decode from './decode.js';
import {
  captureExecutionSnapshot,
  compileFragmentAt,
  compileOp,
  createOpRunner,
  createTestCPU,
  createTestEmulator,
  iop,
  regimm,
  resetGPRsWithSentinel,
  special,
  warmFragmentLookup,
  writeTLBEntry,
} from './test_helpers.js';
import { Fragment, FragmentCache } from './fragments.js';
import { compileTraceSteps } from './recompiler.js';

const FPCSR_C = 0x00800000;
const SR_CU1 = 0x20000000;

const LOW_PAGE_PHYS = 0x2000;
const HIGH_PAGE_PHYS = 0x5000;

const bc1 = (condition, likely, offset) =>
  ((decode.OP_COP1 << 26) | (decode.COP_BC << 21) | ((likely ? 2 : 0) << 16) | ((condition ? 1 : 0) << 16) | (offset & 0xffff)) >>> 0;

function boundaryPhysAddr(va) {
  const u = va >>> 0;
  if (u < 0x1000) {
    return LOW_PAGE_PHYS + u;
  }
  if (u >= 0xfffff000) {
    return HIGH_PAGE_PHYS + (u & 0xfff);
  }
  throw new Error(`Address ${u.toString(16)} is outside mapped boundary pages`);
}

function setupBoundaryMachine(emulator, wordsByVA, { pc, fcsr = 0, prepare = () => {} } = {}) {
  const { cpu0: cpu, hardware } = emulator;
  cpu.reset();
  cpu.controlCountValue = 0;
  cpu.opsExecuted = 0;
  cpu.llBit = 0;
  cpu.lastControlRegWrite = 0n;
  cpu.setControlU32(regs.controlStatus, SR_CU1);
  cpu.cop1ControlChanged();
  hardware.cpu1.reset();
  hardware.cpu1.control[31] = fcsr;
  hardware.rsp.reset();
  hardware.ram.u8.fill(0);

  // Map VA 0x00000000..0x00001fff (even page 0x0 -> phys 0x2000, odd page 0x1000 -> phys 0x3000)
  // and VA 0xffffe000..0xffffffff (even page 0xffffe000 -> phys 0x4000, odd page 0xfffff000 -> phys 0x5000).
  writeTLBEntry(cpu, 0, 0x00000000, ((LOW_PAGE_PHYS >>> 12) << 6) | 7, (((LOW_PAGE_PHYS + 0x1000) >>> 12) << 6) | 7);
  writeTLBEntry(cpu, 1, 0xffffe000, (((HIGH_PAGE_PHYS - 0x1000) >>> 12) << 6) | 7, ((HIGH_PAGE_PHYS >>> 12) << 6) | 7);

  for (const [va, word] of wordsByVA) {
    hardware.ram.set32(boundaryPhysAddr(va), word >>> 0);
  }

  cpu.pc = pc >>> 0;
  prepare(cpu, hardware);
}

async function compareBoundaryExecution(wordsByVA, {
  pc,
  cycles,
  trainCycles = cycles,
  fcsr = 0,
  trainPrepare,
  prepare = () => {},
} = {}) {
  const interpEmu = await createTestEmulator();
  setupBoundaryMachine(interpEmu, wordsByVA, { pc, fcsr, prepare });
  interpEmu.cpu0.run(cycles);
  const expected = captureExecutionSnapshot(interpEmu);

  const dynEmu = await createTestEmulator();
  setupBoundaryMachine(dynEmu, wordsByVA, { pc, fcsr, prepare: trainPrepare ?? prepare });
  const fragment = compileFragmentAt(dynEmu.cpu0, pc >>> 0, trainCycles);
  expect(dynEmu.fatalError()).toBeNull();

  // Re-run cleanly using the compiled fragment without clearing the fragment cache.
  const { cpu0: cpu, hardware } = dynEmu;
  cpu.controlCountValue = 0;
  cpu.opsExecuted = 0;
  cpu.llBit = 0;
  cpu.lastControlRegWrite = 0n;
  cpu.gprU64.fill(0n);
  cpu.setControlU32(regs.controlStatus, SR_CU1);
  cpu.setControlU32(regs.controlCause, 0);
  cpu.setControlU32(regs.controlEPC, 0);
  cpu.cop1ControlChanged();
  hardware.cpu1.reset();
  hardware.cpu1.control[31] = fcsr;
  cpu.delayPC = null;
  cpu.branchTarget = null;
  cpu.stuffToDo = 0;
  cpu.pc = pc >>> 0;
  prepare(cpu, hardware);

  const runsBefore = fragment.executionCount;
  cpu.run(cycles);
  expect(fragment.executionCount).toBeGreaterThan(runsBefore);

  // Every fragment cache key must stay normalized to unsigned 32-bit addresses.
  for (const key of hardware.fragmentCache.fragments.keys()) {
    expect(key).toBe(key >>> 0);
  }
  for (const key of hardware.fragmentCache.hitCounts.keys()) {
    expect(key).toBe(key >>> 0);
  }

  const actual = captureExecutionSnapshot(dynEmu);
  expect(actual).toEqual(expected);
  return { expected, actual, fragment, dynEmu };
}

const branchSpecs = [
  { name: 'BEQ', word: off => iop(decode.OP_BEQ, 8, 9, off), likely: false, link: false, cop1: false, setTaken: c => { c.setRegS32Extend(8, 1); c.setRegS32Extend(9, 1); }, setUntaken: c => { c.setRegS32Extend(8, 1); c.setRegS32Extend(9, 2); } },
  { name: 'BNE', word: off => iop(decode.OP_BNE, 8, 9, off), likely: false, link: false, cop1: false, setTaken: c => { c.setRegS32Extend(8, 1); c.setRegS32Extend(9, 2); }, setUntaken: c => { c.setRegS32Extend(8, 1); c.setRegS32Extend(9, 1); } },
  { name: 'BLEZ', word: off => iop(decode.OP_BLEZ, 8, 0, off), likely: false, link: false, cop1: false, setTaken: c => c.setRegS32Extend(8, 0), setUntaken: c => c.setRegS32Extend(8, 1) },
  { name: 'BGTZ', word: off => iop(decode.OP_BGTZ, 8, 0, off), likely: false, link: false, cop1: false, setTaken: c => c.setRegS32Extend(8, 1), setUntaken: c => c.setRegS32Extend(8, 0) },
  { name: 'BLTZ', word: off => regimm(decode.REGIMM_BLTZ, 8, off), likely: false, link: false, cop1: false, setTaken: c => c.setRegS32Extend(8, -1), setUntaken: c => c.setRegS32Extend(8, 0) },
  { name: 'BGEZ', word: off => regimm(decode.REGIMM_BGEZ, 8, off), likely: false, link: false, cop1: false, setTaken: c => c.setRegS32Extend(8, 0), setUntaken: c => c.setRegS32Extend(8, -1) },
  { name: 'BEQL', word: off => iop(decode.OP_BEQL, 8, 9, off), likely: true, link: false, cop1: false, setTaken: c => { c.setRegS32Extend(8, 1); c.setRegS32Extend(9, 1); }, setUntaken: c => { c.setRegS32Extend(8, 1); c.setRegS32Extend(9, 2); } },
  { name: 'BNEL', word: off => iop(decode.OP_BNEL, 8, 9, off), likely: true, link: false, cop1: false, setTaken: c => { c.setRegS32Extend(8, 1); c.setRegS32Extend(9, 2); }, setUntaken: c => { c.setRegS32Extend(8, 1); c.setRegS32Extend(9, 1); } },
  { name: 'BLEZL', word: off => iop(decode.OP_BLEZL, 8, 0, off), likely: true, link: false, cop1: false, setTaken: c => c.setRegS32Extend(8, 0), setUntaken: c => c.setRegS32Extend(8, 1) },
  { name: 'BGTZL', word: off => iop(decode.OP_BGTZL, 8, 0, off), likely: true, link: false, cop1: false, setTaken: c => c.setRegS32Extend(8, 1), setUntaken: c => c.setRegS32Extend(8, 0) },
  { name: 'BLTZL', word: off => regimm(decode.REGIMM_BLTZL, 8, off), likely: true, link: false, cop1: false, setTaken: c => c.setRegS32Extend(8, -1), setUntaken: c => c.setRegS32Extend(8, 0) },
  { name: 'BGEZL', word: off => regimm(decode.REGIMM_BGEZL, 8, off), likely: true, link: false, cop1: false, setTaken: c => c.setRegS32Extend(8, 0), setUntaken: c => c.setRegS32Extend(8, -1) },
  { name: 'BLTZAL', word: off => regimm(decode.REGIMM_BLTZAL, 8, off), likely: false, link: true, cop1: false, setTaken: c => c.setRegS32Extend(8, -1), setUntaken: c => c.setRegS32Extend(8, 0) },
  { name: 'BGEZAL', word: off => regimm(decode.REGIMM_BGEZAL, 8, off), likely: false, link: true, cop1: false, setTaken: c => c.setRegS32Extend(8, 0), setUntaken: c => c.setRegS32Extend(8, -1) },
  { name: 'BLTZALL', word: off => regimm(decode.REGIMM_BLTZALL, 8, off), likely: true, link: true, cop1: false, setTaken: c => c.setRegS32Extend(8, -1), setUntaken: c => c.setRegS32Extend(8, 0) },
  { name: 'BGEZALL', word: off => regimm(decode.REGIMM_BGEZALL, 8, off), likely: true, link: true, cop1: false, setTaken: c => c.setRegS32Extend(8, 0), setUntaken: c => c.setRegS32Extend(8, -1) },
  { name: 'BC1F', word: off => bc1(false, false, off), likely: false, link: false, cop1: true, setTaken: c => { c.hardware.cpu1.control[31] = 0; }, setUntaken: c => { c.hardware.cpu1.control[31] = FPCSR_C; } },
  { name: 'BC1T', word: off => bc1(true, false, off), likely: false, link: false, cop1: true, setTaken: c => { c.hardware.cpu1.control[31] = FPCSR_C; }, setUntaken: c => { c.hardware.cpu1.control[31] = 0; } },
  { name: 'BC1FL', word: off => bc1(false, true, off), likely: true, link: false, cop1: true, setTaken: c => { c.hardware.cpu1.control[31] = 0; }, setUntaken: c => { c.hardware.cpu1.control[31] = FPCSR_C; } },
  { name: 'BC1TL', word: off => bc1(true, true, off), likely: true, link: false, cop1: true, setTaken: c => { c.hardware.cpu1.control[31] = FPCSR_C; }, setUntaken: c => { c.hardware.cpu1.control[31] = 0; } },
];

function createBranchOpRunner(compiled, word, options = {}) {
  if (!compiled) {
    return createOpRunner(false, word, options);
  }
  const fragment = compileOp(word, options);
  const fn = new Function('c', 'cpu1', 'SR_CU1', 'FPCSR_C', fragment.bodyCode);
  return cpu => fn(cpu, cpu.hardware.cpu1, SR_CU1, FPCSR_C);
}

describe('32-bit unsigned PC wraparound (single-op interpreter vs compiled)', () => {
  test('backward branches across 0x00000000 normalize target to unsigned 0xfffffff4', async () => {
    const cpu = await createTestCPU();
    cpu.setControlU32(regs.controlStatus, SR_CU1);
    cpu.cop1ControlChanged();

    for (const spec of branchSpecs) {
      const word = spec.word(-4); // (0x00000000 + 4 + (-16)) >>> 0 = 0xfffffff4
      const cop1Modes = spec.cop1 ? [false, true] : [false];
      for (const cop1statusKnown of cop1Modes) {
        const runInterp = createBranchOpRunner(false, word);
        const runCompiled = createBranchOpRunner(true, word, {
          pc: 0x00000000,
          postPC: 0x00000004,
          nextPC: 0x00000004,
          needsDelayCheck: false,
          cop1statusKnown,
        });

        for (const [isCompiled, run] of [[false, runInterp], [true, runCompiled]]) {
          resetGPRsWithSentinel(cpu);
          spec.setTaken(cpu);
          cpu.pc = 0x00000000;
          cpu.nextPC = 0x00000004;
          cpu.delayPC = null;
          cpu.branchTarget = null;
          run(cpu);
          expect(isCompiled ? cpu.delayPC : cpu.branchTarget).toBe(0xfffffff4);
          expect(isCompiled ? cpu.pc : cpu.nextPC).toBe(0x00000004);
          if (spec.link) {
            expect(cpu.getRegU64(regs.RA)).toBe(8n);
          }
        }
      }
    }
  });

  test('forward and untaken branches at 0xfffffff8 and 0xfffffffc wrap to 0x00000000 and 0x00000004', async () => {
    const cpu = await createTestCPU();
    cpu.setControlU32(regs.controlStatus, SR_CU1);
    cpu.cop1ControlChanged();

    const cases = [
      { pc: 0xfffffff8, offset: 1, expectedDelaySlot: 0xfffffffc, expectedTaken: 0x00000000, expectedFallthrough: 0x00000000, expectedLink: 0n },
      { pc: 0xfffffff8, offset: 2, expectedDelaySlot: 0xfffffffc, expectedTaken: 0x00000004, expectedFallthrough: 0x00000000, expectedLink: 0n },
      { pc: 0xfffffffc, offset: 0, expectedDelaySlot: 0x00000000, expectedTaken: 0x00000000, expectedFallthrough: 0x00000004, expectedLink: 4n },
      { pc: 0xfffffffc, offset: 1, expectedDelaySlot: 0x00000000, expectedTaken: 0x00000004, expectedFallthrough: 0x00000004, expectedLink: 4n },
    ];

    for (const c of cases) {
      for (const spec of branchSpecs) {
        const word = spec.word(c.offset);
        const cop1Modes = spec.cop1 ? [false, true] : [false];
        for (const cop1statusKnown of cop1Modes) {
          for (const taken of [true, false]) {
            const expectedPC = spec.likely && !taken ? c.expectedFallthrough : c.expectedDelaySlot;
            const expectedTarget = taken ? c.expectedTaken : spec.likely ? null : c.expectedFallthrough;
            const runInterp = createBranchOpRunner(false, word);
            const runCompiled = createBranchOpRunner(true, word, {
              pc: c.pc,
              postPC: expectedPC,
              nextPC: expectedPC,
              needsDelayCheck: false,
              cop1statusKnown,
            });

            for (const [isCompiled, run] of [[false, runInterp], [true, runCompiled]]) {
              resetGPRsWithSentinel(cpu);
              if (taken) {
                spec.setTaken(cpu);
              } else {
                spec.setUntaken(cpu);
              }
              cpu.pc = c.pc;
              cpu.nextPC = c.expectedDelaySlot;
              cpu.delayPC = null;
              cpu.branchTarget = null;
              run(cpu);
              expect(isCompiled ? cpu.pc : cpu.nextPC).toBe(expectedPC);
              expect(isCompiled ? cpu.delayPC : cpu.branchTarget).toBe(expectedTarget);
              if (spec.link) {
                expect(cpu.getRegU64(regs.RA)).toBe(c.expectedLink);
              }
            }
          }
        }
      }
    }
  });

  test('untaken Branch-Likely with dynamic delayPC === 0xfffffffc wraps c.nextPC to 0x00000000', async () => {
    const cpu = await createTestCPU();
    cpu.setControlU32(regs.controlStatus, SR_CU1);
    cpu.cop1ControlChanged();

    for (const spec of branchSpecs.filter(s => s.likely)) {
      const word = spec.word(3);
      const cop1Modes = spec.cop1 ? [false, true] : [false];
      for (const cop1statusKnown of cop1Modes) {
        const runInterp = createBranchOpRunner(false, word);
        const runCompiled = createBranchOpRunner(true, word, {
          pc: 0x80001000,
          postPC: 0x00000000,
          nextPC: 0x00000000,
          needsDelayCheck: true,
          cop1statusKnown,
        });

        for (const [isCompiled, run] of [[false, runInterp], [true, runCompiled]]) {
          resetGPRsWithSentinel(cpu);
          spec.setUntaken(cpu);
          cpu.pc = 0x80001000;
          cpu.nextPC = 0xfffffffc;
          cpu.delayPC = 0xfffffffc;
          cpu.branchTarget = null;
          run(cpu);
          expect(isCompiled ? cpu.pc : cpu.nextPC).toBe(0x00000000);
          expect(isCompiled ? cpu.delayPC : cpu.branchTarget).toBeNull();
          if (spec.link) {
            expect(cpu.getRegU64(regs.RA)).toBe(0n);
          }
        }
      }
    }
  });
});

describe('32-bit unsigned PC wraparound (full interpreter vs dynarec execution)', () => {
  for (const name of ['BLTZAL', 'BGEZAL', 'BLTZALL', 'BGEZALL', 'BEQ', 'BNE', 'BEQL', 'BNEL', 'BC1T', 'BC1TL']) {
    const spec = branchSpecs.find(s => s.name === name);
    test(`${name} taken backward across 0x00000000 to 0xfffffff4 matches interpreter without off-trace mismatch`, async () => {
      const words = [
        [0x00000000, spec.word(-4)],                   // target = 0xfffffff4
        [0x00000004, iop(decode.OP_ADDIU, 10, 10, 1)], // delay slot: t2 += 1
        [0xfffffff4, iop(decode.OP_ADDIU, 11, 11, 5)], // target: t3 += 5
        [0xfffffff8, iop(decode.OP_ADDIU, 11, 11, 7)], // t3 += 7
        [0xfffffffc, iop(decode.OP_ADDIU, 11, 11, 9)], // t3 += 9, falls through to 0x00000000
      ];

      const { actual, fragment } = await compareBoundaryExecution(words, {
        pc: 0x00000000,
        cycles: 5,
        prepare: c => spec.setTaken(c),
      });

      expect(actual.pc).toBe(0x00000000);
      expect(actual.delayPC).toBeNull();
      expect(actual.gpr[10]).toBe(1n);
      expect(actual.gpr[11]).toBe(21n);
      if (spec.link) {
        expect(actual.gpr[regs.RA]).toBe(8n);
      }
      // The compiled fragment should capture the full 5-op loop across 0x00000000 -> 0xfffffff4 -> 0x00000000.
      expect(fragment.opsCompiled).toBe(5);
    });
  }

  for (const name of ['BEQ', 'BNE', 'BLEZ', 'BGTZ', 'BLTZ', 'BGEZ', 'BLTZAL', 'BGEZAL', 'BC1F', 'BC1T']) {
    const spec = branchSpecs.find(s => s.name === name);
    test(`${name} forward (+1) and untaken at 0xfffffff8 wrap target/fallthrough to 0x00000000`, async () => {
      const words = [
        [0xfffffff8, spec.word(1)],                     // taken target = 0x00000000; untaken fallthrough = 0x00000000
        [0xfffffffc, iop(decode.OP_ADDIU, 10, 10, 3)], // delay slot: t2 += 3
        [0x00000000, iop(decode.OP_ADDIU, 11, 11, 11)], // landing at 0x00000000: t3 += 11
        [0x00000004, iop(decode.OP_ADDIU, 12, 12, 13)], // t4 += 13
      ];

      for (const taken of [true, false]) {
        const { actual } = await compareBoundaryExecution(words, {
          pc: 0xfffffff8,
          cycles: 4,
          prepare: c => (taken ? spec.setTaken(c) : spec.setUntaken(c)),
        });
        expect(actual.pc).toBe(0x00000008);
        expect(actual.gpr[10]).toBe(3n);
        expect(actual.gpr[11]).toBe(11n);
        expect(actual.gpr[12]).toBe(13n);
        if (spec.link) {
          expect(actual.gpr[regs.RA]).toBe(0n);
        }
      }
    });
  }

  for (const name of ['BEQL', 'BNEL', 'BLEZL', 'BGTZL', 'BLTZL', 'BGEZL', 'BLTZALL', 'BGEZALL', 'BC1FL', 'BC1TL']) {
    const spec = branchSpecs.find(s => s.name === name);
    test(`${name} untaken at 0xfffffff8 annuls 0xfffffffc and lands at 0x00000000 (both unfused and fused-trained)`, async () => {
      const words = [
        [0xfffffff8, spec.word(2)],                      // taken target = 0x00000004; untaken lands at 0x00000000
        [0xfffffffc, iop(decode.OP_ADDIU, 10, 10, 99)],  // delay slot: must be annulled when untaken
        [0x00000000, iop(decode.OP_ADDIU, 11, 11, 17)],  // untaken landing at 0x00000000
        [0x00000004, iop(decode.OP_ADDIU, 12, 12, 23)],  // taken landing at 0x00000004
      ];

      // Unfused path: trained untaken, executed untaken.
      const unfused = await compareBoundaryExecution(words, {
        pc: 0xfffffff8,
        cycles: 3,
        trainCycles: 3,
        prepare: c => spec.setUntaken(c),
      });
      expect(unfused.actual.pc).toBe(0x00000008);
      expect(unfused.actual.gpr[10]).toBe(0n);
      expect(unfused.actual.gpr[11]).toBe(17n);
      expect(unfused.actual.gpr[12]).toBe(23n);
      if (spec.link) {
        expect(unfused.actual.gpr[regs.RA]).toBe(0n);
      }

      // Fused (or taken-trained) path: trained taken, then executed untaken at runtime.
      const fused = await compareBoundaryExecution(words, {
        pc: 0xfffffff8,
        cycles: 3,
        trainCycles: 3,
        trainPrepare: c => spec.setTaken(c),
        prepare: c => spec.setUntaken(c),
      });
      expect(fused.actual.pc).toBe(0x00000008);
      expect(fused.actual.gpr[10]).toBe(0n);
      expect(fused.actual.gpr[11]).toBe(17n);
      expect(fused.actual.gpr[12]).toBe(23n);
      if (spec.link) {
        expect(fused.actual.gpr[regs.RA]).toBe(0n);
      }
    });

    test(`${name} at 0xfffffffc wraps delay slot (0x00000000) and fallthrough (0x00000004)`, async () => {
      const words = [
        [0xfffffffc, spec.word(2)],                      // taken target = 0x00000008; untaken lands at 0x00000004
        [0x00000000, iop(decode.OP_ADDIU, 10, 10, 55)],  // delay slot at 0x00000000
        [0x00000004, iop(decode.OP_ADDIU, 11, 11, 19)],  // untaken landing at 0x00000004
        [0x00000008, iop(decode.OP_ADDIU, 12, 12, 29)],  // taken landing at 0x00000008
      ];

      for (const taken of [true, false]) {
        const { actual } = await compareBoundaryExecution(words, {
          pc: 0xfffffffc,
          cycles: taken ? 3 : 2,
          prepare: c => (taken ? spec.setTaken(c) : spec.setUntaken(c)),
        });
        expect(actual.pc).toBe(taken ? 0x0000000c : 0x00000008);
        expect(actual.gpr[10]).toBe(taken ? 55n : 0n);
        expect(actual.gpr[11]).toBe(taken ? 0n : 19n);
        expect(actual.gpr[12]).toBe(taken ? 29n : 0n);
        if (spec.link) {
          expect(actual.gpr[regs.RA]).toBe(4n);
        }
      }
    });
  }

  test('sequential fall-through from 0xfffffffc to 0x00000000 flushes delayedPCUpdate = 0', async () => {
    // 1. Direct compileTraceSteps check: fragment ending right after a trivial op at 0xfffffffc
    //    must flush `c.pc = 0x00000000;` (must not treat 0 as the "no delayed PC" sentinel).
    const fragment = new Fragment(0xfffffff8, new FragmentCache());
    fragment.recordInstruction(0xfffffff8, iop(decode.OP_ADDIU, 8, 8, 1), 0xfffffffc, 0xfffffffc);
    fragment.recordInstruction(0xfffffffc, iop(decode.OP_ADDIU, 8, 8, 2), 0x00000000, 0x00000000);
    const bodyCode = compileTraceSteps(fragment);
    expect(bodyCode).toContain('c.pc = 0x00000000;');

    const cpu = await createTestCPU();
    cpu.reset();
    cpu.pc = 0xfffffff8;
    cpu.delayPC = null;
    cpu.stuffToDo = 0;
    const ops = new Function('c', 'cpu1', 'rsp', bodyCode)(cpu, cpu.hardware.cpu1, cpu.hardware.rsp);
    expect(ops).toBe(2);
    expect(cpu.pc).toBe(0x00000000);
    expect(cpu.getRegU64(8)).toBe(3n);

    // 2. Full interpreter vs compiled execution across 0xfffffff8 -> 0xfffffffc -> 0x00000000 -> 0x00000004.
    const words = [
      [0xfffffff8, iop(decode.OP_ADDIU, 8, 8, 1)],
      [0xfffffffc, iop(decode.OP_ADDIU, 8, 8, 2)],
      [0x00000000, iop(decode.OP_ADDIU, 8, 8, 4)],
      [0x00000004, iop(decode.OP_ADDIU, 8, 8, 8)],
    ];
    const { actual } = await compareBoundaryExecution(words, {
      pc: 0xfffffff8,
      cycles: 4,
    });
    expect(actual.pc).toBe(0x00000008);
    expect(actual.gpr[8]).toBe(15n);

    // 3. Interpreter single-step right at 0xfffffffc lands on 0x00000000, not 0x100000000.
    const emu = await createTestEmulator();
    setupBoundaryMachine(emu, words, { pc: 0xfffffffc });
    emu.cpu0.run(1);
    expect(emu.cpu0.pc).toBe(0x00000000);
    expect(emu.cpu0.getRegU64(8)).toBe(2n);
  });

  test('trivial op at 0xfffffffc followed by non-trivial op at 0x00000000 flushes c.pc = 0x00000000 before executing', async () => {
    // SYSCALL at 0x00000000 reads c.pc to populate EPC. If delayedPCUpdate === 0 were dropped,
    // EPC would erroneously record 0xfffffff8 instead of 0x00000000.
    const syscallWords = [
      [0xfffffff8, iop(decode.OP_ADDIU, 8, 8, 1)],
      [0xfffffffc, iop(decode.OP_ADDIU, 8, 8, 2)],
      [0x00000000, special(decode.SPECIAL_SYSCALL, 0, 0, 0)],
    ];
    const { actual: syscallActual, fragment: syscallFragment } = await compareBoundaryExecution(syscallWords, {
      pc: 0xfffffff8,
      cycles: 3,
    });
    expect(syscallActual.pc).toBe(0x80000180);
    expect(syscallActual.epc).toBe(0x00000000);
    expect(syscallActual.gpr[8]).toBe(3n);
    expect(syscallFragment.getCode()).toContain('c.pc = 0x00000000;');

    // BLTZAL at 0x00000000 reads this.pc inside execBLTZAL to compute its branch target.
    const bltzalWords = [
      [0xfffffff8, iop(decode.OP_ADDIU, 0, 8, -1)],       // t0 = -1 (negative -> BLTZAL taken)
      [0xfffffffc, iop(decode.OP_ADDIU, 9, 9, 5)],        // t1 += 5 (trivial op -> delayedPCUpdate = 0)
      [0x00000000, regimm(decode.REGIMM_BLTZAL, 8, -4)],  // target = 0xfffffff4
      [0x00000004, iop(decode.OP_ADDIU, 10, 10, 11)],     // delay slot
      [0xfffffff4, iop(decode.OP_ADDIU, 11, 11, 13)],     // target
    ];
    const { actual: bltzalActual } = await compareBoundaryExecution(bltzalWords, {
      pc: 0xfffffff8,
      cycles: 5,
    });
    expect(bltzalActual.pc).toBe(0xfffffff8);
    expect(bltzalActual.gpr[9]).toBe(5n);
    expect(bltzalActual.gpr[10]).toBe(11n);
    expect(bltzalActual.gpr[11]).toBe(13n);
    expect(bltzalActual.gpr[regs.RA]).toBe(8n);
  });

  test('consecutive RAMAccessGroup loads spanning 0xfffffffc to 0x00000000 match interpreter', async () => {
    const words = [
      [0xfffffff8, iop(decode.OP_ADDIU, 8, 8, 1)],  // trivial op clears needsDelayCheck
      [0xfffffffc, iop(decode.OP_LW, 4, 9, 0)],     // LW t1, 0(a0)
      [0x00000000, iop(decode.OP_LW, 4, 10, 4)],    // LW t2, 4(a0)
      [0x00000004, iop(decode.OP_ADDIU, 8, 8, 2)],
    ];

    const { actual, fragment } = await compareBoundaryExecution(words, {
      pc: 0xfffffff8,
      cycles: 4,
      prepare: (c, hw) => {
        c.setRegS32Extend(4, 0x80003000);
        hw.ram.set32(0x3000, 0x11223344);
        hw.ram.set32(0x3004, 0x55667788);
      },
    });
    expect(actual.pc).toBe(0x00000008);
    expect(actual.gpr[8]).toBe(3n);
    expect(actual.gpr[9]).toBe(0x11223344n);
    expect(actual.gpr[10]).toBe(0x55667788n);
    expect(fragment.getCode()).toContain('// Guarded RAM LW group (2 loads)');
  });

  test('compileOp at 0xfffffffc avoids spurious off-trace PC guard for sequential memory and branch ops', () => {
    const lwCode = compileOp(iop(decode.OP_LW, 4, 8, 0), {
      pc: 0xfffffffc,
      postPC: 0x00000000,
      needsDelayCheck: false,
    }).bodyCode;
    expect(lwCode).toContain('c.nextPC = 0x00000000;');
    expect(lwCode).not.toContain('if (c.pc !==');

    const beqCode = compileOp(iop(decode.OP_BEQ, 8, 9, 1), {
      pc: 0xfffffffc,
      postPC: 0x00000000,
      needsDelayCheck: false,
    }).bodyCode;
    expect(beqCode).toContain('c.pc = 0x00000000;');
    expect(beqCode).toContain('// Skipping pc test');
    expect(beqCode).not.toContain('if (c.pc !==');
  });

  test('self-looping fragment crossing 0xfffffffc -> 0x00000000 executes multiple iterations cleanly', async () => {
    // 4-op countdown loop wrapping across 0xfffffffc -> 0x00000000:
    //   0xfffffff8: ADDIU t0, t0, -1
    //   0xfffffffc: ADDIU t1, t1, 1
    //   0x00000000: BNE   t0, r0, 0xfffffff8 (offset = -3)
    //   0x00000004: ADDIU t2, t2, 2
    //   0x00000008: ADDIU t3, t3, 99
    const words = [
      [0xfffffff8, iop(decode.OP_ADDIU, 8, 8, -1)],
      [0xfffffffc, iop(decode.OP_ADDIU, 9, 9, 1)],
      [0x00000000, iop(decode.OP_BNE, 8, 0, -3)],
      [0x00000004, iop(decode.OP_ADDIU, 10, 10, 2)],
      [0x00000008, iop(decode.OP_ADDIU, 11, 11, 99)],
    ];

    const interpEmu = await createTestEmulator();
    setupBoundaryMachine(interpEmu, words, {
      pc: 0xfffffff8,
      prepare: c => c.setRegS32Extend(8, 10),
    });
    interpEmu.cpu0.run(41);
    const expected = captureExecutionSnapshot(interpEmu);

    const dynEmu = await createTestEmulator();
    setupBoundaryMachine(dynEmu, words, {
      pc: 0xfffffff8,
      prepare: c => c.setRegS32Extend(8, 10),
    });
    warmFragmentLookup(dynEmu.hardware, 0xfffffff8);
    dynEmu.cpu0.run(41);
    const actual = captureExecutionSnapshot(dynEmu);

    const fragment = dynEmu.hardware.fragmentCache.fragments.get(0xfffffff8);
    expect(fragment?.func).toBeFunction();
    expect(fragment.getCode()).toContain('while (c.canContinueSelfLoop(opsExecuted, 4))');
    expect(actual).toEqual(expected);
    expect(actual.pc).toBe(0x0000000c);
    expect(actual.gpr[8]).toBe(0n);
    expect(actual.gpr[9]).toBe(10n);
    expect(actual.gpr[10]).toBe(20n);
    expect(actual.gpr[11]).toBe(99n);
  });
});
