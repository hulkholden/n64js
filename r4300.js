if (typeof n64js === 'undefined') {
  var n64js = {};
}

(function () {'use strict';

  var kRegister_ra = 0x1f;

  function     fd(i) { return (i>>> 6)&0x1f; }
  function     fs(i) { return (i>>>11)&0x1f; }
  function     ft(i) { return (i>>>16)&0x1f; }
  function  copop(i) { return (i>>>21)&0x1f; }

  function offset(i) { return ((i&0xffff)<<16)>>16; }
  function     sa(i) { return (i>>> 6)&0x1f; }
  function     rd(i) { return (i>>>11)&0x1f; }
  function     rt(i) { return (i>>>16)&0x1f; }
  function     rs(i) { return (i>>>21)&0x1f; }
  function     op(i) { return (i>>>26)&0x1f; }

  function target(i) { return (i     )&0x3ffffff; }
  function    imm(i) { return (i     )&0xffff; }
  function   imms(i) { return ((i&0xffff)<<16)>>16; }   // treat immediate value as signed
  function   base(i) { return (i>>>21)&0x1f; }

  function memaddr(i) {
      return n64js.cpu0.gprLo[base(i)] + imms(i);
  }

  function branchAddress(a,i) { return ((a+4) + (offset(i)*4))>>>0; }
  function   jumpAddress(a,i) { return ((a&0xf0000000) | (target(i)*4))>>>0; }

  function setSignExtend(r,v) {
    n64js.cpu0.gprLo[r] = v;
    n64js.cpu0.gprHi[r] = (v & 0x80000000) ? 0xffffffff : 0x00000000;  // sign-extend
  }

  function setZeroExtend(r, v) {
    n64js.cpu0.gprLo[r] = v;
    n64js.cpu0.gprHi[r] = 0x00000000;
  }

  function setHiLoSignExtend(arr, v) {
    arr[0] = (v&0xffffffff) >>> 0;
    arr[1] = v>>>32;
  }


  function unimplemented(a,i) {
    var r = n64js.disassembleOp(a,i);
    var e = 'Unimplemented op ' + n64js.toHex(i,32) + ' : ' + r.disassembly + '<br>';

    $('#output').append(e);
    throw e;
  }

  function executeUnknown(a,i) {
    throw 'unimplemented op: ' + n64js.toHex(a,32) + ', ' + n64js.toHex(i, 32);
  }

  function executeSLL(a,i) {
    // Special-case NOP
    if (i == 0)
      return;

    setSignExtend( rd(i), ((n64js.cpu0.gprLo[rt(i)] << sa(i)) & 0xffffffff)>>>0 );
  }

  function executeSRL(a,i) {
    setSignExtend( rd(i), n64js.cpu0.gprLo[rt(i)] >> sa(i) );
  }
  function executeSRA(a,i) {
    setSignExtend( rd(i), n64js.cpu0.gprLo[rt(i)] >>> sa(i) );
  }
  function executeSLLV(a,i) {
    setSignExtend( rd(i), (n64js.cpu0.gprLo[rt(i)] <<  (n64js.cpu0.gprLo[rs(i)] & 0x1f)) & 0xffffffff );
  }
  function executeSRLV(a,i) {
    setSignExtend( rd(i),  n64js.cpu0.gprLo[rt(i)] >>> (n64js.cpu0.gprLo[rs(i)] & 0x1f) );
  }
  function executeSRAV(a,i) {
    setSignExtend( rd(i),  n64js.cpu0.gprLo[rt(i)] >>  (n64js.cpu0.gprLo[rs(i)] & 0x1f) );
  }
  function executeJR(a,i) {
    n64js.cpu0.branch( n64js.cpu0.gprLo[rs(i)] );
  }
  function executeJALR(a,i)       { unimplemented(a,i); }
  function executeSYSCALL(a,i)    { unimplemented(a,i); }
  function executeBREAK(a,i)      { unimplemented(a,i); }
  function executeSYNC(a,i)       { unimplemented(a,i); }
  function executeMFHI(a,i) {
    n64js.cpu0.gprHi[rd(i)] = n64js.cpu0.multHi[1]; 
    n64js.cpu0.gprLo[rd(i)] = n64js.cpu0.multHi[0]; 
  }
  function executeMTHI(a,i) {

  }
  function executeMFLO(a,i) {
    n64js.cpu0.gprHi[rd(i)] = n64js.cpu0.multLo[1]; 
    n64js.cpu0.gprLo[rd(i)] = n64js.cpu0.multLo[0]; 
  }
  function executeMTLO(a,i)       { unimplemented(a,i); }
  function executeDSLLV(a,i)      { unimplemented(a,i); }
  function executeDSRLV(a,i)      { unimplemented(a,i); }
  function executeDSRAV(a,i)      { unimplemented(a,i); }
  function executeMULT(a,i) {
    var result = n64js.cpu0.gprLo[rs(i)] * n64js.cpu0.gprLo[rt(i)];   // needs to be 64-bit *signed*!
    var lo = (result&0xffffffff)>>>0;
    var hi = (result>>>32);
    setHiLoSignExtend( n64js.cpu0.multLo, lo );
    setHiLoSignExtend( n64js.cpu0.multHi, hi );
  }
  function executeMULTU(a,i) {
    var result = n64js.cpu0.gprLo[rs(i)] * n64js.cpu0.gprLo[rt(i)];   // needs to be 64-bit!
    var lo = (result&0xffffffff)>>>0;
    var hi = (result>>>32);
    setHiLoSignExtend( n64js.cpu0.multLo, lo );
    setHiLoSignExtend( n64js.cpu0.multHi, hi );
  }
  function executeDIV(a,i)        { unimplemented(a,i); }
  function executeDIVU(a,i)       { unimplemented(a,i); }
  function executeDMULT(a,i)      { unimplemented(a,i); }
  function executeDMULTU(a,i)     { unimplemented(a,i); }
  function executeDDIV(a,i)       { unimplemented(a,i); }
  function executeDDIVU(a,i)      { unimplemented(a,i); }

  function executeADD(a,i) {
    setSignExtend( rd(i), n64js.cpu0.gprLo[rs(i)] + n64js.cpu0.gprLo[rt(i)] ); // s32 + s32    
  }
  function executeADDU(a,i) {
    setSignExtend( rd(i), n64js.cpu0.gprLo[rs(i)] + n64js.cpu0.gprLo[rt(i)] ); // s32 + s32
  }

  function executeSUB(a,i) {
    setSignExtend( rd(i), n64js.cpu0.gprLo[rs(i)] - n64js.cpu0.gprLo[rt(i)] ); // s32 - s32    
  }
  function executeSUBU(a,i) {
    setSignExtend( rd(i), n64js.cpu0.gprLo[rs(i)] - n64js.cpu0.gprLo[rt(i)] ); // s32 - s32
  }

  function executeAND(a,i) {
    n64js.cpu0.gprHi[rd(i)] = n64js.cpu0.gprHi[rs(i)] & n64js.cpu0.gprHi[rt(i)];
    n64js.cpu0.gprLo[rd(i)] = n64js.cpu0.gprLo[rs(i)] & n64js.cpu0.gprLo[rt(i)];    
  }

  function executeOR(a,i) {
    n64js.cpu0.gprHi[rd(i)] = n64js.cpu0.gprHi[rs(i)] | n64js.cpu0.gprHi[rt(i)];
    n64js.cpu0.gprLo[rd(i)] = n64js.cpu0.gprLo[rs(i)] | n64js.cpu0.gprLo[rt(i)];
  }

  function executeXOR(a,i) {
    n64js.cpu0.gprHi[rd(i)] = n64js.cpu0.gprHi[rs(i)] ^ n64js.cpu0.gprHi[rt(i)];
    n64js.cpu0.gprLo[rd(i)] = n64js.cpu0.gprLo[rs(i)] ^ n64js.cpu0.gprLo[rt(i)];
  }

  function executeNOR(a,i)        { unimplemented(a,i); }
  function executeSLT(a,i) {
    var r = 0;
    // FIXME: this needs to do a signed compare. 
    if (n64js.cpu0.gprHi[rs(i)] < n64js.cpu0.gprHi[rt(i)] ||
        (n64js.cpu0.gprHi[rs(i)] === n64js.cpu0.gprHi[rt(i)] && n64js.cpu0.gprLo[rs(i)] < n64js.cpu0.gprLo[rt(i)])) {
      r = 1;
    }
    setZeroExtend(rd(i), r);
  }
  function executeSLTU(a,i) {
    var r = 0;
    if (n64js.cpu0.gprHi[rs(i)] < n64js.cpu0.gprHi[rt(i)] ||
        (n64js.cpu0.gprHi[rs(i)] === n64js.cpu0.gprHi[rt(i)] && n64js.cpu0.gprLo[rs(i)] < n64js.cpu0.gprLo[rt(i)])) {
      r = 1;
    }
    setZeroExtend(rd(i), r);
  }
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
  function executeMTC0(a,i)       { /* FIXME */; }
  function executeTLB(a,i)        { unimplemented(a,i); }
  function executeBLTZ(a,i) {
    if ((n64js.cpu0.gprHi[rs(i)] & 0x80000000) !== 0) {

      // NB: if imms(i) == -1 then this is a branch to self/busywait
      n64js.cpu0.branch( branchAddress(a,i) );
    }
  }
  function executeBGEZ(a,i) {
    if ((n64js.cpu0.gprHi[rs(i)] & 0x80000000) === 0) {

      // NB: if imms(i) == -1 then this is a branch to self/busywait
      n64js.cpu0.branch( branchAddress(a,i) );
    }
  }
  function executeBLTZL(a,i) {
    if ((n64js.cpu0.gprHi[rs(i)] & 0x80000000) !== 0) {

      // NB: if imms(i) == -1 then this is a branch to self/busywait
      n64js.cpu0.branch( branchAddress(a,i) );
    } else {
      n64js.cpu0.pc += 4;   // skip the next instruction
    }
  }
  function executeBGEZL(a,i) {
    if ((n64js.cpu0.gprHi[rs(i)] & 0x80000000) === 0) {

      // NB: if imms(i) == -1 then this is a branch to self/busywait
      n64js.cpu0.branch( branchAddress(a,i) );
    } else {
      n64js.cpu0.pc += 4;   // skip the next instruction
    }
  }
  function executeTGEI(a,i)       { unimplemented(a,i); }
  function executeTGEIU(a,i)      { unimplemented(a,i); }
  function executeTLTI(a,i)       { unimplemented(a,i); }
  function executeTLTIU(a,i)      { unimplemented(a,i); }
  function executeTEQI(a,i)       { unimplemented(a,i); }
  function executeTNEI(a,i)       { unimplemented(a,i); }

  function executeBLTZAL(a,i) {
    setSignExtend(kRegister_ra, n64js.cpu0.pc + 8);
    if ((n64js.cpu0.gprHi[rs(i)] & 0x80000000) !== 0) {
      n64js.cpu0.branch( branchAddress(a,i) );
    }
  }
  function executeBGEZAL(a,i) {
    setSignExtend(kRegister_ra, n64js.cpu0.pc + 8);
    if ((n64js.cpu0.gprHi[rs(i)] & 0x80000000) === 0) {
      n64js.cpu0.branch( branchAddress(a,i) );
    }
  }

  function executeBLTZALL(a,i)    { unimplemented(a,i); }
  function executeBGEZALL(a,i)    { unimplemented(a,i); }
  function executeJ(a,i)          { unimplemented(a,i); }
  function executeJAL(a,i) {
    setSignExtend(kRegister_ra, n64js.cpu0.pc + 8);
    n64js.cpu0.branch( jumpAddress(a,i) );
  }
  function executeBEQ(a,i) {
    if (n64js.cpu0.gprLo[rs(i)] === n64js.cpu0.gprLo[rt(i)]) {
      // NB: if imms(i) == -1 then this is a branch to self/busywait
      n64js.cpu0.branch( branchAddress(a,i) );
    }
  }
  function executeBNE(a,i)        {
    if (n64js.cpu0.gprLo[rs(i)] !== n64js.cpu0.gprLo[rt(i)]) {
      // NB: if imms(i) == -1 then this is a branch to self/busywait
      n64js.cpu0.branch( branchAddress(a,i) );
    }
  }
  function executeBLEZ(a,i)       { unimplemented(a,i); }
  function executeBGTZ(a,i)       { unimplemented(a,i); }
  function executeADDI(a,i)       {
    var a = n64js.cpu0.gprLo[rs(i)];
    var v = imms(i);
    setSignExtend(rt(i), a + v);
  }
  function executeADDIU(a,i)      {
    var a = n64js.cpu0.gprLo[rs(i)];
    var v = imms(i);
    setSignExtend(rt(i), a + v);
  }
  function executeSLTI(a,i) {
    // FIXME: this needs to do a full 64bit compare?
    n64js.cpu0.gprHi[rt(i)] = 0;
    n64js.cpu0.gprLo[rt(i)] = n64js.cpu0.gprLo[rs(i)] < imms(i) ? 1 : 0;
  }
  function executeSLTIU(a,i)      { unimplemented(a,i); }
  
  function executeANDI(a,i) {
    n64js.cpu0.gprHi[rt(i)] = 0;    // always 0, as sign extended immediate value is always 0
    n64js.cpu0.gprLo[rt(i)] = n64js.cpu0.gprLo[rs(i)] & imm(i);    
  }
  
  function executeORI(a,i) {
    n64js.cpu0.gprHi[rt(i)] = n64js.cpu0.gprHi[rs(i)];
    n64js.cpu0.gprLo[rt(i)] = n64js.cpu0.gprLo[rs(i)] | imm(i);
  }
  
  function executeXORI(a,i) {
    // High 32 bits are always unchanged, as sign extended immediate value is always 0
    var lo = n64js.cpu0.gprLo[rs(i)] ^ imm(i);
    n64js.cpu0.gprLo[rt(i)] = lo;    
  }
  
  function executeLUI(a,i) {
    var v  = imms(i) << 16;
    setSignExtend(rt(i), v);
  }
  
  function executeCop0(a,i)       { unimplemented(a,i); }
  function executeCopro1(a,i)     { unimplemented(a,i); }
  function executeBEQL(a,i) {
    if (n64js.cpu0.gprHi[rs(i)] === n64js.cpu0.gprHi[rt(i)] &&
        n64js.cpu0.gprLo[rs(i)] === n64js.cpu0.gprLo[rt(i)] ) {

      // NB: if imms(i) == -1 then this is a branch to self/busywait
      n64js.cpu0.branch( branchAddress(a,i) );
    } else {
      n64js.cpu0.pc += 4;   // skip the next instruction
    }
  }
  function executeBNEL(a,i) {
    if (n64js.cpu0.gprHi[rs(i)] !== n64js.cpu0.gprHi[rt(i)] ||
        n64js.cpu0.gprLo[rs(i)] !== n64js.cpu0.gprLo[rt(i)] ) {

      // NB: if imms(i) == -1 then this is a branch to self/busywait
      n64js.cpu0.branch( branchAddress(a,i) );
    } else {
      n64js.cpu0.pc += 4;   // skip the next instruction
    }
  }
  function executeBLEZL(a,i) {
    var hi = n64js.cpu0.gprHi[rs(i)];
    var lo = n64js.cpu0.gprLo[rs(i)];
    if ( (hi & 0x80000000) !== 0 || (hi === 0 && (lo & 0x80000000) !== 0) ) {

      // NB: if rs == r0 then this branch is always taken
      // NB: if imms(i) == -1 then this is a branch to self/busywait
      n64js.cpu0.branch( branchAddress(a,i) );
    } else {
      n64js.cpu0.pc += 4;   // skip the next instruction
    }
  }

  function executeBGTZL(a,i)      { unimplemented(a,i); }
  function executeDADDI(a,i)      { unimplemented(a,i); }
  function executeDADDIU(a,i)     { unimplemented(a,i); }
  function executeLDL(a,i)        { unimplemented(a,i); }
  function executeLDR(a,i)        { unimplemented(a,i); }
  function executeLB(a,i)         { unimplemented(a,i); }
  function executeLH(a,i)         { unimplemented(a,i); }
  function executeLWL(a,i)        { unimplemented(a,i); }
  function executeLW(a,i)         {
    // SF2049 requires this, apparently
    if (rt(i) == 0)
      return;
    setSignExtend(rt(i), n64js.readMemory32( memaddr(i) ));
  }
  function executeLBU(a,i) {
    setZeroExtend(rt(i), n64js.readMemory8( memaddr(i) ));
  }
  function executeLHU(a,i)        { unimplemented(a,i); }
  function executeLWR(a,i)        { unimplemented(a,i); }
  function executeLWU(a,i)        { unimplemented(a,i); }
  function executeSB(a,i) {
    n64js.writeMemory8(memaddr(i), n64js.cpu0.gprLo[rt(i)] & 0xff );
  }
  function executeSH(a,i)         { unimplemented(a,i); }
  function executeSWL(a,i)        { unimplemented(a,i); }
  function executeSW(a,i)         {
    n64js.writeMemory32(memaddr(i), n64js.cpu0.gprLo[rt(i)]);
  }
  function executeSDL(a,i)        { unimplemented(a,i); }
  function executeSDR(a,i)        { unimplemented(a,i); }
  function executeSWR(a,i)        { unimplemented(a,i); }
  function executeCACHE(a,i) {
    // ignore!
  }
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

    cpu0.halt = false;

    for (var i = 0; i < cycles && !cpu0.halt; ++i) {
        try {
          var pc  = cpu0.pc;
          var dpc = cpu0.delayPC;

          var instruction = n64js.readMemory32(pc);
          executeOp(pc, instruction);

          if (dpc !== 0) {
            cpu0.delayPC = 0;
            cpu0.pc      = dpc;
          } else {
            cpu0.pc      += 4;
          }

          ++cpu0.opsExecuted;

        } catch (e) {
          n64js.halt('Exception :' + e);
          break;
        }
    }

    n64js.refreshDisplay();
  }

})();