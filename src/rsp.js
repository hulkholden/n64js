import * as disassemble_rsp from "./disassemble_rsp.js";
import { toString16, toString32, toHex } from "./format.js";
import { rcp16, rsq16 } from "./rsp_recip.js";

window.n64js = window.n64js || {};

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

function branchAddress(a, i) { return (a + 4) + (imms(i) * 4); }
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
const DPC_START_REG = 8;
const DPC_END_REG = 9;
const DPC_CURRENT_REG = 10;
const DPC_STATUS_REG = 11;
const DPC_CLOCK_REG = 12;
const DPC_BUFBUSY_REG = 13;
const DPC_PIPEBUSY_REG = 14;
const DPC_TMEM_REG = 15;

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
const SP_STATUS_SIG0 = 0x0080;
const SP_STATUS_SIG1 = 0x0100;
const SP_STATUS_SIG2 = 0x0200;
const SP_STATUS_SIG3 = 0x0400;
const SP_STATUS_SIG4 = 0x0800;
const SP_STATUS_SIG5 = 0x1000;
const SP_STATUS_SIG6 = 0x2000;
const SP_STATUS_SIG7 = 0x4000;

const SP_STATUS_YIELD = SP_STATUS_SIG0;
const SP_STATUS_YIELDED = SP_STATUS_SIG1;
const SP_STATUS_TASKDONE = SP_STATUS_SIG2;

