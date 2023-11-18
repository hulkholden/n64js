/*global n64js*/

import * as disassemble_rsp from "./disassemble_rsp.js";
import { toString16, toString32, toHex } from "./format.js";
import { rcp16, rsq16 } from "./rsp_recip.js";

window.n64js = window.n64js || {};

// The RSP instance, initialised via initRSP(). 
export let rsp;

export function initRSP(hardware) {
  rsp = hardware.rsp;
}

function funct(i) { return i & 0x3f; }

function offset(i) { return ((i & 0xffff) << 16) >> 16; }
function sa(i) { return (i >>> 6) & 0x1f; }
function rd(i) { return (i >>> 11) & 0x1f; }
function rt(i) { return (i >>> 16) & 0x1f; }
function rs(i) { return (i >>> 21) & 0x1f; }
function op(i) { return (i >>> 26) & 0x3f; }

// LWC2 and SWC2 instructions.
function vmemBase(i) { return (i >>> 21) & 0x1f; }
function vmemVT(i) { return (i >>> 16) & 0x1f; }
function vmemEl(i) { return (i >>> 7) & 0xf; }
function vmemOffset(i) { return ((i & 0x7f) << 25) >> 25; }

// COP2 instructions
function cop2E(i) { return (i >>> 21) & 0xf; }
function cop2DE(i) { return (i >>> 11) & 0x1f; }
function cop2VT(i) { return (i >>> 16) & 0x1f; }
function cop2VS(i) { return (i >>> 11) & 0x1f; }
function cop2VD(i) { return (i >>> 6) & 0x1f; }

function target(i) { return i & 0x3ffffff; }
function imm(i) { return i & 0xffff; }
function imms(i) { return (imm(i) << 16) >> 16; }   // treat immediate value as signed

function base(i) { return (i >>> 21) & 0x1f; }

function jumpAddress(a, i) { return (a & 0xf0000000) | (target(i) * 4); }


const RA = 0x1f;

const controlRegSPMemAddr = 0;
const controlRegSPRamAddr = 1;
const controlRegSPReadLen = 2;
const controlRegSPWriteLen = 3;
const controlRegSPStatus = 4;
const controlRegSPDmaFull = 5;
const controlRegSPDmaBusy = 6;
const controlRegSPSemaphore = 7;
const controlRegDPCStart = 8;
const controlRegDPCEnd = 9;
const controlRegDPCCurrent = 10;
const controlRegDPCStatus = 11;
const controlRegDPCClock = 12;
const controlRegDPCBufBusy = 13;
const controlRegDPCPipeBusy = 14;
const controlRegDPCTMEM = 15;

function controlRegToSPReg(r) { return r * 4; }
function controlRegToDPCReg(r) { return (r - controlRegDPCStart) * 4; }

// TODO: dedupe with sp.js.
const SP_MEM_ADDR_REG = 0x00;
const SP_DRAM_ADDR_REG = 0x04;
const SP_RD_LEN_REG = 0x08;
const SP_WR_LEN_REG = 0x0C;
const SP_STATUS_REG = 0x10;
const SP_DMA_FULL_REG = 0x14;
const SP_DMA_BUSY_REG = 0x18;
const SP_SEMAPHORE_REG = 0x1C;

const SP_STATUS_HALT = 0x0001;
const SP_STATUS_BROKE = 0x0002;
const SP_STATUS_DMA_BUSY = 0x0004;
const SP_STATUS_DMA_FULL = 0x0008;
const SP_STATUS_IO_FULL = 0x0010;
const SP_STATUS_SSTEP = 0x0020;
const SP_STATUS_INTR_BREAK = 0x0040;
const SP_STATUS_SIG0 = 0x0080;    // a.k.a. Yield
const SP_STATUS_SIG1 = 0x0100;    // a.k.a. Yielded
const SP_STATUS_SIG2 = 0x0200;    // a.k.a. TaskDone
const SP_STATUS_SIG3 = 0x0400;
const SP_STATUS_SIG4 = 0x0800;
const SP_STATUS_SIG5 = 0x1000;
const SP_STATUS_SIG6 = 0x2000;
const SP_STATUS_SIG7 = 0x4000;

export class RSP {
  constructor(hardware) {
    this.hardware = hardware;
    this.dmem = hardware.sp_mem.subRegion(0x0000, 0x1000);
    this.imem = hardware.sp_mem.subRegion(0x1000, 0x1000);
    this.imemDV = this.imem.dataView;

    this.halted = true;

    // A Timeline event when running.
    this.runEvent = null;

    // Take a deep reference to the SPIBIST registers to access the program counter.
    this.pcDataView = hardware.sp_ibist_mem.dataView;

    this.pc = 0;
    this.delayPC = 0;
    this.nextPC = 0; // Set to the next expected PC before an op executes. Ops can update this to change control flow without branch delay (e.g. likely branches, ERET)
    this.branchTarget = 0; // Set to indicate a branch has been taken. Sets the delayPC for the subsequent op.

    const gprMem = new ArrayBuffer(32 * 4);
    this.gprU32 = new Uint32Array(gprMem);
    this.gprS32 = new Int32Array(gprMem);

    const vecMem = new ArrayBuffer(32 * 16);
    this.vpr = new DataView(vecMem);
    this.vprS16 = new Int16Array(vecMem);
    this.vprS8 = new Int8Array(vecMem);
    this.vprU64 = new BigUint64Array(vecMem);

    const vAccMem = new ArrayBuffer(8 * 8); // Actually 48 bits, not 64. 
    this.vAcc = new BigInt64Array(vAccMem);
    this.vAccS32 = new Int32Array(vAccMem);
    this.vAccU32 = new Uint32Array(vAccMem);
    this.vAccS16 = new Int16Array(vAccMem);
    this.vAccU16 = new Uint16Array(vAccMem);

    this.vuVCOReg = new Uint16Array(new ArrayBuffer(2));
    this.vuVCCReg = new Uint16Array(new ArrayBuffer(2));
    this.vuVCEReg = new Uint8Array(new ArrayBuffer(1));

    // Internal registers used by VRCP and friends.
    this.divDP = false;
    this.divIn = 0;
    this.divOut = 0;

    // Element selection table.
    // The element field of the opcode is used to select one of these rows.
    // Each nibble of the pattern corresponds to a source element to use.
    // Patterns are constructed so the loops processing each element in turn
    // can read the bottom 4 bits from the pattern then shift right by 4 for the
    // next iteration.
    this.vecSelectU32 = new Uint32Array(new ArrayBuffer(16 * 4));
    this.vecSelectU32[0] = 0x76543210; // None
    this.vecSelectU32[1] = 0x76543210; // None
    this.vecSelectU32[2] = 0x66442200; // 0q
    this.vecSelectU32[3] = 0x77553311; // 1q
    this.vecSelectU32[4] = 0x44440000; // 0h
    this.vecSelectU32[5] = 0x55551111; // 1h
    this.vecSelectU32[6] = 0x66662222; // 2h
    this.vecSelectU32[7] = 0x77773333; // 3h
    this.vecSelectU32[8] = 0x00000000; // 0
    this.vecSelectU32[9] = 0x11111111; // 1
    this.vecSelectU32[10] = 0x22222222; // 2
    this.vecSelectU32[11] = 0x33333333; // 3
    this.vecSelectU32[12] = 0x44444444; // 4
    this.vecSelectU32[13] = 0x55555555; // 5
    this.vecSelectU32[14] = 0x66666666; // 6
    this.vecSelectU32[15] = 0x77777777; // 7

    // Temporary vector for intermediate calculations.
    const vecTempMem = new ArrayBuffer(8 * 16);
    this.vecTemp = new DataView(vecTempMem);
    this.vecTempU64 = new BigUint64Array(vecTempMem);

    this.reset();
  }

  reset() {
    this.halted = true;
    this.runEvent = null;

    this.pc = 0;
    this.delayPC = 0;
    this.nextPC = 0;
    this.branchTarget = 0;

    for (let i = 0; i < 32; ++i) {
      this.gprS32[i] = 0;
      for (let v = 0; v < 8; v++) {
        this.vprS16[i * 8 + v] = 0;
      }
    }
    this.vAcc[0] = 0n;

    this.vuVCOReg[0] = 0;
    this.vuVCCReg[0] = 0;
    this.vuVCEReg[0] = 0;

    this.divDP = false;
    this.divIn = 0;
    this.divOut = 0;
  }

  // General Purpose Registers.
  getRegS32(r) { return this.gprS32[r]; }
  getRegU32(r) { return this.gprU32[r]; }
  setRegS32(r, v) { if (r != 0) { this.gprS32[r] = v; } }
  setRegU32(r, v) { if (r != 0) { this.gprU32[r] = v; } }

  setRegS16SignExtend(r, v) { if (r != 0) { this.gprS32[r] = (v << 16) >> 16; } }

  // For performance we assume the accumulator is stored as a S48 so we can avoid this check when reading.
  getAccS48(el) { return this.vAcc[el]; }

  setAccS48(el, v) { this.vAcc[el] = BigInt.asIntN(48, v); }

  // Update the accumulator, v is an unsigned 32 bit value.
  updateAccLow32(el, v, accumulate) {
    this.updateAccHiLo(el, 0, v, accumulate);
  }

  // Update the accumulator, v is a signed 32 bit value.
  updateAccMid32(el, v, accumulate) {
    // Note we can't just use v>>31 as we can have 32 bit unsigned values.
    const v1 = (v >= 0) ? 0 : -1;
    const v0 = v | 0;
    this.updateAccHiLo(el, v1, v0, accumulate);
  }

