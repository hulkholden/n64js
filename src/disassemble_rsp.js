import { toString32, toHex } from "./format.js";

function _offset(i) { return (i) & 0xffff; }
function _sa(i) { return (i >>> 6) & 0x1f; }
function _rd(i) { return (i >>> 11) & 0x1f; }
function _rt(i) { return (i >>> 16) & 0x1f; }
function _rs(i) { return (i >>> 21) & 0x1f; }
function _op(i) { return (i >>> 26) & 0x3f; }

function _tlbop(i) { return i & 0x3f; }
function _cop1_func(i) { return i & 0x3f; }
function _cop1_bc(i) { return (i >>> 16) & 0x3; }

function _target(i) { return (i) & 0x3ffffff; }
function _imm(i) { return (i) & 0xffff; }
function _imms(i) { return (_imm(i) << 16) >> 16; }   // treat immediate value as signed
function _base(i) { return (i >>> 21) & 0x1f; }

function _branchAddress(a, i) { return (a + 4) + (_imms(i) * 4); }
function _jumpAddress(a, i) { return (a & 0xf0000000) | (_target(i) * 4); }

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

  get rt_d() { const reg = this.gprName(_rt); this.dstRegs[reg] = 1; return makeRegSpan(reg); }
  get rd() { const reg = this.gprName(_rd); this.dstRegs[reg] = 1; return makeRegSpan(reg); }
  get rt() { const reg = this.gprName(_rt); this.srcRegs[reg] = 1; return makeRegSpan(reg); }
  get rs() { const reg = this.gprName(_rs); this.srcRegs[reg] = 1; return makeRegSpan(reg); }

  get sa() { return _sa(this.opcode); }

  gprName(opFn) {
    return gprNames[opFn(this.opcode)];
  }

  // dummy operand - just marks ra as being a dest reg
  writesRA() { this.dstRegs[cpu0_constants.RA] = 1; return ''; }

  get imm() { return `0x${toHex(_imm(this.opcode), 16)}`; }

  get branchAddress() { this.target = _branchAddress(this.address, this.opcode); return makeLabelText(this.target); }
  get jumpAddress() { this.target = _jumpAddress(this.address, this.opcode); return makeLabelText(this.target); }

  memaccess(mode) {
    const r = this.rs;
    const off = this.imm;
    this.memory = { reg: _rs(this.opcode), offset: _imms(this.opcode), mode: mode };
    return `[${r}+${off}]`;
  }

  memload() { return this.memaccess('load'); }
  memstore() { return this.memaccess('store'); }
}

const specialTable = (() => {
  let tbl = [];
  for (let i = 0; i < 64; i++) {
    tbl[i] = disassembleUnknown;
  }

  tbl[0] = i => {
    if (i.opcode === 0) {
      return 'NOP';
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
    tbl[i] = disassembleUnknown;
  }

  tbl[0] = i => `BLTZ      ${i.rs} < 0 --> ${i.branchAddress}`;
  tbl[1] = i => `BGEZ      ${i.rs} >= 0 --> ${i.branchAddress}`;
  tbl[16] = i => `BLTZAL    ${i.rs} < 0 --> ${i.branchAddress}${i.writesRA()}`;
  tbl[17] = i => `BGEZAL    ${i.rs} >= 0 --> ${i.branchAddress}${i.writesRA()}`;
  return tbl;
})();

const simpleTable = (() => {
  let tbl = [];
  for (let i = 0; i < 64; i++) {
    tbl[i] = disassembleUnknown;
  }

  tbl[0] = disassembleSpecial;
  tbl[1] = disassembleRegImm;
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
  tbl[16] = i => `Cop0`;
  tbl[18] = i => `Cop2`;
  tbl[32] = i => `LB        ${i.rt_d} <- ${i.memload()}`;
  tbl[33] = i => `LH        ${i.rt_d} <- ${i.memload()}`;
  tbl[35] = i => `LW        ${i.rt_d} <- ${i.memload()}`;
  tbl[36] = i => `LBU       ${i.rt_d} <- ${i.memload()}`;
  tbl[37] = i => `LHU       ${i.rt_d} <- ${i.memload()}`;
  tbl[39] = i => `LWU       ${i.rt_d} <- ${i.memload()}`;
  tbl[40] = i => `SB        ${i.rt} -> ${i.memstore()}`;
  tbl[41] = i => `SH        ${i.rt} -> ${i.memstore()}`;
  tbl[43] = i => `SW        ${i.rt} -> ${i.memstore()}`;
  tbl[50] = i => `LC2`;
  tbl[58] = i => `SC2`;
  return tbl;
})();


function disassembleSpecial(i) {
  var fn = i.opcode & 0x3f;
  return specialTable[fn](i);
}

function disassembleRegImm(i) {
  var rt = (i.opcode >> 16) & 0x1f;
  return regImmTable[rt](i);
}

function disassembleUnknown(i) {
  return `unknown: ${toString32(i)}`;
}

export function disassembleInstruction(address, instruction) {
  const i = new Instruction(address, instruction);
  const disassembly = simpleTable[_op(instruction)](i);
  return {
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
