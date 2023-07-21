/*jshint jquery:true, devel:true */

import * as cpu0_constants from './cpu0_constants.js';
import { CPU1, convertModeCeil, convertModeFloor, convertModeRound, convertModeTrunc } from './cpu1.js';
import { disassembleInstruction, cop0ControlRegisterNames, cop0gprNames } from './disassemble.js';
import { toString8, toString32 } from './format.js';
import { lookupFragment, resetFragments } from './fragments.js';
import { assert } from './assert.js';
import * as logger from './logger.js';
import { syncFlow } from './sync.js';

window.n64js = window.n64js || {};

const kDebugTLB = false;
const kDebugDynarec = false;

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
const statusWritableBits = ~0x80000;

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
const causeWritableBits = CAUSE_SW1 | CAUSE_SW2;

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

const TLBHI_VPN2MASK    = 0xffffe000;
const TLBHI_VPN2MASK_NEG= 0x00001fff;
const TLBHI_VPN2SHIFT   = 13;
const TLBHI_PIDMASK     = 0xff;
const TLBHI_PIDSHIFT    = 0;
const TLBHI_NPID        = 255;

const TLBLO_PFNMASK     = 0x3fffffc0;
const TLBLO_PFNSHIFT    = 6;
const TLBLO_CACHMASK    = 0x38;
const TLBLO_CACHSHIFT   = 3;
const TLBLO_UNCACHED    = 0x10;
const TLBLO_NONCOHRNT   = 0x18;
const TLBLO_EXLWR       = 0x28;
const TLBLO_D           = 0x4;
const TLBLO_V           = 0x2;
const TLBLO_G           = 0x1;

const entryLoWritableBits = 0x3fffffff;

const TLBINX_PROBE      = 0x80000000;
const TLBINX_INXMASK    = 0x3f;
const TLBINX_INXSHIFT   = 0;

const indexWritableBits = 0x8000003f;

const TLBRAND_RANDMASK  = 0x3f;
const TLBRAND_RANDSHIFT = 0;

const TLBWIRED_WIREDMASK  = 0x3f;

const wiredWritableBits = 0x3f;

const TLBCTXT_BASEMASK  = 0xff800000;
const TLBCTXT_BASESHIFT = 23;
const TLBCTXT_BASEBITS  = 9;

const TLBCTXT_VPNMASK   = 0x7ffff0;
const TLBCTXT_VPNSHIFT  = 4;

const contextWriteableBits = ~0x7fffff;

const TLBPGMASK_4K      = 0x00000000;
const TLBPGMASK_16K     = 0x00006000;
const TLBPGMASK_64K     = 0x0001e000;
const TLBPGMASK_256K    = 0x0007e000;
const TLBPGMASK_1M      = 0x001fe000;
const TLBPGMASK_4M      = 0x007fe000;
const TLBPGMASK_16M     = 0x01ffe000;

const pageMaskWritableBits = 0x01ffe000;

const kStuffToDoHalt            = 1<<0;
const kStuffToDoCheckInterrupts = 1<<1;
const kStuffToDoBreakout        = 1<<2;

const kEventVbl          = 0;
const kEventCompare      = 1;
const kEventRunForCycles = 2;

// Needs to be callable from dynarec.
n64js.getSyncFlow = () => syncFlow;

const s32SignBit = 0x8000_0000;
const s64SignBit = 0x8000_0000_0000_0000n;

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
    this.pagemask = 0;
    this.hi = 0;
    this.pfne = 0;
    this.pfno = 0;
    this.mask = 0;
    this.global = 0;
  }

  update(index, pagemask, hi, entrylo0, entrylo1) {
    if (kDebugTLB) {
      logger.log(`TLB update: index=${index}, pagemask=${toString32(pagemask)}, entryhi=${toString32(hi)}, entrylo0=${toString32(entrylo0)}, entrylo1=${toString32(entrylo1)}`);
      logger.log(`       ${pageMaskName(pagemask)} Pagesize`);
    }

    this.pagemask = pagemask;
    this.hi = hi;
    this.pfne = entrylo0;
    this.pfno = entrylo1;

    this.global = (entrylo0 & entrylo1 & TLBLO_G);

    this.mask = pagemask | TLBHI_VPN2MASK_NEG;
    this.mask2 = this.mask >>> 1;
    this.vpnmask = (~this.mask) >>> 0;
    this.vpn2mask = this.vpnmask >>> 1;

    this.addrcheck = (hi & this.vpnmask) >>> 0;

    this.pfnehi = (this.pfne << TLBLO_PFNSHIFT) & this.vpn2mask;
    this.pfnohi = (this.pfno << TLBLO_PFNSHIFT) & this.vpn2mask;

    this.checkbit = pageMaskCheckbit(pagemask);
  }
}

class PageMask {
  constructor(name, checkbit) {
    this.name = name;
    this.checkbit = checkbit;
  }
}

const pageMasks = new Map([
  [TLBPGMASK_4K, new PageMask('4k', 0x00001000)],
  [TLBPGMASK_16K, new PageMask('16k', 0x00004000)],
  [TLBPGMASK_64K, new PageMask('64k', 0x00010000)],
  [TLBPGMASK_256K, new PageMask('256k', 0x00040000)],
  [TLBPGMASK_1M, new PageMask('1M', 0x00100000)],
  [TLBPGMASK_4M, new PageMask('4M', 0x00400000)],
  [TLBPGMASK_16M, new PageMask('16M', 0x01000000)],
]);

function pageMaskCheckbit(pageMask) {
  const pm = pageMasks.get(pageMask);
  if (pm) {
    return pm.checkbit;
  }
  logger.log(`Bad pagemask: ${pageMask}`);
  return 0;
}

function pageMaskName(pageMask) {
  const pm = pageMasks.get(pageMask);
  if (pm) {
    return pm.name;
  }
  return 'Unknown';
}

class CPU0 {
  constructor() {
    this.opsExecuted = 0; // Approximate...

    this.ram = undefined; // bound to in reset n64js.getRamU8Array();

    // TODO: add BigIntArrays.
    const gprMem = new ArrayBuffer(32 * 8);
    this.gprU32 = new Uint32Array(gprMem);
    this.gprS32 = new Int32Array(gprMem);
    this.gprU64 = new BigUint64Array(gprMem);
    this.gprS64 = new BigInt64Array(gprMem);

    const controlMem = new ArrayBuffer(32 * 4);
    this.control = new Uint32Array(controlMem);
    this.control_signed = new Int32Array(controlMem);

    // Reads from invalid control registers will use the value last written to any control register.
    this.lastControlRegWrite = 0;

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
  }

  getCount() {
    return this.control[cpu0_constants.controlCount];
  }

  getRegS32Lo(r) { return this.gprS32[r * 2 + 0]; }
  getRegS32Hi(r) { return this.gprS32[r * 2 + 1]; }
  getRegU32Lo(r) { return this.gprU32[r * 2 + 0]; }
  getRegU32Hi(r) { return this.gprU32[r * 2 + 1]; }
  getRegS64(r) { return this.gprS64[r]; }
  getRegU64(r) { return this.gprU64[r]; }

  setRegU64(r, v) {
    // This shouldn't be needed but there seems to be a bug with BigInts > 64 bits.
    // TODO: check still needed with BigUint64Array.
    const truncated = v & 0xffff_ffff_ffff_ffffn;
    this.gprU64[r] = truncated;
  }

  setRegS64LoHi(r, lo, hi) {
    this.gprS32[r * 2 + 0] = lo;
    this.gprS32[r * 2 + 1] = hi;    
  }

  setRegS32Lo(r, v) {
    this.gprS32[r * 2 + 0] = v;
  }

  setRegS32Extend(r, v) {
    this.gprS32[r * 2 + 0] = v;
    this.gprS32[r * 2 + 1] = v >> 31;
  }

  setRegU32Extend(r, v) {
    this.gprS32[r * 2 + 0] = v;
    this.gprS32[r * 2 + 1] = 0;
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

  reset() {
    resetFragments();

    this.ram = n64js.getRamU8Array();

    for (let i = 0; i < 32; ++i) {
      this.gprU32[i * 2 + 0] = 0;
      this.gprU32[i * 2 + 1] = 0;
      this.control[i] = 0;
    }
    for (let i = 0; i < 32; ++i) {
      this.tlbEntries[i].update(i, 0, 0x80000000, 0, 0);
    }

    this.pc = 0;
    this.delayPC = 0;
    this.nextPC = 0;
    this.branchTarget = 0;

    this.stuffToDo = 0;

    this.events = [];

    this.multLoU32[0] = this.multLoU32[1] = 0;
    this.multHiU32[0] = this.multHiU32[1] = 0;

    this.control[cpu0_constants.controlRand] = 32 - 1;
    this.control[cpu0_constants.controlStatus] = 0x70400004;
    this.control[cpu0_constants.controlConfig] = 0x0006e463;
    cop1ControlChanged();
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

        this.control[cpu0_constants.controlCount] += toSkip;
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
      this.control[cpu0_constants.controlCause] |= CAUSE_IP3;

      if (this.checkForUnmaskedInterrupts()) {
        this.stuffToDo |= kStuffToDoCheckInterrupts;
      }
    } else {
      this.control[cpu0_constants.controlCause] &= ~CAUSE_IP3;
    }

    checkCauseIP3Consistent();
  }

  setStatus(value) {
    this.control[cpu0_constants.controlStatus] = value & statusWritableBits;
    cop1ControlChanged();

    if (this.checkForUnmaskedInterrupts()) {
      this.stuffToDo |= kStuffToDoCheckInterrupts;
    }
  }

  checkForUnmaskedInterrupts() {
    const sr = this.control[cpu0_constants.controlStatus];

    // Ensure ERL/EXL are clear and IE is set
    if ((sr & (SR_EXL | SR_ERL | SR_IE)) === SR_IE) {
      // Check if interrupts are actually pending, and wanted
      const cause = this.control[cpu0_constants.controlCause];

      if ((sr & cause & CAUSE_IPMASK) !== 0) {
        return true;
      }
    }

    return false;
  }

  raiseAdELException(address) {
    this.control[cpu0_constants.controlBadVAddr] = address;

    this.control[cpu0_constants.controlContext] &= 0xff800000;
    this.control[cpu0_constants.controlContext] |= ((address >>> 13) << 4);

    // FIXME this is a 64 bit register.
    this.control[cpu0_constants.controlXContext] &= 0;
    this.control[cpu0_constants.controlXContext] |= (((address >>> 13) & 0x7ffffff) << 4); // badvpn2
    this.control[cpu0_constants.controlXContext] |= (((address >>> 30) & 0x3) << 31); // r

    this.raiseGeneralException(CAUSE_EXCMASK | CAUSE_CEMASK, causeExcCodeAdEL);
  }

  checkCopXUsable(copIdx) {
    // TODO: this probably needs to throw a JS exception which is caught in n64js.run
    // to ensure bookkeeping (like updating the delayPC) isn't run.
    const bit = 1 << (SR_CUSHIFT + copIdx);
    const usable = (cpu0.control[cpu0_constants.controlStatus] & bit) != 0;
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

  raiseTLBException(address, exc_code, vec) {
    this.control[cpu0_constants.controlBadVAddr] = address;

    this.control[cpu0_constants.controlContext] &= 0xff800000;
    this.control[cpu0_constants.controlContext] |= ((address >>> 13) << 4);

    this.control[cpu0_constants.controlEntryHi] &= 0x00001fff;
    this.control[cpu0_constants.controlEntryHi] |= (address & 0xfffffe000);

    // XXXX check we're not inside exception handler before snuffing CAUSE reg?
    this.raiseException(CAUSE_EXCMASK, exc_code, vec);
  }

  raiseTLBReadMissException(address) { this.raiseTLBException(address, causeExcCodeTLBL, UT_VEC); }
  raiseTLBWriteMissException(address) { this.raiseTLBException(address, causeExcCodeTLBS, UT_VEC); }

  raiseTLBReadInvalidException(address) { this.raiseTLBException(address, causeExcCodeTLBL, E_VEC); }
  raiseTLBWriteInvalidException(address) { this.raiseTLBException(address, causeExcCodeTLBS, E_VEC); }


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
    this.control[cpu0_constants.controlCause] &= ~mask;
    this.control[cpu0_constants.controlCause] |= exception;
    this.control[cpu0_constants.controlStatus] |= SR_EXL;
    this.control[cpu0_constants.controlEPC] = this.pc;

    const bdMask = (1 << CAUSE_BD_BIT);
    if (this.delayPC) {
      this.control[cpu0_constants.controlCause] |= bdMask;
      this.control[cpu0_constants.controlEPC] -= 4;
    } else {
      this.control[cpu0_constants.controlCause] &= ~bdMask;
    }
    this.nextPC = excVec;
  }

  raiseGeneralException(mask, exception) {
    this.raiseException(mask, exception, E_VEC);
  }

  setCompare(value) {
    this.control[cpu0_constants.controlCause] &= ~CAUSE_IP8;
    if (value === this.control[cpu0_constants.controlCompare]) {
      // just clear the IP8 flag
    } else {
      if (value !== 0) {
        const count = this.control[cpu0_constants.controlCount];
        if (value > count) {
          const delta = value - count;

          this.removeEventsOfType(kEventCompare);
          this.addEvent(kEventCompare, delta);
        } else {
          n64js.warn('setCompare underflow - was' + toString32(count) + ', setting to ' + value);
        }
      }
    }
    this.control[cpu0_constants.controlCompare] = value;

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
    const wired = this.control[cpu0_constants.controlWired] & 0x1f;
    let random = Math.floor(Math.random() * (32 - wired)) + wired;
    if (syncFlow) {
      random = syncFlow.reflect32(random);
    }

    assert(random >= wired && random <= 31, `Ooops - random should be in range ${wired}..31, but got ${random}`);
    return random;
  }

