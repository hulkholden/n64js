import { toString32, toHex } from "./format.js";

function _funct(i) { return i & 0x3f; }

function _sa(i) { return (i >>> 6) & 0x1f; }
function _rd(i) { return (i >>> 11) & 0x1f; }
function _rt(i) { return (i >>> 16) & 0x1f; }
function _rs(i) { return (i >>> 21) & 0x1f; }
function _op(i) { return (i >>> 26) & 0x3f; }

function _ve(i) { return (i >>> 7) & 0xf; }
function _vd(i) { return (i >>> 11) & 0x1f; }
function _vt(i) { return (i >>> 16) & 0x1f; }
function _vs(i) { return (i >>> 21) & 0x1f; }

function _target(i) { return i & 0x3ffffff; }
function _imm(i) { return i & 0xffff; }
function _imms(i) { return (_imm(i) << 16) >> 16; }   // treat immediate value as signed

function _base(i) { return (i >>> 21) & 0x1f; }
function _offsetS16(i) { return (_imm(i) << 16) >> 16; }   // treat immediate value as signed
function _offsetU16(i) { return i & 0xffff; }

function _branchAddress(a, i) { return (a + 4) + (_imms(i) * 4); }
function _jumpAddress(a, i) { return (a & 0xf0000000) | (_target(i) * 4); }

function _vbase(i) { return (i >>> 21) & 0x1f; }
function _voffset(i) { return ((i & 0x7f) << 25) >> 25; }


function makeLabelText(address) {
  //return `<span class="dis-address-jump">${toHex(address, 32)}</span>`;
  return toHex(address, 32);
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
  'VCO', 'VCC', 'VCE', '?',
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

  // Vector element.
  get ve() { return `E${_ve(this.opcode)}`; }
  // Vector register.
  get vd() { return `V${_vd(this.opcode)}`; }
  get vt() { return `V${_vt(this.opcode)}`; }
  get vs() { return `V${_vs(this.opcode)}`; }

  get c2flag() { return c2ControlNames[_rd(this.opcode) & 0x3]; }

  get sa() { return _sa(this.opcode); }

  gprName(opFn) {
    return gprNames[opFn(this.opcode)];
  }

  // dummy operand - just marks ra as being a dest reg
  writesRA() { this.dstRegs[RA] = 1; return ''; }

  get imm() { return `0x${toHex(_imm(this.opcode), 16)}`; }

  get branchAddress() { this.target = _branchAddress(this.address, this.opcode); return makeLabelText(this.target); }
  get jumpAddress() { this.target = _jumpAddress(this.address, this.opcode); return makeLabelText(this.target); }

  get base() { const reg = this.gprName(_base); this.srcRegs[reg] = 1; return makeRegSpan(reg); }
  get offsetU16() { return `0x${toHex(_offsetU16(this.opcode), 16)}`; }
  get offsetS16() { return `0x${toHex(_offsetS16(this.opcode), 16)}`; }
  memaccess(mode) {
    this.memory = { reg: _base(this.opcode), offset: _offsetS16(this.opcode), mode: mode };
    return `[${this.base}+${this.offsetU16}]`;
  }
  memload() { return this.memaccess('load'); }
  memstore() { return this.memaccess('store'); }

  get vbase() { const reg = this.gprName(_vbase); this.srcRegs[reg] = 1; return makeRegSpan(reg); }
  scaleVOffset(scale) { const off = _voffset(this.opcode) * scale; return (off >= 0 ? '+' : '') + off.toString(); }

  vmemaccess(mode, scale) {
    scale = scale || 1;
    this.memory = { reg: _vbase(this.opcode), offset: _voffset(this.opcode) * scale, mode: mode };
    return `[${this.vbase}${this.scaleVOffset(scale)}]`;
  }
  vmemload(scale) { return this.vmemaccess('load', scale); }
  vmemstore(scale) { return this.vmemaccess('store', scale); }
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
  tbl[0] = i => `MFC2      ${i.rt_d} = ${i.vs}[${i.ve}]`;
  tbl[2] = i => `CFC2      ${i.rt_d} = ${i.c2flag}`;
  tbl[4] = i => `MTC2      ${i.vs}[${i.ve}] = ${i.rt}`;
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
  tbl[0] = i => `VMULF`;
  tbl[1] = i => `VMULU`;
  tbl[3] = i => `VRNDP`;
  tbl[3] = i => `VMULQ`;
  tbl[4] = i => `VMUDL`;
  tbl[5] = i => `VMUDM`;
  tbl[6] = i => `VMUDN`;
  tbl[7] = i => `VMUDH`;
  tbl[8] = i => `VMACF`;
  tbl[9] = i => `VMACU`;
  tbl[10] = i => `VRNDN`;
  tbl[11] = i => `VMACQ`;
  tbl[12] = i => `VMADL`;
  tbl[13] = i => `VMADM`;
  tbl[14] = i => `VMADN`;
  tbl[15] = i => `VMADH`;
  tbl[16] = i => `VADD`;
  tbl[17] = i => `VSUB`;
  tbl[18] = i => `VSUT`;
  tbl[19] = i => `VABS`;
  tbl[20] = i => `VADDC`;
  tbl[21] = i => `VSUBC`;
  tbl[22] = i => `VADDB`;
  tbl[23] = i => `VSUBB`;
  tbl[24] = i => `VACCB`;
  tbl[25] = i => `VSUCB`;
  tbl[26] = i => `VSAD`;
  tbl[27] = i => `VSAC`;
  tbl[28] = i => `VSUM`;
  tbl[29] = i => `VSAR`;
  tbl[30] = i => `V30`;
  tbl[31] = i => `V31`;
  tbl[32] = i => `VLT`;
  tbl[33] = i => `VEQ`;
  tbl[34] = i => `VNE`;
  tbl[35] = i => `VGE`;
  tbl[36] = i => `VCL`;
  tbl[37] = i => `VCH`;
  tbl[38] = i => `VCR`;
  tbl[39] = i => `VMRG`;
  tbl[40] = i => `VAND`;
  tbl[41] = i => `VNAND`;
  tbl[42] = i => `VOR`;
  tbl[43] = i => `VNOR`;
  tbl[44] = i => `VXOR`;
  tbl[45] = i => `VNXOR`;
  tbl[46] = i => `V46`;
  tbl[47] = i => `V47`;
  tbl[48] = i => `VRCP`;
  tbl[49] = i => `VRCPL`;
  tbl[50] = i => `VRCPH`;
  tbl[51] = i => `VMOV`;
  tbl[52] = i => `VRSQ`;
  tbl[53] = i => `VRSQL`;
  tbl[54] = i => `VRSQH`;
  tbl[55] = i => `VNOP`;
  tbl[56] = i => `VEXTT`;
  tbl[57] = i => `VEXTQ`;
  tbl[58] = i => `VEXTN`;
  tbl[59] = i => `V59`;
  tbl[60] = i => `VINST`;
  tbl[61] = i => `VINSQ`;
  tbl[62] = i => `VINSN`;
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
  tbl[0] = i => `LBV       ${i.vt} <- ${i.vmemload(1)}`;
  tbl[1] = i => `LSV       ${i.vt} <- ${i.vmemload(2)}`;
  tbl[2] = i => `LLV       ${i.vt} <- ${i.vmemload(4)}`;
  tbl[3] = i => `LDV       ${i.vt} <- ${i.vmemload(8)}`;
  tbl[4] = i => `LQV       ${i.vt} <- ${i.vmemload(16)}`;
  tbl[5] = i => `LRV       ${i.vt} <- ${i.vmemload(16)}`;
  tbl[6] = i => `LPV       ${i.vt} <- ${i.vmemload(8)}`;
  tbl[7] = i => `LUV       ${i.vt} <- ${i.vmemload(8)}`;
  tbl[8] = i => `LHV       ${i.vt} <- ${i.vmemload(16)}`;
  tbl[9] = i => `LFV       ${i.vt} <- ${i.vmemload(16)}`;
  tbl[10] = i => `LWV       ${i.vt} <- ${i.vmemload(16)}`;
  tbl[11] = i => `LTV       ${i.vt} <- ${i.vmemload(16)}`;

  return tbl;
})();

