import { assert } from './assert.js';
import * as cpu0_constants from './cpu0_constants.js';
import { toHex } from './format.js';

window.n64js = window.n64js || {};

function _fd(i) { return (i >>> 6) & 0x1f; }
function _fs(i) { return (i >>> 11) & 0x1f; }
function _ft(i) { return (i >>> 16) & 0x1f; }
function _copop(i) { return (i >>> 21) & 0x1f; }

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
  return `<span class="dis-address-jump">${toHex(address, 32)}</span>`;
}

export const cop0gprNames = [
  'r0', 'at', 'v0', 'v1', 'a0', 'a1', 'a2', 'a3',
  't0', 't1', 't2', 't3', 't4', 't5', 't6', 't7',
  's0', 's1', 's2', 's3', 's4', 's5', 's6', 's7',
  't8', 't9', 'k0', 'k1', 'gp', 'sp', 's8', 'ra'
];

export const cop0ControlRegisterNames = [
  "Index", "Rand", "EntryLo0", "EntryLo1", "Context", "PageMask", "Wired", "?7",
  "BadVAddr", "Count", "EntryHi", "Compare", "SR", "Cause", "EPC", "PrID",
  "Config", "LLAddr", "WatchLo", "WatchHi", "XContext", "?21", "?22", "?23",
  "?24", "?25", "ECC", "CacheErr", "TagLo", "TagHi", "ErrorEPC", "?31"
];

export const cop1RegisterNames = [
  'f00', 'f01', 'f02', 'f03', 'f04', 'f05', 'f06', 'f07',
  'f08', 'f09', 'f10', 'f11', 'f12', 'f13', 'f14', 'f15',
  'f16', 'f17', 'f18', 'f19', 'f20', 'f21', 'f22', 'f23',
  'f24', 'f25', 'f26', 'f27', 'f28', 'f29', 'f30', 'f31'
];

export const cop2RegisterNames = [
  'GR00', 'GR01', 'GR02', 'GR03', 'GR04', 'GR05', 'GR06', 'GR07',
  'GR08', 'GR09', 'GR10', 'GR11', 'GR12', 'GR13', 'GR14', 'GR15',
  'GR16', 'GR17', 'GR18', 'GR19', 'GR20', 'GR21', 'GR22', 'GR23',
  'GR24', 'GR25', 'GR26', 'GR27', 'GR28', 'GR29', 'GR30', 'GR31'
];

class Instruction {
  constructor(address, opcode) {
    this.address = address;
    this.opcode = opcode;
    this.srcRegs = {};
    this.dstRegs = {};
    this.target = '';
    this.memory = null;
  }

  // TODO: make these getters to avoid the parens in the formatting strings.
  // cop0 regs
  get rt_d() { const reg = this.cop0RegName(_rt); this.dstRegs[reg] = 1; return makeRegSpan(reg); }
  get rd() { const reg = this.cop0RegName(_rd); this.dstRegs[reg] = 1; return makeRegSpan(reg); }
  get rt() { const reg = this.cop0RegName(_rt); this.srcRegs[reg] = 1; return makeRegSpan(reg); }
  get rs() { const reg = this.cop0RegName(_rs); this.srcRegs[reg] = 1; return makeRegSpan(reg); }

  get sa() { return _sa(this.opcode); }

  cop0RegName(opFn) {
    return cop0gprNames[opFn(this.opcode)];
  }

  // dummy operand - just marks ra as being a dest reg
  writesRA() { this.dstRegs[cpu0_constants.RA] = 1; return ''; }

  // cop1 regs
  ft_d(fmt) { const reg = this.cop1RegName(_ft, fmt); this.dstRegs[reg] = 1; return makeFPRegSpan(reg); }
  fs_d(fmt) { const reg = this.cop1RegName(_fs, fmt); this.dstRegs[reg] = 1; return makeFPRegSpan(reg); }
  fd(fmt) { const reg = this.cop1RegName(_fd, fmt); this.dstRegs[reg] = 1; return makeFPRegSpan(reg); }
  ft(fmt) { const reg = this.cop1RegName(_ft, fmt); this.srcRegs[reg] = 1; return makeFPRegSpan(reg); }
  fs(fmt) { const reg = this.cop1RegName(_fs, fmt); this.srcRegs[reg] = 1; return makeFPRegSpan(reg); }

