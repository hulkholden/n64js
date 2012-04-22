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
  function _op(i)     { return (i>>>26)&0x1f; }

  function _target(i) { return (i     )&0x3ffffff; }
  function _imm(i)    { return (i     )&0xffff; }
  function _imms(i)   { return (_imm(i)<<16)>>16; }   // treat immediate value as signed
  function _base(i)   { return (i>>>21)&0x1f; }

  function branchAddress(a,i) { return n64js.toHex( (a+4) + (_imms(i)*4), 32 ); }

  var gprRegisterNames = [
    'r0', 'at', 'v0', 'v1', 'a0', 'a1', 'a2', 'a3',
    't0', 't1', 't2', 't3', 't4', 't5', 't6', 't7',
    's0', 's1', 's2', 's3', 's4', 's5', 's6', 's7',
    't8', 't9', 'k0', 'k1', 'gp', 'sp', 's8', 'ra'
  ];

  var cop0ControlRegisterNames = [
    "Index",       "Rand", "EntryLo0", "EntryLo1", "Context", "PageMask",     "Wired",   "?7",
    "BadVAddr",   "Count",  "EntryHi",  "Compare",      "SR",    "Cause",       "EPC", "PrID", 
    "?16",         "?17",   "WatchLo",  "WatchHi",     "?20",      "?21",       "?22",  "?23",
    "?24",         "?25",       "ECC", "CacheErr",   "TagLo",    "TagHi",  "ErrorEPC",  "?31"
  ];

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

  // cop0 regs
  function rd(i) { return gprRegisterNames[_rd(i)]; }
  function rt(i) { return gprRegisterNames[_rt(i)]; }
  function rs(i) { return gprRegisterNames[_rs(i)]; }

  // cop1 regs
  function fd(i) { return cop1RegisterNames[_rd(i)]; }
  function ft(i) { return cop1RegisterNames[_rt(i)]; }
  function fs(i) { return cop1RegisterNames[_rs(i)]; }

  // cop2 regs
  function gd(i) { return cop2RegisterNames[_rd(i)]; }
  function gt(i) { return cop2RegisterNames[_rt(i)]; }
  function gs(i) { return cop2RegisterNames[_rs(i)]; }
 
  function imm(i) { return '0x' + n64js.toHex( _imm(i), 16 ); }

  function memaccess(r, off) {
    return '[' + r + '+' + off + ']';
  }

  var specialTable = [
    function (a,i) { return i === 0 ? 'NOP' : 'SLL'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'SRL'; },
    function (a,i) { return 'SRA'; },
    function (a,i) { return 'SLLV'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'SRLV'; },
    function (a,i) { return 'SRAV'; },
    function (a,i) { return 'JR'; },
    function (a,i) { return 'JALR'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'SYSCALL'; },
    function (a,i) { return 'BREAK'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'SYNC'; },
    function (a,i) { return 'MFHI'; },
    function (a,i) { return 'MTHI'; },
    function (a,i) { return 'MFLO'; },
    function (a,i) { return 'MTLO'; },
    function (a,i) { return 'DSLLV'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'DSRLV'; },
    function (a,i) { return 'DSRAV'; },
    function (a,i) { return 'MULT'; },
    function (a,i) { return 'MULTU'; },
    function (a,i) { return 'DIV'; },
    function (a,i) { return 'DIVU'; },
    function (a,i) { return 'DMULT'; },
    function (a,i) { return 'DMULTU'; },
    function (a,i) { return 'DDIV'; },
    function (a,i) { return 'DDIVU'; },
    function (a,i) { return 'ADD'; },
    function (a,i) { return 'ADDU'; },
    function (a,i) { return 'SUB'; },
    function (a,i) { return 'SUBU'; },
    function (a,i) { return 'AND'; },
    function (a,i) { return 'OR'; },
    function (a,i) { return 'XOR'; },
    function (a,i) { return 'NOR'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'SLT'; },
    function (a,i) { return 'SLTU'; },
    function (a,i) { return 'DADD'; },
    function (a,i) { return 'DADU'; },
    function (a,i) { return 'DSUB'; },
    function (a,i) { return 'DSUBU'; },
    function (a,i) { return 'TGE'; },
    function (a,i) { return 'TGEU'; },
    function (a,i) { return 'TLT'; },
    function (a,i) { return 'TLTU'; },
    function (a,i) { return 'TEQ'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'TNE'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'DSLL'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'DSRL'; },
    function (a,i) { return 'DSRA'; },
    function (a,i) { return 'DSLL32'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'DSRL32'; },
    function (a,i) { return 'DSRA32'; }
  ];
  if (specialTable.length != 64) {
    throw "Oops, didn't build the special table correctly";
  }

  function disassembleSpecial(a,i) {
    var fn = i & 0x3f;
    return specialTable[fn](a,i);
  }

  var cop0Table = [
    function (a,i) { return 'MFC0'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'MTC0      ' + rt(i) + ' -> ' + cop0ControlRegisterNames[_fs(i)]; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },
    
    function (a,i) { return 'TLB'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },
  ];
  if (cop0Table.length != 32) {
    throw "Oops, didn't build the special table correctly";
  }
  function disassembleCop0(a,i) {
    var fmt = (i>>21) & 0x1f;
    return cop0Table[fmt](a,i);
  }

  var regImmTable = [
    function (a,i) { return 'BLTZ'; },
    function (a,i) { return 'BGEZ'; },
    function (a,i) { return 'BLTZL'; },
    function (a,i) { return 'BGEZL'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },

    function (a,i) { return 'TGEI'; },
    function (a,i) { return 'TGEIU'; },
    function (a,i) { return 'TLTI'; },
    function (a,i) { return 'TLTIU'; },
    function (a,i) { return 'TEQI'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'TNEI'; },
    function (a,i) { return 'Unk'; },
    
    function (a,i) { return 'BLTZAL'; },
    function (a,i) { return 'BGEZAL'; },
    function (a,i) { return 'BLTZALL'; },
    function (a,i) { return 'BGEZALL'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },
  ];
  if (regImmTable.length != 32) {
    throw "Oops, didn't build the special table correctly";
  }  

  function disassembleRegImm(a,i) {
    var rt = (i >> 16) & 0x1f;
    return regImmTable[rt](a,i);
  }

  var simpleTable = [
    disassembleSpecial,
    disassembleRegImm,
    function (a,i) { return 'J         '; },
    function (a,i) { return 'JAL       '; },
    function (a,i) { 
      if (_rs(i) == _rt(i)) {
                     return 'B         --> ' + branchAddress(a,i);
      }
                     return 'BEQ       ' + rs(i) + ' == ' + rt(i) + ' --> ' + branchAddress(a,i); },
    function (a,i) { return 'BNE       ' + rs(i) + ' != ' + rt(i) + ' --> ' + branchAddress(a,i); },
    function (a,i) { return 'BLEZ      ' + rs(i) + ' <= 0 --> ' + branchAddress(a,i); },
    function (a,i) { return 'BGTZ      ' + rs(i) + ' > 0 --> ' + branchAddress(a,i); },
    function (a,i) { return 'ADDI      ' + rt(i) + ' = ' + rs(i) + ' + ' + imm(i); },
    function (a,i) { return 'ADDIU     ' + rt(i) + ' = ' + rs(i) + ' + ' + imm(i); },
    function (a,i) { return 'SLTI      ' + rt(i) + ' = (' + rs(i) + ' < ' + imm(i) + ')'; },
    function (a,i) { return 'SLTIU     ' + rt(i) + ' = (' + rs(i) + ' < ' + imm(i) + ')'; },
    function (a,i) { return 'ANDI      ' + rt(i) + ' = ' + rs(i) + ' & ' + imm(i); },
    function (a,i) { return 'ORI       ' + rt(i) + ' = ' + rs(i) + ' | ' + imm(i); },
    function (a,i) { return 'XORI      ' + rt(i) + ' = ' + rs(i) + ' ^ ' + imm(i); },
    function (a,i) { return 'LUI       ' + rt(i) + ' = ' + imm(i); },
    disassembleCop0,
    function (a,i) { return 'Copro1    '; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'BEQL      ' + rs(i) + ' == ' + rt(i) + ' --> ' + branchAddress(a,i); },
    function (a,i) { return 'BNEL      ' + rs(i) + ' != ' + rt(i) + ' --> ' + branchAddress(a,i); },
    function (a,i) { return 'BLEZL     ' + rs(i) + ' <= 0 --> ' + branchAddress(a,i); },
    function (a,i) { return 'BGTZL     ' + rs(i) + ' > 0 --> ' + branchAddress(a,i); },
    function (a,i) { return 'DADDI     ' + rt(i) + ' = ' + rs(i) + ' + ' + imm(i); },
    function (a,i) { return 'DADDIU    ' + rt(i) + ' = ' + rs(i) + ' + ' + imm(i); },
    function (a,i) { return 'LDL       ' + rt(i) + ' <- ' + memaccess(rs(i), imm(i)); },
    function (a,i) { return 'LDR       ' + rt(i) + ' <- ' + memaccess(rs(i), imm(i)); },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'LB        ' + rt(i) + ' <- ' + memaccess(rs(i), imm(i)); },
    function (a,i) { return 'LH        ' + rt(i) + ' <- ' + memaccess(rs(i), imm(i)); },
    function (a,i) { return 'LWL       ' + rt(i) + ' <- ' + memaccess(rs(i), imm(i)); },
    function (a,i) { return 'LW        ' + rt(i) + ' <- ' + memaccess(rs(i), imm(i)); },
    function (a,i) { return 'LBU       ' + rt(i) + ' <- ' + memaccess(rs(i), imm(i)); },
    function (a,i) { return 'LHU       ' + rt(i) + ' <- ' + memaccess(rs(i), imm(i)); },
    function (a,i) { return 'LWR       ' + rt(i) + ' <- ' + memaccess(rs(i), imm(i)); },
    function (a,i) { return 'LWU       ' + rt(i) + ' <- ' + memaccess(rs(i), imm(i)); },
    function (a,i) { return 'SB        ' + rt(i) + ' -> ' + memaccess(rs(i), imm(i)); },
    function (a,i) { return 'SH        ' + rt(i) + ' -> ' + memaccess(rs(i), imm(i)); },
    function (a,i) { return 'SWL       ' + rt(i) + ' -> ' + memaccess(rs(i), imm(i)); },
    function (a,i) { return 'SW        ' + rt(i) + ' -> ' + memaccess(rs(i), imm(i)); },
    function (a,i) { return 'SDL       ' + rt(i) + ' -> ' + memaccess(rs(i), imm(i)); },
    function (a,i) { return 'SDR       ' + rt(i) + ' -> ' + memaccess(rs(i), imm(i)); },
    function (a,i) { return 'SWR       ' + rt(i) + ' -> ' + memaccess(rs(i), imm(i)); },
    function (a,i) { return 'CACHE     ' + n64js.toHex(_rt(i),8) + memaccess(rs(i), imm(i)); },
    function (a,i) { return 'LL        ' + rt(i) + ' <- ' + memaccess(rs(i), imm(i)); },
    function (a,i) { return 'LWC1      ' + ft(i) + ' <- ' + memaccess(rs(i), imm(i)); },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'LLD       ' + rt(i) + ' <- ' + memaccess(rs(i), imm(i)); },
    function (a,i) { return 'LDC1      ' + ft(i) + ' <- ' + memaccess(rs(i), imm(i)); },
    function (a,i) { return 'LDC2      ' + gt(i) + ' <- ' + memaccess(rs(i), imm(i)); },
    function (a,i) { return 'LD        ' + rt(i) + ' <- ' + memaccess(rs(i), imm(i)); },
    function (a,i) { return 'SC        ' + rt(i) + ' -> ' + memaccess(rs(i), imm(i)); },
    function (a,i) { return 'SWC1      ' + ft(i) + ' -> ' + memaccess(rs(i), imm(i)); },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'Unk'; },
    function (a,i) { return 'SCD       ' + rt(i) + ' -> ' + memaccess(rs(i), imm(i)); },
    function (a,i) { return 'SDC1      ' + ft(i) + ' -> ' + memaccess(rs(i), imm(i)); },
    function (a,i) { return 'SDC2      ' + gt(i) + ' -> ' + memaccess(rs(i), imm(i)); },
    function (a,i) { return 'SD        ' + rt(i) + ' -> ' + memaccess(rs(i), imm(i)); }
  ];
  if (simpleTable.length != 64) {
    throw "Oops, didn't build the simple table correctly";
  }

  function disassembleOp(a,i) {
    var opcode = (i >> 26) & 0x3f;

    return simpleTable[opcode](a,i);
  }
  
  n64js.disassemble = function (bpc, epc) {

    var r = [];

    for (var i = bpc; i < epc; i += 4) {
      try {
        var instruction = n64js.readMemoryInternal32(i);

        var disassembly = disassembleOp(i, instruction);

        r.push({address:i, instruction:instruction, disassembly:disassembly});

      } catch (e) {
        throw e;
        break;
      }
    }

    return r;
  }

})();