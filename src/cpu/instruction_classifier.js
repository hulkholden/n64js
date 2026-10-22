import * as cpu0reg from './cpu0reg.js';
import { kSpeedHackEnabled } from '../options.js';
import {
  OP_SPECIAL, OP_REGIMM, OP_J, OP_JAL, OP_BEQ, OP_BNE, OP_BLEZ, OP_BGTZ,
  OP_COP0, OP_COP1, OP_COP2,
  OP_BEQL, OP_BNEL, OP_BLEZL, OP_BGTZL,
  OP_CACHE, OP_LWC1, OP_LDC1, OP_SWC1, OP_SDC1,
  REGIMM_BLTZ, REGIMM_BGEZ, REGIMM_BLTZL, REGIMM_BGEZL,
  REGIMM_BLTZAL, REGIMM_BGEZAL, REGIMM_BLTZALL, REGIMM_BGEZALL,
  SPECIAL_JR, SPECIAL_JALR,
  COP_MF, COP_DMF, COP_CF, COP_MT, COP_DMT, COP_CT, COP_DCT, COP_BC,
  COP1_FMT_S, COP1_FMT_D, COP1_FMT_W,
  COP1_FUNC_MOV, COP1_FUNC_CVT_D,
  simpleOp, regImmOp, specialOp, copOp, isWait, copFmtFuncOp,
  fs, offset, rd, rt, rs, branchAddress, jumpAddress,
} from './decode.js';

// Dynarec code-generation boilerplate categories.
export const BOILERPLATE_TRIVIAL = 'trivial';
export const BOILERPLATE_BRANCH = 'branch';
export const BOILERPLATE_BRANCH_LIKELY = 'branch_likely';
export const BOILERPLATE_MEMORY = 'memory';
export const BOILERPLATE_COP1 = 'cop1';
export const BOILERPLATE_GENERIC = 'generic';

// Architectural GPR destination field selectors.
export const DEST_NONE = 0;
export const DEST_RT = 1;
export const DEST_RD = 2;
export const DEST_RA = 3;

// Architectural GPR source field bitmask selectors.
export const READ_NONE = 0;
export const READ_RS = 1;
export const READ_RT = 2;
export const READ_RS_RT = READ_RS | READ_RT;

// GPRFacts abstract-interpretation update rules.
export const FACT_NONE = 'none';
export const FACT_SIGN32 = 'sign32';
export const FACT_ZERO32 = 'zero32';
export const FACT_BOOL32 = 'bool32';
export const FACT_UNKNOWN64 = 'unknown64';
export const FACT_AND = 'and';
export const FACT_OR_XOR = 'or_xor';
export const FACT_ADDIU = 'addiu';
export const FACT_ANDI = 'andi';
export const FACT_ORI_XORI = 'ori_xori';
export const FACT_LUI = 'lui';
export const FACT_RESET = 'reset';

// Helper effects audited through r4300.js, memaccess.js and the device
// handlers. mayChangeNextPC describes normal return only. Integer alignment/TLB
// exceptions change nextPC but throw;
// MMIO may request interrupt service, and MMIO stores to SP_STATUS_REG may
// start or stop the RSP, without changing nextPC.
// Keep exception PC/fragmentOps materialization and the post-access stuffToDo
// check: servicing an interrupt must precede the following rsp.step().
export const integerLoadEffects = Object.freeze({
  mayThrow: true,
  mayChangeNextPC: false,
  maySetStuffToDo: true,
  mayStartRSP: false,
});

export const integerStoreEffects = Object.freeze({
  ...integerLoadEffects,
  mayStartRSP: true,
});

export const integerMemoryEffects = integerStoreEffects;

// execLWC1/LDC1/SWC1/SDC1Unchecked only move raw bits using the current FR
// mapping and the same memory paths as integer loads/stores. Alignment/TLB
// exceptions throw; normal returns cannot change nextPC or introduce a delay.
// MMIO stores can still request an interrupt or start the RSP. This audit does
// not cover COP1 arithmetic/compare helpers, whose FPU exceptions return normally.
export const uncheckedCop1LoadEffects = integerLoadEffects;
export const uncheckedCop1StoreEffects = integerStoreEffects;
export const uncheckedCop1MemoryEffects = uncheckedCop1StoreEffects;

export const cop2LoadEffects = Object.freeze({
  ...integerLoadEffects,
  mayChangeNextPC: true,
});

// Unknown helpers (including COP2 usability exceptions) may redirect and return.
export const conservativeMemoryEffects = Object.freeze({
  ...integerStoreEffects,
  mayChangeNextPC: true,
});

function makeTraits({
  boilerplate,
  destField = DEST_NONE,
  readFields = READ_NONE,
  gprFactRule = FACT_RESET,
  usesCop1 = false,
  memoryEffects = null,
}) {
  const isTrivial = boilerplate === BOILERPLATE_TRIVIAL;
  const mayThrow = boilerplate === BOILERPLATE_MEMORY || boilerplate === BOILERPLATE_GENERIC;
  const maySetStuffToDo = boilerplate === BOILERPLATE_MEMORY || boilerplate === BOILERPLATE_GENERIC;
  const mayChangeNextPC =
    boilerplate === BOILERPLATE_BRANCH_LIKELY ||
    boilerplate === BOILERPLATE_COP1 ||
    boilerplate === BOILERPLATE_GENERIC ||
    (boilerplate === BOILERPLATE_MEMORY && Boolean(memoryEffects?.mayChangeNextPC));

  return Object.freeze({
    boilerplate,
    isTrivial,
    mayThrow,
    maySetStuffToDo,
    mayChangeNextPC,
    usesCop1,
    memoryEffects,
    destField,
    readFields,
    gprFactRule,
  });
}

// Pre-frozen trait descriptors for all static instruction classes.
const TRAIT_GENERIC_UNOPTIMISED = makeTraits({
  boilerplate: BOILERPLATE_GENERIC,
  destField: DEST_NONE,
  readFields: READ_RS_RT,
  gprFactRule: FACT_RESET,
});

const TRAIT_GENERIC_RESERVED = makeTraits({
  boilerplate: BOILERPLATE_GENERIC,
  destField: DEST_NONE,
  readFields: READ_NONE,
  gprFactRule: FACT_RESET,
});