  // Update the accumulator, v is a signed 32 bit value and shifted left by 16 bits before storing.
  updateAccHigh32(el, v, accumulate) {
    this.updateAccHiLo(el, v >> 16, v << 16, accumulate);
  }

  updateAccHiLo(el, y1, y0, accumulate) {
    if (accumulate) {
      const x1 = this.vAccS32[(el * 2) + 1];
      const x0 = this.vAccU32[(el * 2) + 0];

      // 64-bit addition.
      const z0 = x0 + y0;
      const c = ((x0 & y0) | ((x0 | y0) & ~z0)) >>> 31;
      const z1 = x1 + y1 + c;

      // Truncate to s48 and sign extend.
      this.vAccS32[(el * 2) + 1] = (z1 << 16) >> 16;
      this.vAccU32[(el * 2) + 0] = z0;
    } else {
      this.vAccU32[(el * 2) + 1] = y1;
      this.vAccU32[(el * 2) + 0] = y0;
    }
  }

  setAccLow(el, v) { this.vAccS16[(el * 4) + 0] = v; }
  getAccLow(el) { return this.vAccS16[(el * 4) + 0]; }

  setAccMid(el, v) { this.vAccS16[(el * 4) + 1] = v; }
  getAccMid(el) { return this.vAccS16[(el * 4) + 1]; }

  setAccHigh(el, v) { this.vAccS16[(el * 4) + 2] = v; }
  getAccHigh(el) { return this.vAccS16[(el * 4) + 2]; }

  // Return the high and mid halfwords as a signed 32 bit value.
  getAccHighMid(el) { return (this.vAccS16[(el * 4) + 2] << 16) | this.vAccU16[(el * 4) + 1]; }

  setVecFromAccSignedMid(r) {
    for (let el = 0; el < 8; el++) {
      const himid = this.getAccHighMid(el);
      let res;
      if (himid >= 0) {
        res = (himid & 0xffff_8000) ? 0x7fff : himid;
      } else {
        res = (~himid & 0xffff_8000) ? 0x8000 : himid;
      }
      this.setVecS16(r, el, res);
    }
  }

  setVecFromAccSignedLow(r) {
    for (let el = 0; el < 8; el++) {
      const himid = this.getAccHighMid(el);
      const lo = this.getAccLow(el);

      let res;
      if (himid >= 0) {
        res = (himid & 0xffff_8000) ? 0xffff : lo;
      } else {
        res = (~himid & 0xffff_8000) ? 0x0000 : lo;
      }
      this.setVecS16(r, el, res);
    }
  }

  setVecFromAccOddified(r) {
    for (let el = 0; el < 8; el++) {
      this.setVecS16(r, el, saturateSigned(this.vAcc[el] >> 1n, 16n, 0x8000, 0x7fff) & 0xfff0);
    }
  }

  setVecFromAccUnsignedMid(r) {
    for (let el = 0; el < 8; el++) {
      this.setVecS16(r, el, saturateUnsigned(this.vAcc[el], 16n, 0x0000, 0xffff));
    }
  }

  setVecFromAccMid(r) {
    for (let el = 0; el < 8; el++) {
      this.setVecS16(r, el, this.getAccMid(el));
    }
  }

  setVecFromAccLow(r) {
    for (let el = 0; el < 8; el++) {
      this.setVecS16(r, el, this.getAccLow(el));
    }
  }

  vectorMulFractions(vs, vt, vte, accumulate, roundVal) {
    for (let el = 0, select = this.vecSelectU32[vte]; el < 8; el++, select >>= 4) {
      const s = this.getVecS16(vs, el);
      const t = this.getVecS16(vt, select & 0x7);
      const r = ((s * t) * 2) + roundVal;
      this.updateAccMid32(el, r, accumulate);
    }
  }

  vectorMulPartialLow(vs, vt, vte, accumulate) {
    for (let el = 0, select = this.vecSelectU32[vte]; el < 8; el++, select >>= 4) {
      const s = this.getVecU16(vs, el);
      const t = this.getVecU16(vt, select & 0x7);
      const r = (s * t) >>> 16;
      this.updateAccLow32(el, r, accumulate)
    }
  }

  vectorMulPartialMidM(vs, vt, vte, accumulate) {
    for (let el = 0, select = this.vecSelectU32[vte]; el < 8; el++, select >>= 4) {
      const s = this.getVecS16(vs, el);
      const t = this.getVecU16(vt, select & 0x7);
      this.updateAccMid32(el, s * t, accumulate)
    }
  }

  vectorMulPartialMidN(vs, vt, vte, accumulate) {
    for (let el = 0, select = this.vecSelectU32[vte]; el < 8; el++, select >>= 4) {
      const s = this.getVecU16(vs, el);
      const t = this.getVecS16(vt, select & 0x7);
      this.updateAccMid32(el, s * t, accumulate)
    }
  }

  vectorMulPartialHigh(vs, vt, vte, accumulate) {
    for (let el = 0, select = this.vecSelectU32[vte]; el < 8; el++, select >>= 4) {
      const s = this.getVecS16(vs, el);
      const t = this.getVecS16(vt, select & 0x7);
      this.updateAccHigh32(el, s * t, accumulate)
    }
  }

  vectorRound(vs, vt, vte, ifGTE) {
    const shift = (vs & 1) ? 16 : 0;
    for (let el = 0, select = this.vecSelectU32[vte]; el < 8; el++, select >>= 4) {
      const acc = this.getAccS48(el);
      const incr = this.getVecS16(vt, select & 0x7) << shift;
      const cond = ifGTE ? (acc >= 0) : (acc < 0);
      this.setAccS48(el, acc + (cond ? BigInt(incr) : 0n));
    }
  }

  // Vector Unit (Cop2) Control Registers.
  // VCO = Vector Carry Out, 16 bits.
  // VCC = Vector Compare Code, 16 bits.
  // VCE = Vector Compare Extension, 8 bits.
  get VCO() { return this.vuVCOReg[0]; }
  get VCOHi() { return (this.vuVCOReg[0] >>> 8) & 0xff; }
  get VCOLo() { return (this.vuVCOReg[0] >>> 0) & 0xff; }
  get VCC() { return this.vuVCCReg[0]; }
  get VCCHi() { return (this.vuVCCReg[0] >>> 8) & 0xff; }
  get VCCLo() { return (this.vuVCCReg[0] >>> 0) & 0xff; }
  get VCE() { return this.vuVCEReg[0]; }

  set VCO(val) { this.vuVCOReg[0] = val; }
  set VCC(val) { this.vuVCCReg[0] = val; }
  set VCE(val) { this.vuVCEReg[0] = val; }

  setVCOHiLo(hi, lo) { this.vuVCOReg[0] = (hi << 8) | lo; }
  setVCCHiLo(hi, lo) { this.vuVCCReg[0] = (hi << 8) | lo; }

  // Vector Unit (Cop2) General Purpose Registers.

  // TODO: need to make it clearer these are 2-byte aligned and e is in the range 0..8.
  getVecS16(r, e) { return this.vpr.getInt16((16 * r) + (e * 2), false); }
  getVecU16(r, e) { return this.vpr.getUint16((16 * r) + (e * 2), false); }
  getVecS8(r, e) { return this.vpr.getInt8((16 * r) + e, false); }
  getVecU8(r, e) { return this.vpr.getUint8((16 * r) + e, false); }

  setVecZero(r) {
    this.vprU64[(r * 2) + 0] = 0n;
    this.vprU64[(r * 2) + 1] = 0n;
  }

  setVecFromTemp(r) {
    this.vprU64[(r * 2) + 0] = this.vecTempU64[0];
    this.vprU64[(r * 2) + 1] = this.vecTempU64[1];
  }

  setVecS16(r, e, v) { this.vpr.setInt16((16 * r) + (e * 2), v, false); }
  setVecS8(r, e, v) { this.vpr.setInt8((16 * r) + e, v, false); }

  // Gets an unaligned 16 bit vector register with wraparound (reading from element 15 uses element 0 for low bits).
  getVecU16UnalignedWrap(r, e) {
    const hi = this.getVecU8(r, e & 15);
    const lo = this.getVecU8(r, (e + 1) & 15);
    return (hi << 8) | lo;
  }

  // Sets a vector register with no wraparound (low bits are discarded for assignment to element 15).
  setVecU16UnalignedNoWrap(r, e, v) {
    this.setVecS8(r, e + 0, v >> 8);
    if (e < 15) {
      this.setVecS8(r, e + 1, v);
    }
  }

  sprintVecReg(r) {
    let s = [];
    for (let v = 0; v < 8; v++) {
      s.push(toString16(this.getVecS16(r, v)));
    }
    return `V${r}: [${s.join(', ')}]`;
  }

  loadU8(offset) { return this.dmem.getU8(offset & 0xfff); }
  loadU16(offset) { return (offset <= 0xffe) ? this.dmem.getU16(offset) : this.loadU16Wrapped(offset); }
  loadU32(offset) { return (offset <= 0xffc) ? this.dmem.getU32(offset) : this.loadU32Wrapped(offset); }

  loadS8(offset) { return this.dmem.getS8(offset & 0xfff); }
  loadS16(offset) { return (offset <= 0xffe) ? this.dmem.getS16(offset) : this.loadS16Wrapped(offset); }
  loadS32(offset) { return (offset <= 0xffc) ? this.dmem.getS32(offset) : this.loadS32Wrapped(offset); }

