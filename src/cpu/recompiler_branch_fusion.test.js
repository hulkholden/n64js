import { afterEach, describe, expect, test } from 'bun:test';
import { setPerformanceProfiling } from '../debug/performance_profile.js';
import * as regs from './cpu0reg.js';
import * as decode from './decode.js';
import { Fragment } from './fragments.js';
import {
  ADDIU_T0_1,
  DEFAULT_PC,
  JR_RA,
  cacheOp,
  captureExecutionSnapshot,
  compileFragmentAt,
  cop1,
  copMove,
  createTestEmulator,
  iop,
  jump,
  regimm,
  resetExecutionState,
  special,
} from './test_helpers.js';
import {
  FragmentContext,
  compileTraceSteps,
  generateCodeForOp,
  isTrivialInstruction,
} from './recompiler.js';

const pc = DEFAULT_PC;

afterEach(() => {
  setPerformanceProfiling(false);
});

const bc1 = (condition, likely, offset, cc = 0) =>
  ((decode.OP_COP1 << 26) |
    (decode.COP_BC << 21) |
    ((cc & 0x7) << 18) |
    (likely ? 0x20000 : 0) |
    (condition ? 0x10000 : 0) |
    (offset & 0xffff)) >>> 0;

function buildFragmentFromSteps(steps, { entryDelayPC = null, selfLoop = false } = {}) {
  const fragment = new Fragment(steps[0].pc);
  fragment.entryDelayPC = entryDelayPC;
  for (const step of steps) {
    fragment.instructionPCs.push(step.pc >>> 0);
    fragment.instructionWords.push(step.instruction >>> 0);
    fragment.traceSteps.push({
      pc: step.pc >>> 0,
      instruction: step.instruction >>> 0,
      postPC: step.postPC >>> 0,
      nextPC: (step.nextPC ?? step.pc + 4) >>> 0,
    });
  }
  const code = compileTraceSteps(fragment, new FragmentContext(), { selfLoop });
  return { fragment, code };
}