const TRAIT_GENERIC_TRAP_RS_RT = makeTraits({
  boilerplate: BOILERPLATE_GENERIC,
  destField: DEST_NONE,
  readFields: READ_RS_RT,
  gprFactRule: FACT_RESET,
});

const TRAIT_GENERIC_TRAP_RS = makeTraits({
  boilerplate: BOILERPLATE_GENERIC,
  destField: DEST_NONE,
  readFields: READ_RS,
  gprFactRule: FACT_RESET,
});

const TRAIT_GENERIC_OVERFLOW_RD = makeTraits({
  boilerplate: BOILERPLATE_GENERIC,
  destField: DEST_RD,
  readFields: READ_RS_RT,
  gprFactRule: FACT_RESET,
});

const TRAIT_GENERIC_OVERFLOW_RT = makeTraits({
  boilerplate: BOILERPLATE_GENERIC,
  destField: DEST_RT,
  readFields: READ_RS,
  gprFactRule: FACT_RESET,
});

const TRAIT_GENERIC_BRANCH_LINK_REGIMM = makeTraits({
  boilerplate: BOILERPLATE_GENERIC,
  destField: DEST_RA,
  readFields: READ_RS,
  gprFactRule: FACT_RESET,
});

const TRAIT_TRIVIAL_NOP = makeTraits({
  boilerplate: BOILERPLATE_TRIVIAL,
  destField: DEST_NONE,
  readFields: READ_NONE,
  gprFactRule: FACT_RESET,
});

const TRAIT_TRIVIAL_CACHE_IGNORED = makeTraits({
  boilerplate: BOILERPLATE_TRIVIAL,
  destField: DEST_NONE,
  readFields: READ_RS,
  gprFactRule: FACT_RESET,
});

const TRAIT_GENERIC_CACHE_ACTIVE = makeTraits({
  boilerplate: BOILERPLATE_GENERIC,
  destField: DEST_NONE,
  readFields: READ_RS,
  gprFactRule: FACT_RESET,
});

const TRAIT_TRIVIAL_SHIFT_IMM_SIGN32 = makeTraits({
  boilerplate: BOILERPLATE_TRIVIAL,
  destField: DEST_RD,
  readFields: READ_RT,
  gprFactRule: FACT_SIGN32,
});

const TRAIT_TRIVIAL_SHIFT_IMM_UNKNOWN64 = makeTraits({
  boilerplate: BOILERPLATE_TRIVIAL,
  destField: DEST_RD,
  readFields: READ_RT,
  gprFactRule: FACT_UNKNOWN64,
});

const TRAIT_TRIVIAL_ALU_SIGN32 = makeTraits({
  boilerplate: BOILERPLATE_TRIVIAL,
  destField: DEST_RD,
  readFields: READ_RS_RT,
  gprFactRule: FACT_SIGN32,
});

const TRAIT_TRIVIAL_ALU_UNKNOWN64 = makeTraits({
  boilerplate: BOILERPLATE_TRIVIAL,
  destField: DEST_RD,
  readFields: READ_RS_RT,
  gprFactRule: FACT_UNKNOWN64,
});

const TRAIT_TRIVIAL_ALU_BOOL32 = makeTraits({
  boilerplate: BOILERPLATE_TRIVIAL,
  destField: DEST_RD,
  readFields: READ_RS_RT,
  gprFactRule: FACT_BOOL32,
});

const TRAIT_TRIVIAL_AND = makeTraits({
  boilerplate: BOILERPLATE_TRIVIAL,
  destField: DEST_RD,
  readFields: READ_RS_RT,
  gprFactRule: FACT_AND,
});

const TRAIT_TRIVIAL_OR_XOR = makeTraits({
  boilerplate: BOILERPLATE_TRIVIAL,
  destField: DEST_RD,
  readFields: READ_RS_RT,
  gprFactRule: FACT_OR_XOR,
});

const TRAIT_TRIVIAL_MFHILO = makeTraits({
  boilerplate: BOILERPLATE_TRIVIAL,
  destField: DEST_RD,
  readFields: READ_NONE,
  gprFactRule: FACT_UNKNOWN64,
});

const TRAIT_TRIVIAL_MTHILO = makeTraits({
  boilerplate: BOILERPLATE_TRIVIAL,
  destField: DEST_NONE,
  readFields: READ_RS,
  gprFactRule: FACT_NONE,
});

const TRAIT_TRIVIAL_MULDIV = makeTraits({
  boilerplate: BOILERPLATE_TRIVIAL,
  destField: DEST_NONE,
  readFields: READ_RS_RT,
  gprFactRule: FACT_NONE,
});

const TRAIT_TRIVIAL_ADDIU = makeTraits({
  boilerplate: BOILERPLATE_TRIVIAL,
  destField: DEST_RT,
  readFields: READ_RS,
  gprFactRule: FACT_ADDIU,
});

const TRAIT_TRIVIAL_SLTI = makeTraits({
  boilerplate: BOILERPLATE_TRIVIAL,
  destField: DEST_RT,
  readFields: READ_RS,
  gprFactRule: FACT_BOOL32,
});

const TRAIT_TRIVIAL_ANDI = makeTraits({
  boilerplate: BOILERPLATE_TRIVIAL,
  destField: DEST_RT,
  readFields: READ_RS,
  gprFactRule: FACT_ANDI,
});

const TRAIT_TRIVIAL_ORI_XORI = makeTraits({
  boilerplate: BOILERPLATE_TRIVIAL,
  destField: DEST_RT,
  readFields: READ_RS,
  gprFactRule: FACT_ORI_XORI,
});

const TRAIT_TRIVIAL_LUI = makeTraits({
  boilerplate: BOILERPLATE_TRIVIAL,
  destField: DEST_RT,
  readFields: READ_NONE,
  gprFactRule: FACT_LUI,
});

const TRAIT_TRIVIAL_DADDIU = makeTraits({
  boilerplate: BOILERPLATE_TRIVIAL,
  destField: DEST_RT,
  readFields: READ_RS,
  gprFactRule: FACT_UNKNOWN64,
});