  store8(offset, value) { return this.dmem.set8(offset & 0xfff, value); }
  store16(offset, value) { return (offset <= 0xffe) ? this.dmem.set16(offset, value) : this.store16Wrapped(offset, value); }
  store32(offset, value) { return (offset <= 0xffc) ? this.dmem.set32(offset, value) : this.store32Wrapped(offset, value); }
  store32masked(offset, value, mask) {
    const orig = this.loadU32(offset, false);
    const result = (orig & ~mask) | (value & mask);
    this.store32(offset, result);
  }

  loadU16Wrapped(offset) {
    return (
      (this.loadU8(offset + 0) << 8) |
      (this.loadU8(offset + 1) << 0)) >>> 0;
  }

  loadS16Wrapped(offset) {
    return (this.loadU16Wrapped(offset) << 16) >> 16;
  }

  loadU32Wrapped(offset) {
    return (
      (this.loadU8(offset + 0) << 24) |
      (this.loadU8(offset + 1) << 16) |
      (this.loadU8(offset + 2) << 8) |
      (this.loadU8(offset + 3) << 0)) >>> 0;
  }

  loadS32Wrapped(offset) {
    return this.loadU32Wrapped(offset) >> 0;
  }

  store16Wrapped(offset, value) {
    this.store8(offset + 0, value >>> 8);
    this.store8(offset + 1, value >>> 0);
  }

  store32Wrapped(offset, value) {
    this.store8(offset + 0, value >>> 24);
    this.store8(offset + 1, value >>> 16);
    this.store8(offset + 2, value >>> 8);
    this.store8(offset + 3, value >>> 0);
  }

  calcDebuggerAddress(instr) {
    return this.calcAddress(instr) + 0xa400_0000;
  }

  calcAddress(instr) {
    return (this.getRegS32(base(instr)) + imms(instr)) & 0xfff;
  }

  calcVecAddress(instr, scale) {
    return (this.getRegS32(vmemBase(instr)) + (vmemOffset(instr) * scale)) & 0xfff;
  }

  conditionalBranch(cond, offset) {
    const effectiveOffset = cond ? (offset * 4) : 4;
    this.branchTarget = (this.pc + 4 + effectiveOffset) | 0x1000;
  }

  jump(pc) {
    this.branchTarget = (pc >>> 0) | 0x1000;
  }

  unhalt() {
    // TODO: should this just check the status bits?
    this.halted = false;

    if (this.runEvent) {
      this.runEvent.stop();
    }
    this.runEvent = this.hardware.timeline.startEvent("RSP");
  }

  step() {
    if (this.halted) {
      return;
    }
    this.nextPC = (this.delayPC || (this.pc + 4)) & 0xffc;

    const instr = this.imemDV.getUint32(this.pc, false);

    this.branchTarget = 0;
    this.executeOp(instr);
    this.pc = this.nextPC;
    this.delayPC = this.branchTarget;
  }

  halt(statusBits) {
    this.hardware.spRegDevice.setStatusBits(statusBits | SP_STATUS_HALT);
    this.halted = true;
    if (this.runEvent) {
      this.runEvent.stop();
      this.runEvent = null
    }
  }

  disassembleAll() {
    const disassembly = disassemble_rsp.disassembleRange(this.imem, 0x0000, 0x1000);
    for (let d of disassembly) {
      console.log(`${toHex(d.address, 16)} ${d.disassembly}`);
    }
  }

  disassembleOp(pc, instr) {
    const d = disassemble_rsp.disassembleInstruction(pc, instr);
    console.log(`${toHex(d.address, 16)} ${d.disassembly}`);
  }

  executeOp(instr) {
    // if (instr != 0) this.disassembleOp(this.pc, instr);
    simpleTable[op(instr)](instr);
  }

  moveFromControl(controlReg) {
    switch (controlReg) {
      case controlRegSPMemAddr:
      case controlRegSPRamAddr:
      case controlRegSPReadLen:
      case controlRegSPWriteLen:
      case controlRegSPStatus:
      case controlRegSPDmaFull:
      case controlRegSPDmaBusy:
      case controlRegSPSemaphore:
        return this.hardware.spRegDevice.readRegU32(controlRegToSPReg(controlReg));
      case controlRegDPCStart:
      case controlRegDPCEnd:
      case controlRegDPCCurrent:
      case controlRegDPCStatus:
      case controlRegDPCClock:
      case controlRegDPCBufBusy:
      case controlRegDPCPipeBusy:
      case controlRegDPCTMEM:
        return this.hardware.dpcDevice.readRegU32(controlRegToDPCReg(controlReg));
    }
    console.log(`MFC0: ${controlReg} unhandled - returning 0`)
    return 0;
  }

  moveToControl(controlReg, value) {
    switch (controlReg) {
      case controlRegSPMemAddr:
      case controlRegSPRamAddr:
      case controlRegSPReadLen:
      case controlRegSPWriteLen:
      case controlRegSPStatus:
      case controlRegSPDmaFull:
      case controlRegSPDmaBusy:
      case controlRegSPSemaphore:
        this.hardware.spRegDevice.writeReg32(controlRegToSPReg(controlReg), value);
        break;
      case controlRegDPCStart:
      case controlRegDPCEnd:
      case controlRegDPCCurrent:
      case controlRegDPCStatus:
      case controlRegDPCClock:
      case controlRegDPCBufBusy:
      case controlRegDPCPipeBusy:
      case controlRegDPCTMEM:
        this.hardware.dpcDevice.writeReg32(controlRegToDPCReg(controlReg), value);
        break;
      default:
        console.log(`Unhandled RSP MTC0 register: ${controlReg} = ${toString32(value)}`)
        break;
    }
  }
}

const specialTable = (() => {
  let specialTbl = [];
  for (let i = 0; i < 64; i++) {
    specialTbl[i] = executedUnknown;
  }

  specialTbl[0] = executeSLL;
  specialTbl[2] = executeSRL;
  specialTbl[3] = executeSRA;
  specialTbl[4] = executeSLLV;
  specialTbl[6] = executeSRLV;
  specialTbl[7] = executeSRAV;
  specialTbl[8] = executeJR;
  specialTbl[9] = executeJALR;
  specialTbl[13] = executeBREAK;
  specialTbl[32] = executeADD;
  specialTbl[33] = executeADDU;
  specialTbl[34] = executeSUB;
  specialTbl[35] = executeSUBU;
  specialTbl[36] = executeAND;
  specialTbl[37] = executeOR;
  specialTbl[38] = executeXOR;
  specialTbl[39] = executeNOR;
  specialTbl[42] = executeSLT;
  specialTbl[43] = executeSLTU;
  return specialTbl;
})();

const regImmTable = (() => {
  let regImmTbl = [];
  for (let i = 0; i < 32; i++) {
    regImmTbl.push(executedUnknown);
  }

  regImmTbl[0] = executeBLTZ;
  regImmTbl[1] = executeBGEZ;
  regImmTbl[16] = executeBLTZAL;
  regImmTbl[17] = executeBGEZAL;
  return regImmTbl;
})();

const cop0Table = (() => {
  let cop0Tbl = [];
  for (let i = 0; i < 32; i++) {
    cop0Tbl.push(executedUnknown);
  }
  cop0Tbl[0] = executeMFC0;
  cop0Tbl[4] = executeMTC0;
  return cop0Tbl;
})();

const cop2Table = (() => {
  let cop2Tbl = [];
  for (let i = 0; i < 32; i++) {
    cop2Tbl.push(executedUnknown);
  }
  cop2Tbl[0] = executeMFC2;
  cop2Tbl[2] = executeCFC2;
  cop2Tbl[4] = executeMTC2;
  cop2Tbl[6] = executeCTC2;

  for (let i = 16; i < 32; i++) {
    cop2Tbl[i] = executeVector;
  }
  return cop2Tbl;
})();

const vectorTable = (() => {
  let vectorTbl = [];
  for (let i = 0; i < 64; i++) {
    vectorTbl.push(executedUnknown);
  }

  // TODO: flesh these out.
  vectorTbl[0] = executeVMULF;
  vectorTbl[1] = executeVMULU;
  vectorTbl[2] = executeVRNDP;
  vectorTbl[3] = executeVMULQ;
  vectorTbl[4] = executeVMUDL;
  vectorTbl[5] = executeVMUDM;
  vectorTbl[6] = executeVMUDN;
  vectorTbl[7] = executeVMUDH;
  vectorTbl[8] = executeVMACF;
  vectorTbl[9] = executeVMACU;
  vectorTbl[10] = executeVRNDN;
  vectorTbl[11] = executeVMACQ;
  vectorTbl[12] = executeVMADL;
  vectorTbl[13] = executeVMADM;
  vectorTbl[14] = executeVMADN;
  vectorTbl[15] = executeVMADH;
  vectorTbl[16] = executeVADD;
  vectorTbl[17] = executeVSUB;
  vectorTbl[18] = executeVSUT;
  vectorTbl[19] = executeVABS;
  vectorTbl[20] = executeVADDC;
  vectorTbl[21] = executeVSUBC;
  vectorTbl[22] = executeVADDB;
  vectorTbl[23] = executeVSUBB;
  vectorTbl[24] = executeVACCB;
  vectorTbl[25] = executeVSUCB;
  vectorTbl[26] = executeVSAD;
  vectorTbl[27] = executeVSAC;
  vectorTbl[28] = executeVSUM;
  vectorTbl[29] = executeVSAR;
  vectorTbl[30] = executeV30;
  vectorTbl[31] = executeV31;
  vectorTbl[32] = executeVLT;
  vectorTbl[33] = executeVEQ;
  vectorTbl[34] = executeVNE;
  vectorTbl[35] = executeVGE;
  vectorTbl[36] = executeVCL;
  vectorTbl[37] = executeVCH;
  vectorTbl[38] = executeVCR;
  vectorTbl[39] = executeVMRG;
  vectorTbl[40] = executeVAND;
  vectorTbl[41] = executeVNAND;
  vectorTbl[42] = executeVOR;
  vectorTbl[43] = executeVNOR;
  vectorTbl[44] = executeVXOR;
  vectorTbl[45] = executeVNXOR;
  vectorTbl[46] = executeV46;
  vectorTbl[47] = executeV47;
  vectorTbl[48] = executeVRCP;
  vectorTbl[49] = executeVRCPL;
  vectorTbl[50] = executeVRCPH;
  vectorTbl[51] = executeVMOV;
  vectorTbl[52] = executeVRSQ;
  vectorTbl[53] = executeVRSQL;
  vectorTbl[54] = executeVRSQH;
  vectorTbl[55] = executeVNOP;
  vectorTbl[56] = executeVEXTT;
  vectorTbl[57] = executeVEXTQ;
  vectorTbl[58] = executeVEXTN;
  vectorTbl[59] = executeV59;
  vectorTbl[60] = executeVINST;
  vectorTbl[61] = executeVINSQ;
  vectorTbl[62] = executeVINSN;
  vectorTbl[63] = executeVNULL;
  return vectorTbl;
})();

