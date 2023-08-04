import * as disassemble_rsp from "./disassemble_rsp.js";
import { toString16, toString32, toHex } from "./format.js";

window.n64js = window.n64js || {};

function funct(i) { return i & 0x3f; }

function offset(i) { return ((i & 0xffff) << 16) >> 16; }
function sa(i) { return (i >>> 6) & 0x1f; }
function rd(i) { return (i >>> 11) & 0x1f; }
function rt(i) { return (i >>> 16) & 0x1f; }
function rs(i) { return (i >>> 21) & 0x1f; }
function op(i) { return (i >>> 26) & 0x3f; }

function ve(i) { return (i >>> 7) & 0xf; }
function vd(i) { return (i >>> 11) & 0x1f; }
function vt(i) { return (i >>> 16) & 0x1f; }
function vs(i) { return (i >>> 21) & 0x1f; }

function target(i) { return i & 0x3ffffff; }
function imm(i) { return i & 0xffff; }
function imms(i) { return (imm(i) << 16) >> 16; }   // treat immediate value as signed

function base(i) { return (i >>> 21) & 0x1f; }

function branchAddress(a, i) { return (a + 4) + (imms(i) * 4); }
function jumpAddress(a, i) { return (a & 0xf0000000) | (target(i) * 4); }

function vbase(i) { return (i >>> 21) & 0x1f; }
function voffset(i) { return ((i & 0x7f) << 25) >> 25; }

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

    const vAccMem = new ArrayBuffer(8 * 8); // Actually 48 bits, not 64. 
    this.vAcc = new BigInt64Array(vecMem);

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
  }

  getRegS32(r) { return this.gprS32[r]; }
  getRegU32(r) { return this.gprU32[r]; }
  setRegS32(r, v) { if (r != 0) { this.gprS32[r] = v; } }
  setRegU32(r, v) { if (r != 0) { this.gprU32[r] = v; } }

  getVecS16(r, e) { return this.vpr.getInt16((8 * r + e) * 2, false); }
  getVecS8(r, e) { return this.vpr.getInt8(16 * r + e, false); }
  setVecS8(r, e, v) { this.vpr.setInt8(16 * r + e, v); }

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
    return (this.getRegS32(vbase(instr)) + (voffset(instr) * scale)) & 0xfff;
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

      if (count > 20000) {
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
  tbl[0] = i => executeUnhandled('MFC2', i);
  tbl[2] = i => executeUnhandled('CFC2', i);
  tbl[4] = i => executeUnhandled('MTC2', i);
  tbl[6] = i => executeUnhandled('CTC2', i);

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
  tbl[0] = i => executeUnhandled('VMULF', i);
  tbl[1] = i => executeUnhandled('VMULU', i);
  tbl[2] = i => executeUnhandled('VRNDP', i);
  tbl[3] = i => executeUnhandled('VMULQ', i);
  tbl[4] = i => executeUnhandled('VMUDL', i);
  tbl[5] = i => executeUnhandled('VMUDM', i);
  tbl[6] = i => executeUnhandled('VMUDN', i);
  tbl[7] = i => executeUnhandled('VMUDH', i);
  tbl[8] = i => executeUnhandled('VMACF', i);
  tbl[9] = i => executeUnhandled('VMACU', i);
  tbl[10] = i => executeUnhandled('VRNDN', i);
  tbl[11] = i => executeUnhandled('VMACQ', i);
  tbl[12] = i => executeUnhandled('VMADL', i);
  tbl[13] = i => executeUnhandled('VMADM', i);
  tbl[14] = i => executeUnhandled('VMADN', i);
  tbl[15] = i => executeUnhandled('VMADH', i);
  tbl[16] = i => executeUnhandled('VADD', i);
  tbl[17] = i => executeUnhandled('VSUB', i);
  tbl[18] = i => executeUnhandled('VSUT', i);
  tbl[19] = i => executeUnhandled('VABS', i);
  tbl[20] = i => executeUnhandled('VADDC', i);
  tbl[21] = i => executeUnhandled('VSUBC', i);
  tbl[22] = i => executeUnhandled('VADDB', i);
  tbl[23] = i => executeUnhandled('VSUBB', i);
  tbl[24] = i => executeUnhandled('VACCB', i);
  tbl[25] = i => executeUnhandled('VSUCB', i);
  tbl[26] = i => executeUnhandled('VSAD', i);
  tbl[27] = i => executeUnhandled('VSAC', i);
  tbl[28] = i => executeUnhandled('VSUM', i);
  tbl[29] = i => executeUnhandled('VSAR', i);
  tbl[30] = i => executeUnhandled('V30', i);
  tbl[31] = i => executeUnhandled('V31', i);
  tbl[32] = i => executeUnhandled('VLT', i);
  tbl[33] = i => executeUnhandled('VEQ', i);
  tbl[34] = i => executeUnhandled('VNE', i);
  tbl[35] = i => executeUnhandled('VGE', i);
  tbl[36] = i => executeUnhandled('VCL', i);
  tbl[37] = i => executeUnhandled('VCH', i);
  tbl[38] = i => executeUnhandled('VCR', i);
  tbl[39] = i => executeUnhandled('VMRG', i);
  tbl[40] = i => executeUnhandled('VAND', i);
  tbl[41] = i => executeUnhandled('VNAND', i);
  tbl[42] = i => executeUnhandled('VOR', i);
  tbl[43] = i => executeUnhandled('VNOR', i);
  tbl[44] = i => executeUnhandled('VXOR', i);
  tbl[45] = i => executeUnhandled('VNXOR', i);
  tbl[46] = i => executeUnhandled('V46', i);
  tbl[47] = i => executeUnhandled('V47', i);
  tbl[48] = i => executeUnhandled('VRCP', i);
  tbl[49] = i => executeUnhandled('VRCPL', i);
  tbl[50] = i => executeUnhandled('VRCPH', i);
  tbl[51] = i => executeUnhandled('VMOV', i);
  tbl[52] = i => executeUnhandled('VRSQ', i);
  tbl[53] = i => executeUnhandled('VRSQL', i);
  tbl[54] = i => executeUnhandled('VRSQH', i);
  tbl[55] = i => executeUnhandled('VNOP', i);
  tbl[56] = i => executeUnhandled('VEXTT', i);
  tbl[57] = i => executeUnhandled('VEXTQ', i);
  tbl[58] = i => executeUnhandled('VEXTN', i);
  tbl[59] = i => executeUnhandled('V59', i);
  tbl[60] = i => executeUnhandled('VINST', i);
  tbl[61] = i => executeUnhandled('VINSQ', i);
  tbl[62] = i => executeUnhandled('VINSN', i);
  tbl[63] = i => executeUnhandled('VNULL', i);
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
  const t = vt(i);
  const el = ve(i);

  const len = (16 - el) < scale ? (16 - el) : scale;

  for (let x = 0; x < len; x++) {
    rsp.setVecS8(t, (el + x), rsp.loadS8(addr + x));
  }
}