const TRAIT_BRANCH_J = makeTraits({
  boilerplate: BOILERPLATE_BRANCH,
  destField: DEST_NONE,
  readFields: READ_NONE,
  gprFactRule: FACT_NONE,
});

const TRAIT_BRANCH_JAL = makeTraits({
  boilerplate: BOILERPLATE_BRANCH,
  destField: DEST_RA,
  readFields: READ_NONE,
  gprFactRule: FACT_SIGN32,
});

const TRAIT_BRANCH_JR = makeTraits({
  boilerplate: BOILERPLATE_BRANCH,
  destField: DEST_NONE,
  readFields: READ_RS,
  gprFactRule: FACT_NONE,
});

const TRAIT_BRANCH_JALR = makeTraits({
  boilerplate: BOILERPLATE_BRANCH,
  destField: DEST_RD,
  readFields: READ_RS,
  gprFactRule: FACT_SIGN32,
});

const TRAIT_BRANCH_EQ = makeTraits({
  boilerplate: BOILERPLATE_BRANCH,
  destField: DEST_NONE,
  readFields: READ_RS_RT,
  gprFactRule: FACT_NONE,
});

const TRAIT_BRANCH_ZERO = makeTraits({
  boilerplate: BOILERPLATE_BRANCH,
  destField: DEST_NONE,
  readFields: READ_RS,
  gprFactRule: FACT_NONE,
});

const TRAIT_BRANCH_REGIMM = makeTraits({
  boilerplate: BOILERPLATE_BRANCH,
  destField: DEST_NONE,
  readFields: READ_RS,
  gprFactRule: FACT_RESET,
});

const TRAIT_BRANCH_LIKELY_EQ = makeTraits({
  boilerplate: BOILERPLATE_BRANCH_LIKELY,
  destField: DEST_NONE,
  readFields: READ_RS_RT,
  gprFactRule: FACT_NONE,
});

const TRAIT_BRANCH_LIKELY_ZERO = makeTraits({
  boilerplate: BOILERPLATE_BRANCH_LIKELY,
  destField: DEST_NONE,
  readFields: READ_RS,
  gprFactRule: FACT_NONE,
});

const TRAIT_BRANCH_LIKELY_REGIMM = makeTraits({
  boilerplate: BOILERPLATE_BRANCH_LIKELY,
  destField: DEST_NONE,
  readFields: READ_RS,
  gprFactRule: FACT_RESET,
});

const TRAIT_MEM_LOAD_SIGN32 = makeTraits({
  boilerplate: BOILERPLATE_MEMORY,
  destField: DEST_RT,
  readFields: READ_RS,
  gprFactRule: FACT_SIGN32,
  memoryEffects: integerLoadEffects,
});

const TRAIT_MEM_LOAD_MERGE_SIGN32 = makeTraits({
  boilerplate: BOILERPLATE_MEMORY,
  destField: DEST_RT,
  readFields: READ_RS_RT,
  gprFactRule: FACT_SIGN32,
  memoryEffects: integerLoadEffects,
});

const TRAIT_MEM_LOAD_ZERO32 = makeTraits({
  boilerplate: BOILERPLATE_MEMORY,
  destField: DEST_RT,
  readFields: READ_RS,
  gprFactRule: FACT_ZERO32,
  memoryEffects: integerLoadEffects,
});

const TRAIT_MEM_LOAD_UNKNOWN64 = makeTraits({
  boilerplate: BOILERPLATE_MEMORY,
  destField: DEST_RT,
  readFields: READ_RS,
  gprFactRule: FACT_UNKNOWN64,
  memoryEffects: integerLoadEffects,
});

const TRAIT_MEM_LOAD_MERGE_UNKNOWN64 = makeTraits({
  boilerplate: BOILERPLATE_MEMORY,
  destField: DEST_RT,
  readFields: READ_RS_RT,
  gprFactRule: FACT_UNKNOWN64,
  memoryEffects: integerLoadEffects,
});

const TRAIT_MEM_STORE_INT = makeTraits({
  boilerplate: BOILERPLATE_MEMORY,
  destField: DEST_NONE,
  readFields: READ_RS_RT,
  gprFactRule: FACT_NONE,
  memoryEffects: integerStoreEffects,
});

const TRAIT_MEM_STORE_COND = makeTraits({
  boilerplate: BOILERPLATE_MEMORY,
  destField: DEST_RT,
  readFields: READ_RS_RT,
  gprFactRule: FACT_BOOL32,
  memoryEffects: integerStoreEffects,
});

const TRAIT_MEM_COP1_LOAD_CHECKED = makeTraits({
  boilerplate: BOILERPLATE_MEMORY,
  destField: DEST_NONE,
  readFields: READ_RS,
  gprFactRule: FACT_RESET,
  usesCop1: true,
  memoryEffects: cop2LoadEffects,
});

const TRAIT_MEM_COP1_LOAD_UNCHECKED = makeTraits({
  boilerplate: BOILERPLATE_MEMORY,
  destField: DEST_NONE,
  readFields: READ_RS,
  gprFactRule: FACT_RESET,
  usesCop1: true,
  memoryEffects: uncheckedCop1LoadEffects,
});

const TRAIT_MEM_COP1_STORE_CHECKED = makeTraits({
  boilerplate: BOILERPLATE_MEMORY,
  destField: DEST_NONE,
  readFields: READ_RS,
  gprFactRule: FACT_RESET,
  usesCop1: true,
  memoryEffects: conservativeMemoryEffects,
});

const TRAIT_MEM_COP1_STORE_UNCHECKED = makeTraits({
  boilerplate: BOILERPLATE_MEMORY,
  destField: DEST_NONE,
  readFields: READ_RS,
  gprFactRule: FACT_RESET,
  usesCop1: true,
  memoryEffects: uncheckedCop1StoreEffects,
});

const TRAIT_MEM_COP2_LOAD = makeTraits({
  boilerplate: BOILERPLATE_MEMORY,
  destField: DEST_NONE,
  readFields: READ_RS,
  gprFactRule: FACT_RESET,
  memoryEffects: cop2LoadEffects,
});

const TRAIT_MEM_COP2_STORE = makeTraits({
  boilerplate: BOILERPLATE_MEMORY,
  destField: DEST_NONE,
  readFields: READ_RS,
  gprFactRule: FACT_RESET,
  memoryEffects: conservativeMemoryEffects,
});