function executeVector(i) {
  return vectorTable[funct(i)](i);
}

const lc2Table = (() => {
  let lc2Tbl = [];
  for (let i = 0; i < 32; i++) {
    lc2Tbl.push(executedUnknown);
  }

  lc2Tbl[0] = executeLBV;
  lc2Tbl[1] = executeLSV;
  lc2Tbl[2] = executeLLV;
  lc2Tbl[3] = executeLDV;
  lc2Tbl[4] = executeLQV;
  lc2Tbl[5] = executeLRV;
  lc2Tbl[6] = executeLPV;
  lc2Tbl[7] = executeLUV;
  lc2Tbl[8] = executeLHV;
  lc2Tbl[9] = executeLFV;
  lc2Tbl[10] = executeLWV;
  lc2Tbl[11] = executeLTV;

  return lc2Tbl;
})();

const sc2Table = (() => {
  let sc2Tbl = [];
  for (let i = 0; i < 32; i++) {
    sc2Tbl.push(executedUnknown);
  }

  sc2Tbl[0] = executeSBV;
  sc2Tbl[1] = executeSSV;
  sc2Tbl[2] = executeSLV;
  sc2Tbl[3] = executeSDV;
  sc2Tbl[4] = executeSQV;
  sc2Tbl[5] = executeSRV;
  sc2Tbl[6] = executeSPV;
  sc2Tbl[7] = executeSUV;
  sc2Tbl[8] = executeSHV;
  sc2Tbl[9] = executeSFV;
  sc2Tbl[10] = executeSWV;
  sc2Tbl[11] = executeSTV;

  return sc2Tbl;
})();

const simpleTable = (() => {
  let simpleTbl = [];
  for (let i = 0; i < 64; i++) {
    simpleTbl.push(executedUnknown);
  }

  simpleTbl[0] = i => specialTable[funct(i)](i);
  simpleTbl[1] = i => regImmTable[rt(i)](i);
  simpleTbl[2] = executeJ;
  simpleTbl[3] = executeJAL;
  simpleTbl[4] = executeBEQ;
  simpleTbl[5] = executeBNE;
  simpleTbl[6] = executeBLEZ;
  simpleTbl[7] = executeBGTZ;
  simpleTbl[8] = executeADDI;
  simpleTbl[9] = executeADDIU;
  simpleTbl[10] = executeSLTI;
  simpleTbl[11] = executeSLTIU;
  simpleTbl[12] = executeANDI;
  simpleTbl[13] = executeORI;
  simpleTbl[14] = executeXORI;
  simpleTbl[15] = executeLUI;
  simpleTbl[16] = i => cop0Table[rs(i)](i);
  simpleTbl[18] = i => cop2Table[rs(i)](i);
  simpleTbl[32] = executeLB;
  simpleTbl[33] = executeLH;
  simpleTbl[35] = executeLW;
  simpleTbl[36] = executeLBU;
  simpleTbl[37] = executeLHU;
  simpleTbl[39] = executeLWU;
  simpleTbl[40] = executeSB;
  simpleTbl[41] = executeSH;
  simpleTbl[43] = executeSW;
  simpleTbl[50] = i => lc2Table[rd(i)](i);
  simpleTbl[58] = i => sc2Table[rd(i)](i);
  return simpleTbl;
})();

function executedUnknown(i) {
  rsp.disassembleAll();
  n64js.halt(`RSP: unknown op, pc: ${toString16(rsp.pc)}, instruction: ${toString32(i)}`);
}

// Special Ops.
function executeSLL(i) { rsp.setRegS32(rd(i), rsp.getRegS32(rt(i)) << sa(i)); }
function executeSRL(i) { rsp.setRegS32(rd(i), rsp.getRegS32(rt(i)) >>> sa(i)); }
function executeSRA(i) { rsp.setRegS32(rd(i), rsp.getRegS32(rt(i)) >> sa(i)); }
function executeSLLV(i) { rsp.setRegS32(rd(i), rsp.getRegS32(rt(i)) << (rsp.getRegS32(rs(i)) & 0x1f)); }
function executeSRLV(i) { rsp.setRegS32(rd(i), rsp.getRegS32(rt(i)) >>> (rsp.getRegS32(rs(i)) & 0x1f)); }
function executeSRAV(i) { rsp.setRegS32(rd(i), rsp.getRegS32(rt(i)) >> (rsp.getRegS32(rs(i)) & 0x1f)); }

function executeJR(i) { rsp.jump(rsp.getRegS32(rs(i))); }
function executeJALR(i) {
  const newPC = rsp.getRegS32(rs(i));
  rsp.setRegS32(rd(i), rsp.nextPC + 4);
  rsp.jump(newPC);
}

// FIXME: actually signal break.
function executeBREAK(i) { rsp.halt(SP_STATUS_BROKE); }
function executeADD(i) { rsp.setRegS32(rd(i), rsp.getRegS32(rs(i)) + rsp.getRegS32(rt(i))); }
function executeADDU(i) { rsp.setRegU32(rd(i), rsp.getRegU32(rs(i)) + rsp.getRegU32(rt(i))); }
function executeSUB(i) { rsp.setRegS32(rd(i), rsp.getRegS32(rs(i)) - rsp.getRegS32(rt(i))); }
function executeSUBU(i) { rsp.setRegU32(rd(i), rsp.getRegU32(rs(i)) - rsp.getRegU32(rt(i))); }
function executeAND(i) { rsp.setRegU32(rd(i), rsp.getRegU32(rs(i)) & rsp.getRegU32(rt(i))); }
function executeOR(i) { rsp.setRegU32(rd(i), rsp.getRegU32(rs(i)) | rsp.getRegU32(rt(i))); }
function executeXOR(i) { rsp.setRegU32(rd(i), rsp.getRegU32(rs(i)) ^ rsp.getRegU32(rt(i))); }
function executeNOR(i) { rsp.setRegU32(rd(i), ~(rsp.getRegU32(rs(i)) | rsp.getRegU32(rt(i)))); }
function executeSLT(i) { rsp.setRegS32(rd(i), (rsp.getRegS32(rs(i)) < rsp.getRegS32(rt(i))) ? 1 : 0); }
function executeSLTU(i) { rsp.setRegU32(rd(i), (rsp.getRegU32(rs(i)) < rsp.getRegU32(rt(i))) ? 1 : 0); }

// RegImm Ops.
function executeBLTZ(i) { rsp.conditionalBranch(rsp.getRegS32(rs(i)) < 0, offset(i)); }
function executeBGEZ(i) { rsp.conditionalBranch(rsp.getRegS32(rs(i)) >= 0, offset(i)); }
function executeBLTZAL(i) {
  const cond = rsp.getRegS32(rs(i)) < 0;
  rsp.setRegS32(RA, rsp.nextPC + 4);
  rsp.conditionalBranch(cond, offset(i));
}
function executeBGEZAL(i) {
  const cond = rsp.getRegS32(rs(i)) >= 0;
  rsp.setRegS32(RA, rsp.nextPC + 4);
  rsp.conditionalBranch(cond, offset(i));
}

// Cop0 Ops.
function executeMFC0(i) { rsp.setRegU32(rt(i), rsp.moveFromControl(rd(i))); }
function executeMTC0(i) { rsp.moveToControl(rd(i), rsp.getRegU32(rt(i))); }

// Cop2 Ops.
function executeMFC2(i) {
  rsp.setRegS16SignExtend(rt(i), rsp.getVecU16UnalignedWrap(rd(i), vmemEl(i)));
}

function executeMTC2(i) {
  rsp.setVecU16UnalignedNoWrap(rd(i), vmemEl(i), rsp.getRegU32(rt(i)));
}

function executeCFC2(i) {
  let value;
  switch (rd(i) & 0x03) {
    case 0: value = (rsp.VCO << 16) >> 16; break;
    case 1: value = (rsp.VCC << 16) >> 16; break;
    case 2: value = rsp.VCE; break;
    case 3: value = rsp.VCE; break;
  }
  rsp.setRegU32(rt(i), value);
}

