import { describe, expect, test } from 'bun:test';
import { getPerformanceProfile, setPerformanceProfiling } from '../debug/performance_profile.js';
import * as regs from './cpu0reg.js';
import * as decode from './decode.js';
import {
  DEFAULT_PC,
  captureExecutionSnapshot,
  compileFragmentAt,
  compileOp,
  compileOps,
  cop1,
  copMove,
  createTestEmulator,
  iop,
  resetExecutionState,
} from './test_helpers.js';

const pc = DEFAULT_PC;
const runCycles = 12;

const bc1 = (condition, likely, offset, cc = 0) =>
  ((decode.OP_COP1 << 26) |
    (decode.COP_BC << 21) |
    ((cc & 0x7) << 18) |
    (likely ? 0x20000 : 0) |
    (condition ? 0x10000 : 0) |
    (offset & 0xffff)) >>> 0;

async function compareExecutions(instructions, prepare = () => {}, train = prepare, profiled = false) {
  const emulator = await createTestEmulator();
  const { cpu0: cpu, hardware } = emulator;
  const words = [...instructions];
  while (words.length < runCycles) {
    words.push(0);
  }

  function setup(prepareState) {
    resetExecutionState(cpu, words, { pc });
    cpu.setRegS32Extend(4, 0x80003000);
    prepareState(cpu, hardware);
  }

  function snapshot() {
    return captureExecutionSnapshot(emulator, { ramOffset: 0x3000, ramLength: 0x20 });
  }

  try {
    setPerformanceProfiling(false);
    setup(prepare);
    cpu.run(runCycles);
    const interpreted = snapshot();

    setup(train);
    const fragment = compileFragmentAt(cpu, pc, runCycles);

    setup(prepare);
    hardware.fragmentCache.fragments.set(pc, fragment);
    setPerformanceProfiling(profiled);
    cpu.run(runCycles);
    expect(fragment.executionCount).toBe(1);
    expect(snapshot()).toEqual(interpreted);
    return {
      ...interpreted,
      code: fragment.func.toString(),
      profile: getPerformanceProfile(),
    };
  } finally {
    setPerformanceProfiling(false);
  }
}

