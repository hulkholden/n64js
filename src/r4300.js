/*jshint jquery:true, devel:true */

import * as cpu0_constants from './cpu0_constants.js';
import { CPU1, convertModeCeil, convertModeFloor, convertModeRound, convertModeTrunc } from './cpu1.js';
import { disassembleInstruction, cop0ControlRegisterNames, cop0gprNames } from './disassemble.js';
import { toString8, toString32, toString64_bigint } from './format.js';
import { lookupFragment, resetFragments } from './fragments.js';
import { assert } from './assert.js';
import * as logger from './logger.js';
import * as memaccess from './memaccess.js';
import { syncFlow } from './sync.js';

window.n64js = window.n64js || {};

const kDebugTLB = false;
const kDebugDynarec = false;

const kValidateDynarecPCs = false;

const accurateCountUpdating = false;
const COUNTER_INCREMENT_PER_OP = 1;

const UT_VEC          = 0x80000000;
const XUT_VEC         = 0x80000080;
const ECC_VEC         = 0x80000100;
const E_VEC           = 0x80000180;

const SR_IE           = 0x00000001;
const SR_EXL          = 0x00000002;
const SR_ERL          = 0x00000004;
const SR_KSU_KER      = 0x00000000;
const SR_KSU_SUP      = 0x00000008;
const SR_KSU_USR      = 0x00000010;
const SR_KSU_MASK     = 0x00000018;
const SR_UX           = 0x00000020;
const SR_SX           = 0x00000040;
const SR_KX           = 0x00000080;

const SR_IBIT1        = 0x00000100;
const SR_IBIT2        = 0x00000200;
const SR_IBIT3        = 0x00000400;
const SR_IBIT4        = 0x00000800;
const SR_IBIT5        = 0x00001000;
const SR_IBIT6        = 0x00002000;
const SR_IBIT7        = 0x00004000;
const SR_IBIT8        = 0x00008000;

const SR_IMASK0       = 0x0000ff00;
const SR_IMASK1       = 0x0000fe00;
const SR_IMASK2       = 0x0000fc00;
const SR_IMASK3       = 0x0000f800;
const SR_IMASK4       = 0x0000f000;
const SR_IMASK5       = 0x0000e000;
const SR_IMASK6       = 0x0000c000;
const SR_IMASK7       = 0x00008000;
const SR_IMASK8       = 0x00000000;
const SR_IMASK        = 0x0000ff00;

const SR_DE           = 0x00010000;
const SR_CE           = 0x00020000;
const SR_CH           = 0x00040000;
const SR_SR           = 0x00100000;
const SR_TS           = 0x00200000;
const SR_BEV          = 0x00400000;
const SR_ITS          = 0x01000000;
const SR_RE           = 0x02000000;
const SR_FR           = 0x04000000;
const SR_RP           = 0x08000000;
const SR_CU0          = 0x10000000;
const SR_CU1          = 0x20000000;
const SR_CU2          = 0x40000000;
const SR_CU3          = 0x80000000;

const SR_CUMASK       = 0xf0000000;
const SR_CUSHIFT      = 28;

// Only bit 19 is unwritable.
const statusWritableBits = 0xfff7_ffffn;

const CAUSE_BD_BIT    = 31;           // NB: Closure Compiler doesn't like 32 bit constants.
const CAUSE_BD        = 0x80000000;
const CAUSE_CEMASK    = 0x30000000;
const CAUSE_CESHIFT   = 28;

const CAUSE_SW1       = 0x00000100;
const CAUSE_SW2       = 0x00000200;
const CAUSE_IP3       = 0x00000400;
const CAUSE_IP4       = 0x00000800;
const CAUSE_IP5       = 0x00001000;
const CAUSE_IP6       = 0x00002000;
const CAUSE_IP7       = 0x00004000;
const CAUSE_IP8       = 0x00008000;

const CAUSE_IPMASK    = 0x0000FF00;

const CAUSE_IPSHIFT   = 8;

const CAUSE_EXCMASK   = 0x0000007C;

const CAUSE_EXCSHIFT  = 2;

// Only the software interrupt values are writeable.
const causeWritableBits = BigInt(CAUSE_SW1 | CAUSE_SW2);

const causeExcCodeInt = 0 << 2;  // Interrupt
const causeExcCodeMod = 1 << 2;  // TLB Modification
const causeExcCodeTLBL = 2 << 2;  // TLB Miss (load or instruction fetch)
const causeExcCodeTLBS = 3 << 2;  // TLB Miss (store)
const causeExcCodeAdEL = 4 << 2;  // Address Error (load or instruction fetch)
const causeExcCodeAdES = 5 << 2;  // Address Error (store)
const causeExcCodeIBE = 6 << 2;  // Bus Error (instruction fetch)
const causeExcCodeDBE = 7 << 2;  // Bus Error (data reference: load or store)
const causeExcCodeSys = 8 << 2;  // Syscall
const causeExcCodeBp = 9 << 2;  // Breakpoint
const causeExcCodeRI = 10 << 2;  // Reserved Instruction
const causeExcCodeCpU = 11 << 2;  // Coprocessor Unusable
const causeExcCodeOv = 12 << 2;  // Arithmetic Overflow
const causeExcCodeTr = 13 << 2;  // Trap
const causeExcCodeVCEI = 14 << 2;  // ?
const causeExcCodeFPE = 15 << 2;  // Floating-Point
const causeExcCodeWATCH = 23 << 2;  // Watch
const causeExcCodeVCED = 31 << 2; // ?


const FPCSR_RM_RN     = 0x00000000;
const FPCSR_RM_RZ     = 0x00000001;
const FPCSR_RM_RP     = 0x00000002;
const FPCSR_RM_RM     = 0x00000003;

const FPCSR_C         = 0x00800000;
const FPCSR_FS        = 0x01000000;

// TODO: rename PID -> ASID
const TLBHI_RMASK = 0xc000000000000000n;
const TLBHI_RSHIFT = 62n;
const TLBHI_VPN2MASK = 0x000000ffffffe000n;
const TLBHI_VPN2SHIFT = 13n;
const TLBHI_PIDMASK = 0xffn;

const entryHiWritableBits = 0xc00000ffffffe0ffn;

const TLBLO_PFNMASK     = 0x3fffffc0; // This looks incorrect should be 0x03ff_ffc0
const TLBLO_PFNSHIFT    = 6;
const TLBLO_CACHMASK    = 0x38;
const TLBLO_CACHSHIFT   = 3;
const TLBLO_UNCACHED    = 0x10;
const TLBLO_NONCOHRNT   = 0x18;
const TLBLO_EXLWR       = 0x28;
const TLBLO_D           = 0x4;
const TLBLO_V           = 0x2;
const TLBLO_G           = 0x1;

const entryLoWritableBits = 0x3fffffffn;

const TLBINX_PROBE      = 0x80000000;
const TLBINX_INXMASK    = 0x3f;
const TLBINX_INXSHIFT   = 0;

const indexWritableBits = 0x8000003fn;

const TLBRAND_RANDMASK  = 0x3f;
const TLBRAND_RANDSHIFT = 0;

const TLBWIRED_WIREDMASK  = 0x3f;

const wiredWritableBits = 0x3fn;

const TLBCTXT_BASEMASK  = 0xff800000;
const TLBCTXT_BASESHIFT = 23;
const TLBCTXT_BASEBITS  = 9;

const TLBCTXT_VPNMASK   = 0x7ffff0;
const TLBCTXT_VPNSHIFT  = 4;

const contextWriteableBits = ~0x7fffffn;

const xContextBadVPN2Mask = 0x7fff_fff0n;
const xContextBadVPN2Shift = 4n;
const xContextRMask = 0x1_8000_0000n;
const xContextRShift = 31n;

const xContextWritableBits = 0xfffffffe_00000000n;

const TLBPGMASK_4K      = 0x00000000;
const TLBPGMASK_16K     = 0x00006000;
const TLBPGMASK_64K     = 0x0001e000;
const TLBPGMASK_256K    = 0x0007e000;
const TLBPGMASK_1M      = 0x001fe000;
const TLBPGMASK_4M      = 0x007fe000;
const TLBPGMASK_16M     = 0x01ffe000;

const pageMaskLowBits = 0x00001fff;
const pageMaskWritableBits = 0x01ffe000n;
const configWritableBits = 0x0f00800fn;
const llAddrWritableBits = 0xffffffffn;
const eccWritableBits = 0xffn

const kStuffToDoHalt            = 1<<0;
const kStuffToDoCheckInterrupts = 1<<1;
const kStuffToDoBreakout        = 1<<2;

const kEventVbl          = 0;
const kEventCompare      = 1;
const kEventRunForCycles = 2;

// TODO: figure out what masking and shifting constants this should use.
function getAddress32VPN2(address) { return (address >>> 13);}
function getAddress64VPN2(address) { return (address & TLBHI_VPN2MASK) >> TLBHI_VPN2SHIFT;}
function getAddress64R(address) { return (address & TLBHI_RMASK) >> TLBHI_RSHIFT;}

// Needs to be callable from dynarec.
n64js.getSyncFlow = () => syncFlow;

const s32SignBit = 0x8000_0000;
const s64SignBit = 0x8000_0000_0000_0000n;

const u32Max = 0xffff_ffff;
const u64Max = 0xffff_ffff_ffff_ffffn;

const u32MaxBigInt = 0xffff_ffffn;

// See https://grack.com/blog/2022/12/20/deriving-a-bit-twiddling-hack/.
function s32CheckAddOverflow(a, b, c) {
  return (~(a ^ b) & (c ^ a) & s32SignBit) != 0;
}

function s32CheckSubOverflow(a, b, c) {
  return ((a ^ b) & (c ^ a) & s32SignBit) != 0;
}

function s64CheckAddOverflow(a, b, c) {
  return (~(a ^ b) & (c ^ a) & s64SignBit) != 0n;
}

function s64CheckSubOverflow(a, b, c) {
  return ((a ^ b) & (c ^ a) & s64SignBit) != 0n;
}

n64js.s32CheckAddOverflow = s32CheckAddOverflow;
n64js.s32CheckSubOverflow = s32CheckSubOverflow;
n64js.s64CheckAddOverflow = s64CheckAddOverflow;
n64js.s64CheckSubOverflow = s64CheckSubOverflow;


class TLBEntry {
  constructor() {
    // TLB state (as configured by application).
    this.pagemask = 0;
    this.hi = 0n;
    this.pfne = 0;
    this.pfno = 0;
    this.global = 0;

    // Derived state (cached for performance).
    this.offsetMask = 0;
    this.vpnmask64 = TLBHI_VPN2MASK;

    this.vpn2bits = 0n;
    this.physEven = 0;
    this.physOdd = 0;
    this.checkbit = 0;
  }

  /**
   * 
   * @param {number} index 
   * @param {number} pagemask 
   * @param {bigint} hi 
   * @param {number} entrylo0 
   * @param {number} entrylo1 
   */
  update(index, pagemask, hi, entrylo0, entrylo1) {
    if (kDebugTLB) {
      logger.log(`TLB update: index=${index}, pagemask=${toString32(pagemask)}, entryhi=${toString64_bigint(hi)}, entrylo0=${toString32(entrylo0)}, entrylo1=${toString32(entrylo1)}`);
      logger.log(`       ${pageMaskName(pagemask)} Pagesize`);
    }

    const global = entrylo0 & entrylo1 & TLBLO_G;

    this.pagemask = canonicalisePageMask(pagemask);
    this.hi = hi;
    this.pfne = (entrylo0 & ~TLBLO_G) | global;
    this.pfno = (entrylo1 & ~TLBLO_G) | global;
    this.global = global;

    this.offsetMask = (this.pagemask | pageMaskLowBits) >>> 1;

    // VPN mask is shrunk depending on the page size (larger page -> smaller VPN).
    this.vpnmask64 = TLBHI_VPN2MASK & BigInt(~this.pagemask);
    this.vpn2bits = hi & this.vpnmask64;

    this.physEven = (this.pfne << 6) & ~this.offsetMask;
    this.physOdd = (this.pfno << 6) & ~this.offsetMask;

    this.checkbit = pageMaskCheckbit(this.pagemask);
  }
}

const pageMaskNames = new Map([
  [TLBPGMASK_4K, '4k'],
  [TLBPGMASK_16K, '16k'],
  [TLBPGMASK_64K, '64k'],
  [TLBPGMASK_256K, '256k'],
  [TLBPGMASK_1M, '1M'],
  [TLBPGMASK_4M, '4M'],
  [TLBPGMASK_16M, '16M'],
]);

function pageMaskBits(pageMask) {
  return (pageMask >> 13) & 0xfff;
}

/**
 * Returns the pagemask as canonicalised by the VR4300 (i.e. the value
 * that's read back via TLBR).
 * @param {number} pageMask 
 * @returns 
 */
function canonicalisePageMask(pageMask) {
  const bits = pageMaskBits(pageMask);
  // Each pair of bits is considered separately.
  // If the upper (odd) bit is set then both bits are set in result.
  const oddBits = bits & 0b1010_1010_1010;
  const r = oddBits | (oddBits >> 1);
  return r << 13;
}

function pageMaskCheckbit(pageMask) {
  const bits = pageMaskBits(pageMask);
  if (bits & 0b1000_0000_0000) return 1 << 24;
  if (bits & 0b0010_0000_0000) return 1 << 22;
  if (bits & 0b0000_1000_0000) return 1 << 20;
  if (bits & 0b0000_0010_0000) return 1 << 18;
  if (bits & 0b0000_0000_1000) return 1 << 16;
  if (bits & 0b0000_0000_0010) return 1 << 14;
  return 1 << 12;
}

function pageMaskName(pageMask) {
  const name = pageMaskNames.get(pageMask);
  if (name) {
    return name;
  }
  const bits = pageMaskBits(pageMask);
  return `Unknown(${bits.toString(2)})`;
}

class CPU0 {
  constructor() {
    this.opsExecuted = 0; // Approximate...

    this.ramDV = undefined; // Bound in reset().

    const gprMem = new ArrayBuffer(32 * 8);
    this.gprU32 = new Uint32Array(gprMem);
    this.gprS32 = new Int32Array(gprMem);
    this.gprU64 = new BigUint64Array(gprMem);
    this.gprS64 = new BigInt64Array(gprMem);

    const controlMem = new ArrayBuffer(32 * 8);
    this.controlRegU32 = new Uint32Array(controlMem);
    this.controlRegS32 = new Int32Array(controlMem);
    this.controlRegU64 = new BigUint64Array(controlMem);
    this.controlRegS64 = new BigInt64Array(controlMem);

    // Reads from invalid control registers will use the value last written to any control register.
    this.lastControlRegWrite = 0n;

    this.pc = 0;
    this.delayPC = 0;
    this.nextPC = 0; // Set to the next expected PC before an op executes. Ops can update this to change control flow without branch delay (e.g. likely branches, ERET)
    this.branchTarget = 0; // Set to indicate a branch has been taken. Sets the delayPC for the subsequent op.

    this.llBit = 0;  // Load Linked bit.

    this.stuffToDo = 0; // used to flag r4300 to cease execution

    this.events = [];

    const multHiMem = new ArrayBuffer(2 * 4);
    this.multHiU32 = new Uint32Array(multHiMem);
    this.multHiS32 = new Int32Array(multHiMem);
    this.multHiU64 = new BigUint64Array(multHiMem);
    this.multHiS64 = new BigInt64Array(multHiMem);

    const multLoMem = new ArrayBuffer(2 * 4);
    this.multLoU32 = new Uint32Array(multLoMem);
    this.multLoS32 = new Int32Array(multLoMem);
    this.multLoU64 = new BigUint64Array(multLoMem);
    this.multLoS64 = new BigInt64Array(multLoMem);

    this.tlbEntries = [];
    for (let i = 0; i < 32; ++i) {
      this.tlbEntries.push(new TLBEntry());
    }

    // Take references to the memory handler functions so they're easily accessible from dynarec.
    // TODO: export these via a dedicated context object.
    this.loadU8fast = memaccess.loadU8fast;
    this.loadU16fast = memaccess.loadU16fast;
    this.loadU32fast = memaccess.loadU32fast;
    this.loadU64fast = memaccess.loadU64fast;

    this.loadS8fast = memaccess.loadS8fast;
    this.loadS16fast = memaccess.loadS16fast;
    this.loadS32fast = memaccess.loadS32fast;

    this.store8fast = memaccess.store8fast;
    this.store16fast = memaccess.store16fast;
    this.store32fast = memaccess.store32fast;
    this.store64fast = memaccess.store64fast;

    this.store32masked = memaccess.store32masked;
    this.store64masked = memaccess.store64masked;
  }

  conditionalBranch(cond, offset) {
    const effectiveOffset = cond ? (offset * 4) : 4;
    this.branchTarget = this.pc + 4 + effectiveOffset;
  }

  conditionalBranchLikely(cond, offset) {
    if (cond) {
      this.branchTarget = this.pc + 4 + (offset * 4);
    } else {
      this.nextPC += 4;  // Skip the next instruction
    }
  }

  jump(pc) {
    //if (pc < 0) {
    //  logger.log('Oops, branching to negative address: ' + pc);
    //  throw 'Oops, branching to negative address: ' + pc;
    //}
    this.branchTarget = pc;
  }

  getCount() {
    return this.getControlU32(cpu0_constants.controlCount);
  }

  incrementCount(val) {
    const curCount = this.getControlS32(cpu0_constants.controlCount);
    this.setControlS32(cpu0_constants.controlCount, curCount + val);
  }

  getRegS32Lo(r) { return this.gprS32[r * 2 + 0]; }
  getRegU32Lo(r) { return this.gprU32[r * 2 + 0]; }
  getRegS64(r) { return this.gprS64[r]; }
  getRegU64(r) { return this.gprU64[r]; }

  setRegU64(r, v) {
    // TODO: Avoid the need for this in dynarec code.
    if (r == 0) {
      return;
    }
    // This shouldn't be needed but there seems to be a bug with BigInts > 64 bits.
    // TODO: check still needed with BigUint64Array.
    const truncated = v & u64Max;
    this.gprU64[r] = truncated;
  }

  setRegU64Masked(r, v, m) {
    // TODO: Avoid the need for this in dynarec code.
    if (r == 0) {
      return;
    }
    this.gprU64[r] = (this.gprU64[r] & ~m) | (v & m);
  }

  setRegS64LoHi(r, lo, hi) {
    // TODO: Avoid the need for this in dynarec code.
    if (r == 0) {
      return;
    }
    this.gprS32[r * 2 + 0] = lo;
    this.gprS32[r * 2 + 1] = hi;
  }

  setRegS32ExtendMasked(r, v, m) {
    // TODO: Avoid the need for this in dynarec code.
    if (r == 0) {
      return;
    }
    const result = (this.gprS32[r * 2 + 0] & ~m) | (v & m);
    this.gprS32[r * 2 + 0] = result;
    this.gprS32[r * 2 + 1] = result >> 31;
  }

  setRegS32Extend(r, v) {
    // TODO: Avoid the need for this in dynarec code.
    if (r == 0) {
      return;
    }
    this.gprS32[r * 2 + 0] = v;
    this.gprS32[r * 2 + 1] = v >> 31;
  }

  setRegU32Extend(r, v) {
    // TODO: Avoid the need for this in dynarec code.
    if (r == 0) {
      return;
    }
    this.gprU32[r * 2 + 0] = v;
    this.gprU32[r * 2 + 1] = 0;
  }

  getMultLoS64() { return this.multLoS64[0]; }
  getMultLoU64() { return this.multLoU64[0]; }
  setMultLoS32Extend(v) { this.multLoS64[0] = BigInt.asIntN(32, v); }
  setMultLoS64(v) { this.multLoS64[0] = v; }
  setMultLoU64(v) { this.multLoU64[0] = v; }

  getMultHiS64() { return this.multHiS64[0]; }
  getMultHiU64() { return this.multHiU64[0]; }
  setMultHiS32Extend(v) { this.multHiS64[0] = BigInt.asIntN(32, v); }
  setMultHiS64(v) { this.multHiS64[0] = v; }
  setMultHiU64(v) { this.multHiU64[0] = v; }

  setControlU32(r, v) { this.controlRegU32[r * 2 + 0] = v; }
  setControlS32(r, v) { this.controlRegS32[r * 2 + 0] = v; }
  getControlU32(r) { return this.controlRegU32[r * 2 + 0]; }
  getControlS32(r) { return this.controlRegS32[r * 2 + 0]; }

  setControlS32Extend(r, v) {
    this.controlRegS32[r * 2 + 0] = v;
    this.controlRegS32[r * 2 + 1] = v >> 31;
  }