function executeCTC2(i) {
  const value = rsp.getRegS32(rt(i));
  switch (rd(i) & 0x03) {
    case 0: rsp.VCO = value; break;
    case 1: rsp.VCC = value; break;
    case 2: rsp.VCE = value; break;
    case 3: rsp.VCE = value; break;
  }
}

/**
 * Saturate a signed 48 bit accumulator value, treating the result as signed.
 * @param {BigInt} x 
 * @param {BigInt} shift Right shift to apply to the result.
 * @param {Number} negLimit Value to return on negative underflow
 * @param {Number} posLimit Value to return on positive underflow.
 * @returns {Number}
 */
function saturateSigned(x, shift, negLimit, posLimit) {
  if (x >= 0) {
    return ((x & ~0x7fff_ffffn) != 0) ? posLimit : Number(x >> shift);
  }
  return ((~x & ~0x7fff_ffffn) != 0) ? negLimit : Number(x >> shift);
}

/**
 * Saturate a signed 48 bit accumulator value, treating the result as unsigned.
 * @param {BigInt} x 
 * @param {BigInt} shift Right shift to apply to the result.
 * @param {Number} negLimit Value to return on negative underflow
 * @param {Number} posLimit Value to return on positive underflow.
 * @returns {Number}
 */
function saturateUnsigned(x, shift, negLimit, posLimit) {
  if (x >= 0) {
    return ((x & ~0x7fff_ffffn) != 0) ? posLimit : Number(x >> shift);
  }
  return negLimit;
}

// TODO: can this be implemented in terms of saturateSigned?
function clampSigned(x) {
  if (x < -32768) return -32768;
  if (x > 32767) return 32767;
  return x;
}

function vectorZero(i) {
  const s = cop2VS(i);
  const t = cop2VT(i);

  for (let el = 0, select = rsp.vecSelectU32[cop2E(i)]; el < 8; el++, select >>= 4) {
    const a = rsp.getVecS16(s, el);
    const b = rsp.getVecS16(t, select & 0x7);
    rsp.setAccLow(el, a + b);
  }
  rsp.setVecZero(cop2VD(i));
}

// All these instructions just set the accumulator and zero the target register.
function executeVSUT(i) { vectorZero(i); }
function executeVADDB(i) { vectorZero(i); }
function executeVSUBB(i) { vectorZero(i); }
function executeVACCB(i) { vectorZero(i); }
function executeVSUCB(i) { vectorZero(i); }
function executeVSAD(i) { vectorZero(i); }
function executeVSAC(i) { vectorZero(i); }
function executeVSUM(i) { vectorZero(i); }
function executeV30(i) { vectorZero(i); }
function executeV31(i) { vectorZero(i); }
function executeV46(i) { vectorZero(i); }
function executeV47(i) { vectorZero(i); }
function executeVEXTT(i) { vectorZero(i); }
function executeVEXTQ(i) { vectorZero(i); }
function executeVEXTN(i) { vectorZero(i); }
function executeV59(i) { vectorZero(i); }
function executeVINST(i) { vectorZero(i); }
function executeVINSQ(i) { vectorZero(i); }
function executeVINSN(i) { vectorZero(i); }

// Vector Multiply of Signed Fractions.
function executeVMULF(i) {
  rsp.vectorMulFractions(cop2VS(i), cop2VT(i), cop2E(i), false, 0x8000);
  rsp.setVecFromAccSignedMid(cop2VD(i));
}

// Vector Multiply of Unsigned Fractions.
function executeVMULU(i) {
  rsp.vectorMulFractions(cop2VS(i), cop2VT(i), cop2E(i), false, 0x8000);
  rsp.setVecFromAccUnsignedMid(cop2VD(i));
}

// Vector Multiply-Accumulate of Signed Fractions.
function executeVMACF(i) {
  rsp.vectorMulFractions(cop2VS(i), cop2VT(i), cop2E(i), true, 0);
  rsp.setVecFromAccSignedMid(cop2VD(i));
}

// Vector Multiply-Accumulate of Unsigned Fractions.
function executeVMACU(i) {
  rsp.vectorMulFractions(cop2VS(i), cop2VT(i), cop2E(i), true, 0);
  rsp.setVecFromAccUnsignedMid(cop2VD(i));
}

// Vector Accumulator DCT Rounding (Negative).
function executeVRNDN(i) {
  rsp.vectorRound(cop2VS(i), cop2VT(i), cop2E(i), false);
  rsp.setVecFromAccSignedMid(cop2VD(i));
}

// Vector Accumulator DCT Rounding (Positive).
function executeVRNDP(i) {
  rsp.vectorRound(cop2VS(i), cop2VT(i), cop2E(i), true);
  rsp.setVecFromAccSignedMid(cop2VD(i));
}

// Vector Multiply of Low Partial Products.
function executeVMUDL(i) {
  rsp.vectorMulPartialLow(cop2VS(i), cop2VT(i), cop2E(i), false);
  rsp.setVecFromAccLow(cop2VD(i));
}

// Vector Multiply-Accumulate of Low Partial Products.
function executeVMADL(i) {
  rsp.vectorMulPartialLow(cop2VS(i), cop2VT(i), cop2E(i), true);
  rsp.setVecFromAccSignedLow(cop2VD(i));
}

// Vector Multiply of Mid Partial Products.
function executeVMUDM(i) {
  rsp.vectorMulPartialMidM(cop2VS(i), cop2VT(i), cop2E(i), false);
  rsp.setVecFromAccMid(cop2VD(i));
}

// Vector Multiply-Accumulate of Mid Partial Products.
function executeVMADM(i) {
  rsp.vectorMulPartialMidM(cop2VS(i), cop2VT(i), cop2E(i), true);
  rsp.setVecFromAccSignedMid(cop2VD(i));
}

// Vector Multiply of Mid Partial Products.
function executeVMUDN(i) {
  rsp.vectorMulPartialMidN(cop2VS(i), cop2VT(i), cop2E(i), false);
  rsp.setVecFromAccLow(cop2VD(i));
}

// Vector Multiply-Accumulate of Mid Partial Products.
function executeVMADN(i) {
  rsp.vectorMulPartialMidN(cop2VS(i), cop2VT(i), cop2E(i), true);
  rsp.setVecFromAccSignedLow(cop2VD(i));
}

// Vector Multiply of High Partial Products.
function executeVMUDH(i) {
  rsp.vectorMulPartialHigh(cop2VS(i), cop2VT(i), cop2E(i), false);
  rsp.setVecFromAccSignedMid(cop2VD(i));
}

// Vector Multiply-Accumulate of High Partial Products.
function executeVMADH(i) {
  rsp.vectorMulPartialHigh(cop2VS(i), cop2VT(i), cop2E(i), true);
  rsp.setVecFromAccSignedMid(cop2VD(i));
}

// Vector Multiply MPEG Quantization.
function executeVMULQ(i) {
  const vs = cop2VS(i);
  const vt = cop2VT(i);

  for (let el = 0, select = rsp.vecSelectU32[cop2E(i)]; el < 8; el++, select >>= 4) {
    const s = rsp.getVecS16(vs, el);
    const t = rsp.getVecS16(vt, select & 0x7);
    const product = BigInt(s * t) << 16n;
    rsp.setAccS48(el, product + (product < 0 ? 0x1f0000n : 0n));
  }
  rsp.setVecFromAccOddified(cop2VD(i));
}

// Vector Accumulator Oddification.
function executeVMACQ(i) {
  for (let el = 0; el < 8; el++) {
    // TODO: add a conditional inc?
    const acc = rsp.getAccS48(el);
    let incr = 0n;
    if ((acc & 0x20_0000n) == 0) {
      const upper = acc >> 22n;
      if (upper < 0) {
        incr = 0x20_0000n;
      } else if (upper > 0) {
        incr = -0x20_0000n;
      }
    }
    rsp.setAccS48(el, acc + incr);
  }
  rsp.setVecFromAccOddified(cop2VD(i));
}

// Vector Add of Short Elements
function executeVADD(i) {
  const vs = cop2VS(i);
  const vt = cop2VT(i);

  const vco = rsp.VCO;
  const dv = rsp.vecTemp;
  for (let el = 0, select = rsp.vecSelectU32[cop2E(i)]; el < 8; el++, select >>= 4) {
    const s = rsp.getVecS16(vs, el);
    const t = rsp.getVecS16(vt, select & 0x7);
    const c = (vco >> el) & 0x1;
    const result = s + t + c;
    rsp.setAccLow(el, result);
    dv.setInt16(el * 2, clampSigned(result));
  }
  rsp.setVecFromTemp(cop2VD(i));
  rsp.VCO = 0;
}

// Vector Subtraction of Short Elements
function executeVSUB(i) {
  const vs = cop2VS(i);
  const vt = cop2VT(i);

  const vco = rsp.VCO;
  const dv = rsp.vecTemp;
  for (let el = 0, select = rsp.vecSelectU32[cop2E(i)]; el < 8; el++, select >>= 4) {
    const s = rsp.getVecS16(vs, el);
    const t = rsp.getVecS16(vt, select & 0x7);
    const c = (vco >> el) & 0x1;
    const result = s - (t + c);
    rsp.setAccLow(el, result);
    dv.setInt16(el * 2, clampSigned(result));
  }
  rsp.setVecFromTemp(cop2VD(i));
  rsp.VCO = 0;
}

function conditionalNegate(s, x) {
  if (s < 0) { return -x; }
  if (s > 0) { return x; }
  return 0;
}

