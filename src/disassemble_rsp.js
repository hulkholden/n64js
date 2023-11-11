/*global n64js*/

import { toString32, toHex } from "./format.js";

function _funct(i) { return i & 0x3f; }

function _sa(i) { return (i >>> 6) & 0x1f; }
function _rd(i) { return (i >>> 11) & 0x1f; }
function _rt(i) { return (i >>> 16) & 0x1f; }
function _rs(i) { return (i >>> 21) & 0x1f; }
function _op(i) { return (i >>> 26) & 0x3f; }

// LWC2 and SWC2 instructions.
function _vmemBase(i) { return (i >>> 21) & 0x1f; }
function _vmemVT(i) { return (i >>> 16) & 0x1f; }
function _vmemEl(i) { return (i >>> 7) & 0xf; }
function _vmemOffset(i) { return ((i & 0x7f) << 25) >> 25; }

// COP2 instructions.
function _cop2E(i) { return (i >>> 21) & 0xf; }
function _cop2DE(i) { return (i >>> 11) & 0x1f; }
function _cop2VT(i) { return (i >>> 16) & 0x1f; }
function _cop2VS(i) { return (i >>> 11) & 0x1f; }
function _cop2VD(i) { return (i >>> 6) & 0x1f; }

function _target(i) { return i & 0x3ffffff; }
function _imm(i) { return i & 0xffff; }
function _imms(i) { return (_imm(i) << 16) >> 16; }   // treat immediate value as signed

function _base(i) { return (i >>> 21) & 0x1f; }
function _offsetS16(i) { return (_imm(i) << 16) >> 16; }   // treat immediate value as signed
function _offsetU16(i) { return i & 0xffff; }

function _branchAddress(a, i) { return (a + 4) + (_imms(i) * 4); }
function _jumpAddress(a, i) { return (a & 0xf0000000) | (_target(i) * 4); }


function makeLabelText(address) {
  //return `<span class="dis-address-jump">${toHex(address, 16)}</span>`;
  return toHex(address, 16);
}

export const gprNames = [
  'r0', 'at', 'v0', 'v1', 'a0', 'a1', 'a2', 'a3',
  't0', 't1', 't2', 't3', 't4', 't5', 't6', 't7',
  's0', 's1', 's2', 's3', 's4', 's5', 's6', 's7',
  't8', 't9', 'k0', 'k1', 'gp', 'sp', 's8', 'ra'
];

const RA = 0x1f;

const cop0RegNames = [
  // 0
  'SP_MEM_ADDR_REG',
  'SP_DRAM_ADDR_REG',
  'SP_RD_LEN_REG',
  'SP_WR_LEN_REG',
  'SP_STATUS_REG',
  'SP_DMA_FULL_REG',
  'SP_DMA_BUSY_REG',
  'SP_SEMAPHORE_REG',
  // 8
  'DPC_START_REG',
  'DPC_END_REG',
  'DPC_CURRENT_REG',
  'DPC_STATUS_REG',
  'DPC_CLOCK_REG',
  'DPC_BUFBUSY_REG',
  'DPC_PIPEBUSY_REG',
  'DPC_TMEM_REG',
];

const c2ControlNames = [
  'VCO', 'VCC', 'VCE', 'VCE',
];

const vecSelectNames = [
  'All', 'All1',
  '0q', '1q', 
  '0h', '1h', '2h', '3h',
  '0', '1', '2', '3', '4', '5', '6', '7',
];

function makeRegSpan(t) {
  return t;
  //return `<span class="dis-reg-${t}">${t}</span>`;
}

class Instruction {
  constructor(address, opcode) {
    this.address = address;
    this.opcode = opcode;
    this.srcRegs = {};
    this.dstRegs = {};
    this.target = '';
    this.memory = null;
  }

