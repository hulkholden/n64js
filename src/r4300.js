/*jshint jquery:true, devel:true */
/*global n64js*/

import { assert } from './assert.js';
import * as cpu0reg from './cpu0reg.js';
import { simpleOp, regImmOp, specialOp, copOp, copFmtFuncOp, fd, fs, ft, offset, sa, rd, rt, rs, tlbop, imm, imms, base, jumpAddress } from './decode.js';
import { cop0ControlRegisterNames } from './disassemble.js';
import { EmulatedException } from './emulated_exception.js';
import { EventQueue } from './event_queue.js';
import { toString8, toString32, toString64 } from './format.js';
import { lookupFragment, resetFragments } from './fragments.js';
import * as logger from './logger.js';
import * as memaccess from './memaccess.js';
import { kAccurateCountUpdating, kSpeedHackEnabled } from './options.js';
import { FragmentContext, generateCodeForOp } from './recompiler.js';
import { rsp } from './rsp.js';
import { syncFlow } from './sync.js';

window.n64js = window.n64js || {};

// Expose the cpu state
export let cpu0;
export let cpu1;
export let cpu2;

export function initCPU(hardware) {
  cpu0 = hardware.cpu0;
  cpu1 = hardware.cpu1;
  cpu2 = hardware.cpu2;
  memaccess.reset(hardware, cpu0);

  // TODO: just use the exported value.
  n64js.cpu0 = cpu0;
}

const kDebugTLB = false;

const kFragmentLengthLimit = 250;

const UT_VEC          = 0x80000000;
const XUT_VEC         = 0x80000080;
const ECC_VEC         = 0x80000100;
const E_VEC           = 0x80000180;

export const SR_IE           = 0x00000001;
export const SR_EXL          = 0x00000002;
export const SR_ERL          = 0x00000004;
export const SR_KSU_KER      = 0x00000000;
export const SR_KSU_SUP      = 0x00000008;
export const SR_KSU_USR      = 0x00000010;
export const SR_KSU_MASK     = 0x00000018;
export const SR_UX           = 0x00000020;
export const SR_SX           = 0x00000040;
export const SR_KX           = 0x00000080;

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

// Only the software interrupt values are writeable.
const causeWritableBits = BigInt(CAUSE_SW1 | CAUSE_SW2);

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

const kEventCompare = 'Compare';
const kEventRunForCycles = 'Run For Cycles';

// TODO: figure out what masking and shifting constants this should use.
function getAddress32VPN2(address) { return (address >>> 13); }
function getAddress64VPN2(address) { return (address & TLBHI_VPN2MASK) >> TLBHI_VPN2SHIFT; }
function getAddress64R(address) { return (address & TLBHI_RMASK) >> TLBHI_RSHIFT; }

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
      logger.log(`TLB update: index=${index}, pagemask=${toString32(pagemask)}, entryhi=${toString64(hi)}, entrylo0=${toString32(entrylo0)}, entrylo1=${toString32(entrylo1)}`);
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