// Vector Absolute Value of Short Elements.
function executeVABS(i) {
  const vs = cop2VS(i);
  const vt = cop2VT(i);

  const dv = rsp.vecTemp;
  for (let el = 0, select = rsp.vecSelectU32[cop2E(i)]; el < 8; el++, select >>= 4) {
    const s = rsp.getVecS16(vs, el);
    const t = rsp.getVecU16(vt, select & 0x7);

    const overflow = (s < 0) && t == 0x8000;
    const result = conditionalNegate(s, t);
    rsp.setAccLow(el, overflow ? 0x8000 : result);
    dv.setInt16(el * 2, overflow ? 0x7fff : result);
  }
  rsp.setVecFromTemp(cop2VD(i));
}

// Vector Add Short Elements With Carry.
function executeVADDC(i) {
  const vs = cop2VS(i);
  const vt = cop2VT(i);

  let newVCO = 0;
  for (let el = 0, select = rsp.vecSelectU32[cop2E(i)]; el < 8; el++, select >>= 4) {
    const s = rsp.getVecU16(vs, el);
    const t = rsp.getVecU16(vt, select & 0x7);
    const result = s + t;
    rsp.setAccLow(el, result);

    newVCO |= (result & ~0xffff) ? (1 << el) : 0;
  }
  rsp.setVecFromAccLow(cop2VD(i));
  rsp.VCO = newVCO;
}

// Vector Subtraction of Short Elements With Carry.
function executeVSUBC(i) {
  const vs = cop2VS(i);
  const vt = cop2VT(i);

  let newVCO = 0;
  for (let el = 0, select = rsp.vecSelectU32[cop2E(i)]; el < 8; el++, select >>= 4) {
    const s = rsp.getVecU16(vs, el);
    const t = rsp.getVecU16(vt, select & 0x7);
    const result = s - t;
    rsp.setAccLow(el, result);

    newVCO |= (result != 0) ? (1 << (el + 8)) : 0;
    newVCO |= (result < 0) ? (1 << (el + 0)) : 0;
  }
  rsp.setVecFromAccLow(cop2VD(i));
  rsp.VCO = newVCO;
}

// Constants for accessing different parts of the accumulator via VSAR.
const vsarHigh = 8;
const vsarMid = 9;
const vsarLow = 10;

// Vector Accumulator Read (and Write).
function executeVSAR(i) {
  const d = cop2VD(i);

  // TODO: The docs suggest we need to set vAcc from VS register value.

  switch (cop2E(i)) {
    case vsarHigh:
      for (let el = 0; el < 8; el++) {
        rsp.setVecS16(d, el, rsp.getAccHigh(el));
      }
      break;
    case vsarMid:
      for (let el = 0; el < 8; el++) {
        rsp.setVecS16(d, el, rsp.getAccMid(el));
      }
      break;
    case vsarLow:
      for (let el = 0; el < 8; el++) {
        rsp.setVecS16(d, el, rsp.getAccLow(el));
      }
      break;
    default:
      for (let el = 0; el < 8; el++) {
        rsp.setVecS16(d, el, 0);
      }
      break;
  }
}

// Vector Select Less Than.
function executeVLT(i) {
  const vs = cop2VS(i);
  const vt = cop2VT(i);

  const vco = rsp.VCO;
  let vccLo = 0;
  let vccHi = 0;
  for (let el = 0, select = rsp.vecSelectU32[cop2E(i)]; el < 8; el++, select >>= 4) {
    const s = rsp.getVecS16(vs, el);
    const t = rsp.getVecS16(vt, select & 0x7);

    const elBit = 1 << el;
    const vcoLo = (vco & elBit) != 0;
    const vcoHi = (vco & (elBit << 8)) != 0;
    const onEqual = vcoLo && vcoHi;

    const cond = s < t || ((s == t) && onEqual);
    const result = cond ? s : t;
    vccLo |= cond ? elBit : 0;

    rsp.setAccLow(el, result);
  }
  rsp.setVecFromAccLow(cop2VD(i));
  rsp.setVCCHiLo(vccHi, vccLo);
  rsp.VCO = 0;
}

// Vector Select Equal.
function executeVEQ(i) {
  const vs = cop2VS(i);
  const vt = cop2VT(i);

  const vco = rsp.VCO;
  let vccLo = 0;
  let vccHi = 0;
  for (let el = 0, select = rsp.vecSelectU32[cop2E(i)]; el < 8; el++, select >>= 4) {
    const s = rsp.getVecS16(vs, el);
    const t = rsp.getVecS16(vt, select & 0x7);

    const elBit = 1 << el;
    const vcoHi = (vco & (elBit << 8)) != 0;

    const cond = (s == t) && !vcoHi;
    const result = t;
    vccLo |= cond ? elBit : 0;

    rsp.setAccLow(el, result);
  }
  rsp.setVecFromAccLow(cop2VD(i));
  rsp.setVCCHiLo(vccHi, vccLo);
  rsp.VCO = 0;
}

// Vector Select Not Equal.
function executeVNE(i) {
  const vs = cop2VS(i);
  const vt = cop2VT(i);

  const vco = rsp.VCO;
  let vccLo = 0;
  let vccHi = 0;
  for (let el = 0, select = rsp.vecSelectU32[cop2E(i)]; el < 8; el++, select >>= 4) {
    const s = rsp.getVecS16(vs, el);
    const t = rsp.getVecS16(vt, select & 0x7);

    const elBit = 1 << el;
    const vcoHi = (vco & (elBit << 8)) != 0;

    const cond = (s != t) || vcoHi;
    const result = s;
    vccLo |= cond ? elBit : 0;

    rsp.setAccLow(el, result);
  }
  rsp.setVecFromAccLow(cop2VD(i));
  rsp.VCC = (vccHi << 8) | vccLo;
  rsp.setVCCHiLo(vccHi, vccLo);
  rsp.VCO = 0;
}

// Vector Select Greater Than or Equal.
function executeVGE(i) {
  const vs = cop2VS(i);
  const vt = cop2VT(i);

  const vco = rsp.VCO;
  let vccLo = 0;
  let vccHi = 0;
  for (let el = 0, select = rsp.vecSelectU32[cop2E(i)]; el < 8; el++, select >>= 4) {
    const s = rsp.getVecS16(vs, el);
    const t = rsp.getVecS16(vt, select & 0x7);

    const elBit = 1 << el;
    const vcoLo = (vco & elBit) != 0;
    const vcoHi = (vco & (elBit << 8)) != 0;
    const onEqual = vcoLo && vcoHi;

    const cond = s > t || ((s == t) && !onEqual);
    const result = cond ? s : t;
    vccLo |= cond ? elBit : 0;

    rsp.setAccLow(el, result);
  }
  rsp.setVecFromAccLow(cop2VD(i));
  rsp.setVCCHiLo(vccHi, vccLo);
  rsp.VCO = 0;
}

// Vector Select Clip Test Low.
function executeVCL(i) {
  const vs = cop2VS(i);
  const vt = cop2VT(i);

  const vccHi = rsp.VCCHi;
  const vccLo = rsp.VCCLo;
  const vce = rsp.VCE;
  const vcoHi = rsp.VCOHi;
  const vcoLo = rsp.VCOLo;

  let vccOutHi = 0;
  let vccOutLo = 0;

  for (let el = 0, select = rsp.vecSelectU32[cop2E(i)]; el < 8; el++, select >>= 4) {
    const s = rsp.getVecU16(vs, el);
    const t = rsp.getVecU16(vt, select & 0x7);

    let le = (vccLo >> el) & 1;
    let ge = (vccHi >> el) & 1;
    const ce = (vce >> el) & 1;
    const eq = (~(vcoHi >> el)) & 1;
    const sign = (vcoLo >> el) & 1;

    let result;
    if (sign) {
      if (eq) {
        const sum = (s + t) & 0xffff;
        const carry = (s + t) > 0xffff;
        // TODO: which of these are correct? Or does it not matter?
        // First is according to RSP docs. Second is what n64-systemtest checks for.
        le = (!ce && (!sum && !carry)) || (ce && (!sum || !carry));
        // le = (!sum && !carry) || (ce && (!sum || !carry));
      }
      result = le ? -t : s;
    } else {
      if (eq) {
        ge = (s - t) >= 0;
      }
      result = ge ? t : s;
    }
    rsp.setAccLow(el, result);
    vccOutHi |= ge << el;
    vccOutLo |= le << el
  }

  rsp.setVecFromAccLow(cop2VD(i));
  rsp.setVCCHiLo(vccOutHi, vccOutLo);
  rsp.VCO = 0;
  rsp.VCE = 0;
}

// Vector Select Clip Test High.
function executeVCH(i) {
  const vs = cop2VS(i);
  const vt = cop2VT(i);

  let vccHi = 0;
  let vccLo = 0;
  let vcoHi = 0;
  let vcoLo = 0;
  let vce = 0;
  for (let el = 0, select = rsp.vecSelectU32[cop2E(i)]; el < 8; el++, select >>= 4) {
    const s = rsp.getVecS16(vs, el);
    const t = rsp.getVecS16(vt, select & 0x7);

    let le, ge, ce, ne, result;
    const sign = (s ^ t) < 0;
    if (sign) {
      const sum = ((s + t) << 16) >> 16;
      ge = t < 0;
      le = sum <= 0;
      ce = sum == -1;
      ne = sum != 0 && (s != ~t);
      result = le ? -t : s;
    } else {
      const diff = ((s - t) << 16) >> 16;
      le = t < 0;
      ge = diff >= 0;
      ce = 0;
      ne = diff != 0;
      result = ge ? t : s;
    }
    rsp.setAccLow(el, result);

    vccHi |= ge << el;
    vccLo |= le << el
    vcoHi |= ne << el;
    vcoLo |= sign << el;
    vce |= ce << el;
  }

  rsp.setVecFromAccLow(cop2VD(i));
  rsp.setVCCHiLo(vccHi, vccLo);
  rsp.setVCOHiLo(vcoHi, vcoLo);
  rsp.VCE = vce;
}

