import { describe, expect, test } from 'bun:test';
import * as regs from './cpu0reg.js';
import * as decode from './decode.js';
import { Fragment } from './fragments.js';
import {
  BOILERPLATE_BRANCH,
  BOILERPLATE_BRANCH_LIKELY,
  BOILERPLATE_COP1,
  BOILERPLATE_GENERIC,
  BOILERPLATE_MEMORY,
  BOILERPLATE_TRIVIAL,
  FACT_ADDIU,
  FACT_AND,
  FACT_ANDI,
  FACT_BOOL32,
  FACT_LUI,
  FACT_NONE,
  FACT_ORI_XORI,
  FACT_OR_XOR,
  FACT_RESET,
  FACT_SIGN32,
  FACT_UNKNOWN64,
  FACT_ZERO32,
  classifyBranch,
  classifyInstruction,
  conservativeMemoryEffects,
  destGpr,
  getOpTraits,
  ignoreCacheOp,
  instructionBailsOut,
  integerMemoryEffects,
  isTrivialInstruction,
  readGprMask,
  uncheckedCop1MemoryEffects,
} from './instruction_classifier.js';
import {
  DEFAULT_PC,
  cacheOp,
  cop1,
  copMove,
  createTestEmulator,
  iop,
  jump,
  regimm,
  special,
} from './test_helpers.js';
import {
  FragmentContext,
  finishCodeGeneration,
  generateCodeForOp,
} from './recompiler.js';

const pc = DEFAULT_PC;

const bc1 = (condition, likely, offset, cc = 0) =>
  ((decode.OP_COP1 << 26) |
    (decode.COP_BC << 21) |
    ((cc & 0x7) << 18) |
    (likely ? 0x20000 : 0) |
    (condition ? 0x10000 : 0) |
    (offset & 0xffff)) >>> 0;

function detectEmittedBoilerplate(code, ctx) {
  if (ctx.isTrivial) {
    expect(code).not.toContain('c.fragmentOps =');
    return BOILERPLATE_TRIVIAL;
  }
  expect(code).toContain('c.fragmentOps =');
  if (code.includes('c.branchTarget = null;')) {
    expect(ctx.needsDelayCheck).toBe(true);
    return BOILERPLATE_GENERIC;
  }
  if (ctx.needsDelayCheck) {
    expect(code).not.toContain('if (c.stuffToDo)');
    return code.includes('c.nextPC = 0x')
      ? BOILERPLATE_BRANCH_LIKELY
      : BOILERPLATE_BRANCH;
  }
  if (code.includes('if (c.stuffToDo)')) {
    return BOILERPLATE_MEMORY;
  }
  return BOILERPLATE_COP1;
}

