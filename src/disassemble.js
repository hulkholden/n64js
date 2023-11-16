/*global n64js*/

import { assert } from './assert.js';
import * as cpu0reg from './cpu0reg.js';
import { toHex } from './format.js';
import { simpleOp, regImmOp, specialOp, copOp, cop1BCOp, copFmtFuncOp, fd, fs, ft, offset, sa, rd, rt, rs, tlbop, imm, base, branchAddress, jumpAddress } from './decode.js';

window.n64js = window.n64js || {};

function offsetU16(i) { return offset(i) & 0xffff; }
function offsetS16(i) { return (offset(i) << 16) >> 16; }   // treat immediate value as signed

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
  constructor(address, opcode, outputHTML) {
    this.address = address;
    this.opcode = opcode;
    this.srcRegs = {};
    this.dstRegs = {};
    this.target = '';
    this.memory = null;
    this.outputHTML = outputHTML;
  }

  get rt_d() { const reg = this.cop0RegName(rt); this.dstRegs[reg] = 1; return this.makeRegSpan(reg); }
  get rd() { const reg = this.cop0RegName(rd); this.dstRegs[reg] = 1; return this.makeRegSpan(reg); }
  get rt() { const reg = this.cop0RegName(rt); this.srcRegs[reg] = 1; return this.makeRegSpan(reg); }
  get rs() { const reg = this.cop0RegName(rs); this.srcRegs[reg] = 1; return this.makeRegSpan(reg); }

  get sa() { return sa(this.opcode); }

  cop0RegName(opFn) {
    return cop0gprNames[opFn(this.opcode)];
  }

  // dummy operand - just marks ra as being a dest reg
  writesRA() { this.dstRegs[cpu0reg.RA] = 1; return ''; }

  // cop1 regs
  ft_d(fmt) { const reg = this.cop1RegName(ft, fmt); this.dstRegs[reg] = 1; return this.makeFPRegSpan(reg); }
  fs_d(fmt) { const reg = this.cop1RegName(fs, fmt); this.dstRegs[reg] = 1; return this.makeFPRegSpan(reg); }
  fd(fmt) { const reg = this.cop1RegName(fd, fmt); this.dstRegs[reg] = 1; return this.makeFPRegSpan(reg); }
  ft(fmt) { const reg = this.cop1RegName(ft, fmt); this.srcRegs[reg] = 1; return this.makeFPRegSpan(reg); }
  fs(fmt) { const reg = this.cop1RegName(fs, fmt); this.srcRegs[reg] = 1; return this.makeFPRegSpan(reg); }

  cop1RegName(opFn, fmt) {
    const regIdx = opFn(this.opcode);
    const suffix = fmt ? `-${fmt}` : '';
    return cop1RegisterNames[regIdx] + suffix;
  }

  // cop2 regs
  get gt_d() { const reg = this.cop2RegName(rt); this.dstRegs[reg] = 1; return this.makeRegSpan(reg); }
  get gd() { const reg = this.cop2RegName(rd); this.dstRegs[reg] = 1; return this.makeRegSpan(reg); }
  get gt() { const reg = this.cop2RegName(rt); this.srcRegs[reg] = 1; return this.makeRegSpan(reg); }
  get gs() { const reg = this.cop2RegName(rs); this.srcRegs[reg] = 1; return this.makeRegSpan(reg); }

  cop2RegName(opFn) {
    return cop2RegisterNames[opFn(this.opcode)];
  }

  get imm() { return `0x${toHex(imm(this.opcode), 16)}`; }

  get branchAddress() { this.target = branchAddress(this.address, this.opcode); return this.makeLabelText(this.target); }
  get jumpAddress() { this.target = jumpAddress(this.address, this.opcode); return this.makeLabelText(this.target); }

  get base() { const reg = this.cop0RegName(base); this.srcRegs[reg] = 1; return this.makeRegSpan(reg); }
  get offsetU16() { return `0x${toHex(offsetU16(this.opcode), 16)}`; }
  get offsetS16() { return `0x${toHex(offsetS16(this.opcode), 16)}`; }
  memaccess(mode) {
    this.memory = { reg: base(this.opcode), offset: offsetS16(this.opcode), mode: mode };
    return `[${this.base}+${this.offsetU16}]`;
  }

  memload() { return this.memaccess('load'); }
  memstore() { return this.memaccess('store'); }

  makeLabelText(address) {
    if (this.outputHTML) {
      return `<span class="dis-address-jump">${toHex(address, 32)}</span>`;
    }
    return toHex(address, 32);
  }

  makeRegSpan(t) {
    if (this.outputHTML) {
      return `<span class="dis-reg-${t}">${t}</span>`;
    }
    return t;
  }

  makeFPRegSpan(t) {
    // We only use the '-' as a valic css identifier, but want to use '.' in the visible text
    const text = t.replace('-', '.');
    if (this.outputHTML) {
      return `<span class="dis-reg-${t}">${text}</span>`;
    }
    return text;
  }
}