const TRAIT_COP_MF_GENERIC = makeTraits({
  boilerplate: BOILERPLATE_GENERIC,
  destField: DEST_RT,
  readFields: READ_NONE,
  gprFactRule: FACT_RESET,
});

const TRAIT_COP_MT_GENERIC = makeTraits({
  boilerplate: BOILERPLATE_GENERIC,
  destField: DEST_NONE,
  readFields: READ_RT,
  gprFactRule: FACT_RESET,
});

const TRAIT_COP1_MF_TRIVIAL = makeTraits({
  boilerplate: BOILERPLATE_TRIVIAL,
  destField: DEST_RT,
  readFields: READ_NONE,
  gprFactRule: FACT_RESET,
  usesCop1: true,
});

const TRAIT_COP1_MF_FAULTING = makeTraits({
  boilerplate: BOILERPLATE_COP1,
  destField: DEST_RT,
  readFields: READ_NONE,
  gprFactRule: FACT_RESET,
  usesCop1: true,
});

const TRAIT_COP1_MT_TRIVIAL = makeTraits({
  boilerplate: BOILERPLATE_TRIVIAL,
  destField: DEST_NONE,
  readFields: READ_RT,
  gprFactRule: FACT_RESET,
  usesCop1: true,
});

const TRAIT_COP1_MT_FAULTING = makeTraits({
  boilerplate: BOILERPLATE_COP1,
  destField: DEST_NONE,
  readFields: READ_RT,
  gprFactRule: FACT_RESET,
  usesCop1: true,
});

const TRAIT_COP1_OP_TRIVIAL = makeTraits({
  boilerplate: BOILERPLATE_TRIVIAL,
  destField: DEST_NONE,
  readFields: READ_NONE,
  gprFactRule: FACT_RESET,
  usesCop1: true,
});

const TRAIT_COP1_OP_FAULTING = makeTraits({
  boilerplate: BOILERPLATE_COP1,
  destField: DEST_NONE,
  readFields: READ_NONE,
  gprFactRule: FACT_RESET,
  usesCop1: true,
});

const TRAIT_COP1_BC_KNOWN = makeTraits({
  boilerplate: BOILERPLATE_BRANCH,
  destField: DEST_NONE,
  readFields: READ_NONE,
  gprFactRule: FACT_RESET,
  usesCop1: true,
});

const TRAIT_COP1_BCL_KNOWN = makeTraits({
  boilerplate: BOILERPLATE_BRANCH_LIKELY,
  destField: DEST_NONE,
  readFields: READ_NONE,
  gprFactRule: FACT_RESET,
  usesCop1: true,
});

const TRAIT_COP1_BC_UNKNOWN = makeTraits({
  boilerplate: BOILERPLATE_GENERIC,
  destField: DEST_NONE,
  readFields: READ_NONE,
  gprFactRule: FACT_RESET,
  usesCop1: true,
});

function validateTableSize(table, expectedSize, name) {
  if (table.length !== expectedSize) {
    throw new Error(`${name} table is unexpected size: ${table.length}`);
  }
  return Object.freeze(table);
}