  setControlU64(r, v) { this.controlRegU64[r] = v; }
  setControlS64(r, v) { this.controlRegS64[r] = v; }
  getControlU64(r) { return this.controlRegU64[r]; }
  getControlS64(r) { return this.controlRegS64[r]; }

  maskControlBits32(r, mask, value) {
    const idx = r * 2 + 0;
    this.controlRegU32[idx] = (this.controlRegU32[idx] & ~mask) | (value & mask);
  }

  setControlBits32(r, value) { this.controlRegU32[r * 2 + 0] |= value; }
  clearControlBits32(r, value) { this.controlRegU32[r * 2 + 0] &= ~value; }

  maskControlBits64(r, mask, value) {
    this.controlRegU64[r] = (this.controlRegU64[r] & ~mask) | (value & mask);
  }

  setControlBits64(r, value) { this.controlRegU64[r] |= value; }
  clearControlBits64(r, value) { this.controlRegU64[r] &= ~value; }

  reset() {
    resetFragments();

    this.ramDV = n64js.getRamDataView();

    for (let i = 0; i < 32; ++i) {
      this.gprU64[i] = 0n;
      this.controlRegU64[i] = 0n;
    }
    for (let i = 0; i < 32; ++i) {
      this.tlbEntries[i].update(i, 0, 0x80000000n, 0, 0);
    }

    this.pc = 0;
    this.delayPC = 0;
    this.nextPC = 0;
    this.branchTarget = 0;

    this.stuffToDo = 0;

    this.events = [];

    this.multLoU32[0] = this.multLoU32[1] = 0;
    this.multHiU32[0] = this.multHiU32[1] = 0;

    this.setControlU32(cpu0_constants.controlRand, 32 - 1);
    this.setControlU32(cpu0_constants.controlStatus, 0x70400004);
    this.setControlU32(cpu0_constants.controlConfig, 0x7006e463);
    cop1ControlChanged();
  }

  /**
   * Moves the software-provided value to the control register, obeying masking.
   * @param {number} controlReg The control register to update.
   * @param {bigint} newValue The value to set.
   */
  moveToControl(controlReg, newValue) {
    this.lastControlRegWrite = newValue;

    switch (controlReg) {
      case cpu0_constants.controlIndex:
        this.setControlU64(controlReg, newValue & indexWritableBits);
        break;

      case cpu0_constants.controlEntryLo0:
      case cpu0_constants.controlEntryLo1:
        this.setControlU64(controlReg, newValue & entryLoWritableBits);
        break;

      case cpu0_constants.controlContext:
        this.setControlU64(controlReg, newValue & contextWriteableBits);
        break;

      case cpu0_constants.controlPageMask:
        this.setControlU64(controlReg, newValue & pageMaskWritableBits);
        break;

      case cpu0_constants.controlWired:
        this.setControlU64(controlReg, newValue & wiredWritableBits);
        // Set to top limit on write to wired
        this.setControlU64(cpu0_constants.controlRand, 31n);
        break;

      case cpu0_constants.controlEntryHi:
        this.setControlU64(controlReg, newValue & entryHiWritableBits);
        break;

      case cpu0_constants.controlRand:
      case cpu0_constants.controlBadVAddr:
      case cpu0_constants.controlPRId:
      case cpu0_constants.controlCacheErr:
        // All these registers are read-only
        break;

      case cpu0_constants.controlConfig:
        this.maskControlBits64(controlReg, configWritableBits, newValue);
        break;

      case cpu0_constants.controlCause:
        logger.log(`Setting cause register to ${toString32(newValue)}`);
        n64js.check(newValue === 0, 'Should only write 0 to Cause register.');
        this.maskControlBits64(controlReg, causeWritableBits, newValue);
        break;

      case cpu0_constants.controlStatus:
        this.setControlU64(controlReg, newValue & statusWritableBits);
        this.statusRegisterChanged();
        break;
      case cpu0_constants.controlCount:
        this.setControlU64(controlReg, newValue);
        break;
      case cpu0_constants.controlCompare:
        this.setCompare(Number(newValue & 0xffff_ffffn));
        break;

      case cpu0_constants.controlXContext:
        this.maskControlBits64(controlReg, xContextWritableBits, newValue);
        break;

      case cpu0_constants.controlEPC:
      case cpu0_constants.controlTagLo:
      case cpu0_constants.controlTagHi:
        this.setControlU64(controlReg, newValue);
        break;

      case cpu0_constants.controlLLAddr:
        this.maskControlBits64(controlReg, llAddrWritableBits, newValue);
        break;

      case cpu0_constants.controlInvalid7:
      case cpu0_constants.controlInvalid21:
      case cpu0_constants.controlInvalid22:
      case cpu0_constants.controlInvalid23:
      case cpu0_constants.controlInvalid24:
      case cpu0_constants.controlInvalid25:
      case cpu0_constants.controlInvalid31:
        // Ignore writes.
        // Reads from invalid control registers will use the value last written to any control register.
        break;

      case cpu0_constants.controlParityError:
        this.setControlU64(controlReg, newValue & eccWritableBits);
        break;

      case cpu0_constants.controlErrorEPC:
        this.setControlU64(controlReg, newValue);
        break;

      default:
        this.setControlU64(controlReg, newValue);
        logger.log(`Write to cpu0 control register. ${toString64_bigint(newValue)} --> ${cop0ControlRegisterNames[controlReg]}`);
        break;
    }
  }

  /**
   * Returns the control register value.
   * @param {number} controlReg The control register to get.
   * @returns {bigint} The register value.
   */
  moveFromControl(controlReg) {
    // Check consistency
    if (controlReg === cpu0_constants.controlCause) {
      checkCauseIP3Consistent();
    }

    switch (controlReg) {
      case cpu0_constants.controlRand:
        return BigInt(this.getRandom());
      case cpu0_constants.controlInvalid7:
      case cpu0_constants.controlInvalid21:
      case cpu0_constants.controlInvalid22:
      case cpu0_constants.controlInvalid23:
      case cpu0_constants.controlInvalid24:
      case cpu0_constants.controlInvalid25:
      case cpu0_constants.controlInvalid31:
        // Reads from invalid control registers will use the value last written to any control register.
        return this.lastControlRegWrite;
      default:
        return this.getControlU64(controlReg);
    }
  }

  breakExecution() {
    this.stuffToDo |= kStuffToDoHalt;
  }

  speedHack() {
    const nextInstruction = n64js.hardware().memMap.readMemoryInternal32(this.pc + 4);
    if (nextInstruction === 0) {
      if (this.events.length > 0) {
        // Ignore the kEventRunForCycles event
        let runCountdown = 0;
        if (this.events[0].type === kEventRunForCycles && this.events.length > 1) {
          runCountdown += this.events[0].countdown;
          this.events.splice(0, 1);
        }

        const toSkip = runCountdown + this.events[0].countdown - 1;

        // logger.log('speedhack: skipping ' + toSkip + ' cycles');

        const curCount = this.getControlU32(cpu0_constants.controlCount);
        this.setControlU32(cpu0_constants.controlCount, curCount + toSkip);
        this.events[0].countdown = 1;

        // Re-add the kEventRunForCycles event
        if (runCountdown) {
          this.addEvent(kEventRunForCycles, runCountdown);
        }
      } else {
        logger.log('no events');
      }
    } else {
      // logger.log('next instruction does something');
    }
  }

  updateCause3() {
    const miRegDevice = n64js.hardware().miRegDevice;
    if (miRegDevice.interruptsUnmasked()) {
      this.setControlBits32(cpu0_constants.controlCause, CAUSE_IP3);
      this.updateStuffToDoForInterrupts();
    } else {
      this.clearControlBits32(cpu0_constants.controlCause, CAUSE_IP3);
    }

    checkCauseIP3Consistent();
  }

  statusRegisterChanged() {
    cop1ControlChanged();
    this.updateStuffToDoForInterrupts();
  }

  checkForUnmaskedInterrupts() {
    const sr = this.getControlU32(cpu0_constants.controlStatus);

    // Ensure ERL/EXL are clear and IE is set
    if ((sr & (SR_EXL | SR_ERL | SR_IE)) === SR_IE) {
      // Check if interrupts are actually pending, and wanted
      const cause = this.getControlU32(cpu0_constants.controlCause);
      if ((sr & cause & CAUSE_IPMASK) !== 0) {
        return true;
      }
    }

    return false;
  }

  updateStuffToDoForInterrupts() {
    if (this.checkForUnmaskedInterrupts()) {
      this.stuffToDo |= kStuffToDoCheckInterrupts;
    } else {
      this.stuffToDo &= ~kStuffToDoCheckInterrupts;
    }
  }

  setBadVAddr(address64) {
    this.setControlU64(cpu0_constants.controlBadVAddr, address64);
  }

  setContext(address64) {
    const address32 = Number(address64 & 0xffffffffn);
    const context = getAddress32VPN2(address32) << TLBCTXT_VPNSHIFT;
    this.maskControlBits32(cpu0_constants.controlContext, TLBCTXT_VPNMASK, context);
  }

  setXContext(address64) {
    const xcontext = (getAddress64VPN2(address64) << xContextBadVPN2Shift) | (getAddress64R(address64) << xContextRShift);
    const xContextMask = xContextBadVPN2Mask | xContextRMask;
    this.maskControlBits64(cpu0_constants.controlXContext, xContextMask, xcontext);
  }

  checkCopXUsable(copIdx) {
    // TODO: this probably needs to throw a JS exception which is caught in n64js.run
    // to ensure bookkeeping (like updating the delayPC) isn't run.
    const bit = 1 << (SR_CUSHIFT + copIdx);
    const usable = (cpu0.getControlU32(cpu0_constants.controlStatus) & bit) != 0;
    if (!usable) {
      this.throwCopXUnusable(copIdx);
      return false;
    }
    return true;
  }

  throwCopXUnusable(copIdx) {
    // XXXX check we're not inside exception handler before snuffing CAUSE reg?
    const ce = copIdx << CAUSE_CESHIFT;
    this.raiseGeneralException(CAUSE_EXCMASK | CAUSE_CEMASK, causeExcCodeCpU | ce);
  }

  raiseSYSCALLException() {
    this.raiseGeneralException(CAUSE_EXCMASK | CAUSE_CEMASK, causeExcCodeSys);
  }

  raiseBREAKException() {
    this.raiseGeneralException(CAUSE_EXCMASK | CAUSE_CEMASK, causeExcCodeBp);
  }

  raiseRESERVEDException(copIdx) {
    const ce = copIdx << CAUSE_CESHIFT;
    this.raiseGeneralException(CAUSE_EXCMASK | CAUSE_CEMASK, causeExcCodeRI | ce);
  }

  raiseTRAPException() {
    this.raiseGeneralException(CAUSE_EXCMASK | CAUSE_CEMASK, causeExcCodeTr);
  }

  maybeRaiseTRAPException(cond) {
    if (cond) {
      this.raiseTRAPException();
    }
  }

  raiseOverflowException() {
    this.raiseGeneralException(CAUSE_EXCMASK | CAUSE_CEMASK, causeExcCodeOv);
  }

  raiseFPE() {
    this.raiseGeneralException(CAUSE_EXCMASK | CAUSE_CEMASK, causeExcCodeFPE);
  }

  raiseTLBException(address32, exc_code, vec) {
    // TODO: plumb 64 bit addresses everywhere.
    const address64 = BigInt(address32 >> 0);
    this.setBadVAddr(address64);
    this.setContext(address64);
    this.setXContext(address64);
    this.maskControlBits64(cpu0_constants.controlEntryHi, TLBHI_VPN2MASK, address64);

    // XXXX check we're not inside exception handler before snuffing CAUSE reg?
    this.raiseException(CAUSE_EXCMASK | CAUSE_CEMASK, exc_code, vec);
  }

  raiseAdELException(address32) {
    this.raiseAddressException(address32, causeExcCodeAdEL);
  }

  raiseAdESException(address32) {
    this.raiseAddressException(address32, causeExcCodeAdES);
  }

  raiseAddressException(address32, code) {
    // TODO: plumb 64 bit addresses everywhere.
    const address64 = BigInt(address32 >> 0);
    this.setBadVAddr(address64);
    this.setContext(address64);
    this.setXContext(address64);
    this.raiseGeneralException(CAUSE_EXCMASK | CAUSE_CEMASK, code);
  }

  handleInterrupt() {
    if (this.checkForUnmaskedInterrupts()) {
      this.raiseGeneralException(CAUSE_EXCMASK, causeExcCodeInt);
      // This is handled outside of the main dispatch loop, so need to update pc directly.
      this.pc = E_VEC;
      this.delayPC = 0;

    } else {
      assert(false, "Was expecting an unmasked interrupt - something wrong with kStuffToDoCheckInterrupts?");
    }
  }

  raiseException(mask, exception, excVec) {
    this.maskControlBits32(cpu0_constants.controlCause, mask, exception);
    this.setControlBits32(cpu0_constants.controlStatus, SR_EXL);

    if (this.delayPC) {
      this.setControlBits32(cpu0_constants.controlCause, CAUSE_BD);
      this.setControlS32Extend(cpu0_constants.controlEPC, this.pc - 4);
    } else {
      this.clearControlBits32(cpu0_constants.controlCause, CAUSE_BD);
      this.setControlS32Extend(cpu0_constants.controlEPC, this.pc);
    }
    this.nextPC = excVec;
  }

  raiseGeneralException(mask, exception) {
    this.raiseException(mask, exception, E_VEC);
  }

  setCompare(value) {
    this.clearControlBits32(cpu0_constants.controlCause, CAUSE_IP8);

    if (value === this.getControlU32(cpu0_constants.controlCompare)) {
      // Just clear the IP8 flag if the same value is being written back
      // (don't update the events).
    } else {
      const count = this.getControlU32(cpu0_constants.controlCount);
      const delta = (value - count) >>> 0;
      this.removeEventsOfType(kEventCompare);
      this.addEvent(kEventCompare, delta);
      this.setControlU32(cpu0_constants.controlCompare, value);
    }
  }

  // TODO: refector this so event types are accessible.
  addVblEvent(countdown) {
    this.addEvent(kEventVbl, countdown);
  }

  hasVblEvent() {
    return this.hasEvent(kEventVbl);
  }

  getVblCount() {
    const event = this.getEvent(kEventVbl);
    if (event) {
      return event.countdown;
    }
    return 0;
  }

  addEvent(type, countdown) {
    assert(!this.hasEvent(type), `Already has event of type ${type}`);
    assert(countdown > 0, `Countdown must be positive`);

    for (let i = 0; i < this.events.length; ++i) {
      const event = this.events[i];
      if (countdown <= event.countdown) {
        event.countdown -= countdown;
        this.events.splice(i, 0, new SystemEvent(type, countdown));
        return;
      }
      countdown -= event.countdown;
    }
    this.events.push(new SystemEvent(type, countdown));
  }

  removeEventsOfType(type) {
    let count = 0;
    for (let i = 0; i < this.events.length; ++i) {
      const event = this.events[i];
      count += event.countdown;

      if (event.type == type) {
        // Add this countdown on to the subsequent event
        if ((i + 1) < this.events.length) {
          this.events[i + 1].countdown += this.events[i].countdown;
        }
        this.events.splice(i, 1);
        return count;
      }
    }

    // Not found.
    return -1;
  }

  getEvent(type) {
    for (let event of this.events) {
      if (event.type == type) {
        return event;
      }
    }
    return null;
  }

  hasEvent(type) {
    return Boolean(this.getEvent(type));
  }

  getRandom() {
    // If wired >=32 values in the range [0,64) are returned, else [wired, 32)
    const wired = this.getControlU32(cpu0_constants.controlWired);
    const min = wired >= 32 ? 0 : (wired & 31);
    const max = wired >= 32 ? 64 : 32;

    let random = Math.floor(Math.random() * (max - min)) + min;
    assert(random >= min && random < max, `Ooops - random should be in range [${min},${max}), but got ${random}`);
    if (syncFlow) {
      random = syncFlow.reflect32(random);
    }
    return random;
  }

  setTLB(indexRaw) {
    const index = indexRaw & 31;
    const pagemask = this.getControlU32(cpu0_constants.controlPageMask);
    const entryhi = this.getControlU64(cpu0_constants.controlEntryHi);
    const entrylo1 = this.getControlU32(cpu0_constants.controlEntryLo1);
    const entrylo0 = this.getControlU32(cpu0_constants.controlEntryLo0);

    this.tlbEntries[index].update(index, pagemask, entryhi, entrylo0, entrylo1);
  }

  tlbWriteIndex() {
    this.setTLB(this.getControlU32(cpu0_constants.controlIndex));
  }

  tlbWriteRandom() {
    this.setTLB(this.getRandom());
  }

  tlbRead() {
    const index = this.getControlU32(cpu0_constants.controlIndex) & 0x1f;
    const tlb = this.tlbEntries[index];

    // TODO: can hiMask be simplified (perhaps bake the mask into the tlb.hi value)?
    // TODO: Why does the pfn mask not seem to match TLBLO_PFNMASK? Is ultra header buggy?
    const hiMask = (TLBHI_RMASK | TLBHI_VPN2MASK | TLBHI_PIDMASK) & BigInt(~tlb.pagemask);
    const pfnMask = 0x03ff_ffff;

    this.setControlU32(cpu0_constants.controlPageMask, tlb.pagemask);
    this.setControlU64(cpu0_constants.controlEntryHi, tlb.hi & hiMask);
    this.setControlU32(cpu0_constants.controlEntryLo0, tlb.pfne & pfnMask);
    this.setControlU32(cpu0_constants.controlEntryLo1, tlb.pfno & pfnMask);

    if (kDebugTLB) {
      logger.log('TLB Read Index ' + toString8(index) + '.');
      logger.log('  PageMask: ' + toString32(this.getControlU32(cpu0_constants.controlPageMask)));
      logger.log('  EntryHi:  ' + toString64_bigint(this.getControlU64(cpu0_constants.controlEntryHi)));
      logger.log('  EntryLo0: ' + toString32(this.getControlU32(cpu0_constants.controlEntryLo0)));
      logger.log('  EntryLo1: ' + toString32(this.getControlU32(cpu0_constants.controlEntryLo1)));
    }
  }

  tlbProbe() {
    const entryHi = this.getControlU64(cpu0_constants.controlEntryHi);
    const entryHiPID = entryHi & TLBHI_PIDMASK;

    for (let i = 0; i < 32; ++i) {
      const tlb = this.tlbEntries[i];
      // VPN and R should match.
      const vpnAndRMask = tlb.vpnmask64 | TLBHI_RMASK;
      if ((tlb.hi & vpnAndRMask) !== (entryHi & vpnAndRMask)) {
        continue;
      }
      // ASID should match, or should be global.
      if (!tlb.global && ((tlb.hi & TLBHI_PIDMASK) !== entryHiPID)) {
        continue;
      }

      if (kDebugTLB) {
        logger.log('TLB Probe. EntryHi:' + toString32(entryHi) + '. Found matching TLB entry - ' + toString8(i));
      }
      this.setControlU32(cpu0_constants.controlIndex, i);
      return;
    }

    if (kDebugTLB) {
      logger.log('TLB Probe. EntryHi:' + toString32(entryHi) + ". Didn't find matching entry");
    }
    this.setControlU32(cpu0_constants.controlIndex, TLBINX_PROBE);
  }

  tlbFindEntry(address) {
    const entryHi = this.getControlU64(cpu0_constants.controlEntryHi);
    const entryHiPID = entryHi & TLBHI_PIDMASK;

    // TODO: plumb through 64 bit addresses.
    const address64 = BigInt(address >>> 0);

    for (let i = 0; i < 32; ++i) {
      // TODO: use MRU cache here.
      const tlb = this.tlbEntries[i];

      // VPN should match.
      // TODO: also R?
      if ((address64 & tlb.vpnmask64) !== tlb.vpn2bits) {
        continue;
      }
      if (!tlb.global && ((tlb.hi & TLBHI_PIDMASK) !== entryHiPID)) {
        // ASID should match, or should be global.
        continue;
      }
      return tlb;
    }

    return null;
  }

  translateReadInternal(address) {
    const tlb = this.tlbFindEntry(address);
    if (!tlb) {
      return 0;
    }

    const odd = address & tlb.checkbit;
    const entryLo = odd ? tlb.pfno : tlb.pfne;
    if ((entryLo & TLBLO_V) === 0) {
      return 0;
    }

    const phys = odd ? tlb.physOdd : tlb.physEven;
    const offset = address & tlb.offsetMask;
    return phys | offset;
  }