describe('recompiler COP1 boilerplate codegen', () => {
  const faultingCop1Ops = [
    ['ADD.S', cop1(decode.COP1_FMT_S, decode.COP1_FUNC_ADD, 4, 2, 6)],
    ['SUB.S', cop1(decode.COP1_FMT_S, decode.COP1_FUNC_SUB, 4, 2, 6)],
    ['MUL.S', cop1(decode.COP1_FMT_S, decode.COP1_FUNC_MUL, 4, 2, 6)],
    ['DIV.S', cop1(decode.COP1_FMT_S, decode.COP1_FUNC_DIV, 4, 2, 6)],
    ['SQRT.S', cop1(decode.COP1_FMT_S, decode.COP1_FUNC_SQRT, 4, 2)],
    ['ABS.S', cop1(decode.COP1_FMT_S, decode.COP1_FUNC_ABS, 4, 2)],
    ['NEG.S', cop1(decode.COP1_FMT_S, decode.COP1_FUNC_NEG, 4, 2)],
    ['TRUNC.W.S', cop1(decode.COP1_FMT_S, decode.COP1_FUNC_TRUNC_W, 4, 2)],
    ['CVT.D.S', cop1(decode.COP1_FMT_S, decode.COP1_FUNC_CVT_D, 4, 2)],
    ['CVT.W.S', cop1(decode.COP1_FMT_S, decode.COP1_FUNC_CVT_W, 4, 2)],
    ['CVT.L.S', cop1(decode.COP1_FMT_S, decode.COP1_FUNC_CVT_L, 4, 2)],
    ['C.EQ.S', cop1(decode.COP1_FMT_S, decode.COP1_FUNC_C_EQ, 0, 2, 6)],
    ['ADD.D', cop1(decode.COP1_FMT_D, decode.COP1_FUNC_ADD, 4, 2, 6)],
    ['CVT.S.D', cop1(decode.COP1_FMT_D, decode.COP1_FUNC_CVT_S, 4, 2)],
    ['C.LT.D', cop1(decode.COP1_FMT_D, decode.COP1_FUNC_C_LT, 0, 2, 6)],
    ['CVT.S.W', cop1(decode.COP1_FMT_W, decode.COP1_FUNC_CVT_S, 4, 2)],
    ['CVT.S.L', cop1(decode.COP1_FMT_L, decode.COP1_FUNC_CVT_S, 4, 2)],
    ['CVT.D.L', cop1(decode.COP1_FMT_L, decode.COP1_FUNC_CVT_D, 4, 2)],
    ['CTC1', copMove(decode.OP_COP1, decode.COP_CT, 2, 31)],
    ['DCFC1', copMove(decode.OP_COP1, decode.COP_DCF, 2, 31)],
    ['DCTC1', copMove(decode.OP_COP1, decode.COP_DCT, 2, 31)],
    ['COP1 reserved format', cop1(0x12, 0, 0, 0, 0)],
    ['BC1 reserved cc', bc1(false, false, 4, 1)],
  ];

  for (const [name, word] of faultingCop1Ops) {
    for (const cop1statusKnown of [false, true]) {
      test(`${name} (cop1statusKnown=${cop1statusKnown}) uses specialized COP1 boilerplate and clears needsDelayCheck`, () => {
        const fragment = compileOp(word, { needsDelayCheck: false, cop1statusKnown });
        expect(fragment.needsDelayCheck).toBe(false);
        expect(fragment.cop1statusKnown).toBe(true);
        expect(fragment.usesCop1).toBe(true);
        expect(fragment.bodyCode).toContain('c.fragmentOps = 0;');
        expect(fragment.bodyCode).toContain('c.nextPC = 0x80001004;');
        expect(fragment.bodyCode).toContain('c.pc = c.nextPC;');
        expect(fragment.bodyCode).toContain('c.delayPC = null;');
        expect(fragment.bodyCode).toContain('if (c.pc !== 0x80001004) { return 1; }');
        expect(fragment.bodyCode).not.toContain('c.branchTarget');
        expect(fragment.bodyCode).not.toContain('if (c.stuffToDo)');
        if (cop1statusKnown) {
          expect(fragment.bodyCode).not.toContain('executeCop1_disabled');
        } else {
          expect(fragment.bodyCode).toContain('executeCop1_disabled');
        }
      });
    }
  }

  const trivialCop1Ops = [
    ['MFC1', copMove(decode.OP_COP1, decode.COP_MF, 2, 4), 'c.execMFC1(2, 4);'],
    ['DMFC1', copMove(decode.OP_COP1, decode.COP_DMF, 2, 4), 'c.execDMFC1(2, 4);'],
    ['MTC1', copMove(decode.OP_COP1, decode.COP_MT, 2, 4), 'c.execMTC1(2, 4);'],
    ['DMTC1', copMove(decode.OP_COP1, decode.COP_DMT, 2, 4), 'c.execDMTC1(2, 4);'],
    ['CFC1', copMove(decode.OP_COP1, decode.COP_CF, 2, 31), 'c.execCFC1(2, 31);'],
    ['MOV.S', cop1(decode.COP1_FMT_S, decode.COP1_FUNC_MOV, 4, 2), 'cpu1.MOV_S(4, 2);'],
    ['MOV.D', cop1(decode.COP1_FMT_D, decode.COP1_FUNC_MOV, 4, 2), 'cpu1.MOV_D(4, 2);'],
    ['CVT.D.W', cop1(decode.COP1_FMT_W, decode.COP1_FUNC_CVT_D, 4, 2), 'cpu1.CVT_D_W(4, 2);'],
  ];

  for (const [name, word, expectedCall] of trivialCop1Ops) {
    test(`${name} uses trivial boilerplate when cop1statusKnown is true`, () => {
      const fragment = compileOp(word, { needsDelayCheck: false, cop1statusKnown: true });
      expect(fragment.needsDelayCheck).toBe(false);
      expect(fragment.usesCop1).toBe(true);
      expect(fragment.bodyCode).toContain(expectedCall);
      expect(fragment.bodyCode).toContain('// Delaying pc update');
      expect(fragment.bodyCode).not.toContain('c.fragmentOps');
      expect(fragment.bodyCode).not.toContain('c.branchTarget');
      expect(fragment.bodyCode).not.toContain('if (c.stuffToDo)');
      expect(fragment.bodyCode).not.toContain('if (c.pc !==');
      expect(fragment.bodyCode).not.toContain('executeCop1_disabled');
    });

    test(`${name} uses COP1 boilerplate with usability check when cop1statusKnown is false`, () => {
      const fragment = compileOp(word, { needsDelayCheck: false, cop1statusKnown: false });
      expect(fragment.needsDelayCheck).toBe(false);
      expect(fragment.cop1statusKnown).toBe(true);
      expect(fragment.usesCop1).toBe(true);
      expect(fragment.bodyCode).toContain('executeCop1_disabled');
      expect(fragment.bodyCode).toContain(expectedCall);
      expect(fragment.bodyCode).toContain('c.fragmentOps = 0;');
      expect(fragment.bodyCode).toContain('c.delayPC = null;');
      expect(fragment.bodyCode).not.toContain('c.branchTarget');
      expect(fragment.bodyCode).not.toContain('if (c.stuffToDo)');
    });
  }

  for (const [name, condition, likely] of [
    ['BC1F', false, false],
    ['BC1T', true, false],
    ['BC1FL', false, true],
    ['BC1TL', true, true],
  ]) {
    test(`${name} uses branch boilerplate when cop1statusKnown is true`, () => {
      const fragment = compileOp(bc1(condition, likely, 4), { needsDelayCheck: false, cop1statusKnown: true });
      expect(fragment.needsDelayCheck).toBe(true);
      expect(fragment.usesCop1).toBe(true);
      expect(fragment.bodyCode).toContain('c.delayPC = 0x80001014;');
      expect(fragment.bodyCode).not.toContain('c.branchTarget');
      expect(fragment.bodyCode).not.toContain('if (c.stuffToDo)');
      expect(fragment.bodyCode).not.toContain('executeCop1_disabled');
      if (likely) {
        expect(fragment.bodyCode).toContain('c.nextPC += 4;');
        expect(fragment.bodyCode).toContain('if (c.pc !== 0x80001004) { return 1; }');
      } else {
        expect(fragment.bodyCode).toContain('c.delayPC = 0x80001008;');
        expect(fragment.bodyCode).toContain('// Skipping pc test');
        expect(fragment.bodyCode).not.toContain('if (c.pc !==');
      }
    });

    test(`${name} uses generic boilerplate with branchTarget when cop1statusKnown is false`, () => {
      const fragment = compileOp(bc1(condition, likely, 4), { needsDelayCheck: false, cop1statusKnown: false });
      expect(fragment.needsDelayCheck).toBe(true);
      expect(fragment.cop1statusKnown).toBe(true);
      expect(fragment.usesCop1).toBe(true);
      expect(fragment.bodyCode).toContain('executeCop1_disabled');
      expect(fragment.bodyCode).toContain('c.branchTarget = 0x80001014;');
      expect(fragment.bodyCode).toContain('c.delayPC = c.branchTarget;');
    });
  }

  test('non-branch COP1 op clears needsDelayCheck so following instructions omit delay checks and form RAM groups', () => {
    const fragment = compileOps([
      cop1(decode.COP1_FMT_S, decode.COP1_FUNC_ADD, 4, 2, 6), // Checks usability + clears needsDelayCheck
      cop1(decode.COP1_FMT_S, decode.COP1_FUNC_MOV, 8, 4),    // Trivial MOV.S delays PC update
      cop1(decode.COP1_FMT_D, decode.COP1_FUNC_MOV, 10, 8),   // Trivial MOV.D delays PC update
      cop1(decode.COP1_FMT_W, decode.COP1_FUNC_CVT_D, 12, 2), // Trivial CVT.D.W delays PC update
      cop1(decode.COP1_FMT_S, decode.COP1_FUNC_C_EQ, 0, 4, 6), // Faulting compare clears needsDelayCheck
      bc1(true, false, 4),                                    // Sequential BC1T skips PC test
      iop(decode.OP_ADDIU, 2, 2, 1),                          // Delay slot of BC1T clears needsDelayCheck
      cop1(decode.COP1_FMT_S, decode.COP1_FUNC_MUL, 4, 2, 6), // Faulting MUL.S keeps needsDelayCheck false
      iop(decode.OP_SW, 4, 2, 0),                             // Coalesces with next SW into guarded RAM group
      iop(decode.OP_SW, 4, 2, 4),
    ]);
    expect(fragment.bodyCode).not.toContain('c.branchTarget');
    expect(fragment.bodyCode).toContain('// Skipping pc test');
    expect(fragment.bodyCode).toContain('Guarded RAM SW group');
    expect(fragment.bodyCode.match(/\/\/ Delaying pc update/g)?.length).toBe(3);
    // Only the first op (entry needsDelayCheck) and the BC1T delay slot should check for a pending delayPC.
    expect(fragment.bodyCode.match(/c\.delayPC \?\?/g)?.length).toBe(1);
    expect(fragment.bodyCode.match(/if \(c\.delayPC !== null\)/g)?.length).toBe(1);
  });
});