const SPECIAL_OP_TRAITS = validateTableSize([
  /* 0x00 SLL     */ TRAIT_TRIVIAL_SHIFT_IMM_SIGN32,
  /* 0x01 ---     */ TRAIT_GENERIC_RESERVED,
  /* 0x02 SRL     */ TRAIT_TRIVIAL_SHIFT_IMM_SIGN32,
  /* 0x03 SRA     */ TRAIT_TRIVIAL_SHIFT_IMM_SIGN32,
  /* 0x04 SLLV    */ TRAIT_TRIVIAL_ALU_SIGN32,
  /* 0x05 ---     */ TRAIT_GENERIC_RESERVED,
  /* 0x06 SRLV    */ TRAIT_TRIVIAL_ALU_SIGN32,
  /* 0x07 SRAV    */ TRAIT_TRIVIAL_ALU_SIGN32,
  /* 0x08 JR      */ TRAIT_BRANCH_JR,
  /* 0x09 JALR    */ TRAIT_BRANCH_JALR,
  /* 0x0a ---     */ TRAIT_GENERIC_RESERVED,
  /* 0x0b ---     */ TRAIT_GENERIC_RESERVED,
  /* 0x0c SYSCALL */ TRAIT_GENERIC_RESERVED,
  /* 0x0d BREAK   */ TRAIT_GENERIC_RESERVED,
  /* 0x0e ---     */ TRAIT_GENERIC_RESERVED,
  /* 0x0f SYNC    */ TRAIT_GENERIC_RESERVED,
  /* 0x10 MFHI    */ TRAIT_TRIVIAL_MFHILO,
  /* 0x11 MTHI    */ TRAIT_TRIVIAL_MTHILO,
  /* 0x12 MFLO    */ TRAIT_TRIVIAL_MFHILO,
  /* 0x13 MTLO    */ TRAIT_TRIVIAL_MTHILO,
  /* 0x14 DSLLV   */ TRAIT_TRIVIAL_ALU_UNKNOWN64,
  /* 0x15 ---     */ TRAIT_GENERIC_RESERVED,
  /* 0x16 DSRLV   */ TRAIT_TRIVIAL_ALU_UNKNOWN64,
  /* 0x17 DSRAV   */ TRAIT_TRIVIAL_ALU_UNKNOWN64,
  /* 0x18 MULT    */ TRAIT_TRIVIAL_MULDIV,
  /* 0x19 MULTU   */ TRAIT_TRIVIAL_MULDIV,
  /* 0x1a DIV     */ TRAIT_TRIVIAL_MULDIV,
  /* 0x1b DIVU    */ TRAIT_TRIVIAL_MULDIV,
  /* 0x1c DMULT   */ TRAIT_TRIVIAL_MULDIV,
  /* 0x1d DMULTU  */ TRAIT_TRIVIAL_MULDIV,
  /* 0x1e DDIV    */ TRAIT_TRIVIAL_MULDIV,
  /* 0x1f DDIVU   */ TRAIT_TRIVIAL_MULDIV,
  /* 0x20 ADD     */ TRAIT_GENERIC_OVERFLOW_RD,
  /* 0x21 ADDU    */ TRAIT_TRIVIAL_ALU_SIGN32,
  /* 0x22 SUB     */ TRAIT_GENERIC_OVERFLOW_RD,
  /* 0x23 SUBU    */ TRAIT_TRIVIAL_ALU_SIGN32,
  /* 0x24 AND     */ TRAIT_TRIVIAL_AND,
  /* 0x25 OR      */ TRAIT_TRIVIAL_OR_XOR,
  /* 0x26 XOR     */ TRAIT_TRIVIAL_OR_XOR,
  /* 0x27 NOR     */ TRAIT_TRIVIAL_ALU_UNKNOWN64,
  /* 0x28 ---     */ TRAIT_GENERIC_RESERVED,
  /* 0x29 ---     */ TRAIT_GENERIC_RESERVED,
  /* 0x2a SLT     */ TRAIT_TRIVIAL_ALU_BOOL32,
  /* 0x2b SLTU    */ TRAIT_TRIVIAL_ALU_BOOL32,
  /* 0x2c DADD    */ TRAIT_GENERIC_OVERFLOW_RD,
  /* 0x2d DADDU   */ TRAIT_TRIVIAL_ALU_UNKNOWN64,
  /* 0x2e DSUB    */ TRAIT_GENERIC_OVERFLOW_RD,
  /* 0x2f DSUBU   */ TRAIT_TRIVIAL_ALU_UNKNOWN64,
  /* 0x30 TGE     */ TRAIT_GENERIC_TRAP_RS_RT,
  /* 0x31 TGEU    */ TRAIT_GENERIC_TRAP_RS_RT,
  /* 0x32 TLT     */ TRAIT_GENERIC_TRAP_RS_RT,
  /* 0x33 TLTU    */ TRAIT_GENERIC_TRAP_RS_RT,
  /* 0x34 TEQ     */ TRAIT_GENERIC_TRAP_RS_RT,
  /* 0x35 ---     */ TRAIT_GENERIC_RESERVED,
  /* 0x36 TNE     */ TRAIT_GENERIC_TRAP_RS_RT,
  /* 0x37 ---     */ TRAIT_GENERIC_RESERVED,
  /* 0x38 DSLL    */ TRAIT_TRIVIAL_SHIFT_IMM_UNKNOWN64,
  /* 0x39 ---     */ TRAIT_GENERIC_RESERVED,
  /* 0x3a DSRL    */ TRAIT_TRIVIAL_SHIFT_IMM_UNKNOWN64,
  /* 0x3b DSRA    */ TRAIT_TRIVIAL_SHIFT_IMM_UNKNOWN64,
  /* 0x3c DSLL32  */ TRAIT_TRIVIAL_SHIFT_IMM_UNKNOWN64,
  /* 0x3d ---     */ TRAIT_GENERIC_RESERVED,
  /* 0x3e DSRL32  */ TRAIT_TRIVIAL_SHIFT_IMM_UNKNOWN64,
  /* 0x3f DSRA32  */ TRAIT_TRIVIAL_SHIFT_IMM_UNKNOWN64,
], 64, 'Special');

const REGIMM_OP_TRAITS = validateTableSize([
  /* 0x00 BLTZ    */ TRAIT_BRANCH_REGIMM,
  /* 0x01 BGEZ    */ TRAIT_BRANCH_REGIMM,
  /* 0x02 BLTZL   */ TRAIT_BRANCH_LIKELY_REGIMM,
  /* 0x03 BGEZL   */ TRAIT_BRANCH_LIKELY_REGIMM,
  /* 0x04 ---     */ TRAIT_GENERIC_RESERVED,
  /* 0x05 ---     */ TRAIT_GENERIC_RESERVED,
  /* 0x06 ---     */ TRAIT_GENERIC_RESERVED,
  /* 0x07 ---     */ TRAIT_GENERIC_RESERVED,
  /* 0x08 TGEI    */ TRAIT_GENERIC_TRAP_RS,
  /* 0x09 TGEIU   */ TRAIT_GENERIC_TRAP_RS,
  /* 0x0a TLTI    */ TRAIT_GENERIC_TRAP_RS,
  /* 0x0b TLTIU   */ TRAIT_GENERIC_TRAP_RS,
  /* 0x0c TEQI    */ TRAIT_GENERIC_TRAP_RS,
  /* 0x0d ---     */ TRAIT_GENERIC_RESERVED,
  /* 0x0e TNEI    */ TRAIT_GENERIC_TRAP_RS,
  /* 0x0f ---     */ TRAIT_GENERIC_RESERVED,
  /* 0x10 BLTZAL  */ TRAIT_GENERIC_BRANCH_LINK_REGIMM,
  /* 0x11 BGEZAL  */ TRAIT_GENERIC_BRANCH_LINK_REGIMM,
  /* 0x12 BLTZALL */ TRAIT_GENERIC_BRANCH_LINK_REGIMM,
  /* 0x13 BGEZALL */ TRAIT_GENERIC_BRANCH_LINK_REGIMM,
  /* 0x14 ---     */ TRAIT_GENERIC_RESERVED,
  /* 0x15 ---     */ TRAIT_GENERIC_RESERVED,
  /* 0x16 ---     */ TRAIT_GENERIC_RESERVED,
  /* 0x17 ---     */ TRAIT_GENERIC_RESERVED,
  /* 0x18 ---     */ TRAIT_GENERIC_RESERVED,
  /* 0x19 ---     */ TRAIT_GENERIC_RESERVED,
  /* 0x1a ---     */ TRAIT_GENERIC_RESERVED,
  /* 0x1b ---     */ TRAIT_GENERIC_RESERVED,
  /* 0x1c ---     */ TRAIT_GENERIC_RESERVED,
  /* 0x1d ---     */ TRAIT_GENERIC_RESERVED,
  /* 0x1e ---     */ TRAIT_GENERIC_RESERVED,
  /* 0x1f ---     */ TRAIT_GENERIC_RESERVED,
], 32, 'RegImm');