  translateRead(address) {
    const tlb = this.tlbFindEntry(address);
    if (!tlb) {
      this.raiseTLBException(address, causeExcCodeTLBL, UT_VEC);
      throw new EmulatedException();
    }

    const odd = address & tlb.checkbit;
    const entryLo = odd ? tlb.pfno : tlb.pfne;
    if ((entryLo & TLBLO_V) === 0) {
      this.raiseTLBException(address, causeExcCodeTLBL, E_VEC)
      throw new EmulatedException();
    }

    const phys = odd ? tlb.physOdd : tlb.physEven;
    const offset = address & tlb.offsetMask;
    return phys | offset;
  }

  translateWrite(address) {
    const tlb = this.tlbFindEntry(address);
    if (!tlb) {
      this.raiseTLBException(address, causeExcCodeTLBS, UT_VEC);
      throw new EmulatedException();
    }

    const odd = address & tlb.checkbit;
    const entryLo = odd ? tlb.pfno : tlb.pfne;
    if ((entryLo & TLBLO_V) === 0) {
      this.raiseTLBException(address, causeExcCodeTLBS, E_VEC);
      throw new EmulatedException();
    }
    if ((entryLo & TLBLO_D) === 0) {
      this.raiseTLBException(address, causeExcCodeMod, E_VEC);
      throw new EmulatedException();
    }

    const phys = odd ? tlb.physOdd : tlb.physEven;
    const offset = address & tlb.offsetMask;
    return phys | offset;
  }

  unalignedLoad(address) {
    this.raiseAdELException(address);
    throw new EmulatedException();
  }

  unalignedStore(address) {
    this.raiseAdESException(address);
    throw new EmulatedException();
  }

  // SRA appears to shift the full 64 bit reg, trunc to 32 bits, then sign extend.
  execSLL(rd, rt, sa) { this.setRegS32Extend(rd, this.getRegS32Lo(rt) << sa); }
  execSRL(rd, rt, sa) { this.setRegS32Extend(rd, this.getRegU32Lo(rt) >>> sa); }
  execSRA(rd, rt, sa) { this.setRegS32Extend(rd, Number(this.getRegS64(rt) >> BigInt(sa) & 0xffff_ffffn)); }
  execSLLV(rd, rt, rs) { this.setRegS32Extend(rd, this.getRegS32Lo(rt) << (this.getRegS32Lo(rs) & 0x1f)); }
  execSRLV(rd, rt, rs) { this.setRegS32Extend(rd, this.getRegS32Lo(rt) >>> (this.getRegS32Lo(rs) & 0x1f)); }
  execSRAV(rd, rt, rs) { this.setRegS32Extend(rd, Number(this.getRegS64(rt) >> BigInt(this.getRegS32Lo(rs) & 0x1f) & 0xffff_ffffn)); }
  execDSLLV(rd, rt, rs) { this.setRegU64(rd, this.getRegU64(rt) << BigInt(this.getRegU32Lo(rs) & 0x3f)); }
  execDSRLV(rd, rt, rs) { this.setRegU64(rd, this.getRegU64(rt) >> BigInt(this.getRegU32Lo(rs) & 0x3f)); }
  execDSRAV(rd, rt, rs) { this.setRegU64(rd, this.getRegS64(rt) >> BigInt(this.getRegU32Lo(rs) & 0x3f)); }
  execDSLL(rd, rt, sa) { this.setRegU64(rd, this.getRegU64(rt) << BigInt(sa)); }
  execDSRL(rd, rt, sa) { this.setRegU64(rd, this.getRegU64(rt) >> BigInt(sa)); }
  execDSRA(rd, rt, sa) { this.setRegU64(rd, this.getRegS64(rt) >> BigInt(sa)); }
  execDSLL32(rd, rt, sa) { this.setRegU64(rd, this.getRegU64(rt) << BigInt(sa + 32)); }
  execDSRL32(rd, rt, sa) { this.setRegU64(rd, this.getRegU64(rt) >> BigInt(sa + 32)); }
  execDSRA32(rd, rt, sa) { this.setRegU64(rd, this.getRegS64(rt) >> BigInt(sa + 32)); }

  execSYSCALL() { this.raiseSYSCALLException(); }
  execBREAK() { this.raiseBREAKException(); }
  execSYNC() { /* no-op */ }

  execMFHI(rd) { this.setRegU64(rd, this.getMultHiU64()); }
  execMFLO(rd) { this.setRegU64(rd, this.getMultLoU64()); }
  execMTHI(rs) { this.setMultHiU64(this.getRegU64(rs)); }
  execMTLO(rs) { this.setMultLoU64(this.getRegU64(rs)); }

  execMULT(rt, rs) {
    const result = BigInt(this.getRegS32Lo(rs)) * BigInt(this.getRegS32Lo(rt));
    // TODO: verify if these results should be sign extended or not.
    // n64-systemtest doesn't seem to cover MULT.
    this.setMultLoS32Extend(result & u32MaxBigInt);
    this.setMultHiS32Extend(result >> 32n);
  }

  execDMULT(rt, rs) {
    const result = this.getRegS64(rs) * this.getRegS64(rt);
    this.setMultLoS64(result & u64Max);
    this.setMultHiS64(result >> 64n);
  }

  execMULTU(rt, rs) {
    const result = BigInt(this.getRegU32Lo(rs)) * BigInt(this.getRegU32Lo(rt));
    // TODO: verify if these results should be sign extended or not.
    // n64-systemtest doesn't seem to cover MULT.
    this.setMultLoS32Extend(result & u32MaxBigInt);
    this.setMultHiS32Extend(result >> 32n);
  }

  execDMULTU(rt, rs) {
    const result = this.getRegU64(rs) * this.getRegU64(rt);
    this.setMultLoU64(result & u64Max);
    this.setMultHiU64(result >> 64n);
  }

  execDIV(rt, rs) {
    const dividend = this.getRegS32Lo(rs);
    const divisor = this.getRegS32Lo(rt);

    let lo, hi;
    if (divisor) {
      lo = (dividend / divisor) >> 0;
      hi = dividend % divisor;
    } else {
      lo = dividend < 0 ? 1 : -1;
      hi = dividend;
    }
    // 32 bit result is sign extended to 64 bits.
    this.setMultLoS32Extend(BigInt(lo));
    this.setMultHiS32Extend(BigInt(hi));
  }

  execDDIV(rt, rs) {
    const divisor = this.getRegS64(rt);
    const dividend = this.getRegS64(rs);

    let lo, hi;
    if (divisor) {
      lo = dividend / divisor;
      hi = dividend % divisor;
    } else {
      lo = dividend < 0 ? 1n : -1n;
      hi = dividend;
    }
    this.setMultLoS64(lo);
    this.setMultHiS64(hi);
  }

  execDIVU(rt, rs) {
    const dividend = this.getRegU32Lo(rs);
    const divisor = this.getRegU32Lo(rt);

    let lo, hi;
    if (divisor) {
      lo = (dividend / divisor) >> 0;
      hi = dividend % divisor;
    } else {
      lo = -1;
      hi = dividend;
    }
    // 32 bit result is sign extended to 64 bits.
    this.setMultLoS32Extend(BigInt(lo));
    this.setMultHiS32Extend(BigInt(hi));
  }

  execDDIVU(rt, rs) {
    const divisor = this.getRegU64(rt);
    const dividend = this.getRegU64(rs);

    let lo, hi;
    if (divisor) {
      lo = dividend / divisor;
      hi = dividend % divisor;
    } else {
      lo = -1n;
      hi = dividend;
    }
    this.setMultLoU64(lo);
    this.setMultHiU64(hi);
  }

  execADD(rd, rt, rs) {
    const s = this.getRegS32Lo(rs);
    const t = this.getRegS32Lo(rt);
    const result = s + t;
    if (s32CheckAddOverflow(s, t, result)) {
      this.raiseOverflowException();
      return;
    }
    this.setRegS32Extend(rd, result);
  }

  execDADD(rd, rt, rs) {
    const s = this.getRegS64(rs);
    const t = this.getRegS64(rt);
    const result = s + t;
    if (s64CheckAddOverflow(s, t, result)) {
      this.raiseOverflowException();
      return;
    }
    this.setRegU64(rd, result);
  }
  
  execADDU(rd, rt, rs) {
    const s = this.getRegS32Lo(rs);
    const t = this.getRegS32Lo(rt);
    const result = s + t;
    this.setRegS32Extend(rd, result);
  }

  execDADDU(rd, rt, rs) {
    const s = this.getRegS64(rs);
    const t = this.getRegS64(rt);
    const result = s + t;
    this.setRegU64(rd, result);
  }
  
  execSUB(rd, rt, rs) {
    const s = this.getRegS32Lo(rs);
    const t = this.getRegS32Lo(rt);
    const result = s - t;
    if (s32CheckSubOverflow(s, t, result)) {
      this.raiseOverflowException();
      return;
    }
    this.setRegS32Extend(rd, result);
  }

  execDSUB(rd, rt, rs) {
    const s = this.getRegS64(rs);
    const t = this.getRegS64(rt);
    const result = s - t;
    if (s64CheckSubOverflow(s, t, result)) {
      this.raiseOverflowException();
      return;
    }
    this.setRegU64(rd, result);
  }
  
  execSUBU(rd, rt, rs) {
    const s = this.getRegS32Lo(rs);
    const t = this.getRegS32Lo(rt);
    const result = s - t;
    this.setRegS32Extend(rd, result);
  }

  execDSUBU(rd, rt, rs) {
    const s = this.getRegS64(rs);
    const t = this.getRegS64(rt);
    const result = s - t;
    this.setRegU64(rd, result);
  }

  execAND(rd, rt, rs) { this.setRegU64(rd, this.getRegU64(rs) & this.getRegU64(rt)); }
  execOR(rd, rt, rs) { this.setRegU64(rd, this.getRegU64(rs) | this.getRegU64(rt)); }
  execXOR(rd, rt, rs) { this.setRegU64(rd, this.getRegU64(rs) ^ this.getRegU64(rt)); }
  execNOR(rd, rt, rs) { this.setRegU64(rd, ~(this.getRegU64(rs) | this.getRegU64(rt))); }

  // Common OR variants.
  execCLEAR(rd) { this.setRegU64(rd, 0n); }
  execMOV(rd, rs) { this.setRegU64(rd, this.getRegU64(rs)); }

  execSLT(rd, rt, rs) {
    const r = this.getRegS64(rs) < this.getRegS64(rt) ? 1 : 0;
    this.setRegU32Extend(rd, r);
  }
  
  execSLTU(rd, rt, rs) {
    const r = this.getRegU64(rs) < this.getRegU64(rt) ? 1 : 0;
    this.setRegU32Extend(rd, r);
  }

  execADDI(rt, rs, imms) {
    const s = this.getRegS32Lo(rs);
    const result = s + imms;
    if (s32CheckAddOverflow(s, imms, result)) {
      this.raiseOverflowException();
      return;
    }
    this.setRegS32Extend(rt, result);
  }

  execDADDI(rt, rs, imms) {
    const s = this.getRegS64(rs);
    const imm = BigInt(imms);
    const result = s + imm;
    if (s64CheckAddOverflow(s, imm, result)) {
      this.raiseOverflowException();
      return;
    }
    this.setRegU64(rt, result);
  }

  execADDIU(rt, rs, imms) { this.setRegS32Extend(rt, this.getRegS32Lo(rs) + imms); }
  execDADDIU(rt, rs, imms) { this.setRegU64(rt, this.getRegS64(rs) + BigInt(imms)); }

  execSLTI(rt, rs, imms) { this.setRegU32Extend(rt, this.getRegS64(rs) < BigInt(imms) ? 1 : 0); }
  execSLTIU(rt, rs, imms) {
    // Immediate value is sign-extended to 64 bits and treated as a u64.
    const immediate = BigInt.asUintN(64, BigInt(imms));
    this.setRegU32Extend(rt, this.getRegU64(rs) < immediate ? 1 : 0);
  }

  execANDI(rt, rs, imm) { this.setRegU64(rt, this.getRegU64(rs) & BigInt(imm)); }
  execORI(rt, rs, imm) { this.setRegU64(rt, this.getRegU64(rs) | BigInt(imm)); }
  execXORI(rt, rs, imm) { this.setRegU64(rt, this.getRegU64(rs) ^ BigInt(imm)); }
  execLUI(rt, imm) { this.setRegS32Extend(rt, imm << 16); }

  // Helpers for load and store instructions.
  addrS32(base, imms) { return (this.getRegS32Lo(base) + imms) >> 0; }
  addrU32(base, imms) { return (this.getRegS32Lo(base) + imms) >>> 0; }

  execLB(rt, base, imms) {
    const value = memaccess.loadS8fast(this.addrS32(base, imms));
    this.setRegS32Extend(rt, value);
  }

  execLBU(rt, base, imms) {
    const value = memaccess.loadU8fast(this.addrS32(base, imms));
    this.setRegU32Extend(rt, value);
  }

  execLH(rt, base, imms) {
    const value = memaccess.loadS16fast(this.addrS32(base, imms));
    this.setRegS32Extend(rt, value);
  }

  execLHU(rt, base, imms) {
    const value = memaccess.loadU16fast(this.addrS32(base, imms));
    this.setRegU32Extend(rt, value);
  }

  execLW(rt, base, imms) {
    const value = memaccess.loadS32fast(this.addrS32(base, imms));

    // TODO: check if SF2049 requires LW to R0 to be ignored.
    // This is redundant right now because we also force R0 to zero in runImpl.
    if (rt == 0) {
      console.log("LW to register 0");
      return;
    }
    this.setRegS32Extend(rt, value);
  }

  execLWU(rt, base, imms) {
    const value = memaccess.loadU32fast(this.addrS32(base, imms));
    this.setRegU32Extend(rt, value);
  }

  execLD(rt, base, imms) {
    const value = memaccess.loadU64fast(this.addrS32(base, imms));
    this.setRegU64(rt, value);
  }

  execLWL(rt, base, imms) {
    const addr = this.addrU32(base, imms);
    const mem = memaccess.loadU32fast((addr & ~3) >>> 0);
    const shift = 8 * (addr & 3);

    this.setRegS32ExtendMasked(rt, mem << shift, u32Max << shift);
  }

  execLWR(rt, base, imms) {
    const addr = this.addrU32(base, imms);
    const mem = memaccess.loadU32fast((addr & ~3) >>> 0);
    const shift = 8 * (3 - (addr & 3));

    this.setRegS32ExtendMasked(rt, mem >>> shift, u32Max >>> shift);
  }

  execLDL(rt, base, imms) {
    const addr = this.addrU32(base, imms);
    const shift = BigInt(8 * (addr & 7));
    const mem = memaccess.loadU64fast((addr & ~7) >>> 0);

    this.setRegU64Masked(rt, (mem << shift) & u64Max, (u64Max << shift) & u64Max);
  }

  execLDR(rt, base, imms) {
    const addr = this.addrU32(base, imms);
    const shift = BigInt(8 * (7 - (addr & 7)));
    const mem = memaccess.loadU64fast((addr & ~7) >>> 0);

    this.setRegU64Masked(rt, mem >> shift, u64Max >> shift);
  }

  execLWC1(ft, base, imms) {
    if (!this.checkCopXUsable(1)) {
      return;
    }
    cpu1.store32(cpu1.copRegIdx32(ft), memaccess.loadS32fast(this.addrS32(base, imms)));
  }

  execLDC1(ft, base, imms) {
    if (!this.checkCopXUsable(1)) {
      return;
    }
    const value = memaccess.loadU64fast(this.addrS32(base, imms));
    cpu1.store64(cpu1.copRegIdx64(ft), value);
  }

  execSB(rt, base, imms) {
    memaccess.store8fast(this.addrS32(base, imms), this.getRegS32Lo(rt) /*& 0xff*/);
  }
  execSH(rt, base, imms) {
    memaccess.store16fast(this.addrS32(base, imms), this.getRegS32Lo(rt) /*& 0xffff*/);
  }
  execSW(rt, base, imms) {
    memaccess.store32fast(this.addrS32(base, imms), this.getRegS32Lo(rt));
  }
  execSD(rt, base, imms) {
    memaccess.store64fast(this.addrS32(base, imms), this.getRegU64(rt));
  }

  execSWL(rt, base, imms) {
    const addr = this.addrU32(base, imms);
    const shift = 8 * (addr & 3);
    const reg = this.getRegU32Lo(rt);

    memaccess.store32masked(addr, reg >>> shift, u32Max >>> shift);
  }

  execSWR(rt, base, imms) {
    const addr = this.addrU32(base, imms);
    const shift = 8 * (3 - (addr & 3));
    const reg = this.getRegU32Lo(rt);

    memaccess.store32masked(addr, reg << shift, u32Max << shift);
  }

  execSDL(rt, base, imms) {
    const addr = this.addrU32(base, imms);
    const shift = BigInt(8 * (addr & 7));
    const reg = this.getRegU64(rt);

    memaccess.store64masked(addr, reg >> shift, u64Max >> shift);
  }

  execSDR(rt, base, imms) {
    const addr = this.addrU32(base, imms);
    const reg = this.getRegU64(rt);
    const shift = BigInt(8 * (7 - (addr & 7)));

    memaccess.store64masked(addr, (reg << shift) & u64Max, (u64Max << shift) & u64Max);
  }

  execSWC1(ft, base, imms) {
    if (!this.checkCopXUsable(1)) {
      return;
    }
    memaccess.store32fast(this.addrS32(base, imms), cpu1.loadU32(cpu1.copRegIdx32(ft)));
  }
  execSDC1(ft, base, imms) {
    if (!this.checkCopXUsable(1)) {
      return;
    }
    memaccess.store64fast(this.addrS32(base, imms), cpu1.loadU64(cpu1.copRegIdx64(ft)));
  }

  execLL(rt, base, imms) {
    const addr = this.addrS32(base, imms);
    this.setControlU32(cpu0_constants.controlLLAddr, makeLLAddr(addr));
    this.setRegS32Extend(rt, memaccess.loadS32fast(addr));
    this.llBit = 1;
  }

  execLLD(rt, base, imms) {
    const addr = this.addrS32(base, imms);
    this.setControlU32(cpu0_constants.controlLLAddr, makeLLAddr(addr));
    this.setRegU64(rt, memaccess.loadU64fast(addr));
    this.llBit = 1;
  }

  execSC(rt, base, imms) {
    let result = 0;
    if (this.llBit) {
      memaccess.store32fast(this.addrS32(base, imms), this.getRegS32Lo(rt));
      this.llBit = 0;
      result = 1;
    }
    this.setRegU32Extend(rt, result);
  }

  execSCD(rt, base, imms) {
    let result = 0;
    if (this.llBit) {
      memaccess.store64fast(this.addrS32(base, imms), this.getRegU64(rt));
      this.llBit = 0;
      result = 1;
    }
    this.setRegU32Extend(rt, result);
  }

  execCACHE(rt, base, imms) {
    if (!this.ignoreCacheOp(rt)) {
      // NB: only bother generating address if we handle the instruction - memaddr deopts like crazy
      n64js.invalidateICacheEntry(this.addrU32(base, imms));
    }
  }

  ignoreCacheOp(cacheOp) {
    const cache = cacheOp & 0x3;
    const action = (cacheOp >>> 2) & 0x7;
    return cache !== 0 || (action !== 0 && action !== 4);
  }

  execMFC0(rt, fs) {
    this.setRegS32Extend(rt, Number(this.moveFromControl(fs) & 0xffff_ffffn));
  }

  execDMFC0(rt, fs) {
    this.setRegU64(rt, this.moveFromControl(fs));
  }

  execMTC0(rt, fs) {
    this.moveToControl(fs, BigInt(this.getRegS32Lo(rt)));
  }

  execDMTC0(rt, fs) {
    this.moveToControl(fs, this.getRegU64(rt));
  }

  execTLB(op) {
    switch (op) {
      case 0x01: this.tlbRead(); return;
      case 0x02: this.tlbWriteIndex(); return;
      case 0x06: this.tlbWriteRandom(); return;
      case 0x08: this.tlbProbe(); return;
      case 0x18: this.execERET(); return;
    }
    n64js.warn(`CPU: unknown TLB op, pc: ${toString32(this.pc)}, op: ${toString32(op)}`);
  }

  execERET() {
    if (this.getControlU32(cpu0_constants.controlStatus) & SR_ERL) {
      this.nextPC = this.getControlU32(cpu0_constants.controlErrorEPC);
      this.clearControlBits32(cpu0_constants.controlStatus, ~SR_ERL);
      logger.log('ERET from error trap - ' + this.nextPC);
    } else {
      this.nextPC = this.getControlU32(cpu0_constants.controlEPC);
      this.clearControlBits32(cpu0_constants.controlStatus, SR_EXL);
      //logger.log('ERET from interrupt/exception ' + this.nextPC);
    }
    this.llBit = 0;
  }