describe('instruction_classifier equivalence with recompiler', () => {
  test('matches emitted boilerplate, isTrivial, bailsOut, and usesCop1 across all opcode tables', async () => {
    await createTestEmulator();

    const words = [];
    // All 64 primary opcodes with non-trivial register/offset fields
    for (let op = 0; op < 64; op++) {
      words.push(iop(op, 4, 5, 8));
      words.push(iop(op, 4, 4, -1)); // self-branch offset -1 and rs === rt
    }
    // Self-jump and non-self-jump
    words.push(jump(pc, decode.OP_J));
    words.push(jump(pc + 0x100, decode.OP_J));
    words.push(jump(pc, decode.OP_JAL));
    // All 64 SPECIAL function codes
    for (let fn = 0; fn < 64; fn++) {
      words.push(special(fn, 4, 5, 6, 2));
      words.push(special(fn, 0, 5, 6, 0));
    }
    // All 32 REGIMM sub-opcodes
    for (let sub = 0; sub < 32; sub++) {
      words.push(regimm(sub, 4, 8));
    }
    // CACHE sub-opcodes (both I-cache and D-cache)
    for (let op = 0; op < 32; op++) {
      words.push(cacheOp(op, 4, 0));
    }
    // COP0 encodings: WAIT, TLB CO=1, and all 32 copOp values across Count/Compare/Status/Cause
    words.push(0x42000020); // WAIT
    words.push(0x42000018); // ERET
    words.push(0x42000002); // TLBWI
    for (let cop = 0; cop < 32; cop++) {
      for (const reg of [regs.controlCount, regs.controlCompare, regs.controlStatus, regs.controlCause]) {
        words.push(copMove(decode.OP_COP0, cop, 4, reg));
      }
    }
    // COP1 encodings: all 32 copOp values, BC1 variants, and S/D/W/L format functions
    for (let cop = 0; cop < 32; cop++) {
      words.push(copMove(decode.OP_COP1, cop, 4, 2));
    }
    for (const cond of [false, true]) {
      for (const likely of [false, true]) {
        words.push(bc1(cond, likely, 4, 0));
        words.push(bc1(cond, likely, 4, 1));
      }
    }
    for (const fmt of [decode.COP1_FMT_S, decode.COP1_FMT_D, decode.COP1_FMT_W, decode.COP1_FMT_L]) {
      for (let fn = 0; fn < 64; fn++) {
        words.push(cop1(fmt, fn, 2, 4, 6));
      }
    }
    // COP2 encodings
    for (let cop = 0; cop < 32; cop++) {
      words.push(copMove(decode.OP_COP2, cop, 4, 2));
    }

    for (const cop1statusKnown of [false, true]) {
      for (const word of words) {
        const instr = word >>> 0;
        const info = classifyInstruction(instr, { pc, cop1statusKnown });
        const traits = getOpTraits(instr, cop1statusKnown);

        const fragment = new Fragment(pc);
        fragment.opsCompiled = 1;
        fragment.needsDelayCheck = false;
        fragment.cop1statusKnown = cop1statusKnown;

        const ctx = new FragmentContext();
        ctx.set(fragment, pc, instr, pc + 4, pc + 4);

        // Verify FragmentContext is seeded up front by ctx.set() before generateCodeForOp
        expect(ctx.opTraits).toBe(traits);
        expect(ctx.isTrivial).toBe(info.isTrivial);
        expect(ctx.bailOut).toBe(info.bailsOut);

        generateCodeForOp(ctx);
        finishCodeGeneration(ctx);

        const actualBoilerplate = detectEmittedBoilerplate(fragment.bodyCode, ctx);
        expect(info.boilerplate).toBe(actualBoilerplate);
        expect(isTrivialInstruction(instr, cop1statusKnown)).toBe(ctx.isTrivial);
        expect(instructionBailsOut(pc, instr)).toBe(Boolean(fragment.bailedOut));
        expect(info.usesCop1).toBe(fragment.usesCop1);
      }
    }
  });

  test('returns pre-frozen singleton OpTraits objects without allocating per call', () => {
    const t1 = getOpTraits(iop(decode.OP_ADDIU, 4, 5, 1));
    const t2 = getOpTraits(iop(decode.OP_ADDIU, 8, 9, 42));
    expect(t1).toBe(t2);
    expect(Object.isFrozen(t1)).toBe(true);

    const unopt = getOpTraits(iop(decode.OP_ADDIU, 4, 5, 1), false, false);
    expect(unopt.boilerplate).toBe(BOILERPLATE_GENERIC);
    expect(unopt.isTrivial).toBe(false);
    expect(isTrivialInstruction(iop(decode.OP_ADDIU, 4, 5, 1), false, false)).toBe(false);
  });

  test('memoryEffects distinguish integer, checked COP1, unchecked COP1, and COP2 memory ops', () => {
    expect(getOpTraits(iop(decode.OP_LW, 4, 5, 0)).memoryEffects).toBe(integerMemoryEffects);
    expect(getOpTraits(iop(decode.OP_SW, 4, 5, 0)).memoryEffects).toBe(integerMemoryEffects);
    expect(getOpTraits(iop(decode.OP_LWC1, 4, 5, 0), false).memoryEffects).toBe(conservativeMemoryEffects);
    expect(getOpTraits(iop(decode.OP_LWC1, 4, 5, 0), true).memoryEffects).toBe(uncheckedCop1MemoryEffects);
    expect(getOpTraits(iop(decode.OP_LWC2, 4, 5, 0), true).memoryEffects).toBe(conservativeMemoryEffects);
    expect(getOpTraits(iop(decode.OP_ADDIU, 4, 5, 1)).memoryEffects).toBeNull();
  });

  test('destGpr and readGprMask accurately report register reads and writes', () => {
    // NOP reads and writes nothing
    expect(destGpr(0)).toBe(0);
    expect(readGprMask(0)).toBe(0);

    // SLL v0, a0, 4 -> writes v0 (2), reads a0 (4)
    const sll = special(decode.SPECIAL_SLL, 0, 4, 2, 4);
    expect(destGpr(sll)).toBe(2);
    expect(readGprMask(sll)).toBe(1 << 4);

    // ADDU t0, a0, a1 -> writes t0 (8), reads a0 (4) and a1 (5)
    const addu = special(decode.SPECIAL_ADDU, 4, 5, 8);
    expect(destGpr(addu)).toBe(8);
    expect(readGprMask(addu)).toBe(((1 << 4) | (1 << 5)) >>> 0);

    // ADDU r0, r0, a1 -> writing r0 normalizes to 0, reading r0 is ignored
    const adduZero = special(decode.SPECIAL_ADDU, 0, 5, 0);
    expect(destGpr(adduZero)).toBe(0);
    expect(readGprMask(adduZero)).toBe(1 << 5);

    // ADDIU a0, sp, 16 -> writes a0 (4), reads sp (29)
    const addiu = iop(decode.OP_ADDIU, 29, 4, 16);
    expect(destGpr(addiu)).toBe(4);
    expect(readGprMask(addiu)).toBe((1 << 29) >>> 0);

    // LUI t0, 0x8000 -> writes t0 (8), reads nothing
    const lui = iop(decode.OP_LUI, 0, 8, 0x8000);
    expect(destGpr(lui)).toBe(8);
    expect(readGprMask(lui)).toBe(0);

    // LW t1, 8(sp) -> writes t1 (9), reads sp (29)
    const lw = iop(decode.OP_LW, 29, 9, 8);
    expect(destGpr(lw)).toBe(9);
    expect(readGprMask(lw)).toBe((1 << 29) >>> 0);

    // LWL t1, 8(sp) -> merges into t1, so reads both sp (29) and t1 (9)
    const lwl = iop(decode.OP_LWL, 29, 9, 8);
    expect(destGpr(lwl)).toBe(9);
    expect(readGprMask(lwl)).toBe(((1 << 29) | (1 << 9)) >>> 0);

    // SW t1, 8(sp) -> writes nothing, reads sp (29) and t1 (9)
    const sw = iop(decode.OP_SW, 29, 9, 8);
    expect(destGpr(sw)).toBe(0);
    expect(readGprMask(sw)).toBe(((1 << 29) | (1 << 9)) >>> 0);

    // SC t1, 8(sp) -> writes boolean status to t1 (9), reads sp (29) and t1 (9)
    const sc = iop(decode.OP_SC, 29, 9, 8);
    expect(destGpr(sc)).toBe(9);
    expect(readGprMask(sc)).toBe(((1 << 29) | (1 << 9)) >>> 0);

    // JAL -> writes ra (31), reads nothing
    const jal = jump(0x80002000, decode.OP_JAL);
    expect(destGpr(jal)).toBe(31);
    expect(readGprMask(jal)).toBe(0);

    // JALR t9 (rd=ra) -> writes ra (31), reads t9 (25)
    const jalr = special(decode.SPECIAL_JALR, 25, 0, 31);
    expect(destGpr(jalr)).toBe(31);
    expect(readGprMask(jalr)).toBe(1 << 25);

    // JR ra -> writes nothing, reads ra (31)
    const jr = special(decode.SPECIAL_JR, 31, 0, 0);
    expect(destGpr(jr)).toBe(0);
    expect(readGprMask(jr)).toBe((1 << 31) >>> 0);

    // MFC1 v0, f4 -> writes v0 (2), reads no GPR
    const mfc1 = copMove(decode.OP_COP1, decode.COP_MF, 2, 4);
    expect(destGpr(mfc1)).toBe(2);
    expect(readGprMask(mfc1)).toBe(0);

    // MTC1 a0, f4 -> writes no GPR, reads a0 (4)
    const mtc1 = copMove(decode.OP_COP1, decode.COP_MT, 4, 4);
    expect(destGpr(mtc1)).toBe(0);
    expect(readGprMask(mtc1)).toBe(1 << 4);
  });

  test('gprFactRule assignments match GPRFacts transfer categories', () => {
    expect(getOpTraits(special(decode.SPECIAL_ADDU, 4, 5, 6)).gprFactRule).toBe(FACT_SIGN32);
    expect(getOpTraits(special(decode.SPECIAL_SLT, 4, 5, 6)).gprFactRule).toBe(FACT_BOOL32);
    expect(getOpTraits(special(decode.SPECIAL_AND, 4, 5, 6)).gprFactRule).toBe(FACT_AND);
    expect(getOpTraits(special(decode.SPECIAL_OR, 4, 5, 6)).gprFactRule).toBe(FACT_OR_XOR);
    expect(getOpTraits(special(decode.SPECIAL_DADDU, 4, 5, 6)).gprFactRule).toBe(FACT_UNKNOWN64);
    expect(getOpTraits(special(decode.SPECIAL_MULT, 4, 5, 0)).gprFactRule).toBe(FACT_NONE);
    expect(getOpTraits(special(decode.SPECIAL_ADD, 4, 5, 6)).gprFactRule).toBe(FACT_RESET);
    expect(getOpTraits(iop(decode.OP_ADDIU, 4, 5, 1)).gprFactRule).toBe(FACT_ADDIU);
    expect(getOpTraits(iop(decode.OP_ANDI, 4, 5, 1)).gprFactRule).toBe(FACT_ANDI);
    expect(getOpTraits(iop(decode.OP_ORI, 4, 5, 1)).gprFactRule).toBe(FACT_ORI_XORI);
    expect(getOpTraits(iop(decode.OP_LUI, 0, 5, 1)).gprFactRule).toBe(FACT_LUI);
    expect(getOpTraits(iop(decode.OP_LBU, 4, 5, 0)).gprFactRule).toBe(FACT_ZERO32);
  });

  test('classifyBranch classifies unconditional, conditional, register, and likely branches', () => {
    expect(classifyBranch(pc, iop(decode.OP_ADDIU, 4, 5, 1))).toBeNull();

    expect(classifyBranch(pc, jump(0x80002000, decode.OP_JAL))).toEqual({
      kind: 'unconditional',
      likely: false,
      fusable: true,
      condition: null,
      takenPC: 0x80002000,
      notTakenPC: (pc + 8) >>> 0,
      linkReg: 31,
      regSource: 0,
      usesCop1: false,
    });

    // BEQ r4, r4 is unconditional; BEQ r4, r5 is conditional
    expect(classifyBranch(pc, iop(decode.OP_BEQ, 4, 4, 3)).kind).toBe('unconditional');
    expect(classifyBranch(pc, iop(decode.OP_BEQ, 4, 5, 3))).toEqual({
      kind: 'conditional',
      likely: false,
      fusable: true,
      condition: 'beq',
      takenPC: (pc + 4 + 12) >>> 0,
      notTakenPC: (pc + 8) >>> 0,
      linkReg: 0,
      regSource: 0,
      usesCop1: false,
    });

    // BEQL, BNEL, BLEZL, BGTZL, BLTZL, BGEZL are likely and fusable
    expect(classifyBranch(pc, iop(decode.OP_BEQL, 4, 5, 3))).toMatchObject({
      kind: 'conditional',
      likely: true,
      fusable: true,
      condition: 'beq',
    });
    expect(classifyBranch(pc, regimm(decode.REGIMM_BLTZL, 4, 3))).toMatchObject({
      kind: 'conditional',
      likely: true,
      fusable: true,
      condition: 'bltz',
    });

    // BLTZAL and BLTZALL are conditional with linkReg 31 and not fusable
    expect(classifyBranch(pc, regimm(decode.REGIMM_BLTZAL, 4, 3))).toMatchObject({
      kind: 'conditional',
      likely: false,
      fusable: false,
      condition: 'bltz',
      linkReg: 31,
    });
    expect(classifyBranch(pc, regimm(decode.REGIMM_BLTZALL, 4, 3))).toMatchObject({
      kind: 'conditional',
      likely: true,
      fusable: false,
      condition: 'bltz',
      linkReg: 31,
    });

    // BC1T and BC1TL depend on cop1statusKnown for fusability
    expect(classifyBranch(pc, bc1(true, false, 3), false)).toMatchObject({
      kind: 'conditional',
      likely: false,
      fusable: false,
      condition: 'bc1t',
      usesCop1: true,
    });
    expect(classifyBranch(pc, bc1(true, false, 3), true)).toMatchObject({
      kind: 'conditional',
      likely: false,
      fusable: true,
      condition: 'bc1t',
      usesCop1: true,
    });
    expect(classifyBranch(pc, bc1(true, true, 3), false)).toMatchObject({
      kind: 'conditional',
      likely: true,
      fusable: false,
      condition: 'bc1t',
      usesCop1: true,
    });
    expect(classifyBranch(pc, bc1(true, true, 3), true)).toMatchObject({
      kind: 'conditional',
      likely: true,
      fusable: true,
      condition: 'bc1t',
      usesCop1: true,
    });

    // JR $r0 is unconditional to 0; JR $ra is register jump
    expect(classifyBranch(pc, special(decode.SPECIAL_JR, 0, 0, 0))).toMatchObject({
      kind: 'unconditional',
      fusable: true,
      takenPC: 0,
      regSource: 0,
    });
    expect(classifyBranch(pc, special(decode.SPECIAL_JALR, 25, 0, 31))).toMatchObject({
      kind: 'register',
      fusable: true,
      takenPC: null,
      linkReg: 31,
      regSource: 25,
    });
  });

  test('ignoreCacheOp identifies I-cache invalidation ops vs ignored cache ops', () => {
    expect(ignoreCacheOp(0x00)).toBe(false); // I-cache Index Invalidate
    expect(ignoreCacheOp(0x10)).toBe(false); // I-cache Hit Invalidate
    expect(ignoreCacheOp(0x01)).toBe(true);  // D-cache Index Writeback Invalidate
    expect(ignoreCacheOp(0x15)).toBe(true);  // D-cache Hit Writeback Invalidate
  });
});
