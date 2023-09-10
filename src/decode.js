// Helpers for decoding R4300 instructions.

export function simpleOp(i) { return (i >>> 26) & 0x3f; }
export function regImmOp(i) { return (i >>> 16) & 0x1f; }
export function specialOp(i) { return i & 0x3f; }
export function copOp(i) { return (i >>> 21) & 0x1f; }
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