// Vector Select Crimp Test Low.
function executeVCR(i) {
  const vs = cop2VS(i);
  const vt = cop2VT(i);

  let vccHi = 0;
  let vccLo = 0;
  for (let el = 0, select = rsp.vecSelectU32[cop2E(i)]; el < 8; el++, select >>= 4) {
    const s = rsp.getVecS16(vs, el);
    const t = rsp.getVecS16(vt, select & 0x7);

    let le, ge, result;
    if ((s ^ t) < 0) {
      ge = t < 0;
      le = (s + t + 1) <= 0;
      result = le ? ~t : s;
    } else {
      le = t < 0;
      ge = (s - t) >= 0;
      result = ge ? t : s;
    }
    vccLo |= le << el;
    vccHi |= ge << el;

    rsp.setAccLow(el, result);
  }
  rsp.setVecFromAccLow(cop2VD(i));
  rsp.setVCCHiLo(vccHi, vccLo);
  rsp.VCO = 0;
  rsp.VCE = 0;
}

// Vector Select Merge.
function executeVMRG(i) {
  const vs = cop2VS(i);
  const vt = cop2VT(i);

  let vcc = rsp.VCC;
  for (let el = 0, select = rsp.vecSelectU32[cop2E(i)]; el < 8; el++, vcc >>= 1, select >>= 4) {
    const s = rsp.getVecU16(vs, el);
    const t = rsp.getVecU16(vt, select & 0x7);
    const result = (vcc & 1) ? s : t;
    rsp.setAccLow(el, result);
  }
  rsp.setVecFromAccLow(cop2VD(i));
  rsp.VCO = 0;
}

// Vector <logical> of Short Elements.
function executeVAND(i) { vectorLogical(i, (s, t) => s & t); }
function executeVNAND(i) { vectorLogical(i, (s, t) => ~(s & t)); }
function executeVOR(i) { vectorLogical(i, (s, t) => s | t); }
function executeVNOR(i) { vectorLogical(i, (s, t) => ~(s | t)); }
function executeVXOR(i) { vectorLogical(i, (s, t) => s ^ t); }
function executeVNXOR(i) { vectorLogical(i, (s, t) => ~(s ^ t)); }

function vectorLogical(i, fn) {
  const vs = cop2VS(i);
  const vt = cop2VT(i);
  for (let el = 0, select = rsp.vecSelectU32[cop2E(i)]; el < 8; el++, select >>= 4) {
    const s = rsp.getVecU16(vs, el);
    const t = rsp.getVecU16(vt, select & 0x7);
    rsp.setAccLow(el, fn(s, t));
  }
  rsp.setVecFromAccLow(cop2VD(i));
}

// Vector Element Scalar Move.
function executeVMOV(i) {
  const vt = cop2VT(i);
  const vd = cop2VD(i);
  const vde = cop2DE(i) & 7;

  // The low accumulator bits are set to VT, using the broadcast pattern.
  const vselect = rsp.vecSelectU32[cop2E(i)];
  for (let el = 0, select = vselect; el < 8; el++, select >>= 4) {
    const accVal = rsp.getVecS16(vt, select & 0x7);
    rsp.setAccLow(el, accVal);
  }

  // Only a single element is set.
  // The E is used to pick the broadcast pattern and DE is used to pick the element.
  rsp.setVecS16(vd, vde & 7, rsp.getVecS16(vt, (vselect >> (4 * vde)) & 7));
}

function vectorSetAccFromReg(vt, vte) {
  for (let el = 0, select = rsp.vecSelectU32[vte]; el < 8; el++, select >>= 4) {
    const result = rsp.getVecS16(vt, select & 0x7);
    rsp.setAccLow(el, result);
  }
}

function vectorRecipHigh(i) {
  const vt = cop2VT(i);
  const vte = cop2E(i);

  // Accumulator is set to the entire input vector.
  vectorSetAccFromReg(vt, vte);

  rsp.divDP = true;
  rsp.divIn = rsp.getVecS16(vt, vte & 7);
  rsp.setVecS16(cop2VD(i), cop2DE(i) & 7, rsp.divOut);
}

function vectorRecip(i, fn, dpInstruction) {
  const vt = cop2VT(i);
  const vte = cop2E(i);

  // Handle double or single precision.
  const val16 = rsp.getVecS16(vt, vte & 7);
  const input = (dpInstruction && rsp.divDP) ? ((rsp.divIn << 16) | (val16 & 0xffff)) : val16;

  // Accumulator is set to the entire input vector.
  vectorSetAccFromReg(vt, vte);

  // Output is set to the result.
  const result = fn(input);
  rsp.divDP = false;
  rsp.divOut = result >> 16;
  rsp.setVecS16(cop2VD(i), cop2DE(i) & 7, result & 0xffff);
}

// Vector Element Scalar Reciprocal (Single Precision).
function executeVRCP(i) { vectorRecip(i, rcp16, false); }

// Vector Element Scalar Reciprocal (Double Precision Low).
function executeVRCPL(i) { vectorRecip(i, rcp16, true); }

// Vector Element Scalar Reciprocal (Double Precision High).
function executeVRCPH(i) { vectorRecipHigh(i); }

// Vector Element Scalar SQRT Reciprocal.
function executeVRSQ(i) { vectorRecip(i, rsq16, false); }

// Vector Element Scalar SQRT Reciprocal (Double Precision Low).
function executeVRSQL(i) { vectorRecip(i, rsq16, true); }

// Vector Element Scalar SQRT Reciprocal (Double Precision High).
function executeVRSQH(i) { vectorRecipHigh(i); }

function executeVNOP(i) { /* No-op */ }
function executeVNULL(i) { /* No-op */ }

// Simple Ops.
function executeJ(i) { rsp.jump(jumpAddress(rsp.pc, i)); }
function executeJAL(i) { rsp.setRegS32(RA, rsp.nextPC + 4); rsp.jump(jumpAddress(rsp.pc, i)); }
function executeBEQ(i) { rsp.conditionalBranch(rsp.getRegS32(rs(i)) === rsp.getRegS32(rt(i)), offset(i)); }
function executeBNE(i) { rsp.conditionalBranch(rsp.getRegS32(rs(i)) !== rsp.getRegS32(rt(i)), offset(i)); }
function executeBLEZ(i) { rsp.conditionalBranch(rsp.getRegS32(rs(i)) <= 0, offset(i)); }
function executeBGTZ(i) { rsp.conditionalBranch(rsp.getRegS32(rs(i)) > 0, offset(i)); }
function executeADDI(i) { rsp.setRegS32(rt(i), rsp.getRegS32(rs(i)) + imms(i)); }
function executeADDIU(i) { rsp.setRegS32(rt(i), rsp.getRegS32(rs(i)) + imms(i)); }
function executeSLTI(i) { rsp.setRegS32(rt(i), rsp.getRegS32(rs(i)) < imms(i) ? 1 : 0); }
function executeSLTIU(i) { rsp.setRegS32(rt(i), rsp.getRegU32(rs(i)) < (imms(i) >>> 0) ? 1 : 0); }
function executeANDI(i) { rsp.setRegS32(rt(i), rsp.getRegS32(rs(i)) & imm(i)); }
function executeORI(i) { rsp.setRegS32(rt(i), rsp.getRegS32(rs(i)) | imm(i)); }
function executeXORI(i) { rsp.setRegS32(rt(i), rsp.getRegS32(rs(i)) ^ imm(i)); }
function executeLUI(i) { rsp.setRegS32(rt(i), imms(i) << 16); }
function executeLB(i) { rsp.setRegS32(rt(i), rsp.loadS8(rsp.calcAddress(i))); }
function executeLBU(i) { rsp.setRegU32(rt(i), rsp.loadU8(rsp.calcAddress(i))); }
function executeLH(i) { rsp.setRegS32(rt(i), rsp.loadS16(rsp.calcAddress(i))); }
function executeLHU(i) { rsp.setRegU32(rt(i), rsp.loadU16(rsp.calcAddress(i))); }
function executeLW(i) { rsp.setRegS32(rt(i), rsp.loadS32(rsp.calcAddress(i))); }
function executeLWU(i) { rsp.setRegU32(rt(i), rsp.loadU32(rsp.calcAddress(i))); }
function executeSB(i) { rsp.store8(rsp.calcAddress(i), rsp.getRegS32(rt(i))); }
function executeSH(i) { rsp.store16(rsp.calcAddress(i), rsp.getRegS32(rt(i))); }
function executeSW(i) { rsp.store32(rsp.calcAddress(i), rsp.getRegS32(rt(i))); }


function loadVector(i, scale) {
  const addr = rsp.calcVecAddress(i, scale);
  const t = vmemVT(i);
  const el = vmemEl(i);

  const len = (16 - el) < scale ? (16 - el) : scale;

  for (let x = 0; x < len; x++) {
    rsp.setVecS8(t, (el + x), rsp.loadS8(addr + x));
  }
}