function disassembleUnknown() {
  return '?'
}

const specialTable = [
  i => {
    if (i.opcode === 0) {
      return 'NOP';
    }
    return `SLL       ${i.rd} = ${i.rt} << ${i.sa}`;
  },
  disassembleUnknown,
  i => `SRL       ${i.rd} = ${i.rt} >>> ${i.sa}`,
  i => `SRA       ${i.rd} = ${i.rt} >> ${i.sa}`,
  i => `SLLV      ${i.rd} = ${i.rt} << ${i.rs}`,
  disassembleUnknown,
  i => `SRLV      ${i.rd} = ${i.rt} >>> ${i.rs}`,
  i => `SRAV      ${i.rd} = ${i.rt} >> ${i.rs}`,
  i => `JR        ${i.rs}`,
  i => `JALR      ${i.rd}, ${i.rs}`,
  disassembleUnknown,
  disassembleUnknown,
  i => `SYSCALL   ${toHex((i.opcode >> 6) & 0xfffff, 20)}`,
  i => `BREAK     ${toHex((i.opcode >> 6) & 0xfffff, 20)}`,
  disassembleUnknown,
  i => 'SYNC',
  i => `MFHI      ${i.rd} = MultHi`,
  i => `MTHI      MultHi = ${i.rs}`,
  i => `MFLO      ${i.rd} = MultLo`,
  i => `MTLO      MultLo = ${i.rs}`,
  i => `DSLLV     ${i.rd} = ${i.rt} << ${i.rs}`,
  disassembleUnknown,
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
    if (rt(i.opcode) === 0) {
      if (rs(i.opcode) === 0) {
        return `CLEAR     ${i.rd} = 0`;
      } else {
        return `MOV       ${i.rd} = ${i.rs}`;
      }
    }
    return `OR        ${i.rd} = ${i.rs} | ${i.rt}`;
  },
  i => `XOR       ${i.rd} = ${i.rs} ^ ${i.rt}`,
  i => `NOR       ${i.rd} = ~( ${i.rs} | ${i.rt} )`,
  disassembleUnknown,
  disassembleUnknown,
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
  disassembleUnknown,
  i => `TNE       trap( ${i.rs} != ${i.rt} )`,
  disassembleUnknown,
  i => `DSLL      ${i.rd} = ${i.rt} << ${i.sa}`,
  disassembleUnknown,
  i => `DSRL      ${i.rd} = ${i.rt} >>> ${i.sa}`,
  i => `DSRA      ${i.rd} = ${i.rt} >> ${i.sa}`,
  i => `DSLL32    ${i.rd} = ${i.rt} << (32+${i.sa})`,
  disassembleUnknown,
  i => `DSRL32    ${i.rd} = ${i.rt} >>> (32+${i.sa})`,
  i => `DSRA32    ${i.rd} = ${i.rt} >> (32+${i.sa})`,
];
if (specialTable.length != 64) {
  throw "Oops, didn't build the special table correctly";
}

function disassembleSpecial(i) {
  return specialTable[specialOp(i.opcode)](i);
}

const cop0Table = [
  i => `MFC0      ${i.rt} <- ${cop0ControlRegisterNames[fs(i.opcode)]}`,
  i => `DMFC0     ${i.rt} <- ${cop0ControlRegisterNames[fs(i.opcode)]}`,
  disassembleUnknown,
  disassembleUnknown,
  i => `MTC0      ${i.rt} -> ${cop0ControlRegisterNames[fs(i.opcode)]}`,
  i => `DMTC0     ${i.rt} -> ${cop0ControlRegisterNames[fs(i.opcode)]}`,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,

  disassembleTLB,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
];
if (cop0Table.length != 32) {
  throw "Oops, didn't build the cop0 table correctly";
}
function disassembleCop0(i) {
  return cop0Table[copOp(i.opcode)](i);
}