  setTLB(cpu, index) {
    const pagemask = cpu.control[cpu0_constants.controlPageMask];
    const entryhi = cpu.control[cpu0_constants.controlEntryHi];
    const entrylo1 = cpu.control[cpu0_constants.controlEntryLo1];
    const entrylo0 = cpu.control[cpu0_constants.controlEntryLo0];

    cpu.tlbEntries[index].update(index, pagemask, entryhi, entrylo0, entrylo1);
  }

  tlbWriteIndex() {
    this.setTLB(this, this.control[cpu0_constants.controlIndex] & 0x1f);
  }

  tlbWriteRandom() {
    this.setTLB(this, this.getRandom());
  }

  tlbRead() {
    const index = this.control[cpu0_constants.controlIndex] & 0x1f;
    const tlb = this.tlbEntries[index];

    this.control[cpu0_constants.controlPageMask] = tlb.pagemask;
    this.control[cpu0_constants.controlEntryHi] = tlb.hi;
    this.control[cpu0_constants.controlEntryLo0] = tlb.pfne | tlb.global;
    this.control[cpu0_constants.controlEntryLo1] = tlb.pfno | tlb.global;

    if (kDebugTLB) {
      logger.log('TLB Read Index ' + toString8(index) + '.');
      logger.log('  PageMask: ' + toString32(this.control[cpu0_constants.controlPageMask]));
      logger.log('  EntryHi:  ' + toString32(this.control[cpu0_constants.controlEntryHi]));
      logger.log('  EntryLo0: ' + toString32(this.control[cpu0_constants.controlEntryLo0]));
      logger.log('  EntryLo1: ' + toString32(this.control[cpu0_constants.controlEntryLo1]));
    }
  }

  tlbProbe() {
    const entryHi = this.control[cpu0_constants.controlEntryHi];
    const entryHiVpn2 = entryHi & TLBHI_VPN2MASK;
    const entryHiPID = entryHi & TLBHI_PIDMASK;

    for (let i = 0; i < 32; ++i) {
      const tlb = this.tlbEntries[i];
      if ((tlb.hi & TLBHI_VPN2MASK) === entryHiVpn2) {
        if (((tlb.hi & TLBHI_PIDMASK) === entryHiPID) || tlb.global) {
          if (kDebugTLB) {
            logger.log('TLB Probe. EntryHi:' + toString32(entryHi) + '. Found matching TLB entry - ' + toString8(i));
          }
          this.control[cpu0_constants.controlIndex] = i;
          return;
        }
      }
    }

    if (kDebugTLB) {
      logger.log('TLB Probe. EntryHi:' + toString32(entryHi) + ". Didn't find matching entry");
    }
    this.control[cpu0_constants.controlIndex] = TLBINX_PROBE;
  }