class RSP {
  constructor() {
    const hw = n64js.hardware();
    this.hardware = hw;
    this.dmem = new DataView(hw.sp_mem.arrayBuffer, 0x0000, 0x1000);
    this.imem = new DataView(hw.sp_mem.arrayBuffer, 0x1000, 0x1000);

    this.halted = true;

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

  setAccS48(el, v) { this.vAcc[el] = accum48SignExtend(v); }
  getAccS48(el) { return accum48SignExtend(this.vAcc[el]); }    // TODO: ensure this is correctly signed.
  incAccS48(el, v) { this.setAccS48(el, this.getAccS48(el) + v); }    // TODO: ensure this is correctly signed.

  getAccClampedS16(el, shift, neg, pos) { return saturateSigned(this.vAcc[el], shift, neg, pos); }
  getAccClampedU16(el, shift, neg, pos) { return saturateUnsigned(this.vAcc[el], shift, neg, pos); }

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
  // TODO: Remove this once finished implementing.
  assertElIdx(e) {
    if (e < 0 || e > 15) {
      throw `e out of range: ${e}`
    }
  }
  assertElIdxRange(start, count) {
    const end = start + count;
    if (start < 0 || end > 16) {
      throw `e out of range: ${start}..${end}`
    }
  }

  // TODO: need to make it clearer these are 2-byte aligned and e is in the range 0..8.
  getVecS16(r, e) { this.assertElIdxRange(e * 2, 2); return this.vpr.getInt16((16 * r) + (e * 2), false); }
  getVecU16(r, e) { this.assertElIdxRange(e * 2, 2); return this.vpr.getUint16((16 * r) + (e * 2), false); }
  getVecS8(r, e) { this.assertElIdx(e); return this.vpr.getInt8((16 * r) + e, false); }
  getVecU8(r, e) { this.assertElIdx(e); return this.vpr.getUint8((16 * r) + e, false); }

  setVecZero(r) {
    this.vprU64[(r * 2) + 0] = 0n;
    this.vprU64[(r * 2) + 1] = 0n;
  }

  setVecFromTemp(r) {
    this.vprU64[(r * 2) + 0] = this.vecTempU64[0];
    this.vprU64[(r * 2) + 1] = this.vecTempU64[1];
  }

  setVecS16(r, e, v) { this.assertElIdxRange(e * 2, 2); this.vpr.setInt16((16 * r) + (e * 2), v, false); }
  setVecS8(r, e, v) { this.assertElIdx(e); this.vpr.setInt8((16 * r) + e, v, false); }

  // Gets an unaligned 16 bit vector register with wraparound (reading from element 15 uses element 0 for low bits).
  getVecU16UnalignedWrap(r, e) {
    const hi = rsp.getVecU8(r, e & 15);
    const lo = rsp.getVecU8(r, (e + 1) & 15);
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

  loadU8(offset) { return this.dmem.getUint8(offset & 0xfff, false); }
  loadU16(offset) { return (offset <= 0xffe) ? this.dmem.getUint16(offset, false) : this.loadU16Wrapped(offset); }
  loadU32(offset) { return (offset <= 0xffc) ? this.dmem.getUint32(offset, false) : this.loadU32Wrapped(offset); }

  loadS8(offset) { return this.dmem.getInt8(offset & 0xfff, false); }
  loadS16(offset) { return (offset <= 0xffe) ? this.dmem.getInt16(offset, false) : this.loadS16Wrapped(offset); }
  loadS32(offset) { return (offset <= 0xffc) ? this.dmem.getInt32(offset, false) : this.loadS32Wrapped(offset); }

  store8(offset, value) { return this.dmem.setUint8(offset & 0xfff, value, false); }
  store16(offset, value) { return (offset <= 0xffe) ? this.dmem.setUint16(offset, value, false) : this.store16Wrapped(offset, value); }
  store32(offset, value) { return (offset <= 0xffc) ? this.dmem.setUint32(offset, value, false) : this.store32Wrapped(offset, value); }
  store32masked(offset, value, mask) {
    const orig = this.loadU32(offset, false);
    const result = (orig & ~mask) | (value & mask);
    this.store32(offset, result);
  }

  loadU16Wrapped(offset) {
    return (
      (this.dmem.getUint8((offset + 0) & 0xfff) << 8) |
      (this.dmem.getUint8((offset + 1) & 0xfff) << 0)) >>> 0;
  }

  loadS16Wrapped(offset) {
    return (this.loadU16Wrapped(offset) << 16) >> 16;
  }

  loadU32Wrapped(offset) {
    return (
      (this.dmem.getUint8((offset + 0) & 0xfff) << 24) |
      (this.dmem.getUint8((offset + 1) & 0xfff) << 16) |
      (this.dmem.getUint8((offset + 2) & 0xfff) << 8) |
      (this.dmem.getUint8((offset + 3) & 0xfff) << 0)) >>> 0;
  }

  loadS32Wrapped(offset) {
    return this.loadU32Wrapped(offset) >> 0;
  }

  store16Wrapped(offset, value) {
    this.dmem.setUint8((offset + 0) & 0xfff, value >>> 8);
    this.dmem.setUint8((offset + 1) & 0xfff, value >>> 0);
  }

  store32Wrapped(offset, value) {
    this.dmem.setUint8((offset + 0) & 0xfff, value >>> 24);
    this.dmem.setUint8((offset + 1) & 0xfff, value >>> 16);
    this.dmem.setUint8((offset + 2) & 0xfff, value >>> 8);
    this.dmem.setUint8((offset + 3) & 0xfff, value >>> 0);
  }

  calcAddress(instr) {
    return (this.getRegS32(base(instr)) + imms(instr)) & 0xfff;
  }

  calcVecAddress(instr, scale) {
    return (this.getRegS32(vmemBase(instr)) + (vmemOffset(instr) * scale)) & 0xfff;
  }

  conditionalBranch(cond, offset) {
    const effectiveOffset = cond ? (offset * 4) : 4;
    this.branchTarget = (this.pc + 4 + effectiveOffset) & 0xffc;
  }

  jump(pc) {
    this.branchTarget = (pc >>> 0) & 0xffc;
  }

  startExecution() {
    this.pc = this.hardware.sp_ibist_mem.getS32(0);
    this.halted = false;
    this.runImpl();
    this.hardware.sp_ibist_mem.set32(0, this.pc);
  }

  breakExecution() {
    this.halted = true;
  }

  runImpl() {
    let count = 0;
    while (!this.halted) {
      const pc = this.pc;
      this.nextPC = this.delayPC || ((this.pc + 4) & 0xffc);

      const instr = this.imem.getUint32(this.pc, false);

      this.branchTarget = 0;
      this.executeOp(instr);
      this.pc = this.nextPC;
      this.delayPC = this.branchTarget;

      // TODO: remove this when we run in parallel to the CPU.
      if (count > 1_000_000) {
        console.log(`took over ${count} ops - halting`)
        this.halt();
      }
      count++;
    }
  }

  halt() {
    const status = this.hardware.sp_reg.setBits32(SP_STATUS_REG, SP_STATUS_BROKE | SP_STATUS_HALT);
    if (status & SP_STATUS_INTR_BREAK) {
      this.hardware.miRegDevice.interruptSP();
    }
    this.breakExecution();
  }

  disassembleAll() {
    const disassembly = disassemble_rsp.disassembleRange(0x0000, 0x1000);
    for (let d of disassembly) {
      console.log(d.disassembly)
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
    let value = 0;
    switch (controlReg) {
      case controlRegSPMemAddr:
        break;
      case controlRegSPRamAddr:
        break;
      case controlRegSPReadLen:
        break;
      case controlRegSPWriteLen:
        break;
      case controlRegSPStatus:
        value = this.hardware.sp_reg.getU32(SP_STATUS_REG);
        break;
      case controlRegSPDmaFull:
        break;
      case controlRegSPDmaBusy:
        break;
      case controlRegSPSemaphore:
        break;
      case DPC_START_REG:
        break;
      case DPC_END_REG:
        break;
      case DPC_CURRENT_REG:
        break;
      case DPC_STATUS_REG:
        break;
      case DPC_CLOCK_REG:
        break;
      case DPC_BUFBUSY_REG:
        break;
      case DPC_PIPEBUSY_REG:
        break;
      case DPC_TMEM_REG:
        break;
      default:
        console.log(`Unhandled RSP MFC0 register: ${controlReg}`)
        break;
    }
    console.log(`MFC0: ${controlReg} returns ${toString32(value)}`)
    return 0;
  }

  moveToControl(controlReg, value) {
    console.log(`MTC0: ${controlReg} ${value}`)
    switch (controlReg) {
      case controlRegSPMemAddr:
        break;
      case controlRegSPRamAddr:
        break;
      case controlRegSPReadLen:
        break;
      case controlRegSPWriteLen:
        break;
      case controlRegSPStatus:
        this.hardware.spRegDevice.writeReg(controlReg * 4, value);
        break;
      case controlRegSPDmaFull:
        break;
      case controlRegSPDmaBusy:
        break;
      case controlRegSPSemaphore:
        break;
      case DPC_START_REG:
        break;
      case DPC_END_REG:
        break;
      case DPC_CURRENT_REG:
        break;
      case DPC_STATUS_REG:
        break;
      case DPC_CLOCK_REG:
        break;
      case DPC_BUFBUSY_REG:
        break;
      case DPC_PIPEBUSY_REG:
        break;
      case DPC_TMEM_REG:
        break;
      default:
        console.log(`Unhandled RSP MTC0 register: ${controlReg}`)
        break;
    }
  }
}


const rsp = new RSP();
n64js.rsp = rsp;

const specialTable = (() => {
  let tbl = [];
  for (let i = 0; i < 64; i++) {
    tbl[i] = executedUnknown;
  }

  tbl[0] = i => executeSLL(i);
  tbl[2] = i => executeSRL(i);
  tbl[3] = i => executeSRA(i);
  tbl[4] = i => executeSLLV(i);
  tbl[6] = i => executeSRLV(i);
  tbl[7] = i => executeSRAV(i);
  tbl[8] = i => executeJR(i);
  tbl[9] = i => executeJALR(i);
  tbl[13] = i => executeBREAK(i);
  tbl[32] = i => executeADD(i);
  tbl[33] = i => executeADDU(i);
  tbl[34] = i => executeSUB(i);
  tbl[35] = i => executeSUBU(i);
  tbl[36] = i => executeAND(i);
  tbl[37] = i => executeOR(i);
  tbl[38] = i => executeXOR(i);
  tbl[39] = i => executeNOR(i);
  tbl[42] = i => executeSLT(i);
  tbl[43] = i => executeSLTU(i);
  return tbl;
})();

const regImmTable = (() => {
  let tbl = [];
  for (let i = 0; i < 32; i++) {
    tbl.push(executedUnknown);
  }

  tbl[0] = i => executeBLTZ(i);
  tbl[1] = i => executeBGEZ(i);
  tbl[16] = i => executeBLTZAL(i);
  tbl[17] = i => executeBGEZAL(i);
  return tbl;
})();

const cop0Table = (() => {
  let tbl = [];
  for (let i = 0; i < 32; i++) {
    tbl.push(executedUnknown);
  }
  tbl[0] = i => executeMFC0(i);
  tbl[4] = i => executeMTC0(i);
  return tbl;
})();

const cop2Table = (() => {
  let tbl = [];
  for (let i = 0; i < 32; i++) {
    tbl.push(executedUnknown);
  }
  tbl[0] = i => executeMFC2(i);
  tbl[2] = i => executeCFC2(i);
  tbl[4] = i => executeMTC2(i);
  tbl[6] = i => executeCTC2(i);

  for (let i = 16; i < 32; i++) {
    tbl[i] = executeVector;
  }
  return tbl;
})();

const vectorTable = (() => {
  let tbl = [];
  for (let i = 0; i < 64; i++) {
    tbl.push(executedUnknown);
  }

  // TODO: flesh these out.
  tbl[0] = i => executeVMULF(i);
  tbl[1] = i => executeVMULU(i);
  tbl[2] = i => executeVRNDP(i);
  tbl[3] = i => executeVMULQ(i);
  tbl[4] = i => executeVMUDL(i);
  tbl[5] = i => executeVMUDM(i);
  tbl[6] = i => executeVMUDN(i);
  tbl[7] = i => executeVMUDH(i);
  tbl[8] = i => executeVMACF(i);
  tbl[9] = i => executeVMACU(i);
  tbl[10] = i => executeVRNDN(i);
  tbl[11] = i => executeVMACQ(i);
  tbl[12] = i => executeVMADL(i);
  tbl[13] = i => executeVMADM(i);
  tbl[14] = i => executeVMADN(i);
  tbl[15] = i => executeVMADH(i);
  tbl[16] = i => executeVADD(i);
  tbl[17] = i => executeVSUB(i);
  tbl[18] = i => executeVSUT(i);
  tbl[19] = i => executeVABS(i);
  tbl[20] = i => executeVADDC(i);
  tbl[21] = i => executeVSUBC(i);
  tbl[22] = i => executeVADDB(i);
  tbl[23] = i => executeVSUBB(i);
  tbl[24] = i => executeVACCB(i);
  tbl[25] = i => executeVSUCB(i);
  tbl[26] = i => executeVSAD(i);
  tbl[27] = i => executeVSAC(i);
  tbl[28] = i => executeVSUM(i);
  tbl[29] = i => executeVSAR(i);
  tbl[30] = i => executeV30(i);
  tbl[31] = i => executeV31(i);
  tbl[32] = i => executeVLT(i);
  tbl[33] = i => executeVEQ(i);
  tbl[34] = i => executeVNE(i);
  tbl[35] = i => executeVGE(i);
  tbl[36] = i => executeVCL(i);
  tbl[37] = i => executeVCH(i);
  tbl[38] = i => executeVCR(i);
  tbl[39] = i => executeVMRG(i);
  tbl[40] = i => executeVAND(i);
  tbl[41] = i => executeVNAND(i);
  tbl[42] = i => executeVOR(i);
  tbl[43] = i => executeVNOR(i);
  tbl[44] = i => executeVXOR(i);
  tbl[45] = i => executeVNXOR(i);
  tbl[46] = i => executeV46(i);
  tbl[47] = i => executeV47(i);
  tbl[48] = i => executeVRCP(i);
  tbl[49] = i => executeVRCPL(i);
  tbl[50] = i => executeVRCPH(i);
  tbl[51] = i => executeVMOV(i);
  tbl[52] = i => executeVRSQ(i);
  tbl[53] = i => executeVRSQL(i);
  tbl[54] = i => executeVRSQH(i);
  tbl[55] = i => executeVNOP(i);
  tbl[56] = i => executeVEXTT(i);
  tbl[57] = i => executeVEXTQ(i);
  tbl[58] = i => executeVEXTN(i);
  tbl[59] = i => executeV59(i);
  tbl[60] = i => executeVINST(i);
  tbl[61] = i => executeVINSQ(i);
  tbl[62] = i => executeVINSN(i);
  tbl[63] = i => executeVNULL(i);
  return tbl;
})();

function executeVector(i) {
  return vectorTable[funct(i)](i);
}

const lc2Table = (() => {
  let tbl = [];
  for (let i = 0; i < 32; i++) {
    tbl.push(executedUnknown);
  }

  tbl[0] = i => executeLBV(i);
  tbl[1] = i => executeLSV(i);
  tbl[2] = i => executeLLV(i);
  tbl[3] = i => executeLDV(i);
  tbl[4] = i => executeLQV(i);
  tbl[5] = i => executeLRV(i);
  tbl[6] = i => executeLPV(i);
  tbl[7] = i => executeLUV(i);
  tbl[8] = i => executeLHV(i);
  tbl[9] = i => executeLFV(i);
  tbl[10] = i => executeLWV(i);
  tbl[11] = i => executeLTV(i);

  return tbl;
})();

const sc2Table = (() => {
  let tbl = [];
  for (let i = 0; i < 32; i++) {
    tbl.push(executedUnknown);
  }

  tbl[0] = i => executeSBV(i);
  tbl[1] = i => executeSSV(i);
  tbl[2] = i => executeSLV(i);
  tbl[3] = i => executeSDV(i);
  tbl[4] = i => executeSQV(i);
  tbl[5] = i => executeSRV(i);
  tbl[6] = i => executeSPV(i);
  tbl[7] = i => executeSUV(i);
  tbl[8] = i => executeSHV(i);
  tbl[9] = i => executeSFV(i);
  tbl[10] = i => executeSWV(i);
  tbl[11] = i => executeSTV(i);

  return tbl;
})();

const simpleTable = (() => {
  let tbl = [];
  for (let i = 0; i < 64; i++) {
    tbl.push(executedUnknown);
  }

  tbl[0] = i => specialTable[funct(i)](i);
  tbl[1] = i => regImmTable[rt(i)](i);
  tbl[2] = i => executeJ(i);
  tbl[3] = i => executeJAL(i);
  tbl[4] = i => executeBEQ(i);
  tbl[5] = i => executeBNE(i);
  tbl[6] = i => executeBLEZ(i);
  tbl[7] = i => executeBGTZ(i);
  tbl[8] = i => executeADDI(i);
  tbl[9] = i => executeADDIU(i);
  tbl[10] = i => executeSLTI(i);
  tbl[11] = i => executeSLTIU(i);
  tbl[12] = i => executeANDI(i);
  tbl[13] = i => executeORI(i);
  tbl[14] = i => executeXORI(i);
  tbl[15] = i => executeLUI(i);
  tbl[16] = i => cop0Table[rs(i)](i);
  tbl[18] = i => cop2Table[rs(i)](i);
  tbl[32] = i => executeLB(i);
  tbl[33] = i => executeLH(i);
  tbl[35] = i => executeLW(i);
  tbl[36] = i => executeLBU(i);
  tbl[37] = i => executeLHU(i);
  tbl[39] = i => executeLWU(i);
  tbl[40] = i => executeSB(i);
  tbl[41] = i => executeSH(i);
  tbl[43] = i => executeSW(i);
  tbl[50] = i => lc2Table[rd(i)](i);
  tbl[58] = i => sc2Table[rd(i)](i);
  return tbl;
})();


function executedUnknown(i) {
  rsp.disassembleOp(rsp.pc, i);
  n64js.halt(`unknown op ${toString32(i)}`);
}

function executeUnhandled(name, i) {
  rsp.disassembleOp(rsp.pc, i);
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
function executeBREAK(i) { rsp.halt(); }
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

function accum48SignExtend(x) {
  return BigInt.asIntN(48, x);
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

  let select = rsp.vecSelectU32[cop2E(i)];
  for (let el = 0; el < 8; el++, select >>= 4) {
    const a = rsp.getVecS16(s, el);
    const b = rsp.getVecS16(t, select & 0x7);
    const unclamped = a + b;
    // TODO: provide low/mid/high accessors.
    // TODO: understand why only low is set.
    rsp.vAcc[el] = (rsp.vAcc[el] & 0xffff_ffff_0000n) | (BigInt(unclamped) & 0xffffn);
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
  const s = cop2VS(i);
  const t = cop2VT(i);

  const dv = rsp.vecTemp;
  let select = rsp.vecSelectU32[cop2E(i)];

  for (let el = 0; el < 8; el++, select >>= 4) {
    const a = rsp.getVecS16(s, el);
    const b = rsp.getVecS16(t, select & 0x7);
    rsp.setAccS48(el, (BigInt(a * b) << 1n) + 0x8000n);
    dv.setInt16(el * 2, rsp.getAccClampedS16(el, 16n, 0x8000, 0x7fff));
  }
  rsp.setVecFromTemp(cop2VD(i));
}

// Vector Multiply of Unsigned Fractions.
function executeVMULU(i) {
  const s = cop2VS(i);
  const t = cop2VT(i);

  const dv = rsp.vecTemp;
  let select = rsp.vecSelectU32[cop2E(i)];

  for (let el = 0; el < 8; el++, select >>= 4) {
    const a = rsp.getVecS16(s, el);
    const b = rsp.getVecS16(t, select & 0x7);
    rsp.setAccS48(el, (BigInt(a * b) << 1n) + 0x8000n);
    dv.setInt16(el * 2, rsp.getAccClampedU16(el, 16n, 0x0000, 0xffff));
  }
  rsp.setVecFromTemp(cop2VD(i));
}

// Vector Accumulator DCT Rounding (Negative).
function executeVRNDN(i) {
  const s = cop2VS(i);
  const t = cop2VT(i);

  const dv = rsp.vecTemp;
  let select = rsp.vecSelectU32[cop2E(i)];

  const shift = (s & 1) ? 16 : 0;

  for (let el = 0; el < 8; el++, select >>= 4) {
    const acc = rsp.getAccS48(el);
    const incr = rsp.getVecS16(t, select & 0x7) << shift;
    rsp.setAccS48(el, acc + ((acc < 0) ? BigInt(incr) : 0n));
    dv.setInt16(el * 2, rsp.getAccClampedS16(el, 16n, 0x8000, 0x7fff));
  }
  rsp.setVecFromTemp(cop2VD(i));
}

// Vector Accumulator DCT Rounding (Positive).
function executeVRNDP(i) {
  const s = cop2VS(i);
  const t = cop2VT(i);

  const dv = rsp.vecTemp;
  let select = rsp.vecSelectU32[cop2E(i)];

  const shift = (s & 1) ? 16 : 0;

  for (let el = 0; el < 8; el++, select >>= 4) {
    const acc = rsp.getAccS48(el);
    const incr = rsp.getVecS16(t, select & 0x7) << shift;
    rsp.setAccS48(el, acc + ((acc >= 0) ? BigInt(incr) : 0n));
    dv.setInt16(el * 2, rsp.getAccClampedS16(el, 16n, 0x8000, 0x7fff));
  }
  rsp.setVecFromTemp(cop2VD(i));
}

// Vector Multiply MPEG Quantization.
function executeVMULQ(i) {
  const s = cop2VS(i);
  const t = cop2VT(i);

  const dv = rsp.vecTemp;
  let select = rsp.vecSelectU32[cop2E(i)];

  for (let el = 0; el < 8; el++, select >>= 4) {
    const a = rsp.getVecS16(s, el);
    const b = rsp.getVecS16(t, select & 0x7);
    const product = BigInt(a * b) << 16n;
    rsp.setAccS48(el, product + (product < 0 ? 0x1f0000n : 0n));
    dv.setInt16(el * 2, saturateSigned(rsp.vAcc[el] >> 1n, 16n, 0x8000, 0x7fff) & 0xfff0);
  }
  rsp.setVecFromTemp(cop2VD(i));
}

// Vector Multiply of Low Partial Products.
function executeVMUDL(i) {
  const s = cop2VS(i);
  const t = cop2VT(i);

  const dv = rsp.vecTemp;
  let select = rsp.vecSelectU32[cop2E(i)];

  for (let el = 0; el < 8; el++, select >>= 4) {
    const a = rsp.getVecU16(s, el);
    const b = rsp.getVecU16(t, select & 0x7);
    rsp.setAccS48(el, BigInt(a * b) >> 16n);
    dv.setInt16(el * 2, Number(rsp.vAcc[el] & 0xffffn));
  }
  rsp.setVecFromTemp(cop2VD(i));
}

// Vector Multiply of Mid Partial Products.
function executeVMUDM(i) {
  const s = cop2VS(i);
  const t = cop2VT(i);

  const dv = rsp.vecTemp;
  let select = rsp.vecSelectU32[cop2E(i)];

  for (let el = 0; el < 8; el++, select >>= 4) {
    const a = rsp.getVecS16(s, el);
    const b = rsp.getVecU16(t, select & 0x7);
    rsp.setAccS48(el, BigInt(a * b));
    dv.setInt16(el * 2, Number((rsp.vAcc[el] >> 16n) & 0xffffn));
  }
  rsp.setVecFromTemp(cop2VD(i));
}

// Vector Multiply of Mid Partial Products.
function executeVMUDN(i) {
  const s = cop2VS(i);
  const t = cop2VT(i);

  const dv = rsp.vecTemp;
  let select = rsp.vecSelectU32[cop2E(i)];

  for (let el = 0; el < 8; el++, select >>= 4) {
    const a = rsp.getVecU16(s, el);
    const b = rsp.getVecS16(t, select & 0x7);
    rsp.setAccS48(el, BigInt(a * b));
    dv.setInt16(el * 2, Number(rsp.vAcc[el] & 0xffffn));
  }
  rsp.setVecFromTemp(cop2VD(i));
}

// Vector Multiply of High Partial Products.
function executeVMUDH(i) {
  const s = cop2VS(i);
  const t = cop2VT(i);

  const dv = rsp.vecTemp;
  let select = rsp.vecSelectU32[cop2E(i)];

  for (let el = 0; el < 8; el++, select >>= 4) {
    const a = rsp.getVecS16(s, el);
    const b = rsp.getVecS16(t, select & 0x7);
    rsp.setAccS48(el, BigInt(a * b) << 16n);
    dv.setInt16(el * 2, rsp.getAccClampedS16(el, 16n, 0x8000, 0x7fff));
  }
  rsp.setVecFromTemp(cop2VD(i));
}

// Vector Multiply-Accumulate of Signed Fractions.
function executeVMACF(i) {
  const s = cop2VS(i);
  const t = cop2VT(i);

  const dv = rsp.vecTemp;
  let select = rsp.vecSelectU32[cop2E(i)];

  for (let el = 0; el < 8; el++, select >>= 4) {
    const a = rsp.getVecS16(s, el);
    const b = rsp.getVecS16(t, select & 0x7);
    rsp.incAccS48(el, BigInt(a * b) << 1n);
    dv.setInt16(el * 2, rsp.getAccClampedS16(el, 16n, 0x8000, 0x7fff));
  }
  rsp.setVecFromTemp(cop2VD(i));
}

// Vector Multiply-Accumulate of Unsigned Fractions.
function executeVMACU(i) {
  const s = cop2VS(i);
  const t = cop2VT(i);

  const dv = rsp.vecTemp;
  let select = rsp.vecSelectU32[cop2E(i)];

  for (let el = 0; el < 8; el++, select >>= 4) {
    const a = rsp.getVecS16(s, el);
    const b = rsp.getVecS16(t, select & 0x7);
    rsp.incAccS48(el, BigInt(a * b) << 1n);
    dv.setInt16(el * 2, rsp.getAccClampedU16(el, 16n, 0x0000, 0xffff));
  }
  rsp.setVecFromTemp(cop2VD(i));
}

// Vector Accumulator Oddification.
function executeVMACQ(i) {
  const dv = rsp.vecTemp;

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
    dv.setInt16(el * 2, saturateSigned(rsp.vAcc[el] >> 1n, 16n, 0x8000, 0x7fff) & 0xfff0);
  }
  rsp.setVecFromTemp(cop2VD(i));
}

// Vector Multiply-Accumulate of Low Partial Products.
function executeVMADL(i) {
  const s = cop2VS(i);
  const t = cop2VT(i);

  const dv = rsp.vecTemp;
  let select = rsp.vecSelectU32[cop2E(i)];

  for (let el = 0; el < 8; el++, select >>= 4) {
    const a = rsp.getVecU16(s, el);
    const b = rsp.getVecU16(t, select & 0x7);
    rsp.incAccS48(el, BigInt(a * b) >> 16n);
    dv.setInt16(el * 2, rsp.getAccClampedS16(el, 0n, 0, 0xffff));
  }
  rsp.setVecFromTemp(cop2VD(i));
}

// Vector Multiply-Accumulate of Mid Partial Products.
function executeVMADM(i) {
  const s = cop2VS(i);
  const t = cop2VT(i);

  const dv = rsp.vecTemp;
  let select = rsp.vecSelectU32[cop2E(i)];

  for (let el = 0; el < 8; el++, select >>= 4) {
    const a = rsp.getVecS16(s, el);
    const b = rsp.getVecU16(t, select & 0x7);
    rsp.incAccS48(el, BigInt(a * b));
    dv.setInt16(el * 2, rsp.getAccClampedS16(el, 16n, 0x8000, 0x7fff));
  }
  rsp.setVecFromTemp(cop2VD(i));
}

// Vector Multiply-Accumulate of Mid Partial Products.
function executeVMADN(i) {
  const s = cop2VS(i);
  const t = cop2VT(i);

  const dv = rsp.vecTemp;
  let select = rsp.vecSelectU32[cop2E(i)];

  for (let el = 0; el < 8; el++, select >>= 4) {
    const a = rsp.getVecU16(s, el);
    const b = rsp.getVecS16(t, select & 0x7);
    rsp.incAccS48(el, BigInt(a * b));
    dv.setInt16(el * 2, rsp.getAccClampedS16(el, 0n, 0, 0xffff));
  }
  rsp.setVecFromTemp(cop2VD(i));
}

// Vector Multiply-Accumulate of High Partial Products.
function executeVMADH(i) {
  const s = cop2VS(i);
  const t = cop2VT(i);

  const dv = rsp.vecTemp;
  let select = rsp.vecSelectU32[cop2E(i)];

  for (let el = 0; el < 8; el++, select >>= 4) {
    const a = rsp.getVecS16(s, el);
    const b = rsp.getVecS16(t, select & 0x7);
    rsp.incAccS48(el, BigInt(a * b) << 16n);
    dv.setInt16(el * 2, rsp.getAccClampedS16(el, 16n, 0x8000, 0x7fff));
  }
  rsp.setVecFromTemp(cop2VD(i));
}

// Vector Add of Short Elements
function executeVADD(i) {
  const s = cop2VS(i);
  const t = cop2VT(i);

  const vco = rsp.VCO;
  const dv = rsp.vecTemp;
  let select = rsp.vecSelectU32[cop2E(i)];

  for (let el = 0; el < 8; el++, select >>= 4) {
    const a = rsp.getVecS16(s, el);
    const b = rsp.getVecS16(t, select & 0x7);
    const c = ((vco >> (7 - el)) & 0x1);    // TODO: figure out why this isn't just (vco>>el).
    const unclamped = a + b + c;
    // TODO: provide low/mid/high accessors.
    // TODO: understand why only low is set.
    rsp.vAcc[el] = (rsp.vAcc[el] & 0xffff_ffff_0000n) | (BigInt(unclamped) & 0xffffn);
    dv.setInt16(el * 2, clampSigned(unclamped));
  }
  rsp.setVecFromTemp(cop2VD(i));
  rsp.VCO = 0;
}

// Vector Subtraction of Short Elements
function executeVSUB(i) {
  const s = cop2VS(i);
  const t = cop2VT(i);

  const vco = rsp.VCO;
  const dv = rsp.vecTemp;
  let select = rsp.vecSelectU32[cop2E(i)];

  for (let el = 0; el < 8; el++, select >>= 4) {
    const a = rsp.getVecS16(s, el);
    const b = rsp.getVecS16(t, select & 0x7);
    const c = ((vco >> (7 - el)) & 0x1);    // TODO: figure out why this isn't just (vco>>el).
    const unclamped = a - (b + c);
    // TODO: provide low/mid/high accessors.
    // TODO: understand why only low is set.
    rsp.vAcc[el] = (rsp.vAcc[el] & 0xffff_ffff_0000n) | (BigInt(unclamped) & 0xffffn);
    dv.setInt16(el * 2, clampSigned(unclamped));
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
  const s = cop2VS(i);
  const t = cop2VT(i);

  const dv = rsp.vecTemp;
  let select = rsp.vecSelectU32[cop2E(i)];

  for (let el = 0; el < 8; el++, select >>= 4) {
    const a = rsp.getVecS16(s, el);
    const b = rsp.getVecU16(t, select & 0x7);

    const overflow = (a < 0) && b == 0x8000;
    const result = overflow ? 0x7fff : conditionalNegate(a, b);
    const acc = overflow ? 0x8000 : result;

    // TODO: provide low/mid/high accessors.
    // TODO: understand why only low is set.
    rsp.vAcc[el] = (rsp.vAcc[el] & 0xffff_ffff_0000n) | (BigInt(acc) & 0xffffn);
    dv.setInt16(el * 2, result);
  }
  rsp.setVecFromTemp(cop2VD(i));
}

// Vector Add Short Elements With Carry.
function executeVADDC(i) {
  const s = cop2VS(i);
  const t = cop2VT(i);

  let newVCO = 0;
  const dv = rsp.vecTemp;
  let select = rsp.vecSelectU32[cop2E(i)];

  for (let el = 0; el < 8; el++, select >>= 4) {
    const a = rsp.getVecU16(s, el);
    const b = rsp.getVecU16(t, select & 0x7);
    const unclamped = a + b;
    const clamped = unclamped & 0xffff;
    // TODO: provide low/mid/high accessors.
    // TODO: understand why only low is set.
    rsp.vAcc[el] = (rsp.vAcc[el] & 0xffff_ffff_0000n) | (BigInt(unclamped) & 0xffffn);
    dv.setInt16(el * 2, clamped);

    newVCO |= (unclamped != clamped) ? (1 << el) : 0;
  }
  rsp.setVecFromTemp(cop2VD(i));
  rsp.VCO = newVCO;
}

// Vector Subtraction of Short Elements With Carry.
function executeVSUBC(i) {
  const s = cop2VS(i);
  const t = cop2VT(i);

  let newVCO = 0;
  const dv = rsp.vecTemp;
  let select = rsp.vecSelectU32[cop2E(i)];

  for (let el = 0; el < 8; el++, select >>= 4) {
    const a = rsp.getVecU16(s, el);
    const b = rsp.getVecU16(t, select & 0x7);
    const unclamped = a - b;
    const clamped = unclamped & 0xffff;
    // TODO: provide low/mid/high accessors.
    // TODO: understand why only low is set.
    rsp.vAcc[el] = (rsp.vAcc[el] & 0xffff_ffff_0000n) | (BigInt(unclamped) & 0xffffn);
    dv.setInt16(el * 2, clamped);

    newVCO |= (unclamped != 0) ? (1 << (el + 8)) : 0;
    newVCO |= (unclamped < 0) ? (1 << (el + 0)) : 0;
  }
  rsp.setVecFromTemp(cop2VD(i));
  rsp.VCO = newVCO;
}

// Constants for accessing different parts of the accumulator via VSAR.
const vsarHigh = 8;
const vsarMid = 9;
const vsarLow = 10;

// Vector Accumulator Read (and Write).
function executeVSAR(i) {
  // Default to a shift of 64 to produce zeros.
  let shift = 64n;
  switch (cop2E(i)) {
    case vsarHigh: shift = 32n; break;
    case vsarMid: shift = 16n; break;
    case vsarLow: shift = 0n; break;
  }

  const d = cop2VD(i);
  for (let el = 0; el < 8; el++) {
    rsp.setVecS16(d, el, Number(rsp.vAcc[el] >> shift));
    // TODO: Set vAcc from VS register value.
  }
}

// Vector Select Less Than.
function executeVLT(i) {
  const s = cop2VS(i);
  const t = cop2VT(i);

  const vco = rsp.VCO;
  let vccLo = 0;
  let vccHi = 0;
  const dv = rsp.vecTemp;
  let select = rsp.vecSelectU32[cop2E(i)];

  for (let el = 0; el < 8; el++, select >>= 4) {
    const a = rsp.getVecS16(s, el);
    const b = rsp.getVecS16(t, select & 0x7);

    const elBit = 1 << el;
    const vcoLo = (vco & elBit) != 0;
    const vcoHi = (vco & (elBit << 8)) != 0;
    const onEqual = vcoLo && vcoHi;

    const cond = a < b || ((a == b) && onEqual);
    const result = cond ? a : b;
    vccLo |= cond ? elBit : 0;

    // TODO: provide low/mid/high accessors.
    // TODO: understand why only low is set.
    rsp.vAcc[el] = (rsp.vAcc[el] & 0xffff_ffff_0000n) | (BigInt(result) & 0xffffn);
    dv.setInt16(el * 2, result);
  }
  rsp.setVecFromTemp(cop2VD(i));
  rsp.setVCCHiLo(vccHi, vccLo);
  rsp.VCO = 0;
}

// Vector Select Equal.
function executeVEQ(i) {
  const s = cop2VS(i);
  const t = cop2VT(i);

  const vco = rsp.VCO;
  let vccLo = 0;
  let vccHi = 0;
  const dv = rsp.vecTemp;
  let select = rsp.vecSelectU32[cop2E(i)];

  for (let el = 0; el < 8; el++, select >>= 4) {
    const a = rsp.getVecS16(s, el);
    const b = rsp.getVecS16(t, select & 0x7);

    const elBit = 1 << el;
    const vcoHi = (vco & (elBit << 8)) != 0;

    const cond = (a == b) && !vcoHi;
    const result = b;
    vccLo |= cond ? elBit : 0;

    // TODO: provide low/mid/high accessors.
    // TODO: understand why only low is set.
    rsp.vAcc[el] = (rsp.vAcc[el] & 0xffff_ffff_0000n) | (BigInt(result) & 0xffffn);
    dv.setInt16(el * 2, result);
  }
  rsp.setVecFromTemp(cop2VD(i));
  rsp.setVCCHiLo(vccHi, vccLo);
  rsp.VCO = 0;
}

// Vector Select Not Equal.
function executeVNE(i) {
  const s = cop2VS(i);
  const t = cop2VT(i);

  const vco = rsp.VCO;
  let vccLo = 0;
  let vccHi = 0;
  const dv = rsp.vecTemp;
  let select = rsp.vecSelectU32[cop2E(i)];

  for (let el = 0; el < 8; el++, select >>= 4) {
    const a = rsp.getVecS16(s, el);
    const b = rsp.getVecS16(t, select & 0x7);

    const elBit = 1 << el;
    const vcoHi = (vco & (elBit << 8)) != 0;

    const cond = (a != b) || vcoHi;
    const result = a;
    vccLo |= cond ? elBit : 0;

    // TODO: provide low/mid/high accessors.
    // TODO: understand why only low is set.
    rsp.vAcc[el] = (rsp.vAcc[el] & 0xffff_ffff_0000n) | (BigInt(result) & 0xffffn);
    dv.setInt16(el * 2, result);
  }
  rsp.setVecFromTemp(cop2VD(i));
  rsp.VCC = (vccHi << 8) | vccLo;
  rsp.setVCCHiLo(vccHi, vccLo);
  rsp.VCO = 0;
}

// Vector Select Greater Than or Equal.
function executeVGE(i) {
  const s = cop2VS(i);
  const t = cop2VT(i);

  const vco = rsp.VCO;
  let vccLo = 0;
  let vccHi = 0;
  const dv = rsp.vecTemp;
  let select = rsp.vecSelectU32[cop2E(i)];

  for (let el = 0; el < 8; el++, select >>= 4) {
    const a = rsp.getVecS16(s, el);
    const b = rsp.getVecS16(t, select & 0x7);

    const elBit = 1 << el;
    const vcoLo = (vco & elBit) != 0;
    const vcoHi = (vco & (elBit << 8)) != 0;
    const onEqual = vcoLo && vcoHi;

    const cond = a > b || ((a == b) && !onEqual);
    const result = cond ? a : b;
    vccLo |= cond ? elBit : 0;

    // TODO: provide low/mid/high accessors.
    // TODO: understand why only low is set.
    rsp.vAcc[el] = (rsp.vAcc[el] & 0xffff_ffff_0000n) | (BigInt(result) & 0xffffn);
    dv.setInt16(el * 2, result);
  }
  rsp.setVecFromTemp(cop2VD(i));
  rsp.setVCCHiLo(vccHi, vccLo);
  rsp.VCO = 0;
}

// Vector Select Clip Test Low.
function executeVCL(i) {
  const vs = cop2VS(i);
  const vt = cop2VT(i);

  const dv = rsp.vecTemp;
  let select = rsp.vecSelectU32[cop2E(i)];

  const vccHi = rsp.VCCHi;
  const vccLo = rsp.VCCLo;
  const vce = rsp.VCE;
  const vcoHi = rsp.VCOHi;
  const vcoLo = rsp.VCOLo;

  let vccOutHi = 0;
  let vccOutLo = 0;

  for (let el = 0; el < 8; el++, select >>= 4) {
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
    dv.setInt16(el * 2, result);
    rsp.vAcc[el] = (rsp.vAcc[el] & 0xffff_ffff_0000n) | (BigInt(result) & 0xffffn);
    vccOutHi |= ge << el;
    vccOutLo |= le << el
  }

  rsp.setVecFromTemp(cop2VD(i));
  rsp.setVCCHiLo(vccOutHi, vccOutLo);
  rsp.VCO = 0;
  rsp.VCE = 0;
}

// Vector Select Clip Test High.
function executeVCH(i) {
  const vs = cop2VS(i);
  const vt = cop2VT(i);

  const dv = rsp.vecTemp;
  let select = rsp.vecSelectU32[cop2E(i)];

  let vccHi = 0;
  let vccLo = 0;
  let vcoHi = 0;
  let vcoLo = 0;
  let vce = 0;

  for (let el = 0; el < 8; el++, select >>= 4) {
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
    dv.setInt16(el * 2, result);
    rsp.vAcc[el] = (rsp.vAcc[el] & 0xffff_ffff_0000n) | (BigInt(result) & 0xffffn);

    vccHi |= ge << el;
    vccLo |= le << el
    vcoHi |= ne << el;
    vcoLo |= sign << el;
    vce |= ce << el;
  }

  rsp.setVecFromTemp(cop2VD(i));
  rsp.setVCCHiLo(vccHi, vccLo);
  rsp.setVCOHiLo(vcoHi, vcoLo);
  rsp.VCE = vce;
}

// Vector Select Crimp Test Low.
function executeVCR(i) {
  const vs = cop2VS(i);
  const vt = cop2VT(i);

  const dv = rsp.vecTemp;
  let select = rsp.vecSelectU32[cop2E(i)];
  let vccHi = 0;
  let vccLo = 0;

  for (let el = 0; el < 8; el++, select >>= 4) {
    const s = rsp.getVecS16(vs, el);
    const t = rsp.getVecS16(vt, select & 0x7);

    let le, ge, newAccum;
    if ((s ^ t) < 0) {
      ge = t < 0;
      le = (s + t + 1) <= 0;
      newAccum = le ? ~t : s;
    } else {
      le = t < 0;
      ge = (s - t) >= 0;
      newAccum = ge ? t : s;
    }
    vccLo |= le << el;
    vccHi |= ge << el;

    dv.setInt16(el * 2, newAccum);
    rsp.vAcc[el] = (rsp.vAcc[el] & 0xffff_ffff_0000n) | (BigInt(newAccum) & 0xffffn);
  }
  rsp.setVecFromTemp(cop2VD(i));
  rsp.setVCCHiLo(vccHi, vccLo);
  rsp.VCO = 0;
  rsp.VCE = 0;
}

// Vector Select Merge.
function executeVMRG(i) {
  const s = cop2VS(i);
  const t = cop2VT(i);

  const dv = rsp.vecTemp;
  let select = rsp.vecSelectU32[cop2E(i)];
  let vcc = rsp.VCC;

  for (let el = 0; el < 8; el++, vcc >>= 1, select >>= 4) {
    const a = rsp.getVecU16(s, el);
    const b = rsp.getVecU16(t, select & 0x7);
    const result = (vcc & 1) ? a : b;

    dv.setInt16(el * 2, result);
    rsp.vAcc[el] = (rsp.vAcc[el] & 0xffff_ffff_0000n) | (BigInt(result) & 0xffffn);
  }
  rsp.setVecFromTemp(cop2VD(i));
  rsp.VCO = 0;
}

// Vector AND of Short Elements.
function executeVAND(i) {
  const s = cop2VS(i);
  const t = cop2VT(i);

  const dv = rsp.vecTemp;
  let select = rsp.vecSelectU32[cop2E(i)];

  for (let el = 0; el < 8; el++, select >>= 4) {
    const a = rsp.getVecS16(s, el);
    const b = rsp.getVecU16(t, select & 0x7);
    const result = a & b;

    dv.setInt16(el * 2, result);
    rsp.vAcc[el] = (rsp.vAcc[el] & 0xffff_ffff_0000n) | (BigInt(result) & 0xffffn);
  }
  rsp.setVecFromTemp(cop2VD(i));
}

// Vector NAND of Short Elements.
function executeVNAND(i) {
  const s = cop2VS(i);
  const t = cop2VT(i);

  const dv = rsp.vecTemp;
  let select = rsp.vecSelectU32[cop2E(i)];

  for (let el = 0; el < 8; el++, select >>= 4) {
    const a = rsp.getVecS16(s, el);
    const b = rsp.getVecU16(t, select & 0x7);
    const result = ~(a & b);

    dv.setInt16(el * 2, result);
    rsp.vAcc[el] = (rsp.vAcc[el] & 0xffff_ffff_0000n) | (BigInt(result) & 0xffffn);
  }
  rsp.setVecFromTemp(cop2VD(i));
}

// Vector OR of Short Elements.
function executeVOR(i) {
  const s = cop2VS(i);
  const t = cop2VT(i);

  const dv = rsp.vecTemp;
  let select = rsp.vecSelectU32[cop2E(i)];

  for (let el = 0; el < 8; el++, select >>= 4) {
    const a = rsp.getVecS16(s, el);
    const b = rsp.getVecU16(t, select & 0x7);
    const result = a | b;

    dv.setInt16(el * 2, result);
    rsp.vAcc[el] = (rsp.vAcc[el] & 0xffff_ffff_0000n) | (BigInt(result) & 0xffffn);
  }
  rsp.setVecFromTemp(cop2VD(i));
}

// Vector NOR of Short Elements.
function executeVNOR(i) {
  const s = cop2VS(i);
  const t = cop2VT(i);

  const dv = rsp.vecTemp;
  let select = rsp.vecSelectU32[cop2E(i)];

  for (let el = 0; el < 8; el++, select >>= 4) {
    const a = rsp.getVecS16(s, el);
    const b = rsp.getVecU16(t, select & 0x7);
    const result = ~(a | b);

    dv.setInt16(el * 2, result);
    rsp.vAcc[el] = (rsp.vAcc[el] & 0xffff_ffff_0000n) | (BigInt(result) & 0xffffn);
  }
  rsp.setVecFromTemp(cop2VD(i));
}

// Vector XOR of Short Elements.
function executeVXOR(i) {
  const s = cop2VS(i);
  const t = cop2VT(i);

  const dv = rsp.vecTemp;
  let select = rsp.vecSelectU32[cop2E(i)];

  for (let el = 0; el < 8; el++, select >>= 4) {
    const a = rsp.getVecS16(s, el);
    const b = rsp.getVecU16(t, select & 0x7);
    const result = a ^ b;

    dv.setInt16(el * 2, result);
    rsp.vAcc[el] = (rsp.vAcc[el] & 0xffff_ffff_0000n) | (BigInt(result) & 0xffffn);
  }
  rsp.setVecFromTemp(cop2VD(i));
}

// Vector NXOR of Short Elements.
function executeVNXOR(i) {
  const s = cop2VS(i);
  const t = cop2VT(i);

  const dv = rsp.vecTemp;
  let select = rsp.vecSelectU32[cop2E(i)];

  for (let el = 0; el < 8; el++, select >>= 4) {
    const a = rsp.getVecS16(s, el);
    const b = rsp.getVecU16(t, select & 0x7);
    const result = ~(a ^ b);

    dv.setInt16(el * 2, result);
    rsp.vAcc[el] = (rsp.vAcc[el] & 0xffff_ffff_0000n) | (BigInt(result) & 0xffffn);
  }
  rsp.setVecFromTemp(cop2VD(i));
}

function vrcp(i, dpInstruction) {
  const vt = cop2VT(i);
  const vte = cop2E(i);

  // Handle double or single precision.
  const val16 = rsp.getVecS16(vt, vte & 7);
  const input = (dpInstruction && rsp.divDP) ? ((rsp.divIn << 16) | (val16 & 0xffff)) : val16;

  // Accumulator is set to the entire input vector.
  // TODO: add helper + dedupe with VRCPH.
  let select = rsp.vecSelectU32[vte];
  for (let el = 0; el < 8; el++, select >>= 4) {
    const val = rsp.getVecS16(vt, select & 0x7);
    rsp.vAcc[el] = (rsp.vAcc[el] & 0xffffffff0000n) | (BigInt(val) & 0xffffn);
  }

  // Output is set to the result.
  const result = rcp16(input);
  rsp.divDP = false;
  rsp.divOut = result >> 16;
  rsp.setVecS16(cop2VD(i), cop2DE(i) & 7, result & 0xffff);
}

// Vector Element Scalar Reciprocal (Single Precision).
function executeVRCP(i) {
  vrcp(i, false);
}

// Vector Element Scalar Reciprocal (Double Precision Low).
function executeVRCPL(i) {
  vrcp(i, true);
}

// Vector Element Scalar Reciprocal (Double Precision High).
function executeVRCPH(i) {
  const vt = cop2VT(i);
  const vte = cop2E(i);

  // Accumulator is set to the entire input vector.
  // TODO: add helper + dedupe with VRCP.
  let select = rsp.vecSelectU32[vte];
  for (let el = 0; el < 8; el++, select >>= 4) {
    const val = rsp.getVecS16(vt, select & 0x7);
    rsp.vAcc[el] = (rsp.vAcc[el] & 0xffff_ffff_0000n) | (BigInt(val) & 0xffffn);
  }

  rsp.divDP = true;
  rsp.divIn = rsp.getVecS16(vt, vte & 7);
  rsp.setVecS16(cop2VD(i), cop2DE(i) & 7, rsp.divOut);
}

// Vector Element Scalar Move.
function executeVMOV(i) {
  const vt = cop2VT(i);
  const vd = cop2VD(i);
  const vde = cop2DE(i) & 7;

  // The low accumulator bits are set to VT, using the broadcast pattern.
  const select = rsp.vecSelectU32[cop2E(i)];
  for (let el = 0, curSelect = select; el < 8; el++, curSelect >>= 4) {
    const accVal = rsp.getVecS16(vt, curSelect & 0x7);
    rsp.vAcc[el] = (rsp.vAcc[el] & 0xffff_ffff_0000n) | (BigInt(accVal) & 0xffffn);
  }

  // Only a single element is set.
  // The E is used to pick the broadcast pattern and DE is used to pick the element.
  rsp.setVecS16(vd, vde & 7, rsp.getVecS16(vt, (select >> (4 * vde)) & 7));
}

function vrsq(i, dpInstruction) {
  const vt = cop2VT(i);
  const vte = cop2E(i);

  // Handle double or single precision.
  const val16 = rsp.getVecS16(vt, vte & 7);
  const input = (dpInstruction && rsp.divDP) ? ((rsp.divIn << 16) | (val16 & 0xffff)) : val16;

  // Accumulator is set to the entire input vector.
  // TODO: add helper + dedupe with VRCPH.
  let select = rsp.vecSelectU32[vte];
  for (let el = 0; el < 8; el++, select >>= 4) {
    const val = rsp.getVecS16(vt, select & 0x7);
    rsp.vAcc[el] = (rsp.vAcc[el] & 0xffffffff0000n) | (BigInt(val) & 0xffffn);
  }

  // Output is set to the result.
  const result = rsq16(input);
  rsp.divDP = false;
  rsp.divOut = result >> 16;
  rsp.setVecS16(cop2VD(i), cop2DE(i) & 7, result & 0xffff);
}

// Vector Element Scalar SQRT Reciprocal.
function executeVRSQ(i) {
  vrsq(i, false);
}

// Vector Element Scalar SQRT Reciprocal (Double Precision Low).
function executeVRSQL(i) {
  vrsq(i, true);
}

// Vector Element Scalar SQRT Reciprocal (Double Precision High).
function executeVRSQH(i) {
  const vt = cop2VT(i);
  const vte = cop2E(i);

  // Accumulator is set to the entire input vector.
  // TODO: add helper + dedupe with VRCP.
  let select = rsp.vecSelectU32[vte];
  for (let el = 0; el < 8; el++, select >>= 4) {
    const val = rsp.getVecS16(vt, select & 0x7);
    rsp.vAcc[el] = (rsp.vAcc[el] & 0xffff_ffff_0000n) | (BigInt(val) & 0xffffn);
  }

  rsp.divDP = true;
  rsp.divIn = rsp.getVecS16(vt, vte & 7);
  rsp.setVecS16(cop2VD(i), cop2DE(i) & 7, rsp.divOut);
}

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
  const t = vmemVT(i);
  const el = vmemEl(i);

  for (let x = 0; x < scale; x++) {
    rsp.store8(addr + x, rsp.getVecS8(t, (el + x) & 15));
  }
}


function executeLBV(i) { loadVector(i, 1); }
function executeLSV(i) { loadVector(i, 2); }
function executeLLV(i) { loadVector(i, 4); }
function executeLDV(i) { loadVector(i, 8); }
function executeLQV(i) {
  const addr = rsp.calcVecAddress(i, 16);
  const end = (addr & 0xff0) + 16;
  const t = vmemVT(i);
  const el = vmemEl(i);

  const len = Math.min(end - addr, 16 - el);
  for (let x = 0; x < len; x++) {
    rsp.setVecS8(t, el + x, rsp.loadU8(addr + x));
  }
}

function executeLRV(i) {
  const end = rsp.calcVecAddress(i, 16);
  const addr = end & 0xff0;
  const t = vmemVT(i);
  const el = vmemEl(i);

  const offset = end & 15;
  const startEl = (16 - offset) + el;
  const len = Math.min(offset, 16 - startEl);
  for (let x = 0; x < len; x++) {
    rsp.setVecS8(t, startEl + x, rsp.loadU8(addr + x));
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
  const t = vmemVT(i);
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
    rsp.setVecS8(t, i, dv.getInt8(i, false));
  }
}

function executeLWV(i) { /* No-op */ }

function executeLTV(i) {
  const addr = rsp.calcVecAddress(i, 16);
  const t = vmemVT(i);
  const el = vmemEl(i);

  const regBase = t & ~7;
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
  const t = vmemVT(i);
  const el = vmemEl(i);

  let len = end - addr;
  for (let x = 0; x < len; x++) {
    // Stores wrap around the vector, unlike loads. 
    rsp.store8(addr + x, rsp.getVecS8(t, (el + x) & 15));
  }
}

function executeSRV(i) {
  const end = rsp.calcVecAddress(i, 16);
  const addr = end & 0xff0;
  const t = vmemVT(i);
  const el = vmemEl(i);

  const offset = end & 15;
  const startEl = (16 - offset) + el;
  const len = offset;
  for (let x = 0; x < len; x++) {
    // Stores wrap around the vector, unlike loads. 
    rsp.store8(addr + x, rsp.getVecS8(t, (startEl + x) & 15));
  }
}

function executeSPV(i) {
  const addr = rsp.calcVecAddress(i, 8);
  const t = vmemVT(i);
  const el = vmemEl(i);

  for (let i = 0; i < 8; i++) {
    const elIdx = el + i;
    const shift = (elIdx & 8) ? 7 : 8;
    const val = rsp.getVecS16(t, elIdx & 7) >>> shift;
    rsp.store8(addr + i, val);
  }
}

function executeSUV(i) {
  const addr = rsp.calcVecAddress(i, 8);
  const t = vmemVT(i);
  const el = vmemEl(i);

  for (let i = 0; i < 8; i++) {
    const elIdx = el + i;
    const shift = (elIdx & 8) ? 8 : 7;
    const val = rsp.getVecS16(t, elIdx & 7) >>> shift;
    rsp.store8(addr + i, val);
  }
}

function executeSHV(i) {
  const addr = rsp.calcVecAddress(i, 16);
  const t = vmemVT(i);
  const el = vmemEl(i);

  const offset = addr & 7;
  const base = addr - offset;
  for (let i = 0; i < 8; i++) {
    const elIdx = el + (i * 2);
    const memIdx = (offset + (i * 2)) & 15;
    const val = rsp.getVecU16UnalignedWrap(t, elIdx) >>> 7;
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
  const t = vmemVT(i);
  const el = vmemEl(i);

  const offset = addr & 7;
  const base = addr - offset;

  const elems = sfvElements.get(el);
  if (elems) {
    for (let i = 0; i < 4; i++) {
      const memIdx = (offset + (i * 4)) & 15;
      rsp.store8(base + memIdx, rsp.getVecU16(t, elems[i]) >>> 7);
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
  const t = vmemVT(i);
  const el = vmemEl(i);

  const offset = addr & 0x7;
  const base = addr - offset;

  for (let i = 0; i < 16; i++) {
    const elIdx = (el + i) & 15;
    const memIdx = (offset + i) & 15;
    rsp.store8(base + memIdx, rsp.getVecS8(t, elIdx));
  }
}

function executeSTV(i) {
  const addr = rsp.calcVecAddress(i, 16);
  const t = vmemVT(i);
  const el = vmemEl(i);

  // Output seems to be 8 byte aligned and rotate through 16-bytes.
  const memBase = addr & 0xff8;
  const memOffset = addr & 0xf;
  // Element index is offset by 0 or 8 depending on dest alignment.
  const elOffset = addr & 0x8;
  // Output is stored in 8 consecutive registers.
  const regBase = t & ~7;
  const regOffset = (el - (addr & 0x8)) >> 1;

  for (let i = 0; i < 16; i++) {
    const memIdx = memBase + ((memOffset + i) & 0xf);
    const regIdx = regBase + ((regOffset + (i >> 1)) & 0x7);
    const elIdx = (elOffset + i) & 0xf;
    rsp.store8(memIdx, rsp.getVecS8(regIdx, elIdx));
  }
}