function disassembleBCInstr(i) {
  assert(((i.opcode >>> 18) & 0x7) === 0, "cc bit is not 0");

  switch (cop1BCOp(i.opcode)) {
    case 0: return `BC1F      !c ? --> ${i.branchAddress}`;
    case 1: return `BC1T      c ? --> ${i.branchAddress}`;
    case 2: return `BC1FL     !c ? --> ${i.branchAddress}`;
    case 3: return `BC1TL     c ? --> ${i.branchAddress}`;
  }

  return '???';
}

function disassembleCop1Instr(i, fmt) {
  const fmtU = fmt.toUpperCase();

  switch (copFmtFuncOp(i.opcode)) {
    case 0x00: return `ADD.${fmtU}     ${i.fd(fmt)} = ${i.fs(fmt)} + ${i.ft(fmt)}`;
    case 0x01: return `SUB.${fmtU}     ${i.fd(fmt)} = ${i.fs(fmt)} - ${i.ft(fmt)}`;
    case 0x02: return `MUL.${fmtU}     ${i.fd(fmt)} = ${i.fs(fmt)} * ${i.ft(fmt)}`;
    case 0x03: return `DIV.${fmtU}     ${i.fd(fmt)} = ${i.fs(fmt)} / ${i.ft(fmt)}`;
    case 0x04: return `SQRT.${fmtU}    ${i.fd(fmt)} = sqrt(${i.fs(fmt)})`;
    case 0x05: return `ABS.${fmtU}     ${i.fd(fmt)} = abs(${i.fs(fmt)})`;
    case 0x06: return `MOV.${fmtU}     ${i.fd(fmt)} = ${i.fs(fmt)}`;
    case 0x07: return `NEG.${fmtU}     ${i.fd(fmt)} = -${i.fs(fmt)}`;
    case 0x08: return `ROUND.L.${fmtU} ${i.fd('l')} = round.l(${i.fs(fmt)})`;
    case 0x09: return `TRUNC.L.${fmtU} ${i.fd('l')} = trunc.l(${i.fs(fmt)})`;
    case 0x0a: return `CEIL.L.${fmtU}  ${i.fd('l')} = ceil.l(${i.fs(fmt)})`;
    case 0x0b: return `FLOOR.L.${fmtU} ${i.fd('l')} = floor.l(${i.fs(fmt)})`;
    case 0x0c: return `ROUND.W.${fmtU} ${i.fd('w')} = round.w(${i.fs(fmt)})`;
    case 0x0d: return `TRUNC.W.${fmtU} ${i.fd('w')} = trunc.w(${i.fs(fmt)})`;
    case 0x0e: return `CEIL.W.${fmtU}  ${i.fd('w')} = ceil.w(${i.fs(fmt)})`;
    case 0x0f: return `FLOOR.W.${fmtU} ${i.fd('w')} = floor.w(${i.fs(fmt)})`;

    case 0x20: return `CVT.S.${fmtU}   ${i.fd('s')} = (s)${i.fs(fmt)}`;
    case 0x21: return `CVT.D.${fmtU}   ${i.fd('d')} = (d)${i.fs(fmt)}`;
    case 0x24: return `CVT.W.${fmtU}   ${i.fd('w')} = (w)${i.fs(fmt)}`;
    case 0x25: return `CVT.L.${fmtU}   ${i.fd('l')} = (l)${i.fs(fmt)}`;

    case 0x30: return `C.F.${fmtU}     c = ${i.fs(fmt)} cmp ${i.ft(fmt)}`;
    case 0x31: return `C.UN.${fmtU}    c = ${i.fs(fmt)} cmp ${i.ft(fmt)}`;
    case 0x32: return `C.EQ.${fmtU}    c = ${i.fs(fmt)} cmp ${i.ft(fmt)}`;
    case 0x33: return `C.UEQ.${fmtU}   c = ${i.fs(fmt)} cmp ${i.ft(fmt)}`;
    case 0x34: return `C.OLT.${fmtU}   c = ${i.fs(fmt)} cmp ${i.ft(fmt)}`;
    case 0x35: return `C.ULT.${fmtU}   c = ${i.fs(fmt)} cmp ${i.ft(fmt)}`;
    case 0x36: return `C.OLE.${fmtU}   c = ${i.fs(fmt)} cmp ${i.ft(fmt)}`;
    case 0x37: return `C.ULE.${fmtU}   c = ${i.fs(fmt)} cmp ${i.ft(fmt)}`;
    case 0x38: return `C.SF.${fmtU}    c = ${i.fs(fmt)} cmp ${i.ft(fmt)}`;
    case 0x39: return `C.NGLE.${fmtU}  c = ${i.fs(fmt)} cmp ${i.ft(fmt)}`;
    case 0x3a: return `C.SEQ.${fmtU}   c = ${i.fs(fmt)} cmp ${i.ft(fmt)}`;
    case 0x3b: return `C.NGL.${fmtU}   c = ${i.fs(fmt)} cmp ${i.ft(fmt)}`;
    case 0x3c: return `C.LT.${fmtU}    c = ${i.fs(fmt)} cmp ${i.ft(fmt)}`;
    case 0x3d: return `C.NGE.${fmtU}   c = ${i.fs(fmt)} cmp ${i.ft(fmt)}`;
    case 0x3e: return `C.LE.${fmtU}    c = ${i.fs(fmt)} cmp ${i.ft(fmt)}`;
    case 0x3f: return `C.NGT.${fmtU}   c = ${i.fs(fmt)} cmp ${i.ft(fmt)}`;
  }

  return `Cop1.${fmt}${toHex(copFmtFuncOp(i.opcode), 8)}?`;
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
  i => `CFC1      ${i.rt_d} = CCR${rd(i.opcode)}`,
  i => `DCFC1     ${i.rt_d} = CCR${rd(i.opcode)}`,
  i => `MTC1      ${i.fs_d()} = ${i.rt}`,
  i => `DMTC1     ${i.fs_d()} = ${i.rt}`,
  i => `CTC1      CCR${rd(i.opcode)} = ${i.rt}`,
  i => `DCTC1     CCR${rd(i.opcode)} = ${i.rt}`,
  disassembleBCInstr,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,

  disassembleCop1SInstr,
  disassembleCop1DInstr,
  disassembleUnknown,
  disassembleUnknown,
  disassembleCop1WInstr,
  disassembleCop1LInstr,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
];
if (cop1Table.length != 32) {
  throw "Oops, didn't build the cop1 table correctly";
}
function disassembleCop1(i) {
  return cop1Table[copOp(i.opcode)](i);
}