  execTGE(rt, rs) { this.maybeRaiseTRAPException(this.getRegS64(rs) >= this.getRegS64(rt)); }
  execTGEU(rt, rs) { this.maybeRaiseTRAPException(this.getRegU64(rs) >= this.getRegU64(rt)); }
  execTLT(rt, rs) { this.maybeRaiseTRAPException(this.getRegS64(rs) < this.getRegS64(rt)); }
  execTLTU(rt, rs) { this.maybeRaiseTRAPException(this.getRegU64(rs) < this.getRegU64(rt)); }
  execTEQ(rt, rs) { this.maybeRaiseTRAPException(this.getRegS64(rs) == this.getRegS64(rt)); }
  execTNE(rt, rs) { this.maybeRaiseTRAPException(this.getRegS64(rs) != this.getRegS64(rt)); }

  execTGEI(rs, imms) { this.maybeRaiseTRAPException(this.getRegS64(rs) >= BigInt(imms)); }
  execTGEIU(rs, imms) { this.maybeRaiseTRAPException(this.getRegU64(rs) >= BigInt.asUintN(64, BigInt(imms))); }
  execTLTI(rs, imms) { this.maybeRaiseTRAPException(this.getRegS64(rs) < BigInt(imms)); }
  execTLTIU(rs, imms) { this.maybeRaiseTRAPException(this.getRegU64(rs) < BigInt.asUintN(64, BigInt(imms))); }
  execTEQI(rs, imms) { this.maybeRaiseTRAPException(this.getRegS64(rs) == BigInt(imms)); }
  execTNEI(rs, imms) { this.maybeRaiseTRAPException(this.getRegS64(rs) != BigInt(imms)); }

  execJ(address) { this.jump(address); }
  execJR(rs) { this.jump(this.getRegU32Lo(rs)); }
  execJAL(address) {
    this.setRegS32Extend(cpu0_constants.RA, this.nextPC + 4);
    this.jump(address);
  }
  execJALR(rd, rs) {
    const newPC = this.getRegU32Lo(rs);
    this.setRegS32Extend(rd, this.nextPC + 4);
    this.jump(newPC);
  }

  execBEQ(rt, rs, offset) {
    const cond = this.getRegU64(rs) === this.getRegU64(rt);
    this.conditionalBranch(cond, offset);

    if (cond && offset === -1) {
      this.speedHack();
    }
  }

  execBNE(rt, rs, offset) { this.conditionalBranch(this.getRegU64(rs) !== this.getRegU64(rt), offset); }
  execBEQL(rt, rs, offset) { this.conditionalBranchLikely(this.getRegU64(rs) === this.getRegU64(rt), offset); }
  execBNEL(rt, rs, offset) { this.conditionalBranchLikely(this.getRegU64(rs) !== this.getRegU64(rt), offset); }

  execBGEZ(rs, offset) { this.conditionalBranch(this.getRegS64(rs) >= 0n, offset); }
  execBGTZ(rs, offset) { this.conditionalBranch(this.getRegS64(rs) > 0n, offset); }
  execBLEZ(rs, offset) { this.conditionalBranch(this.getRegS64(rs) <= 0n, offset); }
  execBLTZ(rs, offset) { this.conditionalBranch(this.getRegS64(rs) < 0n, offset); }

  execBGEZL(rs, offset) { this.conditionalBranchLikely(this.getRegS64(rs) >= 0n, offset); }
  execBGTZL(rs, offset) { this.conditionalBranchLikely(this.getRegS64(rs) > 0n, offset); }
  execBLEZL(rs, offset) { this.conditionalBranchLikely(this.getRegS64(rs) <= 0n, offset); }
  execBLTZL(rs, offset) { this.conditionalBranchLikely(this.getRegS64(rs) < 0n, offset); }

  execBLTZAL(rs, offset) {
    const cond = this.getRegS64(rs) < 0n;
    this.setRegS32Extend(cpu0_constants.RA, this.nextPC + 4);
    this.conditionalBranch(cond, offset);
  }

  execBGEZAL(rs, offset) {
    const cond = this.getRegS64(rs) >= 0n;
    this.setRegS32Extend(cpu0_constants.RA, this.nextPC + 4);
    this.conditionalBranch(cond, offset);
  }

  execBLTZALL(rs, offset) {
    const cond = this.getRegS64(rs) < 0n;
    this.setRegS32Extend(cpu0_constants.RA, this.nextPC + 4);
    this.conditionalBranchLikely(cond, offset);
  }

  execBGEZALL(rs, offset) {
    const cond = this.getRegS64(rs) >= 0n;
    this.setRegS32Extend(cpu0_constants.RA, this.nextPC + 4);
    this.conditionalBranchLikely(cond, offset);
  }
}


class CPU2 {
  constructor() {
    // Provide state for a single 64 bit register.
    const buf = new ArrayBuffer(8);
    this.regU32 = new Uint32Array(buf);
    this.regU64 = new BigUint64Array(buf);
  }

  /**
   * Set the lower 32 bits of the register value, and sign extend.
   * @param {Number} value
   */
  setReg32(val) {
    this.regU32[0] = val;
    this.regU32[1] = val >> 31;
  }

  /**
   * Set the full 64 bits of the register value.
   * @param {BigInt} value
   */
  setReg64(val) {
    this.regU64[0] = val;
  }

  /**
   * Return the lower 32 bits of the register value.
   * @returns {Number}
   */
  getReg32() {
    return this.regU32[0];
  }

  /**
   * Return the full 64 bits of the register value.
   * @returns {BigInt}
   */
  getReg64() {
    return this.regU64[0];
  }
}

class SystemEvent {
  constructor(type, countdown) {
    this.type = type;
    this.countdown = countdown;
  }

  getName() {
    switch (this.type) {
      case kEventVbl: return 'Vbl';
      case kEventCompare: return 'Compare';
      case kEventRunForCycles: return 'Run';
    }

    return '?';
  }
}

// EmulatedException interrupts processing of an instruction
// and prevents state (such as memory or registers) being updated.
class EmulatedException { }

// Expose the cpu state
const cpu0 = new CPU0();
const cpu1 = new CPU1(cpu0);
const cpu2 = new CPU2();
n64js.cpu0 = cpu0;
n64js.cpu1 = cpu1;
n64js.cpu2 = cpu2;


function fd(i) { return (i >>> 6) & 0x1f; }
function fs(i) { return (i >>> 11) & 0x1f; }
function ft(i) { return (i >>> 16) & 0x1f; }
function copop(i) { return (i >>> 21) & 0x1f; }

function offset(i) { return ((i & 0xffff) << 16) >> 16; }
function sa(i) { return (i >>> 6) & 0x1f; }
function rd(i) { return (i >>> 11) & 0x1f; }
function rt(i) { return (i >>> 16) & 0x1f; }
function rs(i) { return (i >>> 21) & 0x1f; }
function op(i) { return (i >>> 26) & 0x1f; }

function tlbop(i) { return i & 0x3f; }
function cop1_func(i) { return i & 0x3f; }
function cop1_bc(i) { return (i >>> 16) & 0x3; }

function target(i) { return (i) & 0x3ffffff; }
function imm(i) { return (i) & 0xffff; }
function imms(i) { return ((i & 0xffff) << 16) >> 16; }   // treat immediate value as signed
function base(i) { return (i >>> 21) & 0x1f; }

function branchAddress(pc, i) { return ((pc + 4) + (offset(i) * 4)) >>> 0; }
//function branchAddress(pc,i) { return (((pc>>>2)+1) + offset(i))<<2; }  // NB: convoluted calculation to avoid >>>0 (deopt)
function jumpAddress(pc, i) { return ((pc & 0xf0000000) | (target(i) * 4)) >>> 0; }

function genSrcRegS32Lo(i) {
  if (i === 0)
    return '0';
  return `c.getRegS32Lo(${i})`;
}

function genSrcRegU32Lo(i) {
  if (i === 0)
    return '0';
  return `c.getRegU32Lo(${i})`;
}

function genSrcRegS64(i) {
  if (i === 0)
    return '0n';
  return `c.getRegS64(${i})`;
}

function genSrcRegU64(i) {
  if (i === 0)
    return '0n';
  return `c.getRegU64(${i})`;
}

function unimplemented(pc, i) {
  const r = disassembleInstruction(pc, i);
  const e = `Unimplemented op ${toString32(i)} : ${r.disassembly}`;
  logger.log(e);
  throw e;
}

function executeUnknown(i) {
  throw `CPU: unknown op, pc: ${toString32(cpu0.pc)}, instruction: ${toString32(i)}`;
}

function executeRESERVED(i) {
  cpu0.raiseRESERVEDException(0);
}

/**
 * @constructor
 */
function BreakpointException() {
}

function executeBreakpoint(i) {
  // NB: throw here so that we don't execute the op.
  throw new BreakpointException();
}

function executeADDI(i) { cpu0.execADDI(rt(i), rs(i), imms(i)); }
function executeADDIU(i) { cpu0.execADDIU(rt(i), rs(i), imms(i)); }
function executeDADDI(i) { cpu0.execDADDI(rt(i), rs(i), imms(i)); }
function executeDADDIU(i) { cpu0.execDADDIU(rt(i), rs(i), imms(i)); }

function executeSLTI(i) { cpu0.execSLTI(rt(i), rs(i), imms(i)); }
function executeSLTIU(i) { cpu0.execSLTIU(rt(i), rs(i), imms(i)); }
function executeANDI(i) { cpu0.execANDI(rt(i), rs(i), imm(i)); }
function executeORI(i) { cpu0.execORI(rt(i), rs(i), imm(i)); }
function executeXORI(i) { cpu0.execXORI(rt(i), rs(i), imm(i)); }
function executeLUI(i) { cpu0.execLUI(rt(i), imm(i)); }

function executeLB(i) { cpu0.execLB(rt(i), base(i), imms(i)); }
function executeLBU(i) { cpu0.execLBU(rt(i), base(i), imms(i)); }
function executeLH(i) { cpu0.execLH(rt(i), base(i), imms(i)); }
function executeLHU(i) { cpu0.execLHU(rt(i), base(i), imms(i)); }
function executeLW(i) { cpu0.execLW(rt(i), base(i), imms(i)); }
function executeLWU(i) { cpu0.execLWU(rt(i), base(i), imms(i)); }
function executeLD(i) { cpu0.execLD(rt(i), base(i), imms(i)); }
function executeLWL(i) { cpu0.execLWL(rt(i), base(i), imms(i)); }
function executeLWR(i) { cpu0.execLWR(rt(i), base(i), imms(i)); }
function executeLDL(i) { cpu0.execLDL(rt(i), base(i), imms(i)); }
function executeLDR(i) { cpu0.execLDR(rt(i), base(i), imms(i)); }

function executeLWC1(i) { cpu0.execLWC1(ft(i), base(i), imms(i)); }
function executeLDC1(i) { cpu0.execLDC1(ft(i), base(i), imms(i)); }
function executeLDC2(i) { unimplemented(cpu0.pc, i); }

function executeSB(i) { cpu0.execSB(rt(i), base(i), imms(i)); }
function executeSH(i) { cpu0.execSH(rt(i), base(i), imms(i)); }
function executeSW(i) { cpu0.execSW(rt(i), base(i), imms(i)); }
function executeSD(i) { cpu0.execSD(rt(i), base(i), imms(i)); }
function executeSWL(i) { cpu0.execSWL(rt(i), base(i), imms(i)); }
function executeSWR(i) { cpu0.execSWR(rt(i), base(i), imms(i)); }
function executeSDL(i) { cpu0.execSDL(rt(i), base(i), imms(i)); }
function executeSDR(i) { cpu0.execSDR(rt(i), base(i), imms(i)); }

function executeSWC1(i) { cpu0.execSWC1(ft(i), base(i), imms(i)); }
function executeSDC1(i) { cpu0.execSDC1(ft(i), base(i), imms(i)); }
function executeSDC2(i) { unimplemented(cpu0.pc, i); }

function executeLL(i) { cpu0.execLL(rt(i), base(i), imms(i)); }
function executeLLD(i) { cpu0.execLLD(rt(i), base(i), imms(i)); }
function executeSC(i) { cpu0.execSC(rt(i), base(i), imms(i)); }
function executeSCD(i) { cpu0.execSCD(rt(i), base(i), imms(i)); }

function executeCACHE(i) { cpu0.execCACHE(rt(i), base(i), imms(i)); }

function executeMFC0(i) { cpu0.execMFC0(rt(i), fs(i)); }
function executeDMFC0(i) { cpu0.execDMFC0(rt(i), fs(i)); }
function executeMTC0(i) { cpu0.execMTC0(rt(i), fs(i)); }
function executeDMTC0(i) { cpu0.execDMTC0(rt(i), fs(i)); }

function executeTLB(i) { cpu0.execTLB(tlbop(i)); }

function executeTGEI(i) { cpu0.execTGEI(rs(i), imms(i)); }
function executeTGEIU(i) { cpu0.execTGEIU(rs(i), imms(i)); }
function executeTLTI(i) { cpu0.execTLTI(rs(i), imms(i)); }
function executeTLTIU(i) { cpu0.execTLTIU(rs(i), imms(i)); }
function executeTEQI(i) { cpu0.execTEQI(rs(i), imms(i)); }
function executeTNEI(i) { cpu0.execTNEI(rs(i), imms(i)); }

function executeJ(i) { cpu0.execJ(jumpAddress(cpu0.pc, i)); }
function executeJAL(i) { cpu0.execJAL(jumpAddress(cpu0.pc, i)); }

function executeBEQ(i) { cpu0.execBEQ(rt(i), rs(i), offset(i)); }
function executeBEQL(i) { cpu0.execBEQL(rt(i), rs(i), offset(i)); }
function executeBNE(i) { cpu0.execBNE(rt(i), rs(i), offset(i)); }
function executeBNEL(i) { cpu0.execBNEL(rt(i), rs(i), offset(i)); }

function executeBLEZ(i) { cpu0.execBLEZ(rs(i), offset(i)); }
function executeBLEZL(i) { cpu0.execBLEZL(rs(i), offset(i)); }
function executeBGTZ(i) { cpu0.execBGTZ(rs(i), offset(i)); }
function executeBGTZL(i) { cpu0.execBGTZL(rs(i), offset(i)); }
function executeBLTZ(i) { cpu0.execBLTZ(rs(i), offset(i)); }
function executeBLTZL(i) { cpu0.execBLTZL(rs(i), offset(i)); }
function executeBLTZAL(i) { cpu0.execBLTZAL(rs(i), offset(i)); }
function executeBLTZALL(i) { cpu0.execBLTZALL(rs(i), offset(i)); }
function executeBGEZ(i) { cpu0.execBGEZ(rs(i), offset(i)); }
function executeBGEZL(i) { cpu0.execBGEZL(rs(i), offset(i)); }
function executeBGEZAL(i) { cpu0.execBGEZAL(rs(i), offset(i)); }
function executeBGEZALL(i) { cpu0.execBGEZALL(rs(i), offset(i)); }