for (const profiled of [false, true]) {
  describe(`compiled COP1 specialized boilerplate execution${profiled ? ' with profiling' : ''}`, () => {
    const compare = (words, prepare, train) => compareExecutions(words, prepare, train, profiled);

    for (const fullMode of [false, true]) {
      for (const delay of [false, true]) {
        test(`MOV.S, MOV.D, and CVT.D.W preserve raw NaNs, clear FCSR cause on CVT.D.W, FR=${Number(fullMode)}, delay=${delay}`, async () => {
          const setup = (c, h) => {
            c.setControlU32(regs.controlStatus, 0x20000000 | (fullMode ? 0x04000000 : 0));
            c.cop1ControlChanged();
            const f = h.cpu1;
            // Enable all FPE traps and pre-populate cause bits to verify MOV.S/MOV.D do not trap
            // on sNaN bit patterns and CVT.D.W clears cause bits without trapping.
            f.control[31] = 0x0083ffdc;
            f.store64(f.fsRegIdx64(2), 0xdeadbeef7f800001n); // sNaN in low word, junk in high word
            f.store64(f.fsRegIdx64(4), 0x7ff0000000000001n); // double sNaN
            f.store64(f.fsRegIdx64(6), 0x1234567880000001n); // -2147483647 in low word, junk in high word
          };
          const result = await compare([
            copMove(decode.OP_COP1, decode.COP_MF, 2, 0),
            delay ? iop(decode.OP_BEQ, 0, 0, 1) : 0,
            cop1(decode.COP1_FMT_S, decode.COP1_FUNC_MOV, 8, 2),
            cop1(decode.COP1_FMT_D, decode.COP1_FUNC_MOV, 10, 4),
            cop1(decode.COP1_FMT_W, decode.COP1_FUNC_CVT_D, 12, 6),
            iop(decode.OP_ORI, 0, 3, 0x55),
          ], setup);
          expect(result.cause).toBe(0);
          expect(result.gpr[3]).toBe(0x55n);
          expect(result.fcsr).toBe(0x00800fdc); // Cause bits cleared by CVT.D.W, flags/enables preserved
          expect(result.code).not.toContain('c.branchTarget');
        });
      }
    }

    for (const [name, word] of [
      ['MOV.S', cop1(decode.COP1_FMT_S, decode.COP1_FUNC_MOV, 4, 2)],
      ['MOV.D', cop1(decode.COP1_FMT_D, decode.COP1_FUNC_MOV, 4, 2)],
      ['CVT.D.W', cop1(decode.COP1_FMT_W, decode.COP1_FUNC_CVT_D, 4, 2)],
    ]) {
      test(`${name} rechecks COP1 usability after Status write disables CU1`, async () => {
        const result = await compare([
          copMove(decode.OP_COP1, decode.COP_MF, 2, 0),
          copMove(decode.OP_COP0, decode.COP_MT, 5, regs.controlStatus),
          word,
          iop(decode.OP_ORI, 0, 3, 0x77),
        ], c => c.setRegS32Extend(5, 0), c => c.setRegS32Extend(5, 0x20000000));
        expect(result.cause).toBe(0x1000002c);
        expect(result.epc).toBe(pc + 8);
        expect(result.gpr[3]).toBe(0n);
      });
    }

    for (const [name, condition, likely] of [
      ['BC1F', false, false],
      ['BC1T', true, false],
      ['BC1FL', false, true],
      ['BC1TL', true, true],
    ]) {
      for (const ccSet of [false, true]) {
        for (const trainCcSet of [false, true]) {
          test(`${name} (known CU1) cc=${Number(ccSet)} trained=${Number(trainCcSet)} matches interpreter`, async () => {
            const setup = (c, h, condBit) => {
              h.cpu1.control[31] = condBit ? 0x00800000 : 0;
            };
            const result = await compare([
              copMove(decode.OP_COP1, decode.COP_MF, 2, 0), // Establish cop1statusKnown = true
              bc1(condition, likely, 2),
              iop(decode.OP_ADDIU, 3, 3, 1), // Delay slot
              iop(decode.OP_ADDIU, 3, 3, 10), // Skipped when branch is taken
              iop(decode.OP_ADDIU, 3, 3, 100), // Branch target
            ], (c, h) => setup(c, h, ccSet), (c, h) => setup(c, h, trainCcSet));
            const taken = condition ? ccSet : !ccSet;
            const expected = (taken || !likely ? 1n : 0n) + (taken ? 0n : 10n) + 100n;
            expect(result.gpr[3]).toBe(expected);
            expect(result.code).not.toContain('c.branchTarget');
          });
        }
      }

      for (const delay of [false, true]) {
        test(`${name} raises CpU when COP1 is disabled, delay=${delay}`, async () => {
          const setup = c => {
            c.setControlU32(regs.controlStatus, 0);
            c.cop1ControlChanged();
          };
          const result = await compare([
            delay ? iop(decode.OP_BEQ, 0, 0, 1) : 0,
            bc1(condition, likely, 2),
            iop(decode.OP_ORI, 0, 3, 0x77),
          ], setup);
          expect(result.cause).toBe((0x1000002c | (delay ? 0x80000000 : 0)) >>> 0);
          expect(result.epc).toBe(pc + (delay ? 0 : 4));
          expect(result.gpr[3]).toBe(0n);
        });
      }

      test(`${name} delay-slot memory fault reports branch EPC and BD`, async () => {
        const setup = (c, h, badAddr) => {
          h.cpu1.control[31] = condition ? 0x00800000 : 0; // Ensure branch is taken so likely delay slot runs
          c.setRegS32Extend(5, badAddr ? 0x80003001 : 0x80003000);
        };
        const result = await compare([
          copMove(decode.OP_COP1, decode.COP_MF, 2, 0),
          bc1(condition, likely, 2),
          iop(decode.OP_LW, 5, 3),
          0,
          iop(decode.OP_ORI, 0, 6, 0x77),
        ], (c, h) => setup(c, h, true), (c, h) => setup(c, h, false));
        expect(result.cause).toBe(0x80000010);
        expect(result.epc).toBe(pc + 4);
        expect(result.gpr[6]).toBe(0n);
      });
    }

    for (const delay of [false, true]) {
      test(`reserved BC1 cc!=0 raises FPE Unimplemented, delay=${delay}`, async () => {
        const result = await compare([
          copMove(decode.OP_COP1, decode.COP_MF, 2, 0),
          delay ? iop(decode.OP_BEQ, 0, 0, 1) : 0,
          bc1(false, false, 2, 3),
          iop(decode.OP_ORI, 0, 3, 0x77),
        ]);
        expect(result.cause).toBe((0x3c | (delay ? 0x80000000 : 0)) >>> 0);
        expect(result.epc).toBe(pc + (delay ? 4 : 8));
        expect(result.fcsr & 0x20000).toBe(0x20000);
        expect(result.gpr[3]).toBe(0n);
      });
    }

    test('COP1 arithmetic in a branch delay slot clears delayPC before a subsequent memory group', async () => {
      const setup = (c, h, fault) => {
        h.cpu1.store32(h.cpu1.fsRegIdx32(2), 0x40000000); // 2.0f
        h.cpu1.store32(h.cpu1.ftRegIdx32(4), 0x40400000); // 3.0f
        c.setRegS32Extend(5, fault ? 0x80003001 : 0x80003000);
        c.setRegS32Extend(6, 0x11223344);
      };
      const result = await compare([
        copMove(decode.OP_COP1, decode.COP_MF, 2, 0),
        iop(decode.OP_BEQ, 0, 0, 1),
        cop1(decode.COP1_FMT_S, decode.COP1_FUNC_ADD, 6, 2, 4), // Delay slot: clears delayPC and needsDelayCheck
        iop(decode.OP_SW, 5, 6, 0),
        iop(decode.OP_SW, 5, 6, 4),
      ], (c, h) => setup(c, h, true), (c, h) => setup(c, h, false));
      expect(result.code).toContain('Guarded RAM SW group');
      // Fault at SW must NOT have Cause.BD set because ADD.S completed the delay slot.
      expect(result.cause).toBe(0x14);
      expect(result.epc).toBe(pc + 12);
    });
  });
}