const cop2Table = [
  i => `MFC2      ${i.rt_d} = ${i.fs()}`,
  i => `DMFC2     ${i.rt_d} = ${i.fs()}`,
  i => `CFC2      ${i.rt_d} = CCR${rd(i.opcode)}`,
  i => `DCFC2     ${i.rt_d} = CCR${rd(i.opcode)}`,
  i => `MTC2      ${i.fs_d()} = ${i.rt}`,
  i => `DMTC2     ${i.fs_d()} = ${i.rt}`,
  i => `CTC2      CCR${rd(i.opcode)} = ${i.rt}`,
  i => `DCTC2     CCR${rd(i.opcode)} = ${i.rt}`,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,

  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
];
if (cop2Table.length != 32) {
  throw "Oops, didn't build the cop2 table correctly";
}
function disassembleCop2(i) {
  return cop2Table[copOp(i.opcode)](i);
}

const cop3Table = [
  i => `MFC3      ${i.rt_d} = ${i.fs()}`,
  i => `DMFC3     ${i.rt_d} = ${i.fs()}`,
  i => `CFC3      ${i.rt_d} = CCR${rd(i.opcode)}`,
  i => `DCFC3     ${i.rt_d} = CCR${rd(i.opcode)}`,
  i => `MTC3      ${i.fs_d()} = ${i.rt}`,
  i => `DMTC3     ${i.fs_d()} = ${i.rt}`,
  i => `CTC3      CCR${rd(i.opcode)} = ${i.rt}`,
  i => `DCTC3     CCR${rd(i.opcode)} = ${i.rt}`,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,

  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
];
if (cop3Table.length != 32) {
  throw "Oops, didn't build the cop3 table correctly";
}
function disassembleCop3(i) {
  return cop3Table[copOp(i.opcode)](i);
}