  get rd() { const reg = this.gprName(_rd); this.dstRegs[reg] = 1; return makeRegSpan(reg); }
  get rt() { const reg = this.gprName(_rt); this.srcRegs[reg] = 1; return makeRegSpan(reg); }
  get rs() { const reg = this.gprName(_rs); this.srcRegs[reg] = 1; return makeRegSpan(reg); }
  // Shortcut for using rt as a destination register.
  get rt_d() { const reg = this.gprName(_rt); this.dstRegs[reg] = 1; return makeRegSpan(reg); }

  get c0reg() {
    const regIdx = _rd(this.opcode);
    if (regIdx < cop0RegNames.length) {
      return cop0RegNames[regIdx];
    }
    return `c0reg${regIdx}`;
  }

  // Cop2 operations.
  get cop2E() { return `${_cop2E(this.opcode)}`; }
  get cop2DE() { return `${_cop2DE(this.opcode)}`; }
  get cop2VD() { return `V${_cop2VD(this.opcode)}`; }
  get cop2VT() { return `V${_cop2VT(this.opcode)}`; }
  get cop2VS() { return `V${_cop2VS(this.opcode)}`; }

  get cop2VecSelect() { return vecSelectNames[_cop2E(this.opcode)]; }

  get c2flag() { return c2ControlNames[_rd(this.opcode) & 0x3]; }

  get sa() { return _sa(this.opcode); }

  gprName(opFn) { return gprNames[opFn(this.opcode)]; }

  // dummy operand - just marks ra as being a dest reg
  writesRA() { this.dstRegs[RA] = 1; return ''; }

  get imm() { return `0x${toHex(_imm(this.opcode), 16)}`; }

  get branchAddress() { this.target = _branchAddress(this.address, this.opcode); return makeLabelText(this.target); }
  get jumpAddress() { this.target = _jumpAddress(this.address, this.opcode); return makeLabelText(this.target); }

  // Load and Store operations.
  get base() { const reg = this.gprName(_base); this.srcRegs[reg] = 1; return makeRegSpan(reg); }
  get offsetU16() { return `0x${toHex(_offsetU16(this.opcode), 16)}`; }
  get offsetS16() { return `0x${toHex(_offsetS16(this.opcode), 16)}`; }

  memload() { return this.memaccess('load'); }
  memstore() { return this.memaccess('store'); }
  memaccess(mode) {
    this.memory = { reg: _base(this.opcode), offset: _offsetS16(this.opcode), mode: mode };
    return `[${this.base}+${this.offsetU16}]`;
  }

  // LWC2 and SWC2 operations.
  get vmemEl() { return `E${_vmemEl(this.opcode)}`; }
  vmemEls(num) { return `[${_vmemEl(this.opcode)}..${(_vmemEl(this.opcode) + num - 1) & 15}]` }
  get vmemVT() { return `V${_vmemVT(this.opcode)}`; }
  get vmemBase() { const reg = this.gprName(_vmemBase); this.srcRegs[reg] = 1; return makeRegSpan(reg); }

  vmemload(scale) { return this.vmemaccess('load', scale); }
  vmemstore(scale) { return this.vmemaccess('store', scale); }
  vmemaccess(mode, scale) {
    scale = scale || 1;
    this.memory = { reg: _vmemBase(this.opcode), offset: _vmemOffset(this.opcode) * scale, mode: mode };
    return `[${this.vmemBase}${this.sprintVOffset(scale)}]`;
  }
  sprintVOffset(scale) { const off = _vmemOffset(this.opcode) * scale; return (off >= 0 ? '+' : '') + off.toString(); }
}