  tlbFindEntry(address) {
    for (let i = 0; i < 32; ++i) {
      // TODO: use MRU cache here.
      const tlb = this.tlbEntries[i];

      if ((address & tlb.vpnmask) === tlb.addrcheck) {
        if (!tlb.global) {
          const ehi = this.control[cpu0_constants.controlEntryHi];
          if ((tlb.hi & TLBHI_PIDMASK) !== (ehi & TLBHI_PIDMASK)) {
            // Entries ASID must match
            continue;
          }
        }
        return tlb;
      }
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
    const highBits = odd ? tlb.pfnohi : tlb.pfnehi;
    const maskedAddress = address & tlb.mask2;

    if ((entryLo & TLBLO_V) !== 0) {
      return highBits | maskedAddress;
    }
    return 0;
  }

  translateRead(address) {
    const tlb = this.tlbFindEntry(address);
    if (!tlb) {
      this.raiseTLBReadMissException(address);
      throw new TLBException(address);
    }

    const odd = address & tlb.checkbit;
    const entryLo = odd ? tlb.pfno : tlb.pfne;
    const highBits = odd ? tlb.pfnohi : tlb.pfnehi;
    const maskedAddress = address & tlb.mask2;

    if ((entryLo & TLBLO_V) !== 0) {
      return highBits | maskedAddress;
    }
    this.raiseTLBReadInvalidException(address);
    throw new TLBException(address);
  }

  translateWrite(address) {
    const tlb = this.tlbFindEntry(address);
    if (!tlb) {
      this.raiseTLBWriteMissException(address);
      throw new TLBException(address);
    }

    const odd = address & tlb.checkbit;
    const entryLo = odd ? tlb.pfno : tlb.pfne;
    const highBits = odd ? tlb.pfnohi : tlb.pfnehi;
    const maskedAddress = address & tlb.mask2;

    if ((entryLo & TLBLO_V) !== 0) {
      return highBits | maskedAddress;
    }
    this.raiseTLBWriteInvalidException(address);
    throw new TLBException(address);
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

class TLBException {
  constructor(address) {
    this.address = address;
  }
}

// Expose the cpu state
const cpu0 = new CPU0();
const cpu1 = new CPU1(cpu0);
const cpu2 = new CPU2();
n64js.cpu0 = cpu0;
n64js.cpu1 = cpu1;
n64js.cpu2 = cpu2;


function     fd(i) { return (i>>> 6)&0x1f; }
function     fs(i) { return (i>>>11)&0x1f; }
function     ft(i) { return (i>>>16)&0x1f; }
function  copop(i) { return (i>>>21)&0x1f; }

function offset(i) { return ((i&0xffff)<<16)>>16; }
function     sa(i) { return (i>>> 6)&0x1f; }
function     rd(i) { return (i>>>11)&0x1f; }
function     rt(i) { return (i>>>16)&0x1f; }
function     rs(i) { return (i>>>21)&0x1f; }
function     op(i) { return (i>>>26)&0x1f; }

function tlbop(i)     { return i&0x3f; }
function cop1_func(i) { return i&0x3f; }
function cop1_bc(i)   { return (i>>>16)&0x3; }

function target(i) { return (i     )&0x3ffffff; }
function    imm(i) { return (i     )&0xffff; }
function   imms(i) { return ((i&0xffff)<<16)>>16; }   // treat immediate value as signed
function   base(i) { return (i>>>21)&0x1f; }

function branchAddress(pc, i) { return ((pc + 4) + (offset(i) * 4)) >>> 0; }
//function branchAddress(pc,i) { return (((pc>>>2)+1) + offset(i))<<2; }  // NB: convoluted calculation to avoid >>>0 (deopt)
function jumpAddress(pc, i) { return ((pc & 0xf0000000) | (target(i) * 4)) >>> 0; }

function performBranch(new_pc) {
  //if (new_pc < 0) {
  //  logger.log('Oops, branching to negative address: ' + new_pc);
  //  throw 'Oops, branching to negative address: ' + new_pc;
  //}
  cpu0.branchTarget = new_pc;
}

function genSrcRegS32Lo(i) {
  if (i === 0)
    return '0';
  return `c.getRegS32Lo(${i})`;
}

function genSrcRegS32Hi(i) {
  if (i === 0)
    return '0';
  return `c.getRegS32Hi(${i})`;
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

//
// Memory access routines.
//

// These are out of line so that the >>>0 doesn't cause a shift-i deopt in the body of the calling function
function lwu_slow(addr) { return n64js.readMemoryU32(addr >>> 0); }
function lhu_slow(addr) { return n64js.readMemoryU16(addr >>> 0); }
function lbu_slow(addr) { return n64js.readMemoryU8(addr >>> 0); }

function lw_slow(addr) { return n64js.readMemoryS32(addr >>> 0); }
function lh_slow(addr) { return n64js.readMemoryS16(addr >>> 0); }
function lb_slow(addr) { return n64js.readMemoryS8(addr >>> 0); }

function sw_slow(addr, value) { n64js.writeMemory32(addr >>> 0, value); }
function sh_slow(addr, value) { n64js.writeMemory16(addr >>> 0, value); }
function sb_slow(addr, value) { n64js.writeMemory8(addr >>> 0, value); }


n64js.load_u8 = (ram, addr) => {
  if (addr < -2139095040) {
    const phys = (addr + 0x80000000) | 0;  // NB: or with zero ensures we return an SMI if possible.
    return ram[phys];
  }
  return lbu_slow(addr);
};

n64js.load_s8 = (ram, addr) => {
  if (addr < -2139095040) {
    const phys = (addr + 0x80000000) | 0;  // NB: or with zero ensures we return an SMI if possible.
    return (ram[phys] << 24) >> 24;
  }
  return lb_slow(addr);
};

n64js.load_u16 = (ram, addr) => {
  if (addr < -2139095040) {
    const phys = (addr + 0x80000000) | 0;  // NB: or with zero ensures we return an SMI if possible.
    return (ram[phys] << 8) | ram[phys + 1];
  }
  return lhu_slow(addr);
};

n64js.load_s16 = (ram, addr) => {
  if (addr < -2139095040) {
    const phys = (addr + 0x80000000) | 0;  // NB: or with zero ensures we return an SMI if possible.
    return ((ram[phys] << 24) | (ram[phys + 1] << 16)) >> 16;
  }
  return lh_slow(addr);
};

n64js.load_u32 = (ram, addr) => {
  if (addr < -2139095040) {
    const phys = (addr + 0x80000000) | 0;  // NB: or with zero ensures we return an SMI if possible.
    return ((ram[phys] << 24) | (ram[phys + 1] << 16) | (ram[phys + 2] << 8) | ram[phys + 3]) >>> 0;
  }
  return lwu_slow(addr);
};

n64js.load_s32 = (ram, addr) => {
  if (addr < -2139095040) {
    const phys = (addr + 0x80000000) | 0;  // NB: or with zero ensures we return an SMI if possible.
    return ((ram[phys] << 24) | (ram[phys + 1] << 16) | (ram[phys + 2] << 8) | ram[phys + 3]) | 0;
  }
  return lw_slow(addr);
};

n64js.load_u64_bigint = (ram, address) => {
  const hi = n64js.load_u32(ram, address);
  const lo = n64js.load_u32(ram, address + 4);
  return (BigInt(hi) << 32n) | BigInt(lo >>> 0);
}

n64js.store_8 = (ram, addr, value) => {
  if (addr < -2139095040) {
    const phys = (addr + 0x80000000) | 0;  // NB: or with zero ensures we return an SMI if possible.
    ram[phys] = value;
  } else {
    sb_slow(addr, value);
  }
};

n64js.store_16 = (ram, addr, value) => {
  if (addr < -2139095040) {
    const phys = (addr + 0x80000000) | 0;  // NB: or with zero ensures we return an SMI if possible.
    ram[phys] = value >> 8;
    ram[phys + 1] = value;
  } else {
    sh_slow(addr, value);
  }
};

n64js.store_32 = (ram, addr, value) => {
  if (addr < -2139095040) {
    const phys = (addr + 0x80000000) | 0;  // NB: or with zero ensures we return an SMI if possible.
    ram[phys + 0] = value >> 24;
    ram[phys + 1] = value >> 16;
    ram[phys + 2] = value >> 8;
    ram[phys + 3] = value;
  } else {
    sw_slow(addr, value);
  }
};

n64js.store_64 = (ram, addr, value_lo, value_hi) => {
  if (addr < -2139095040) {
    const phys = (addr + 0x80000000) | 0;  // NB: or with zero ensures we return an SMI if possible.
    ram[phys + 0] = value_hi >> 24;
    ram[phys + 1] = value_hi >> 16;
    ram[phys + 2] = value_hi >> 8;
    ram[phys + 3] = value_hi;
    ram[phys + 4] = value_lo >> 24;
    ram[phys + 5] = value_lo >> 16;
    ram[phys + 6] = value_lo >> 8;
    ram[phys + 7] = value_lo;
  } else {
    sw_slow(addr, value_hi);
    sw_slow(addr + 4, value_lo);
  }
};

n64js.store_64_bigint = (ram, addr, value) => {
  const lo = Number(value & 0xffffffffn);
  const hi = Number(value >> 32n);
  n64js.store_64(ram, addr, lo, hi);
};

function unimplemented(pc, i) {
  const r = disassembleInstruction(pc, i);
  const e = `Unimplemented op ${toString32(i)} : ${r.disassembly}`;
  logger.log(e);
  throw e;
}

function executeUnknown(i) {
  throw `Unknown op, pc: ${toString32(cpu0.pc)}, instruction: ${toString32(i)}`;
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

function generateSLL(ctx) {
  // NOP
  if (ctx.instruction === 0) {
    return generateNOPBoilerplate('NOP', ctx);
  }

  const d = ctx.instr_rd();
  const t = ctx.instr_rt();
  const shift = ctx.instr_sa();

  const impl = `
    c.setRegS32Extend(${d}, ${genSrcRegS32Lo(t)} << ${shift});
    `;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function executeSLL(i) {
  // NOP
  if (i === 0) {
    return;
  }

  cpu0.setRegS32Extend(rd(i), cpu0.getRegS32Lo(rt(i)) << sa(i));
}

function generateSRL(ctx) {
  const d = ctx.instr_rd();
  const t = ctx.instr_rt();
  const shift = ctx.instr_sa();

  const impl = `
    c.setRegS32Extend(${d}, ${genSrcRegS32Lo(t)} >>> ${shift});
    `;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function executeSRL(i) {
  cpu0.setRegS32Extend(rd(i), cpu0.getRegU32Lo(rt(i)) >>> sa(i));
}

function generateSRA(ctx) {
  const d = ctx.instr_rd();
  const t = ctx.instr_rt();
  const shift = ctx.instr_sa();

  const impl = `
    const result = ${genSrcRegS64(t)} >> BigInt(${shift});
    c.setRegS32Extend(${d}, Number(result & 0xffff_ffffn));
    `;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function executeSRA(i) {
  // SRA appears to shift the full 64 bit reg, trunc to 32 bits, then sign extend.
  const result = cpu0.getRegS64(rt(i)) >> BigInt(sa(i));
  cpu0.setRegS32Extend(rd(i), Number(result & 0xffff_ffffn));
}

function generateSLLV(ctx) {
  const d = ctx.instr_rd();
  const s = ctx.instr_rs();
  const t = ctx.instr_rt();

  const impl = `
    const result = ${genSrcRegS32Lo(t)} << (${genSrcRegS32Lo(s)} & 0x1f);
    c.setRegS32Extend(${d}, result);
    `;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function executeSLLV(i) {
  const result = cpu0.getRegS32Lo(rt(i)) << (cpu0.getRegS32Lo(rs(i)) & 0x1f);
  cpu0.setRegS32Extend(rd(i), result);
}

function generateSRLV(ctx) {
  const d = ctx.instr_rd();
  const s = ctx.instr_rs();
  const t = ctx.instr_rt();

  const impl = `
    const result = ${genSrcRegS32Lo(t)} >>> (${genSrcRegS32Lo(s)} & 0x1f);
    c.setRegS32Extend(${d}, result);
    `;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function executeSRLV(i) {
  const result = cpu0.getRegS32Lo(rt(i)) >>> (cpu0.getRegS32Lo(rs(i)) & 0x1f);
  cpu0.setRegS32Extend(rd(i), result);
}

function generateSRAV(ctx) {
  const d = ctx.instr_rd();
  const s = ctx.instr_rs();
  const t = ctx.instr_rt();

  const impl = `
  const shift = (${genSrcRegS32Lo(s)} & 0x1f);
  const result = ${genSrcRegS64(t)} >> BigInt(shift);
  c.setRegS32Extend(${d}, Number(result & 0xffff_ffffn));
  `;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function executeSRAV(i) {
  const shift = cpu0.getRegS32Lo(rs(i)) & 0x1f;
  const result = cpu0.getRegS64(rt(i)) >> BigInt(shift);
  cpu0.setRegS32Extend(rd(i), Number(result & 0xffff_ffffn));
}

function executeDSLLV(i) {
  const shift = cpu0.getRegU32Lo(rs(i)) & 0x3f;
  cpu0.setRegU64(rd(i), cpu0.getRegU64(rt(i)) << BigInt(shift));
}

function executeDSRLV(i) {
  const shift = cpu0.getRegU32Lo(rs(i)) & 0x3f;
  cpu0.setRegU64(rd(i), cpu0.getRegU64(rt(i)) >> BigInt(shift));
}

function executeDSRAV(i) {
  const shift = cpu0.getRegU32Lo(rs(i)) & 0x3f;
  cpu0.setRegU64(rd(i), cpu0.getRegS64(rt(i)) >> BigInt(shift));
}

function executeDSLL(i) {
  cpu0.setRegU64(rd(i), cpu0.getRegU64(rt(i)) << BigInt(sa(i)));
}

function executeDSRL(i) {
  cpu0.setRegU64(rd(i), cpu0.getRegU64(rt(i)) >> BigInt(sa(i)));
}

function executeDSRA(i) {
  cpu0.setRegU64(rd(i), cpu0.getRegS64(rt(i)) >> BigInt(sa(i)));
}

function executeDSLL32(i) {
  cpu0.setRegU64(rd(i), cpu0.getRegU64(rt(i)) << BigInt(sa(i) + 32));
}  

function executeDSRL32(i) {
  cpu0.setRegU64(rd(i), cpu0.getRegU64(rt(i)) >> BigInt(sa(i) + 32));
}  

function executeDSRA32(i) {
  cpu0.setRegU64(rd(i), cpu0.getRegS64(rt(i)) >> BigInt(sa(i) + 32));
}

function executeSYSCALL(i) {
  cpu0.raiseSYSCALLException();
}

function executeBREAK(i) {
  cpu0.raiseBREAKException();
}

function executeSYNC(i) {
  // Ignored.
}

function executeMFHI(i) { cpu0.setRegU64(rd(i), cpu0.getMultHiU64()); }
function executeMFLO(i) { cpu0.setRegU64(rd(i), cpu0.getMultLoU64()); }
function executeMTHI(i) { cpu0.setMultHiU64(cpu0.getRegU64(rs(i))); }
function executeMTLO(i) { cpu0.setMultLoU64(cpu0.getRegU64(rs(i))); }

function generateMFHI(ctx) {
  const d = ctx.instr_rd();
  const impl = `
    c.setRegU64(${d}, c.getMultHiU64());
    `;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateMFLO(ctx) {
  const d = ctx.instr_rd();
  const impl = `
    c.setRegU64(${d}, c.getMultLoU64());
    `;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateMTHI(ctx) {
  const s = ctx.instr_rs();
  const impl = `
    c.setMultHiU64(c.getRegU64(${s}));
  `;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateMTLO(ctx) {
  const s = ctx.instr_rs();
  const impl = `
    c.setMultLoU64(c.getRegU64(${s}));
    `;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateMULT(ctx) {
  const s = ctx.instr_rs();
  const t = ctx.instr_rt();

  const impl = `
    const result = BigInt(${genSrcRegS32Lo(s)}) * BigInt(${genSrcRegS32Lo(t)});
    c.setMultLoS32Extend(result & 0xffffffffn);
    c.setMultHiS32Extend(result >> 32n);
    `;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function executeMULT(i) {
  const result = BigInt(cpu0.getRegS32Lo(rs(i))) * BigInt(cpu0.getRegS32Lo(rt(i)));
  // TODO: verify if these results should be sign extended or not.
  // n64-systemtest doesn't seem to cover MULT.
  cpu0.setMultLoS32Extend(result & 0xffffffffn);
  cpu0.setMultHiS32Extend(result >> 32n);
}

function generateMULTU(ctx) {
  const s = ctx.instr_rs();
  const t = ctx.instr_rt();

  const impl = `
    const result = BigInt(${genSrcRegU32Lo(s)}) * BigInt(${genSrcRegU32Lo(t)});
    c.setMultLoS32Extend(result & 0xffffffffn);
    c.setMultHiS32Extend(result >> 32n);
    `;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function executeMULTU(i) {
  const result = BigInt(cpu0.getRegU32Lo(rs(i))) * BigInt(cpu0.getRegU32Lo(rt(i)));
  // TODO: verify if these results should be sign extended or not.
  // n64-systemtest doesn't seem to cover MULT.
  cpu0.setMultLoS32Extend(result & 0xffffffffn);
  cpu0.setMultHiS32Extend(result >> 32n);
}

function executeDMULT(i) {
  const result = cpu0.getRegS64(rs(i)) * cpu0.getRegS64(rt(i));
  cpu0.setMultLoS64(result & 0xffff_ffff_ffff_ffffn);
  cpu0.setMultHiS64(result >> 64n);
}

function executeDMULTU(i) {
  const result = cpu0.getRegU64(rs(i)) * cpu0.getRegU64(rt(i));
  cpu0.setMultLoU64(result & 0xffff_ffff_ffff_ffffn);
  cpu0.setMultHiU64(result >> 64n);
}

function executeDIV(i) {
  const dividend = cpu0.getRegS32Lo(rs(i));
  const divisor = cpu0.getRegS32Lo(rt(i));

  let lo, hi;
  if (divisor) {
    lo = (dividend / divisor) >> 0;
    hi = dividend % divisor;
  } else {
    lo = dividend < 0 ? 1 : -1;
    hi = dividend;
  }
  // 32 bit result is sign extended to 64 bits.
  cpu0.setMultLoS32Extend(BigInt(lo));
  cpu0.setMultHiS32Extend(BigInt(hi));
}

function executeDIVU(i) {
  const dividend = cpu0.getRegU32Lo(rs(i));
  const divisor = cpu0.getRegU32Lo(rt(i));

  let lo, hi;
  if (divisor) {
    lo = (dividend / divisor) >> 0;
    hi = dividend % divisor;
  } else {
    lo = -1;
    hi = dividend;
  }
  // 32 bit result is sign extended to 64 bits.
  cpu0.setMultLoS32Extend(BigInt(lo));
  cpu0.setMultHiS32Extend(BigInt(hi));
}

function executeDDIV(i) {
  const divisor = cpu0.getRegS64(rt(i));
  const dividend = cpu0.getRegS64(rs(i));

  let lo, hi;
  if (divisor) {
    lo = dividend / divisor;
    hi = dividend % divisor;
  } else {
    lo = dividend < 0 ? 1n : -1n;
    hi = dividend;
  }
  cpu0.setMultLoS64(lo);
  cpu0.setMultHiS64(hi);
}

function executeDDIVU(i) {
  const divisor = cpu0.getRegU64(rt(i));
  const dividend = cpu0.getRegU64(rs(i));

  let lo, hi;
  if (divisor) {
    lo = dividend / divisor;
    hi = dividend % divisor;
  } else {
    lo = -1n;
    hi = dividend;
  }
  cpu0.setMultLoU64(lo);
  cpu0.setMultHiU64(hi);
}

function generateADD(ctx) {
  const d = ctx.instr_rd();
  const s = ctx.instr_rs();
  const t = ctx.instr_rt();
  const impl = `
    const s = ${genSrcRegS32Lo(s)};
    const t = ${genSrcRegS32Lo(t)};
    const result = s + t;
    if (n64js.s32CheckAddOverflow(s, t, result)) {
      c.raiseOverflowException();
    } else {
      c.setRegS32Extend(${d}, result);
    }
    `;
  // Use the generic boilerplate because we might have generated an overflow exception.
  return generateGenericOpBoilerplate(impl, ctx);
}

function executeADD(i) {
  const s = cpu0.getRegS32Lo(rs(i));
  const t = cpu0.getRegS32Lo(rt(i));
  const result = s + t;
  if (s32CheckAddOverflow(s, t, result)) {
    cpu0.raiseOverflowException();
    return; 
  }
  cpu0.setRegS32Extend(rd(i), result);
}

function generateADDU(ctx) {
  const d = ctx.instr_rd();
  const s = ctx.instr_rs();
  const t = ctx.instr_rt();
  const impl = `
    const s = ${genSrcRegS32Lo(s)};
    const t = ${genSrcRegS32Lo(t)};
    c.setRegS32Extend(${d}, s + t);
    `;
  return generateTrivialOpBoilerplate(impl, ctx);
}
function executeADDU(i) {
  const s = cpu0.getRegS32Lo(rs(i));
  const t = cpu0.getRegS32Lo(rt(i));
  const result = s + t;
  cpu0.setRegS32Extend(rd(i), result);
}

function generateSUB(ctx) {
  const d = ctx.instr_rd();
  const s = ctx.instr_rs();
  const t = ctx.instr_rt();
  const impl = `
    const s = ${genSrcRegS32Lo(s)};
    const t = ${genSrcRegS32Lo(t)};
    const result = s - t;
    if (n64js.s32CheckSubOverflow(s, t, result)) {
      c.raiseOverflowException();
    } else {
      c.setRegS32Extend(${d}, result);
    }
  `;
  // Use the generic boilerplate because we might have generated an overflow exception.
  return generateGenericOpBoilerplate(impl, ctx);
}

function executeSUB(i) {
  const s = cpu0.getRegS32Lo(rs(i));
  const t = cpu0.getRegS32Lo(rt(i));
  const result = s - t;
  if (s32CheckSubOverflow(s, t, result)) {
    cpu0.raiseOverflowException();
    return; 
  }
  cpu0.setRegS32Extend(rd(i), result);
}

function generateSUBU(ctx) {
  const d = ctx.instr_rd();
  const s = ctx.instr_rs();
  const t = ctx.instr_rt();
  const impl = `
    const s = ${genSrcRegS32Lo(s)};
    const t = ${genSrcRegS32Lo(t)};
    c.setRegS32Extend(${d}, s - t);
    `;
  return generateTrivialOpBoilerplate(impl, ctx);
}
function executeSUBU(i) {
  const s = cpu0.getRegS32Lo(rs(i));
  const t = cpu0.getRegS32Lo(rt(i));
  const result = s - t;
  cpu0.setRegS32Extend(rd(i), result);
}

function generateTrivialLogical(ctx, op) {
  const d = ctx.instr_rd();
  const s = ctx.instr_rs();
  const t = ctx.instr_rt();
  const impl = `
    c.setRegU64(${d}, ${genSrcRegU64(s)} ${op} ${genSrcRegU64(t)});
    `;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateAND(ctx) { return generateTrivialLogical(ctx, '&'); }
function executeAND(i) {
  cpu0.setRegU64(rd(i), cpu0.getRegU64(rs(i)) & cpu0.getRegU64(rt(i)));
}

function generateOR(ctx) {
  const d = ctx.instr_rd();
  const s = ctx.instr_rs();
  const t = ctx.instr_rt();

  // OR is used to implement CLEAR and MOV
  if (t === 0) {
    const impl = `
      c.setRegS64LoHi(${d}, ${genSrcRegS32Lo(s)}, ${genSrcRegS32Hi(s)});
      `;
    return generateTrivialOpBoilerplate(impl, ctx);
  }
  return generateTrivialLogical(ctx, '|');
}

function executeOR(i) {
  cpu0.setRegU64(rd(i), cpu0.getRegU64(rs(i)) | cpu0.getRegU64(rt(i)));
}

function generateXOR(ctx) { return generateTrivialLogical(ctx, '^'); }
function executeXOR(i) {
  cpu0.setRegU64(rd(i), cpu0.getRegU64(rs(i)) ^ cpu0.getRegU64(rt(i)));
}

function generateNOR(ctx) {
  const d = ctx.instr_rd();
  const s = ctx.instr_rs();
  const t = ctx.instr_rt();
  const impl = `
    const hi = ~(${genSrcRegS32Hi(s)} | ${genSrcRegS32Hi(t)});
    const lo = ~(${genSrcRegS32Lo(s)} | ${genSrcRegS32Lo(t)});
    c.setRegS64LoHi(${d}, lo, hi);
    `;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function executeNOR(i) {
  cpu0.setRegU64(rd(i), ~(cpu0.getRegU64(rs(i)) | cpu0.getRegU64(rt(i))));
}

function generateSLT(ctx) {
  const d = ctx.instr_rd();
  const s = ctx.instr_rs();
  const t = ctx.instr_rt();

  const impl = `
    const r = ${genSrcRegS64(s)} < ${genSrcRegS64(t)} ? 1 : 0;
    c.setRegU32Extend(${d}, r);
    `;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function executeSLT(i) {
  const r = cpu0.getRegS64(rs(i)) < cpu0.getRegS64(rt(i)) ? 1 : 0;
  cpu0.setRegU32Extend(rd(i), r);
}

function generateSLTU(ctx) {
  const d = ctx.instr_rd();
  const s = ctx.instr_rs();
  const t = ctx.instr_rt();

  const impl = `
    const r = ${genSrcRegU64(s)} < ${genSrcRegU64(t)} ? 1 : 0;
    c.setRegU32Extend(${d}, r);
    `;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function executeSLTU(i) {
  const r = cpu0.getRegU64(rs(i)) < cpu0.getRegU64(rt(i)) ? 1 : 0;
  cpu0.setRegU32Extend(rd(i), r);
}

function executeDADD(i) {
  const s = cpu0.getRegS64(rs(i));
  const t = cpu0.getRegS64(rt(i));
  const result = s + t;
  if (s64CheckAddOverflow(s, t, result)) {
    cpu0.raiseOverflowException();
    return; 
  }
  cpu0.setRegU64(rd(i), result);
}

function executeDADDU(i) {
  const s = cpu0.getRegS64(rs(i));
  const t = cpu0.getRegS64(rt(i));
  const result = s + t;
  cpu0.setRegU64(rd(i), result);
}

function executeDSUB(i) {
  const s = cpu0.getRegS64(rs(i));
  const t = cpu0.getRegS64(rt(i));
  const result = s - t;
  if (s64CheckSubOverflow(s, t, result)) {
    cpu0.raiseOverflowException();
    return;
  }
  cpu0.setRegU64(rd(i), result);
}

function executeDSUBU(i) {
  const s = cpu0.getRegS64(rs(i));
  const t = cpu0.getRegS64(rt(i));
  const result = s - t;
  cpu0.setRegU64(rd(i), result);
}

function executeMFC0(i) {
  const controlReg = fs(i);

  // Check consistency
  if (controlReg === cpu0_constants.controlCause) {
    checkCauseIP3Consistent();
  }

  switch (controlReg) {
    case cpu0_constants.controlRand:
      cpu0.setRegS32Extend(rt(i), cpu0.getRandom());
      break;
    case cpu0_constants.controlInvalid7:
    case cpu0_constants.controlInvalid21:
    case cpu0_constants.controlInvalid22:
    case cpu0_constants.controlInvalid23:
    case cpu0_constants.controlInvalid24:
    case cpu0_constants.controlInvalid25:
    case cpu0_constants.controlInvalid31:
      // Reads from invalid control registers will use the value last written to any control register.
      cpu0.setRegS32Extend(rt(i), cpu0.lastControlRegWrite);
      break;
    default:
      cpu0.setRegS32Extend(rt(i), cpu0.control[controlReg]);
      break;
  }
}

function generateMTC0(ctx) {
  const s = ctx.instr_fs();
  if (s === cpu0_constants.controlStatus) {
    ctx.fragment.cop1statusKnown = false;
  }

  let impl = `
    n64js.executeMTC0(${toString32(ctx.instruction)});
    `;
  return generateGenericOpBoilerplate(impl, ctx);
}

function executeMTC0(i) {
  const controlReg = fs(i);
  const newValue = cpu0.getRegU32Lo(rt(i));

  cpu0.lastControlRegWrite = newValue;

  switch (controlReg) {
    case cpu0_constants.controlIndex:
      cpu0.control[controlReg] = newValue & indexWritableBits;
      break;

    case cpu0_constants.controlEntryLo0:
    case cpu0_constants.controlEntryLo1:
      cpu0.control[controlReg] = newValue & entryLoWritableBits;
      break;

    case cpu0_constants.controlContext:
      cpu0.control[controlReg] = newValue & contextWriteableBits;
      break;

    case cpu0_constants.controlPageMask:
      cpu0.control[controlReg] = newValue & pageMaskWritableBits;
      break;

    case cpu0_constants.controlWired:
      cpu0.control[controlReg] = newValue & wiredWritableBits;
      // Set to top limit on write to wired
      cpu0.control[cpu0_constants.controlRand] = 31;
      break;

    case cpu0_constants.controlEntryHi:
      // TODO: bits 8 to 12 are hardcoded to zero.
      cpu0.control[controlReg] = newValue;
      break;

    case cpu0_constants.controlRand:
    case cpu0_constants.controlBadVAddr:
    case cpu0_constants.controlPRId:
    case cpu0_constants.controlCacheErr:
      // All these registers are read-only
      break;

    case cpu0_constants.controlCause:
      logger.log(`Setting cause register to ${toString32(newValue)}`);
      n64js.check(newValue === 0, 'Should only write 0 to Cause register.');
      cpu0.control[controlReg] &= ~causeWritableBits;
      cpu0.control[controlReg] |= (newValue & causeWritableBits);
      break;

    case cpu0_constants.controlStatus:
      cpu0.setStatus(newValue);
      break;
    case cpu0_constants.controlCount:
      cpu0.control[controlReg] = newValue;
      break;
    case cpu0_constants.controlCompare:
      cpu0.setCompare(newValue);
      break;

    case cpu0_constants.controlXContext:
      // TODO: only the high bits are writable but we don't implement 64 bit registers yet.
      // Just no-op for now.
      break;

    case cpu0_constants.controlEPC:
    case cpu0_constants.controlTagLo:
    case cpu0_constants.controlTagHi:
      cpu0.control[controlReg] = newValue;
      break;

    case cpu0_constants.controlLLAddr:
      cpu0.control[controlReg] = newValue;
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

    default:
      cpu0.control[controlReg] = newValue;
      logger.log(`Write to cpu0 control register. ${toString32(newValue)} --> ${cop0ControlRegisterNames[controlReg]}`);
      break;
  }
}

function executeDMFC0(i) {
  // TODO: Implement this correctly.
  executeMFC0(i);
}

function executeDMTC0(i) {
  // TODO: Implement this correctly.
  executeMTC0(i);
}

function executeTLB(i) {
  switch (tlbop(i)) {
    case 0x01: cpu0.tlbRead(); return;
    case 0x02: cpu0.tlbWriteIndex(); return;
    case 0x06: cpu0.tlbWriteRandom(); return;
    case 0x08: cpu0.tlbProbe(); return;
    case 0x18: executeERET(i); return;
  }
  executeUnknown(i);
}

function executeERET(i) {
  if (cpu0.control[cpu0_constants.controlStatus] & SR_ERL) {
    cpu0.nextPC = cpu0.control[cpu0_constants.controlErrorEPC];
    cpu0.control[cpu0_constants.controlStatus] &= ~SR_ERL;
    logger.log('ERET from error trap - ' + cpu0.nextPC);
  } else {
    cpu0.nextPC = cpu0.control[cpu0_constants.controlEPC];
    cpu0.control[cpu0_constants.controlStatus] &= ~SR_EXL;
    //logger.log('ERET from interrupt/exception ' + cpu0.nextPC);
  }

  cpu0.llBit = 0;
}

function executeTGE(i) {
  cpu0.maybeRaiseTRAPException(cpu0.getRegS64(rs(i)) >= cpu0.getRegS64(rt(i)));
}
function executeTGEU(i) {
  cpu0.maybeRaiseTRAPException(cpu0.getRegU64(rs(i)) >= cpu0.getRegU64(rt(i)));
}
function executeTLT(i) {
  cpu0.maybeRaiseTRAPException(cpu0.getRegS64(rs(i)) < cpu0.getRegS64(rt(i)));
}
function executeTLTU(i) {
  cpu0.maybeRaiseTRAPException(cpu0.getRegU64(rs(i)) < cpu0.getRegU64(rt(i)));
}
function executeTEQ(i) {
  cpu0.maybeRaiseTRAPException(cpu0.getRegS64(rs(i)) == cpu0.getRegS64(rt(i)));
}
function executeTNE(i) {
  cpu0.maybeRaiseTRAPException(cpu0.getRegS64(rs(i)) != cpu0.getRegS64(rt(i)));
}

function executeTGEI(i) {
  cpu0.maybeRaiseTRAPException(cpu0.getRegS64(rs(i)) >= BigInt(imms(i)));
}
function executeTGEIU(i) {
  cpu0.maybeRaiseTRAPException(cpu0.getRegU64(rs(i)) >= BigInt.asUintN(64, BigInt(imms(i))));
}
function executeTLTI(i) {
  cpu0.maybeRaiseTRAPException(cpu0.getRegS64(rs(i)) < BigInt(imms(i)));
}
function executeTLTIU(i) {
  cpu0.maybeRaiseTRAPException(cpu0.getRegU64(rs(i)) < BigInt.asUintN(64, BigInt(imms(i))));
}
function executeTEQI(i) {
  cpu0.maybeRaiseTRAPException(cpu0.getRegS64(rs(i)) == BigInt(imms(i)));
}
function executeTNEI(i) {
  cpu0.maybeRaiseTRAPException(cpu0.getRegS64(rs(i)) != BigInt(imms(i)));
}

// Jump
function generateJ(ctx) {
  const addr = jumpAddress(ctx.pc, ctx.instruction);
  const impl = 'c.delayPC = ' + toString32(addr) + ';\n';
  return generateBranchOpBoilerplate(impl, ctx, false);
}
function executeJ(i) {
  performBranch(jumpAddress(cpu0.pc, i));
}

function generateJAL(ctx) {
  const addr = jumpAddress(ctx.pc, ctx.instruction);
  const ra = ctx.pc + 8;
  // Optimise as sign is known at compile time.
  const ra_hi = (ra & 0x80000000) ? -1 : 0;
  const impl = `
    c.delayPC = ${toString32(addr)};
    c.setRegS64LoHi(${cpu0_constants.RA}, ${toString32(ra)}, ${ra_hi});
    `;
  return generateBranchOpBoilerplate(impl, ctx, false);
}
function executeJAL(i) {
  cpu0.setRegS32Extend(cpu0_constants.RA, cpu0.pc + 8);
  performBranch(jumpAddress(cpu0.pc, i));
}

function generateJALR(ctx) {
  const s = ctx.instr_rs();
  const d = ctx.instr_rd();

  const ra = ctx.pc + 8;
  const ra_hi = (ra & 0x80000000) ? -1 : 0;
  const impl = `
    c.delayPC = ${genSrcRegU32Lo(s)};  // NB needs to be unsigned
    c.setRegS64LoHi(${d}, ${toString32(ra)}, ${ra_hi});
    `;
  return generateBranchOpBoilerplate(impl, ctx, false);
}
function executeJALR(i) {
  const new_pc = cpu0.getRegU32Lo(rs(i));
  cpu0.setRegS32Extend(rd(i), cpu0.pc + 8);
  performBranch(new_pc);
}

function generateJR(ctx) {
  const impl = `
    c.delayPC = ${genSrcRegU32Lo(ctx.instr_rs())}; // NB needs to be unsigned
    `;
  return generateBranchOpBoilerplate(impl, ctx, false);
}
function executeJR(i) {
  performBranch(cpu0.getRegU32Lo(rs(i)));
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
    impl += '}\n';
  }

  return generateBranchOpBoilerplate(impl, ctx, false);
}

function executeBEQ(i) {
  if (cpu0.getRegU64(rs(i)) === cpu0.getRegU64(rt(i))) {
    if (offset(i) === -1)
      cpu0.speedHack();
    performBranch(branchAddress(cpu0.pc, i));
  }
}

function generateBEQL(ctx) {
  const s = ctx.instr_rs();
  const t = ctx.instr_rt();
  const addr = branchAddress(ctx.pc, ctx.instruction);

  const impl = `
    if (${genSrcRegU64(s)} === ${genSrcRegU64(t)}) {
      c.delayPC = ${toString32(addr)};
    } else {
      c.nextPC += 4;
    }
    `;

  return generateBranchOpBoilerplate(impl, ctx, true /* might_adjust_next_pc*/);
}

function executeBEQL(i) {
  if (cpu0.getRegU64(rs(i)) === cpu0.getRegU64(rt(i))) {
    performBranch(branchAddress(cpu0.pc, i));
  } else {
    cpu0.nextPC += 4;   // skip the next instruction
  }
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
  impl += '}\n';

  return generateBranchOpBoilerplate(impl, ctx, false);
}

function executeBNE(i) {
  if (cpu0.getRegU64(rs(i)) !== cpu0.getRegU64(rt(i))) {
    performBranch(branchAddress(cpu0.pc, i));
  }
}


function generateBNEL(ctx) {
  const s = ctx.instr_rs();
  const t = ctx.instr_rt();
  const addr = branchAddress(ctx.pc, ctx.instruction);

  const impl = `
    if (${genSrcRegU64(s)} !== ${genSrcRegU64(t)}) {
      c.delayPC = ${toString32(addr)};
    } else {
      c.nextPC += 4;
    }
    `;

  return generateBranchOpBoilerplate(impl, ctx, true /* might_adjust_next_pc*/);
}

function executeBNEL(i) {
  if (cpu0.getRegU64(rs(i)) !== cpu0.getRegU64(rt(i))) {
    performBranch(branchAddress(cpu0.pc, i));
  } else {
    cpu0.nextPC += 4;   // skip the next instruction
  }
}

// Branch Less Than or Equal To Zero
function generateBLEZ(ctx) {
  const s = ctx.instr_rs();
  const addr = branchAddress(ctx.pc, ctx.instruction);

  const impl = `
    if ( ${genSrcRegS64(s)} <= 0n) {
      c.delayPC = ${toString32(addr)};
    }
    `;

  return generateBranchOpBoilerplate(impl, ctx, false);
}

function executeBLEZ(i) {
  if (cpu0.getRegS64(rs(i)) <= 0n) {
    performBranch(branchAddress(cpu0.pc, i));
  }
}

function executeBLEZL(i) {
  // NB: if rs == r0 then this branch is always taken
  if (cpu0.getRegS64(rs(i)) <= 0n) {
    performBranch(branchAddress(cpu0.pc, i));
  } else {
    cpu0.nextPC += 4;   // skip the next instruction
  }
}

// Branch Greater Than Zero
function generateBGTZ(ctx) {
  const s = ctx.instr_rs();
  const addr = branchAddress(ctx.pc, ctx.instruction);

  const impl = `
    if (${genSrcRegS64(s)} > 0) {
      c.delayPC = ${toString32(addr)};
    }
    `;

  return generateBranchOpBoilerplate(impl, ctx, false);
}

function executeBGTZ(i) {
  if (cpu0.getRegS64(rs(i)) > 0n) {
    performBranch(branchAddress(cpu0.pc, i));
  }
}

function executeBGTZL(i) {
  if (cpu0.getRegS64(rs(i)) > 0n) {
    performBranch(branchAddress(cpu0.pc, i));
  } else {
    cpu0.nextPC += 4;   // skip the next instruction
  }
}

// Branch Less Than Zero
function generateBLTZ(ctx) {
  const s = ctx.instr_rs();
  const addr = branchAddress(ctx.pc, ctx.instruction);

  const impl = `
    if (${genSrcRegS64(s)} < 0n) {
      c.delayPC = ${toString32(addr)};
    }
    `;

  return generateBranchOpBoilerplate(impl, ctx, false);
}

function executeBLTZ(i) {
  if (cpu0.getRegS64(rs(i)) < 0n) {
    performBranch(branchAddress(cpu0.pc, i));
  }
}

function generateBLTZL(ctx) {
  const s = ctx.instr_rs();
  const addr = branchAddress(ctx.pc, ctx.instruction);

  const impl = `
    if (${genSrcRegS64(s)} < 0n) {
      c.delayPC = ${toString32(addr)};
    } else {
      c.nextPC += 4;
    }
    `;

  return generateBranchOpBoilerplate(impl, ctx, true /* might_adjust_next_pc*/);
}

function executeBLTZL(i) {
  if (cpu0.getRegS64(rs(i)) < 0n) {
    performBranch(branchAddress(cpu0.pc, i));
  } else {
    cpu0.nextPC += 4;   // skip the next instruction
  }
}

function executeBLTZAL(i) {
  const cond = cpu0.getRegS64(rs(i)) < 0n;
  cpu0.setRegS32Extend(cpu0_constants.RA, cpu0.pc + 8);
  if (cond) {
    performBranch(branchAddress(cpu0.pc, i));
  }
}

function executeBLTZALL(i) {
  const cond = cpu0.getRegS64(rs(i)) < 0;
  cpu0.setRegS32Extend(cpu0_constants.RA, cpu0.pc + 8);
  if (cond) {
    performBranch(branchAddress(cpu0.pc, i));
  } else {
    cpu0.nextPC += 4;   // skip the next instruction
  }
}

// Branch Greater Than Zero
function generateBGEZ(ctx) {
  const s = ctx.instr_rs();
  const addr = branchAddress(ctx.pc, ctx.instruction);

  const impl = `
    if (${genSrcRegS64(s)} >= 0n) {
      c.delayPC = ${toString32(addr)};
    }
    `;

  return generateBranchOpBoilerplate(impl, ctx, false);
}

function executeBGEZ(i) {
  if (cpu0.getRegS64(rs(i)) >= 0n) {
    performBranch(branchAddress(cpu0.pc, i));
  }
}

function generateBGEZL(ctx) {
  const s = ctx.instr_rs();
  const addr = branchAddress(ctx.pc, ctx.instruction);

  const impl = `
    if (${genSrcRegS64(s)} >= 0n) {
      c.delayPC = ${toString32(addr)};
    } else {
      c.nextPC += 4;
    }
    `;

  return generateBranchOpBoilerplate(impl, ctx, true /* might_adjust_next_pc*/);
}

function executeBGEZL(i) {
  if (cpu0.getRegS64(rs(i)) >= 0n) {
    performBranch(branchAddress(cpu0.pc, i));
  } else {
    cpu0.nextPC += 4;   // skip the next instruction
  }
}

function executeBGEZAL(i) {
  const cond = cpu0.getRegS64(rs(i)) >= 0n;
  cpu0.setRegS32Extend(cpu0_constants.RA, cpu0.pc + 8);
  if (cond) {
    performBranch(branchAddress(cpu0.pc, i));
  }
}

function executeBGEZALL(i) {
  const cond = cpu0.getRegS64(rs(i)) >= 0n;
  cpu0.setRegS32Extend(cpu0_constants.RA, cpu0.pc + 8);
  if (cond) {
    performBranch(branchAddress(cpu0.pc, i));
  } else {
    cpu0.nextPC += 4;   // skip the next instruction
  }
}

function generateADDI(ctx) {
  const s = ctx.instr_rs();
  const t = ctx.instr_rt();
  const impl = `
    const s = ${genSrcRegS32Lo(s)};
    const imm = ${imms(ctx.instruction)};
    const result = s + imm;
    if (n64js.s32CheckAddOverflow(s, imm, result)) {
      c.raiseOverflowException();
    } else {
      c.setRegS32Extend(${t}, result);
    }
    `;
  // Use the generic boilerplate because we might have generated an overflow exception.
  return generateGenericOpBoilerplate(impl, ctx);
}

function executeADDI(i) {
  const s = cpu0.getRegS32Lo(rs(i));
  const imm = imms(i);
  const result = s + imm;
  if (s32CheckAddOverflow(s, imm, result)) {
    cpu0.raiseOverflowException();
    return; 
  }
  cpu0.setRegS32Extend(rt(i), result);
}

function generateADDIU(ctx) {
  const s = ctx.instr_rs();
  const t = ctx.instr_rt();
  const impl = `
    const s = ${genSrcRegS32Lo(s)};
    const imm = ${imms(ctx.instruction)};
    const result = s + imm;
    c.setRegS32Extend(${t}, result);
    `;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function executeADDIU(i) {
  const s = cpu0.getRegS32Lo(rs(i));
  const imm = imms(i);
  const result = s + imm;
  cpu0.setRegS32Extend(rt(i), result);
}

function executeDADDI(i) {
  const s = cpu0.getRegS64(rs(i));
  const imm = BigInt(imms(i));
  const result = s + imm;
  if (s64CheckAddOverflow(s, imm, result)) {
    cpu0.raiseOverflowException();
    return; 
  }
  cpu0.setRegU64(rt(i), result);
}

function executeDADDIU(i) {
  const s = cpu0.getRegS64(rs(i));
  const imm = BigInt(imms(i));
  const result = s + imm;
  cpu0.setRegU64(rt(i), result);
}

function generateSLTI(ctx) {
  const s = ctx.instr_rs();
  const t = ctx.instr_rt();

  const immediate = imms(ctx.instruction);
  const impl = `
    c.setRegU32Extend(${t}, c.getRegS64(${s}) < ${immediate}n ? 1 : 0);
    `;

  return generateTrivialOpBoilerplate(impl, ctx);
}

function executeSLTI(i) {
  const immediate = BigInt(imms(i));
  cpu0.setRegU32Extend(rt(i), cpu0.getRegS64(rs(i)) < immediate ? 1 : 0);
}

function generateSLTIU(ctx) {
  const s = ctx.instr_rs();
  const t = ctx.instr_rt();

  // Immediate value is sign-extended to 64 bits and treated as a u64.
  const immediate = BigInt.asUintN(64, BigInt(imms(ctx.instruction)));
  const impl = `
    c.setRegU32Extend(${t}, c.getRegU64(${s}) < ${immediate}n ? 1 : 0);
    `;

  return generateTrivialOpBoilerplate(impl, ctx);
}

function executeSLTIU(i) {
  // Immediate value is sign-extended to 64 bits and treated as a u64.
  const immediate = BigInt.asUintN(64, BigInt(imms(i)));
  cpu0.setRegU32Extend(rt(i), cpu0.getRegU64(rs(i)) < immediate ? 1 : 0);
}

function generateANDI(ctx) {
  const s = ctx.instr_rs();
  const t = ctx.instr_rt();
  const impl = `
    c.setRegU64(${t}, ${genSrcRegU64(s)} & BigInt(${imm(ctx.instruction)}));
    `;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function executeANDI(i) {
  cpu0.setRegU64(rt(i), cpu0.getRegU64(rs(i)) & BigInt(imm(i)));
}

function generateORI(ctx) {
  const s = ctx.instr_rs();
  const t = ctx.instr_rt();
  const impl = `
    c.setRegU64(${t}, ${genSrcRegU64(s)} | BigInt(${imm(ctx.instruction)}));
    `;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function executeORI(i) {
  cpu0.setRegU64(rt(i), cpu0.getRegU64(rs(i)) | BigInt(imm(i)));
}

function generateXORI(ctx) {
  const s = ctx.instr_rs();
  const t = ctx.instr_rt();
  const impl = `
    c.setRegU64(${t}, ${genSrcRegU64(s)} ^ BigInt(${imm(ctx.instruction)}));
    `;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function executeXORI(i) {
  cpu0.setRegU64(rt(i), cpu0.getRegU64(rs(i)) ^ BigInt(imm(i)));
}

function generateLUI(ctx) {
  const t = ctx.instr_rt();
  const value_lo = imms(ctx.instruction) << 16;
  const value_hi = (value_lo < 0) ? -1 : 0;

  const impl = `
    c.setRegS64LoHi(${t}, ${value_lo}, ${value_hi});
    `;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function executeLUI(i) {
  cpu0.setRegS32Extend(rt(i), imms(i) << 16);
}

function generateLB(ctx) {
  const t = ctx.instr_rt();
  const b = ctx.instr_base();
  const o = ctx.instr_imms();

  const impl = `
    const value = n64js.load_s8(ram, ${genSrcRegS32Lo(b)} + ${o});
    c.setRegS32Extend(${t}, value);
    `;

  return generateMemoryAccessBoilerplate(impl, ctx);
}

function executeLB(i) {
  const value = n64js.load_s8(cpu0.ram, cpu0.getRegS32Lo(base(i)) + imms(i));
  cpu0.setRegS32Extend(rt(i), value);
}

function generateLBU(ctx) {
  const t = ctx.instr_rt();
  const b = ctx.instr_base();
  const o = ctx.instr_imms();

  const impl = `
    const value = n64js.load_u8(ram, ${genSrcRegS32Lo(b)} + ${o});
    c.setRegU32Extend(${t}, value);
    `;

  return generateMemoryAccessBoilerplate(impl, ctx);
}

function executeLBU(i) {
  const value = n64js.load_u8(cpu0.ram, cpu0.getRegS32Lo(base(i)) + imms(i));
  cpu0.setRegU32Extend(rt(i), value);
}

function generateLH(ctx) {
  const t = ctx.instr_rt();
  const b = ctx.instr_base();
  const o = ctx.instr_imms();

  const impl = `
    const value = n64js.load_s16(ram, ${genSrcRegS32Lo(b)} + ${o});
    c.setRegS32Extend(${t}, value);
    `;

  return generateMemoryAccessBoilerplate(impl, ctx);
}

function executeLH(i) {
  const value = n64js.load_s16(cpu0.ram, cpu0.getRegS32Lo(base(i)) + imms(i));
  cpu0.setRegS32Extend(rt(i), value);
}

function generateLHU(ctx) {
  const t = ctx.instr_rt();
  const b = ctx.instr_base();
  const o = ctx.instr_imms();

  const impl = `
    const value = n64js.load_u16(ram, ${genSrcRegS32Lo(b)} + ${o});
    c.setRegU32Extend(${t}, value);
    `;

  return generateMemoryAccessBoilerplate(impl, ctx);
}

function executeLHU(i) {
  const value = n64js.load_u16(cpu0.ram, cpu0.getRegS32Lo(base(i)) + imms(i));
  cpu0.setRegU32Extend(rt(i), value);
}

function generateLW(ctx) {
  const t = ctx.instr_rt();
  const b = ctx.instr_base();
  const o = ctx.instr_imms();
  // SF2049 requires this, apparently
  if (t === 0)
    return generateNOPBoilerplate('load to r0!', ctx);

  const impl = `
    const value = n64js.load_s32(ram, ${genSrcRegS32Lo(b)} + ${o});
    c.setRegS32Extend(${t}, value);
    `;

  return generateMemoryAccessBoilerplate(impl, ctx);
}

function executeLW(i) {
  // SF2049 requires this, apparently
  if (rt(i) === 0) {
    return;
  }

  const value = n64js.load_s32(cpu0.ram, cpu0.getRegS32Lo(base(i)) + imms(i));
  cpu0.setRegS32Extend(rt(i), value);
}

function generateLWU(ctx) {
  const t = ctx.instr_rt();
  const b = ctx.instr_base();
  const o = ctx.instr_imms();

  const impl = `
    const value = n64js.load_u32(ram, ${genSrcRegS32Lo(b)} + ${o});
    c.setRegU32Extend(${t}, value);
    `;

  return generateMemoryAccessBoilerplate(impl, ctx);
}

function executeLWU(i) {
  const value = n64js.load_u32(cpu0.ram, cpu0.getRegS32Lo(base(i)) + imms(i));
  cpu0.setRegU32Extend(rt(i), value);
}

function generateLD(ctx) {
  const t = ctx.instr_rt();
  const b = ctx.instr_base();
  const o = ctx.instr_imms();

  const impl = `
    const value = n64js.load_u64_bigint(ram, ${genSrcRegS32Lo(b)} + ${o});
    c.setRegU64(${t}, value);
    `;
  return generateMemoryAccessBoilerplate(impl, ctx);
}

function executeLD(i) {
  const value = n64js.load_u64_bigint(cpu0.ram, cpu0.getRegS32Lo(base(i)) + imms(i));
  cpu0.setRegU64(rt(i), value);
}

function generateLWC1(ctx) {
  const t = ctx.instr_ft();
  const b = ctx.instr_base();
  const o = ctx.instr_imms();

  ctx.fragment.usesCop1 = true;

  const impl = `
    if (c.checkCopXUsable(1)) {
      cpu1.storeS32(${t}, n64js.load_s32(ram, ${genSrcRegS32Lo(b)} + ${o}));
    }
    `;
  return generateMemoryAccessBoilerplate(impl, ctx);
}

function executeLWC1(i) {
  if (!cpu0.checkCopXUsable(1)) {
    return;
  }
  cpu1.storeS32(ft(i), n64js.load_s32(cpu0.ram, cpu0.getRegS32Lo(base(i)) + imms(i)));
}

function generateLDC1(ctx) {
  const t = ctx.instr_ft();
  const b = ctx.instr_base();
  const o = ctx.instr_imms();

  ctx.fragment.usesCop1 = true;

  const impl = `
    if (c.checkCopXUsable(1)) {
      const value = n64js.load_u64_bigint(ram, ${genSrcRegS32Lo(b)} + ${o});
      cpu1.storeU64(${t}, value);
    }
    `;
  return generateMemoryAccessBoilerplate(impl, ctx);
}

function executeLDC1(i) {
  if (!cpu0.checkCopXUsable(1)) {
    return;
  }

  const value = n64js.load_u64_bigint(cpu0.ram, cpu0.getRegS32Lo(base(i)) + imms(i));
  cpu1.storeU64(ft(i), value);
}

function executeLDC2(i) { unimplemented(cpu0.pc, i); }

function executeLWL(i) {
  const addr = (cpu0.getRegU32Lo(base(i)) + imms(i)) >>> 0;
  const addrAligned = (addr & ~3) >>> 0;
  const mem = n64js.readMemoryU32(addrAligned);
  const reg = cpu0.getRegU32Lo(rt(i));

  const n = addr & 3;
  const shift = 8 * n;
  const allBits = 0xffff_ffff;
  const mask = shift ? allBits >>> (32 - shift) : 0; // >>>32 is undefined.

  const result = (reg & mask) | (mem << shift);
  cpu0.setRegS32Extend(rt(i), result);
}

function executeLWR(i) {
  const addr = (cpu0.getRegU32Lo(base(i)) + imms(i)) >>> 0;
  const addrAligned = (addr & ~3) >>> 0;
  const mem = n64js.readMemoryU32(addrAligned);
  const reg = cpu0.getRegU32Lo(rt(i));

  const n = addr & 3;
  const shift = 8 * (3 - n);
  const allBits = 0xffff_ffff;
  const mask = ~(allBits >>> shift);

  const result = (reg & mask) | (mem >>> shift);
  cpu0.setRegS32Extend(rt(i), result);
}

function executeLDL(i) {
  const addr = (cpu0.getRegU32Lo(base(i)) + imms(i)) >>> 0;
  const addrAligned = (addr & ~7) >>> 0;
  const mem = n64js.load_u64_bigint(cpu0.ram, addrAligned);
  const reg = cpu0.getRegU64(rt(i));

  const n = addr & 7;
  const shift = BigInt(8 * n);
  const allBits = 0xffff_ffff_ffff_ffffn;
  const mask = allBits >> (64n - shift);

  // Final mask shouldn't be needed - BigInt bug?
  const result = ((reg & mask) | (mem << shift)) & allBits;
  cpu0.setRegU64(rt(i), result);
}

function executeLDR(i) {
  const addr = (cpu0.getRegU32Lo(base(i)) + imms(i)) >>> 0;
  const addrAligned = (addr & ~7) >>> 0;
  const mem = n64js.load_u64_bigint(cpu0.ram, addrAligned);
  const reg = cpu0.getRegU64(rt(i));

  const n = addr & 7;
  const shift = BigInt(8 * (7 - n));
  const allBits = 0xffff_ffff_ffff_ffffn;
  const mask = ~(allBits >> shift);

  const result = (reg & mask) | (mem >> shift);
  cpu0.setRegU64(rt(i), result);
}

function generateSB(ctx) {
  const t = ctx.instr_rt();
  const b = ctx.instr_base();
  const o = ctx.instr_imms();

  const impl = `
    n64js.store_8(ram, ${genSrcRegS32Lo(b)} + ${o}, ${genSrcRegS32Lo(t)});
    `;
  return generateMemoryAccessBoilerplate(impl, ctx);
}

function executeSB(i) {
  const addr = cpu0.getRegS32Lo(base(i)) + imms(i);
  n64js.store_8(cpu0.ram, addr, cpu0.getRegS32Lo(rt(i)) /*& 0xff*/);
}

function generateSH(ctx) {
  const t = ctx.instr_rt();
  const b = ctx.instr_base();
  const o = ctx.instr_imms();

  const impl = `
    n64js.store_16(ram, ${genSrcRegS32Lo(b)} + ${o}, ${genSrcRegS32Lo(t)});
    `;
  return generateMemoryAccessBoilerplate(impl, ctx);
}

function executeSH(i) {
  const addr = cpu0.getRegS32Lo(base(i)) + imms(i);
  n64js.store_16(cpu0.ram, addr, cpu0.getRegS32Lo(rt(i)) /*& 0xffff*/);
}

function generateSW(ctx) {
  const t = ctx.instr_rt();
  const b = ctx.instr_base();
  const o = ctx.instr_imms();

  const impl = `
    n64js.store_32(ram, ${genSrcRegS32Lo(b)} + ${o}, ${genSrcRegS32Lo(t)});
    `;
  return generateMemoryAccessBoilerplate(impl, ctx);
}

function executeSW(i) {
  const addr = cpu0.getRegS32Lo(base(i)) + imms(i);
  n64js.store_32(cpu0.ram, addr, cpu0.getRegS32Lo(rt(i)));
}

function generateSD(ctx) {
  const t = ctx.instr_rt();
  const b = ctx.instr_base();
  const o = ctx.instr_imms();

  const impl = `
    const addr = ${genSrcRegS32Lo(b)} + ${o};
    n64js.store_64_bigint(ram, addr, ${genSrcRegU64(t)});
    `;
  return generateMemoryAccessBoilerplate(impl, ctx);
}

function executeSD(i) {
  const addr = cpu0.getRegS32Lo(base(i)) + imms(i);
  n64js.store_64_bigint(cpu0.ram, addr, cpu0.getRegU64(rt(i)));
}

function generateSWC1(ctx) {
  const t = ctx.instr_ft();
  const b = ctx.instr_base();
  const o = ctx.instr_imms();

  ctx.fragment.usesCop1 = true;

  // FIXME: can avoid cpuStuffToDo if we're writing to ram
  const impl = `
    if (c.checkCopXUsable(1)) {
      n64js.store_32(ram, ${genSrcRegS32Lo(b)} + ${o}, cpu1.loadS32(${t}));
    }
    `;
  return generateMemoryAccessBoilerplate(impl, ctx);
}

function executeSWC1(i) {
  if (!cpu0.checkCopXUsable(1)) {
    return;
  }
  n64js.store_32(cpu0.ram, cpu0.getRegS32Lo(base(i)) + imms(i), cpu1.loadS32(ft(i)));
}

function generateSDC1(ctx) {
  const t = ctx.instr_ft();
  const b = ctx.instr_base();
  const o = ctx.instr_imms();

  ctx.fragment.usesCop1 = true;

  // FIXME: can avoid cpuStuffToDo if we're writing to ram
  const impl = `
    if (c.checkCopXUsable(1)) {
      const addr = ${genSrcRegS32Lo(b)} + ${o};
      n64js.store_64_bigint(ram, addr, cpu1.loadS64(${t}));
    }
    `;
  return generateMemoryAccessBoilerplate(impl, ctx);
}

function executeSDC1(i) {
  if (!cpu0.checkCopXUsable(1)) {
    return;
  }
  // FIXME: this can do a single check that the address is in ram
  const addr = cpu0.getRegS32Lo(base(i)) + imms(i);
  n64js.store_64_bigint(cpu0.ram, addr, cpu1.loadS64(ft(i)));
}

function executeSDC2(i) { unimplemented(cpu0.pc, i); }

function executeSWL(i) {
  const addr = (cpu0.getRegU32Lo(base(i)) + imms(i));
  const addrAligned = (addr & ~3) >>> 0;
  const mem = n64js.readMemoryU32(addrAligned);
  const reg = cpu0.getRegU32Lo(rt(i));

  const n = addr & 3;
  const shift = 8 * n;
  const allBits = 0xffff_ffff;
  const mask = ~(allBits >>> shift);

  const result = (mem & mask) | (reg >>> shift);
  n64js.writeMemory32(addrAligned, result);
}

function executeSWR(i) {
  const addr = (cpu0.getRegU32Lo(base(i)) + imms(i));
  const addrAligned = (addr & ~3) >>> 0;
  const mem = n64js.readMemoryU32(addrAligned);
  const reg = cpu0.getRegU32Lo(rt(i));

  const n = addr & 3;
  const shift = 8 * (3 - n);
  const allBits = 0xffff_ffff;
  const mask = shift > 0 ? allBits >>> (32 - shift) : 0; // >>>32 is undefined.

  const result = (mem & mask) | (reg << shift);
  n64js.writeMemory32(addrAligned, result);
}

function executeSDL(i) {
  const addr = (cpu0.getRegU32Lo(base(i)) + imms(i)) >>> 0;
  const addrAligned = (addr & ~7) >>> 0;
  const mem = n64js.load_u64_bigint(cpu0.ram, addrAligned);
  const reg = cpu0.getRegU64(rt(i));

  const n = addr & 7;
  const shift = BigInt(8 * n);
  const allBits = 0xffff_ffff_ffff_ffffn;
  const mask = ~(allBits >> shift);

  const result = (mem & mask) | (reg >> shift);
  n64js.store_64_bigint(cpu0.ram, addrAligned, result);
}

function executeSDR(i) {
  const addr = (cpu0.getRegU32Lo(base(i)) + imms(i)) >>> 0;
  const addrAligned = (addr & ~7) >>> 0;
  const mem = n64js.load_u64_bigint(cpu0.ram, addrAligned);
  const reg = cpu0.getRegU64(rt(i));

  const n = addr & 7;
  const shift = BigInt(8 * (7 - n));
  const allBits = 0xffff_ffff_ffff_ffffn;
  const mask = allBits >> (64n - shift);

  // Final mask shouldn't be needed - BigInt bug?
  const result = ((mem & mask) | (reg << shift)) & allBits;
  n64js.store_64_bigint(cpu0.ram, addrAligned, result);
}

function generateCACHE(ctx) {
  const b = ctx.instr_base();
  const o = ctx.instr_imms();
  const cache_op = ctx.instr_rt();
  const cache = (cache_op) & 0x3;
  const action = (cache_op >>> 2) & 0x7;

  if (cache === 0 && (action === 0 || action === 4)) {
    const impl = `
      const addr = ${genSrcRegS32Lo(b)} + ${o};
      n64js.invalidateICacheEntry(addr);
      `;
    return generateTrivialOpBoilerplate(impl, ctx);
  } else {
    return generateNOPBoilerplate('CACHE (ignored)', ctx);
  }
}

function executeCACHE(i) {
  const cache_op = rt(i);
  const cache = (cache_op) & 0x3;
  const action = (cache_op >>> 2) & 0x7;

  if (cache === 0 && (action === 0 || action === 4)) {
    // NB: only bother generating address if we handle the instruction - memaddr deopts like crazy
    const address = (cpu0.getRegU32Lo(base(i)) + imms(i));
    n64js.invalidateICacheEntry(address);
  }
}

// TODO: move this somewhere central.
function physicalAddress(addr) {
  return addr & (~0xe0000000)
}

function makeLLAddr(addr) {
  return physicalAddress(addr) >>> 4;
}

function executeLL(i) {
  const addr = (cpu0.getRegS32Lo(base(i)) + imms(i)) >>> 0;
  const value = n64js.load_s32(cpu0.ram, addr);

  cpu0.control[cpu0_constants.controlLLAddr] = makeLLAddr(addr);
  cpu0.setRegS32Extend(rt(i), value);
  cpu0.llBit = 1;
}

function executeLLD(i) {
  const addr = (cpu0.getRegS32Lo(base(i)) + imms(i)) >>> 0;
  
  cpu0.control[cpu0_constants.controlLLAddr] = makeLLAddr(addr);
  const hi = n64js.load_s32(cpu0.ram, addr);
  const lo = n64js.load_s32(cpu0.ram, addr + 4);
  cpu0.setRegS64LoHi(rt(i), lo, hi);
  cpu0.llBit = 1;
}

function executeSC(i) {
  const t = rt(i);
  let result = 0;
  if (cpu0.llBit) {
    const addr = cpu0.getRegS32Lo(base(i)) + imms(i);
    n64js.store_32(cpu0.ram, addr, cpu0.getRegS32Lo(t));
    cpu0.llBit = 0;
    result = 1;
  }
  cpu0.setRegU32Extend(t, result);
}

function executeSCD(i) {
  const t = rt(i);

  let result = 0;
  if (cpu0.llBit) {
    const addr = cpu0.getRegS32Lo(base(i)) + imms(i);
    n64js.store_64_bigint(cpu0.ram, addr, cpu0.getRegU64(t));
    cpu0.llBit = 0;
    result = 1;
  }
  cpu0.setRegU32Extend(t, result);
}

function generateMFC1Stub(ctx) {
  const t = ctx.instr_rt();
  const s = ctx.instr_fs();

  ctx.fragment.usesCop1 = true;
  ctx.isTrivial = true;

  return `
    c.setRegS32Extend(${t}, cpu1.loadS32(${s}));
    `;
}

function executeMFC1(i) {
  cpu0.setRegS32Extend(rt(i), cpu1.loadS32(fs(i)));
}

function generateDMFC1Stub(ctx) {
  const t = ctx.instr_rt();
  const s = ctx.instr_fs();

  ctx.fragment.usesCop1 = true;
  ctx.isTrivial = true;

  return `
    c.setRegU64(${t}, cpu1.loadU64(${s}));
    `;
}

function executeDMFC1(i) {
  cpu0.setRegU64(rt(i), cpu1.loadU64(fs(i)));
}

function generateMTC1Stub(ctx) {
  const s = ctx.instr_fs();
  const t = ctx.instr_rt();

  ctx.fragment.usesCop1 = true;
  ctx.isTrivial = true;

  return `
    cpu1.storeS32(${s}, ${genSrcRegS32Lo(t)});
    `;
}

function executeMTC1(i) {
  cpu1.storeS32(fs(i), cpu0.getRegS32Lo(rt(i)));
}

function generateDMTC1Stub(ctx) {
  const s = ctx.instr_fs();
  const t = ctx.instr_rt();
  ctx.fragment.usesCop1 = true;
  ctx.isTrivial = true;

  return `
    cpu1.storeU64(${s}, ${genSrcRegS64(t)});
    `;
}

function executeDMTC1(i) {
  const s = fs(i);
  const t = rt(i);
  cpu1.storeU64(s, cpu0.getRegS64(t));
}

function generateCFC1Stub(ctx) {
  const s = ctx.instr_fs();
  const t = ctx.instr_rt();

  ctx.fragment.usesCop1 = true;
  ctx.isTrivial = true;

  switch (s) {
    case 0:
    case 31:
      return `
        const value = cpu1.control[${s}];
        c.setRegS32Extend(${t}, value);
        `;
      return impl;
  }

  return `
    // CFC1 invalid reg
    `;
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
    return `
      cpu1.control[${s}] = ${genSrcRegU32Lo(t)};
      `;
  }

  return `
    // CTC1 invalid reg
    `;
}

function executeCTC1(i) { 
  const s = fs(i);
  if (s === 31) {
    cpu1.control[s] = cpu0.getRegU32Lo(rt(i));
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

  let impl = '';
  const test = condition ? '!==' : '===';
  impl += `if ((cpu1.control[31] & FPCSR_C) ${test} 0) {\n`;
  impl += `  c.branchTarget = ${toString32(target)};\n`;
  if (likely) {
    impl += '} else {\n';
    impl += '  c.nextPC += 4;\n';
  }
  impl += '}\n';
  return impl;
}

function executeBCInstr(i) {
  assert(((i >>> 18) & 0x7) === 0, "cc bit is not 0");

  const condition = (i & 0x10000) !== 0;
  const likely = (i & 0x20000) !== 0;
  const cc = (cpu1.control[31] & FPCSR_C) !== 0;

  if (cc === condition) {
    performBranch(branchAddress(cpu0.pc, i));
  } else {
    if (likely) {
      cpu0.nextPC += 4;   // skip the next instruction
    }
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
  ctx.isTrivial = true;

  const op = cop1_func(ctx.instruction);

  if (op < 0x30) {
    switch (op) {
      case cop1ADD: return `cpu1.ADD_S(${d}, ${s}, ${t});\n`;
      case cop1SUB: return `cpu1.SUB_S(${d}, ${s}, ${t});\n`;
      case cop1MUL: return `cpu1.MUL_S(${d}, ${s}, ${t});\n`;
      case cop1DIV: return `cpu1.DIV_S(${d}, ${s}, ${t});\n`;
      case cop1SQRT: return `cpu1.SQRT_S(${d}, ${s});\n`;
      case cop1ABS: return `cpu1.ABS_S(${d}, ${s});\n`;
      case cop1MOV: return `cpu1.MOV_S(${d}, ${s});\n`;
      case cop1NEG: return `cpu1.NEG_S(${d}, ${s});\n`;
      case cop1ROUND_L: return `cpu1.ConvertSToL(${d}, ${s}, ${convertModeRound});\n`;
      case cop1TRUNC_L: return `cpu1.ConvertSToL(${d}, ${s}, ${convertModeTrunc});\n`;
      case cop1CEIL_L: return `cpu1.ConvertSToL(${d}, ${s}, ${convertModeCeil});\n`;
      case cop1FLOOR_L: return `cpu1.ConvertSToL(${d}, ${s}, ${convertModeFloor});\n`;
      case cop1ROUND_W: return `cpu1.ConvertSToW(${d}, ${s}, ${convertModeRound});\n`;
      case cop1TRUNC_W: return `cpu1.ConvertSToW(${d}, ${s}, ${convertModeTrunc});\n`;
      case cop1CEIL_W: return `cpu1.ConvertSToW(${d}, ${s}, ${convertModeCeil});\n`;
      case cop1FLOOR_W: return `cpu1.ConvertSToW(${d}, ${s}, ${convertModeFloor});\n`;
      case cop1CVT_S: return `cpu1.raiseUnimplemented();\n`;
      case cop1CVT_D: return `cpu1.CVT_D_S(${d}, ${s});\n`;
      case cop1CVT_W: return `cpu1.ConvertSToW(${d}, ${s}, cpu1.roundingMode);\n`;
      case cop1CVT_L: return `cpu1.ConvertSToL(${d}, ${s}, cpu1.roundingMode);\n`;
    }

    return `unimplemented(${toString32(ctx.pc)},${toString32(ctx.instruction)});\n`;
  }

  return `
    cpu1.handleFloatCompareSingle(${op}, ${s}, ${t});
  `;
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
  ctx.isTrivial = true;

  const op = cop1_func(ctx.instruction);

  if (op < 0x30) {
    switch (op) {
      case cop1ADD: return `cpu1.ADD_D(${d}, ${s}, ${t});\n`;
      case cop1SUB: return `cpu1.SUB_D(${d}, ${s}, ${t});\n`;
      case cop1MUL: return `cpu1.MUL_D(${d}, ${s}, ${t});\n`;
      case cop1DIV: return `cpu1.DIV_D(${d}, ${s}, ${t});\n`;
      case cop1SQRT: return `cpu1.SQRT_D(${d}, ${s});\n`;
      case cop1ABS: return `cpu1.ABS_D(${d}, ${s});\n`;
      case cop1MOV: return `cpu1.MOV_D(${d}, ${s});\n`;
      case cop1NEG: return `cpu1.NEG_D(${d}, ${s});\n`;
      case cop1ROUND_L: return `cpu1.ConvertDToL(${d}, ${s}, ${convertModeRound});\n`;
      case cop1TRUNC_L: return `cpu1.ConvertDToL(${d}, ${s}, ${convertModeTrunc});\n`;
      case cop1CEIL_L: return `cpu1.ConvertDToL(${d}, ${s}, ${convertModeCeil});\n`;
      case cop1FLOOR_L: return `cpu1.ConvertDToL(${d}, ${s}, ${convertModeFloor});\n`;
      case cop1ROUND_W: return `cpu1.ConvertDToW(${d}, ${s}, ${convertModeRound});\n`;
      case cop1TRUNC_W: return `cpu1.ConvertDToW(${d}, ${s}, ${convertModeTrunc});\n`;
      case cop1CEIL_W: return `cpu1.ConvertDToW(${d}, ${s}, ${convertModeCeil});\n`;
      case cop1FLOOR_W: return `cpu1.ConvertDToW(${d}, ${s}, ${convertModeFloor});\n`;
      case cop1CVT_S: return `cpu1.CVT_S_D(${d}, ${s});\n`;
      case cop1CVT_D: return `cpu1.raiseUnimplemented();\n`;
      case cop1CVT_W: return `cpu1.ConvertDToW(${d}, ${s}, cpu1.roundingMode);\n`;
      case cop1CVT_L: return `cpu1.ConvertDToL(${d}, ${s}, cpu1.roundingMode);\n`;
    }
    return `unimplemented(${toString32(ctx.pc)},${toString32(ctx.instruction)});\n`;
  }

  return `
    cpu1.handleFloatCompareDouble(${op}, ${s}, ${t});
  `;
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
  ctx.isTrivial = true;
  switch (cop1_func(ctx.instruction)) {
    case cop1ROUND_L: return `cpu1.raiseUnimplemented();\n`;
    case cop1TRUNC_L: return `cpu1.raiseUnimplemented();\n`;
    case cop1CEIL_L: return `cpu1.raiseUnimplemented();\n`;
    case cop1FLOOR_L: return `cpu1.raiseUnimplemented();\n`;
    case cop1ROUND_W: return `cpu1.raiseUnimplemented();\n`;
    case cop1TRUNC_W: return `cpu1.raiseUnimplemented();\n`;
    case cop1CEIL_W: return `cpu1.raiseUnimplemented();\n`;
    case cop1FLOOR_W: return `cpu1.raiseUnimplemented();\n`;
    case cop1CVT_S: return `cpu1.CVT_S_W(${d}, ${s});\n`;
    case cop1CVT_D: return `cpu1.CVT_D_W(${d}, ${s});\n`;
    case cop1CVT_W: return `cpu1.raiseUnimplemented();\n`;
    case cop1CVT_L: return `cpu1.raiseUnimplemented();\n`;
  }
  return `unimplemented(${toString32(ctx.pc)},${toString32(ctx.instruction)});\n`;
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
  ctx.isTrivial = true;
  switch (cop1_func(ctx.instruction)) {
    case cop1ROUND_L: return `cpu1.raiseUnimplemented();\n`;
    case cop1TRUNC_L: return `cpu1.raiseUnimplemented();\n`;
    case cop1CEIL_L: return `cpu1.raiseUnimplemented();\n`;
    case cop1FLOOR_L: return `cpu1.raiseUnimplemented();\n`;
    case cop1ROUND_W: return `cpu1.raiseUnimplemented();\n`;
    case cop1TRUNC_W: return `cpu1.raiseUnimplemented();\n`;
    case cop1CEIL_W: return `cpu1.raiseUnimplemented();\n`;
    case cop1FLOOR_W: return `cpu1.raiseUnimplemented();\n`;
    case cop1CVT_S: return `cpu1.CVT_S_L(${d}, ${s});\n`;
    case cop1CVT_D: return `cpu1.CVT_D_L(${d}, ${s});\n`;
    case cop1CVT_W: return `cpu1.raiseUnimplemented();\n`;
    case cop1CVT_L: return `cpu1.raiseUnimplemented();\n`;
  }
  return `unimplemented(${toString32(ctx.pc)},${toString32(ctx.instruction)});\n`;
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
  executeSLL,           executeUnknown,       executeSRL,         executeSRA,
  executeSLLV,          executeUnknown,       executeSRLV,        executeSRAV,
  executeJR,            executeJALR,          executeUnknown,     executeUnknown,
  executeSYSCALL,       executeBREAK,         executeUnknown,     executeSYNC,
  executeMFHI,          executeMTHI,          executeMFLO,        executeMTLO,
  executeDSLLV,         executeUnknown,       executeDSRLV,       executeDSRAV,
  executeMULT,          executeMULTU,         executeDIV,         executeDIVU,
  executeDMULT,         executeDMULTU,        executeDDIV,        executeDDIVU,
  executeADD,           executeADDU,          executeSUB,         executeSUBU,
  executeAND,           executeOR,            executeXOR,         executeNOR,
  executeUnknown,       executeUnknown,       executeSLT,         executeSLTU,
  executeDADD,          executeDADDU,         executeDSUB,        executeDSUBU,
  executeTGE,           executeTGEU,          executeTLT,         executeTLTU,
  executeTEQ,           executeUnknown,       executeTNE,         executeUnknown,
  executeDSLL,          executeUnknown,       executeDSRL,        executeDSRA,
  executeDSLL32,        executeUnknown,       executeDSRL32,      executeDSRA32
]);

const specialTableGen = validateSpecialOpTable([
  generateSLL,            'executeUnknown',       generateSRL,          generateSRA,
  generateSLLV,           'executeUnknown',       generateSRLV,         generateSRAV,
  generateJR,             generateJALR,           'executeUnknown',     'executeUnknown',
  'executeSYSCALL',       'executeBREAK',         'executeUnknown',     'executeSYNC',
  generateMFHI,           generateMTHI,           generateMFLO,         generateMTLO,
  'executeDSLLV',         'executeUnknown',       'executeDSRLV',       'executeDSRAV',
  generateMULT,           generateMULTU,          'executeDIV',         'executeDIVU',
  'executeDMULT',         'executeDMULTU',        'executeDDIV',        'executeDDIVU',
  generateADD,            generateADDU,           generateSUB,          generateSUBU,
  generateAND,            generateOR,             generateXOR,          generateNOR,
  'executeUnknown',       'executeUnknown',       generateSLT,          generateSLTU,
  'executeDADD',          'executeDADDU',         'executeDSUB',        'executeDSUBU',
  'executeTGE',           'executeTGEU',          'executeTLT',         'executeTLTU',
  'executeTEQ',           'executeUnknown',       'executeTNE',         'executeUnknown',
  'executeDSLL',          'executeUnknown',       'executeDSRL',        'executeDSRA',
  'executeDSLL32',        'executeUnknown',       'executeDSRL32',      'executeDSRA32'
]);

function executeSpecial(i) {
  const fn = i & 0x3f;
  specialTable[fn](i);
}

// Expose all the functions that we don't yet generate
n64js.executeUnknown = executeUnknown;
n64js.executeSYSCALL = executeSYSCALL;
n64js.executeBREAK   = executeBREAK;
n64js.executeSYNC    = executeSYNC;
n64js.executeDSLLV   = executeDSLLV;
n64js.executeDSRLV   = executeDSRLV;
n64js.executeDSRAV   = executeDSRAV;
n64js.executeDIV     = executeDIV;
n64js.executeDIVU    = executeDIVU;
n64js.executeDMULT   = executeDMULT;
n64js.executeDMULTU  = executeDMULTU;
n64js.executeDDIV    = executeDDIV;
n64js.executeDDIVU   = executeDDIVU;
n64js.executeDADD    = executeDADD;
n64js.executeDADDU   = executeDADDU;
n64js.executeDSUB    = executeDSUB;
n64js.executeDSUBU   = executeDSUBU;
n64js.executeTGE     = executeTGE;
n64js.executeTGEU    = executeTGEU;
n64js.executeTLT     = executeTLT;
n64js.executeTLTU    = executeTLTU;
n64js.executeTEQ     = executeTEQ;
n64js.executeTNE     = executeTNE;
n64js.executeDSLL    = executeDSLL;
n64js.executeDSRL    = executeDSRL;
n64js.executeDSRA    = executeDSRA;
n64js.executeDSLL32  = executeDSLL32;
n64js.executeDSRL32  = executeDSRL32;
n64js.executeDSRA32  = executeDSRA32;

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
  //assert( (cpu0.control[cpu0_constants.controlSR] & SR_CU1) !== 0, "SR_CU1 in inconsistent state" );

  const fmt = (i >>> 21) & 0x1f;
  cop1Table[fmt](i);
}

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
    impl += ctx.genAssert('(c.control[12] & SR_CU1) !== 0', 'cop1 should be enabled');
    impl += op_impl;

  } else {
    impl += 'if( (c.control[12] & SR_CU1) === 0 ) {\n';
    impl += `  n64js.executeCop1_disabled(${toString32(ctx.instruction)});\n`;
    impl += '} else {\n';
    impl += '  ' + op_impl;
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
  assert((cpu0.control[cpu0_constants.controlStatus] & SR_CU1) === 0, "SR_CU1 in inconsistent state");

  cpu0.throwCopXUnusable(1);
}
n64js.executeCop1_disabled = executeCop1_disabled;

function cop1ControlChanged() {
  const control = cpu0.control[cpu0_constants.controlStatus];
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
  'executeDADDI',         'executeDADDIU',        'executeLDL',         'executeLDR',
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
n64js.executeDADDI = executeDADDI;
n64js.executeDADDIU = executeDADDIU;
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
    this.post_pc = 0;
    this.bailOut = false; // Set this if the op does something to manipulate event timers.

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

  set(fragment, pc, instruction, post_pc) {
    this.fragment = fragment;
    this.pc = pc;
    this.instruction = instruction;
    this.post_pc = post_pc;
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
}

function checkCauseIP3Consistent() {
  const miRegDevice = n64js.hardware().miRegDevice;
  const miIntr = miRegDevice.interruptsUnmasked();
  const causeIP3 = (cpu0.control[cpu0_constants.controlCause] & CAUSE_IP3) !== 0;
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
  //   if (!sync.sync32(cpu0.control[cpu0_constants.controlCount], 'count'))
  //     return false;
  //   if (!sync.sync32(cpu0.control[cpu0_constants.controlCompare], 'compare'))
  //     return false;
  // }

  return true;
}

function handleTLBException() {
  cpu0.pc = cpu0.nextPC;
  cpu0.delayPC = cpu0.branchTarget;
  cpu0.control_signed[cpu0_constants.controlCount] += COUNTER_INCREMENT_PER_OP;

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
      cpu0.control[cpu0_constants.controlCause] |= CAUSE_IP8;
      if (cpu0.checkForUnmaskedInterrupts()) {
        cpu0.stuffToDo |= kStuffToDoCheckInterrupts;
      }
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
      if (e instanceof TLBException) {
        // If we hit a TLB exception we apply the nextPC (which should have been set to an exception vector) and continue looping.
        handleTLBException();
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

function executeFragment(fragment, c, ram, events) {
  let evt = events[0];
  if (evt.countdown >= fragment.opsCompiled * COUNTER_INCREMENT_PER_OP) {
    fragment.executionCount++;
    const ops_executed = fragment.func(c, ram);   // Absolute value is number of ops executed.

    // refresh latest event - may have changed
    evt = events[0];
    evt.countdown -= ops_executed * COUNTER_INCREMENT_PER_OP;

    if (!accurateCountUpdating) {
      c.control_signed[cpu0_constants.controlCount] += ops_executed * COUNTER_INCREMENT_PER_OP;
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
const fragmentContext = new FragmentContext(); // NB: first pc is entry_pc, cpu0.pc is post_pc by this point

function addOpToFragment(fragment, entry_pc, instruction, c) {
  if (fragment.opsCompiled === 0) {
    fragmentContext.newFragment();
  }
  fragment.opsCompiled++;
  updateFragment(fragment, entry_pc);

  fragmentContext.set(fragment, entry_pc, instruction, c.pc); // NB: first pc is entry_pc, c.pc is post_pc by this point
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

    const code = 'return function fragment_' + toString32(fragment.entryPC) + '_' + fragment.opsCompiled + '(c, ram) {\n' + fragment.body_code + '}\n';

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
  const events = c.events;
  const ram = c.ram;

  while (c.hasEvent(kEventRunForCycles)) {
    let fragment = lookupFragment(c.pc);
    // fragment = null;

    while (!c.stuffToDo) {

      if (fragment && fragment.func) {
        fragment = executeFragment(fragment, c, ram, events);
      } else {
        // if (syncFlow) {
        //   if (!checkSyncState(syncFlow, cpu0.pc)) {
        //     n64js.halt('sync error');
        //     break;
        //   }
        // }

        const pc = c.pc;   // take a copy of this, so we can refer to it later

        // NB: set nextPC before the call to readMemoryS32. If this throws an exception, we need nextPC to be set up correctly.
        if (c.delayPC) { c.nextPC = c.delayPC; } else { c.nextPC = c.pc + 4; }

        // NB: load instruction using normal memory access routines - this means that we throw a tlb miss/refill approptiately
        // let instruction = n64js.load_s32(ram, pc);
        let instruction;
        if (pc < -2139095040) {
          const phys = (pc + 0x80000000) | 0;  // NB: or with zero ensures we return an SMI if possible.
          instruction = ((ram[phys] << 24) | (ram[phys + 1] << 16) | (ram[phys + 2] << 8) | ram[phys + 3]) | 0;
        } else {
          instruction = lw_slow(pc);
        }

        c.branchTarget = 0;
        executeOp(instruction);

        // Force r0 to be 0.
        // TODO: figure out if we want to do this here, or enforce via
        // any instruction that writes to registers.
        // TODO: figure out where to do this in generated code.
        cpu0.setRegU64(0, 0n);

        c.pc = c.nextPC;
        c.delayPC = c.branchTarget;
        c.control_signed[cpu0_constants.controlCount] += COUNTER_INCREMENT_PER_OP;
        //checkCauseIP3Consistent();
        //n64js.checkSIStatusConsistent();

        let evt = events[0];
        evt.countdown -= COUNTER_INCREMENT_PER_OP;
        if (evt.countdown <= 0) {
          handleCounter();
        }

        // If we have a fragment, we're assembling code as we go
        if (fragment) {
          fragment = addOpToFragment(fragment, pc, instruction, c);
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

let invals = 0;

// Invalidate a single cache line
n64js.invalidateICacheEntry = function (address) {
  //logger.log('cache flush ' + toString32(address));

  ++invals;
  if ((invals % 10000) === 0) {
    logger.log(invals + ' invals');
  }

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

  const fn_code = generateOp(ctx);

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

  // code += `if (!checkEqual( n64js.readMemoryU32(cpu0.pc), ${toString32(instruction)}, "unexpected instruction (need to flush icache?)")) { return false; }\n`;

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
	return match ? str.replace(new RegExp('^'+prefix, 'gm'), '') : str;
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

function generateGenericOpBoilerplate(fn, ctx) {
  let code = '';
  code += ctx.genAssert(`c.pc === ${toString32(ctx.pc)}`, 'pc mismatch');

  if (ctx.needsDelayCheck) {
    // NB: delayPC not cleared here - it's always overwritten with branchTarget below.
    code += `if (c.delayPC) { c.nextPC = c.delayPC; } else { c.nextPC = ${toString32(ctx.pc + 4)}; }\n`;
  } else {
    code += ctx.genAssert('c.delayPC === 0', 'delay pc should be zero');
    code += `c.nextPC = ${toString32(ctx.pc + 4)};\n`;
  }
  code += 'c.branchTarget = 0;\n';

  code += fn;

  code += 'c.pc = c.nextPC;\n';
  code += 'c.delayPC = c.branchTarget;\n';

  // We don't know if the generic op set delayPC, so assume the worst.
  ctx.needsDelayCheck = true;

  if (accurateCountUpdating) {
    code += 'c.control_signed[9] += 1;\n';
  }

  // If bailOut is set, always return immediately.
  if (ctx.bailOut) {
    code += `return ${ctx.fragment.opsCompiled};\n`;
  } else {
    code += `if (c.stuffToDo) { return ${ctx.fragment.opsCompiled}; }\n`;
    code += `if (c.pc !== ${toString32(ctx.post_pc)}) { return ${ctx.fragment.opsCompiled}; }\n`;
  }

  return code;
}

// Standard code for manipulating the pc
function generateStandardPCUpdate(fn, ctx, might_adjust_next_pc) {
  let code = '';
  code += ctx.genAssert(`c.pc === ${toString32(ctx.pc)}`, 'pc mismatch');

  if (ctx.needsDelayCheck) {
    // We should probably assert on this - two branch instructions back-to-back is weird, but the flag could just be set because of a generic op
    code += `if (c.delayPC) { c.nextPC = c.delayPC; c.delayPC = 0; } else { c.nextPC = ${toString32(ctx.pc + 4)}; }\n`;
    code += fn;
    code += 'c.pc = c.nextPC;\n';
  } else if (might_adjust_next_pc) {
    // If the branch op might manipulate nextPC, we need to ensure that it's set to the correct value
    code += ctx.genAssert('c.delayPC === 0', 'delay pc should be zero');
    code += `c.nextPC = ${toString32(ctx.pc + 4)};\n`;
    code += fn;
    code += 'c.pc = c.nextPC;\n';
  } else {
    code += ctx.genAssert('c.delayPC === 0', 'delay pc should be zero');
    code += fn;
    code += `c.pc = ${toString32(ctx.pc + 4)};\n`;
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
    code += 'c.control_signed[9] += 1;\n';
  }

  // If bailOut is set, always return immediately
  assert(!ctx.bailOut, "Not expecting bailOut to be set for memory access");
  code += `if (c.stuffToDo) { return ${ctx.fragment.opsCompiled}; }\n`;
  code += `if (c.pc !== ${toString32(ctx.post_pc)}) { return ${ctx.fragment.opsCompiled}; }\n`;
  return code;
}

// Branch ops explicitly manipulate nextPC rather than branchTarget. They also guarnatee that stuffToDo is not set.
// might_adjust_next_pc is typically used by branch likely instructions.
function generateBranchOpBoilerplate(fn, ctx, might_adjust_next_pc) {
  let code = '';

  // We only need to check for off-trace branches
  const need_pc_test = ctx.needsDelayCheck || might_adjust_next_pc || ctx.post_pc !== ctx.pc + 4;

  code += generateStandardPCUpdate(fn, ctx, might_adjust_next_pc);

  // Branch instructions can always set a branch delay
  ctx.needsDelayCheck = true;

  if (accurateCountUpdating) {
    code += 'c.control_signed[9] += 1;\n';
  }

  code += ctx.genAssert('c.stuffToDo === 0', 'stuffToDo should be zero');

  // If bailOut is set, always return immediately
  if (ctx.bailOut) {
    code += 'return ' + ctx.fragment.opsCompiled + ';\n';
  } else {
    if (need_pc_test) {
      code += `if (c.pc !== ${toString32(ctx.post_pc)}) { return ${ctx.fragment.opsCompiled}; }\n`;
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
  code += fn;

  ctx.isTrivial = true;

  if (accurateCountUpdating) {
    code += 'c.control_signed[9] += 1;\n';
  }

  // NB: do delay handler after executing op, so we can set pc directly
  if (ctx.needsDelayCheck) {
    code += `if (c.delayPC) { c.pc = c.delayPC; c.delayPC = 0; } else { c.pc = ${toString32(ctx.pc + 4)}; }\n`;
    // Might happen: delay op from previous instruction takes effect
    code += `if (c.pc !== ${toString32(ctx.post_pc)}) { return ${ctx.fragment.opsCompiled}; }\n`;
  } else {
    code += ctx.genAssert('c.delayPC === 0', 'delay pc should be zero');

    // We can avoid off-branch checks in this case.
    if (ctx.post_pc !== ctx.pc + 4) {
      assert("post_pc should always be pc+4 for trival ops?");
      code += `c.pc = ${toString32(ctx.pc + 4)};\n`;
      code += `if (c.pc !== ${toString32(ctx.post_pc)}) { return ${ctx.fragment.opsCompiled}; }\n`;
    } else {
      // code += `c.pc = ${toString32(ctx.pc + 4)};\n`;
      code += '// Delaying pc update';
      ctx.delayedPCUpdate = ctx.pc + 4;
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