function disassembleTLB(i) {
  switch (tlbop(i.opcode)) {
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
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,

  i => `TGEI      ${i.rs} >= ${i.rt} --> trap `,
  i => `TGEIU     ${i.rs} >= ${i.rt} --> trap `,
  i => `TLTI      ${i.rs} < ${i.rt} --> trap `,
  i => `TLTIU     ${i.rs} < ${i.rt} --> trap `,
  i => `TEQI      ${i.rs} == ${i.rt} --> trap `,
  disassembleUnknown,
  i => `TNEI      ${i.rs} != ${i.rt} --> trap `,
  disassembleUnknown,

  i => `BLTZAL    ${i.rs} < 0 --> ${i.branchAddress}${i.writesRA()}`,
  i => `BGEZAL    ${i.rs} >= 0 --> ${i.branchAddress}${i.writesRA()}`,
  i => `BLTZALL   ${i.rs} < 0 --> ${i.branchAddress}${i.writesRA()}`,
  i => `BGEZALL   ${i.rs} >= 0 --> ${i.branchAddress}${i.writesRA()}`,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
];
if (regImmTable.length != 32) {
  throw "Oops, didn't build the special table correctly";
}

function disassembleRegImm(i) {
  return regImmTable[regImmOp(i.opcode)](i);
}

const simpleTable = [
  disassembleSpecial,
  disassembleRegImm,
  i => `J         --> ${i.jumpAddress}`,
  i => `JAL       --> ${i.jumpAddress}${i.writesRA()}`,
  i => {
    if (rs(i.opcode) == rt(i.opcode)) {
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
  disassembleCop2,
  disassembleCop3,
  i => `BEQL      ${i.rs} == ${i.rt} --> ${i.branchAddress}`,
  i => `BNEL      ${i.rs} != ${i.rt} --> ${i.branchAddress}`,
  i => `BLEZL     ${i.rs} <= 0 --> ${i.branchAddress}`,
  i => `BGTZL     ${i.rs} > 0 --> ${i.branchAddress}`,
  i => `DADDI     ${i.rt_d} = ${i.rs} + ${i.imm}`,
  i => `DADDIU    ${i.rt_d} = ${i.rs} + ${i.imm}`,
  i => `LDL       ${i.rt_d} <- ${i.memload()}`,
  i => `LDR       ${i.rt_d} <- ${i.memload()}`,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
  disassembleUnknown,
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
  i => `CACHE     ${toHex(rt(i.opcode), 8)}, ${i.memaccess()}`,
  i => `LL        ${i.rt_d} <- ${i.memload()}`,
  i => `LWC1      ${i.ft_d()} <- ${i.memload()}`,
  disassembleUnknown,
  disassembleUnknown,
  i => `LLD       ${i.rt_d} <- ${i.memload()}`,
  i => `LDC1      ${i.ft_d()} <- ${i.memload()}`,
  i => `LDC2      ${i.gt_d} <- ${i.memload()}`,
  i => `LD        ${i.rt_d} <- ${i.memload()}`,
  i => `SC        ${i.rt} -> ${i.memstore()}`,
  i => `SWC1      ${i.ft()} -> ${i.memstore()}`,
  i => 'BREAKPOINT',
  disassembleUnknown,
  i => `SCD       ${i.rt} -> ${i.memstore()}`,
  i => `SDC1      ${i.ft()} -> ${i.memstore()}`,
  i => `SDC2      ${i.gt} -> ${i.memstore()}`,
  i => `SD        ${i.rt} -> ${i.memstore()}`,
];
if (simpleTable.length != 64) {
  throw "Oops, didn't build the simple table correctly";
}

export function disassembleInstruction(address, instruction, outputHTML) {
  const i = new Instruction(address, instruction, outputHTML);
  const disassembly = simpleTable[simpleOp(instruction)](i);
  return {
    instruction: i,
    disassembly: disassembly,
    isJumpTarget: false,
  };
}

export function disassembleRange(beginAddr, endAddr, outputHTML) {
  const breakpoints = n64js.breakpoints();
  const disassembly = [];
  const targets = new Set();

  for (let addr = beginAddr; addr < endAddr; addr += 4) {
    const instruction = breakpoints.getInstruction(addr);
    const d = disassembleInstruction(addr, instruction, outputHTML);
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
