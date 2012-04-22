if (typeof n64js === 'undefined') {
  var n64js = {};
}

(function () {'use strict';

  function     fd(i) { return (i>>> 6)&0x1f; }
  function     fs(i) { return (i>>>11)&0x1f; }
  function     ft(i) { return (i>>>16)&0x1f; }
  function  copop(i) { return (i>>>21)&0x1f; }

  function offset(i) { return (i     )&0xffff; }
  function     sa(i) { return (i>>> 6)&0x1f; }
  function     rd(i) { return (i>>>11)&0x1f; }
  function     rt(i) { return (i>>>16)&0x1f; }
  function     rs(i) { return (i>>>21)&0x1f; }
  function     op(i) { return (i>>>26)&0x1f; }

  function target(i) { return (i     )&0x3ffffff; }
  function    imm(i) { return (i     )&0xffff; }
  function   imms(i) { return (imm(i)<<16)>>16; }   // treat immediate value as signed
  function   base(i) { return (i>>>21)&0x1f; }

  function branchAddress(a,i) { return (a+4) + (_imms(i)*4); }
  function   jumpAddress(a,i) { return (a&0xf0000000) | (_target(i)*4); }

  function unimplemented(a,i) {
    var r = n64js.disassembleOp(a,i);
    var e = 'Unimplemented op ' + i + ' : ' + r.disassembly;

    $('#output').append(e);
    throw e;
  }

  function executeUnknown(a,i) {
    throw 'unimplemented op: ' + n64js.toHex(a,32) + ', ' + n64js.toHex(i, 32);
  }

  function executeSLL(a,i) {
    // Special-case NOP
    if (i == 0 || rd(i) == 0)
      return;
    throw 'SLL unimplemented';
  }

  function executeSRL(a,i)        { unimplemented(a,i); }
  function executeSRA(a,i)        { unimplemented(a,i); }
  function executeSLLV(a,i)       { unimplemented(a,i); }
  function executeSRLV(a,i)       { unimplemented(a,i); }
  function executeSRAV(a,i)       { unimplemented(a,i); }
  function executeJR(a,i)         { unimplemented(a,i); }
  function executeJALR(a,i)       { unimplemented(a,i); }
  function executeSYSCALL(a,i)    { unimplemented(a,i); }
  function executeBREAK(a,i)      { unimplemented(a,i); }
  function executeSYNC(a,i)       { unimplemented(a,i); }
  function executeMFHI(a,i)       { unimplemented(a,i); }
  function executeMTHI(a,i)       { unimplemented(a,i); }
  function executeMFLO(a,i)       { unimplemented(a,i); }
  function executeMTLO(a,i)       { unimplemented(a,i); }
  function executeDSLLV(a,i)      { unimplemented(a,i); }
  function executeDSRLV(a,i)      { unimplemented(a,i); }
  function executeDSRAV(a,i)      { unimplemented(a,i); }
  function executeMULT(a,i)       { unimplemented(a,i); }
  function executeMULTU(a,i)      { unimplemented(a,i); }
  function executeDIV(a,i)        { unimplemented(a,i); }
  function executeDIVU(a,i)       { unimplemented(a,i); }
  function executeDMULT(a,i)      { unimplemented(a,i); }
  function executeDMULTU(a,i)     { unimplemented(a,i); }
  function executeDDIV(a,i)       { unimplemented(a,i); }
  function executeDDIVU(a,i)      { unimplemented(a,i); }
  function executeADD(a,i)        { unimplemented(a,i); }
  function executeADDU(a,i)       { unimplemented(a,i); }
  function executeSUB(a,i)        { unimplemented(a,i); }
  function executeSUBU(a,i)       { unimplemented(a,i); }
  function executeAND(a,i)        { unimplemented(a,i); }
  function executeOR(a,i)         { unimplemented(a,i); }
  function executeXOR(a,i)        { unimplemented(a,i); }
  function executeNOR(a,i)        { unimplemented(a,i); }
  function executeSLT(a,i)        { unimplemented(a,i); }
  function executeSLTU(a,i)       { unimplemented(a,i); }
  function executeDADD(a,i)       { unimplemented(a,i); }
  function executeDADDU(a,i)      { unimplemented(a,i); }
  function executeDSUB(a,i)       { unimplemented(a,i); }
  function executeDSUBU(a,i)      { unimplemented(a,i); }
  function executeTGE(a,i)        { unimplemented(a,i); }
  function executeTGEU(a,i)       { unimplemented(a,i); }
  function executeTLT(a,i)        { unimplemented(a,i); }
  function executeTLTU(a,i)       { unimplemented(a,i); }
  function executeTEQ(a,i)        { unimplemented(a,i); }
  function executeTNE(a,i)        { unimplemented(a,i); }
  function executeDSLL(a,i)       { unimplemented(a,i); }
  function executeDSRL(a,i)       { unimplemented(a,i); }
  function executeDSRA(a,i)       { unimplemented(a,i); }
  function executeDSLL32(a,i)     { unimplemented(a,i); }
  function executeDSRL32(a,i)     { unimplemented(a,i); }
  function executeDSRA32(a,i)     { unimplemented(a,i); }
  function executeMFC0(a,i)       { unimplemented(a,i); }
  function executeMTC0(a,i)       { unimplemented(a,i); }
  function executeTLB(a,i)        { unimplemented(a,i); }
  function executeBLTZ(a,i)       { unimplemented(a,i); }
  function executeBGEZ(a,i)       { unimplemented(a,i); }
  function executeBLTZL(a,i)      { unimplemented(a,i); }
  function executeBGEZL(a,i)      { unimplemented(a,i); }
  function executeTGEI(a,i)       { unimplemented(a,i); }
  function executeTGEIU(a,i)      { unimplemented(a,i); }
  function executeTLTI(a,i)       { unimplemented(a,i); }
  function executeTLTIU(a,i)      { unimplemented(a,i); }
  function executeTEQI(a,i)       { unimplemented(a,i); }
  function executeTNEI(a,i)       { unimplemented(a,i); }
  function executeBLTZAL(a,i)     { unimplemented(a,i); }
  function executeBGEZAL(a,i)     { unimplemented(a,i); }
  function executeBLTZALL(a,i)    { unimplemented(a,i); }
  function executeBGEZALL(a,i)    { unimplemented(a,i); }
  function executeJ(a,i)          { unimplemented(a,i); }
  function executeJAL(a,i)        { unimplemented(a,i); }
  function executeBEQ(a,i)        { unimplemented(a,i); }
  function executeBNE(a,i)        { unimplemented(a,i); }
  function executeBLEZ(a,i)       { unimplemented(a,i); }
  function executeBGTZ(a,i)       { unimplemented(a,i); }
  function executeADDI(a,i)       { unimplemented(a,i); }
  function executeADDIU(a,i)      { unimplemented(a,i); }
  function executeSLTI(a,i)       { unimplemented(a,i); }
  function executeSLTIU(a,i)      { unimplemented(a,i); }
  function executeANDI(a,i)       { unimplemented(a,i); }
  function executeORI(a,i)        { unimplemented(a,i); }
  function executeXORI(a,i)       { unimplemented(a,i); }
  function executeLUI(a,i)        { unimplemented(a,i); }
  function executeCop0(a,i)       { unimplemented(a,i); }
  function executeCopro1(a,i)     { unimplemented(a,i); }
  function executeBEQL(a,i)       { unimplemented(a,i); }
  function executeBNEL(a,i)       { unimplemented(a,i); }
  function executeBLEZL(a,i)      { unimplemented(a,i); }
  function executeBGTZL(a,i)      { unimplemented(a,i); }
  function executeDADDI(a,i)      { unimplemented(a,i); }
  function executeDADDIU(a,i)     { unimplemented(a,i); }
  function executeLDL(a,i)        { unimplemented(a,i); }
  function executeLDR(a,i)        { unimplemented(a,i); }
  function executeLB(a,i)         { unimplemented(a,i); }
  function executeLH(a,i)         { unimplemented(a,i); }
  function executeLWL(a,i)        { unimplemented(a,i); }
  function executeLW(a,i)         { unimplemented(a,i); }
  function executeLBU(a,i)        { unimplemented(a,i); }
  function executeLHU(a,i)        { unimplemented(a,i); }
  function executeLWR(a,i)        { unimplemented(a,i); }
  function executeLWU(a,i)        { unimplemented(a,i); }
  function executeSB(a,i)         { unimplemented(a,i); }
  function executeSH(a,i)         { unimplemented(a,i); }
  function executeSWL(a,i)        { unimplemented(a,i); }
  function executeSW(a,i)         { unimplemented(a,i); }
  function executeSDL(a,i)        { unimplemented(a,i); }
  function executeSDR(a,i)        { unimplemented(a,i); }
  function executeSWR(a,i)        { unimplemented(a,i); }
  function executeCACHE(a,i)      { unimplemented(a,i); }
  function executeLL(a,i)         { unimplemented(a,i); }
  function executeLWC1(a,i)       { unimplemented(a,i); }
  function executeLLD(a,i)        { unimplemented(a,i); }
  function executeLDC1(a,i)       { unimplemented(a,i); }
  function executeLDC2(a,i)       { unimplemented(a,i); }
  function executeLD(a,i)         { unimplemented(a,i); }
  function executeSC(a,i)         { unimplemented(a,i); }
  function executeSWC1(a,i)       { unimplemented(a,i); }
  function executeSCD(a,i)        { unimplemented(a,i); }
  function executeSDC1(a,i)       { unimplemented(a,i); }
  function executeSDC2(a,i)       { unimplemented(a,i); }
  function executeSD(a,i)         { unimplemented(a,i); }  

  var specialTable = [
    executeSLL,
    executeUnknown,
    executeSRL,
    executeSRA,
    executeSLLV,
    executeUnknown,
    executeSRLV,
    executeSRAV,
    executeJR,
    executeJALR,
    executeUnknown,
    executeUnknown,
    executeSYSCALL,
    executeBREAK,
    executeUnknown,
    executeSYNC,
    executeMFHI,
    executeMTHI,
    executeMFLO,
    executeMTLO,
    executeDSLLV,
    executeUnknown,
    executeDSRLV,
    executeDSRAV,
    executeMULT,
    executeMULTU,
    executeDIV,
    executeDIVU,
    executeDMULT,
    executeDMULTU,
    executeDDIV,
    executeDDIVU,
    executeADD,
    executeADDU,
    executeSUB,
    executeSUBU,
    executeAND,
    executeOR,
    executeXOR,
    executeNOR,
    executeUnknown,
    executeUnknown,
    executeSLT,
    executeSLTU,
    executeDADD,
    executeDADDU,
    executeDSUB,
    executeDSUBU,
    executeTGE,
    executeTGEU,
    executeTLT,
    executeTLTU,
    executeTEQ,
    executeUnknown,
    executeTNE,
    executeUnknown,
    executeDSLL,
    executeUnknown,
    executeDSRL,
    executeDSRA,
    executeDSLL32,
    executeUnknown,
    executeDSRL32,
    executeDSRA32
  ];
  if (specialTable.length != 64) {
    throw "Oops, didn't build the special table correctly";
  }

  function executeSpecial(a,i) {
    var fn = i & 0x3f;
    return specialTable[fn](a,i);
  }

  var cop0Table = [
    executeMFC0,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeMTC0,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    
    executeTLB,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
  ];
  if (cop0Table.length != 32) {
    throw "Oops, didn't build the special table correctly";
  }
  function executeCop0(a,i) {
    var fmt = (i>>21) & 0x1f;
    return cop0Table[fmt](a,i);
  }

  var regImmTable = [
    executeBLTZ,
    executeBGEZ,
    executeBLTZL,
    executeBGEZL,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,

    executeTGEI,
    executeTGEIU,
    executeTLTI,
    executeTLTIU,
    executeTEQI,
    executeUnknown,
    executeTNEI,
    executeUnknown,
    
    executeBLTZAL,
    executeBGEZAL,
    executeBLTZALL,
    executeBGEZALL,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
  ];
  if (regImmTable.length != 32) {
    throw "Oops, didn't build the special table correctly";
  }  

  function executeRegImm(a,i) {
    var rt = (i >> 16) & 0x1f;
    return regImmTable[rt](a,i);
  }

  var simpleTable = [
    executeSpecial,
    executeRegImm,
    executeJ,
    executeJAL,
    executeBEQ,
    executeBNE,
    executeBLEZ,
    executeBGTZ,
    executeADDI,
    executeADDIU,
    executeSLTI,
    executeSLTIU,
    executeANDI,
    executeORI,
    executeXORI,
    executeLUI,
    executeCop0,
    executeCopro1,
    executeUnknown,
    executeUnknown,
    executeBEQL,
    executeBNEL,
    executeBLEZL,
    executeBGTZL,
    executeDADDI,
    executeDADDIU,
    executeLDL,
    executeLDR,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeLB,
    executeLH,
    executeLWL,
    executeLW,
    executeLBU,
    executeLHU,
    executeLWR,
    executeLWU,
    executeSB,
    executeSH,
    executeSWL,
    executeSW,
    executeSDL,
    executeSDR,
    executeSWR,
    executeCACHE,
    executeLL,
    executeLWC1,
    executeUnknown,
    executeUnknown,
    executeLLD,
    executeLDC1,
    executeLDC2,
    executeLD,
    executeSC,
    executeSWC1,
    executeUnknown,
    executeUnknown,
    executeSCD,
    executeSDC1,
    executeSDC2,
    executeSD,
  ];
  if (simpleTable.length != 64) {
    throw "Oops, didn't build the simple table correctly";
  }

  function executeOp(a,i) {
    var opcode = (i >> 26) & 0x3f;

    return simpleTable[opcode](a,i);
  }

  n64js.step = function () {
    n64js.run(1);
  }

  n64js.run = function (cycles) {

    var cpu0 = n64js.cpu0;

    for (var i = 0; i < cycles; ++i) {
        try {
          var instruction = n64js.readMemoryInternal32(cpu0.pc);
          executeOp(cpu0.pc, instruction);

        } catch (e) {
          throw e;
        }
    }
  }

})();