function storeVector(i, scale) {
  const addr = rsp.calcVecAddress(i, scale);
  const vt = vmemVT(i);
  const el = vmemEl(i);

  for (let x = 0; x < scale; x++) {
    rsp.store8(addr + x, rsp.getVecS8(vt, (el + x) & 15));
  }
}


function executeLBV(i) { loadVector(i, 1); }
function executeLSV(i) { loadVector(i, 2); }
function executeLLV(i) { loadVector(i, 4); }
function executeLDV(i) { loadVector(i, 8); }
function executeLQV(i) {
  const addr = rsp.calcVecAddress(i, 16);
  const end = (addr & 0xff0) + 16;
  const vt = vmemVT(i);
  const el = vmemEl(i);

  const len = Math.min(end - addr, 16 - el);
  for (let x = 0; x < len; x++) {
    rsp.setVecS8(vt, el + x, rsp.loadU8(addr + x));
  }
}

function executeLRV(i) {
  const end = rsp.calcVecAddress(i, 16);
  const addr = end & 0xff0;
  const vt = vmemVT(i);
  const el = vmemEl(i);

  const offset = end & 15;
  const startEl = (16 - offset) + el;
  const len = Math.min(offset, 16 - startEl);
  for (let x = 0; x < len; x++) {
    rsp.setVecS8(vt, startEl + x, rsp.loadU8(addr + x));
  }
}

function loadPacked(addr, t, el, shift, iScale) {
  const misalignment = addr & 7;
  const base = addr & 0xff8;
  for (let i = 0; i < 8; i++) {
    const memIdx = (16 - el + (i * iScale) + misalignment) & 0xf;
    rsp.setVecS16(t, i, rsp.loadU8(base + memIdx) << shift);
  }
}

function executeLPV(i) { loadPacked(rsp.calcVecAddress(i, 8), vmemVT(i), vmemEl(i), 8, 1); }
function executeLUV(i) { loadPacked(rsp.calcVecAddress(i, 8), vmemVT(i), vmemEl(i), 7, 1); }
function executeLHV(i) { loadPacked(rsp.calcVecAddress(i, 16), vmemVT(i), vmemEl(i), 7, 2); }

function executeLFV(i) {
  const addr = rsp.calcVecAddress(i, 16);
  const vt = vmemVT(i);
  const el = vmemEl(i);

  const misalignment = addr & 7;
  const base = addr & 0xff8;

  const dv = rsp.vecTemp;
  dv.setInt16(0, rsp.loadU8(base + ((misalignment + 0 - el) & 0xF)) << 7, false);
  dv.setInt16(2, rsp.loadU8(base + ((misalignment + 4 - el) & 0xF)) << 7, false);
  dv.setInt16(4, rsp.loadU8(base + ((misalignment + 8 - el) & 0xF)) << 7, false);
  dv.setInt16(6, rsp.loadU8(base + ((misalignment + 12 - el) & 0xF)) << 7, false);
  dv.setInt16(8, rsp.loadU8(base + ((misalignment + 8 - el) & 0xF)) << 7, false);
  dv.setInt16(10, rsp.loadU8(base + ((misalignment + 12 - el) & 0xF)) << 7, false);
  dv.setInt16(12, rsp.loadU8(base + ((misalignment + 0 - el) & 0xF)) << 7, false);
  dv.setInt16(14, rsp.loadU8(base + ((misalignment + 4 - el) & 0xF)) << 7, false);

  const len = Math.min(8, 16 - el);
  for (let i = el, n = el + len; i < n; i++) {
    rsp.setVecS8(vt, i, dv.getInt8(i, false));
  }
}

function executeLWV(i) { /* No-op */ }

function executeLTV(i) {
  const addr = rsp.calcVecAddress(i, 16);
  const vt = vmemVT(i);
  const el = vmemEl(i);

  const regBase = vt & ~7;
  const regOffset = el >> 1;
  const memBase = addr & ~7;
  const memOffset = (addr & 8) + el;

  for (let i = 0; i < 8; i++) {
    const regIdx = (regOffset + i) & 7;
    rsp.setVecS8(regBase + regIdx, (i * 2) + 0, rsp.loadU8(memBase + ((memOffset + (i * 2) + 0) & 0xf)));
    rsp.setVecS8(regBase + regIdx, (i * 2) + 1, rsp.loadU8(memBase + ((memOffset + (i * 2) + 1) & 0xf)));
  }
}

function executeSBV(i) { storeVector(i, 1); }
function executeSSV(i) { storeVector(i, 2); }
function executeSLV(i) { storeVector(i, 4); }
function executeSDV(i) { storeVector(i, 8); }

function executeSQV(i) {
  const addr = rsp.calcVecAddress(i, 16);
  const end = (addr & 0xff0) + 16;
  const vt = vmemVT(i);
  const el = vmemEl(i);

  let len = end - addr;
  for (let x = 0; x < len; x++) {
    // Stores wrap around the vector, unlike loads. 
    rsp.store8(addr + x, rsp.getVecS8(vt, (el + x) & 15));
  }
}

function executeSRV(i) {
  const end = rsp.calcVecAddress(i, 16);
  const addr = end & 0xff0;
  const vt = vmemVT(i);
  const el = vmemEl(i);

  const offset = end & 15;
  const startEl = (16 - offset) + el;
  const len = offset;
  for (let x = 0; x < len; x++) {
    // Stores wrap around the vector, unlike loads. 
    rsp.store8(addr + x, rsp.getVecS8(vt, (startEl + x) & 15));
  }
}

function executeSPV(i) {
  const addr = rsp.calcVecAddress(i, 8);
  const vt = vmemVT(i);
  const el = vmemEl(i);

  for (let i = 0; i < 8; i++) {
    const elIdx = el + i;
    const shift = (elIdx & 8) ? 7 : 8;
    const val = rsp.getVecS16(vt, elIdx & 7) >>> shift;
    rsp.store8(addr + i, val);
  }
}

function executeSUV(i) {
  const addr = rsp.calcVecAddress(i, 8);
  const vt = vmemVT(i);
  const el = vmemEl(i);

  for (let i = 0; i < 8; i++) {
    const elIdx = el + i;
    const shift = (elIdx & 8) ? 8 : 7;
    const val = rsp.getVecS16(vt, elIdx & 7) >>> shift;
    rsp.store8(addr + i, val);
  }
}

function executeSHV(i) {
  const addr = rsp.calcVecAddress(i, 16);
  const vt = vmemVT(i);
  const el = vmemEl(i);

  const offset = addr & 7;
  const base = addr - offset;
  for (let i = 0; i < 8; i++) {
    const elIdx = el + (i * 2);
    const memIdx = (offset + (i * 2)) & 15;
    const val = rsp.getVecU16UnalignedWrap(vt, elIdx) >>> 7;
    rsp.store8(base + memIdx, val);
  }
}

// Element selectors for SFV.
// Given a starting value the following 3 elements increment, wrapping in the vector half,
// i.e. elementN = (first&4) | ((first + i) & 3).
// TODO: figure out if there's any logic to how the initial element is chosen.
// It's interesting that all elements except 2 appear appear as initial elements.
const sfvElements = new Map([
  [0, [0, 1, 2, 3]],
  [1, [6, 7, 4, 5]],
  [4, [1, 2, 3, 0]],
  [5, [7, 4, 5, 6]],
  [8, [4, 5, 6, 7]],
  [11, [3, 0, 1, 2]],
  [12, [5, 6, 7, 4]],
  [15, [0, 1, 2, 3]],
]);

function executeSFV(i) {
  const addr = rsp.calcVecAddress(i, 16);
  const vt = vmemVT(i);
  const el = vmemEl(i);

  const offset = addr & 7;
  const base = addr - offset;

  const elems = sfvElements.get(el);
  if (elems) {
    for (let i = 0; i < 4; i++) {
      const memIdx = (offset + (i * 4)) & 15;
      rsp.store8(base + memIdx, rsp.getVecU16(vt, elems[i]) >>> 7);
    }
  } else {
    for (let i = 0; i < 4; i++) {
      const memIdx = (offset + (i * 4)) & 15;
      rsp.store8(base + memIdx, 0);
    }
  }
}

function executeSWV(i) {
  const addr = rsp.calcVecAddress(i, 16);
  const vt = vmemVT(i);
  const el = vmemEl(i);

  const offset = addr & 0x7;
  const base = addr - offset;

  for (let i = 0; i < 16; i++) {
    const elIdx = (el + i) & 15;
    const memIdx = (offset + i) & 15;
    rsp.store8(base + memIdx, rsp.getVecS8(vt, elIdx));
  }
}

function executeSTV(i) {
  const addr = rsp.calcVecAddress(i, 16);
  const vt = vmemVT(i);
  const el = vmemEl(i);

  // Output seems to be 8 byte aligned and rotate through 16-bytes.
  const memBase = addr & 0xff8;
  const memOffset = addr & 0xf;
  // Element index is offset by 0 or 8 depending on dest alignment.
  const elOffset = addr & 0x8;
  // Output is stored in 8 consecutive registers.
  const regBase = vt & ~7;
  const regOffset = (el - (addr & 0x8)) >> 1;

  for (let i = 0; i < 16; i++) {
    const memIdx = memBase + ((memOffset + i) & 0xf);
    const regIdx = regBase + ((regOffset + (i >> 1)) & 0x7);
    const elIdx = (elOffset + i) & 0xf;
    rsp.store8(memIdx, rsp.getVecS8(regIdx, elIdx));
  }
}