const sc2Table = (() => {
  let tbl = [];
  for (let i = 0; i < 32; i++) {
    tbl.push(disassembleUnknown);
  }

  // TODO: flesh these out.
  tbl[0] = i => `SBV       ${i.vt} -> ${i.vmemstore(1)}`;
  tbl[1] = i => `SSV       ${i.vt} -> ${i.vmemstore(2)}`;
  tbl[2] = i => `SLV       ${i.vt} -> ${i.vmemstore(4)}`;
  tbl[3] = i => `SDV       ${i.vt} -> ${i.vmemstore(8)}`;
  tbl[4] = i => `SQV       ${i.vt} -> ${i.vmemstore(16)}`;
  tbl[5] = i => `SRV       ${i.vt} -> ${i.vmemstore(16)}`;
  tbl[6] = i => `SPV       ${i.vt} -> ${i.vmemstore(8)}`;
  tbl[7] = i => `SUV       ${i.vt} -> ${i.vmemstore(8)}`;
  tbl[8] = i => `SHV       ${i.vt} -> ${i.vmemstore(16)}`;
  tbl[9] = i => `SFV       ${i.vt} -> ${i.vmemstore(16)}`;
  tbl[10] = i => `SWV       ${i.vt} -> ${i.vmemstore(16)}`;
  tbl[11] = i => `STV       ${i.vt} -> ${i.vmemstore(16)}`;

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

export function disassembleRange(beginAddr, endAddr) {
  const hw = n64js.hardware();
  const imem = new DataView(hw.sp_mem.arrayBuffer, 0x1000, 0x1000);

  const disassembly = [];
  const targets = new Set();

  for (let addr = beginAddr; addr < endAddr; addr += 4) {
    const instruction = imem.getUint32(addr);
    const d = disassembleInstruction(addr, instruction);
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