// Dynamic entries in SIMPLE_OP_TRAITS are null and resolved by getOpTraits.
const SIMPLE_OP_TRAITS = validateTableSize([
  /* 0x00 SPECIAL */ null,
  /* 0x01 REGIMM  */ null,
  /* 0x02 J       */ TRAIT_BRANCH_J,
  /* 0x03 JAL     */ TRAIT_BRANCH_JAL,
  /* 0x04 BEQ     */ TRAIT_BRANCH_EQ,
  /* 0x05 BNE     */ TRAIT_BRANCH_EQ,
  /* 0x06 BLEZ    */ TRAIT_BRANCH_ZERO,
  /* 0x07 BGTZ    */ TRAIT_BRANCH_ZERO,
  /* 0x08 ADDI    */ TRAIT_GENERIC_OVERFLOW_RT,
  /* 0x09 ADDIU   */ TRAIT_TRIVIAL_ADDIU,
  /* 0x0a SLTI    */ TRAIT_TRIVIAL_SLTI,
  /* 0x0b SLTIU   */ TRAIT_TRIVIAL_SLTI,
  /* 0x0c ANDI    */ TRAIT_TRIVIAL_ANDI,
  /* 0x0d ORI     */ TRAIT_TRIVIAL_ORI_XORI,
  /* 0x0e XORI    */ TRAIT_TRIVIAL_ORI_XORI,
  /* 0x0f LUI     */ TRAIT_TRIVIAL_LUI,
  /* 0x10 COP0    */ null,
  /* 0x11 COP1    */ null,
  /* 0x12 COP2    */ null,
  /* 0x13 COP3    */ TRAIT_GENERIC_RESERVED,
  /* 0x14 BEQL    */ TRAIT_BRANCH_LIKELY_EQ,
  /* 0x15 BNEL    */ TRAIT_BRANCH_LIKELY_EQ,
  /* 0x16 BLEZL   */ TRAIT_BRANCH_LIKELY_ZERO,
  /* 0x17 BGTZL   */ TRAIT_BRANCH_LIKELY_ZERO,
  /* 0x18 DADDI   */ TRAIT_GENERIC_OVERFLOW_RT,
  /* 0x19 DADDIU  */ TRAIT_TRIVIAL_DADDIU,
  /* 0x1a LDL     */ TRAIT_MEM_LOAD_MERGE_UNKNOWN64,
  /* 0x1b LDR     */ TRAIT_MEM_LOAD_MERGE_UNKNOWN64,
  /* 0x1c BRKPT   */ TRAIT_GENERIC_RESERVED,
  /* 0x1d ---     */ TRAIT_GENERIC_RESERVED,
  /* 0x1e ---     */ TRAIT_GENERIC_RESERVED,
  /* 0x1f ---     */ TRAIT_GENERIC_RESERVED,
  /* 0x20 LB      */ TRAIT_MEM_LOAD_SIGN32,
  /* 0x21 LH      */ TRAIT_MEM_LOAD_SIGN32,
  /* 0x22 LWL     */ TRAIT_MEM_LOAD_MERGE_SIGN32,
  /* 0x23 LW      */ TRAIT_MEM_LOAD_SIGN32,
  /* 0x24 LBU     */ TRAIT_MEM_LOAD_ZERO32,
  /* 0x25 LHU     */ TRAIT_MEM_LOAD_ZERO32,
  /* 0x26 LWR     */ TRAIT_MEM_LOAD_MERGE_SIGN32,
  /* 0x27 LWU     */ TRAIT_MEM_LOAD_ZERO32,
  /* 0x28 SB      */ TRAIT_MEM_STORE_INT,
  /* 0x29 SH      */ TRAIT_MEM_STORE_INT,
  /* 0x2a SWL     */ TRAIT_MEM_STORE_INT,
  /* 0x2b SW      */ TRAIT_MEM_STORE_INT,
  /* 0x2c SDL     */ TRAIT_MEM_STORE_INT,
  /* 0x2d SDR     */ TRAIT_MEM_STORE_INT,
  /* 0x2e SWR     */ TRAIT_MEM_STORE_INT,
  /* 0x2f CACHE   */ null,
  /* 0x30 LL      */ TRAIT_MEM_LOAD_SIGN32,
  /* 0x31 LWC1    */ null,
  /* 0x32 LWC2    */ TRAIT_MEM_COP2_LOAD,
  /* 0x33 ---     */ TRAIT_GENERIC_RESERVED,
  /* 0x34 LLD     */ TRAIT_MEM_LOAD_UNKNOWN64,
  /* 0x35 LDC1    */ null,
  /* 0x36 LDC2    */ TRAIT_MEM_COP2_LOAD,
  /* 0x37 LD      */ TRAIT_MEM_LOAD_UNKNOWN64,
  /* 0x38 SC      */ TRAIT_MEM_STORE_COND,
  /* 0x39 SWC1    */ null,
  /* 0x3a SWC2    */ TRAIT_MEM_COP2_STORE,
  /* 0x3b ---     */ TRAIT_GENERIC_RESERVED,
  /* 0x3c SCD     */ TRAIT_MEM_STORE_COND,
  /* 0x3d SDC1    */ null,
  /* 0x3e SDC2    */ TRAIT_MEM_COP2_STORE,
  /* 0x3f SD      */ TRAIT_MEM_STORE_INT,
], 64, 'Simple');

export function ignoreCacheOp(cacheOp) {
  const cache = cacheOp & 0x3;
  const action = (cacheOp >>> 2) & 0x7;
  return cache !== 0 || (action !== 0 && action !== 4);
}

function isIgnoredCacheInstruction(instruction) {
  const op = rt(instruction);
  const cpu0 = globalThis.n64js?.cpu0;
  return cpu0 ? cpu0.ignoreCacheOp(op) : ignoreCacheOp(op);
}

function getCop0Traits(instruction) {
  if (isWait(instruction)) {
    return TRAIT_TRIVIAL_NOP;
  }
  if (instruction & 0x02000000) {
    return TRAIT_GENERIC_RESERVED;
  }
  switch (copOp(instruction)) {
    case COP_MF:
    case COP_DMF:
      return TRAIT_COP_MF_GENERIC;
    case COP_MT:
    case COP_DMT:
      return TRAIT_COP_MT_GENERIC;
    case 2:
    case 6:
    case 8:
      return TRAIT_TRIVIAL_NOP;
    default:
      return TRAIT_GENERIC_RESERVED;
  }
}

