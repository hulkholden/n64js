// Helpers for decoding RSP instructions. Scalar field names match decode.js;
// vector fields use the RSP layouts shared by the interpreter and disassembler.

// Primary opcodes (bits 31..26).
export const OP_SPECIAL = 0x00;
export const OP_REGIMM = 0x01;
export const OP_J = 0x02;
export const OP_JAL = 0x03;
export const OP_BEQ = 0x04;
export const OP_BNE = 0x05;
export const OP_BLEZ = 0x06;
export const OP_BGTZ = 0x07;
export const OP_ADDI = 0x08;
export const OP_ADDIU = 0x09;
export const OP_ANDI = 0x0c;
export const OP_ORI = 0x0d;
export const OP_COP0 = 0x10;
export const OP_LB = 0x20;
export const OP_LH = 0x21;
export const OP_LW = 0x23;
export const OP_LBU = 0x24;
export const OP_LHU = 0x25;
export const OP_SH = 0x29;

// SPECIAL function codes (bits 5..0), distinct from primary opcodes.
export const SPECIAL_SLL = 0x00;
export const SPECIAL_SRL = 0x02;
export const SPECIAL_JR = 0x08;
export const SPECIAL_JALR = 0x09;
export const SPECIAL_BREAK = 0x0d;
export const SPECIAL_ADD = 0x20;
export const SPECIAL_ADDU = 0x21;
export const SPECIAL_OR = 0x25;

// COP0 subopcode (bits 25..21) for a scalar-to-control-register transfer.
export const COP0_MTC0 = 0x04;

// Scalar register indices for the hardwired zero and link registers.
export const GPR_ZERO = 0x00;
export const GPR_RA = 0x1f;

// COP0 register numbers in rd (bits 15..11), not memory-mapped byte offsets.
export const COP0_REG_SP_MEM_ADDR = 0x00;
export const COP0_REG_SP_DRAM_ADDR = 0x01;
export const COP0_REG_SP_RD_LEN = 0x02;

// Full instruction encoding: SLL r0, r0, 0.
export const INSTR_NOP = 0x0000_0000;

export function simpleOp(i) { return (i >>> 26) & 0x3f; }
export function regImmOp(i) { return (i >>> 16) & 0x1f; }
export function specialOp(i) { return i & 0x3f; }
export function copOp(i) { return (i >>> 21) & 0x1f; }

export function sa(i) { return (i >>> 6) & 0x1f; }
export function rd(i) { return (i >>> 11) & 0x1f; }
export function rt(i) { return (i >>> 16) & 0x1f; }
export function rs(i) { return (i >>> 21) & 0x1f; }
export function target(i) { return i & 0x3ffffff; }
export function imm(i) { return i & 0xffff; }
export function imms(i) { return ((i & 0xffff) << 16) >> 16; }
export function base(i) { return (i >>> 21) & 0x1f; }
export function offset(i) { return ((i & 0xffff) << 16) >> 16; }

// Logical targets; callers apply their PC/IMEM address mask when executing.
export function branchAddress(pc, i) { return pc + 4 + offset(i) * 4; }
export function jumpAddress(pc, i) { return (pc & 0xf0000000) | (target(i) * 4); }

// LWC2/SWC2: base[25..21], vt[20..16], operation[15..11], element[10..7],
// signed offset[6..0]. The operation determines the offset's byte scale.
export function vmemBase(i) { return (i >>> 21) & 0x1f; }
export function vmemVT(i) { return (i >>> 16) & 0x1f; }
export function vmemEl(i) { return (i >>> 7) & 0xf; }
export function vmemOffset(i) { return ((i & 0x7f) << 25) >> 25; }

// COP2 vector arithmetic: element[24..21], vt[20..16], vs[15..11], vd[10..6].
// Reciprocal/move instructions interpret the vs field as a destination element.
export function cop2E(i) { return (i >>> 21) & 0xf; }
export function cop2DE(i) { return (i >>> 11) & 0x1f; }
export function cop2VT(i) { return (i >>> 16) & 0x1f; }
export function cop2VS(i) { return (i >>> 11) & 0x1f; }
export function cop2VD(i) { return (i >>> 6) & 0x1f; }