const specialTable = (() => {
  let tbl = [];
  for (let i = 0; i < 64; i++) {
    tbl[i] = disassembleUnknown;
  }

  tbl[0] = i => {
    if (i.opcode === 0) {
      return `NOP`;
    }
    return `SLL       ${i.rd} = ${i.rt} << ${i.sa}`;
  };
  tbl[2] = i => `SRL       ${i.rd} = ${i.rt} >>> ${i.sa}`;
  tbl[3] = i => `SRA       ${i.rd} = ${i.rt} >> ${i.sa}`;
  tbl[4] = i => `SLLV      ${i.rd} = ${i.rt} << ${i.rs}`;
  tbl[6] = i => `SRLV      ${i.rd} = ${i.rt} >>> ${i.rs}`;
  tbl[7] = i => `SRAV      ${i.rd} = ${i.rt} >> ${i.rs}`;
  tbl[8] = i => `JR        ${i.rs}`;
  tbl[9] = i => `JALR      ${i.rd}, ${i.rs}`;
  tbl[13] = i => `BREAK     ${toHex((i.opcode >> 6) & 0xfffff, 20)}`;
  tbl[32] = i => `ADD       ${i.rd} = ${i.rs} + ${i.rt}`;
  tbl[33] = i => `ADDU      ${i.rd} = ${i.rs} + ${i.rt}`;
  tbl[34] = i => `SUB       ${i.rd} = ${i.rs} - ${i.rt}`;
  tbl[35] = i => `SUBU      ${i.rd} = ${i.rs} - ${i.rt}`;
  tbl[36] = i => `AND       ${i.rd} = ${i.rs} & ${i.rt}`;
  tbl[37] = i => `OR        ${i.rd} = ${i.rs} | ${i.rt}`;
  tbl[38] = i => `XOR       ${i.rd} = ${i.rs} ^ ${i.rt}`;
  tbl[39] = i => `NOR       ${i.rd} = ~( ${i.rs} | ${i.rt} )`;
  tbl[42] = i => `SLT       ${i.rd} = ${i.rs} < ${i.rt}`;
  tbl[43] = i => `SLTU      ${i.rd} = ${i.rs} < ${i.rt}`;
  return tbl;
})();

const regImmTable = (() => {
  let tbl = [];
  for (let i = 0; i < 32; i++) {
    tbl.push(disassembleUnknown);
  }

  tbl[0] = i => `BLTZ      ${i.rs} < 0 --> ${i.branchAddress}`;
  tbl[1] = i => `BGEZ      ${i.rs} >= 0 --> ${i.branchAddress}`;
  tbl[16] = i => `BLTZAL    ${i.rs} < 0 --> ${i.branchAddress}${i.writesRA()}`;
  tbl[17] = i => `BGEZAL    ${i.rs} >= 0 --> ${i.branchAddress}${i.writesRA()}`;
  return tbl;
})();

const cop0Table = (() => {
  let tbl = [];
  for (let i = 0; i < 32; i++) {
    tbl.push(disassembleUnknown);
  }
  tbl[0] = i => `MFC0      ${i.rt_d} <- ${i.c0reg}`;
  tbl[4] = i => `MTC0      ${i.rt} -> ${i.c0reg}`;
  return tbl;
})();

const cop2Table = (() => {
  let tbl = [];
  for (let i = 0; i < 32; i++) {
    tbl.push(disassembleUnknown);
  }
  tbl[0] = i => `MFC2      ${i.rt_d} = ${_rd(i.opcode)}[${_vmemEl(i.opcode)}]`;
  tbl[2] = i => `CFC2      ${i.rt_d} = ${i.c2flag}`;
  tbl[4] = i => `MTC2      V${_rd(i.opcode)}[${_vmemEl(i.opcode)}] = ${i.rt}`;
  tbl[6] = i => `CTC2      ${i.c2flag} = ${i.rt}`;

  for (let i = 16; i < 32; i++) {
    tbl[i] = disassembleVector;
  }
  return tbl;
})();