function getCop1Traits(instruction, cop1statusKnown) {
  switch (copOp(instruction)) {
    case COP_MF:
    case COP_DMF:
    case COP_CF:
      return cop1statusKnown ? TRAIT_COP1_MF_TRIVIAL : TRAIT_COP1_MF_FAULTING;
    case COP_MT:
    case COP_DMT:
      return cop1statusKnown ? TRAIT_COP1_MT_TRIVIAL : TRAIT_COP1_MT_FAULTING;
    case COP_CT:
    case COP_DCT:
      return TRAIT_COP1_MT_FAULTING;
    case COP_BC:
      if (((instruction >>> 18) & 0x7) !== 0) {
        return TRAIT_COP1_OP_FAULTING;
      }
      if (!cop1statusKnown) {
        return TRAIT_COP1_BC_UNKNOWN;
      }
      return (instruction & 0x20000) !== 0 ? TRAIT_COP1_BCL_KNOWN : TRAIT_COP1_BC_KNOWN;
    case COP1_FMT_S:
    case COP1_FMT_D:
      return cop1statusKnown && copFmtFuncOp(instruction) === COP1_FUNC_MOV
        ? TRAIT_COP1_OP_TRIVIAL
        : TRAIT_COP1_OP_FAULTING;
    case COP1_FMT_W:
      return cop1statusKnown && copFmtFuncOp(instruction) === COP1_FUNC_CVT_D
        ? TRAIT_COP1_OP_TRIVIAL
        : TRAIT_COP1_OP_FAULTING;
    default:
      return TRAIT_COP1_OP_FAULTING;
  }
}

function getCop2Traits(instruction) {
  switch (copOp(instruction)) {
    case COP_MF:
    case COP_DMF:
    case COP_CF:
      return TRAIT_COP_MF_GENERIC;
    case COP_MT:
    case COP_DMT:
    case COP_CT:
      return TRAIT_COP_MT_GENERIC;
    default:
      return TRAIT_GENERIC_RESERVED;
  }
}

// Returns a pre-frozen OpTraits descriptor for `instruction` without allocating.
export function getOpTraits(instruction, cop1statusKnown = false, useOptimisedHandlers = true) {
  if (!useOptimisedHandlers) {
    return TRAIT_GENERIC_UNOPTIMISED;
  }
  const op = simpleOp(instruction);
  const direct = SIMPLE_OP_TRAITS[op];
  if (direct !== null) {
    return direct;
  }
  switch (op) {
    case OP_SPECIAL:
      return SPECIAL_OP_TRAITS[specialOp(instruction)];
    case OP_REGIMM:
      return REGIMM_OP_TRAITS[regImmOp(instruction)];
    case OP_COP0:
      return getCop0Traits(instruction);
    case OP_COP1:
      return getCop1Traits(instruction, cop1statusKnown);
    case OP_COP2:
      return getCop2Traits(instruction);
    case OP_CACHE:
      return isIgnoredCacheInstruction(instruction)
        ? TRAIT_TRIVIAL_CACHE_IGNORED
        : TRAIT_GENERIC_CACHE_ACTIVE;
    case OP_LWC1:
    case OP_LDC1:
      return cop1statusKnown ? TRAIT_MEM_COP1_LOAD_UNCHECKED : TRAIT_MEM_COP1_LOAD_CHECKED;
    case OP_SWC1:
    case OP_SDC1:
      return cop1statusKnown ? TRAIT_MEM_COP1_STORE_UNCHECKED : TRAIT_MEM_COP1_STORE_CHECKED;
    default:
      return TRAIT_GENERIC_RESERVED;
  }
}

// Returns true if `instruction` uses `generateTrivialOpBoilerplate` (cannot
// throw exceptions that inspect `c.delayPC`, cannot modify control flow, and
// does not set `c.stuffToDo`).
export function isTrivialInstruction(instruction, cop1statusKnown = false, useOptimisedHandlers = true) {
  return getOpTraits(instruction, cop1statusKnown, useOptimisedHandlers).isTrivial;
}

// Returns true if compiling `instruction` at `pc` sets `ctx.bailOut`, which
// ends the trace immediately and prevents wrapping the fragment in a self-loop.
export function instructionBailsOut(pc, instruction) {
  switch (simpleOp(instruction)) {
    case OP_J:
      return kSpeedHackEnabled && jumpAddress(pc, instruction) === (pc >>> 0);
    case OP_BEQ:
    case OP_BNE:
      return kSpeedHackEnabled && offset(instruction) === -1;
    case OP_COP0: {
      if (instruction & 0x02000000) {
        return false;
      }
      const cop = copOp(instruction);
      const reg = fs(instruction);
      return (cop === COP_MT || cop === COP_DMT) &&
        (reg === cpu0reg.controlCount || reg === cpu0reg.controlCompare);
    }
    case OP_CACHE:
      return !isIgnoredCacheInstruction(instruction);
    default:
      return false;
  }
}

export function resolveDestGpr(instruction, destField) {
  switch (destField) {
    case DEST_RT:
      return rt(instruction);
    case DEST_RD:
      return rd(instruction);
    case DEST_RA:
      return cpu0reg.RA;
    default:
      return 0;
  }
}

// Returns the architectural GPR (1..31) written by `instruction`, or 0 if the
// instruction does not modify a GPR (or targets $r0).
export function destGpr(instruction) {
  return resolveDestGpr(instruction, getOpTraits(instruction).destField);
}

export function resolveReadGprMask(instruction, readFields) {
  if (instruction === 0 || readFields === READ_NONE) {
    return 0;
  }
  let mask = 0;
  if (readFields & READ_RS) {
    const s = rs(instruction);
    if (s !== 0) {
      mask |= 1 << s;
    }
  }
  if (readFields & READ_RT) {
    const t = rt(instruction);
    if (t !== 0) {
      mask |= 1 << t;
    }
  }
  return mask >>> 0;
}

// Returns an unsigned 32-bit bitmask of non-zero GPRs (1..31) read by `instruction`.
export function readGprMask(instruction) {
  return resolveReadGprMask(instruction, getOpTraits(instruction).readFields);
}

