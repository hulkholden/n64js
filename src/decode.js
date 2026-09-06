// Helpers for decoding R4300 instructions.

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
  if (pc === 0x7ffffff8 || pc === 0x7ffffffc || pc >= 0xfffffff8) return true;
  if (((pc - 0x7ffe0000) >>> 0) >= 0x40000) return false;
  const op = simpleOp(i);
  const relative = (op >= 4 && op <= 7) || (op >= 20 && op <= 23) ||
    (op === 1 && [0, 1, 2, 3, 16, 17, 18, 19].includes(regImmOp(i))) ||
    (op === 17 && copOp(i) === 8);
  if (!relative) return false;
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