const vectorTable = (() => {
  let tbl = [];
  for (let i = 0; i < 64; i++) {
    tbl.push(disassembleUnknown);
  }

  // TODO: flesh these out.
  tbl[0] = i => `VMULF     ${i.cop2VD} = ${i.cop2VS} * ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[1] = i => `VMULU     ${i.cop2VD} = ${i.cop2VS} * ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[2] = i => `VRNDP     ${i.cop2VD} = ${i.cop2VS} * ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[3] = i => `VMULQ     ${i.cop2VD} = ${i.cop2VS} * ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[4] = i => `VMUDL     ${i.cop2VD} = ${i.cop2VS} * ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[5] = i => `VMUDM     ${i.cop2VD} = ${i.cop2VS} * ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[6] = i => `VMUDN     ${i.cop2VD} = ${i.cop2VS} * ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[7] = i => `VMUDH     ${i.cop2VD} = ${i.cop2VS} * ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[8] = i => `VMACF     ${i.cop2VD} = ${i.cop2VS} * ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[9] = i => `VMACU     ${i.cop2VD} = ${i.cop2VS} * ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[10] = i => `VRNDN     ${i.cop2VD} = ${i.cop2VS} * ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[11] = i => `VMACQ     ${i.cop2VD}, ACC = oddify(ACC)`;
  tbl[12] = i => `VMADL     ${i.cop2VD} = ${i.cop2VS} * ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[13] = i => `VMADM     ${i.cop2VD} = ${i.cop2VS} * ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[14] = i => `VMADN     ${i.cop2VD} = ${i.cop2VS} * ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[15] = i => `VMADH     ${i.cop2VD} = ${i.cop2VS} * ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[16] = i => `VADD      ${i.cop2VD} = ${i.cop2VS} + ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[17] = i => `VSUB      ${i.cop2VD} = ${i.cop2VS} - ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[18] = i => `VSUT      ${i.cop2VD} = 0, ACC = ${i.cop2VS} + ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[19] = i => `VABS      ${i.cop2VD} = sign(${i.cop2VS}) * ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[20] = i => `VADDC     ${i.cop2VD} = ${i.cop2VS} + ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[21] = i => `VSUBC     ${i.cop2VD} = ${i.cop2VS} - ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[22] = i => `VADDB     ${i.cop2VD} = 0, ACC = ${i.cop2VS} + ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[23] = i => `VSUBB     ${i.cop2VD} = 0, ACC = ${i.cop2VS} + ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[24] = i => `VACCB     ${i.cop2VD} = 0, ACC = ${i.cop2VS} + ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[25] = i => `VSUCB     ${i.cop2VD} = 0, ACC = ${i.cop2VS} + ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[26] = i => `VSAD      ${i.cop2VD} = 0, ACC = ${i.cop2VS} + ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[27] = i => `VSAC      ${i.cop2VD} = 0, ACC = ${i.cop2VS} + ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[28] = i => `VSUM      ${i.cop2VD} = 0, ACC = ${i.cop2VS} + ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[29] = i => `VSAR      ${i.cop2VD}, ${i.cop2VS}, ${i.cop2VT}[${i.cop2E}]`; // TODO: show low/med/high name?
  tbl[30] = i => `V30       ${i.cop2VD} = 0, ACC = ${i.cop2VS} + ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[31] = i => `V31       ${i.cop2VD} = 0, ACC = ${i.cop2VS} + ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[32] = i => `VLT       ${i.cop2VD}, CC = cmpLT(${i.cop2VS}, ${i.cop2VT}[${i.cop2VecSelect}])`;
  tbl[33] = i => `VEQ       ${i.cop2VD}, CC = cmpEQ(${i.cop2VS}, ${i.cop2VT}[${i.cop2VecSelect}])`;
  tbl[34] = i => `VNE       ${i.cop2VD}, CC = cmpNE(${i.cop2VS}, ${i.cop2VT}[${i.cop2VecSelect}])`;
  tbl[35] = i => `VGE       ${i.cop2VD}, CC = cmpGE(${i.cop2VS}, ${i.cop2VT}[${i.cop2VecSelect}])`;
  tbl[36] = i => `VCL       ${i.cop2VD}, ACC = ${i.cop2VS} clip ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[37] = i => `VCH       ${i.cop2VD}, ACC = ${i.cop2VS} clip ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[38] = i => `VCR       ${i.cop2VD}, ACC = ${i.cop2VS} crimp ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[39] = i => `VMRG      ${i.cop2VD} = VCC ? ${i.cop2VS} : ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[40] = i => `VAND      ${i.cop2VD} = ${i.cop2VS} & ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[41] = i => `VNAND     ${i.cop2VD} = ~(${i.cop2VS} & ${i.cop2VT}[${i.cop2VecSelect}])`;
  tbl[42] = i => `VOR       ${i.cop2VD} = ${i.cop2VS} | ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[43] = i => `VNOR      ${i.cop2VD} = ~(${i.cop2VS} | ${i.cop2VT}[${i.cop2VecSelect}])`;
  tbl[44] = i => `VXOR      ${i.cop2VD} = ${i.cop2VS} ^ ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[45] = i => `VNXOR     ${i.cop2VD} = ~(${i.cop2VS} ^ ${i.cop2VT}[${i.cop2VecSelect}])`;
  tbl[46] = i => `V46       ${i.cop2VD} = 0, ACC = ${i.cop2VS} + ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[47] = i => `V47       ${i.cop2VD} = 0, ACC = ${i.cop2VS} + ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[48] = i => `VRCP      ${i.cop2VD}[${i.cop2DE}] = 1/${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[49] = i => `VRCPL     ${i.cop2VD}[${i.cop2DE}] = 1/${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[50] = i => `VRCPH     ${i.cop2VD}[${i.cop2DE}], DIVIN = DIVOUT, ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[51] = i => `VMOV      ${i.cop2VD}[${i.cop2DE}] = ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[52] = i => `VRSQ      ${i.cop2VD}[${i.cop2DE}] = 1/sqrt(${i.cop2VT}[${i.cop2VecSelect}])`;
  tbl[53] = i => `VRSQL     ${i.cop2VD}[${i.cop2DE}] = 1/sqrt(${i.cop2VT}[${i.cop2VecSelect}])`;
  tbl[54] = i => `VRSQH     ${i.cop2VD}[${i.cop2DE}], DIVIN = DIVOUT, ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[55] = i => `VNOP`;
  tbl[56] = i => `VEXTT     ${i.cop2VD} = 0, ACC = ${i.cop2VS} + ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[57] = i => `VEXTQ     ${i.cop2VD} = 0, ACC = ${i.cop2VS} + ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[58] = i => `VEXTN     ${i.cop2VD} = 0, ACC = ${i.cop2VS} + ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[59] = i => `V59       ${i.cop2VD} = 0, ACC = ${i.cop2VS} + ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[60] = i => `VINST     ${i.cop2VD} = 0, ACC = ${i.cop2VS} + ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[61] = i => `VINSQ     ${i.cop2VD} = 0, ACC = ${i.cop2VS} + ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[62] = i => `VINSN     ${i.cop2VD} = 0, ACC = ${i.cop2VS} + ${i.cop2VT}[${i.cop2VecSelect}]`;
  tbl[63] = i => `VNULL`;

  return tbl;
})();

function disassembleVector(i) {
  return vectorTable[_funct(i.opcode)](i);
}

const lc2Table = (() => {
  let tbl = [];
  for (let i = 0; i < 32; i++) {
    tbl.push(disassembleUnknown);
  }

  // TODO: flesh these out.
  tbl[0] = i => `LBV       ${i.vmemVT}${i.vmemEls(1)} <- ${i.vmemload(1)}`;
  tbl[1] = i => `LSV       ${i.vmemVT}${i.vmemEls(2)} <- ${i.vmemload(2)}`;
  tbl[2] = i => `LLV       ${i.vmemVT}${i.vmemEls(4)} <- ${i.vmemload(4)}`;
  tbl[3] = i => `LDV       ${i.vmemVT}${i.vmemEls(8)} <- ${i.vmemload(8)}`;
  tbl[4] = i => `LQV       ${i.vmemVT} <- ${i.vmemload(16)}`;
  tbl[5] = i => `LRV       ${i.vmemVT} <- ${i.vmemload(16)}`;
  tbl[6] = i => `LPV       ${i.vmemVT} <- ${i.vmemload(8)}`;
  tbl[7] = i => `LUV       ${i.vmemVT} <- ${i.vmemload(8)}`;
  tbl[8] = i => `LHV       ${i.vmemVT} <- ${i.vmemload(16)}`;
  tbl[9] = i => `LFV       ${i.vmemVT} <- ${i.vmemload(16)}`;
  tbl[10] = i => `LWV       ${i.vmemVT} <- ${i.vmemload(16)}`;
  tbl[11] = i => `LTV       ${i.vmemVT} <- ${i.vmemload(16)}`;

  return tbl;
})();

const sc2Table = (() => {
  let tbl = [];
  for (let i = 0; i < 32; i++) {
    tbl.push(disassembleUnknown);
  }

  // TODO: flesh these out.
  tbl[0] = i => `SBV       ${i.vmemVT}${i.vmemEls(1)} -> ${i.vmemstore(1)}`;
  tbl[1] = i => `SSV       ${i.vmemVT}${i.vmemEls(2)} -> ${i.vmemstore(2)}`;
  tbl[2] = i => `SLV       ${i.vmemVT}${i.vmemEls(4)} -> ${i.vmemstore(4)}`;
  tbl[3] = i => `SDV       ${i.vmemVT}${i.vmemEls(8)} -> ${i.vmemstore(8)}`;
  tbl[4] = i => `SQV       ${i.vmemVT} -> ${i.vmemstore(16)}`;
  tbl[5] = i => `SRV       ${i.vmemVT} -> ${i.vmemstore(16)}`;
  tbl[6] = i => `SPV       ${i.vmemVT} -> ${i.vmemstore(8)}`;
  tbl[7] = i => `SUV       ${i.vmemVT} -> ${i.vmemstore(8)}`;
  tbl[8] = i => `SHV       ${i.vmemVT} -> ${i.vmemstore(16)}`;
  tbl[9] = i => `SFV       ${i.vmemVT} -> ${i.vmemstore(16)}`;
  tbl[10] = i => `SWV       ${i.vmemVT} -> ${i.vmemstore(16)}`;
  tbl[11] = i => `STV       ${i.vmemVT} -> ${i.vmemstore(16)}`;

  return tbl;
})();

const simpleTable = (() => {
  let tbl = [];
  for (let i = 0; i < 64; i++) {
    tbl.push(disassembleUnknown);
  }

  tbl[0] = i => specialTable[_funct(i.opcode)](i);
  tbl[1] = i => regImmTable[_rt(i.opcode)](i);
  tbl[2] = i => `J         --> ${i.jumpAddress}`;
  tbl[3] = i => `JAL       --> ${i.jumpAddress}${i.writesRA()}`;
  tbl[4] = i => {
    if (_rs(i.opcode) == _rt(i.opcode)) {
      return `B         --> ${i.branchAddress}`;
    }
    return `BEQ       ${i.rs} == ${i.rt} --> ${i.branchAddress}`;
  };
  tbl[5] = i => `BNE       ${i.rs} != ${i.rt} --> ${i.branchAddress}`;
  tbl[6] = i => `BLEZ      ${i.rs} <= 0 --> ${i.branchAddress}`;
  tbl[7] = i => `BGTZ      ${i.rs} > 0 --> ${i.branchAddress}`;
  tbl[8] = i => `ADDI      ${i.rt_d} = ${i.rs} + ${i.imm}`;
  tbl[9] = i => `ADDIU     ${i.rt_d} = ${i.rs} + ${i.imm}`;
  tbl[10] = i => `SLTI      ${i.rt_d} = (${i.rs} < ${i.imm})`;
  tbl[11] = i => `SLTIU     ${i.rt_d} = (${i.rs} < ${i.imm})`;
  tbl[12] = i => `ANDI      ${i.rt_d} = ${i.rs} & ${i.imm}`;
  tbl[13] = i => `ORI       ${i.rt_d} = ${i.rs} | ${i.imm}`;
  tbl[14] = i => `XORI      ${i.rt_d} = ${i.rs} ^ ${i.imm}`;
  tbl[15] = i => `LUI       ${i.rt_d} = ${i.imm} << 16`;
  tbl[16] = i => cop0Table[_rs(i.opcode)](i);
  tbl[18] = i => cop2Table[_rs(i.opcode)](i);
  tbl[32] = i => `LB        ${i.rt_d} <- ${i.memload()}`;
  tbl[33] = i => `LH        ${i.rt_d} <- ${i.memload()}`;
  tbl[35] = i => `LW        ${i.rt_d} <- ${i.memload()}`;
  tbl[36] = i => `LBU       ${i.rt_d} <- ${i.memload()}`;
  tbl[37] = i => `LHU       ${i.rt_d} <- ${i.memload()}`;
  tbl[39] = i => `LWU       ${i.rt_d} <- ${i.memload()}`;
  tbl[40] = i => `SB        ${i.rt} -> ${i.memstore()}`;
  tbl[41] = i => `SH        ${i.rt} -> ${i.memstore()}`;
  tbl[43] = i => `SW        ${i.rt} -> ${i.memstore()}`;
  tbl[50] = i => lc2Table[_rd(i.opcode)](i);
  tbl[58] = i => sc2Table[_rd(i.opcode)](i);
  return tbl;
})();

function disassembleUnknown(i) {
  return `unknown: ${toString32(i.opcode)}`;
}

export function disassembleInstruction(address, instruction) {
  const i = new Instruction(address, instruction);
  const disassembly = simpleTable[_op(instruction)](i);
  return {
    address: address,
    instruction: i,
    disassembly: disassembly,
    isJumpTarget: false,
  };
}

export function disassembleRange(imem, beginAddr, endAddr) {
  return disassembleRemappedRange(imem, beginAddr, beginAddr, endAddr - beginAddr);
}

/**
 * Returns dissassembly for the specified range.
 * Instructions are read from the specified offset and mapped relative to baseAddress.
 * This is useful for disassembly RSP microcode from RAM using the address it would be loaded at.
 * @param {MemoryRegion} mem The memory region containing the instructions.
 * @param {number} baseAddr The address of the first instruction.
 * @param {number} memOffset The offset into mem to start disassembling from.
 * @param {number} length The number of bytes to disassemble.
 * @returns 
 */
export function disassembleRemappedRange(mem, baseAddr, memOffset, length) {
  const disassembly = [];
  const targets = new Set();

  // Wrap instruction loads around the memory region.
  // This is primarily for IMEM.
  const mask = mem.length - 1;

  for (let i = 0; i < length; i += 4) {
    const instruction = mem.getU32((memOffset + i) & mask);
    const d = disassembleInstruction(baseAddr + i, instruction);
    if (d.instruction.target) {
      targets.add(d.instruction.target);
    }
    disassembly.push(d);
  }

  // Mark any instructions that are jump targets.
  for (let d of disassembly) {
    if (targets.has(d.instruction.address)) {
      d.isJumpTarget = true;
    }
  }

  return disassembly;
}

export function dumpDMEM(mem, baseAddr, offset, length) {
  let text = '';
  for (let i = 0; i < length; i += 4) {
    text += `${toHex(baseAddr + i, 16)}: ${toHex(mem.getU32(offset + i), 32)}\n`;
  }
  return text;
}
