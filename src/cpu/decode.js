// Helpers for decoding R4300 instructions.

// Primary opcodes (bits 31..26) used to recognize relative branches.
const OP_REGIMM = 0x01;
const OP_BEQ = 0x04;
const OP_BGTZ = 0x07;
const OP_COP1 = 0x11;
const OP_BEQL = 0x14;
const OP_BGTZL = 0x17;

// REGIMM subopcodes (bits 20..16).
const REGIMM_BLTZ = 0x00;
const REGIMM_BGEZ = 0x01;
const REGIMM_BLTZL = 0x02;
const REGIMM_BGEZL = 0x03;
const REGIMM_BLTZAL = 0x10;
const REGIMM_BGEZAL = 0x11;
const REGIMM_BLTZALL = 0x12;
const REGIMM_BGEZALL = 0x13;

// COP1 subopcode (bits 25..21) shared by all COP1 condition branches.
const COP1_BC = 0x08;

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

// These rare instructions can leave the sign-extended 32-bit PC range without
// a register jump. Recompilation resolves this test at compile time.
export function needsWideInstruction(pc, i) {
  // PC+4 (sequential execution) or PC+8 (a link address / annulled delay slot)
  // can cross bit 31 or wrap the low word here. Hand off before either value
  // is calculated so the wide interpreter preserves the full address.
  if (pc === 0x7ffffff8 || pc === 0x7ffffffc || pc >= 0xfffffff8) return true;

  // A signed 16-bit branch displacement, scaled by four, can only cross the
  // signed 32-bit boundary from this window: 0x7ffe0000 through 0x8001ffff.
  // The unsigned subtraction rejects all other PCs without decoding the op.
  if (((pc - 0x7ffe0000) >>> 0) >= 0x40000) return false;

  const op = simpleOp(i);
  const relative =
    // BEQ, BNE, BLEZ, BGTZ and their likely variants.
    (op >= OP_BEQ && op <= OP_BGTZ) || (op >= OP_BEQL && op <= OP_BGTZL) ||
    // REGIMM branches: BLTZ/BGEZ, including likely and link variants.
    // Other REGIMM instructions (such as immediate traps) do not branch.
    (op === OP_REGIMM && [
      REGIMM_BLTZ, REGIMM_BGEZ, REGIMM_BLTZL, REGIMM_BGEZL,
      REGIMM_BLTZAL, REGIMM_BGEZAL, REGIMM_BLTZALL, REGIMM_BGEZALL,
    ].includes(regImmOp(i))) ||
    // COP1 condition branches (BC1F/T and their likely variants).
    (op === OP_COP1 && copOp(i) === COP1_BC);
  if (!relative) return false;

  // Keep the sum as a Number without truncating it to 32 bits: crossing
  // either signed limit means the target cannot use the ordinary PC path.
  // This is conservative; the branch condition is evaluated at execution.
  const target = (pc | 0) + 4 + offset(i) * 4;
  return target < -0x80000000 || target > 0x7fffffff;
}

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
