if (typeof n64js === 'undefined') {
  var n64js = {};
}

(function () {'use strict';

  function CPU0() {

    this.gprLoMem = new ArrayBuffer(32*4);
    this.gprHiMem = new ArrayBuffer(32*4);

    this.gprLo   = new Uint32Array(this.gprLoMem);
    this.gprHi   = new Uint32Array(this.gprHiMem);
    this.gprLo_signed   = new Int32Array(this.gprLoMem);
    this.gprHi_signed   = new Int32Array(this.gprHiMem);

    this.control = new Uint32Array(32);

    this.pc      = 0;
    this.delayPC = 0;

    this.halt = false;     // used to flag r4300 to cease execution

    this.multHi = new Uint32Array(2);
    this.multLo = new Uint32Array(2);

    this.opsExecuted = 0;

    this.reset = function () {

      for (var i = 0; i < 32; ++i) {
        this.gprLo[i]   = 0;
        this.gprHi[i]   = 0;
        this.control[i] = 0;
      }

      this.pc          = 0;
      this.delayPC     = 0;

      this.multLo[0]   = this.multLo[1] = 0;
      this.multHi[0]   = this.multHi[1] = 0;

      this.opsExecuted = 0;
    };

    this.gprRegisterNames = [
            "r0", "at", "v0", "v1", "a0", "a1", "a2", "a3",
            "t0", "t1", "t2", "t3", "t4", "t5", "t6", "t7",
            "s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7",
            "t8", "t9", "k0", "k1", "gp", "sp", "s8", "ra",
    ];

    // General purpose register constants
    this.kRegister_r0 = 0x00;
    this.kRegister_at = 0x01;
    this.kRegister_v0 = 0x02;
    this.kRegister_v1 = 0x03;
    this.kRegister_a0 = 0x04;
    this.kRegister_a1 = 0x05;
    this.kRegister_a2 = 0x06;
    this.kRegister_a3 = 0x07;
    this.kRegister_t0 = 0x08;
    this.kRegister_t1 = 0x09;
    this.kRegister_t2 = 0x0a;
    this.kRegister_t3 = 0x0b;
    this.kRegister_t4 = 0x0c;
    this.kRegister_t5 = 0x0d;
    this.kRegister_t6 = 0x0e;
    this.kRegister_t7 = 0x0f;
    this.kRegister_s0 = 0x10;
    this.kRegister_s1 = 0x11;
    this.kRegister_s2 = 0x12;
    this.kRegister_s3 = 0x13;
    this.kRegister_s4 = 0x14;
    this.kRegister_s5 = 0x15;
    this.kRegister_s6 = 0x16;
    this.kRegister_s7 = 0x17;
    this.kRegister_t8 = 0x18;
    this.kRegister_t9 = 0x19;
    this.kRegister_k0 = 0x1a;
    this.kRegister_k1 = 0x1b;
    this.kRegister_gp = 0x1c;
    this.kRegister_sp = 0x1d;
    this.kRegister_s8 = 0x1e;
    this.kRegister_ra = 0x1f;

    // Control register constants
    this.kControlIndex     = 0;
    this.kControlRand      = 1;
    this.kControlEntryLo0  = 2;
    this.kControlEntryLo1  = 3;
    this.kControlContext   = 4;
    this.kControlPageMask  = 5;
    this.kControlWired     = 6;
    //...
    this.kControlBadVAddr  = 8;
    this.kControlCount     = 9;
    this.kControlEntryHi   = 10;
    this.kControlCompare   = 11;
    this.kControlSR        = 12;
    this.kControlCause     = 13;
    this.kControlEPC       = 14;
    this.kControlPRId      = 15;
    this.kControlConfig    = 16;
    this.kControlLLAddr    = 17;
    this.kControlWatchLo   = 18;
    this.kControlWatchHi   = 19;
    //...
    this.kControlECC       = 26;
    this.kControlCacheErr  = 27;
    this.kControlTagLo     = 28;
    this.kControlTagHi     = 29;
    this.kControlErrorEPC  = 30;
  };

  // Expose the cpu state
  var cpu0 = new CPU0();
  n64js.cpu0 = cpu0;


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
      return cpu0.gprLo[base(i)] + imms(i);
  }

  function branchAddress(a,i) { return ((a+4) + (offset(i)*4))>>>0; }
  function   jumpAddress(a,i) { return ((a&0xf0000000) | (target(i)*4))>>>0; }

  function performBranch(new_pc) {
    if (new_pc < 0) {
      n64js.log('Oops, branching to negative address: ' + new_pc);
      throw 'Oops, branching to negative address: ' + new_pc;
    }
    cpu0.delayPC = new_pc;
  }

  function setSignExtend(r,v) {
    cpu0.gprLo[r] = v;
    cpu0.gprHi[r] = (v & 0x80000000) ? 0xffffffff : 0x00000000;  // sign-extend
  }

  function setZeroExtend(r, v) {
    cpu0.gprLo[r] = v;
    cpu0.gprHi[r] = 0x00000000;
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

    setSignExtend( rd(i), ((cpu0.gprLo[rt(i)] << sa(i)) & 0xffffffff)>>>0 );
  }

  function executeSRL(a,i) {
    setSignExtend( rd(i), cpu0.gprLo[rt(i)] >> sa(i) );
  }
  function executeSRA(a,i) {
    setSignExtend( rd(i), cpu0.gprLo[rt(i)] >>> sa(i) );
  }
  function executeSLLV(a,i) {
    setSignExtend( rd(i), (cpu0.gprLo[rt(i)] <<  (cpu0.gprLo[rs(i)] & 0x1f)) & 0xffffffff );
  }
  function executeSRLV(a,i) {
    setSignExtend( rd(i),  cpu0.gprLo[rt(i)] >>> (cpu0.gprLo[rs(i)] & 0x1f) );
  }
  function executeSRAV(a,i) {
    setSignExtend( rd(i),  cpu0.gprLo[rt(i)] >>  (cpu0.gprLo[rs(i)] & 0x1f) );
  }
  function executeSYSCALL(a,i)    { unimplemented(a,i); }
  function executeBREAK(a,i)      { unimplemented(a,i); }
  function executeSYNC(a,i)       { unimplemented(a,i); }
  function executeMFHI(a,i) {
    cpu0.gprHi[rd(i)] = cpu0.multHi[1]; 
    cpu0.gprLo[rd(i)] = cpu0.multHi[0]; 
  }
  function executeMTHI(a,i) {

  }
  function executeMFLO(a,i) {
    cpu0.gprHi[rd(i)] = cpu0.multLo[1]; 
    cpu0.gprLo[rd(i)] = cpu0.multLo[0]; 
  }
  function executeMTLO(a,i)       { unimplemented(a,i); }
  function executeDSLLV(a,i)      { unimplemented(a,i); }
  function executeDSRLV(a,i)      { unimplemented(a,i); }
  function executeDSRAV(a,i)      { unimplemented(a,i); }
  function executeMULT(a,i) {
    var result = cpu0.gprLo[rs(i)] * cpu0.gprLo[rt(i)];   // needs to be 64-bit *signed*!
    var lo = (result&0xffffffff)>>>0;
    var hi = (result>>>32);
    setHiLoSignExtend( cpu0.multLo, lo );
    setHiLoSignExtend( cpu0.multHi, hi );
  }
  function executeMULTU(a,i) {
    var result = cpu0.gprLo[rs(i)] * cpu0.gprLo[rt(i)];   // needs to be 64-bit!
    var lo = (result&0xffffffff)>>>0;
    var hi = (result>>>32);
    setHiLoSignExtend( cpu0.multLo, lo );
    setHiLoSignExtend( cpu0.multHi, hi );
  }
  function executeDIV(a,i)        { unimplemented(a,i); }
  function executeDIVU(a,i)       { unimplemented(a,i); }
  function executeDMULT(a,i)      { unimplemented(a,i); }
  function executeDMULTU(a,i)     { unimplemented(a,i); }
  function executeDDIV(a,i)       { unimplemented(a,i); }
  function executeDDIVU(a,i)      { unimplemented(a,i); }

  function executeADD(a,i) {
    setSignExtend( rd(i), cpu0.gprLo[rs(i)] + cpu0.gprLo[rt(i)] ); // s32 + s32
  }
  function executeADDU(a,i) {
    setSignExtend( rd(i), cpu0.gprLo[rs(i)] + cpu0.gprLo[rt(i)] ); // s32 + s32
  }

  function executeSUB(a,i) {
    setSignExtend( rd(i), cpu0.gprLo[rs(i)] - cpu0.gprLo[rt(i)] ); // s32 - s32
  }
  function executeSUBU(a,i) {
    setSignExtend( rd(i), cpu0.gprLo[rs(i)] - cpu0.gprLo[rt(i)] ); // s32 - s32
  }

  function executeAND(a,i) {
    cpu0.gprHi[rd(i)] = cpu0.gprHi[rs(i)] & cpu0.gprHi[rt(i)];
    cpu0.gprLo[rd(i)] = cpu0.gprLo[rs(i)] & cpu0.gprLo[rt(i)];
  }

  function executeOR(a,i) {
    cpu0.gprHi[rd(i)] = cpu0.gprHi[rs(i)] | cpu0.gprHi[rt(i)];
    cpu0.gprLo[rd(i)] = cpu0.gprLo[rs(i)] | cpu0.gprLo[rt(i)];
  }

  function executeXOR(a,i) {
    cpu0.gprHi[rd(i)] = cpu0.gprHi[rs(i)] ^ cpu0.gprHi[rt(i)];
    cpu0.gprLo[rd(i)] = cpu0.gprLo[rs(i)] ^ cpu0.gprLo[rt(i)];
  }

  function executeNOR(a,i)        { unimplemented(a,i); }
  function executeSLT(a,i) {
    var r = 0;
    // FIXME: this needs to do a signed compare. 
    if (cpu0.gprHi[rs(i)] < cpu0.gprHi[rt(i)] ||
        (cpu0.gprHi[rs(i)] === cpu0.gprHi[rt(i)] && cpu0.gprLo[rs(i)] < cpu0.gprLo[rt(i)])) {
      r = 1;
    }
    setZeroExtend(rd(i), r);
  }
  function executeSLTU(a,i) {
    var r = 0;
    if (cpu0.gprHi[rs(i)] < cpu0.gprHi[rt(i)] ||
        (cpu0.gprHi[rs(i)] === cpu0.gprHi[rt(i)] && cpu0.gprLo[rs(i)] < cpu0.gprLo[rt(i)])) {
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
  function executeTGEI(a,i)       { unimplemented(a,i); }
  function executeTGEIU(a,i)      { unimplemented(a,i); }
  function executeTLTI(a,i)       { unimplemented(a,i); }
  function executeTLTIU(a,i)      { unimplemented(a,i); }
  function executeTEQI(a,i)       { unimplemented(a,i); }
  function executeTNEI(a,i)       { unimplemented(a,i); }

  // Jump
  function executeJ(a,i) {
    performBranch( jumpAddress(a,i) );
  }
  function executeJAL(a,i) {
    setSignExtend(cpu0.kRegister_ra, cpu0.pc + 8);
    performBranch( jumpAddress(a,i) );
  }
  function executeJALR(a,i) {
    var new_pc = cpu0.gprLo[rs(i)];
    setSignExtend(rd(i), cpu0.pc + 8);
    performBranch( new_pc );
  }

  function executeJR(a,i) {
    performBranch( cpu0.gprLo[rs(i)] );
  }

  function executeBEQ(a,i) {
    var s = rs(i);
    var t = rt(i);
    if (cpu0.gprHi[s] === cpu0.gprHi[t] &&
        cpu0.gprLo[s] === cpu0.gprLo[t] ) {      // NB: if imms(i) == -1 then this is a branch to self/busywait
      performBranch( branchAddress(a,i) );
    }
  }
  function executeBEQL(a,i) {
    var s = rs(i);
    var t = rt(i);
    if (cpu0.gprHi[s] === cpu0.gprHi[t] &&
        cpu0.gprLo[s] === cpu0.gprLo[t] ) {
      performBranch( branchAddress(a,i) );
    } else {
      cpu0.pc += 4;   // skip the next instruction
    }
  }

  function executeBNE(a,i) {
    var s = rs(i);
    var t = rt(i);
    if (cpu0.gprHi[s] !== cpu0.gprHi[t] ||
        cpu0.gprLo[s] !== cpu0.gprLo[t] ) {      // NB: if imms(i) == -1 then this is a branch to self/busywait
      performBranch( branchAddress(a,i) );
    }
  }
  function executeBNEL(a,i) {
    var s = rs(i);
    var t = rt(i);
    if (cpu0.gprHi[s] !== cpu0.gprHi[t] ||
        cpu0.gprLo[s] !== cpu0.gprLo[t] ) {
      performBranch( branchAddress(a,i) );
    } else {
      cpu0.pc += 4;   // skip the next instruction
    }
  }

  // Branch Less Than or Equal To Zero
  function executeBLEZ(a,i) {
    // NB: 32 bit comparison for speed?
    if ( cpu0.gprHi_signed[s] < 0 ||
        (cpu0.gprHi[s] === 0 && cpu0.gprLo[s] === 0) ) {
      performBranch( branchAddress(a,i) );
    }
  }
  function executeBLEZL(a,i) {
    var s = rs(i);
    // NB: if rs == r0 then this branch is always taken
    if ( cpu0.gprHi_signed[s] < 0 ||
        (cpu0.gprHi[s] === 0 && cpu0.gprLo[s] === 0) ) {
      performBranch( branchAddress(a,i) );
    } else {
      cpu0.pc += 4;   // skip the next instruction
    }
  }

  // Branch Greater Than Zero
  function executeBGTZ(a,i) {
    var s = rs(i);
    if ( cpu0.gprHi_signed[s] > 0 &&
        (cpu0.gprHi[s] !== 0 || cpu0.gprLo[s] !== 0) ) {
      performBranch( branchAddress(a,i) );
    }
  }
  function executeBGTZL(a,i) {
    var s = rs(i);
    if ( cpu0.gprHi_signed[s] > 0 &&
        (cpu0.gprHi[s] !== 0 || cpu0.gprLo[s] !== 0) ) {
      performBranch( branchAddress(a,i) );
    } else {
      cpu0.pc += 4;   // skip the next instruction
    }
  }


  // Branch Less Than Zero
  function executeBLTZ(a,i) {
    if (cpu0.gprHi_signed[rs(i)] < 0) {
      performBranch( branchAddress(a,i) );
    }
  }
  function executeBLTZL(a,i) {
    if (cpu0.gprHi_signed[rs(i)] < 0) {
      performBranch( branchAddress(a,i) );
    } else {
      cpu0.pc += 4;   // skip the next instruction
    }
  }
  function executeBLTZAL(a,i) {
    setSignExtend(cpu0.kRegister_ra, cpu0.pc + 8);
    if (cpu0.gprHi_signed[rs(i)] < 0) {
      performBranch( branchAddress(a,i) );
    }
  }
  function executeBLTZALL(a,i) {
    setSignExtend(cpu0.kRegister_ra, cpu0.pc + 8);
    if (cpu0.gprHi_signed[rs(i)] < 0) {
      performBranch( branchAddress(a,i) );
    } else {
      cpu0.pc += 4;   // skip the next instruction
    }

  }


  // Branch Greater Than Zero
  function executeBGEZ(a,i) {
    if (cpu0.gprHi_signed[rs(i)] >= 0) {
      performBranch( branchAddress(a,i) );
    }
  }
  function executeBGEZL(a,i) {
    if (cpu0.gprHi_signed[rs(i)] >= 0) {
      performBranch( branchAddress(a,i) );
    } else {
      cpu0.pc += 4;   // skip the next instruction
    }
  }
  function executeBGEZAL(a,i) {
    setSignExtend(cpu0.kRegister_ra, cpu0.pc + 8);
    if (cpu0.gprHi_signed[rs(i)] >= 0) {
      performBranch( branchAddress(a,i) );
    }
  }
  function executeBGEZALL(a,i) {
    setSignExtend(cpu0.kRegister_ra, cpu0.pc + 8);
    if (cpu0.gprHi_signed[rs(i)] >= 0) {
      performBranch( branchAddress(a,i) );
    } else {
      cpu0.pc += 4;   // skip the next instruction
    }
  }


  function executeADDI(a,i) {
    var a = cpu0.gprLo[rs(i)];
    var v = imms(i);
    setSignExtend(rt(i), a + v);
  }
  function executeADDIU(a,i) {
    var a = cpu0.gprLo[rs(i)];
    var v = imms(i);
    setSignExtend(rt(i), a + v);
  }
  function executeSLTI(a,i) {
    // FIXME: this needs to do a full 64bit compare?
    cpu0.gprHi[rt(i)] = 0;
    cpu0.gprLo[rt(i)] = cpu0.gprLo[rs(i)] < imms(i) ? 1 : 0;
  }
  function executeSLTIU(a,i)      { unimplemented(a,i); }
  
  function executeANDI(a,i) {
    cpu0.gprHi[rt(i)] = 0;    // always 0, as sign extended immediate value is always 0
    cpu0.gprLo[rt(i)] = cpu0.gprLo[rs(i)] & imm(i);    
  }
  
  function executeORI(a,i) {
    cpu0.gprHi[rt(i)] = cpu0.gprHi[rs(i)];
    cpu0.gprLo[rt(i)] = cpu0.gprLo[rs(i)] | imm(i);
  }
  
  function executeXORI(a,i) {
    // High 32 bits are always unchanged, as sign extended immediate value is always 0
    var lo = cpu0.gprLo[rs(i)] ^ imm(i);
    cpu0.gprLo[rt(i)] = lo;    
  }
  
  function executeLUI(a,i) {
    var v  = imms(i) << 16;
    setSignExtend(rt(i), v);
  }
  
  function executeCop0(a,i)       { unimplemented(a,i); }
  function executeCopro1(a,i)     { unimplemented(a,i); }

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
    n64js.writeMemory8(memaddr(i), cpu0.gprLo[rt(i)] & 0xff );
  }
  function executeSH(a,i)         { unimplemented(a,i); }
  function executeSWL(a,i)        { unimplemented(a,i); }
  function executeSW(a,i)         {
    n64js.writeMemory32(memaddr(i), cpu0.gprLo[rt(i)]);
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