  cop1RegName(opFn, fmt) {
    const regIdx = opFn(this.opcode);
    const suffix = fmt ? `-${fmt}` : '';
    return cop1RegisterNames[regIdx] + suffix;
  }

  // cop2 regs
  get gt_d() { const reg = this.cop2RegName(_rt); this.dstRegs[reg] = 1; return makeRegSpan(reg); }
  get gd() { const reg = this.cop2RegName(_rd); this.dstRegs[reg] = 1; return makeRegSpan(reg); }
  get gt() { const reg = this.cop2RegName(_rt); this.srcRegs[reg] = 1; return makeRegSpan(reg); }
  get gs() { const reg = this.cop2RegName(_rs); this.srcRegs[reg] = 1; return makeRegSpan(reg); }

  cop2RegName(opFn) {
    return cop2RegisterNames[opFn(this.opcode)];
  }

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

function makeRegSpan(t) {
  return `<span class="dis-reg-${t}">${t}</span>`;
}

function makeFPRegSpan(t) {
  // We only use the '-' as a valic css identifier, but want to use '.' in the visible text
  const text = t.replace('-', '.');
  return `<span class="dis-reg-${t}">${text}</span>`;
}

const specialTable = [
  i => {
    if (i.opcode === 0) {
      return 'NOP';
    }
    return `SLL       ${i.rd} = ${i.rt} << ${i.sa}`;
  },
  i => 'Unk',
  i => `SRL       ${i.rd} = ${i.rt} >>> ${i.sa}`,
  i => `SRA       ${i.rd} = ${i.rt} >> ${i.sa}`,
  i => `SLLV      ${i.rd} = ${i.rt} << ${i.rs}`,
  i => 'Unk',
  i => `SRLV      ${i.rd} = ${i.rt} >>> ${i.rs}`,
  i => `SRAV      ${i.rd} = ${i.rt} >> ${i.rs}`,
  i => `JR        ${i.rs}`,
  i => `JALR      ${i.rd}, ${i.rs}`,
  i => 'Unk',
  i => 'Unk',
  i => `SYSCALL   ${toHex((i.opcode >> 6) & 0xfffff, 20)}`,
  i => `BREAK     ${toHex((i.opcode >> 6) & 0xfffff, 20)}`,
  i => 'Unk',
  i => 'SYNC',
  i => `MFHI      ${i.rd} = MultHi`,
  i => `MTHI      MultHi = ${i.rs}`,
  i => `MFLO      ${i.rd} = MultLo`,
  i => `MTLO      MultLo = ${i.rs}`,
  i => `DSLLV     ${i.rd} = ${i.rt} << ${i.rs}`,
  i => 'Unk',
  i => `DSRLV     ${i.rd} = ${i.rt} >>> ${i.rs}`,
  i => `DSRAV     ${i.rd} = ${i.rt} >> ${i.rs}`,
  i => `MULT      ${i.rs} * ${i.rt}`,
  i => `MULTU     ${i.rs} * ${i.rt}`,
  i => `DIV       ${i.rs} / ${i.rt}`,
  i => `DIVU      ${i.rs} / ${i.rt}`,
  i => `DMULT     ${i.rs} * ${i.rt}`,
  i => `DMULTU    ${i.rs} * ${i.rt}`,
  i => `DDIV      ${i.rs} / ${i.rt}`,
  i => `DDIVU     ${i.rs} / ${i.rt}`,
  i => `ADD       ${i.rd} = ${i.rs} + ${i.rt}`,
  i => `ADDU      ${i.rd} = ${i.rs} + ${i.rt}`,
  i => `SUB       ${i.rd} = ${i.rs} - ${i.rt}`,
  i => `SUBU      ${i.rd} = ${i.rs} - ${i.rt}`,
  i => `AND       ${i.rd} = ${i.rs} & ${i.rt}`,
  i => {
    if (_rt(i.opcode) === 0) {
      if (_rs(i.opcode) === 0) {
        return `CLEAR     ${i.rd} = 0`;
      } else {
        return `MOV       ${i.rd} = ${i.rs}`;
      }
    }
    return `OR        ${i.rd} = ${i.rs} | ${i.rt}`;
  },
  i => `XOR       ${i.rd} = ${i.rs} ^ ${i.rt}`,
  i => `NOR       ${i.rd} = ~( ${i.rs} | ${i.rt} )`,
  i => 'Unk',
  i => 'Unk',
  i => `SLT       ${i.rd} = ${i.rs} < ${i.rt}`,
  i => `SLTU      ${i.rd} = ${i.rs} < ${i.rt}`,
  i => `DADD      ${i.rd} = ${i.rs} + ${i.rt}`,
  i => `DADDU     ${i.rd} = ${i.rs} + ${i.rt}`,
  i => `DSUB      ${i.rd} = ${i.rs} - ${i.rt}`,
  i => `DSUBU     ${i.rd} = ${i.rs} - ${i.rt}`,
  i => `TGE       trap( ${i.rs} >= ${i.rt} )`,
  i => `TGEU      trap( ${i.rs} >= ${i.rt} )`,
  i => `TLT       trap( ${i.rs} < ${i.rt} )`,
  i => `TLTU      trap( ${i.rs} < ${i.rt} )`,
  i => `TEQ       trap( ${i.rs} == ${i.rt} )`,
  i => 'Unk',
  i => `TNE       trap( ${i.rs} != ${i.rt} )`,
  i => 'Unk',
  i => `DSLL      ${i.rd} = ${i.rt} << ${i.sa}`,
  i => 'Unk',
  i => `DSRL      ${i.rd} = ${i.rt} >>> ${i.sa}`,
  i => `DSRA      ${i.rd} = ${i.rt} >> ${i.sa}`,
  i => `DSLL32    ${i.rd} = ${i.rt} << (32+${i.sa})`,
  i => 'Unk',
  i => `DSRL32    ${i.rd} = ${i.rt} >>> (32+${i.sa})`,
  i => `DSRA32    ${i.rd} = ${i.rt} >> (32+${i.sa})`,
];
if (specialTable.length != 64) {
  throw "Oops, didn't build the special table correctly";
}

function disassembleSpecial(i) {
  var fn = i.opcode & 0x3f;
  return specialTable[fn](i);
}

const cop0Table = [
  i => `MFC0      ${i.rt} <- ${cop0ControlRegisterNames[_fs(i.opcode)]}`,
  i => `DMFC0     ${i.rt} <- ${cop0ControlRegisterNames[_fs(i.opcode)]}`,
  i => 'Unk',
  i => 'Unk',
  i => `MTC0      ${i.rt} -> ${cop0ControlRegisterNames[_fs(i.opcode)]}`,
  i => `DMTC0     ${i.rt} -> ${cop0ControlRegisterNames[_fs(i.opcode)]}`,
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',

  disassembleTLB,
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',
];
if (cop0Table.length != 32) {
  throw "Oops, didn't build the cop0 table correctly";
}
function disassembleCop0(i) {
  var fmt = (i.opcode >> 21) & 0x1f;
  return cop0Table[fmt](i);
}

function disassembleBCInstr(i) {
  assert(((i.opcode >>> 18) & 0x7) === 0, "cc bit is not 0");

  switch (_cop1_bc(i.opcode)) {
    case 0: return `BC1F      !c ? --> ${i.branchAddress}`;
    case 1: return `BC1T      c ? --> ${i.branchAddress}`;
    case 2: return `BC1FL     !c ? --> ${i.branchAddress}`;
    case 3: return `BC1TL     c ? --> ${i.branchAddress}`;
  }

  return '???';
}

function disassembleCop1Instr(i, fmt) {
  var fmt_u = fmt.toUpperCase();

  switch (_cop1_func(i.opcode)) {
    case 0x00: return `ADD.${fmt_u}     ${i.fd(fmt)} = ${i.fs(fmt)} + ${i.ft(fmt)}`;
    case 0x01: return `SUB.${fmt_u}     ${i.fd(fmt)} = ${i.fs(fmt)} - ${i.ft(fmt)}`;
    case 0x02: return `MUL.${fmt_u}     ${i.fd(fmt)} = ${i.fs(fmt)} * ${i.ft(fmt)}`;
    case 0x03: return `DIV.${fmt_u}     ${i.fd(fmt)} = ${i.fs(fmt)} / ${i.ft(fmt)}`;
    case 0x04: return `SQRT.${fmt_u}    ${i.fd(fmt)} = sqrt(${i.fs(fmt)})`;
    case 0x05: return `ABS.${fmt_u}     ${i.fd(fmt)} = abs(${i.fs(fmt)})`;
    case 0x06: return `MOV.${fmt_u}     ${i.fd(fmt)} = ${i.fs(fmt)}`;
    case 0x07: return `NEG.${fmt_u}     ${i.fd(fmt)} = -${i.fs(fmt)}`;
    case 0x08: return `ROUND.L.${fmt_u} ${i.fd('l')} = round.l(${i.fs(fmt)})`;
    case 0x09: return `TRUNC.L.${fmt_u} ${i.fd('l')} = trunc.l(${i.fs(fmt)})`;
    case 0x0a: return `CEIL.L.${fmt_u}  ${i.fd('l')} = ceil.l(${i.fs(fmt)})`;
    case 0x0b: return `FLOOR.L.${fmt_u} ${i.fd('l')} = floor.l(${i.fs(fmt)})`;
    case 0x0c: return `ROUND.W.${fmt_u} ${i.fd('w')} = round.w(${i.fs(fmt)})`;
    case 0x0d: return `TRUNC.W.${fmt_u} ${i.fd('w')} = trunc.w(${i.fs(fmt)})`;
    case 0x0e: return `CEIL.W.${fmt_u}  ${i.fd('w')} = ceil.w(${i.fs(fmt)})`;
    case 0x0f: return `FLOOR.W.${fmt_u} ${i.fd('w')} = floor.w(${i.fs(fmt)})`;

    case 0x20: return `CVT.S.${fmt_u}   ${i.fd('s')} = (s)${i.fs(fmt)}`;
    case 0x21: return `CVT.D.${fmt_u}   ${i.fd('d')} = (d)${i.fs(fmt)}`;
    case 0x24: return `CVT.W.${fmt_u}   ${i.fd('w')} = (w)${i.fs(fmt)}`;
    case 0x25: return `CVT.L.${fmt_u}   ${i.fd('l')} = (l)${i.fs(fmt)}`;

    case 0x30: return `C.F.${fmt_u}     c = ${i.fs(fmt)} cmp ${i.ft(fmt)}`;
    case 0x31: return `C.UN.${fmt_u}    c = ${i.fs(fmt)} cmp ${i.ft(fmt)}`;
    case 0x32: return `C.EQ.${fmt_u}    c = ${i.fs(fmt)} cmp ${i.ft(fmt)}`;
    case 0x33: return `C.UEQ.${fmt_u}   c = ${i.fs(fmt)} cmp ${i.ft(fmt)}`;
    case 0x34: return `C.OLT.${fmt_u}   c = ${i.fs(fmt)} cmp ${i.ft(fmt)}`;
    case 0x35: return `C.ULT.${fmt_u}   c = ${i.fs(fmt)} cmp ${i.ft(fmt)}`;
    case 0x36: return `C.OLE.${fmt_u}   c = ${i.fs(fmt)} cmp ${i.ft(fmt)}`;
    case 0x37: return `C.ULE.${fmt_u}   c = ${i.fs(fmt)} cmp ${i.ft(fmt)}`;
    case 0x38: return `C.SF.${fmt_u}    c = ${i.fs(fmt)} cmp ${i.ft(fmt)}`;
    case 0x39: return `C.NGLE.${fmt_u}  c = ${i.fs(fmt)} cmp ${i.ft(fmt)}`;
    case 0x3a: return `C.SEQ.${fmt_u}   c = ${i.fs(fmt)} cmp ${i.ft(fmt)}`;
    case 0x3b: return `C.NGL.${fmt_u}   c = ${i.fs(fmt)} cmp ${i.ft(fmt)}`;
    case 0x3c: return `C.LT.${fmt_u}    c = ${i.fs(fmt)} cmp ${i.ft(fmt)}`;
    case 0x3d: return `C.NGE.${fmt_u}   c = ${i.fs(fmt)} cmp ${i.ft(fmt)}`;
    case 0x3e: return `C.LE.${fmt_u}    c = ${i.fs(fmt)} cmp ${i.ft(fmt)}`;
    case 0x3f: return `C.NGT.${fmt_u}   c = ${i.fs(fmt)} cmp ${i.ft(fmt)}`;
  }

  return `Cop1.${fmt}${toHex(_cop1_func(i.opcode), 8)}?`;
}
function disassembleCop1SInstr(i) {
  return disassembleCop1Instr(i, 's');
}
function disassembleCop1DInstr(i) {
  return disassembleCop1Instr(i, 'd');
}
function disassembleCop1WInstr(i) {
  return disassembleCop1Instr(i, 'w');
}
function disassembleCop1LInstr(i) {
  return disassembleCop1Instr(i, 'l');
}


const cop1Table = [
  i => `MFC1      ${i.rt_d} = ${i.fs()}`,
  i => `DMFC1     ${i.rt_d} = ${i.fs()}`,
  i => `CFC1      ${i.rt_d} = CCR${_rd(i.opcode)}`,
  i => 'Unk',
  i => `MTC1      ${i.fs_d()} = ${i.rt}`,
  i => `DMTC1     ${i.fs_d()} = ${i.rt}`,
  i => `CTC1      CCR${_rd(i.opcode)} = ${i.rt}`,
  i => 'Unk',
  disassembleBCInstr,
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',

  disassembleCop1SInstr,
  disassembleCop1DInstr,
  i => 'Unk',
  i => 'Unk',
  disassembleCop1WInstr,
  disassembleCop1LInstr,
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',
];
if (cop1Table.length != 32) {
  throw "Oops, didn't build the cop1 table correctly";
}
function disassembleCop1(i) {
  var fmt = (i.opcode >> 21) & 0x1f;
  return cop1Table[fmt](i);
}


function disassembleTLB(i) {
  switch (_tlbop(i.opcode)) {
    case 0x01: return 'TLBR';
    case 0x02: return 'TLBWI';
    case 0x06: return 'TLBWR';
    case 0x08: return 'TLBP';
    case 0x18: return 'ERET';
  }

  return 'Unk';
}

const regImmTable = [
  i => `BLTZ      ${i.rs} < 0 --> ${i.branchAddress}`,
  i => `BGEZ      ${i.rs} >= 0 --> ${i.branchAddress}`,
  i => `BLTZL     ${i.rs} < 0 --> ${i.branchAddress}`,
  i => `BGEZL     ${i.rs} >= 0 --> ${i.branchAddress}`,
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',

  i => `TGEI      ${i.rs} >= ${i.rt} --> trap `,
  i => `TGEIU     ${i.rs} >= ${i.rt} --> trap `,
  i => `TLTI      ${i.rs} < ${i.rt} --> trap `,
  i => `TLTIU     ${i.rs} < ${i.rt} --> trap `,
  i => `TEQI      ${i.rs} == ${i.rt} --> trap `,
  i => 'Unk',
  i => `TNEI      ${i.rs} != ${i.rt} --> trap `,
  i => 'Unk',

  i => `BLTZAL    ${i.rs} < 0 --> ${i.branchAddress}${i.writesRA()}`,
  i => `BGEZAL    ${i.rs} >= 0 --> ${i.branchAddress}${i.writesRA()}`,
  i => `BLTZALL   ${i.rs} < 0 --> ${i.branchAddress}${i.writesRA()}`,
  i => `BGEZALL   ${i.rs} >= 0 --> ${i.branchAddress}${i.writesRA()}`,
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',
];
if (regImmTable.length != 32) {
  throw "Oops, didn't build the special table correctly";
}

function disassembleRegImm(i) {
  var rt = (i.opcode >> 16) & 0x1f;
  return regImmTable[rt](i);
}

const simpleTable = [
  disassembleSpecial,
  disassembleRegImm,
  i => `J         --> ${i.jumpAddress}`,
  i => `JAL       --> ${i.jumpAddress}${i.writesRA()}`,
  i => {
    if (_rs(i.opcode) == _rt(i.opcode)) {
      return `B         --> ${i.branchAddress}`;
    }
    return `BEQ       ${i.rs} == ${i.rt} --> ${i.branchAddress}`;
  },
  i => `BNE       ${i.rs} != ${i.rt} --> ${i.branchAddress}`,
  i => `BLEZ      ${i.rs} <= 0 --> ${i.branchAddress}`,
  i => `BGTZ      ${i.rs} > 0 --> ${i.branchAddress}`,
  i => `ADDI      ${i.rt_d} = ${i.rs} + ${i.imm}`,
  i => `ADDIU     ${i.rt_d} = ${i.rs} + ${i.imm}`,
  i => `SLTI      ${i.rt_d} = (${i.rs} < ${i.imm})`,
  i => `SLTIU     ${i.rt_d} = (${i.rs} < ${i.imm})`,
  i => `ANDI      ${i.rt_d} = ${i.rs} & ${i.imm}`,
  i => `ORI       ${i.rt_d} = ${i.rs} | ${i.imm}`,
  i => `XORI      ${i.rt_d} = ${i.rs} ^ ${i.imm}`,
  i => `LUI       ${i.rt_d} = ${i.imm} << 16`,
  disassembleCop0,
  disassembleCop1,
  i => 'cop2 Unk',
  i => 'cop3 Unk',
  i => `BEQL      ${i.rs} == ${i.rt} --> ${i.branchAddress}`,
  i => `BNEL      ${i.rs} != ${i.rt} --> ${i.branchAddress}`,
  i => `BLEZL     ${i.rs} <= 0 --> ${i.branchAddress}`,
  i => `BGTZL     ${i.rs} > 0 --> ${i.branchAddress}`,
  i => `DADDI     ${i.rt_d} = ${i.rs} + ${i.imm}`,
  i => `DADDIU    ${i.rt_d} = ${i.rs} + ${i.imm}`,
  i => `LDL       ${i.rt_d} <- ${i.memload()}`,
  i => `LDR       ${i.rt_d} <- ${i.memload()}`,
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',
  i => 'Unk',
  i => `LB        ${i.rt_d} <- ${i.memload()}`,
  i => `LH        ${i.rt_d} <- ${i.memload()}`,
  i => `LWL       ${i.rt_d} <- ${i.memload()}`,
  i => `LW        ${i.rt_d} <- ${i.memload()}`,
  i => `LBU       ${i.rt_d} <- ${i.memload()}`,
  i => `LHU       ${i.rt_d} <- ${i.memload()}`,
  i => `LWR       ${i.rt_d} <- ${i.memload()}`,
  i => `LWU       ${i.rt_d} <- ${i.memload()}`,
  i => `SB        ${i.rt} -> ${i.memstore()}`,
  i => `SH        ${i.rt} -> ${i.memstore()}`,
  i => `SWL       ${i.rt} -> ${i.memstore()}`,
  i => `SW        ${i.rt} -> ${i.memstore()}`,
  i => `SDL       ${i.rt} -> ${i.memstore()}`,
  i => `SDR       ${i.rt} -> ${i.memstore()}`,
  i => `SWR       ${i.rt} -> ${i.memstore()}`,
  i => `CACHE     ${toHex(_rt(i.opcode), 8)}, ${i.memaccess()}`,
  i => `LL        ${i.rt_d} <- ${i.memload()}`,
  i => `LWC1      ${i.ft_d()} <- ${i.memload()}`,
  i => 'Unk',
  i => 'Unk',
  i => `LLD       ${i.rt_d} <- ${i.memload()}`,
  i => `LDC1      ${i.ft_d()} <- ${i.memload()}`,
  i => `LDC2      ${i.gt_d} <- ${i.memload()}`,
  i => `LD        ${i.rt_d} <- ${i.memload()}`,
  i => `SC        ${i.rt} -> ${i.memstore()}`,
  i => `SWC1      ${i.ft()} -> ${i.memstore()}`,
  i => 'BREAKPOINT',
  i => 'Unk',
  i => `SCD       ${i.rt} -> ${i.memstore()}`,
  i => `SDC1      ${i.ft()} -> ${i.memstore()}`,
  i => `SDC2      ${i.gt} -> ${i.memstore()}`,
  i => `SD        ${i.rt} -> ${i.memstore()}`,
];
if (simpleTable.length != 64) {
  throw "Oops, didn't build the simple table correctly";
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
  const disassembly = [];
  const targets = new Set();

  for (let addr = beginAddr; addr < endAddr; addr += 4) {
    const instruction = n64js.getInstruction(addr);
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