function storeVector(i, scale) {
  const addr = rsp.calcVecAddress(i, scale);
  const t = vt(i);
  const el = ve(i);

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
  const end = (addr + 16) & 0xff0;
  const t = vt(i);
  const el = ve(i);

  const len = Math.min(end - addr, 16 - el);
  for (let x = 0; x < len; x++) {
    rsp.setVecS8(t, el + x, rsp.loadU8(addr + x));
  }
}

function executeLRV(i) {
  const end = rsp.calcVecAddress(i, 16);
  const addr = end & 0xff0;
  const t = vt(i);
  const el = ve(i);

  const offset = end & 15;
  const startEl = (16 - offset) + el;
  const len = Math.min(offset, 16 - startEl);
  for (let x = 0; x < len; x++) {
    rsp.setVecS8(t, startEl + x, rsp.loadU8(addr + x));
  }
}
function executeLPV(i) { executeUnhandled('LPV', i); }
function executeLUV(i) { executeUnhandled('LUV', i); }
function executeLHV(i) { executeUnhandled('LHV', i); }
function executeLFV(i) { executeUnhandled('LFV', i); }
function executeLWV(i) { executeUnhandled('LWV', i); }
function executeLTV(i) { executeUnhandled('LTV', i); }

function executeSBV(i) { storeVector(i, 1); }
function executeSSV(i) { storeVector(i, 2); }
function executeSLV(i) { storeVector(i, 4); }
function executeSDV(i) { storeVector(i, 8); }
function executeSQV(i) {
  const addr = rsp.calcVecAddress(i, 16);
  const end = (addr + 16) & 0xff0;
  const t = vt(i);
  const el = ve(i);

  let len = end - addr;
  for (let x = 0; x < len; x++) {
    // Stores wrap around the vector, unlike loads. 
    rsp.store8(addr + x, rsp.getVecS8(t, (el + x) & 15));
  }
}
function executeSRV(i) {
  const end = rsp.calcVecAddress(i, 16);
  const addr = end & 0xff0;
  const t = vt(i);
  const el = ve(i);

  const offset = end & 15;
  const startEl = (16 - offset) + el;
  const len = offset;
  for (let x = 0; x < len; x++) {
    // Stores wrap around the vector, unlike loads. 
    rsp.store8(addr + x, rsp.getVecS8(t, (startEl + x) & 15));
  }
}
function executeSPV(i) { executeUnhandled('SPV', i); }
function executeSUV(i) { executeUnhandled('SUV', i); }
function executeSHV(i) { executeUnhandled('SHV', i); }
function executeSFV(i) { executeUnhandled('SFV', i); }
function executeSWV(i) { executeUnhandled('SWV', i); }
function executeSTV(i) { executeUnhandled('STV', i); }