function generateSLL(ctx) {
  // NOP
  if (ctx.instruction === 0) {
    return generateNOPBoilerplate('NOP', ctx);
  }
  const impl = `c.execSLL(${ctx.instr_rd()}, ${ctx.instr_rt()}, ${ctx.instr_sa()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateSRL(ctx) {
  const impl = `c.execSRL(${ctx.instr_rd()}, ${ctx.instr_rt()}, ${ctx.instr_sa()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateSRA(ctx) {
  const impl = `c.execSRA(${ctx.instr_rd()}, ${ctx.instr_rt()}, ${ctx.instr_sa()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateSLLV(ctx) {
  const impl = `c.execSLLV(${ctx.instr_rd()}, ${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateSRLV(ctx) {
  const impl = `c.execSRLV(${ctx.instr_rd()}, ${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateSRAV(ctx) {
  const impl = `c.execSRAV(${ctx.instr_rd()}, ${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateDSLLV(ctx) {
  const impl = `c.execDSLLV(${ctx.instr_rd()}, ${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateDSRLV(ctx) {
  const impl = `c.execDSRLV(${ctx.instr_rd()}, ${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateDSRAV(ctx) {
  const impl = `c.execDSRAV(${ctx.instr_rd()}, ${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateDSLL(ctx) {
  const impl = `c.execDSLL(${ctx.instr_rd()}, ${ctx.instr_rt()}, ${ctx.instr_sa()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateDSLL32(ctx) {
  const impl = `c.execDSLL32(${ctx.instr_rd()}, ${ctx.instr_rt()}, ${ctx.instr_sa()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateDSRL(ctx) {
  const impl = `c.execDSRL(${ctx.instr_rd()}, ${ctx.instr_rt()}, ${ctx.instr_sa()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateDSRL32(ctx) {
  const impl = `c.execDSRL32(${ctx.instr_rd()}, ${ctx.instr_rt()}, ${ctx.instr_sa()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateDSRA(ctx) {
  const impl = `c.execDSRA(${ctx.instr_rd()}, ${ctx.instr_rt()}, ${ctx.instr_sa()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateDSRA32(ctx) {
  const impl = `c.execDSRA32(${ctx.instr_rd()}, ${ctx.instr_rt()}, ${ctx.instr_sa()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateSYSCALL(ctx) {
  const impl = `c.execSYSCALL();`;
  return generateGenericOpBoilerplate(impl, ctx); // Generic as raises SYSCALL exception.
}

function generateBREAK(ctx) {
  const impl = `c.execBREAK();`;
  return generateGenericOpBoilerplate(impl, ctx); // Generic as raises BREAK exception.
}

function generateSYNC(ctx) {
  const impl = `c.execSYNC();`;
  return generateGenericOpBoilerplate(impl, ctx); // Generic as raises SYNC exception.
}

function generateTGE(ctx) {
  const impl = `c.execTGE(${ctx.instr_rt()}, ${ctx.instr_sa()});`;
  return generateGenericOpBoilerplate(impl, ctx); // Generic as may raise TRAP exception.
}

function generateTGEU(ctx) {
  const impl = `c.execTGEU(${ctx.instr_rt()}, ${ctx.instr_sa()});`;
  return generateGenericOpBoilerplate(impl, ctx); // Generic as may raise TRAP exception.
}

function generateTLT(ctx) {
  const impl = `c.execTLT(${ctx.instr_rt()}, ${ctx.instr_sa()});`;
  return generateGenericOpBoilerplate(impl, ctx); // Generic as may raise TRAP exception.
}

function generateTLTU(ctx) {
  const impl = `c.execTLTU(${ctx.instr_rt()}, ${ctx.instr_sa()});`;
  return generateGenericOpBoilerplate(impl, ctx); // Generic as may raise TRAP exception.
}

function generateTEQ(ctx) {
  const impl = `c.execTEQ(${ctx.instr_rt()}, ${ctx.instr_sa()});`;
  return generateGenericOpBoilerplate(impl, ctx); // Generic as may raise TRAP exception.
}

function generateTNE(ctx) {
  const impl = `c.execTNE(${ctx.instr_rt()}, ${ctx.instr_sa()});`;
  return generateGenericOpBoilerplate(impl, ctx); // Generic as may raise TRAP exception.
}

function generateMFHI(ctx) {
  const impl = `c.execMFHI(${ctx.instr_rd()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateMFLO(ctx) {
  const impl = `c.execMFLO(${ctx.instr_rd()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateMTHI(ctx) {
  const impl = `c.execMTHI(${ctx.instr_rs()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateMTLO(ctx) {
  const impl = `c.execMTLO(${ctx.instr_rs()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateMULT(ctx) {
  const impl = `c.execMULT(${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateMULTU(ctx) {
  const impl = `c.execMULTU(${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateDMULT(ctx) {
  const impl = `c.execDMULT(${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateDMULTU(ctx) {
  const impl = `c.execDMULTU(${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateDIV(ctx) {
  const impl = `c.execDIV(${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateDIVU(ctx) {
  const impl = `c.execDIVU(${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateDDIV(ctx) {
  const impl = `c.execDDIV(${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateDDIVU(ctx) {
  const impl = `c.execDDIVU(${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateADD(ctx) {
  const impl = `c.execADD(${ctx.instr_rd()}, ${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  // Use the generic boilerplate because we might have generated an overflow exception.
  return generateGenericOpBoilerplate(impl, ctx);
}

function generateDADD(ctx) {
  const impl = `c.execDADD(${ctx.instr_rd()}, ${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  // Use the generic boilerplate because we might have generated an overflow exception.
  return generateGenericOpBoilerplate(impl, ctx);
}

function generateADDU(ctx) {
  const impl = `c.execADDU(${ctx.instr_rd()}, ${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateDADDU(ctx) {
  const impl = `c.execDADDU(${ctx.instr_rd()}, ${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateSUB(ctx) {
  const impl = `c.execSUB(${ctx.instr_rd()}, ${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  // Use the generic boilerplate because we might have generated an overflow exception.
  return generateGenericOpBoilerplate(impl, ctx);
}

function generateDSUB(ctx) {
  const impl = `c.execDSUB(${ctx.instr_rd()}, ${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  // Use the generic boilerplate because we might have generated an overflow exception.
  return generateGenericOpBoilerplate(impl, ctx);
}

function generateSUBU(ctx) {
  const impl = `c.execSUBU(${ctx.instr_rd()}, ${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateDSUBU(ctx) {
  const impl = `c.execDSUBU(${ctx.instr_rd()}, ${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateAND(ctx) {
  const impl = `c.execAND(${ctx.instr_rd()}, ${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateOR(ctx) {
  let impl;
  if (ctx.instr_rt() === 0) {
    if (ctx.instr_rs() === 0) {
      impl = `c.execCLEAR(${ctx.instr_rd()});`;
    } else {
      impl = `c.execMOV(${ctx.instr_rd()}, ${ctx.instr_rs()});`;
    }
  } else {
    impl = `c.execOR(${ctx.instr_rd()}, ${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  }
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateXOR(ctx) {
  const impl = `c.execXOR(${ctx.instr_rd()}, ${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateNOR(ctx) {
  const impl = `c.execNOR(${ctx.instr_rd()}, ${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateSLT(ctx) {
  const impl = `c.execSLT(${ctx.instr_rd()}, ${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateSLTU(ctx) {
  const impl = `c.execSLTU(${ctx.instr_rd()}, ${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateADDI(ctx) {
  const impl = `c.execADDI(${ctx.instr_rt()}, ${ctx.instr_rs()}, ${ctx.instr_imms()});`;
  return generateGenericOpBoilerplate(impl, ctx); // May raise Overflow exception.
}

function generateDADDI(ctx) {
  const impl = `c.execDADDI(${ctx.instr_rt()}, ${ctx.instr_rs()}, ${ctx.instr_imms()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateADDIU(ctx) {
  const impl = `c.execADDI(${ctx.instr_rt()}, ${ctx.instr_rs()}, ${ctx.instr_imms()});`;
  return generateGenericOpBoilerplate(impl, ctx); // May raise Overflow exception.
}

function generateDADDIU(ctx) {
  const impl = `c.execDADDI(${ctx.instr_rt()}, ${ctx.instr_rs()}, ${ctx.instr_imms()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateMTC0(ctx) {
  if (ctx.instr_fs() === cpu0_constants.controlStatus) {
    ctx.fragment.cop1statusKnown = false;
  }
  const impl = `c.execMTC0(${ctx.instr_rt()}, ${ctx.instr_fs()});`;
  return generateGenericOpBoilerplate(impl, ctx);
}

// Jump
function generateJ(ctx) {
  // TODO: can this call execJ? It would need reworking to use branchTarget.
  const addr = jumpAddress(ctx.pc, ctx.instruction);
  const impl = 'c.delayPC = ' + toString32(addr) + ';';
  return generateBranchOpBoilerplate(impl, ctx, false);
}

function generateJAL(ctx) {
  // TODO: can this call execJAL? It would need reworking to use branchTarget.
  const addr = jumpAddress(ctx.pc, ctx.instruction);
  const ra = ctx.nextPC + 4;
  // Optimise as sign is known at compile time.
  const ra_hi = (ra & 0x80000000) ? -1 : 0;
  const impl = dedent(`
    c.delayPC = ${toString32(addr)};
    c.setRegS64LoHi(${cpu0_constants.RA}, ${toString32(ra)}, ${ra_hi});
    `);
  return generateBranchOpBoilerplate(impl, ctx, false);
}

function generateJALR(ctx) {
  // TODO: can this call execJALR? It would need reworking to use branchTarget.
  const s = ctx.instr_rs();
  const d = ctx.instr_rd();

  const ra = ctx.nextPC + 4;
  const ra_hi = (ra & 0x80000000) ? -1 : 0;
  // NB needs to be unsigned
  const impl = dedent(`
    c.delayPC = ${genSrcRegU32Lo(s)};
    c.setRegS64LoHi(${d}, ${toString32(ra)}, ${ra_hi});
    `);
  return generateBranchOpBoilerplate(impl, ctx, false);
}

function generateJR(ctx) {
  // TODO: can this call execJR? It would need reworking to use branchTarget.
  // NB needs to be unsigned
  const impl = `c.delayPC = ${genSrcRegU32Lo(ctx.instr_rs())};`;
  return generateBranchOpBoilerplate(impl, ctx, false);
}

function generateBEQ(ctx) {
  const s = ctx.instr_rs();
  const t = ctx.instr_rt();
  const off = ctx.instr_offset();
  const addr = branchAddress(ctx.pc, ctx.instruction);

  let impl = '';

  if (s === t) {
    if (off === -1) {
      impl += 'c.speedHack();\n';
      ctx.bailOut = true;
    }
    impl += `c.delayPC = ${toString32(addr)};\n`;
  } else {
    impl += `if (${genSrcRegU64(s)} === ${genSrcRegU64(t)}) {\n`;
    if (off === -1) {
      impl += '  c.speedHack();\n';
      ctx.bailOut = true;
    }
    impl += `  c.delayPC = ${toString32(addr)};\n`;
    impl += '} else {\n';
    impl += `  c.delayPC = ${toString32(ctx.pc + 8)};\n`;
    impl += '}\n';
  }

  return generateBranchOpBoilerplate(impl, ctx, false);
}

function generateBEQL(ctx) {
  const s = ctx.instr_rs();
  const t = ctx.instr_rt();
  const addr = branchAddress(ctx.pc, ctx.instruction);

  const impl = dedent(`
    if (${genSrcRegU64(s)} === ${genSrcRegU64(t)}) {
      c.delayPC = ${toString32(addr)};
    } else {
      c.nextPC += 4;
    }`);

  return generateBranchOpBoilerplate(impl, ctx, true /* might_adjust_next_pc*/);
}

function generateBNE(ctx) {
  const s = ctx.instr_rs();
  const t = ctx.instr_rt();
  const off = ctx.instr_offset();
  const addr = branchAddress(ctx.pc, ctx.instruction);

  let impl = '';
  impl += `if (${genSrcRegU64(s)} !== ${genSrcRegU64(t)}) {\n`;
  if (off === -1) {
    impl += '  c.speedHack();\n';
    ctx.bailOut = true;
  }
  impl += `  c.delayPC = ${toString32(addr)};\n`;
  impl += '} else {\n';
  impl += `  c.delayPC = ${toString32(ctx.pc + 8)};\n`;
  impl += '}\n';

  return generateBranchOpBoilerplate(impl, ctx, false);
}

function generateBNEL(ctx) {
  const s = ctx.instr_rs();
  const t = ctx.instr_rt();
  const addr = branchAddress(ctx.pc, ctx.instruction);

  const impl = dedent(`
    if (${genSrcRegU64(s)} !== ${genSrcRegU64(t)}) {
      c.delayPC = ${toString32(addr)};
    } else {
      c.nextPC += 4;
    }
    `);

  return generateBranchOpBoilerplate(impl, ctx, true /* might_adjust_next_pc*/);
}

// Branch Less Than or Equal To Zero
function generateBLEZ(ctx) {
  const s = ctx.instr_rs();
  const addr = branchAddress(ctx.pc, ctx.instruction);

  const impl = dedent(`
    if ( ${genSrcRegS64(s)} <= 0n) {
      c.delayPC = ${toString32(addr)};
    } else {
      c.delayPC = ${toString32(ctx.pc + 8)};
    }`);

  return generateBranchOpBoilerplate(impl, ctx, false);
}

// Branch Greater Than Zero
function generateBGTZ(ctx) {
  const s = ctx.instr_rs();
  const addr = branchAddress(ctx.pc, ctx.instruction);

  const impl = dedent(`
    if (${genSrcRegS64(s)} > 0) {
      c.delayPC = ${toString32(addr)};
    } else {
      c.delayPC = ${toString32(ctx.pc + 8)};
    }`);

  return generateBranchOpBoilerplate(impl, ctx, false);
}

// Branch Less Than Zero
function generateBLTZ(ctx) {
  const s = ctx.instr_rs();
  const addr = branchAddress(ctx.pc, ctx.instruction);

  const impl = dedent(`
    if (${genSrcRegS64(s)} < 0n) {
      c.delayPC = ${toString32(addr)};
    } else {
      c.delayPC = ${toString32(ctx.pc + 8)};
    }`);

  return generateBranchOpBoilerplate(impl, ctx, false);
}

function generateBLTZL(ctx) {
  const s = ctx.instr_rs();
  const addr = branchAddress(ctx.pc, ctx.instruction);

  const impl = dedent(`
    if (${genSrcRegS64(s)} < 0n) {
      c.delayPC = ${toString32(addr)};
    } else {
      c.nextPC += 4;
    }`);

  return generateBranchOpBoilerplate(impl, ctx, true /* might_adjust_next_pc*/);
}


// Branch Greater Than Zero
function generateBGEZ(ctx) {
  const s = ctx.instr_rs();
  const addr = branchAddress(ctx.pc, ctx.instruction);

  const impl = dedent(`
    if (${genSrcRegS64(s)} >= 0n) {
      c.delayPC = ${toString32(addr)};
    } else {
      c.delayPC = ${toString32(ctx.pc + 8)};
    }`);

  return generateBranchOpBoilerplate(impl, ctx, false);
}

function generateBGEZL(ctx) {
  const s = ctx.instr_rs();
  const addr = branchAddress(ctx.pc, ctx.instruction);

  const impl = dedent(`
    if (${genSrcRegS64(s)} >= 0n) {
      c.delayPC = ${toString32(addr)};
    } else {
      c.nextPC += 4;
    }`);

  return generateBranchOpBoilerplate(impl, ctx, true /* might_adjust_next_pc*/);
}

function generateSLTI(ctx) {
  const impl = `c.execSLTI(${ctx.instr_rt()}, ${ctx.instr_rs()}, ${ctx.instr_imms()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateSLTIU(ctx) {
  const impl = `c.execSLTIU(${ctx.instr_rt()}, ${ctx.instr_rs()}, ${ctx.instr_imms()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateANDI(ctx) {
  const impl = `c.execANDI(${ctx.instr_rt()}, ${ctx.instr_rs()}, ${ctx.instr_imm()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateORI(ctx) {
  const impl = `c.execORI(${ctx.instr_rt()}, ${ctx.instr_rs()}, ${ctx.instr_imm()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateXORI(ctx) {
  const impl = `c.execXORI(${ctx.instr_rt()}, ${ctx.instr_rs()}, ${ctx.instr_imm()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateLUI(ctx) {
  const impl = `c.execLUI(${ctx.instr_rt()}, ${ctx.instr_imm()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateLB(ctx) {
  const impl = `c.execLB(${ctx.instr_rt()}, ${ctx.instr_base()}, ${ctx.instr_imms()});`;
  return generateMemoryAccessBoilerplate(impl, ctx);
}

function generateLBU(ctx) {
  const impl = `c.execLBU(${ctx.instr_rt()}, ${ctx.instr_base()}, ${ctx.instr_imms()});`;
  return generateMemoryAccessBoilerplate(impl, ctx);
}

function generateLH(ctx) {
  const impl = `c.execLH(${ctx.instr_rt()}, ${ctx.instr_base()}, ${ctx.instr_imms()});`;
  return generateMemoryAccessBoilerplate(impl, ctx);
}

function generateLHU(ctx) {
  const impl = `c.execLHU(${ctx.instr_rt()}, ${ctx.instr_base()}, ${ctx.instr_imms()});`;
  return generateMemoryAccessBoilerplate(impl, ctx);
}

function generateLW(ctx) {
  const impl = `c.execLW(${ctx.instr_rt()}, ${ctx.instr_base()}, ${ctx.instr_imms()});`;
  return generateMemoryAccessBoilerplate(impl, ctx);
}

function generateLWU(ctx) {
  const impl = `c.execLWU(${ctx.instr_rt()}, ${ctx.instr_base()}, ${ctx.instr_imms()});`;
  return generateMemoryAccessBoilerplate(impl, ctx);
}

function generateLD(ctx) {
  const impl = `c.execLD(${ctx.instr_rt()}, ${ctx.instr_base()}, ${ctx.instr_imms()});`;
  return generateMemoryAccessBoilerplate(impl, ctx);
}

function generateLWC1(ctx) {
  const impl = `c.execLWC1(${ctx.instr_ft()}, ${ctx.instr_base()}, ${ctx.instr_imms()});`;
  return generateMemoryAccessBoilerplate(impl, ctx);
}

function generateLDC1(ctx) {
  const impl = `c.execLDC1(${ctx.instr_ft()}, ${ctx.instr_base()}, ${ctx.instr_imms()});`;
  return generateMemoryAccessBoilerplate(impl, ctx);
}

function generateSB(ctx) {
  const impl = `c.execSB(${ctx.instr_rt()}, ${ctx.instr_base()}, ${ctx.instr_imms()});`;
  return generateMemoryAccessBoilerplate(impl, ctx);
}

function generateSH(ctx) {
  const impl = `c.execSH(${ctx.instr_rt()}, ${ctx.instr_base()}, ${ctx.instr_imms()});`;
  return generateMemoryAccessBoilerplate(impl, ctx);
}

function generateSW(ctx) {
  const impl = `c.execSW(${ctx.instr_rt()}, ${ctx.instr_base()}, ${ctx.instr_imms()});`;
  return generateMemoryAccessBoilerplate(impl, ctx);
}

function generateSD(ctx) {
  const impl = `c.execSD(${ctx.instr_rt()}, ${ctx.instr_base()}, ${ctx.instr_imms()});`;
  return generateMemoryAccessBoilerplate(impl, ctx);
}

function generateSWC1(ctx) {
  ctx.fragment.usesCop1 = true;
  // FIXME: can avoid cpuStuffToDo if we're writing to ram
  const impl = `c.execSWC1(${ctx.instr_ft()}, ${ctx.instr_base()}, ${ctx.instr_imms()});`;
  return generateMemoryAccessBoilerplate(impl, ctx);
}

function generateSDC1(ctx) {
  ctx.fragment.usesCop1 = true;
  // FIXME: can avoid cpuStuffToDo if we're writing to ram
  const impl = `c.execSDC1(${ctx.instr_ft()}, ${ctx.instr_base()}, ${ctx.instr_imms()});`;
  return generateMemoryAccessBoilerplate(impl, ctx);
}

function generateCACHE(ctx) {
  if (!cpu0.ignoreCacheOp(ctx.instr_rt())) {
    const impl = `c.execCACHE(${ctx.instr_rt()}, ${ctx.instr_base()}, ${ctx.instr_imms()});`;
    return generateTrivialOpBoilerplate(impl, ctx);
  } else {
    return generateNOPBoilerplate('CACHE (ignored)', ctx);
  }
}

// TODO: move this somewhere central.
function physicalAddress(addr) {
  return addr & (~0xe0000000)
}

function makeLLAddr(sAddr) {
  return physicalAddress(sAddr >>> 0) >>> 4;
}

function generateMFC1Stub(ctx) {
  const t = ctx.instr_rt();
  const s = ctx.instr_fs();

  ctx.fragment.usesCop1 = true;
  ctx.isTrivial = true;

  return `c.setRegS32Extend(${t}, cpu1.loadS32(cpu1.copRegIdx32(${s})));`;
}

function executeMFC1(i) {
  cpu0.setRegS32Extend(rt(i), cpu1.loadS32(cpu1.copRegIdx32(fs(i))));
}

function generateDMFC1Stub(ctx) {
  const t = ctx.instr_rt();
  const s = ctx.instr_fs();

  ctx.fragment.usesCop1 = true;
  ctx.isTrivial = true;

  return `c.setRegU64(${t}, cpu1.loadU64(cpu1.copRegIdx64(${s})));`;
}

function executeDMFC1(i) {
  cpu0.setRegU64(rt(i), cpu1.loadU64(cpu1.copRegIdx64(fs(i))));
}

function generateMTC1Stub(ctx) {
  const s = ctx.instr_fs();
  const t = ctx.instr_rt();

  ctx.fragment.usesCop1 = true;
  ctx.isTrivial = true;

  return `cpu1.store32(cpu1.copRegIdx32(${s}), ${genSrcRegS32Lo(t)});`;
}

function executeMTC1(i) {
  cpu1.store32(cpu1.copRegIdx32(fs(i)), cpu0.getRegS32Lo(rt(i)));
}

function generateDMTC1Stub(ctx) {
  const s = ctx.instr_fs();
  const t = ctx.instr_rt();
  ctx.fragment.usesCop1 = true;
  ctx.isTrivial = true;

  return `cpu1.store64(cpu1.copRegIdx64(${s}), ${genSrcRegS64(t)});`;
}

function executeDMTC1(i) {
  const s = fs(i);
  const t = rt(i);
  cpu1.store64(cpu1.copRegIdx64(s), cpu0.getRegS64(t));
}

function generateCFC1Stub(ctx) {
  const s = ctx.instr_fs();
  const t = ctx.instr_rt();

  ctx.fragment.usesCop1 = true;
  ctx.isTrivial = true;

  switch (s) {
    case 0:
    case 31:
      return dedent(`
        const value = cpu1.control[${s}];
        c.setRegS32Extend(${t}, value);
        `);
  }

  return `// CFC1 invalid reg`;
}

function executeCFC1(i) {
  const s = fs(i);
  const t = rt(i);

  switch (s) {
    case 0:
    case 31:
      const value = cpu1.control[s];
      cpu0.setRegS32Extend(t, value);
      break;
  }
}

function generateCTC1Stub(ctx) {
  const s = ctx.instr_fs();
  const t = ctx.instr_rt();

  ctx.fragment.usesCop1 = true;
  ctx.isTrivial = true;

  if (s === 31) {
    return `cpu1.setStatus(${genSrcRegU32Lo(t)});`;
  }

  return `// CTC1 invalid reg`;
}

function executeCTC1(i) {
  const s = fs(i);
  if (s === 31) {
    cpu1.setStatus(cpu0.getRegU32Lo(rt(i)));
  }
}

function executeDCFC1(i) {
  cpu1.DCFC1(rt(i), fs(i));
}

function executeDCTC1(i) {
  cpu1.DCTC1(fs(i), rt(i));
}

function generateBCInstrStub(ctx) {
  const i = ctx.instruction;
  assert(((i >>> 18) & 0x7) === 0, "cc bit is not 0");

  const condition = (i & 0x10000) !== 0;
  const likely = (i & 0x20000) !== 0;
  const target = branchAddress(ctx.pc, i);

  ctx.fragment.usesCop1 = true;
  ctx.isTrivial = false; // NB: not trivial - branches!

  const test = condition ? '!==' : '===';

  let impl = `const cond = (cpu1.control[31] & FPCSR_C) ${test} 0;\n`;
  if (likely) {
    impl += `if (cond) {\n`;
    impl += `  c.branchTarget = ${toString32(target)};\n`;
    impl += '} else {\n';
    impl += '  c.nextPC += 4;\n';
    impl += '}\n';
  } else {
    impl += `if (cond) {\n`;
    impl += `  c.branchTarget = ${toString32(target)};\n`;
    impl += '} else {\n';
    impl += `  c.branchTarget = ${toString32(ctx.pc + 8)};\n`;
    impl += '}\n';
  }
  return impl;
}

function executeBCInstr(i) {
  assert(((i >>> 18) & 0x7) === 0, "cc bit is not 0");

  const condition = (i & 0x10000) !== 0;
  const likely = (i & 0x20000) !== 0;
  const cc = (cpu1.control[31] & FPCSR_C) !== 0;

  const cond = cc === condition;
  if (likely) {
    cpu0.conditionalBranchLikely(cond, offset(i));
  } else {
    cpu0.conditionalBranch(cond, offset(i));
  }
}

const cop1ADD = 0x00;
const cop1SUB = 0x01;
const cop1MUL = 0x02;
const cop1DIV = 0x03;
const cop1SQRT = 0x04;
const cop1ABS = 0x05;
const cop1MOV = 0x06;
const cop1NEG = 0x07;
const cop1ROUND_L = 0x08;
const cop1TRUNC_L = 0x09;
const cop1CEIL_L = 0x0a;
const cop1FLOOR_L = 0x0b;
const cop1ROUND_W = 0x0c;
const cop1TRUNC_W = 0x0d;
const cop1CEIL_W = 0x0e;
const cop1FLOOR_W = 0x0f;
const cop1CVT_S = 0x20;
const cop1CVT_D = 0x21;
const cop1CVT_W = 0x24;
const cop1CVT_L = 0x25;

function generateSInstrStub(ctx) {
  const s = ctx.instr_fs();
  const t = ctx.instr_ft();
  const d = ctx.instr_fd();

  ctx.fragment.usesCop1 = true;
  ctx.isTrivial = false;  // Can raise FPE.

  const op = cop1_func(ctx.instruction);

  if (op < 0x30) {
    switch (op) {
      case cop1ADD: return `cpu1.ADD_S(${d}, ${s}, ${t});`;
      case cop1SUB: return `cpu1.SUB_S(${d}, ${s}, ${t});`;
      case cop1MUL: return `cpu1.MUL_S(${d}, ${s}, ${t});`;
      case cop1DIV: return `cpu1.DIV_S(${d}, ${s}, ${t});`;
      case cop1SQRT: return `cpu1.SQRT_S(${d}, ${s});`;
      case cop1ABS: return `cpu1.ABS_S(${d}, ${s});`;
      case cop1MOV: return `cpu1.MOV_S(${d}, ${s});`;
      case cop1NEG: return `cpu1.NEG_S(${d}, ${s});`;
      case cop1ROUND_L: return `cpu1.ConvertSToL(${d}, ${s}, ${convertModeRound});`;
      case cop1TRUNC_L: return `cpu1.ConvertSToL(${d}, ${s}, ${convertModeTrunc});`;
      case cop1CEIL_L: return `cpu1.ConvertSToL(${d}, ${s}, ${convertModeCeil});`;
      case cop1FLOOR_L: return `cpu1.ConvertSToL(${d}, ${s}, ${convertModeFloor});`;
      case cop1ROUND_W: return `cpu1.ConvertSToW(${d}, ${s}, ${convertModeRound});`;
      case cop1TRUNC_W: return `cpu1.ConvertSToW(${d}, ${s}, ${convertModeTrunc});`;
      case cop1CEIL_W: return `cpu1.ConvertSToW(${d}, ${s}, ${convertModeCeil});`;
      case cop1FLOOR_W: return `cpu1.ConvertSToW(${d}, ${s}, ${convertModeFloor});`;
      case cop1CVT_S: return `cpu1.raiseUnimplemented();`;
      case cop1CVT_D: return `cpu1.CVT_D_S(${d}, ${s});`;
      case cop1CVT_W: return `cpu1.ConvertSToW(${d}, ${s}, cpu1.roundingMode);`;
      case cop1CVT_L: return `cpu1.ConvertSToL(${d}, ${s}, cpu1.roundingMode);`;
    }

    return `unimplemented(${toString32(ctx.pc)},${toString32(ctx.instruction)});`;
  }

  return `cpu1.handleFloatCompareSingle(${op}, ${s}, ${t});`;
}

function executeSInstr(i) {
  const s = fs(i);
  const t = ft(i);
  const d = fd(i);

  const op = cop1_func(i);

  if (op < 0x30) {
    switch (op) {
      case cop1ADD: cpu1.ADD_S(d, s, t); return;
      case cop1SUB: cpu1.SUB_S(d, s, t); return;
      case cop1MUL: cpu1.MUL_S(d, s, t); return;
      case cop1DIV: cpu1.DIV_S(d, s, t); return;
      case cop1SQRT: cpu1.SQRT_S(d, s); return;
      case cop1ABS: cpu1.ABS_S(d, s); return;
      case cop1MOV: cpu1.MOV_S(d, s); return;
      case cop1NEG: cpu1.NEG_S(d, s); return;
      case cop1ROUND_L: cpu1.ConvertSToL(d, s, convertModeRound); return;
      case cop1TRUNC_L: cpu1.ConvertSToL(d, s, convertModeTrunc); return;
      case cop1CEIL_L: cpu1.ConvertSToL(d, s, convertModeCeil); return;
      case cop1FLOOR_L: cpu1.ConvertSToL(d, s, convertModeFloor); return;
      case cop1ROUND_W: cpu1.ConvertSToW(d, s, convertModeRound); return;
      case cop1TRUNC_W: cpu1.ConvertSToW(d, s, convertModeTrunc); return;
      case cop1CEIL_W: cpu1.ConvertSToW(d, s, convertModeCeil); return;
      case cop1FLOOR_W: cpu1.ConvertSToW(d, s, convertModeFloor); return;
      case cop1CVT_S: cpu1.raiseUnimplemented(); return;
      case cop1CVT_D: cpu1.CVT_D_S(d, s); return;
      case cop1CVT_W: cpu1.ConvertSToW(d, s, cpu1.roundingMode); return;
      case cop1CVT_L: cpu1.ConvertSToL(d, s, cpu1.roundingMode); return;
    }
    unimplemented(cpu0.pc, i);
  } else {
    cpu1.handleFloatCompareSingle(op, s, t);
  }
}

function generateDInstrStub(ctx) {
  const s = ctx.instr_fs();
  const t = ctx.instr_ft();
  const d = ctx.instr_fd();

  ctx.fragment.usesCop1 = true;
  ctx.isTrivial = false;  // Can raise FPE.

  const op = cop1_func(ctx.instruction);

  if (op < 0x30) {
    switch (op) {
      case cop1ADD: return `cpu1.ADD_D(${d}, ${s}, ${t});`;
      case cop1SUB: return `cpu1.SUB_D(${d}, ${s}, ${t});`;
      case cop1MUL: return `cpu1.MUL_D(${d}, ${s}, ${t});`;
      case cop1DIV: return `cpu1.DIV_D(${d}, ${s}, ${t});`;
      case cop1SQRT: return `cpu1.SQRT_D(${d}, ${s});`;
      case cop1ABS: return `cpu1.ABS_D(${d}, ${s});`;
      case cop1MOV: return `cpu1.MOV_D(${d}, ${s});`;
      case cop1NEG: return `cpu1.NEG_D(${d}, ${s});`;
      case cop1ROUND_L: return `cpu1.ConvertDToL(${d}, ${s}, ${convertModeRound});`;
      case cop1TRUNC_L: return `cpu1.ConvertDToL(${d}, ${s}, ${convertModeTrunc});`;
      case cop1CEIL_L: return `cpu1.ConvertDToL(${d}, ${s}, ${convertModeCeil});`;
      case cop1FLOOR_L: return `cpu1.ConvertDToL(${d}, ${s}, ${convertModeFloor});`;
      case cop1ROUND_W: return `cpu1.ConvertDToW(${d}, ${s}, ${convertModeRound});`;
      case cop1TRUNC_W: return `cpu1.ConvertDToW(${d}, ${s}, ${convertModeTrunc});`;
      case cop1CEIL_W: return `cpu1.ConvertDToW(${d}, ${s}, ${convertModeCeil});`;
      case cop1FLOOR_W: return `cpu1.ConvertDToW(${d}, ${s}, ${convertModeFloor});`;
      case cop1CVT_S: return `cpu1.CVT_S_D(${d}, ${s});`;
      case cop1CVT_D: return `cpu1.raiseUnimplemented();`;
      case cop1CVT_W: return `cpu1.ConvertDToW(${d}, ${s}, cpu1.roundingMode);`;
      case cop1CVT_L: return `cpu1.ConvertDToL(${d}, ${s}, cpu1.roundingMode);`;
    }
    return `unimplemented(${toString32(ctx.pc)},${toString32(ctx.instruction)});`;
  }

  return `cpu1.handleFloatCompareDouble(${op}, ${s}, ${t});`;
}

function executeDInstr(i) {
  const s = fs(i);
  const t = ft(i);
  const d = fd(i);

  const op = cop1_func(i);

  if (op < 0x30) {
    switch (op) {
      case cop1ADD: cpu1.ADD_D(d, s, t); return;
      case cop1SUB: cpu1.SUB_D(d, s, t); return;
      case cop1MUL: cpu1.MUL_D(d, s, t); return;
      case cop1DIV: cpu1.DIV_D(d, s, t); return;
      case cop1SQRT: cpu1.SQRT_D(d, s); return;
      case cop1ABS: cpu1.ABS_D(d, s); return;
      case cop1MOV: cpu1.MOV_D(d, s); return;
      case cop1NEG: cpu1.NEG_D(d, s); return;
      case cop1ROUND_L: cpu1.ConvertDToL(d, s, convertModeRound); return;
      case cop1TRUNC_L: cpu1.ConvertDToL(d, s, convertModeTrunc); return;
      case cop1CEIL_L: cpu1.ConvertDToL(d, s, convertModeCeil); return;
      case cop1FLOOR_L: cpu1.ConvertDToL(d, s, convertModeFloor); return;
      case cop1ROUND_W: cpu1.ConvertDToW(d, s, convertModeRound); return;
      case cop1TRUNC_W: cpu1.ConvertDToW(d, s, convertModeTrunc); return;
      case cop1CEIL_W: cpu1.ConvertDToW(d, s, convertModeCeil); return;
      case cop1FLOOR_W: cpu1.ConvertDToW(d, s, convertModeFloor); return;
      case cop1CVT_S: cpu1.CVT_S_D(d, s); return;
      case cop1CVT_D: cpu1.raiseUnimplemented(); return;
      case cop1CVT_W: cpu1.ConvertDToW(d, s, cpu1.roundingMode); return;
      case cop1CVT_L: cpu1.ConvertDToL(d, s, cpu1.roundingMode); return;
    }
    unimplemented(cpu0.pc, i);
  } else {
    cpu1.handleFloatCompareDouble(op, s, t);
  }
}

function generateWInstrStub(ctx) {
  const s = ctx.instr_fs();
  const d = ctx.instr_fd();

  ctx.fragment.usesCop1 = true;
  ctx.isTrivial = false;  // Can raise FPE.
  switch (cop1_func(ctx.instruction)) {
    case cop1ROUND_L: return `cpu1.raiseUnimplemented();`;
    case cop1TRUNC_L: return `cpu1.raiseUnimplemented();`;
    case cop1CEIL_L: return `cpu1.raiseUnimplemented();`;
    case cop1FLOOR_L: return `cpu1.raiseUnimplemented();`;
    case cop1ROUND_W: return `cpu1.raiseUnimplemented();`;
    case cop1TRUNC_W: return `cpu1.raiseUnimplemented();`;
    case cop1CEIL_W: return `cpu1.raiseUnimplemented();`;
    case cop1FLOOR_W: return `cpu1.raiseUnimplemented();`;
    case cop1CVT_S: return `cpu1.CVT_S_W(${d}, ${s});`;
    case cop1CVT_D: return `cpu1.CVT_D_W(${d}, ${s});`;
    case cop1CVT_W: return `cpu1.raiseUnimplemented();`;
    case cop1CVT_L: return `cpu1.raiseUnimplemented();`;
  }
  return `unimplemented(${toString32(ctx.pc)},${toString32(ctx.instruction)});`;
}

function executeWInstr(i) {
  const s = fs(i);
  const d = fd(i);

  switch (cop1_func(i)) {
    case cop1ROUND_L: cpu1.raiseUnimplemented(); return;
    case cop1TRUNC_L: cpu1.raiseUnimplemented(); return;
    case cop1CEIL_L: cpu1.raiseUnimplemented(); return;
    case cop1FLOOR_L: cpu1.raiseUnimplemented(); return;
    case cop1ROUND_W: cpu1.raiseUnimplemented(); return;
    case cop1TRUNC_W: cpu1.raiseUnimplemented(); return;
    case cop1CEIL_W: cpu1.raiseUnimplemented(); return;
    case cop1FLOOR_W: cpu1.raiseUnimplemented(); return;
    case cop1CVT_S: cpu1.CVT_S_W(d, s); return;
    case cop1CVT_D: cpu1.CVT_D_W(d, s); return;
    case cop1CVT_W: cpu1.raiseUnimplemented(); return;
    case cop1CVT_L: cpu1.raiseUnimplemented(); return;
  }
  unimplemented(cpu0.pc, i);
}

function generateLInstrStub(ctx) {
  const s = ctx.instr_fs();
  const d = ctx.instr_fd();

  ctx.fragment.usesCop1 = true;
  ctx.isTrivial = false;  // Can raise FPE.
  switch (cop1_func(ctx.instruction)) {
    case cop1ROUND_L: return `cpu1.raiseUnimplemented();`;
    case cop1TRUNC_L: return `cpu1.raiseUnimplemented();`;
    case cop1CEIL_L: return `cpu1.raiseUnimplemented();`;
    case cop1FLOOR_L: return `cpu1.raiseUnimplemented();`;
    case cop1ROUND_W: return `cpu1.raiseUnimplemented();`;
    case cop1TRUNC_W: return `cpu1.raiseUnimplemented();`;
    case cop1CEIL_W: return `cpu1.raiseUnimplemented();`;
    case cop1FLOOR_W: return `cpu1.raiseUnimplemented();`;
    case cop1CVT_S: return `cpu1.CVT_S_L(${d}, ${s});`;
    case cop1CVT_D: return `cpu1.CVT_D_L(${d}, ${s});`;
    case cop1CVT_W: return `cpu1.raiseUnimplemented();`;
    case cop1CVT_L: return `cpu1.raiseUnimplemented();`;
  }
  return `unimplemented(${toString32(ctx.pc)},${toString32(ctx.instruction)});`;
}

function executeLInstr(i) {
  const s = fs(i);
  const d = fd(i);

  switch (cop1_func(i)) {
    case cop1ROUND_L: cpu1.raiseUnimplemented(); return;
    case cop1TRUNC_L: cpu1.raiseUnimplemented(); return;
    case cop1CEIL_L: cpu1.raiseUnimplemented(); return;
    case cop1FLOOR_L: cpu1.raiseUnimplemented(); return;
    case cop1ROUND_W: cpu1.raiseUnimplemented(); return;
    case cop1TRUNC_W: cpu1.raiseUnimplemented(); return;
    case cop1CEIL_W: cpu1.raiseUnimplemented(); return;
    case cop1FLOOR_W: cpu1.raiseUnimplemented(); return;
    case cop1CVT_S: cpu1.CVT_S_L(d, s); return;
    case cop1CVT_D: cpu1.CVT_D_L(d, s); return;
    case cop1CVT_W: cpu1.raiseUnimplemented(); return;
    case cop1CVT_L: cpu1.raiseUnimplemented(); return;
  }
  unimplemented(cpu0.pc, i);
}

function executeMFC2(i) {
  cpu0.setRegS32Extend(rt(i), cpu2.getReg32());
}

function executeDMFC2(i) {
  cpu0.setRegU64(rt(i), cpu2.getReg64());
}

function executeCFC2(i) {
  cpu0.setRegS32Extend(rt(i), cpu2.getReg32());
}

function executeDCFC2(i) {
  cpu0.raiseRESERVEDException(2);
}

function executeMTC2(i) {
  cpu2.setReg64(cpu0.getRegU64(rt(i)));
}

function executeDMTC2(i) {
  cpu2.setReg64(cpu0.getRegU64(rt(i)));
}

function executeCTC2(i) {
  cpu2.setReg64(cpu0.getRegU64(rt(i)));
}

function executeDCTC2(i) {
  cpu0.raiseRESERVEDException(2);
}

function validateSpecialOpTable(cases) {
  if (cases.length != 64) {
    throw "Special table is unexpected size.";
  }
  return cases;
}

const specialTable = validateSpecialOpTable([
  i => cpu0.execSLL(rd(i), rt(i), sa(i)),
  executeUnknown,
  i => cpu0.execSRL(rd(i), rt(i), sa(i)),
  i => cpu0.execSRA(rd(i), rt(i), sa(i)),
  i => cpu0.execSLLV(rd(i), rt(i), rs(i)),
  executeUnknown,
  i => cpu0.execSRLV(rd(i), rt(i), rs(i)),
  i => cpu0.execSRAV(rd(i), rt(i), rs(i)),

  i => cpu0.execJR(rs(i)),
  i => cpu0.execJALR(rd(i), rs(i)),
  executeUnknown,
  executeUnknown,
  i => cpu0.execSYSCALL(),
  i => cpu0.execBREAK(),
  executeUnknown,
  i => cpu0.execSYNC(),

  i => cpu0.execMFHI(rd(i)),
  i => cpu0.execMTHI(rs(i)),
  i => cpu0.execMFLO(rd(i)),
  i => cpu0.execMTLO(rs(i)),
  i => cpu0.execDSLLV(rd(i), rt(i), rs(i)),
  executeUnknown,
  i => cpu0.execDSRLV(rd(i), rt(i), rs(i)),
  i => cpu0.execDSRAV(rd(i), rt(i), rs(i)),

  i => cpu0.execMULT(rt(i), rs(i)),
  i => cpu0.execMULTU(rt(i), rs(i)),
  i => cpu0.execDIV(rt(i), rs(i)),
  i => cpu0.execDIVU(rt(i), rs(i)),
  i => cpu0.execDMULT(rt(i), rs(i)),
  i => cpu0.execDMULTU(rt(i), rs(i)),
  i => cpu0.execDDIV(rt(i), rs(i)),
  i => cpu0.execDDIVU(rt(i), rs(i)),

  i => cpu0.execADD(rd(i), rt(i), rs(i)),
  i => cpu0.execADDU(rd(i), rt(i), rs(i)),
  i => cpu0.execSUB(rd(i), rt(i), rs(i)),
  i => cpu0.execSUBU(rd(i), rt(i), rs(i)),
  i => cpu0.execAND(rd(i), rt(i), rs(i)),
  i => cpu0.execOR(rd(i), rt(i), rs(i)),
  i => cpu0.execXOR(rd(i), rt(i), rs(i)),
  i => cpu0.execNOR(rd(i), rt(i), rs(i)),

  executeUnknown,
  executeUnknown,
  i => cpu0.execSLT(rd(i), rt(i), rs(i)),
  i => cpu0.execSLTU(rd(i), rt(i), rs(i)),
  i => cpu0.execDADD(rd(i), rt(i), rs(i)),
  i => cpu0.execDADDU(rd(i), rt(i), rs(i)),
  i => cpu0.execDSUB(rd(i), rt(i), rs(i)),
  i => cpu0.execDSUBU(rd(i), rt(i), rs(i)),

  i => cpu0.execTGE(rt(i), rs(i)),
  i => cpu0.execTGEU(rt(i), rs(i)),
  i => cpu0.execTLT(rt(i), rs(i)),
  i => cpu0.execTLTU(rt(i), rs(i)),
  i => cpu0.execTEQ(rt(i), rs(i)),
  executeUnknown,
  i => cpu0.execTNE(rt(i), rs(i)),
  executeUnknown,

  i => cpu0.execDSLL(rd(i), rt(i), sa(i)),
  executeUnknown,
  i => cpu0.execDSRL(rd(i), rt(i), sa(i)),
  i => cpu0.execDSRA(rd(i), rt(i), sa(i)),
  i => cpu0.execDSLL32(rd(i), rt(i), sa(i)),
  executeUnknown,
  i => cpu0.execDSRL32(rd(i), rt(i), sa(i)),
  i => cpu0.execDSRA32(rd(i), rt(i), sa(i)),
]);

const specialTableGen = validateSpecialOpTable([
  generateSLL,            'executeUnknown',       generateSRL,          generateSRA,
  generateSLLV,           'executeUnknown',       generateSRLV,         generateSRAV,
  generateJR,             generateJALR,           'executeUnknown',     'executeUnknown',
  generateSYSCALL,        generateBREAK,          'executeUnknown',     generateSYNC,
  generateMFHI,           generateMTHI,           generateMFLO,         generateMTLO,
  generateDSLLV,          'executeUnknown',       generateDSRLV,        generateDSRAV,
  generateMULT,           generateMULTU,          generateDIV,          generateDIVU,
  generateDMULT,          generateDMULTU,         generateDDIV,         generateDDIVU,
  generateADD,            generateADDU,           generateSUB,          generateSUBU,
  generateAND,            generateOR,             generateXOR,          generateNOR,
  'executeUnknown',       'executeUnknown',       generateSLT,          generateSLTU,
  generateDADD,           generateDADDU,          generateDSUB,         generateDSUBU,
  generateTGE,            generateTGEU,           generateTLT,          generateTLTU,
  generateTEQ,            'executeUnknown',       generateTNE,          'executeUnknown',
  generateDSLL,           'executeUnknown',       generateDSRL,         generateDSRA,
  generateDSLL32,         'executeUnknown',       generateDSRL32,       generateDSRA32
 ]);

function executeSpecial(i) {
  const fn = i & 0x3f;
  specialTable[fn](i);
}

// Expose all the functions that we don't yet generate
n64js.executeUnknown = executeUnknown;

function validateCopOpTable(cases) {
  if (cases.length != 32) {
    throw "Cop table is unexpected size.";
  }
  return cases;
}

const cop0Table = validateCopOpTable([
  executeMFC0,    executeDMFC0,   executeUnknown, executeUnknown,
  executeMTC0,    executeDMTC0,   executeUnknown, executeUnknown,
  executeUnknown, executeUnknown, executeUnknown, executeUnknown,
  executeUnknown, executeUnknown, executeUnknown, executeUnknown,
  executeTLB,     executeUnknown, executeUnknown, executeUnknown,
  executeUnknown, executeUnknown, executeUnknown, executeUnknown,
  executeUnknown, executeUnknown, executeUnknown, executeUnknown,
  executeUnknown, executeUnknown, executeUnknown, executeUnknown
]);

const cop0TableGen = validateCopOpTable([
  'executeMFC0',    'executeDMFC0',   'executeUnknown', 'executeUnknown',
  generateMTC0,     'executeDMTC0',   'executeUnknown', 'executeUnknown',
  'executeUnknown', 'executeUnknown', 'executeUnknown', 'executeUnknown',
  'executeUnknown', 'executeUnknown', 'executeUnknown', 'executeUnknown',
  'executeTLB',     'executeUnknown', 'executeUnknown', 'executeUnknown',
  'executeUnknown', 'executeUnknown', 'executeUnknown', 'executeUnknown',
  'executeUnknown', 'executeUnknown', 'executeUnknown', 'executeUnknown',
  'executeUnknown', 'executeUnknown', 'executeUnknown', 'executeUnknown'
]);

function executeCop0(i) {
  const fmt = (i >>> 21) & 0x1f;
  cop0Table[fmt](i);
}

// Expose all the functions that we don't yet generate
n64js.executeMFC0 = executeMFC0;
n64js.executeMTC0 = executeMTC0;  // There's a generateMTC0, but it calls through to the interpreter
n64js.executeDMFC0 = executeDMFC0;
n64js.executeDMTC0 = executeDMTC0;
n64js.executeTLB = executeTLB;

const cop1Table = validateCopOpTable([
  executeMFC1,        executeDMFC1,       executeCFC1,        executeDCFC1,
  executeMTC1,        executeDMTC1,       executeCTC1,        executeDCTC1,
  executeBCInstr,     executeUnknown,     executeUnknown,     executeUnknown,
  executeUnknown,     executeUnknown,     executeUnknown,     executeUnknown,
  executeSInstr,      executeDInstr,      executeUnknown,     executeUnknown,
  executeWInstr,      executeLInstr,      executeUnknown,     executeUnknown,
  executeUnknown,     executeUnknown,     executeUnknown,     executeUnknown,
  executeUnknown,     executeUnknown,     executeUnknown,     executeUnknown
]);

const cop1TableGen = validateCopOpTable([
  generateMFC1Stub,       generateDMFC1Stub,      generateCFC1Stub,     'executeDCFC1',
  generateMTC1Stub,       generateDMTC1Stub,      generateCTC1Stub,     'executeDCTC1',
  generateBCInstrStub,    'executeUnknown',       'executeUnknown',     'executeUnknown',
  'executeUnknown',       'executeUnknown',       'executeUnknown',     'executeUnknown',
  generateSInstrStub,     generateDInstrStub,     'executeUnknown',     'executeUnknown',
  generateWInstrStub,     generateLInstrStub,     'executeUnknown',     'executeUnknown',
  'executeUnknown',       'executeUnknown',       'executeUnknown',     'executeUnknown',
  'executeUnknown',       'executeUnknown',       'executeUnknown',     'executeUnknown'
]);

function executeCop1(i) {
  //assert( (cpu0.getControlU32(cpu0_constants.controlSR) & SR_CU1) !== 0, "SR_CU1 in inconsistent state" );

  const fmt = (i >>> 21) & 0x1f;
  cop1Table[fmt](i);
}

// Expose all the functions that we don't yet generate
n64js.executeDCFC1 = executeDCFC1;
n64js.executeDCTC1 = executeDCTC1;

const cop2Table = validateCopOpTable([
  executeMFC2,        executeDMFC2,       executeCFC2,        executeDCFC2,
  executeMTC2,        executeDMTC2,       executeCTC2,        executeDCTC2,
  executeUnknown,     executeUnknown,     executeUnknown,     executeUnknown,
  executeUnknown,     executeUnknown,     executeUnknown,     executeUnknown,
  executeUnknown,     executeUnknown,     executeUnknown,     executeUnknown,
  executeUnknown,     executeUnknown,     executeUnknown,     executeUnknown,
  executeUnknown,     executeUnknown,     executeUnknown,     executeUnknown,
  executeUnknown,     executeUnknown,     executeUnknown,     executeUnknown
]);

function executeCop2(i) {
  if (!cpu0.checkCopXUsable(2)) {
    return;
  }
  const fmt = (i >>> 21) & 0x1f;
  cop2Table[fmt](i);
}

function executeCop3(i) {
  cpu0.raiseRESERVEDException(0);
}

function generateCop1(ctx) {
  const fmt = (ctx.instruction >>> 21) & 0x1f;
  const fn = cop1TableGen[fmt];

  let op_impl;
  if (typeof fn === 'string') {
    //logger.log(fn);
    op_impl = 'n64js.' + fn + '(' + toString32(ctx.instruction) + ');\n';
  } else {
    op_impl = fn(ctx);
  }

  let impl = '';

  ctx.fragment.usesCop1 = true;

  if (ctx.fragment.cop1statusKnown) {
    // Assert that cop1 is enabled
    impl += ctx.genAssert('(c.getControlU32(12) & SR_CU1) !== 0', 'cop1 should be enabled');
    impl += addNewlines(op_impl);
  } else {
    impl += 'if( (c.getControlU32(12) & SR_CU1) === 0 ) {\n';
    impl += `  n64js.executeCop1_disabled(${toString32(ctx.instruction)});\n`;
    impl += '} else {\n';
    impl += '  ' + addNewlines(op_impl);
    impl += '}\n';

    ctx.isTrivial = false;    // Not trivial!
    ctx.fragment.cop1statusKnown = true;
    return generateGenericOpBoilerplate(impl, ctx);   // Ensure we generate full boilerplate here, even for trivial ops
  }

  if (ctx.isTrivial) {
    return generateTrivialOpBoilerplate(impl, ctx);
  }
  return generateGenericOpBoilerplate(impl, ctx);
}

function executeCop1_disabled(i) {
  assert((cpu0.getControlU32(cpu0_constants.controlStatus) & SR_CU1) === 0, "SR_CU1 in inconsistent state");

  cpu0.throwCopXUnusable(1);
}
n64js.executeCop1_disabled = executeCop1_disabled;

function cop1ControlChanged() {
  const control = cpu0.getControlU32(cpu0_constants.controlStatus);
  const enable = (control & SR_CU1) !== 0;
  simpleTable[0x11] = enable ? executeCop1 : executeCop1_disabled;

  cpu1.fullMode = (control & SR_FR) !== 0;
}
n64js.cop1ControlChanged = cop1ControlChanged;

function validateRegImmOpTable(cases) {
  if (cases.length != 32) {
    throw "RegImm table is unexpected size.";
  }
  return cases;
}

const regImmTable = validateRegImmOpTable([
  executeBLTZ,          executeBGEZ,          executeBLTZL,       executeBGEZL,
  executeUnknown,       executeUnknown,       executeUnknown,     executeUnknown,
  executeTGEI,          executeTGEIU,         executeTLTI,        executeTLTIU,
  executeTEQI,          executeUnknown,       executeTNEI,        executeUnknown,
  executeBLTZAL,        executeBGEZAL,        executeBLTZALL,     executeBGEZALL,
  executeUnknown,       executeUnknown,       executeUnknown,     executeUnknown,
  executeUnknown,       executeUnknown,       executeUnknown,     executeUnknown,
  executeUnknown,       executeUnknown,       executeUnknown,     executeUnknown
]);

const regImmTableGen = validateRegImmOpTable([
  generateBLTZ,           generateBGEZ,           generateBLTZL,        generateBGEZL,
  'executeUnknown',       'executeUnknown',       'executeUnknown',     'executeUnknown',
  'executeTGEI',          'executeTGEIU',         'executeTLTI',        'executeTLTIU',
  'executeTEQI',          'executeUnknown',       'executeTNEI',        'executeUnknown',
  'executeBLTZAL',        'executeBGEZAL',        'executeBLTZALL',     'executeBGEZALL',
  'executeUnknown',       'executeUnknown',       'executeUnknown',     'executeUnknown',
  'executeUnknown',       'executeUnknown',       'executeUnknown',     'executeUnknown',
  'executeUnknown',       'executeUnknown',       'executeUnknown',     'executeUnknown'
]);

function executeRegImm(i) {
  const rt = (i >>> 16) & 0x1f;
  return regImmTable[rt](i);
}

// Expose all the functions that we don't yet generate
n64js.executeTGEI    = executeTGEI;
n64js.executeTGEIU   = executeTGEIU;
n64js.executeTLTI    = executeTLTI;
n64js.executeTLTIU   = executeTLTIU;
n64js.executeTEQI    = executeTEQI;
n64js.executeTNEI    = executeTNEI;
n64js.executeBLTZAL  = executeBLTZAL;
n64js.executeBGEZAL  = executeBGEZAL;
n64js.executeBLTZALL = executeBLTZALL;
n64js.executeBGEZALL = executeBGEZALL;

function validateSimpleOpTable(cases) {
  if (cases.length != 64) {
    throw "Simple table is unexpected size.";
  }
  return cases;
}

function executeOp(i) {
  const opcode = (i >>> 26) & 0x3f;
  return simpleTable[opcode](i);
}

const simpleTable = validateSimpleOpTable([
  executeSpecial,       executeRegImm,        executeJ,           executeJAL,
  executeBEQ,           executeBNE,           executeBLEZ,        executeBGTZ,
  executeADDI,          executeADDIU,         executeSLTI,        executeSLTIU,
  executeANDI,          executeORI,           executeXORI,        executeLUI,
  executeCop0,          executeCop1_disabled, executeCop2,        executeCop3,
  executeBEQL,          executeBNEL,          executeBLEZL,       executeBGTZL,
  executeDADDI,         executeDADDIU,        executeLDL,         executeLDR,
  executeUnknown,       executeUnknown,       executeUnknown,     executeRESERVED,
  executeLB,            executeLH,            executeLWL,         executeLW,
  executeLBU,           executeLHU,           executeLWR,         executeLWU,
  executeSB,            executeSH,            executeSWL,         executeSW,
  executeSDL,           executeSDR,           executeSWR,         executeCACHE,
  executeLL,            executeLWC1,          executeUnknown,     executeUnknown,
  executeLLD,           executeLDC1,          executeLDC2,        executeLD,
  executeSC,            executeSWC1,          executeBreakpoint,  executeUnknown,
  executeSCD,           executeSDC1,          executeSDC2,        executeSD
]);

const simpleTableGen = validateSimpleOpTable([
  generateSpecial,        generateRegImm,         generateJ,            generateJAL,
  generateBEQ,            generateBNE,            generateBLEZ,         generateBGTZ,
  generateADDI,           generateADDIU,          generateSLTI,         generateSLTIU,
  generateANDI,           generateORI,            generateXORI,         generateLUI,
  generateCop0,           generateCop1,           'executeCop2',        'executeCop3',
  generateBEQL,           generateBNEL,           'executeBLEZL',       'executeBGTZL',
  generateDADDI,          generateDADDIU,         'executeLDL',         'executeLDR',
  'executeUnknown',       'executeUnknown',       'executeUnknown',     'executeRESERVED',
  generateLB,             generateLH,             'executeLWL',         generateLW,
  generateLBU,            generateLHU,            'executeLWR',         generateLWU,
  generateSB,             generateSH,             'executeSWL',         generateSW,
  'executeSDL',           'executeSDR',           'executeSWR',         generateCACHE,
  'executeLL',            generateLWC1,           'executeUnknown',     'executeUnknown',
  'executeLLD',           generateLDC1,           'executeLDC2',        generateLD,
  'executeSC',            generateSWC1,           'executeUnknown',     'executeUnknown',
  'executeSCD',           generateSDC1,           'executeSDC2',        generateSD
]);

// Expose all the functions that we don't yet generate
n64js.executeCop2 = executeCop2;
n64js.executeCop3 = executeCop3;
n64js.executeBLEZL = executeBLEZL;
n64js.executeBGTZL = executeBGTZL;
n64js.executeLDL = executeLDL;
n64js.executeLDR = executeLDR;
n64js.executeRESERVED = executeRESERVED;
n64js.executeLWL = executeLWL;
n64js.executeLWR = executeLWR;
n64js.executeSWL = executeSWL;
n64js.executeSDL = executeSDL;
n64js.executeSDR = executeSDR;
n64js.executeSWR = executeSWR;
n64js.executeLL = executeLL;
n64js.executeLLD = executeLLD;
n64js.executeLDC2 = executeLDC2;
n64js.executeSC = executeSC;
n64js.executeSCD = executeSCD;
n64js.executeSDC2 = executeSDC2;

class FragmentContext {
  constructor() {
    this.fragment = undefined;
    this.pc = 0;
    this.instruction = 0;
    this.postPC = 0;
    this.bailOut = false; // Set this if the op does something to manipulate event timers.
    this.nextPC = 0;

    this.needsDelayCheck = true; // Set on entry to generate handler. If set, must check for delayPC when updating the pc.
    this.isTrivial = false; // Set by the code generation handler if the op is considered trivial.
    this.delayedPCUpdate = 0; // Trivial ops can try to delay setting the pc so that back-to-back trivial ops can emit them entirely.
    this.dump = false; // Display this op when finished.
  }

  genAssert(test, msg) {
    if (kDebugDynarec) {
      return 'n64js.assert(' + test + ', "' + msg + '");\n';
    }
    return '';
  }

  newFragment() {
    this.delayedPCUpdate = 0;
  }

  set(fragment, pc, instruction, postPC, nextPC) {
    this.fragment = fragment;
    this.pc = pc;
    this.instruction = instruction;
    this.postPC = postPC;
    this.nextPC = nextPC;
    this.bailOut = false;

    this.needsDelayCheck = true;
    this.isTrivial = false;

    this.dump = false;

    // Persist this between ops
    // this.delayedPCUpdate = 0;
  }

  instr_rs() { return rs(this.instruction); }
  instr_rt() { return rt(this.instruction); }
  instr_rd() { return rd(this.instruction); }
  instr_sa() { return sa(this.instruction); }

  instr_fs() { return fs(this.instruction); }
  instr_ft() { return ft(this.instruction); }
  instr_fd() { return fd(this.instruction); }

  instr_base() { return base(this.instruction); }
  instr_offset() { return offset(this.instruction); }
  instr_imms() { return imms(this.instruction); }
  instr_imm() { return imm(this.instruction); }
}

function checkCauseIP3Consistent() {
  const miRegDevice = n64js.hardware().miRegDevice;
  const miIntr = miRegDevice.interruptsUnmasked();
  const causeIP3 = (cpu0.getControlU32(cpu0_constants.controlCause) & CAUSE_IP3) !== 0;
  assert(miIntr === causeIP3, `CAUSE_IP3 ${causeIP3} inconsistent with MI_INTR_REG ${miIntr}`);
}

function mix(a, b, c) {
  a -= b; a -= c; a ^= (c >>> 13);
  b -= c; b -= a; b ^= (a << 8);
  c -= a; c -= b; c ^= (b >>> 13);
  a -= b; a -= c; a ^= (c >>> 12);
  b -= c; b -= a; b ^= (a << 16);
  c -= a; c -= b; c ^= (b >>> 5);
  a -= b; a -= c; a ^= (c >>> 3);
  b -= c; b -= a; b ^= (a << 10);
  c -= a; c -= b; c ^= (b >>> 15);

  return a;
}

function checkSyncState(sync, pc) {
  let i;

  if (!sync.sync32(pc, 'pc'))
    return false;

  // let next_vbl = 0;
  // for (i = 0; i < cpu0.events.length; ++i) {
  //   const event = cpu0.events[i];
  //   next_vbl += event.countdown;
  //   if (event.type === kEventVbl) {
  //     next_vbl = next_vbl*2+1;
  //     break;
  //   } else if (event.type == kEventCompare) {
  //     next_vbl = next_vbl*2;
  //     break;
  //   }
  // }

  // if (!sync.sync32(next_vbl, 'event'))
  //   return false;

  if (1) {
    let a = 0;
    for (i = 0; i < 32; ++i) {
      a = mix(a, cpu0.getRegU32Lo(i), 0);
    }
    a = a >>> 0;

    if (!sync.sync32(a, 'regs'))
      return false;
  }

  // if(0) {
  //   if (!sync.sync32(cpu0.multLoU32[0], 'multlo'))
  //     return false;
  //   if (!sync.sync32(cpu0.multHiU32[0], 'multhi'))
  //     return false;
  // }

  // if(0) {
  //   if (!sync.sync32(cpu0.getControlU32(cpu0_constants.controlCount), 'count'))
  //     return false;
  //   if (!sync.sync32(cpu0.getControlU32(cpu0_constants.controlCompare), 'compare'))
  //     return false;
  // }

  return true;
}

function handleEmulatedException() {
  cpu0.pc = cpu0.nextPC;
  cpu0.delayPC = 0;
  cpu0.branchTarget = 0;
  cpu0.incrementCount(COUNTER_INCREMENT_PER_OP);

  const evt = cpu0.events[0];
  evt.countdown -= COUNTER_INCREMENT_PER_OP;
  if (evt.countdown <= 0) {
    handleCounter();
  }
}

function handleCounter() {
  while (cpu0.events.length > 0 && cpu0.events[0].countdown <= 0) {
    const evt = cpu0.events[0];
    cpu0.events.splice(0, 1);

    // if it's our cycles event then just bail
    if (evt.type === kEventRunForCycles) {
      cpu0.stuffToDo |= kStuffToDoBreakout;
    } else if (evt.type === kEventCompare) {
      cpu0.setControlBits32(cpu0_constants.controlCause, CAUSE_IP8);
      cpu0.updateStuffToDoForInterrupts();
    } else if (evt.type === kEventVbl) {
      n64js.verticalBlank();
      cpu0.stuffToDo |= kStuffToDoBreakout;
    } else {
      n64js.halt('unhandled event!');
    }
  }
}

n64js.singleStep = function () {
  const restore_breakpoint_address = 0;
  if (n64js.isBreakpoint(cpu0.pc)) {
    restore_breakpoint_address = cpu0.pc;
    n64js.toggleBreakpoint(restore_breakpoint_address);
  }

  n64js.run(1);

  if (restore_breakpoint_address) {
    n64js.toggleBreakpoint(restore_breakpoint_address);
  }
};

n64js.run = function (cycles) {
  cpu0.stuffToDo &= ~kStuffToDoHalt;

  checkCauseIP3Consistent();
  n64js.checkSIStatusConsistent();

  cpu0.addEvent(kEventRunForCycles, cycles);

  while (cpu0.hasEvent(kEventRunForCycles)) {
    try {
      // NB: the bulk of run() is implemented as a separate function.
      // v8 won't optimise code with try/catch blocks, so structuring the code in this way allows runImpl to be optimised.
      runImpl();
      break;
    } catch (e) {
      if (e instanceof EmulatedException) {
        // If we hit an emulated exception we apply the nextPC (which should have been set to an exception vector) and continue looping.
        handleEmulatedException();
      } else if (e instanceof BreakpointException) {
        n64js.stopForBreakpoint();
      } else {
        // Other exceptions are bad news, so display an error and bail out.
        n64js.halt('Exception :' + e);
        break;
      }
    }
  }

  // Clean up any kEventRunForCycles events before we bail out
  let cycles_remaining = cpu0.removeEventsOfType(kEventRunForCycles);

  // If the event no longer exists, assume we've executed all the cycles
  if (cycles_remaining < 0) {
    cycles_remaining = 0;
  }
  if (cycles_remaining < cycles) {
    cpu0.opsExecuted += cycles - cycles_remaining;
  }
};

function executeFragment(fragment, c, events) {
  let evt = events[0];
  if (evt.countdown >= fragment.opsCompiled * COUNTER_INCREMENT_PER_OP) {
    fragment.executionCount++;
    const ops_executed = fragment.func(c);   // Absolute value is number of ops executed.

    // refresh latest event - may have changed
    evt = events[0];
    evt.countdown -= ops_executed * COUNTER_INCREMENT_PER_OP;

    if (!accurateCountUpdating) {
      c.incrementCount(ops_executed * COUNTER_INCREMENT_PER_OP);
    }

    //assert(fragment.bailedOut || evt.countdown >= 0, "Executed too many ops. Possibly didn't bail out of trace when new event was set up?");
    if (evt.countdown <= 0) {
      handleCounter();
    }

    // If stuffToDo is set, we'll break on the next loop

    let next_fragment = fragment.nextFragments[ops_executed];
    if (!next_fragment || next_fragment.entryPC !== c.pc) {
      next_fragment = fragment.getNextFragment(c.pc, ops_executed);
    }
    fragment = next_fragment;

  } else {
    // We're close to another event: drop to the interpreter
    fragment = null;
  }

  return fragment;
}

// We need just one of these - declare at global scope to avoid generating garbage
const fragmentContext = new FragmentContext();

function addOpToFragment(fragment, entry_pc, instruction, c) {
  if (fragment.opsCompiled === 0) {
    fragmentContext.newFragment();
  }
  fragment.opsCompiled++;
  updateFragment(fragment, entry_pc);

  const curPC = entry_pc;
  const postPC = c.pc;
  fragmentContext.set(fragment, curPC, instruction, postPC, c.nextPC);
  generateCodeForOp(fragmentContext);

  // Break out of the trace as soon as we branch, or too many ops, or last op generated an interrupt (stuffToDo set)
  const long_fragment = fragment.opsCompiled > 8;
  if ((long_fragment && c.pc !== entry_pc + 4) || fragment.opsCompiled >= 250 || c.stuffToDo) {

    // Check if the last op has a delayed pc update, and do it now.
    if (fragmentContext.delayedPCUpdate !== 0) {
      fragment.body_code += 'c.pc = ' + toString32(fragmentContext.delayedPCUpdate) + ';\n';
      fragmentContext.delayedPCUpdate = 0;
    }

    fragment.body_code += 'return ' + fragment.opsCompiled + ';\n';    // Return the number of ops exected

    const sync = n64js.getSyncFlow();
    if (sync) {
      fragment.body_code = 'const sync = n64js.getSyncFlow();\n' + fragment.body_code;
    }

    if (fragment.usesCop1) {
      let cpu1_shizzle = '';
      cpu1_shizzle += 'const cpu1 = n64js.cpu1;\n';
      cpu1_shizzle += 'const SR_CU1 = ' + toString32(SR_CU1) + ';\n';
      cpu1_shizzle += 'const FPCSR_C = ' + toString32(FPCSR_C) + ';\n';
      fragment.body_code = cpu1_shizzle + '\n\n' + fragment.body_code;
    }

    const code = 'return function fragment_' + toString32(fragment.entryPC) + '_' + fragment.opsCompiled + '(c) {\n' + fragment.body_code + '}\n';

    // Clear these strings to reduce garbage
    fragment.body_code = '';

    fragment.func = new Function(code)();
    fragment.nextFragments = [];
    for (let i = 0; i < fragment.opsCompiled; i++) {
      fragment.nextFragments.push(undefined);
    }
    fragment = lookupFragment(c.pc);
  }

  return fragment;
}

function runImpl() {
  const c = cpu0;
  const rsp = n64js.rsp;
  const events = c.events;
  const ramDV = c.ramDV;

  while (c.hasEvent(kEventRunForCycles)) {
    let fragment = lookupFragment(c.pc);
    // fragment = null;

    while (!c.stuffToDo) {

      if (fragment && fragment.func) {
        fragment = executeFragment(fragment, c, events);
      } else {
        // if (syncFlow) {
        //   if (!checkSyncState(syncFlow, cpu0.pc)) {
        //     n64js.halt('sync error');
        //     break;
        //   }
        // }

        // TODO: this should also be called from dynarec.
        rsp.step();
        if (c.stuffToDo) {
          // RSP can generate interrupt which can be cleared by CPU.
          // TODO: for performance we should throw an exception when
          // an interrupt is raised and avoid testing this every instruction.
          break;
        }

        const pc = c.pc | 0;   // take a copy of this, so we can refer to it later

        // NB: set nextPC before the call to readMemoryS32. If this throws an exception, we need nextPC to be set up correctly.
        c.nextPC = c.delayPC || c.pc + 4;

        // NB: load instruction using normal memory access routines - this means that we throw a tlb miss/refill approptiately
        // let instruction = memaccess.loadS32fast(pc);
        let instruction;
        if ((pc & 3) != 0) {
          c.raiseAdELException(pc);
          c.pc = c.nextPC;
          continue;
        } else if (pc < -2139095040) {
          const phys = (pc + 0x80000000) | 0;  // NB: or with zero ensures we return an SMI if possible.
          instruction = ramDV.getInt32(phys, false);
        } else {
          instruction = memaccess.loadS32slow(pc >>> 0);
        }

        c.branchTarget = 0;
        executeOp(instruction);

        c.pc = c.nextPC;
        c.delayPC = c.branchTarget;
        c.incrementCount(COUNTER_INCREMENT_PER_OP);
        //checkCauseIP3Consistent();
        //n64js.checkSIStatusConsistent();

        let evt = events[0];
        evt.countdown -= COUNTER_INCREMENT_PER_OP;
        if (evt.countdown <= 0) {
          handleCounter();
        }

        // If we have a fragment, we're assembling code as we go
        if (fragment) {
          fragment = addOpToFragment(fragment, pc >>> 0, instruction, c);
        } else {
          // If there's no current fragment and we branch backwards, this is possibly a new loop
          if (c.pc < pc) {
            fragment = lookupFragment(c.pc);
          }
        }
      }
    }

    c.stuffToDo &= ~kStuffToDoBreakout;

    if (c.stuffToDo & kStuffToDoCheckInterrupts) {
      c.stuffToDo &= ~kStuffToDoCheckInterrupts;
      c.handleInterrupt();
    } else if (c.stuffToDo & kStuffToDoHalt) {
      break;
    } else if (c.stuffToDo) {
      n64js.warn("Don't know how to handle this event!");
      break;
    }
  }
}

class FragmentMap {
  constructor() {
    this.kNumEntries = 16 * 1024;

    this.entries = [];
    for (let i = 0; i < this.kNumEntries; ++i) {
      this.entries.push(new Map());
    }
  }

  addressToCacheLine(address) {
    return Math.floor(address >>> 5);
  }

  addressToCacheLineRoundUp(address) {
    return Math.floor((address + 31) >>> 5);
  }

  add(pc, fragment) {
    const cacheLineIdx = this.addressToCacheLine(pc);
    const entryIdx = cacheLineIdx % this.entries.length;
    const entry = this.entries[entryIdx];
    entry.set(fragment.entryPC, fragment);
  }

  invalidateEntry(address) {
    const cacheLineIdx = this.addressToCacheLine(address);
    const entryIdx = cacheLineIdx % this.entries.length;
    const entry = this.entries[entryIdx];
    let removed = 0;

    for (const [i, fragment] of entry.entries()) {
      if (fragment.minPC <= address && fragment.maxPC > address) {
        fragment.invalidate();
        entry.delete(i);
        removed++;
      }
    }

    if (removed) {
      logger.log(`Fragment cache removed ${removed} entries.`);
    }

    // fragmentInvalidationEvents.push({'address': address, 'length': 0x20, 'system': 'CACHE', 'fragmentsRemoved': removed});
  }

  invalidateRange(address, length) {
    const minAddr = address;
    const maxAddr = address + length;
    const minPage = this.addressToCacheLine(minAddr);
    const maxPage = this.addressToCacheLineRoundUp(maxAddr);
    const entries = this.entries;
    let removed = 0;

    for (let cacheLineIdx = minPage; cacheLineIdx <= maxPage; ++cacheLineIdx) {
      const entryIdx = cacheLineIdx % entries.length;
      const entry = entries[entryIdx];

      for (const [i, fragment] of entry.entries()) {
        if (fragment.minPC <= maxAddr && fragment.maxPC > minAddr) {
          fragment.invalidate();
          entry.delete(i);
          removed++;
        }
      }
    }

    if (removed) {
      logger.log(`Fragment cache removed ${removed} entries.`);
    }

    // fragmentInvalidationEvents.push({'address': address, 'length': length, 'system': system, 'fragmentsRemoved': removed});
  }
}

const fragmentMap = new FragmentMap();

// Invalidate a single cache line
n64js.invalidateICacheEntry = function (address) {
  //logger.log('cache flush ' + toString32(address));

  fragmentMap.invalidateEntry(address);
};

// This isn't called right now. We
n64js.invalidateICacheRange = function (address, length, system) {
  //logger.log('cache flush ' + toString32(address) + ' ' + toString32(length));
  // FIXME: check for overlapping ranges

  // NB: not sure PI events are useful right now.
  if (system === 'PI') {
    return;
  }

  fragmentMap.invalidateRange(address, length);
};

function updateFragment(fragment, pc) {
  fragment.minPC = Math.min(fragment.minPC, pc);
  fragment.maxPC = Math.max(fragment.maxPC, pc + 4);

  fragmentMap.add(pc, fragment);
}

function checkEqual(a, b, m) {
  if (a !== b) {
    const msg = `${toString32(a)} !== ${toString32(b)} : ${m}`;
    console.assert(false, msg);
    n64js.halt(msg);
    return false;
  }
  return true;
}

n64js.checkSyncState = checkSyncState;    // Needs to be callable from dynarec

function generateCodeForOp(ctx) {
  ctx.needsDelayCheck = ctx.fragment.needsDelayCheck;
  ctx.isTrivial = false;

  let preflight = '';
  if (kValidateDynarecPCs) {
    const preflight = dedent(`
      if (c.pc != ${toString32(ctx.pc)}) {
        throw 'expected pc ${toString32(ctx.pc)}, got ' + c.pc;
      }
    `);
  }

  const fn_code = preflight + generateOp(ctx);

  if (ctx.dump) {
    console.log(fn_code);
  }

  // if (fn_code.indexOf('execute') >= 0 && fn_code.indexOf('executeCop1_disabled') < 0 ) {
  //   console.log('slow' + fn_code);
  // }

  // If the last op tried to delay updating the pc, see if it needs updating now.
  if (!ctx.isTrivial && ctx.delayedPCUpdate !== 0) {
    // TODO: add a template string function to dedent this.
    ctx.fragment.body_code += `// Applying delayed pc\nc.pc = ${toString32(ctx.delayedPCUpdate)};\n`;
    ctx.delayedPCUpdate = 0;
  }

  ctx.fragment.needsDelayCheck = ctx.needsDelayCheck;

  // code += `if (!checkEqual( loadS32slow(cpu0.pc >>> 0), ${toString32(instruction)}, "unexpected instruction (need to flush icache?)")) { return false; }\n`;

  ctx.fragment.bailedOut |= ctx.bailOut;

  const sync = n64js.getSyncFlow();
  if (sync) {
    fn_code = `if (!n64js.checkSyncState(sync, ${toString32(ctx.pc)})) { return ${ctx.fragment.opsCompiled}; }\n${fn_code}`;
  }

  const dasm = disassembleInstruction(ctx.pc, ctx.instruction);
  const lines = redentLines(fn_code, '  ');

  ctx.fragment.body_code += `// ${dasm.disassembly}
{
${lines}
}

`;
}

// Indents all lines to the provided indent, removing any empty lines.
function redentLines(code, indent) {
  // TODO: it would make more sense to dedent the literals where they're declared.
  const dedented = dedent(code);
  const lines = dedented.split('\n');
  const filtered = lines.filter(l => l != '');
  const indented = filtered.map(l => indent + l);
  return indented.join('\n');
}

function dedent(str) {
  str = str.replace(/^\n/, '');
  const match = str.match(/^\s+/);
  if (!match) {
    return str;
  }
  const prefix = match[0];
  return match ? str.replace(new RegExp('^' + prefix, 'gm'), '') : str;
}

function addNewlines(code) {
  if (!code.startsWith("\n")) {
    code = "\n" + code;
  }
  if (!code.endsWith("\n")) {
    code += "\n";
  }
  return code;
}

function generateOp(ctx) {
  const opcode = (ctx.instruction >>> 26) & 0x3f;
  const fn = simpleTableGen[opcode];
  return generateOpHelper(fn, ctx);
}

function generateSpecial(ctx) {
  const special_fn = ctx.instruction & 0x3f;
  const fn = specialTableGen[special_fn];
  return generateOpHelper(fn, ctx);
}

function generateRegImm(ctx) {
  const rt = (ctx.instruction >>> 16) & 0x1f;
  const fn = regImmTableGen[rt];
  return generateOpHelper(fn, ctx);
}

function generateCop0(ctx) {
  const fmt = (ctx.instruction >>> 21) & 0x1f;
  const fn = cop0TableGen[fmt];
  return generateOpHelper(fn, ctx);
}

// This takes a fn - either a string (in which case we generate some unoptimised boilerplate) or a function (which we call recursively)
function generateOpHelper(fn, ctx) {
  // fn can be a handler function, in which case defer to that.
  if (typeof fn === 'string') {
    //logger.log(fn);
    return generateGenericOpBoilerplate(`n64js.${fn}(${toString32(ctx.instruction)});\n`, ctx);
  } else {
    return fn(ctx);
  }
}

// Standard code for manipulating the pc
function generateStandardPCUpdate(fn, ctx, might_adjust_next_pc) {
  let code = '';
  code += ctx.genAssert(`c.pc === ${toString32(ctx.pc)}`, 'pc mismatch');

  if (ctx.needsDelayCheck) {
    // We should probably assert on this - two branch instructions back-to-back is weird, but the flag could just be set because of a generic op
    code += `if (c.delayPC) { c.nextPC = c.delayPC; c.delayPC = 0; } else { c.nextPC = ${toString32(ctx.pc + 4)}; }\n`;
    code += addNewlines(fn);
    code += 'c.pc = c.nextPC;\n';
  } else if (might_adjust_next_pc) {
    // If the branch op might manipulate nextPC, we need to ensure that it's set to the correct value
    code += ctx.genAssert('c.delayPC === 0', 'delay pc should be zero');
    code += `c.nextPC = ${toString32(ctx.pc + 4)};\n`;
    code += addNewlines(fn);
    code += 'c.pc = c.nextPC;\n';
  } else {
    code += ctx.genAssert('c.delayPC === 0', 'delay pc should be zero');
    code += addNewlines(fn);
    code += `c.pc = ${toString32(ctx.pc + 4)};\n`;
  }

  return code;
}

function generateGenericOpBoilerplate(fn, ctx) {
  let code = '';
  code += ctx.genAssert(`c.pc === ${toString32(ctx.pc)}`, 'pc mismatch');

  if (ctx.needsDelayCheck) {
    code += `c.nextPC = c.delayPC || ${toString32(ctx.pc + 4)};\n`;
  } else {
    code += ctx.genAssert('c.delayPC === 0', 'delay pc should be zero');
    code += `c.nextPC = ${toString32(ctx.pc + 4)};\n`;
  }
  code += 'c.branchTarget = 0;\n';
  code += addNewlines(fn);
  code += 'c.pc = c.nextPC;\n';
  code += 'c.delayPC = c.branchTarget;\n';

  // We don't know if the generic op set delayPC, so assume the worst.
  ctx.needsDelayCheck = true;

  if (accurateCountUpdating) {
    code += 'c.incrementCount(1);\n';
  }

  // If bailOut is set, always return immediately.
  if (ctx.bailOut) {
    code += `return ${ctx.fragment.opsCompiled};\n`;
  } else {
    code += `if (c.stuffToDo) { return ${ctx.fragment.opsCompiled}; }\n`;
    code += `if (c.pc !== ${toString32(ctx.postPC)}) { return ${ctx.fragment.opsCompiled}; }\n`;
  }

  return code;
}

// Memory access does not adjust branchTarget, but nextPC may be adjusted if they cause an exception.
function generateMemoryAccessBoilerplate(fn, ctx) {
  let code = '';

  const might_adjust_next_pc = true;
  code += generateStandardPCUpdate(fn, ctx, might_adjust_next_pc);

  // Memory instructions never cause a branch delay
  code += ctx.genAssert('c.delayPC === 0', 'delay pc should be zero');
  ctx.needsDelayCheck = false;

  if (accurateCountUpdating) {
    code += 'c.incrementCount(1);\n';
  }

  // If bailOut is set, always return immediately
  assert(!ctx.bailOut, "Not expecting bailOut to be set for memory access");
  code += `if (c.stuffToDo) { return ${ctx.fragment.opsCompiled}; }\n`;
  code += `if (c.pc !== ${toString32(ctx.postPC)}) { return ${ctx.fragment.opsCompiled}; }\n`;
  return code;
}

// Branch ops explicitly manipulate nextPC rather than branchTarget. They also guarantee that stuffToDo is not set.
// might_adjust_next_pc is typically used by branch likely instructions.
function generateBranchOpBoilerplate(fn, ctx, might_adjust_next_pc) {
  let code = '';

  // We only need to check for off-trace branches
  const need_pc_test = ctx.needsDelayCheck || might_adjust_next_pc || ctx.postPC !== ctx.pc + 4;

  code += generateStandardPCUpdate(fn, ctx, might_adjust_next_pc);

  // Branch instructions can always set a branch delay
  ctx.needsDelayCheck = true;

  if (accurateCountUpdating) {
    code += 'c.incrementCount(1);\n';
  }

  code += ctx.genAssert('c.stuffToDo === 0', 'stuffToDo should be zero');

  // If bailOut is set, always return immediately
  if (ctx.bailOut) {
    code += 'return ' + ctx.fragment.opsCompiled + ';\n';
  } else {
    if (need_pc_test) {
      code += `if (c.pc !== ${toString32(ctx.postPC)}) { return ${ctx.fragment.opsCompiled}; }\n`;
    } else {
      code += '// Skipping pc test\n';
    }
  }

  return code;
}

// Trivial ops can use this specialised handler which eliminates a lot of overhead.
// Trivial ops are defined as those which:
// Don't require cpu0.pc to be set correctly (required by branches, stuff that can throw exceptions for instance)
// Don't set cpu0.stuffToDo
// Don't set branchTarget
// Don't manipulate nextPC (e.g. ERET, cop1 unusable, likely instructions)

function generateTrivialOpBoilerplate(fn, ctx) {
  let code = '';

  // NB: trivial functions don't rely on pc being set up, so we perform the op before updating the pc.
  code += addNewlines(fn);

  ctx.isTrivial = true;

  if (accurateCountUpdating) {
    code += 'c.incrementCount(1);\n';
  }

  // NB: do delay handler after executing op, so we can set pc directly
  if (ctx.needsDelayCheck) {
    code += `if (c.delayPC) { c.pc = c.delayPC; c.delayPC = 0; } else { c.pc = ${toString32(ctx.pc + 4)}; }\n`;
    // Might happen: delay op from previous instruction takes effect
    code += `if (c.pc !== ${toString32(ctx.postPC)}) { return ${ctx.fragment.opsCompiled}; }\n`;
  } else {
    code += ctx.genAssert('c.delayPC === 0', 'delay pc should be zero');

    // We can avoid off-branch checks in this case.
    const expectedPC = ctx.pc + 4;
    if (ctx.postPC !== expectedPC) {
      assert("postPC should always be pc+4 for trival ops?");
      code += `c.pc = ${toString32(expectedPC)};\n`;
      code += `if (c.pc !== ${toString32(ctx.postPC)}) { return ${ctx.fragment.opsCompiled}; }\n`;
    } else {
      code += '// Delaying pc update\n';
      ctx.delayedPCUpdate = expectedPC;
      if (kValidateDynarecPCs) {
        code += `c.pc = ${toString32(expectedPC)};\n`;
      }
    }
  }

  // Trivial instructions never cause a branch delay
  code += ctx.genAssert('c.delayPC === 0', 'delay pc should be zero');
  ctx.needsDelayCheck = false;

  // Trivial instructions never cause stuffToDo to be set
  code += ctx.genAssert('c.stuffToDo === 0', 'stuffToDo should be zero');

  return code;
}

function generateNOPBoilerplate(comment, ctx) {
  return generateTrivialOpBoilerplate(`// ${comment}\n`, ctx);
}