async function compareExecutions(
  instructions,
  {
    prepare = () => {},
    train = prepare,
    trainCycles = 12,
    runCycles = trainCycles,
    profiled = false,
  } = {},
) {
  const emulator = await createTestEmulator();
  const { cpu0: cpu, hardware } = emulator;
  const words = [...instructions];
  const minWords = Math.max(trainCycles, runCycles) + 8;
  while (words.length < minWords) {
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

  setPerformanceProfiling(false);
  setup(prepare);
  cpu.run(runCycles);
  const interpreted = snapshot();

  setup(train);
  const fragment = compileFragmentAt(cpu, pc, trainCycles);

  setup(prepare);
  hardware.fragmentCache.fragments.set(pc, fragment);
  setPerformanceProfiling(profiled);
  cpu.run(runCycles);
  expect(fragment.executionCount).toBeGreaterThanOrEqual(1);
  expect(snapshot()).toEqual(interpreted);
  return {
    ...interpreted,
    fragment,
    code: fragment.func.toString(),
  };
}

describe('branch + trivial delay-slot fusion codegen', () => {
  test('isTrivialInstruction matches generateTrivialOpBoilerplate across all opcode tables', async () => {
    await createTestEmulator();
    const candidates = [];

    for (let op = 0; op < 64; op++) {
      candidates.push(iop(op, 2, 3, 4));
    }
    for (let fn = 0; fn < 64; fn++) {
      candidates.push(special(fn, 2, 3, 4, 1));
    }
    candidates.push(0); // NOP
    for (let sub = 0; sub < 32; sub++) {
      candidates.push(regimm(sub, 2, 4));
    }
    for (let cop = 0; cop < 32; cop++) {
      candidates.push(copMove(decode.OP_COP0, cop, 2, 9));
      candidates.push(copMove(decode.OP_COP0, cop, 2, regs.controlStatus));
      candidates.push(copMove(decode.OP_COP0, cop, 2, regs.controlCount));
      candidates.push(copMove(decode.OP_COP1, cop, 2, 4));
      candidates.push(copMove(0x12, cop, 2, 4));
    }
    candidates.push(0x42000020); // WAIT
    candidates.push(0x42000018); // ERET
    candidates.push(0x42000002); // TLBWI
    for (let rtVal = 0; rtVal < 32; rtVal++) {
      candidates.push(cacheOp(rtVal, 4, 0));
    }
    for (const fmt of [decode.COP1_FMT_S, decode.COP1_FMT_D, decode.COP1_FMT_W, decode.COP1_FMT_L, 0x12]) {
      for (let fn = 0; fn < 64; fn++) {
        candidates.push(cop1(fmt, fn, 4, 2, 6));
      }
    }
    for (const cond of [false, true]) {
      for (const likely of [false, true]) {
        candidates.push(bc1(cond, likely, 4, 0));
        candidates.push(bc1(cond, likely, 4, 1));
      }
    }

    for (const cop1statusKnown of [false, true]) {
      for (const word of candidates) {
        const fragment = new Fragment(pc);
        fragment.opsCompiled = 1;
        fragment.needsDelayCheck = false;
        fragment.cop1statusKnown = cop1statusKnown;
        const ctx = new FragmentContext();
        ctx.set(fragment, pc, word >>> 0, pc + 4, pc + 4);
        generateCodeForOp(ctx);
        expect(isTrivialInstruction(word >>> 0, cop1statusKnown)).toBe(ctx.isTrivial);
      }
    }
  });

  test('fuses unconditional jumps (J, JAL, BEQ r,r) with trivial delay slots without touching delayPC on the fast path', () => {
    const target = 0x80001100;
    for (const [branchWord, expectsLink] of [
      [jump(target, decode.OP_J), false],
      [jump(target, decode.OP_JAL), true],
      [iop(decode.OP_BEQ, 0, 0, (target - (pc + 4)) >> 2), false],
      [iop(decode.OP_BEQ, 8, 8, (target - (pc + 4)) >> 2), false],
    ]) {
      const { fragment, code } = buildFragmentFromSteps([
        { pc, instruction: branchWord, postPC: pc + 4 },
        { pc: pc + 4, instruction: iop(decode.OP_ADDIU, 4, 4, 1), postPC: target },
        { pc: target, instruction: iop(decode.OP_ADDIU, 5, 5, 2), postPC: target + 4 },
      ]);
      expect(fragment.needsDelayCheck).toBe(false);
      expect(code).not.toContain('c.fragmentOps');
      expect(code).not.toContain('if (c.delayPC !== null)');
      expect(code).not.toContain('if (c.pc !==');
      // Only the cold interrupt exit inside the delay-slot RSP preamble sets c.delayPC.
      expect(code.match(/c\.delayPC/g)).toHaveLength(1);
      expect(code).toContain(`if (!rsp.halted) { rsp.step(); if (c.stuffToDo) { c.pc = ${pc + 4}; c.delayPC = 0x80001100; return 1; } }`);
      // Both the fused jump+delay and the following ADDIU at target delay their PC updates,
      // so c.pc is written only once at the end of the fragment (plus the 3 cold stuffToDo exits).
      expect(code).toContain('c.pc = 0x80001104;\nreturn 3;');
      expect(code).not.toContain('c.pc = 0x80001100;');
      if (expectsLink) {
        expect(code).toContain('c.gprS32[62] = 0x80001008;\n  c.gprS32[63] = -1;');
      } else {
        expect(code).not.toContain('c.gprS32[62]');
      }
    }
  });

  test('JAL and JALR propagate signExtended32 link register facts into the fused delay slot', () => {
    const target = 0x80001100;
    const { code } = buildFragmentFromSteps([
      { pc, instruction: jump(target, decode.OP_JAL), postPC: pc + 4 },
      { pc: pc + 4, instruction: special(decode.SPECIAL_SRA, 0, 31, 2, 4), postPC: target },
    ]);
    // Because JAL marks RA as signExtended32, SRA v0, ra, 4 uses a 32-bit shift without reading gprU32[63].
    expect(code).toContain('const v = c.gprS32[62] >> 4;');
    expect(code).not.toContain('c.gprU32[63]');
  });

  test('fuses conditional branches (BEQ, BNE, BLEZ, BGTZ, BLTZ, BGEZ, BC1F, BC1T) into a single branchTaken check', () => {
    const target = 0x80001100;
    const off = (target - (pc + 4)) >> 2;
    const cases = [
      [iop(decode.OP_BEQ, 8, 9, off), false],
      [iop(decode.OP_BNE, 8, 9, off), false],
      [iop(decode.OP_BLEZ, 8, 0, off), false],
      [iop(decode.OP_BGTZ, 8, 0, off), false],
      [regimm(decode.REGIMM_BLTZ, 8, off), false],
      [regimm(decode.REGIMM_BGEZ, 8, off), false],
      [bc1(false, false, off), true],
      [bc1(true, false, off), true],
    ];

    for (const [branchWord, needsCop1Prefix] of cases) {
      for (const trainedTaken of [true, false]) {
        const postPC = trainedTaken ? target : pc + 8;
        const offTracePC = trainedTaken ? pc + 8 : target;
        const steps = [];
        if (needsCop1Prefix) {
          steps.push({
            pc: pc - 4,
            instruction: copMove(decode.OP_COP1, decode.COP_MF, 2, 0),
            postPC: pc,
          });
        }
        const branchIdx = steps.length;
        steps.push(
          { pc, instruction: branchWord, postPC: pc + 4 },
          { pc: pc + 4, instruction: iop(decode.OP_ADDIU, 8, 8, -1), postPC },
        );

        const { fragment, code } = buildFragmentFromSteps(steps);
        expect(fragment.needsDelayCheck).toBe(false);
        if (needsCop1Prefix) {
          expect(fragment.usesCop1).toBe(true);
        }
        expect(code).toContain('const branchTaken = ');
        expect(code).toContain(
          `if (!rsp.halted) { rsp.step(); if (c.stuffToDo) { c.pc = ${pc + 4}; c.delayPC = branchTaken ? 0x80001100 : 0x80001008; return ${branchIdx + 1}; } }`,
        );
        expect(code).not.toContain('if (c.delayPC !== null)');
        expect(code).toContain(
          trainedTaken
            ? `if (!branchTaken) { c.pc = 0x80001008; return ${branchIdx + 2}; }`
            : `if (branchTaken) { c.pc = 0x80001100; return ${branchIdx + 2}; }`,
        );
        expect(code).not.toContain(`if (c.pc !== 0x${offTracePC.toString(16)})`);
      }
    }
  });

  test('fuses JR and JALR with trivial delay slots and reads jumpTarget before link write and delay slot', () => {
    const target = 0x80001200;
    const { code: jrCode } = buildFragmentFromSteps([
      { pc, instruction: JR_RA, postPC: pc + 4 },
      { pc: pc + 4, instruction: special(decode.SPECIAL_OR, 16, 0, 31), postPC: target },
    ]);
    expect(jrCode).not.toContain('c.fragmentOps');
    expect(jrCode).not.toContain('if (c.delayPC !== null)');
    expect(jrCode.match(/c\.delayPC/g)).toHaveLength(1);
    const jumpTargetPos = jrCode.indexOf('const jumpTarget = c.getRegU32Lo(31);');
    const rspStepPos = jrCode.indexOf(`c.pc = ${pc + 4}; c.delayPC = jumpTarget; return 1;`);
    const delayWritePos = jrCode.indexOf('c.gprS32[62] = c.gprS32[32];');
    const guardPos = jrCode.indexOf('if (jumpTarget !== 0x80001200) { c.pc = jumpTarget; return 2; }');
    expect(jumpTargetPos).toBeGreaterThan(-1);
    expect(rspStepPos).toBeGreaterThan(jumpTargetPos);
    expect(delayWritePos).toBeGreaterThan(rspStepPos);
    expect(guardPos).toBeGreaterThan(delayWritePos);

    // JALR with rd === rs captures jumpTarget before writing the link address to rd.
    const { code: jalrCode } = buildFragmentFromSteps([
      { pc, instruction: special(decode.SPECIAL_JALR, 25, 0, 25), postPC: pc + 4 },
      { pc: pc + 4, instruction: ADDIU_T0_1, postPC: target },
    ]);
    const jalrReadPos = jalrCode.indexOf('const jumpTarget = c.getRegU32Lo(25);');
    const jalrLinkPos = jalrCode.indexOf('c.gprS32[50] = 0x80001008;');
    const jalrRspPos = jalrCode.indexOf('c.delayPC = jumpTarget;');
    expect(jalrReadPos).toBeGreaterThan(-1);
    expect(jalrLinkPos).toBeGreaterThan(jalrReadPos);
    expect(jalrRspPos).toBeGreaterThan(jalrLinkPos);
  });

  test('forwards comparisons both into a fused conditional branch and out of a fused delay-slot comparison', () => {
    const target1 = 0x80001100;
    const target2 = 0x80001200;
    const { code } = buildFragmentFromSteps([
      // Step 0 (opsCompiled=1): SLT t0, a0, a1 -> sets compare_1
      { pc, instruction: special(decode.SPECIAL_SLT, 4, 5, 8), postPC: pc + 4 },
      // Step 1+2 (opsCompiled=2,3): BNE t0, r0, target1 + SLTIU t1, a2, 10 (sets compare_3)
      { pc: pc + 4, instruction: iop(decode.OP_BNE, 8, 0, (target1 - (pc + 8)) >> 2), postPC: pc + 8 },
      { pc: pc + 8, instruction: iop(decode.OP_SLTIU, 6, 9, 10), postPC: target1 },
      // Step 3+4 (opsCompiled=4,5): BEQ t1, r0, target2 + ADDIU a0, a0, 1
      { pc: target1, instruction: iop(decode.OP_BEQ, 9, 0, (target2 - (target1 + 4)) >> 2), postPC: target1 + 4 },
      { pc: target1 + 4, instruction: iop(decode.OP_ADDIU, 4, 4, 1), postPC: target2 },
    ]);
    expect(code).toContain('var compare_1 = ');
    expect(code).toContain('const branchTaken = compare_1;');
    expect(code).toContain('var compare_3 = ');
    expect(code).toContain('const branchTaken = !compare_3;');
  });

  test('flushes an open RAMAccessGroup before a fused branch and allows a new RAMAccessGroup after the fused pair', () => {
    const target = 0x80001100;
    const { code } = buildFragmentFromSteps([
      { pc, instruction: iop(decode.OP_SW, 4, 8, 0), postPC: pc + 4 },
      { pc: pc + 4, instruction: iop(decode.OP_SW, 4, 9, 4), postPC: pc + 8 },
      { pc: pc + 8, instruction: jump(target, decode.OP_J), postPC: pc + 12 },
      { pc: pc + 12, instruction: ADDIU_T0_1, postPC: target },
      { pc: target, instruction: iop(decode.OP_LW, 4, 10, 0), postPC: target + 4 },
      { pc: target + 4, instruction: iop(decode.OP_LW, 4, 11, 4), postPC: target + 8 },
    ]);
    expect(code).toContain('// Guarded RAM SW group (2 stores)');
    expect(code).toContain('// Guarded RAM LW group (2 loads)');
    expect(code).not.toContain('if (c.delayPC !== null)');
  });

  test('does not fuse Branch-Likely, conditional link branches, non-trivial delay slots, entry delay slots, or unchecked BC1', () => {
    const target = 0x80001100;
    const off = (target - (pc + 4)) >> 2;

    // Branch-Likely (BEQL) is not fused.
    const { code: beqlCode } = buildFragmentFromSteps([
      { pc, instruction: iop(decode.OP_BEQL, 8, 9, off), postPC: pc + 4 },
      { pc: pc + 4, instruction: ADDIU_T0_1, postPC: target },
    ]);
    expect(beqlCode).not.toContain('const branchTaken');
    expect(beqlCode).toContain('if (c.delayPC !== null)');

    // BLTZAL is not fused.
    const { code: bltzalCode } = buildFragmentFromSteps([
      { pc, instruction: regimm(0x10, 8, off), postPC: pc + 4 },
      { pc: pc + 4, instruction: ADDIU_T0_1, postPC: target },
    ]);
    expect(bltzalCode).not.toContain('const branchTaken');
    expect(bltzalCode).toContain('c.execBLTZAL');

    // Non-trivial delay slot (LW) is not fused.
    const { code: lwDelayCode } = buildFragmentFromSteps([
      { pc, instruction: iop(decode.OP_BNE, 8, 9, off), postPC: pc + 4 },
      { pc: pc + 4, instruction: iop(decode.OP_LW, 4, 10, 0), postPC: target },
    ]);
    expect(lwDelayCode).not.toContain('const branchTaken');
    expect(lwDelayCode).toContain('c.nextPC = c.delayPC ?? 0x80001008;');

    // BC1T when cop1statusKnown === false is not fused.
    const { code: uncheckedBc1Code } = buildFragmentFromSteps([
      { pc, instruction: bc1(true, false, off), postPC: pc + 4 },
      { pc: pc + 4, instruction: ADDIU_T0_1, postPC: target },
    ]);
    expect(uncheckedBc1Code).not.toContain('const branchTaken');
    expect(uncheckedBc1Code).toContain('executeCop1_disabled');

    // Entry with entryDelayPC !== null at step 0 is not fused.
    const { code: entryDelayCode } = buildFragmentFromSteps(
      [
        { pc, instruction: jump(target, decode.OP_J), postPC: pc + 4 },
        { pc: pc + 4, instruction: ADDIU_T0_1, postPC: target },
      ],
      { entryDelayPC: pc + 4 },
    );
    expect(entryDelayCode).toContain('if (c.delayPC !== null)');
  });
});

for (const profiled of [false, true]) {
  describe(`compiled fused branch + trivial delay-slot execution${profiled ? ' with profiling' : ''}`, () => {
    const compare = (words, options = {}) =>
      compareExecutions(words, { ...options, profiled });

    test('unconditional J, JAL, and BEQ r,r execute delay-slot ALU ops and update link registers', async () => {
      // 0x80001000: JAL 0x80001010
      // 0x80001004: ADDIU t0, ra, 0x20  (reads new RA = 0x80001008 -> t0 = 0x80001028)
      // 0x80001008: ADDIU t1, t1, 99    (skipped)
      // 0x8000100c: NOP
      // 0x80001010: J 0x80001020
      // 0x80001014: ADDIU t2, t2, 7
      // 0x80001018: ADDIU t1, t1, 99    (skipped)
      // 0x8000101c: NOP
      // 0x80001020: BEQ t2, t2, +2      (-> 0x8000102c)
      // 0x80001024: OR t3, t0, t2
      // 0x80001028: ADDIU t1, t1, 99    (skipped)
      // 0x8000102c: ADDIU t4, t4, 5
      const result = await compare([
        jump(pc + 0x10, decode.OP_JAL),
        iop(decode.OP_ADDIU, 31, 8, 0x20),
        iop(decode.OP_ADDIU, 9, 9, 99),
        0,
        jump(pc + 0x20, decode.OP_J),
        iop(decode.OP_ADDIU, 10, 10, 7),
        iop(decode.OP_ADDIU, 9, 9, 99),
        0,
        iop(decode.OP_BEQ, 10, 10, 2),
        special(decode.SPECIAL_OR, 8, 10, 11),
        iop(decode.OP_ADDIU, 9, 9, 99),
        iop(decode.OP_ADDIU, 12, 12, 5),
      ], { trainCycles: 7 });

      expect(result.gpr[31]).toBe(BigInt.asUintN(64, BigInt((pc + 8) | 0)));
      expect(result.gpr[8]).toBe(BigInt.asUintN(64, BigInt((pc + 0x28) | 0)));
      expect(result.gpr[9]).toBe(0n);
      expect(result.gpr[10]).toBe(7n);
      expect(result.gpr[12]).toBe(5n);
      expect(result.code).not.toContain('if (c.delayPC !== null)');
    });

    test('JAL and JALR delay slots that overwrite the link register preserve the delay-slot result', async () => {
      const result = await compare([
        jump(pc + 0x10, decode.OP_JAL),
        iop(decode.OP_ADDIU, 0, 31, 0x1234), // Overwrites RA after JAL link write
        0,
        0,
        special(decode.SPECIAL_JALR, 16, 0, 17), // JALR s1, s0 (target = pc + 0x20)
        iop(decode.OP_ADDIU, 17, 17, 0x10),       // Increments link reg s1 (0x80001018 + 0x10)
        0,
        0,
        iop(decode.OP_ADDIU, 18, 18, 0x55),
      ], {
        prepare: c => c.setRegS32Extend(16, pc + 0x20),
        trainCycles: 5,
      });

      expect(result.gpr[31]).toBe(0x1234n);
      expect(result.gpr[17]).toBe(BigInt.asUintN(64, BigInt((pc + 0x28) | 0)));
      expect(result.gpr[18]).toBe(0x55n);
    });

    for (const [name, branchWord, takenSetup, untakenSetup] of [
      [
        'BEQ (64-bit high-word mismatch)',
        iop(decode.OP_BEQ, 8, 9, 2),
        c => { c.gprU64[8] = 0x11111111_22222222n; c.gprU64[9] = 0x11111111_22222222n; },
        c => { c.gprU64[8] = 0x11111111_22222222n; c.gprU64[9] = 0x99999999_22222222n; },
      ],
      [
        'BNE (delay slot modifies rs from 1 to 0)',
        iop(decode.OP_BNE, 8, 0, 2),
        c => c.setRegS32Extend(8, 1),
        c => c.setRegS32Extend(8, 0),
      ],
      [
        'BLEZ',
        iop(decode.OP_BLEZ, 8, 0, 2),
        c => c.setRegS32Extend(8, 0),
        c => c.setRegS32Extend(8, 1),
      ],
      [
        'BGTZ (delay slot decrements rs from 1 to 0)',
        iop(decode.OP_BGTZ, 8, 0, 2),
        c => c.setRegS32Extend(8, 1),
        c => c.setRegS32Extend(8, 0),
      ],
      [
        'BLTZ',
        regimm(decode.REGIMM_BLTZ, 8, 2),
        c => c.setRegS32Extend(8, -1),
        c => c.setRegS32Extend(8, 0),
      ],
      [
        'BGEZ (delay slot decrements rs from 0 to -1)',
        regimm(decode.REGIMM_BGEZ, 8, 2),
        c => c.setRegS32Extend(8, 0),
        c => c.setRegS32Extend(8, -1),
      ],
    ]) {
      for (const trainTaken of [false, true]) {
        for (const runTaken of [false, true]) {
          test(`${name} trainedTaken=${trainTaken} runTaken=${runTaken} matches interpreter`, async () => {
            const result = await compare([
              branchWord,
              iop(decode.OP_ADDIU, 8, 8, -1),   // Delay slot modifies rs ($t0)
              iop(decode.OP_ADDIU, 10, 10, 10), // Executed only when not taken
              iop(decode.OP_ADDIU, 10, 10, 100),// Target when taken
            ], {
              train: trainTaken ? takenSetup : untakenSetup,
              prepare: runTaken ? takenSetup : untakenSetup,
              trainCycles: 4,
            });
            expect(result.gpr[10]).toBe(runTaken ? 100n : 110n);
            expect(result.code).toContain('const branchTaken = ');
            expect(result.code).not.toContain('if (c.delayPC !== null)');
          });
        }
      }
    }

    for (const trainMatch of [true, false]) {
      test(`JR and JALR with delay slot modifying rs match interpreter (runtime matches training=${trainMatch})`, async () => {
        const targetA = pc + 0x18;
        const targetB = pc + 0x20;
        const result = await compare([
          // Epilogue pattern: JR ra; OR ra, s0, r0 (restores caller's ra in delay slot)
          JR_RA,
          special(decode.SPECIAL_OR, 16, 0, 31),
          0,
          0,
          0,
          0,
          // targetA (0x80001018):
          iop(decode.OP_ADDIU, 10, 10, 11),
          0,
          // targetB (0x80001020):
          iop(decode.OP_ADDIU, 10, 10, 22),
        ], {
          train: c => {
            c.setRegS32Extend(31, targetA);
            c.setRegS32Extend(16, 0x80009990);
          },
          prepare: c => {
            c.setRegS32Extend(31, trainMatch ? targetA : targetB);
            c.setRegS32Extend(16, 0x80009990);
          },
          trainCycles: 4,
        });
        expect(result.gpr[31]).toBe(BigInt.asUintN(64, BigInt(0x80009990 | 0)));
        expect(result.gpr[10]).toBe(trainMatch ? 11n : 22n);
        expect(result.code).toContain('const jumpTarget = c.getRegU32Lo(31);');
      });
    }

    test('JALR rd === rs with delay slot reading rd sees link address in delay slot while jumping to old rs', async () => {
      const target = pc + 0x10;
      const result = await compare([
        special(decode.SPECIAL_JALR, 25, 0, 25), // JALR t9, t9
        special(decode.SPECIAL_OR, 25, 0, 11),   // Delay slot: OR t3, t9, r0 (reads link value pc + 8)
        iop(decode.OP_ADDIU, 12, 12, 99),        // Skipped
        0,
        iop(decode.OP_ADDIU, 12, 12, 7),         // Target at pc + 0x10
      ], {
        prepare: c => c.setRegS32Extend(25, target),
        trainCycles: 3,
      });
      const expectedLink = BigInt.asUintN(64, BigInt((pc + 8) | 0));
      expect(result.gpr[25]).toBe(expectedLink);
      expect(result.gpr[11]).toBe(expectedLink);
      expect(result.gpr[12]).toBe(7n);
    });

    test('comparison forwarding into a fused branch and out of a fused delay slot matches interpreter when delay slot clobbers compare reg', async () => {
      for (const [a0, a1, a2] of [
        [1, 5, 3],
        [5, 1, 3],
        [1, 5, 20],
        [5, 1, 20],
      ]) {
        const result = await compare([
          // 0x80001000: SLT t0, a0, a1
          special(decode.SPECIAL_SLT, 4, 5, 8),
          // 0x80001004: BNE t0, r0, +2 (-> 0x80001010)
          iop(decode.OP_BNE, 8, 0, 2),
          // 0x80001008: SLTIU t0, a2, 10 (delay slot overwrites t0 AND forwards compare_3!)
          iop(decode.OP_SLTIU, 6, 8, 10),
          // 0x8000100c: ADDIU v0, v0, 100 (fallthrough if a0 >= a1)
          iop(decode.OP_ADDIU, 2, 2, 100),
          // 0x80001010: BEQ t0, r0, +2 (-> 0x8000101c)
          iop(decode.OP_BEQ, 8, 0, 2),
          // 0x80001014: ADDIU v1, v1, 1 (delay slot)
          iop(decode.OP_ADDIU, 3, 3, 1),
          // 0x80001018: ADDIU v0, v0, 10 (fallthrough if a2 < 10)
          iop(decode.OP_ADDIU, 2, 2, 10),
          // 0x8000101c: ADDIU v0, v0, 1
          iop(decode.OP_ADDIU, 2, 2, 1),
        ], {
          train: c => {
            c.setRegS32Extend(4, 1);
            c.setRegS32Extend(5, 5);
            c.setRegS32Extend(6, 20);
          },
          prepare: c => {
            c.setRegS32Extend(4, a0);
            c.setRegS32Extend(5, a1);
            c.setRegS32Extend(6, a2);
          },
          trainCycles: 6,
          runCycles: 8,
        });
        expect(result.gpr[8]).toBe(a2 < 10 ? 1n : 0n);
      }
    });

    for (const [name, words, prepareTaken, prepareUntaken] of [
      [
        'JAL + ADDIU',
        [
          jump(pc + 0x10, decode.OP_JAL),
          iop(decode.OP_ADDIU, 8, 8, 5),
          0,
          0,
          iop(decode.OP_ADDIU, 9, 9, 7),
        ],
        () => {},
        null,
      ],
      [
        'BNE + ADDIU',
        [
          iop(decode.OP_BNE, 8, 0, 3),
          iop(decode.OP_ADDIU, 8, 8, -1),
          iop(decode.OP_ADDIU, 9, 9, 10),
          0,
          iop(decode.OP_ADDIU, 9, 9, 20),
        ],
        c => c.setRegS32Extend(8, 1),
        c => c.setRegS32Extend(8, 0),
      ],
      [
        'JALR + OR',
        [
          special(decode.SPECIAL_JALR, 16, 0, 31),
          special(decode.SPECIAL_OR, 17, 0, 16),
          0,
          0,
          iop(decode.OP_ADDIU, 9, 9, 30),
        ],
        c => {
          c.setRegS32Extend(16, pc + 0x10);
          c.setRegS32Extend(17, 0x80002000);
        },
        null,
      ],
    ]) {
      const variants = prepareUntaken ? [prepareTaken, prepareUntaken] : [prepareTaken];
      for (const prep of variants) {
        for (const breakStep of [1, 2]) {
          test(`${name} active RSP break interrupt at RSP step ${breakStep} preserves exact EPC, BD, delayPC, and link state`, async () => {
            const result = await compare(words, {
              train: c => {
                prep(c);
              },
              prepare: (c, h) => {
                prep(c);
                // Enable CPU interrupts + IE + IM2 (RCP), MI SP mask, and SP interrupt-on-break.
                c.setControlU32(regs.controlStatus, 0x20000401);
                c.statusRegisterChanged();
                h.mi_reg.set32(0xc, 1);
                h.sp_reg.set32(0x10, 0x40);
                // RSP executes NOPs before BREAK (0x0000000d) at `breakStep`.
                for (let i = 0; i < 8; i++) {
                  h.sp_mem.set32(0x1000 + i * 4, i + 1 === breakStep ? 0x0000000d : 0);
                }
                h.rsp.unhalt();
              },
              trainCycles: 3,
              runCycles: 3,
            });
            // When breakStep === 2, the interrupt occurs right before the delay-slot instruction,
            // so serviceInterrupts enters the exception handler with Cause.BD set and EPC === branchPC!
            if (breakStep === 2) {
              expect((result.cause >>> 31) & 1).toBe(1);
              expect(result.epc).toBe(pc);
            } else {
              expect((result.cause >>> 31) & 1).toBe(0);
              expect(result.epc).toBe(pc);
            }
          });
        }
      }
    }

    test('self-looping fragment with fused internal branch and fused back-edge branch matches interpreter across exits and RSP interrupts', async () => {
      // 4-op self-loop at 0x80001000:
      //   0x80001000: BEQ   t0, t2, early_out (+4 -> 0x80001014)
      //   0x80001004: ADDIU t0, t0, 1         (delay slot of BEQ)
      //   0x80001008: BNE   t0, t1, loop      (-3 -> 0x80001000)
      //   0x8000100c: ADDIU t3, t3, 10        (delay slot of BNE)
      //   0x80001010: ADDIU t4, t4, 50        (normal loop exit)
      //   0x80001014: ADDIU t4, t4, 7         (early_out target)
      const words = [
        iop(decode.OP_BEQ, 8, 10, 4),
        iop(decode.OP_ADDIU, 8, 8, 1),
        iop(decode.OP_BNE, 8, 9, -3),
        iop(decode.OP_ADDIU, 11, 11, 10),
        iop(decode.OP_ADDIU, 12, 12, 50),
        iop(decode.OP_ADDIU, 12, 12, 7),
      ];

      for (const scenario of ['normal', 'early-out', 'rsp-break-step-6']) {
        const result = await compare(words, {
          train: c => {
            c.setRegS32Extend(8, 0);
            c.setRegS32Extend(9, 5);
            c.setRegS32Extend(10, 99);
          },
          prepare: (c, h) => {
            c.setRegS32Extend(8, 0);
            c.setRegS32Extend(9, 5);
            c.setRegS32Extend(10, scenario === 'early-out' ? 2 : 99);
            if (scenario === 'rsp-break-step-6') {
              // Step 6 is the delay slot of BNE on iteration 2 (opsBefore = 4 + 1 = 5).
              c.setControlU32(regs.controlStatus, 0x20000401);
              c.statusRegisterChanged();
              h.mi_reg.set32(0xc, 1);
              h.sp_reg.set32(0x10, 0x40);
              for (let i = 0; i < 8; i++) {
                h.sp_mem.set32(0x1000 + i * 4, i === 5 ? 0x0000000d : 0);
              }
              h.rsp.unhalt();
            }
          },
          trainCycles: 4,
          runCycles: 24,
        });
        expect(result.code).toContain('do {');
        expect(result.code.match(/const branchTaken/g)).toHaveLength(2);
        expect(result.code).not.toContain('if (c.delayPC !== null)');
      }
    });
  });
}