// Classifies branch and jump instructions, returning null for non-branches.
export function classifyBranch(pc, instruction, cop1statusKnown = false) {
  const branchPC = pc >>> 0;
  const notTakenPC = (branchPC + 8) >>> 0;
  const takenPC = branchAddress(branchPC, instruction);
  const op = simpleOp(instruction);

  switch (op) {
    case OP_J:
      return {
        kind: 'unconditional',
        likely: false,
        fusable: true,
        condition: null,
        takenPC: jumpAddress(branchPC, instruction),
        notTakenPC,
        linkReg: 0,
        regSource: 0,
        usesCop1: false,
      };
    case OP_JAL:
      return {
        kind: 'unconditional',
        likely: false,
        fusable: true,
        condition: null,
        takenPC: jumpAddress(branchPC, instruction),
        notTakenPC,
        linkReg: cpu0reg.RA,
        regSource: 0,
        usesCop1: false,
      };
    case OP_BEQ: {
      const unconditional = rs(instruction) === rt(instruction);
      return {
        kind: unconditional ? 'unconditional' : 'conditional',
        likely: false,
        fusable: true,
        condition: unconditional ? null : 'beq',
        takenPC,
        notTakenPC,
        linkReg: 0,
        regSource: 0,
        usesCop1: false,
      };
    }
    case OP_BNE:
      return {
        kind: 'conditional',
        likely: false,
        fusable: true,
        condition: 'bne',
        takenPC,
        notTakenPC,
        linkReg: 0,
        regSource: 0,
        usesCop1: false,
      };
    case OP_BLEZ:
      return {
        kind: 'conditional',
        likely: false,
        fusable: true,
        condition: 'blez',
        takenPC,
        notTakenPC,
        linkReg: 0,
        regSource: 0,
        usesCop1: false,
      };
    case OP_BGTZ:
      return {
        kind: 'conditional',
        likely: false,
        fusable: true,
        condition: 'bgtz',
        takenPC,
        notTakenPC,
        linkReg: 0,
        regSource: 0,
        usesCop1: false,
      };
    case OP_BEQL:
    case OP_BNEL:
    case OP_BLEZL:
    case OP_BGTZL: {
      const condMap = {
        [OP_BEQL]: 'beq',
        [OP_BNEL]: 'bne',
        [OP_BLEZL]: 'blez',
        [OP_BGTZL]: 'bgtz',
      };
      return {
        kind: 'conditional',
        likely: true,
        fusable: true,
        condition: condMap[op],
        takenPC,
        notTakenPC,
        linkReg: 0,
        regSource: 0,
        usesCop1: false,
      };
    }
    case OP_REGIMM: {
      const sub = regImmOp(instruction);
      switch (sub) {
        case REGIMM_BLTZ:
        case REGIMM_BGEZ:
          return {
            kind: 'conditional',
            likely: false,
            fusable: true,
            condition: sub === REGIMM_BLTZ ? 'bltz' : 'bgez',
            takenPC,
            notTakenPC,
            linkReg: 0,
            regSource: 0,
            usesCop1: false,
          };
        case REGIMM_BLTZL:
        case REGIMM_BGEZL:
          return {
            kind: 'conditional',
            likely: true,
            fusable: true,
            condition: sub === REGIMM_BLTZL ? 'bltz' : 'bgez',
            takenPC,
            notTakenPC,
            linkReg: 0,
            regSource: 0,
            usesCop1: false,
          };
        case REGIMM_BLTZAL:
        case REGIMM_BGEZAL:
        case REGIMM_BLTZALL:
        case REGIMM_BGEZALL:
          return {
            kind: 'conditional',
            likely: sub === REGIMM_BLTZALL || sub === REGIMM_BGEZALL,
            fusable: false,
            condition: (sub & 1) === 0 ? 'bltz' : 'bgez',
            takenPC,
            notTakenPC,
            linkReg: cpu0reg.RA,
            regSource: 0,
            usesCop1: false,
          };
        default:
          return null;
      }
    }
    case OP_COP1: {
      if (copOp(instruction) !== COP_BC || ((instruction >>> 18) & 0x7) !== 0) {
        return null;
      }
      const likely = (instruction & 0x20000) !== 0;
      const condition = (instruction & 0x10000) !== 0 ? 'bc1t' : 'bc1f';
      return {
        kind: 'conditional',
        likely,
        fusable: Boolean(cop1statusKnown),
        condition,
        takenPC,
        notTakenPC,
        linkReg: 0,
        regSource: 0,
        usesCop1: true,
      };
    }
    case OP_SPECIAL: {
      const spec = specialOp(instruction);
      if (spec !== SPECIAL_JR && spec !== SPECIAL_JALR) {
        return null;
      }
      const s = rs(instruction);
      const linkReg = spec === SPECIAL_JALR ? rd(instruction) : 0;
      if (s === 0) {
        return {
          kind: 'unconditional',
          likely: false,
          fusable: true,
          condition: null,
          takenPC: 0,
          notTakenPC,
          linkReg,
          regSource: 0,
          usesCop1: false,
        };
      }
      return {
        kind: 'register',
        likely: false,
        fusable: true,
        condition: null,
        takenPC: null,
        notTakenPC,
        linkReg,
        regSource: s,
        usesCop1: false,
      };
    }
    default:
      return null;
  }
}

// Returns a complete per-instruction classification descriptor.
export function classifyInstruction(
  instruction,
  { pc = 0, cop1statusKnown = false, useOptimisedHandlers = true } = {},
) {
  const traits = getOpTraits(instruction, cop1statusKnown, useOptimisedHandlers);
  return {
    boilerplate: traits.boilerplate,
    isTrivial: traits.isTrivial,
    bailsOut: instructionBailsOut(pc, instruction),
    mayThrow: traits.mayThrow,
    maySetStuffToDo: traits.maySetStuffToDo,
    mayChangeNextPC: traits.mayChangeNextPC,
    usesCop1: traits.usesCop1,
    memoryEffects: traits.memoryEffects,
    destGpr: resolveDestGpr(instruction, traits.destField),
    readGprMask: resolveReadGprMask(instruction, traits.readFields),
    gprFactRule: traits.gprFactRule,
    branch: classifyBranch(pc, instruction, cop1statusKnown),
  };
}
