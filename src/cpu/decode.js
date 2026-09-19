// Helpers for decoding R4300 instructions.

// Primary opcodes (bits 31..26).
export const OP_SPECIAL = 0x00;
export const OP_J = 0x02;
export const OP_JAL = 0x03;
export const OP_BEQ = 0x04;
export const OP_BNE = 0x05;
export const OP_BLEZ = 0x06;
export const OP_BGTZ = 0x07;
export const OP_ADDIU = 0x09;
export const OP_SLTI = 0x0a;
export const OP_SLTIU = 0x0b;
export const OP_ANDI = 0x0c;
export const OP_ORI = 0x0d;
export const OP_XORI = 0x0e;
export const OP_LUI = 0x0f;
export const OP_BEQL = 0x14;
export const OP_BNEL = 0x15;
export const OP_BLEZL = 0x16;
export const OP_BGTZL = 0x17;
export const OP_DADDIU = 0x19;
export const OP_LDL = 0x1a;
export const OP_LDR = 0x1b;
export const OP_LB = 0x20;
export const OP_LH = 0x21;
export const OP_LWL = 0x22;
export const OP_LW = 0x23;
export const OP_LBU = 0x24;
export const OP_LHU = 0x25;
export const OP_LWR = 0x26;
export const OP_LWU = 0x27;
export const OP_SB = 0x28;
export const OP_SH = 0x29;
export const OP_SWL = 0x2a;
export const OP_SW = 0x2b;
export const OP_SDL = 0x2c;
export const OP_SDR = 0x2d;
export const OP_SWR = 0x2e;
export const OP_LL = 0x30;
export const OP_LWC1 = 0x31;
export const OP_LWC2 = 0x32;
export const OP_LLD = 0x34;
export const OP_LDC1 = 0x35;
export const OP_LDC2 = 0x36;
export const OP_LD = 0x37;
export const OP_SC = 0x38;
export const OP_SWC1 = 0x39;
export const OP_SWC2 = 0x3a;
export const OP_SCD = 0x3c;
export const OP_SDC1 = 0x3d;
export const OP_SDC2 = 0x3e;
export const OP_SD = 0x3f;

// SPECIAL function codes (bits 5..0), distinct from primary opcodes.
export const SPECIAL_SLL = 0x00;
export const SPECIAL_SRL = 0x02;
export const SPECIAL_SRA = 0x03;
export const SPECIAL_SLLV = 0x04;
export const SPECIAL_SRLV = 0x06;
export const SPECIAL_SRAV = 0x07;
export const SPECIAL_JR = 0x08;
export const SPECIAL_JALR = 0x09;
export const SPECIAL_MFHI = 0x10;
export const SPECIAL_MTHI = 0x11;
export const SPECIAL_MFLO = 0x12;
export const SPECIAL_MTLO = 0x13;
export const SPECIAL_DSLLV = 0x14;
export const SPECIAL_DSRLV = 0x16;
export const SPECIAL_DSRAV = 0x17;
export const SPECIAL_MULT = 0x18;
export const SPECIAL_MULTU = 0x19;
export const SPECIAL_DIV = 0x1a;
export const SPECIAL_DIVU = 0x1b;
export const SPECIAL_DMULT = 0x1c;
export const SPECIAL_DMULTU = 0x1d;
export const SPECIAL_DDIV = 0x1e;
export const SPECIAL_DDIVU = 0x1f;
export const SPECIAL_ADDU = 0x21;
export const SPECIAL_SUBU = 0x23;
export const SPECIAL_AND = 0x24;
export const SPECIAL_OR = 0x25;
export const SPECIAL_XOR = 0x26;
export const SPECIAL_NOR = 0x27;
export const SPECIAL_SLT = 0x2a;
export const SPECIAL_SLTU = 0x2b;
export const SPECIAL_DADDU = 0x2d;
export const SPECIAL_DSUBU = 0x2f;
export const SPECIAL_DSLL = 0x38;
export const SPECIAL_DSRL = 0x3a;
export const SPECIAL_DSRA = 0x3b;
export const SPECIAL_DSLL32 = 0x3c;
export const SPECIAL_DSRL32 = 0x3e;
export const SPECIAL_DSRA32 = 0x3f;

export function simpleOp(i) { return (i >>> 26) & 0x3f; }
export function regImmOp(i) { return (i >>> 16) & 0x1f; }
export function specialOp(i) { return i & 0x3f; }
export function copOp(i) { return (i >>> 21) & 0x1f; }
// WAIT has an implementation-dependent code in bits 24..6. Only the COP0
// opcode, CO bit and function field are significant when decoding it.
export function isWait(i) { return (i & 0xfe00_003f) === 0x4200_0020; }
export function cop1BCOp(i) { return (i >>> 16) & 0x3; }
export function copFmtFuncOp(i) { return i & 0x3f; }

export function fd(i) { return (i >>> 6) & 0x1f; }
export function fs(i) { return (i >>> 11) & 0x1f; }
export function ft(i) { return (i >>> 16) & 0x1f; }

export function offset(i) { return ((i & 0xffff) << 16) >> 16; }

export function sa(i) { return (i >>> 6) & 0x1f; }
export function rd(i) { return (i >>> 11) & 0x1f; }
export function rt(i) { return (i >>> 16) & 0x1f; }
export function rs(i) { return (i >>> 21) & 0x1f; }

export function tlbop(i) { return i & 0x3f; }

export function target(i) { return (i) & 0x3ffffff; }
export function imm(i) { return (i) & 0xffff; }
export function imms(i) { return ((i & 0xffff) << 16) >> 16; }   // treat immediate value as signed
export function base(i) { return (i >>> 21) & 0x1f; }

export function branchAddress(pc, i) { return ((pc + 4) + (offset(i) * 4)) >>> 0; }
//function branchAddress(a, i) { return (a + 4) + (imms(i) * 4); }
//export function branchAddress(pc,i) { return (((pc>>>2)+1) + offset(i))<<2; }  // NB: convoluted calculation to avoid >>>0 (deopt)
export function jumpAddress(pc, i) { return ((pc & 0xf0000000) | (target(i) * 4)) >>> 0; }
