if (typeof n64js === 'undefined') {
  var n64js = {};
}

(function () {'use strict';

  function _fd(i)     { return (i>>> 6)&0x1f; }
  function _fs(i)     { return (i>>>11)&0x1f; }
  function _ft(i)     { return (i>>>16)&0x1f; }
  function _copop(i)  { return (i>>>21)&0x1f; }

  function _offset(i) { return (i     )&0xffff; }
  function _sa(i)     { return (i>>> 6)&0x1f; }
  function _rd(i)     { return (i>>>11)&0x1f; }
  function _rt(i)     { return (i>>>16)&0x1f; }
  function _rs(i)     { return (i>>>21)&0x1f; }
  function _op(i)     { return (i>>>26)&0x3f; }

  function _tlbop(i)  { return i&0x3f; }
  function _cop1_func(i) { return i&0x3f; }

  function _target(i) { return (i     )&0x3ffffff; }
  function _imm(i)    { return (i     )&0xffff; }
  function _imms(i)   { return (_imm(i)<<16)>>16; }   // treat immediate value as signed
  function _base(i)   { return (i>>>21)&0x1f; }

  function _branchAddress(a,i) { return (a+4) + (_imms(i)*4); }
  function _jumpAddress(a,i)   { return (a&0xf0000000) | (_target(i)*4); }

  function makeLabelText(address) {
    var text = n64js.toHex( address, 32 );
    return '<span class="dis-label-target">'+ text + '</span>';
  }

  var gprRegisterNames = [
    'r0', 'at', 'v0', 'v1', 'a0', 'a1', 'a2', 'a3',
    't0', 't1', 't2', 't3', 't4', 't5', 't6', 't7',
    's0', 's1', 's2', 's3', 's4', 's5', 's6', 's7',
    't8', 't9', 'k0', 'k1', 'gp', 'sp', 's8', 'ra'
  ];
  n64js.cop0gprNames = gprRegisterNames;

  var cop0ControlRegisterNames = [
    "Index",       "Rand", "EntryLo0", "EntryLo1", "Context", "PageMask",     "Wired",   "?7",
    "BadVAddr",   "Count",  "EntryHi",  "Compare",      "SR",    "Cause",       "EPC", "PrID", 
    "?16",         "?17",   "WatchLo",  "WatchHi",     "?20",      "?21",       "?22",  "?23",
    "?24",         "?25",       "ECC", "CacheErr",   "TagLo",    "TagHi",  "ErrorEPC",  "?31"
  ];
  n64js.cop0ControlRegisterNames = cop0ControlRegisterNames;

  var cop1RegisterNames = [
    'FP00', 'FP01', 'FP02', 'FP03', 'FP04', 'FP05', 'FP06', 'FP07',
    'FP08', 'FP09', 'FP10', 'FP11', 'FP12', 'FP13', 'FP14', 'FP15',
    'FP16', 'FP17', 'FP18', 'FP19', 'FP20', 'FP21', 'FP22', 'FP23',
    'FP24', 'FP25', 'FP26', 'FP27', 'FP28', 'FP29', 'FP30', 'FP31'
  ];

  var copRegisterNames = [
    'GR00', 'GR01', 'GR02', 'GR03', 'GR04', 'GR05', 'GR06', 'GR07',
    'GR08', 'GR09', 'GR10', 'GR11', 'GR12', 'GR13', 'GR14', 'GR15',
    'GR16', 'GR17', 'GR18', 'GR19', 'GR20', 'GR21', 'GR22', 'GR23',
    'GR24', 'GR25', 'GR26', 'GR27', 'GR28', 'GR29', 'GR30', 'GR31'
  ];

  function Instruction(address, opcode) {
    this.address = address;
    this.opcode  = opcode;
    this.srcRegs = {};
    this.dstRegs = {};
    this.target  = '';
  }

  function makeRegSpan(t) {
    return '<span class="dis-reg-' + t + '">' + t + '</span>';
  }

  Instruction.prototype = {

    // cop0 regs
    rt_d : function () { var reg = gprRegisterNames[_rt(this.opcode)]; this.dstRegs[reg] = 1; return makeRegSpan(reg); },
    rd   : function () { var reg = gprRegisterNames[_rd(this.opcode)]; this.dstRegs[reg] = 1; return makeRegSpan(reg); },
    rt   : function () { var reg = gprRegisterNames[_rt(this.opcode)]; this.srcRegs[reg] = 1; return makeRegSpan(reg); },
    rs   : function () { var reg = gprRegisterNames[_rs(this.opcode)]; this.srcRegs[reg] = 1; return makeRegSpan(reg); },

    // dummy operand - just marks ra as being a dest reg
    writesRA  : function()  { this.dstRegs[n64js.cpu0.kRegister_ra] = 1; return ''; },

    // cop1 regs
    ft_d : function () { var reg = cop1RegisterNames[_ft(this.opcode)]; this.dstRegs[reg] = 1; return makeRegSpan(reg); },
    fs_d : function () { var reg = cop1RegisterNames[_fs(this.opcode)]; this.dstRegs[reg] = 1; return makeRegSpan(reg); },
    fd   : function () { var reg = cop1RegisterNames[_fd(this.opcode)]; this.dstRegs[reg] = 1; return makeRegSpan(reg); },
    ft   : function () { var reg = cop1RegisterNames[_ft(this.opcode)]; this.srcRegs[reg] = 1; return makeRegSpan(reg); },
    fs   : function () { var reg = cop1RegisterNames[_fs(this.opcode)]; this.srcRegs[reg] = 1; return makeRegSpan(reg); },

    // cop2 regs
    gt_d : function () { var reg = cop2RegisterNames[_rt(this.opcode)]; this.dstRegs[reg] = 1; return makeRegSpan(reg); },
    gd   : function () { var reg = cop2RegisterNames[_rd(this.opcode)]; this.dstRegs[reg] = 1; return makeRegSpan(reg); },
    gt   : function () { var reg = cop2RegisterNames[_rt(this.opcode)]; this.srcRegs[reg] = 1; return makeRegSpan(reg); },
    gs   : function () { var reg = cop2RegisterNames[_rs(this.opcode)]; this.srcRegs[reg] = 1; return makeRegSpan(reg); },

    imm : function () { return '0x' + n64js.toHex( _imm(this.opcode), 16 ); },

    branchAddress : function () { this.target = _branchAddress(this.address,this.opcode); return makeLabelText( this.target ); },
    jumpAddress : function ()   { this.target = _jumpAddress(this.address,this.opcode);   return makeLabelText( this.target ); },

    memaccess : function () {
      var r   = this.rs();
      var off = this.imm();
      return '[' + r + '+' + off + ']';
    }

  };

  var specialTable = [
    function (i) { if (i.opcode == 0) {
                     return 'NOP';
                     }
                   return 'SLL       ' + i.rd() + ' = ' + i.rs() + ' << '  + _sa(i.opcode); },
    function (i) { return 'Unk'; },
    function (i) { return 'SRL       ' + i.rd() + ' = ' + i.rs() + ' >>> ' + _sa(i.opcode); },
    function (i) { return 'SRA       ' + i.rd() + ' = ' + i.rs() + ' >> '  + _sa(i.opcode); },
    function (i) { return 'SLLV      ' + i.rd() + ' = ' + i.rs() + ' << '  + i.rt(); },
    function (i) { return 'Unk'; },
    function (i) { return 'SRLV      ' + i.rd() + ' = ' + i.rs() + ' >>> ' + i.rt(); },
    function (i) { return 'SRAV      ' + i.rd() + ' = ' + i.rs() + ' >> '  + i.rt(); },
    function (i) { return 'JR        ' + i.rs(); },
    function (i) { return 'JALR      ' + i.rd() + ', ' + i.rs(); },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'SYSCALL   ' + n64js.toHex( (i.opcode>>6)&0xfffff, 20 ); },
    function (i) { return 'BREAK     ' + n64js.toHex( (i.opcode>>6)&0xfffff, 20 ); },
    function (i) { return 'Unk'; },
    function (i) { return 'SYNC'; },
    function (i) { return 'MFHI      ' + i.rd() + ' = MultHi'; },
    function (i) { return 'MTHI      MultHi = ' + i.rs(); },
    function (i) { return 'MFLO      ' + i.rd() + ' = MultLo'; },
    function (i) { return 'MTLO      MultLo = ' + i.rs(); },
    function (i) { return 'DSLLV     ' + i.rd() + ' = ' + i.rs() + ' << '  + i.rt(); },
    function (i) { return 'Unk'; },
    function (i) { return 'DSRLV     ' + i.rd() + ' = ' + i.rs() + ' >>> ' + i.rt(); },
    function (i) { return 'DSRAV     ' + i.rd() + ' = ' + i.rs() + ' >> '  + i.rt(); },
    function (i) { return 'MULT      ' +                  i.rs() + ' * '   + i.rt(); },
    function (i) { return 'MULTU     ' +                  i.rs() + ' * '   + i.rt(); },
    function (i) { return 'DIV       ' +                  i.rs() + ' / '   + i.rt(); },
    function (i) { return 'DIVU      ' +                  i.rs() + ' / '   + i.rt(); },
    function (i) { return 'DMULT     ' +                  i.rs() + ' * '   + i.rt(); },
    function (i) { return 'DMULTU    ' +                  i.rs() + ' * '   + i.rt(); },
    function (i) { return 'DDIV      ' +                  i.rs() + ' / '   + i.rt(); },
    function (i) { return 'DDIVU     ' +                  i.rs() + ' / '   + i.rt(); },
    function (i) { return 'ADD       ' + i.rd() + ' = ' + i.rs() + ' + '   + i.rt(); },
    function (i) { return 'ADDU      ' + i.rd() + ' = ' + i.rs() + ' + '   + i.rt(); },
    function (i) { return 'SUB       ' + i.rd() + ' = ' + i.rs() + ' - '   + i.rt(); },
    function (i) { return 'SUBU      ' + i.rd() + ' = ' + i.rs() + ' - '   + i.rt(); },
    function (i) { return 'AND       ' + i.rd() + ' = ' + i.rs() + ' & '   + i.rt(); },
    function (i) { if (_rt(i.opcode) == 0) {
                      if (_rs(i.opcode) == 0) {
                     return 'CLEAR     ' + i.rd() + ' = 0';
                      } else {
                     return 'MOV       ' + i.rd() + ' = ' + i.rs();
                      }
                     }
                   return 'OR        ' + i.rd() + ' = '    + i.rs() + ' | ' + i.rt(); },
    function (i) { return 'XOR       ' + i.rd() + ' = '    + i.rs() + ' ^ ' + i.rt(); },
    function (i) { return 'NOR       ' + i.rd() + ' = ~( ' + i.rs() + ' | ' + i.rt() + ' )'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'SLT       ' + i.rd() + ' = ' + i.rs() + ' < ' + i.rt(); },
    function (i) { return 'SLTU      ' + i.rd() + ' = ' + i.rs() + ' < ' + i.rt(); },
    function (i) { return 'DADD      ' + i.rd() + ' = ' + i.rs() + ' + ' + i.rt(); },
    function (i) { return 'DADDU     ' + i.rd() + ' = ' + i.rs() + ' + ' + i.rt(); },
    function (i) { return 'DSUB      ' + i.rd() + ' = ' + i.rs() + ' - ' + i.rt(); },
    function (i) { return 'DSUBU     ' + i.rd() + ' = ' + i.rs() + ' - ' + i.rt(); },
    function (i) { return 'TGE       trap( ' + i.rs() + ' >= ' + i.rt() + ' )'; },
    function (i) { return 'TGEU      trap( ' + i.rs() + ' >= ' + i.rt() + ' )'; },
    function (i) { return 'TLT       trap( ' + i.rs() + ' < '  + i.rt() + ' )'; },
    function (i) { return 'TLTU      trap( ' + i.rs() + ' < '  + i.rt() + ' )'; },
    function (i) { return 'TEQ       trap( ' + i.rs() + ' == ' + i.rt() + ' )'; },
    function (i) { return 'Unk'; },
    function (i) { return 'TNE       trap( ' + i.rs() + ' != ' + i.rt() + ' )'; },
    function (i) { return 'Unk'; },
    function (i) { return 'DSLL      ' + i.rd() + ' = ' + i.rt() + ' << '  + _sa(i.opcode); },
    function (i) { return 'Unk'; },
    function (i) { return 'DSRL      ' + i.rd() + ' = ' + i.rt() + ' >>> ' + _sa(i.opcode); },
    function (i) { return 'DSRA      ' + i.rd() + ' = ' + i.rt() + ' >> '  + _sa(i.opcode); },
    function (i) { return 'DSLL32    ' + i.rd() + ' = ' + i.rt() + ' << (32+'  + _sa(i.opcode) + ')'; },
    function (i) { return 'Unk'; },
    function (i) { return 'DSRL32    ' + i.rd() + ' = ' + i.rt() + ' >>> (32+' + _sa(i.opcode) + ')'; },
    function (i) { return 'DSRA32    ' + i.rd() + ' = ' + i.rt() + ' >> (32+'  + _sa(i.opcode) + ')'; }
  ];
  if (specialTable.length != 64) {
    throw "Oops, didn't build the special table correctly";
  }

  function disassembleSpecial(i) {
    var fn = i.opcode & 0x3f;
    return specialTable[fn](i);
  }

  var cop0Table = [
    function (i) { return 'MFC0      ' + i.rt() + ' <- ' + cop0ControlRegisterNames[_fs(i.opcode)]; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'MTC0      ' + i.rt() + ' -> ' + cop0ControlRegisterNames[_fs(i.opcode)]; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    
    disassembleTLB,
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
  ];
  if (cop0Table.length != 32) {
    throw "Oops, didn't build the cop0 table correctly";
  }
  function disassembleCop0(i) {
    var fmt = (i.opcode>>21) & 0x1f;
    return cop0Table[fmt](i);
  }

  function disassembleCop1Instr(i, fmt) {
    switch(_cop1_func(i.opcode)) {
      case 0x00:    return 'ADD.' + fmt + '     ' + i.fd() + ' = ' + i.fs() + ' + ' + i.ft();
      case 0x01:    return 'SUB.' + fmt + '     ' + i.fd() + ' = ' + i.fs() + ' - ' + i.ft();
      case 0x02:    return 'MUL.' + fmt + '     ' + i.fd() + ' = ' + i.fs() + ' * ' + i.ft();
      case 0x03:    return 'DIV.' + fmt + '     ' + i.fd() + ' = ' + i.fs() + ' / ' + i.ft();
      case 0x04:    return 'SQRT.' + fmt + '    ' + i.fd() + ' = sqrt(' + i.fs() + ')';
      case 0x05:    return 'ABS.' + fmt + '     ' + i.fd() + ' = abs(' + i.fs() + ')';
      case 0x06:    return 'MOV.' + fmt + '     ' + i.fd() + ' = ' + i.fs();
      case 0x07:    return 'NEG.' + fmt + '     ' + i.fd() + ' = -' + i.fs();
      case 0x08:    return 'ROUND.L.' + fmt + ' ' + i.fd() + ' = round.l(' + i.fs() + ')';
      case 0x09:    return 'TRUNC.L.' + fmt + ' ' + i.fd() + ' = trunc.l(' + i.fs() + ')';
      case 0x0a:    return 'CEIL.L.' + fmt + '  ' + i.fd() + ' = ceil.l(' + i.fs() + ')';
      case 0x0b:    return 'FLOOR.L.' + fmt + ' ' + i.fd() + ' = floor.l(' + i.fs() + ')';
      case 0x0c:    return 'ROUND.W.' + fmt + ' ' + i.fd() + ' = round.w(' + i.fs() + ')';
      case 0x0d:    return 'TRUNC.W.' + fmt + ' ' + i.fd() + ' = trunc.w(' + i.fs() + ')';
      case 0x0e:    return 'CEIL.W.' + fmt + '  ' + i.fd() + ' = ceil.w(' + i.fs() + ')';
      case 0x0f:    return 'FLOOR.W.' + fmt + ' ' + i.fd() + ' = floor.w(' + i.fs() + ')';

      case 0x20:    return 'CVT.S.' + fmt + '   ' + i.fd() + ' = (s)' + i.fs();
      case 0x21:    return 'CVT.D.' + fmt + '   ' + i.fd() + ' = (d)' + i.fs();
      case 0x24:    return 'CVT.W.' + fmt + '   ' + i.fd() + ' = (w)' + i.fs();
      case 0x25:    return 'CVT.L.' + fmt + '   ' + i.fd() + ' = (l)' + i.fs();

      case 0x30:    return 'C.F.' + fmt + '     c = ' + i.fs() + ' cmp ' + i.ft();
      case 0x31:    return 'C.UN.' + fmt + '    c = ' + i.fs() + ' cmp ' + i.ft();
      case 0x32:    return 'C.EQ.' + fmt + '    c = ' + i.fs() + ' cmp ' + i.ft();
      case 0x33:    return 'C.UEQ.' + fmt + '   c = ' + i.fs() + ' cmp ' + i.ft();
      case 0x34:    return 'C.OLT.' + fmt + '   c = ' + i.fs() + ' cmp ' + i.ft();
      case 0x35:    return 'C.ULT.' + fmt + '   c = ' + i.fs() + ' cmp ' + i.ft();
      case 0x36:    return 'C.OLE.' + fmt + '   c = ' + i.fs() + ' cmp ' + i.ft();
      case 0x37:    return 'C.ULE.' + fmt + '   c = ' + i.fs() + ' cmp ' + i.ft();
      case 0x38:    return 'C.SF.' + fmt + '    c = ' + i.fs() + ' cmp ' + i.ft();
      case 0x39:    return 'C.NGLE.' + fmt + '  c = ' + i.fs() + ' cmp ' + i.ft();
      case 0x3a:    return 'C.SEQ.' + fmt + '   c = ' + i.fs() + ' cmp ' + i.ft();
      case 0x3b:    return 'C.NGL.' + fmt + '   c = ' + i.fs() + ' cmp ' + i.ft();
      case 0x3c:    return 'C.LT.' + fmt + '    c = ' + i.fs() + ' cmp ' + i.ft();
      case 0x3d:    return 'C.NGE.' + fmt + '   c = ' + i.fs() + ' cmp ' + i.ft();
      case 0x3e:    return 'C.LE.' + fmt + '    c = ' + i.fs() + ' cmp ' + i.ft();
      case 0x3f:    return 'C.NGT.' + fmt + '   c = ' + i.fs() + ' cmp ' + i.ft();
    }

    return 'Cop1.' + fmt + n64js.toHex(_cop1_func(i.opcode),8) + '?';
  }
  function disassembleCop1SInstr(i) {
    return disassembleCop1Instr(i, 'S');
  }
  function disassembleCop1DInstr(i) {
    return disassembleCop1Instr(i, 'D');
  }
  function disassembleCop1WInstr(i) {
    return disassembleCop1Instr(i, 'W');
  }
  function disassembleCop1LInstr(i) {
    return disassembleCop1Instr(i, 'D');
  }


  var cop1Table = [
    function (i) { return 'MFC1      ' + i.rt_d() + ' <-- ' + i.fs(); },
    function (i) { return 'DMFC1     ' + i.rt_d() + ' <-- ' + i.fs(); },
    function (i) { return 'CFC1      ' + i.rt_d() + ' <-- CCR' + _rd(i.opcode); },
    function (i) { return 'Unk'; },
    function (i) { return 'MTC1      ' + i.rt() + ' --> ' + i.fs_d(); },
    function (i) { return 'DMTC1     ' + i.rt() + ' --> ' + i.fs_d(); },
    function (i) { return 'CTC1      ' + i.rt() + ' --> CCR' + _rd(i.opcode); },
    function (i) { return 'Unk'; },
    function (i) { return 'BCInstr'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },

    disassembleCop1SInstr,
    disassembleCop1DInstr,
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    disassembleCop1WInstr,
    disassembleCop1LInstr,
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
  ];
  if (cop1Table.length != 32) {
    throw "Oops, didn't build the cop1 table correctly";
  }
  function disassembleCop1(i) {
    var fmt = (i.opcode>>21) & 0x1f;
    return cop1Table[fmt](i);
  }


  function disassembleTLB(i) {
    switch(_tlbop(i.opcode)) {
      case 0x01:    return 'TLBR';
      case 0x02:    return 'TLBWI';
      case 0x06:    return 'TLBWR';
      case 0x08:    return 'TLBP';
      case 0x18:    return 'ERET';
    }

    return 'Unk';
  }

  var regImmTable = [
    function (i) { return 'BLTZ      ' + i.rs() +  ' < 0 --> ' + i.branchAddress(); },
    function (i) { return 'BGEZ      ' + i.rs() + ' >= 0 --> ' + i.branchAddress(); },
    function (i) { return 'BLTZL     ' + i.rs() +  ' < 0 --> ' + i.branchAddress(); },
    function (i) { return 'BGEZL     ' + i.rs() + ' >= 0 --> ' + i.branchAddress(); },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },

    function (i) { return 'TGEI      ' + i.rs() + ' >= ' + i.rt() + ' --> trap '; },
    function (i) { return 'TGEIU     ' + i.rs() + ' >= ' + i.rt() + ' --> trap '; },
    function (i) { return 'TLTI      ' + i.rs() +  ' < ' + i.rt() + ' --> trap '; },
    function (i) { return 'TLTIU     ' + i.rs() +  ' < ' + i.rt() + ' --> trap '; },
    function (i) { return 'TEQI      ' + i.rs() + ' == ' + i.rt() + ' --> trap '; },
    function (i) { return 'Unk'; },
    function (i) { return 'TNEI      ' + i.rs() + ' != ' + i.rt() + ' --> trap '; },
    function (i) { return 'Unk'; },
    
    function (i) { return 'BLTZAL    ' + i.rs() +  ' < 0 --> ' + i.branchAddress() + i.writesRA(); },
    function (i) { return 'BGEZAL    ' + i.rs() + ' >= 0 --> ' + i.branchAddress() + i.writesRA(); },
    function (i) { return 'BLTZALL   ' + i.rs() +  ' < 0 --> ' + i.branchAddress() + i.writesRA(); },
    function (i) { return 'BGEZALL   ' + i.rs() + ' >= 0 --> ' + i.branchAddress() + i.writesRA(); },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
  ];
  if (regImmTable.length != 32) {
    throw "Oops, didn't build the special table correctly";
  }  

  function disassembleRegImm(i) {
    var rt = (i.opcode >> 16) & 0x1f;
    return regImmTable[rt](i);
  }

  var simpleTable = [
    disassembleSpecial,
    disassembleRegImm,
    function (i) { return 'J         --> ' + i.jumpAddress(); },
    function (i) { return 'JAL       --> ' + i.jumpAddress() + i.writesRA(); },
    function (i) { 
      if (_rs(i.opcode) == _rt(i.opcode)) {
                   return 'B         --> ' + i.branchAddress();
      }
                   return 'BEQ       ' +                     i.rs() + ' == ' + i.rt() + ' --> ' + i.branchAddress(); },
    function (i) { return 'BNE       ' +                     i.rs() + ' != ' + i.rt() + ' --> ' + i.branchAddress(); },
    function (i) { return 'BLEZ      ' +                     i.rs() + ' <= 0 --> ' + i.branchAddress(); },
    function (i) { return 'BGTZ      ' +                     i.rs() + ' > 0 --> '  + i.branchAddress(); },
    function (i) { return 'ADDI      ' + i.rt_d() + ' = '  + i.rs() + ' + ' + i.imm(); },
    function (i) { return 'ADDIU     ' + i.rt_d() + ' = '  + i.rs() + ' + ' + i.imm(); },
    function (i) { return 'SLTI      ' + i.rt_d() + ' = (' + i.rs() + ' < ' + i.imm() + ')'; },
    function (i) { return 'SLTIU     ' + i.rt_d() + ' = (' + i.rs() + ' < ' + i.imm() + ')'; },
    function (i) { return 'ANDI      ' + i.rt_d() + ' = '  + i.rs() + ' & ' + i.imm(); },
    function (i) { return 'ORI       ' + i.rt_d() + ' = '  + i.rs() + ' | ' + i.imm(); },
    function (i) { return 'XORI      ' + i.rt_d() + ' = '  + i.rs() + ' ^ ' + i.imm(); },
    function (i) { return 'LUI       ' + i.rt_d() + ' = '  + i.imm(); },
    disassembleCop0,
    disassembleCop1,
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'BEQL      ' +                    i.rs() + ' == ' + i.rt() + ' --> ' + i.branchAddress(); },
    function (i) { return 'BNEL      ' +                    i.rs() + ' != ' + i.rt() + ' --> ' + i.branchAddress(); },
    function (i) { return 'BLEZL     ' +                    i.rs() + ' <= 0 --> ' + i.branchAddress(); },
    function (i) { return 'BGTZL     ' +                    i.rs() + ' > 0 --> ' + i.branchAddress(); },
    function (i) { return 'DADDI     ' + i.rt_d() + ' = ' + i.rs() + ' + ' + i.imm(); },
    function (i) { return 'DADDIU    ' + i.rt_d() + ' = ' + i.rs() + ' + ' + i.imm(); },
    function (i) { return 'LDL       ' + i.rt_d() + ' <- ' + i.memaccess(); },
    function (i) { return 'LDR       ' + i.rt_d() + ' <- ' + i.memaccess(); },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'LB        ' + i.rt_d() + ' <- ' + i.memaccess(); },
    function (i) { return 'LH        ' + i.rt_d() + ' <- ' + i.memaccess(); },
    function (i) { return 'LWL       ' + i.rt_d() + ' <- ' + i.memaccess(); },
    function (i) { return 'LW        ' + i.rt_d() + ' <- ' + i.memaccess(); },
    function (i) { return 'LBU       ' + i.rt_d() + ' <- ' + i.memaccess(); },
    function (i) { return 'LHU       ' + i.rt_d() + ' <- ' + i.memaccess(); },
    function (i) { return 'LWR       ' + i.rt_d() + ' <- ' + i.memaccess(); },
    function (i) { return 'LWU       ' + i.rt_d() + ' <- ' + i.memaccess(); },
    function (i) { return 'SB        ' + i.rt()   + ' -> ' + i.memaccess(); },
    function (i) { return 'SH        ' + i.rt()   + ' -> ' + i.memaccess(); },
    function (i) { return 'SWL       ' + i.rt()   + ' -> ' + i.memaccess(); },
    function (i) { return 'SW        ' + i.rt()   + ' -> ' + i.memaccess(); },
    function (i) { return 'SDL       ' + i.rt()   + ' -> ' + i.memaccess(); },
    function (i) { return 'SDR       ' + i.rt()   + ' -> ' + i.memaccess(); },
    function (i) { return 'SWR       ' + i.rt()   + ' -> ' + i.memaccess(); },
    function (i) { return 'CACHE     ' + n64js.toHex(_rt(i.opcode),8) + i.memaccess(); },
    function (i) { return 'LL        ' + i.rt_d() + ' <- ' + i.memaccess(); },
    function (i) { return 'LWC1      ' + i.ft_d() + ' <- ' + i.memaccess(); },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'LLD       ' + i.rt_d() + ' <- ' + i.memaccess(); },
    function (i) { return 'LDC1      ' + i.ft_d() + ' <- ' + i.memaccess(); },
    function (i) { return 'LDC2      ' + i.gt_d() + ' <- ' + i.memaccess(); },
    function (i) { return 'LD        ' + i.rt_d() + ' <- ' + i.memaccess(); },
    function (i) { return 'SC        ' + i.rt()   + ' -> ' + i.memaccess(); },
    function (i) { return 'SWC1      ' + i.ft()   + ' -> ' + i.memaccess(); },
    function (i) { return 'Unk'; },
    function (i) { return 'Unk'; },
    function (i) { return 'SCD       ' + i.rt()   + ' -> ' + i.memaccess(); },
    function (i) { return 'SDC1      ' + i.ft()   + ' -> ' + i.memaccess(); },
    function (i) { return 'SDC2      ' + i.gt()   + ' -> ' + i.memaccess(); },
    function (i) { return 'SD        ' + i.rt()   + ' -> ' + i.memaccess(); }
  ];
  if (simpleTable.length != 64) {
    throw "Oops, didn't build the simple table correctly";
  }

  n64js.disassembleOp = function (address, opcode) {
    var i           = new Instruction(address, opcode);
    var o = _op(opcode);
    var disassembly = simpleTable[_op(opcode)](i);

    return {instruction:i, disassembly:disassembly, isJumpTarget:false};
  }

  n64js.disassembleAddress = function (address) {
    var instruction = n64js.readMemoryInternal32(address);
    return n64js.disassembleOp(address, instruction);
  }
  
  n64js.disassemble = function (bpc, epc) {

    var r = [];

    var targets = {};

    for (var i = bpc; i < epc; i += 4) {
        var d = n64js.disassembleAddress(i);
        if (d.instruction.target) {
          targets[d.instruction.target] = 1;
        }

        r.push(d);
    }

    // Flag any instructions that are jump targets
    for (var o = 0; o < r.length; ++o) {
      if (targets.hasOwnProperty(r[o].instruction.address)) 
        r[o].isJumpTarget = true;
    }

    return r;
  }

})();