export class CPU0 {
  constructor(hardware) {
    this.hardware = hardware;
    this.opsExecuted = 0; // Approximate...

    this.ramDV = hardware.cachedMemDevice.mem.dataView;

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
    // This tracks the number of instructions executed.
    // Reads from the COUNT register return half this value
    // (i.e. COUNT increments by 1 for every 2 instructions executed).
    this.controlCountValue = 0;

    // Reads from invalid control registers will use the value last written to any control register.
    this.lastControlRegWrite = 0n;

    this.pc = 0;
    this.delayPC = 0;
    this.nextPC = 0; // Set to the next expected PC before an op executes. Ops can update this to change control flow without branch delay (e.g. likely branches, ERET)
    this.branchTarget = 0; // Set to indicate a branch has been taken. Sets the delayPC for the subsequent op.

    this.llBit = 0;  // Load Linked bit.

    this.stuffToDo = 0; // used to flag r4300 to cease execution

    this.eventQueue = new EventQueue();

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

    this.reset();
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

  getOpsExecuted() {
    // Return the raw value (COUNT increments every 2 ops).
    return this.controlCountValue;
  }

  incrementCount(val) {
    this.controlCountValue += val;
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

    this.eventQueue.reset();

    this.multLoU32[0] = this.multLoU32[1] = 0;
    this.multHiU32[0] = this.multHiU32[1] = 0;

    this.setControlU32(cpu0reg.controlRand, 32 - 1);
    this.setControlU32(cpu0reg.controlStatus, 0x70400004);
    this.setControlU32(cpu0reg.controlConfig, 0x7006e463);

    this.cop1ControlChanged();
  }

  cop1ControlChanged() {
    const control = this.getControlU32(cpu0reg.controlStatus);
    const enable = (control & SR_CU1) !== 0;
    simpleTable[0x11] = enable ? executeCop1 : executeCop1_disabled;

    // TODO: this is a bit gross. Maybe there could be a shared register set and both CPU0 and CPU1 have a view?
    if (this.hardware.cpu1) {
      this.hardware.cpu1.fullMode = (control & SR_FR) !== 0;
    }
  }

  /**
   * Moves the software-provided value to the control register, obeying masking.
   * @param {number} controlReg The control register to update.
   * @param {bigint} newValue The value to set.
   */
  moveToControl(controlReg, newValue) {
    this.lastControlRegWrite = newValue;

    switch (controlReg) {
      case cpu0reg.controlIndex:
        this.setControlU64(controlReg, newValue & indexWritableBits);
        break;

      case cpu0reg.controlEntryLo0:
      case cpu0reg.controlEntryLo1:
        this.setControlU64(controlReg, newValue & entryLoWritableBits);
        break;

      case cpu0reg.controlContext:
        this.setControlU64(controlReg, newValue & contextWriteableBits);
        break;

      case cpu0reg.controlPageMask:
        this.setControlU64(controlReg, newValue & pageMaskWritableBits);
        break;

      case cpu0reg.controlWired:
        this.setControlU64(controlReg, newValue & wiredWritableBits);
        // Set to top limit on write to wired
        this.setControlU64(cpu0reg.controlRand, 31n);
        break;

      case cpu0reg.controlEntryHi:
        this.setControlU64(controlReg, newValue & entryHiWritableBits);
        break;

      case cpu0reg.controlRand:
      case cpu0reg.controlBadVAddr:
      case cpu0reg.controlPRId:
      case cpu0reg.controlCacheErr:
        // All these registers are read-only
        break;

      case cpu0reg.controlConfig:
        this.maskControlBits64(controlReg, configWritableBits, newValue);
        break;

      case cpu0reg.controlCause:
        logger.log(`Setting cause register to ${toString32(newValue)}`);
        n64js.check(newValue === 0, 'Should only write 0 to Cause register.');
        this.maskControlBits64(controlReg, causeWritableBits, newValue);
        break;

      case cpu0reg.controlStatus:
        this.setControlU64(controlReg, newValue & statusWritableBits);
        this.statusRegisterChanged();
        break;
      case cpu0reg.controlCount:
        this.controlCountValue = Number(newValue) * 2;
        break;
      case cpu0reg.controlCompare:
        this.setCompare(Number(newValue & 0xffff_ffffn));
        break;

      case cpu0reg.controlXContext:
        this.maskControlBits64(controlReg, xContextWritableBits, newValue);
        break;

      case cpu0reg.controlEPC:
      case cpu0reg.controlTagLo:
      case cpu0reg.controlTagHi:
        this.setControlU64(controlReg, newValue);
        break;

      case cpu0reg.controlLLAddr:
        this.maskControlBits64(controlReg, llAddrWritableBits, newValue);
        break;

      case cpu0reg.controlInvalid7:
      case cpu0reg.controlInvalid21:
      case cpu0reg.controlInvalid22:
      case cpu0reg.controlInvalid23:
      case cpu0reg.controlInvalid24:
      case cpu0reg.controlInvalid25:
      case cpu0reg.controlInvalid31:
        // Ignore writes.
        // Reads from invalid control registers will use the value last written to any control register.
        break;

      case cpu0reg.controlParityError:
        this.setControlU64(controlReg, newValue & eccWritableBits);
        break;

      case cpu0reg.controlErrorEPC:
        this.setControlU64(controlReg, newValue);
        break;

      default:
        this.setControlU64(controlReg, newValue);
        logger.log(`Write to cpu0 control register. ${toString64(newValue)} --> ${cop0ControlRegisterNames[controlReg]}`);
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
    if (controlReg === cpu0reg.controlCause) {
      this.checkCauseIP3Consistent();
    }

    switch (controlReg) {
      case cpu0reg.controlRand:
        return BigInt(this.getRandom());
      case cpu0reg.controlInvalid7:
      case cpu0reg.controlInvalid21:
      case cpu0reg.controlInvalid22:
      case cpu0reg.controlInvalid23:
      case cpu0reg.controlInvalid24:
      case cpu0reg.controlInvalid25:
      case cpu0reg.controlInvalid31:
        // Reads from invalid control registers will use the value last written to any control register.
        return this.lastControlRegWrite;
      case cpu0reg.controlCount:
        // COUNT increments by 1 for every 2 ops executed.
        return BigInt(this.controlCountValue) >> 1n;
      default:
        return this.getControlU64(controlReg);
    }
  }

  breakExecution() {
    this.stuffToDo |= kStuffToDoHalt;
  }

  run(cycles) {
    this.stuffToDo &= ~kStuffToDoHalt;

    this.checkCauseIP3Consistent();
    n64js.hardware().checkSIStatusConsistent();

    this.addRunForCyclesEvent(cycles);

    while (this.hasEvent(kEventRunForCycles)) {
      try {
        // NB: the bulk of run() is implemented as a separate function.
        // v8 won't optimise code with try/catch blocks, so structuring the code in this way allows runImpl to be optimised.
        this.runImpl();
        break;
      } catch (e) {
        if (e instanceof EmulatedException) {
          // If we hit an emulated exception we apply the nextPC (which should have been set to an exception vector) and continue looping.
          this.handleEmulatedException();
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
    let cyclesRemaining = this.removeEvent(kEventRunForCycles);

    // If the event no longer exists, assume we've executed all the cycles
    if (cyclesRemaining < 0) {
      cyclesRemaining = 0;
    }
    if (cyclesRemaining < cycles) {
      this.opsExecuted += cycles - cyclesRemaining;
    }
  }

  runImpl() {
    const eventQueue = this.eventQueue;

    while (this.hasEvent(kEventRunForCycles)) {
      let fragment = lookupFragment(this.pc);

      while (!this.stuffToDo) {

        if (fragment && fragment.func) {
          fragment = executeFragment(fragment, this, eventQueue);
        } else {
          // if (syncFlow) {
          //   if (!checkSyncState(syncFlow, this.pc)) {
          //     n64js.halt('sync error');
          //     break;
          //   }
          // }

          rsp.step();
          if (this.stuffToDo) {
            // RSP can generate interrupt which can be cleared by CPU.
            // TODO: for performance we should throw an exception when
            // an interrupt is raised and avoid testing this every instruction.
            break;
          }

          // Take a copy of this, so we can refer to it later.
          const pc = this.pc;
          // Signed copy of the program counter so we can do fast memory lookups.
          const signedPC = this.pc | 0;   

          // NB: set nextPC before the call to readMemoryS32. If this throws an exception, we need nextPC to be set up correctly.
          this.nextPC = this.delayPC || this.pc + 4;

          // The load may raise an EmulatedException either via alignment or TLB exceptions.
          let instruction = memaccess.loadU32fast(signedPC);

          this.branchTarget = 0;
          executeOp(instruction);

          this.pc = this.nextPC;
          this.delayPC = this.branchTarget;
          this.incrementCount(1);
          //this.checkCauseIP3Consistent();
          //n64js.hardware().checkSIStatusConsistent();

          eventQueue.incrementCount(1);

          // If we have a fragment, we're assembling code as we go
          if (fragment) {
            fragment = addOpToFragment(fragment, pc, instruction, this);
          } else {
            // If there's no current fragment and we branch backwards, this is possibly a new loop
            if (this.pc < pc) {
              fragment = lookupFragment(this.pc);
            }
          }
        }
      }

      this.stuffToDo &= ~kStuffToDoBreakout;

      if (this.stuffToDo & kStuffToDoCheckInterrupts) {
        this.stuffToDo &= ~kStuffToDoCheckInterrupts;
        this.handleInterrupt();
      } else if (this.stuffToDo & kStuffToDoHalt) {
        break;
      } else if (this.stuffToDo) {
        n64js.warn("Don't know how to handle this event!");
        break;
      }
    }
  }

  handleEmulatedException() {
    this.pc = this.nextPC;
    this.delayPC = 0;
    this.branchTarget = 0;
    this.incrementCount(1);
    this.eventQueue.incrementCount(1);
  }

  speedHack() {
    if (!rsp.halted) {
      return;
    }
    const nextInstruction = n64js.hardware().memMap.readMemoryInternal32(this.pc + 4);
    if (nextInstruction !== 0) {
      return;
    }

    // Ignore the kEventRunForCycles event.
    const runCountdown = this.removeEvent(kEventRunForCycles);

    // We should always have at least one event, but double-check this.
    const toSkip = this.eventQueue.skipToNextEvent(1);
    this.controlCountValue += toSkip;
    // logger.log(`speedhack: skipping ${toSkip} cycles - run is ${runCountdown}`);

    // Re-add the kEventRunForCycles event
    if (runCountdown >= 0) {
      this.addRunForCyclesEvent(runCountdown);
    }
  }

  updateCause3() {
    const miRegDevice = n64js.hardware().miRegDevice;
    if (miRegDevice.interruptsUnmasked()) {
      this.setControlBits32(cpu0reg.controlCause, CAUSE_IP3);
      this.updateStuffToDoForInterrupts();
    } else {
      this.clearControlBits32(cpu0reg.controlCause, CAUSE_IP3);
    }

    this.checkCauseIP3Consistent();
  }

  checkCauseIP3Consistent() {
    const miRegDevice = n64js.hardware().miRegDevice;
    const miIntr = miRegDevice.interruptsUnmasked();
    const causeIP3 = (this.getControlU32(cpu0reg.controlCause) & CAUSE_IP3) !== 0;
    assert(miIntr === causeIP3, `CAUSE_IP3 ${causeIP3} inconsistent with MI_INTR_REG ${miIntr}`);
  }

  statusRegisterChanged() {
    this.cop1ControlChanged();
    this.updateStuffToDoForInterrupts();
  }

  checkForUnmaskedInterrupts() {
    const sr = this.getControlU32(cpu0reg.controlStatus);

    // Ensure ERL/EXL are clear and IE is set
    if ((sr & (SR_EXL | SR_ERL | SR_IE)) === SR_IE) {
      // Check if interrupts are actually pending, and wanted
      const cause = this.getControlU32(cpu0reg.controlCause);
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
    this.setControlU64(cpu0reg.controlBadVAddr, address64);
  }

  setContext(address64) {
    const address32 = Number(address64 & 0xffffffffn);
    const context = getAddress32VPN2(address32) << TLBCTXT_VPNSHIFT;
    this.maskControlBits32(cpu0reg.controlContext, TLBCTXT_VPNMASK, context);
  }

  setXContext(address64) {
    const xcontext = (getAddress64VPN2(address64) << xContextBadVPN2Shift) | (getAddress64R(address64) << xContextRShift);
    const xContextMask = xContextBadVPN2Mask | xContextRMask;
    this.maskControlBits64(cpu0reg.controlXContext, xContextMask, xcontext);
  }

  checkCopXUsable(copIdx) {
    // TODO: this probably needs to throw a JS exception which is caught in `run`.
    // to ensure bookkeeping (like updating the delayPC) isn't run.
    const bit = 1 << (SR_CUSHIFT + copIdx);
    const usable = (this.getControlU32(cpu0reg.controlStatus) & bit) != 0;
    if (!usable) {
      this.raiseCopXUnusable(copIdx);
      return false;
    }
    return true;
  }

  maybeRaiseTRAPException(cond) {
    if (cond) {
      this.raiseTRAPException();
    }
  }

  raiseCopXUnusable(copIdx) { this.raiseExceptionCopCode(E_VEC, copIdx, cpu0reg.causeExcCodeCpU); }
  raiseSYSCALLException() { this.raiseExceptionCopCode(E_VEC, 0, cpu0reg.causeExcCodeSys); }
  raiseBREAKException() { this.raiseExceptionCopCode(E_VEC, 0, cpu0reg.causeExcCodeBp); }
  raiseRESERVEDException(copIdx) { this.raiseExceptionCopCode(E_VEC, copIdx, cpu0reg.causeExcCodeRI); }
  raiseTRAPException() { this.raiseExceptionCopCode(E_VEC, 0, cpu0reg.causeExcCodeTr); }
  raiseOverflowException() { this.raiseExceptionCopCode(E_VEC, 0, cpu0reg.causeExcCodeOv); }
  raiseFPE() { this.raiseExceptionCopCode(E_VEC, 0, cpu0reg.causeExcCodeFPE); }

  raiseAdELException(address32) { this.raiseAddressException(E_VEC, cpu0reg.causeExcCodeAdEL, address32); }
  raiseAdESException(address32) { this.raiseAddressException(E_VEC, cpu0reg.causeExcCodeAdES, address32); }

  raiseTLBException(vec, excCode, address32) {
    // TODO: plumb 64 bit addresses everywhere.
    const address64 = BigInt(address32 >> 0);
    this.setBadVAddr(address64);
    this.setContext(address64);
    this.setXContext(address64);
    this.maskControlBits64(cpu0reg.controlEntryHi, TLBHI_VPN2MASK, address64);
    this.raiseExceptionCopCode(vec, 0, excCode);
  }

  raiseAddressException(vec, code, address32) {
    // TODO: plumb 64 bit addresses everywhere.
    const address64 = BigInt(address32 >> 0);
    this.setBadVAddr(address64);
    this.setContext(address64);
    this.setXContext(address64);
    this.raiseExceptionCopCode(vec, 0, code);
  }

  raiseExceptionCopCode(vec, copIdx, excCode) {
    const mask = CAUSE_EXCMASK | CAUSE_CEMASK;
    const code = excCode << cpu0reg.causeExcShift;
    const ce = copIdx << CAUSE_CESHIFT;
    this.raiseException(mask, code | ce, vec);
  }

  raiseException(mask, exception, excVec) {
    this.maskControlBits32(cpu0reg.controlCause, mask, exception);
    this.setControlBits32(cpu0reg.controlStatus, SR_EXL);

    if (this.delayPC) {
      this.setControlBits32(cpu0reg.controlCause, CAUSE_BD);
      this.setControlS32Extend(cpu0reg.controlEPC, this.pc - 4);
    } else {
      this.clearControlBits32(cpu0reg.controlCause, CAUSE_BD);
      this.setControlS32Extend(cpu0reg.controlEPC, this.pc);
    }
    this.nextPC = excVec;
  }

  handleInterrupt() {
    if (this.checkForUnmaskedInterrupts()) {
      this.raiseException(CAUSE_EXCMASK, cpu0reg.causeExcCodeInt << cpu0reg.causeExcShift, E_VEC);
      // This is handled outside of the main dispatch loop, so need to update pc directly.
      this.pc = E_VEC;
      this.delayPC = 0;

    } else {
      assert(false, "Was expecting an unmasked interrupt - something wrong with kStuffToDoCheckInterrupts?");
    }
  }

  setCompare(value) {
    this.clearControlBits32(cpu0reg.controlCause, CAUSE_IP8);

    if (value === this.getControlU32(cpu0reg.controlCompare)) {
      // Just clear the IP8 flag if the same value is being written back
      // (don't update the events).
    } else {
      // NB: divide by two rather than shifting to preserve bit 32 (discarded with a shift).
      const count = (this.controlCountValue / 2) >> 0;
      const delta = (value - count) >>> 0;
      this.removeEvent(kEventCompare);
      this.addCompareEvent(delta);
      this.setControlU32(cpu0reg.controlCompare, value);
    }
  }

  // Provide some wrappers to the event queue.
  addEvent(type, cycles, handler) { return this.eventQueue.addEvent(type, cycles, handler); }
  removeEvent(type) { return this.eventQueue.removeEvent(type); }
  getCyclesUntilEvent(type) { return this.eventQueue.getCyclesUntilEvent(type); }
  hasEvent(type) { return this.eventQueue.hasEvent(type); }

  addCompareEvent(cycles) {
    const that = this;
    this.addEvent(kEventCompare, cycles, () => {
      that.setControlBits32(cpu0reg.controlCause, CAUSE_IP8);
      that.updateStuffToDoForInterrupts();
    });
  }

  addRunForCyclesEvent(cycles) {
    const that = this;
    this.addEvent(kEventRunForCycles, cycles, () => {
      that.stuffToDo |= kStuffToDoBreakout;
    });
  }

  getRandom() {
    // If wired >=32 values in the range [0,64) are returned, else [wired, 32)
    const wired = this.getControlU32(cpu0reg.controlWired);
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
    const pagemask = this.getControlU32(cpu0reg.controlPageMask);
    const entryhi = this.getControlU64(cpu0reg.controlEntryHi);
    const entrylo1 = this.getControlU32(cpu0reg.controlEntryLo1);
    const entrylo0 = this.getControlU32(cpu0reg.controlEntryLo0);

    this.tlbEntries[index].update(index, pagemask, entryhi, entrylo0, entrylo1);
  }

  tlbWriteIndex() {
    this.setTLB(this.getControlU32(cpu0reg.controlIndex));
  }

  tlbWriteRandom() {
    this.setTLB(this.getRandom());
  }

  tlbRead() {
    const index = this.getControlU32(cpu0reg.controlIndex) & 0x1f;
    const tlb = this.tlbEntries[index];

    // TODO: can hiMask be simplified (perhaps bake the mask into the tlb.hi value)?
    // TODO: Why does the pfn mask not seem to match TLBLO_PFNMASK? Is ultra header buggy?
    const hiMask = (TLBHI_RMASK | TLBHI_VPN2MASK | TLBHI_PIDMASK) & BigInt(~tlb.pagemask);
    const pfnMask = 0x03ff_ffff;

    this.setControlU32(cpu0reg.controlPageMask, tlb.pagemask);
    this.setControlU64(cpu0reg.controlEntryHi, tlb.hi & hiMask);
    this.setControlU32(cpu0reg.controlEntryLo0, tlb.pfne & pfnMask);
    this.setControlU32(cpu0reg.controlEntryLo1, tlb.pfno & pfnMask);

    if (kDebugTLB) {
      logger.log('TLB Read Index ' + toString8(index) + '.');
      logger.log('  PageMask: ' + toString32(this.getControlU32(cpu0reg.controlPageMask)));
      logger.log('  EntryHi:  ' + toString64(this.getControlU64(cpu0reg.controlEntryHi)));
      logger.log('  EntryLo0: ' + toString32(this.getControlU32(cpu0reg.controlEntryLo0)));
      logger.log('  EntryLo1: ' + toString32(this.getControlU32(cpu0reg.controlEntryLo1)));
    }
  }

  tlbProbe() {
    const entryHi = this.getControlU64(cpu0reg.controlEntryHi);
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
      this.setControlU32(cpu0reg.controlIndex, i);
      return;
    }

    if (kDebugTLB) {
      logger.log('TLB Probe. EntryHi:' + toString32(entryHi) + ". Didn't find matching entry");
    }
    this.setControlU32(cpu0reg.controlIndex, TLBINX_PROBE);
  }

  tlbFindEntry(address) {
    const entryHi = this.getControlU64(cpu0reg.controlEntryHi);
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
      this.raiseTLBException(UT_VEC, cpu0reg.causeExcCodeTLBL, address);
      throw new EmulatedException('TLBL UT_VEC');
    }

    const odd = address & tlb.checkbit;
    const entryLo = odd ? tlb.pfno : tlb.pfne;
    if ((entryLo & TLBLO_V) === 0) {
      this.raiseTLBException(E_VEC, cpu0reg.causeExcCodeTLBL, address);
      throw new EmulatedException('TLBL E_VEC');
    }

    const phys = odd ? tlb.physOdd : tlb.physEven;
    const offset = address & tlb.offsetMask;
    return phys | offset;
  }

  translateWrite(address) {
    const tlb = this.tlbFindEntry(address);
    if (!tlb) {
      this.raiseTLBException(UT_VEC, cpu0reg.causeExcCodeTLBS, address);
      throw new EmulatedException('TLBS UT_VEC');
    }

    const odd = address & tlb.checkbit;
    const entryLo = odd ? tlb.pfno : tlb.pfne;
    if ((entryLo & TLBLO_V) === 0) {
      this.raiseTLBException(E_VEC, cpu0reg.causeExcCodeTLBS, address);
      throw new EmulatedException('TLBS E_VEC');
    }
    if ((entryLo & TLBLO_D) === 0) {
      this.raiseTLBException(E_VEC, cpu0reg.causeExcCodeMod, address);
      throw new EmulatedException('Mod E_VEC');
    }

    const phys = odd ? tlb.physOdd : tlb.physEven;
    const offset = address & tlb.offsetMask;
    return phys | offset;
  }

  unalignedLoad(address) {
    this.raiseAdELException(address);
    throw new EmulatedException('AdEL load');
  }

  unalignedStore(address) {
    this.raiseAdESException(address);
    throw new EmulatedException('AdES store');
  }

  execBreakpoint() {
    // NB: throw here so that we don't execute the op.
    throw new BreakpointException();
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

  execRESERVED(copIdx) { this.raiseRESERVEDException(copIdx); }
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

  calcDebuggerAddress(inst) {
    return this.addrS32(base(inst), imms(inst));
  }

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

  execLWC1(rt, base, imms) {
    if (!this.checkCopXUsable(1)) { return; }
    cpu1.store32(cpu1.copRegIdx32(rt), memaccess.loadS32fast(this.addrS32(base, imms)));
  }

  execLWC2(rt, base, imms) {
    if (!this.checkCopXUsable(2)) { return; }
    this.unimplemented(this.pc, 'LWC2');
  }

  execLWC3(rt, base, imms) {
    if (!this.checkCopXUsable(3)) { return; }
    this.unimplemented(this.pc, 'LWC3');
  }

  execLDC1(rt, base, imms) {
    if (!this.checkCopXUsable(1)) { return; }
    const value = memaccess.loadU64fast(this.addrS32(base, imms));
    cpu1.store64(cpu1.copRegIdx64(rt), value);
  }

  execLDC2(rt, base, imms) {
    if (!this.checkCopXUsable(2)) { return; }
    this.unimplemented(this.pc, 'LDC2');
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

  execSWC1(rt, base, imms) {
    if (!this.checkCopXUsable(1)) { return; }
    memaccess.store32fast(this.addrS32(base, imms), cpu1.loadU32(cpu1.copRegIdx32(rt)));
  }

  execSWC2(rt, base, imms) {
    if (!this.checkCopXUsable(2)) { return; }
    this.unimplemented(this.pc, 'SWC2');
  }

  execSWC3(rt, base, imms) {
    if (!this.checkCopXUsable(3)) { return; }
    this.unimplemented(this.pc, 'SWC3');
  }

  execSDC1(rt, base, imms) {
    if (!this.checkCopXUsable(1)) { return; }
    memaccess.store64fast(this.addrS32(base, imms), cpu1.loadU64(cpu1.copRegIdx64(rt)));
  }

  execSDC2(rt, base, imms) {
    if (!this.checkCopXUsable(2)) { return; }
    this.unimplemented(this.pc, 'SDC2');
  }

  execLL(rt, base, imms) {
    const addr = this.addrS32(base, imms);
    this.setControlU32(cpu0reg.controlLLAddr, makeLLAddr(addr));
    this.setRegS32Extend(rt, memaccess.loadS32fast(addr));
    this.llBit = 1;
  }

  execLLD(rt, base, imms) {
    const addr = this.addrS32(base, imms);
    this.setControlU32(cpu0reg.controlLLAddr, makeLLAddr(addr));
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
      fragmentMap.invalidateEntry(this.addrU32(base, imms));
    }
  }

  ignoreCacheOp(cacheOp) {
    const cache = cacheOp & 0x3;
    const action = (cacheOp >>> 2) & 0x7;
    return cache !== 0 || (action !== 0 && action !== 4);
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
    this.setRegS32Extend(cpu0reg.RA, this.nextPC + 4);
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

    if (kSpeedHackEnabled && cond && offset === -1) {
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
    this.setRegS32Extend(cpu0reg.RA, this.nextPC + 4);
    this.conditionalBranch(cond, offset);
  }

  execBGEZAL(rs, offset) {
    const cond = this.getRegS64(rs) >= 0n;
    this.setRegS32Extend(cpu0reg.RA, this.nextPC + 4);
    this.conditionalBranch(cond, offset);
  }

  execBLTZALL(rs, offset) {
    const cond = this.getRegS64(rs) < 0n;
    this.setRegS32Extend(cpu0reg.RA, this.nextPC + 4);
    this.conditionalBranchLikely(cond, offset);
  }

  execBGEZALL(rs, offset) {
    const cond = this.getRegS64(rs) >= 0n;
    this.setRegS32Extend(cpu0reg.RA, this.nextPC + 4);
    this.conditionalBranchLikely(cond, offset);
  }

  // Cop0
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
    if (this.getControlU32(cpu0reg.controlStatus) & SR_ERL) {
      this.nextPC = this.getControlU32(cpu0reg.controlErrorEPC);
      this.clearControlBits32(cpu0reg.controlStatus, SR_ERL);
      logger.log(`ERET from error trap - ${toString32(this.nextPC)}`);
    } else {
      this.nextPC = this.getControlU32(cpu0reg.controlEPC);
      this.clearControlBits32(cpu0reg.controlStatus, SR_EXL);
      //logger.log(`ERET from interrupt/exception ${toString32(this.nextPC)}`);
    }
    this.llBit = 0;
  }

  // Cop1
  execMFC1(rt, fs) { this.setRegS32Extend(rt, cpu1.loadS32(cpu1.copRegIdx32(fs))); }
  execDMFC1(rt, fs) { this.setRegU64(rt, cpu1.loadU64(cpu1.copRegIdx64(fs))); }
  execMTC1(rt, fs) { cpu1.store32(cpu1.copRegIdx32(fs), this.getRegS32Lo(rt)); }
  execDMTC1(rt, fs) { cpu1.store64(cpu1.copRegIdx64(fs), this.getRegS64(rt)); }

  execCFC1(rt, fs) {
    switch (fs) {
      case 0:
      case 31:
        this.setRegS32Extend(rt, cpu1.control[fs]);
        break;
    }
  }

  execCTC1(rt, fs) {
    if (fs === 31) {
      cpu1.setStatus(this.getRegU32Lo(rt));
    }
  }

  execDCFC1(rt, fs) { cpu1.DCFC1(rt, fs); }
  execDCTC1(rt, fs) { cpu1.DCTC1(fs, rt); }

  // Cop2
  execMFC2(rt) {
    if (!this.checkCopXUsable(2)) { return; }
    this.setRegS32Extend(rt, cpu2.getReg32());
  }

  execDMFC2(rt) {
    if (!this.checkCopXUsable(2)) { return; }
    this.setRegU64(rt, cpu2.getReg64());
  }

  execCFC2(rt) {
    if (!this.checkCopXUsable(2)) { return; }
    this.setRegS32Extend(rt, cpu2.getReg32());
  }

  execDCFC2(rt) {
    if (!this.checkCopXUsable(2)) { return; }
    this.raiseRESERVEDException(2);
  }

  execMTC2(rt) {
    if (!this.checkCopXUsable(2)) { return; }
    cpu2.setReg64(this.getRegU64(rt));
  }

  execDMTC2(rt) {
    if (!this.checkCopXUsable(2)) { return; }
    cpu2.setReg64(this.getRegU64(rt));
  }

  execCTC2(rt) {
    if (!this.checkCopXUsable(2)) { return; }
    cpu2.setReg64(this.getRegU64(rt));
  }

  execDCTC2(rt) {
    if (!this.checkCopXUsable(2)) { return; }
    this.raiseRESERVEDException(2);
  }

  unimplemented(pc, name) {
    n64js.warn(`${pc}: ${name} is unimplemented`)
  }
}


export class CPU2 {
  constructor(hardware) {
    // Provide state for a single 64 bit register.
    this.hardware = hardware;
    const buf = new ArrayBuffer(8);
    this.regU32 = new Uint32Array(buf);
    this.regU64 = new BigUint64Array(buf);
  }

  reset() {
    this.regU64[0] = 0n;
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

function executeUnknown(i) {
  throw `CPU: unknown op, pc: ${toString32(cpu0.pc)}, instruction: ${toString32(i)}`;
}

/**
 * @constructor
 */
function BreakpointException() {
}

// TODO: move this somewhere central.
function physicalAddress(addr) {
  return addr & (~0xe0000000)
}

function makeLLAddr(sAddr) {
  return physicalAddress(sAddr >>> 0) >>> 4;
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

function executeSpecial(i) {
  specialTable[specialOp(i)](i);
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
  i => cpu0.execMFC0(rt(i), fs(i)),
  i => cpu0.execDMFC0(rt(i), fs(i)),
  executeUnknown,
  executeUnknown,
  i => cpu0.execMTC0(rt(i), fs(i)),
  i => cpu0.execDMTC0(rt(i), fs(i)),
  executeUnknown,
  executeUnknown,

  executeUnknown,
  executeUnknown,
  executeUnknown,
  executeUnknown,
  executeUnknown,
  executeUnknown,
  executeUnknown,
  executeUnknown,

  i => cpu0.execTLB(tlbop(i)),
  executeUnknown,
  executeUnknown,
  executeUnknown,
  executeUnknown,
  executeUnknown,
  executeUnknown,
  executeUnknown,

  executeUnknown,
  executeUnknown,
  executeUnknown,
  executeUnknown,
  executeUnknown,
  executeUnknown,
  executeUnknown,
  executeUnknown
]);

function executeCop0(i) {
  cop0Table[copOp(i)](i);
}

const cop1Table = validateCopOpTable([
  i => cpu0.execMFC1(rt(i), fs(i)),
  i => cpu0.execDMFC1(rt(i), fs(i)),
  i => cpu0.execCFC1(rt(i), fs(i)),
  i => cpu0.execDCFC1(rt(i), fs(i)),
  i => cpu0.execMTC1(rt(i), fs(i)),
  i => cpu0.execDMTC1(rt(i), fs(i)),
  i => cpu0.execCTC1(rt(i), fs(i)),
  i => cpu0.execDCTC1(rt(i), fs(i)),

  executeBCInstr,
  executeUnknown,
  executeUnknown,
  executeUnknown,
  executeUnknown,
  executeUnknown,
  executeUnknown,
  executeUnknown,

  i => cpu1.execSInstr(copFmtFuncOp(i), fd(i), fs(i), ft(i)),
  i => cpu1.execDInstr(copFmtFuncOp(i), fd(i), fs(i), ft(i)),
  executeUnknown,
  executeUnknown,
  i => cpu1.execWInstr(copFmtFuncOp(i), fd(i), fs(i), ft(i)),
  i => cpu1.execLInstr(copFmtFuncOp(i), fd(i), fs(i), ft(i)),
  executeUnknown,
  executeUnknown,

  executeUnknown,
  executeUnknown,
  executeUnknown,
  executeUnknown,
  executeUnknown,
  executeUnknown,
  executeUnknown,
  executeUnknown,
]);

function executeCop1(i) {
  //assert( (cpu0.getControlU32(cpu0reg.controlSR) & SR_CU1) !== 0, "SR_CU1 in inconsistent state" );
  cop1Table[copOp(i)](i);
}

const cop2Table = validateCopOpTable([
  i => cpu0.execMFC2(rt(i)),
  i => cpu0.execDMFC2(rt(i)),
  i => cpu0.execCFC2(rt(i)),
  i => cpu0.execDCFC2(rt(i)),
  i => cpu0.execMTC2(rt(i)),
  i => cpu0.execDMTC2(rt(i)),
  i => cpu0.execCTC2(rt(i)),
  i => cpu0.execDCTC2(rt(i)),

  executeUnknown,
  executeUnknown,
  executeUnknown,
  executeUnknown,
  executeUnknown,
  executeUnknown,
  executeUnknown,
  executeUnknown,

  executeUnknown,
  executeUnknown,
  executeUnknown,
  executeUnknown,
  executeUnknown,
  executeUnknown,
  executeUnknown,
  executeUnknown,

  executeUnknown,
  executeUnknown,
  executeUnknown,
  executeUnknown,
  executeUnknown,
  executeUnknown,
  executeUnknown,
  executeUnknown,
]);

function executeCop2(i) {
  cop2Table[copOp(i)](i);
}

function executeCop3(i) {
  cpu0.raiseRESERVEDException(0);
}

function executeCop1_disabled(i) {
  assert((cpu0.getControlU32(cpu0reg.controlStatus) & SR_CU1) === 0, "SR_CU1 in inconsistent state");

  cpu0.raiseCopXUnusable(1);
}
n64js.executeCop1_disabled = executeCop1_disabled;

function validateRegImmOpTable(cases) {
  if (cases.length != 32) {
    throw "RegImm table is unexpected size.";
  }
  return cases;
}

const regImmTable = validateRegImmOpTable([
  i => cpu0.execBLTZ(rs(i), offset(i)),
  i => cpu0.execBGEZ(rs(i), offset(i)),
  i => cpu0.execBLTZL(rs(i), offset(i)),
  i => cpu0.execBGEZL(rs(i), offset(i)),
  executeUnknown,
  executeUnknown,
  executeUnknown,
  executeUnknown,

  i => cpu0.execTGEI(rs(i), imms(i)),
  i => cpu0.execTGEIU(rs(i), imms(i)),
  i => cpu0.execTLTI(rs(i), imms(i)),
  i => cpu0.execTLTIU(rs(i), imms(i)),
  i => cpu0.execTEQI(rs(i), imms(i)),
  executeUnknown,
  i => cpu0.execTNEI(rs(i), imms(i)),
  executeUnknown,

  i => cpu0.execBLTZAL(rs(i), offset(i)),
  i => cpu0.execBGEZAL(rs(i), offset(i)),
  i => cpu0.execBLTZALL(rs(i), offset(i)),
  i => cpu0.execBGEZALL(rs(i), offset(i)),
  executeUnknown,
  executeUnknown,
  executeUnknown,
  executeUnknown,

  executeUnknown,
  executeUnknown,
  executeUnknown,
  executeUnknown,
  executeUnknown,
  executeUnknown,
  executeUnknown,
  executeUnknown,
]);

function executeRegImm(i) {
  return regImmTable[regImmOp(i)](i);
}

function validateSimpleOpTable(cases) {
  if (cases.length != 64) {
    throw "Simple table is unexpected size.";
  }
  return cases;
}

function executeOp(i) {
  return simpleTable[simpleOp(i)](i);
}

const simpleTable = validateSimpleOpTable([
  executeSpecial,
  executeRegImm,
  i => cpu0.execJ(jumpAddress(cpu0.pc, i)),
  i => cpu0.execJAL(jumpAddress(cpu0.pc, i)),
  i => cpu0.execBEQ(rt(i), rs(i), offset(i)),
  i => cpu0.execBNE(rt(i), rs(i), offset(i)),
  i => cpu0.execBLEZ(rs(i), offset(i)),
  i => cpu0.execBGTZ(rs(i), offset(i)),

  i => cpu0.execADDI(rt(i), rs(i), imms(i)),
  i => cpu0.execADDIU(rt(i), rs(i), imms(i)),
  i => cpu0.execSLTI(rt(i), rs(i), imms(i)),
  i => cpu0.execSLTIU(rt(i), rs(i), imms(i)),
  i => cpu0.execANDI(rt(i), rs(i), imm(i)),
  i => cpu0.execORI(rt(i), rs(i), imm(i)),
  i => cpu0.execXORI(rt(i), rs(i), imm(i)),
  i => cpu0.execLUI(rt(i), imm(i)),

  executeCop0,
  executeCop1_disabled,
  executeCop2,
  executeCop3,
  i => cpu0.execBEQL(rt(i), rs(i), offset(i)),
  i => cpu0.execBNEL(rt(i), rs(i), offset(i)),
  i => cpu0.execBLEZL(rs(i), offset(i)),
  i => cpu0.execBGTZL(rs(i), offset(i)),

  i => cpu0.execDADDI(rt(i), rs(i), imms(i)),
  i => cpu0.execDADDIU(rt(i), rs(i), imms(i)),
  i => cpu0.execLDL(rt(i), base(i), imms(i)),
  i => cpu0.execLDR(rt(i), base(i), imms(i)),
  i => cpu0.execBreakpoint(),
  executeUnknown,
  executeUnknown,
  i => cpu0.execRESERVED(0),

  i => cpu0.execLB(rt(i), base(i), imms(i)),
  i => cpu0.execLH(rt(i), base(i), imms(i)),
  i => cpu0.execLWL(rt(i), base(i), imms(i)),
  i => cpu0.execLW(rt(i), base(i), imms(i)),
  i => cpu0.execLBU(rt(i), base(i), imms(i)),
  i => cpu0.execLHU(rt(i), base(i), imms(i)),
  i => cpu0.execLWR(rt(i), base(i), imms(i)),
  i => cpu0.execLWU(rt(i), base(i), imms(i)),

  i => cpu0.execSB(rt(i), base(i), imms(i)),
  i => cpu0.execSH(rt(i), base(i), imms(i)),
  i => cpu0.execSWL(rt(i), base(i), imms(i)),
  i => cpu0.execSW(rt(i), base(i), imms(i)),
  i => cpu0.execSDL(rt(i), base(i), imms(i)),
  i => cpu0.execSDR(rt(i), base(i), imms(i)),
  i => cpu0.execSWR(rt(i), base(i), imms(i)),
  i => cpu0.execCACHE(rt(i), base(i), imms(i)),

  i => cpu0.execLL(rt(i), base(i), imms(i)),
  i => cpu0.execLWC1(rt(i), base(i), imms(i)),
  i => cpu0.execLWC2(rt(i), base(i), imms(i)),
  i => cpu0.execLWC3(rt(i), base(i), imms(i)),
  i => cpu0.execLLD(rt(i), base(i), imms(i)),
  i => cpu0.execLDC1(rt(i), base(i), imms(i)),
  i => cpu0.execLDC2(rt(i), base(i), imms(i)),
  i => cpu0.execLD(rt(i), base(i), imms(i)),

  i => cpu0.execSC(rt(i), base(i), imms(i)),
  i => cpu0.execSWC1(rt(i), base(i), imms(i)),
  i => cpu0.execSWC2(rt(i), base(i), imms(i)),
  i => cpu0.execSWC3(rt(i), base(i), imms(i)),
  i => cpu0.execSCD(rt(i), base(i), imms(i)),
  i => cpu0.execSDC1(rt(i), base(i), imms(i)),
  i => cpu0.execSDC2(rt(i), base(i), imms(i)),
  i => cpu0.execSD(rt(i), base(i), imms(i)),
]);

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
  if (!sync.sync32(pc, 'pc'))
    return false;

  // let nextEvent = this.eventQueue.cyclesToFirstEvent;
  // for (let event = eventQueue.firstEvent; event; event = event.next) {
  //   if (event.type === kEventVbl || event.type == kEventCompare) {
  //     break;
  //   }
  //   nextEvent += event.cyclesToNextEvent;
  // }

  // if (!sync.sync32(nextEvent, 'event'))
  //   return false;

  if (1) {
    let a = 0;
    for (let i = 0; i < 32; ++i) {
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
  //   if (!sync.sync32(cpu0.controlCountValue, 'count'))
  //     return false;
  //   if (!sync.sync32(cpu0.getControlU32(cpu0reg.controlCompare), 'compare'))
  //     return false;
  // }

  return true;
}

n64js.singleStep = function () {
  const breakpoints = n64js.breakpoints();

  let restoreAddress = 0;
  if (breakpoints.isBreakpoint(cpu0.pc)) {
    restoreAddress = cpu0.pc;
    breakpoints.toggle(restoreAddress);
  }

  cpu0.run(1);

  if (restoreAddress) {
    breakpoints.toggle(restoreAddress);
  }
};

class FragmentMap {
  constructor() {
    this.kNumEntries = 16 * 1024;

    this.entries = [];
    for (let i = 0; i < this.kNumEntries; ++i) {
      this.entries.push(new Set());
    }
  }

  addressToCacheLine(address) {
    return Math.floor(address >>> 5);
  }

  addressToCacheLineRoundUp(address) {
    return Math.floor((address + 31) >>> 5);
  }

  lookupEntry(address) {
    const cacheLineIdx = this.addressToCacheLine(address);
    const entryIdx = cacheLineIdx % this.entries.length;
    return this.entries[entryIdx];
  }

  addInstructionToFragment(fragment, pc) {
    fragment.updateMinMax(pc);
    this.lookupEntry(pc).add(fragment);
  }

  invalidateEntry(address) {
    const entry = this.lookupEntry(address);

    // TODO: should this really be translating virtual -> physical?
    // Example 'invalidate 0x800000c0 not removing 0xa40000c4 - min/max 0xa40000c4/0xa40000c8'
    const cacheLine = this.addressToCacheLine(address);

    // TODO: just invalidate fragment map entries for this address?
    for (const [fragment, _] of entry.entries()) {
      if (this.addressToCacheLine(fragment.minPC) <= cacheLine &&
        this.addressToCacheLineRoundUp(fragment.maxPC) >= cacheLine) {
        fragment.invalidate();
        entry.delete(fragment);
      } else {
        // logger.log(`invalidate ${toString32(address)} not removing ${toString32(fragment.entryPC)} - min/max ${toString32(fragment.minPC)}/${toString32(fragment.maxPC)}`)
      }
    }
  }
}

const fragmentMap = new FragmentMap();

function executeFragment(fragment, cpu0, eventQueue) {
  if (eventQueue.nextEventCountdown() < fragment.opsCompiled) {
    // We're close to another event: drop to the interpreter.
    return null;
  }
  fragment.executionCount++;
  const opsExecuted = fragment.func();

  if (!kAccurateCountUpdating) {
    cpu0.incrementCount(opsExecuted);
  }
  // refresh latest event - may have changed
  eventQueue.incrementCount(opsExecuted);

  return fragment.getNextFragment(cpu0.pc, opsExecuted);
}

// We need just one of these - declare at global scope to avoid generating garbage
const fragmentContext = new FragmentContext();

function addOpToFragment(fragment, entry_pc, instruction, c) {
  assert(!fragment.func, `attempting to append op to already-compiled fragment ${toString32(fragment.entryPC)}`);
  if (fragment.opsCompiled === 0) {
    fragmentContext.newFragment();
  }

  // FIXME: this fires for loops to self.
  // if (fragment.opsCompiled > 0 && entry_pc == fragment.entryPC) {
  //   console.log(`re-entering ${toString32(entry_pc)}`)
  // }

  fragment.opsCompiled++;
  fragmentMap.addInstructionToFragment(fragment, entry_pc);

  // TODO: can we avoid the stuffToDo check? Throw exception?
  // TODO: we shouldn't need to set pc for every instruction - this is just to ensure delayedPCUpdate is flushed.
  fragment.bodyCode += 'rsp.step();\n';
  fragment.bodyCode += `if (c.stuffToDo) { c.pc = ${entry_pc}; return ${fragment.opsCompiled - 1}; }\n`;
  fragment.bodyCode += `\n`;

  const curPC = entry_pc;
  const postPC = c.pc;
  fragmentContext.set(fragment, curPC, instruction, postPC, c.nextPC);
  generateCodeForOp(fragmentContext);

  // Break out of the trace as soon as we branch, or too many ops, or last op generated an interrupt (stuffToDo set)
  // TODO: what is longFragment for? This allows short busy loops to be expanded out but it's not clear if that's desirable.
  // TODO: the stuffToDo check won't work for fragments interrupted via exceptions. 
  //       would it be better to just always check if the control flow is as expected?
  const longFragment = fragment.opsCompiled > 8;
  if ((longFragment && c.pc !== entry_pc + 4) || fragment.opsCompiled >= kFragmentLengthLimit || c.stuffToDo) {
    compileFragment(fragment);
    fragment = lookupFragment(c.pc);
  } else {
    fragment.bodyCode += `// Keep going: ops ${fragment.opsCompiled}, pc: ${toString32(c.pc)}, entry+4: ${toString32(entry_pc + 4)}, stuff: ${c.stuffToDo}\n`
  }
  return fragment;
}

function compileFragment(fragment) {
  let header = '';
  const sync = n64js.getSyncFlow();
  if (sync) {
    header += 'const sync = n64js.getSyncFlow();\n';
  }

  if (fragment.usesCop1) {
    header += `const SR_CU1 = ${toString32(SR_CU1)};\n`;
    header += `const FPCSR_C = ${toString32(FPCSR_C)};\n`;
  }

  // Check if the last op has a delayed pc update, and do it now.
  if (fragmentContext.delayedPCUpdate !== 0) {
    fragment.bodyCode += `c.pc = ${toString32(fragmentContext.delayedPCUpdate)};\n`;
    fragmentContext.delayedPCUpdate = 0;
  }

  // Return the number of ops exected
  fragment.bodyCode += `return ${fragment.opsCompiled};\n`;

  const code = `
  return function fragment_${toString32(fragment.entryPC)}_${fragment.opsCompiled}() {
  ${header}
  ${fragment.bodyCode}
}`;

  // Clear these strings to reduce garbage
  fragment.bodyCode = '';

  fragment.func = new Function("c", "cpu1", "rsp", code)(cpu0, cpu1, rsp);
  fragment.nextFragments = [];
  for (let i = 0; i < fragment.opsCompiled; i++) {
    fragment.nextFragments.push(undefined);
  }
}

n64js.checkSyncState = checkSyncState;    // Needs to be callable from dynarec
n64js.executeOp = executeOp;

