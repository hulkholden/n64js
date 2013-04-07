/*jshint jquery:true, devel:true */

(function (n64js) {'use strict';
  var kDebugTLB = 0;
  var kDebugDynarec = 0;
  var kEnableDynarec = true;

  var hitCounts = {};
  var fragmentMap = {};
  var fragmentInvalidationEvents = [];

  var kHotFragmentThreshold = 500;

  var accurateCountUpdating = false;
  var COUNTER_INCREMENT_PER_OP = 1;

  var k1Shift32 = 4294967296.0;

  var UT_VEC          = 0x80000000;
  var XUT_VEC         = 0x80000080;
  var ECC_VEC         = 0x80000100;
  var E_VEC           = 0x80000180;

  var SR_IE           = 0x00000001;
  var SR_EXL          = 0x00000002;
  var SR_ERL          = 0x00000004;
  var SR_KSU_KER      = 0x00000000;
  var SR_KSU_SUP      = 0x00000008;
  var SR_KSU_USR      = 0x00000010;
  var SR_KSU_MASK     = 0x00000018;
  var SR_UX           = 0x00000020;
  var SR_SX           = 0x00000040;
  var SR_KX           = 0x00000080;

  var SR_IBIT1        = 0x00000100;
  var SR_IBIT2        = 0x00000200;
  var SR_IBIT3        = 0x00000400;
  var SR_IBIT4        = 0x00000800;
  var SR_IBIT5        = 0x00001000;
  var SR_IBIT6        = 0x00002000;
  var SR_IBIT7        = 0x00004000;
  var SR_IBIT8        = 0x00008000;

  var SR_IMASK0       = 0x0000ff00;
  var SR_IMASK1       = 0x0000fe00;
  var SR_IMASK2       = 0x0000fc00;
  var SR_IMASK3       = 0x0000f800;
  var SR_IMASK4       = 0x0000f000;
  var SR_IMASK5       = 0x0000e000;
  var SR_IMASK6       = 0x0000c000;
  var SR_IMASK7       = 0x00008000;
  var SR_IMASK8       = 0x00000000;
  var SR_IMASK        = 0x0000ff00;

  var SR_DE           = 0x00010000;
  var SR_CE           = 0x00020000;
  var SR_CH           = 0x00040000;
  var SR_SR           = 0x00100000;
  var SR_TS           = 0x00200000;
  var SR_BEV          = 0x00400000;
  var SR_ITS          = 0x01000000;
  var SR_RE           = 0x02000000;
  var SR_FR           = 0x04000000;
  var SR_RP           = 0x08000000;
  var SR_CU0          = 0x10000000;
  var SR_CU1          = 0x20000000;
  var SR_CU2          = 0x40000000;
  var SR_CU3          = 0x80000000;

  var SR_CUMASK       = 0xf0000000;

  var CAUSE_BD_BIT    = 31;           // NB: Closure Compiler doesn't like 32 bit constants.
  var CAUSE_BD        = 0x80000000;
  var CAUSE_CEMASK    = 0x30000000;
  var CAUSE_CESHIFT   = 28;

  var CAUSE_SW1       = 0x00000100;
  var CAUSE_SW2       = 0x00000200;
  var CAUSE_IP3       = 0x00000400;
  var CAUSE_IP4       = 0x00000800;
  var CAUSE_IP5       = 0x00001000;
  var CAUSE_IP6       = 0x00002000;
  var CAUSE_IP7       = 0x00004000;
  var CAUSE_IP8       = 0x00008000;

  var CAUSE_IPMASK    = 0x0000FF00;

  var CAUSE_IPSHIFT   = 8;

  var CAUSE_EXCMASK   = 0x0000007C;

  var CAUSE_EXCSHIFT  = 2;

  var EXC_INT         = 0;
  var EXC_MOD         = 4;
  var EXC_RMISS       = 8;
  var EXC_WMISS       = 12;
  var EXC_RADE        = 16;
  var EXC_WADE        = 20;
  var EXC_IBE         = 24;
  var EXC_DBE         = 28;
  var EXC_SYSCALL     = 32;
  var EXC_BREAK       = 36;
  var EXC_II          = 40;
  var EXC_CPU         = 44;
  var EXC_OV          = 48;
  var EXC_TRAP        = 52;
  var EXC_VCEI        = 56;
  var EXC_FPE         = 60;
  var EXC_WATCH       = 92;
  var EXC_VCED        = 124;


  var FPCSR_RM_RN     = 0x00000000;
  var FPCSR_RM_RZ     = 0x00000001;
  var FPCSR_RM_RP     = 0x00000002;
  var FPCSR_RM_RM     = 0x00000003;
  var FPCSR_FI        = 0x00000004;
  var FPCSR_FU        = 0x00000008;
  var FPCSR_FO        = 0x00000010;
  var FPCSR_FZ        = 0x00000020;
  var FPCSR_FV        = 0x00000040;
  var FPCSR_EI        = 0x00000080;
  var FPCSR_EU        = 0x00000100;
  var FPCSR_EO        = 0x00000200;
  var FPCSR_EZ        = 0x00000400;
  var FPCSR_EV        = 0x00000800;
  var FPCSR_CI        = 0x00001000;
  var FPCSR_CU        = 0x00002000;
  var FPCSR_CO        = 0x00004000;
  var FPCSR_CZ        = 0x00008000;
  var FPCSR_CV        = 0x00010000;
  var FPCSR_CE        = 0x00020000;
  var FPCSR_C         = 0x00800000;
  var FPCSR_FS        = 0x01000000;

  var FPCSR_RM_MASK   = 0x00000003;


  var TLBHI_VPN2MASK    = 0xffffe000;
  var TLBHI_VPN2MASK_NEG= 0x00001fff;
  var TLBHI_VPN2SHIFT   = 13;
  var TLBHI_PIDMASK     = 0xff;
  var TLBHI_PIDSHIFT    = 0;
  var TLBHI_NPID        = 255;

  var TLBLO_PFNMASK     = 0x3fffffc0;
  var TLBLO_PFNSHIFT    = 6;
  var TLBLO_CACHMASK    = 0x38;
  var TLBLO_CACHSHIFT   = 3;
  var TLBLO_UNCACHED    = 0x10;
  var TLBLO_NONCOHRNT   = 0x18;
  var TLBLO_EXLWR       = 0x28;
  var TLBLO_D           = 0x4;
  var TLBLO_V           = 0x2;
  var TLBLO_G           = 0x1;

  var TLBINX_PROBE      = 0x80000000;
  var TLBINX_INXMASK    = 0x3f;
  var TLBINX_INXSHIFT   = 0;

  var TLBRAND_RANDMASK  = 0x3f;
  var TLBRAND_RANDSHIFT = 0;

  var TLBWIRED_WIREDMASK  = 0x3f;

  var TLBCTXT_BASEMASK  = 0xff800000;
  var TLBCTXT_BASESHIFT = 23;
  var TLBCTXT_BASEBITS  = 9;

  var TLBCTXT_VPNMASK   = 0x7ffff0;
  var TLBCTXT_VPNSHIFT  = 4;

  var TLBPGMASK_4K      = 0x00000000;
  var TLBPGMASK_16K     = 0x00006000;
  var TLBPGMASK_64K     = 0x0001e000;
  var TLBPGMASK_256K    = 0x0007e000;
  var TLBPGMASK_1M      = 0x001fe000;
  var TLBPGMASK_4M      = 0x007fe000;
  var TLBPGMASK_16M     = 0x01ffe000;


  var kStuffToDoHalt            = 1<<0;
  var kStuffToDoCheckInterrupts = 1<<1;
  var kStuffToDoBreakout        = 1<<2;

  var kVIIntrCycles = 62500;

  var kEventVbl          = 0;
  var kEventCompare      = 1;
  var kEventRunForCycles = 2;

  n64js.getHi32 = function (v) {
    // >>32 just seems to no-op? Argh.
    return Math.floor( v / k1Shift32 );
  };

  function TLBEntry() {
    this.pagemask = 0;
    this.hi       = 0;
    this.pfne     = 0;
    this.pfno     = 0;
    this.mask     = 0;
    this.global   = 0;
  }

  TLBEntry.prototype.update = function(index, pagemask, hi, entrylo0, entrylo1) {
    if (kDebugTLB) {
      n64js.log('TLB update: index=' + index +
          ', pagemask=' + n64js.toString32(pagemask) +
          ', entryhi='  + n64js.toString32(hi) +
          ', entrylo0=' + n64js.toString32(entrylo0) +
          ', entrylo1=' + n64js.toString32(entrylo1)
        );

      switch (pagemask) {
        case TLBPGMASK_4K:      n64js.log('       4k Pagesize');      break;
        case TLBPGMASK_16K:     n64js.log('       16k Pagesize');     break;
        case TLBPGMASK_64K:     n64js.log('       64k Pagesize');     break;
        case TLBPGMASK_256K:    n64js.log('       256k Pagesize');    break;
        case TLBPGMASK_1M:      n64js.log('       1M Pagesize');      break;
        case TLBPGMASK_4M:      n64js.log('       4M Pagesize');      break;
        case TLBPGMASK_16M:     n64js.log('       16M Pagesize');     break;
        default:                n64js.log('       Unknown Pagesize'); break;
      }
    }

    this.pagemask = pagemask;
    this.hi       = hi;
    this.pfne     = entrylo0;
    this.pfno     = entrylo1;

    this.global   = (entrylo0 & entrylo1 & TLBLO_G);

    this.mask     = pagemask | TLBHI_VPN2MASK_NEG;
    this.mask2    = this.mask>>>1;
    this.vpnmask  = (~this.mask)>>>0;
    this.vpn2mask = this.vpnmask>>>1;

    this.addrcheck = (hi & this.vpnmask)>>>0;

    this.pfnehi = (this.pfne << TLBLO_PFNSHIFT) & this.vpn2mask;
    this.pfnohi = (this.pfno << TLBLO_PFNSHIFT) & this.vpn2mask;

    switch (this.pagemask) {
      case TLBPGMASK_4K:      this.checkbit = 0x00001000; break;
      case TLBPGMASK_16K:     this.checkbit = 0x00004000; break;
      case TLBPGMASK_64K:     this.checkbit = 0x00010000; break;
      case TLBPGMASK_256K:    this.checkbit = 0x00040000; break;
      case TLBPGMASK_1M:      this.checkbit = 0x00100000; break;
      case TLBPGMASK_4M:      this.checkbit = 0x00400000; break;
      case TLBPGMASK_16M:     this.checkbit = 0x01000000; break;
      default: // shouldn't happen!
                              this.checkbit = 0;          break;
      }
  };

  function CPU0() {
    this.opsExecuted    = 0;            // Approximate...

    this.ram            = undefined;    // bound to in reset n64js.getRamU8Array();

    this.gprLoMem       = new ArrayBuffer(32*4);
    this.gprHiMem       = new ArrayBuffer(32*4);

    this.gprLoBytes     = new Uint8Array(this.gprLoMem);    // Used to help form addresses without causing deopts or generating HeapNumbers.

    this.gprLo          = new Uint32Array(this.gprLoMem);
    this.gprHi          = new Uint32Array(this.gprHiMem);
    this.gprLo_signed   = new Int32Array(this.gprLoMem);
    this.gprHi_signed   = new Int32Array(this.gprHiMem);

    this.controlMem     = new ArrayBuffer(32*4);
    this.control        = new Uint32Array(this.controlMem);
    this.control_signed = new Int32Array(this.controlMem);

    this.pc             = 0;
    this.delayPC        = 0;
    this.nextPC         = 0;      // Set to the next expected PC before an op executes. Ops can update this to change control flow without branch delay (e.g. likely branches, ERET)
    this.branchTarget   = 0;      // Set to indicate a branch has been taken. Sets the delayPC for the subsequent op.

    this.stuffToDo      = 0;     // used to flag r4300 to cease execution

    this.events         = [];

    this.multHiMem      = new ArrayBuffer(2*4);
    this.multLoMem      = new ArrayBuffer(2*4);
    this.multHi         = new Uint32Array(this.multHiMem);
    this.multLo         = new Uint32Array(this.multLoMem);
    this.multHi_signed  = new Int32Array(this.multHiMem);
    this.multLo_signed  = new Int32Array(this.multLoMem);

    this.tlbEntries = [];
    for (var i = 0; i < 32; ++i) {
      this.tlbEntries.push(new TLBEntry());
    }

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
  }

  CPU0.prototype.getCount = function() {
    return this.control[this.kControlCount];
  };

  CPU0.prototype.getGPR_s64 = function (r) {
    return (this.gprHi_signed[r] * k1Shift32) + this.gprLo[r];
  };

  CPU0.prototype.getGPR_u64 = function (r) {
    return (this.gprHi[r] * k1Shift32) + this.gprLo[r];
  };

  CPU0.prototype.setGPR_s64 = function (r, v) {
    this.gprHi_signed[r] = Math.floor( v / k1Shift32 );
    this.gprLo_signed[r] = v;
  };

  CPU0.prototype.reset = function () {
    var i;

    hitCounts = {};
    fragmentMap = {};
    fragmentInvalidationEvents = [];

    this.ram = n64js.getRamU8Array();

    for (i = 0; i < 32; ++i) {
      this.gprLo[i]   = 0;
      this.gprHi[i]   = 0;
      this.control[i] = 0;
    }
    for (i = 0; i < 32; ++i) {
      this.tlbEntries[i].update(i, 0, 0x80000000, 0, 0);
    }

    this.pc           = 0;
    this.delayPC      = 0;
    this.nextPC       = 0;
    this.branchTarget = 0;

    this.stuffToDo    = 0;

    this.events       = [];

    this.multLo[0]    = this.multLo[1] = 0;
    this.multHi[0]    = this.multHi[1] = 0;

    this.control[this.kControlRand]   = 32-1;
    this.control[this.kControlSR]     = 0x70400004;
    this.control[this.kControlConfig] = 0x0006e463;

    this.addEvent(kEventVbl, kVIIntrCycles);
  };

  CPU0.prototype.breakExecution = function () {
    this.stuffToDo |= kStuffToDoHalt;
  };

  CPU0.prototype.speedHack = function () {
    var next_instruction = n64js.readMemoryInternal32(this.pc + 4);
    if (next_instruction === 0) {
      if (this.events.length > 0) {

        // Ignore the kEventRunForCycles event
        var run_countdown = 0;
        if (this.events[0].type === kEventRunForCycles && this.events.length > 1) {
          run_countdown += this.events[0].countdown;
          this.events.splice(0,1);
        }

        var to_skip = run_countdown + this.events[0].countdown - 1;

        //n64js.log('speedhack: skipping ' + to_skip + ' cycles');

        this.control[this.kControlCount] += to_skip;
        this.events[0].countdown = 1;

        // Re-add the kEventRunForCycles event
        if (run_countdown) {
          this.addEvent(kEventRunForCycles, run_countdown);
        }
      } else {
        n64js.log('no events');
      }
    } else {
      //n64js.log('next instruction does something');
    }
  };

  CPU0.prototype.updateCause3 = function () {
    if (n64js.miInterruptsUnmasked()) {
      this.control[this.kControlCause] |= CAUSE_IP3;

      if (this.checkForUnmaskedInterrupts()) {
        this.stuffToDo |= kStuffToDoCheckInterrupts;
      }
    } else {
      this.control[this.kControlCause] &= ~CAUSE_IP3;
    }

    checkCauseIP3Consistent();
  };

  CPU0.prototype.setSR = function (value) {
    var old_value = this.control[this.kControlSR];
    if ((old_value & SR_FR) !== (value & SR_FR)) {
      n64js.log('Changing FPU to ' + ((value & SR_FR) ? '64bit' : '32bit' ));
    }

    this.control[this.kControlSR] = value;

    setCop1Enable( (value & SR_CU1) !== 0 );

    if (this.checkForUnmaskedInterrupts()) {
      this.stuffToDo |= kStuffToDoCheckInterrupts;
    }
  };

  CPU0.prototype.checkForUnmaskedInterrupts = function () {
    var sr = this.control[this.kControlSR];

    // Ensure ERL/EXL are clear and IE is set
    if ((sr & (SR_EXL | SR_ERL | SR_IE)) === SR_IE) {

      // Check if interrupts are actually pending, and wanted
      var cause = this.control[this.kControlCause];

      if ((sr & cause & CAUSE_IPMASK) !== 0) {
        return true;
      }
    }

    return false;
  };

  CPU0.prototype.throwTLBException = function (address, exc_code, vec) {
    this.control[this.kControlBadVAddr] = address;

    this.control[this.kControlContext] &= 0xff800000;
    this.control[this.kControlContext] |= ((address >>> 13) << 4);

    this.control[this.kControlEntryHi] &= 0x00001fff;
    this.control[this.kControlEntryHi] |= (address & 0xfffffe000);

    // XXXX check we're not inside exception handler before snuffing CAUSE reg?
    this.setException( CAUSE_EXCMASK, exc_code );
    this.nextPC = vec;
  };

  CPU0.prototype.throwTLBReadMiss  = function (address) { this.throwTLBException(address, EXC_RMISS, UT_VEC); };
  CPU0.prototype.throwTLBWriteMiss = function (address) { this.throwTLBException(address, EXC_WMISS, UT_VEC); };

  CPU0.prototype.throwTLBReadInvalid  = function (address) { this.throwTLBException(address, EXC_RMISS, E_VEC); };
  CPU0.prototype.throwTLBWriteInvalid = function (address) { this.throwTLBException(address, EXC_WMISS, E_VEC); };

  CPU0.prototype.throwCop1Unusable = function () {
    // XXXX check we're not inside exception handler before snuffing CAUSE reg?
    this.setException( CAUSE_EXCMASK|CAUSE_CEMASK, EXC_CPU | 0x10000000 );
    this.nextPC = E_VEC;
  };

  CPU0.prototype.handleInterrupt = function () {
    if (this.checkForUnmaskedInterrupts()) {
        this.setException( CAUSE_EXCMASK, EXC_INT );
        // this is handled outside of the main dispatch loop, so need to update pc directly
        this.pc      = E_VEC;
        this.delayPC = 0;

    } else {
      n64js.assert(false, "Was expecting an unmasked interrupt - something wrong with kStuffToDoCheckInterrupts?");
    }
  };

  CPU0.prototype.setException = function (mask, exception) {
    this.control[this.kControlCause] &= ~mask;
    this.control[this.kControlCause] |= exception;
    this.control[this.kControlSR]  |= SR_EXL;
    this.control[this.kControlEPC]  = this.pc;

    var bd_mask = (1<<CAUSE_BD_BIT);
    if (this.delayPC) {
      this.control[this.kControlCause] |= bd_mask;
      this.control[this.kControlEPC]   -= 4;
    } else {
      this.control[this.kControlCause] &= ~bd_mask;
    }
  };

  CPU0.prototype.setCompare = function (value) {
    this.control[this.kControlCause] &= ~CAUSE_IP8;
    if (value === this.control[this.kControlCompare]) {
      // just clear the IP8 flag
    } else {
      if (value !== 0) {
        var count = this.control[this.kControlCount];
        if (value > count) {
          var delta = value - count;

          this.removeEventsOfType(kEventCompare);
          this.addEvent(kEventCompare, delta);
        } else {
          n64js.warn('setCompare underflow - was' + n64js.toString32(count) + ', setting to ' + value);
        }
      }
    }
    this.control[this.kControlCompare] = value;
  };


  function Event(type, countdown) {
    this.type = type;
    this.countdown = countdown;
  }

  Event.prototype.getName = function () {
    switch(this.type) {
      case kEventVbl:           return 'Vbl';
      case kEventCompare:       return 'Compare';
      case kEventRunForCycles:  return 'Run';
    }

    return '?';
  };

  CPU0.prototype.addEvent = function(type, countdown) {
    n64js.assert( countdown >0, "Countdown is invalid" );
    for (var i = 0; i < this.events.length; ++i) {
      var event = this.events[i];
      if (countdown <= event.countdown) {
        event.countdown -= countdown;

        this.events.splice(i, 0, new Event(type, countdown));
        return;
      }

      countdown -= event.countdown;
    }

    this.events.push(new Event(type, countdown));
  };


  CPU0.prototype.removeEventsOfType = function (type) {
    var count = 0;
    for (var i = 0; i < this.events.length; ++i) {
      count += this.events[i].countdown;

      if (this.events[i].type == type) {
        // Add this countdown on to the subsequent event
        if ((i+1) < this.events.length) {
          this.events[i+1].countdown += this.events[i].countdown;
        }
        this.events.splice(i, 1);
        return count;
      }
    }

    // Not found.
    return -1;
  };

  CPU0.prototype.hasEvent = function(type) {
    for (var i = 0; i < this.events.length; ++i) {
      if (this.events[i].type == type) {
        return true;
      }
    }
    return false;
  };

  CPU0.prototype.getRandom = function () {
    var wired = this.control[this.kControlWired] & 0x1f;
    var random = Math.floor(Math.random() * (32-wired)) + wired;

    var sync = n64js.getSyncFlow();
    if (sync) {
      random = sync.reflect32(random);
    }

    n64js.assert(random >= wired && random <= 31, "Ooops - random should be in range " + wired + "..31, but got " + random);
    return random;
  };

  CPU0.prototype.setTLB = function (cpu, index) {
    var pagemask = cpu.control[cpu.kControlPageMask];
    var entryhi  = cpu.control[cpu.kControlEntryHi];
    var entrylo1 = cpu.control[cpu.kControlEntryLo1];
    var entrylo0 = cpu.control[cpu.kControlEntryLo0];

    cpu.tlbEntries[index].update(index, pagemask, entryhi, entrylo0, entrylo1);
  };

  CPU0.prototype.tlbWriteIndex = function () {
    this.setTLB(this, this.control[this.kControlIndex] & 0x1f);
  };

  CPU0.prototype.tlbWriteRandom = function () {
    this.setTLB(this, this.getRandom());
  };

  CPU0.prototype.tlbRead = function () {
    var index = this.control[this.kControlIndex] & 0x1f;
    var tlb   = this.tlbEntries[index];

    this.control[this.kControlPageMask] = tlb.mask;
    this.control[this.kControlEntryHi ] = tlb.hi;
    this.control[this.kControlEntryLo0] = tlb.pfne | tlb.global;
    this.control[this.kControlEntryLo1] = tlb.pfno | tlb.global;

    if (kDebugTLB) {
      n64js.log('TLB Read Index ' + n64js.toString8(index) + '.');
      n64js.log('  PageMask: ' + n64js.toString32(this.control[this.kControlPageMask]));
      n64js.log('  EntryHi:  ' + n64js.toString32(this.control[this.kControlEntryHi]));
      n64js.log('  EntryLo0: ' + n64js.toString32(this.control[this.kControlEntryLo0]));
      n64js.log('  EntryLo1: ' + n64js.toString32(this.control[this.kControlEntryLo1]));
    }
  };


  CPU0.prototype.tlbProbe = function () {
    var entryhi      = this.control[this.kControlEntryHi];
    var entryhi_vpn2 = entryhi & TLBHI_VPN2MASK;
    var entryhi_pid  = entryhi & TLBHI_PIDMASK;

    for (var i = 0; i < 32; ++i) {
      var tlb = this.tlbEntries[i];
      if (   (tlb.hi & TLBHI_VPN2MASK) === entryhi_vpn2) {
        if (((tlb.hi & TLBHI_PIDMASK)  === entryhi_pid) ||
             tlb.global) {
          if (kDebugTLB) {
            n64js.log('TLB Probe. EntryHi:' + n64js.toString32(entryhi) + '. Found matching TLB entry - ' + n64js.toString8(i));
          }
          this.control[this.kControlIndex] = i;
          return;
        }
      }
    }

    if (kDebugTLB) {
      n64js.log('TLB Probe. EntryHi:' + n64js.toString32(entryhi) + ". Didn't find matching entry");
    }
    this.control[this.kControlIndex] = TLBINX_PROBE;
  };

  CPU0.prototype.tlbFindEntry = function (address) {
    for(var count = 0; count < 32; ++count) {
      // NB should put mru cache here
      var i = count;

      var tlb = this.tlbEntries[i];

      if ((address & tlb.vpnmask) === tlb.addrcheck) {
        if (!tlb.global) {
          var ehi = this.control[this.kControlEntryHi];
          if ((tlb.hi & TLBHI_PIDMASK) !== (ehi & TLBHI_PIDMASK) ) {
            // Entries ASID must match
            continue;
          }
        }

        return tlb;
      }
    }

    return null;
  };


  CPU0.prototype.translateReadInternal = function (address) {
    var tlb = this.tlbFindEntry(address);
    if (tlb) {
        var valid;
        var physical_addr;
        if (address & tlb.checkbit) {
          valid         = (tlb.pfno & TLBLO_V) !== 0;
          physical_addr = tlb.pfnohi | (address & tlb.mask2);
        } else {
          valid         = (tlb.pfne & TLBLO_V) !== 0;
          physical_addr = tlb.pfnehi | (address & tlb.mask2);
        }

        if (valid)
          return physical_addr;
        return 0;
    }
    return 0;
  };

  function TLBException(address) {
    this.address = address;
  }

  CPU0.prototype.translateRead = function (address) {
    var tlb = this.tlbFindEntry(address);
    if (tlb) {
        var valid;
        var physical_addr;
        if (address & tlb.checkbit) {
          valid         = (tlb.pfno & TLBLO_V) !== 0;
          physical_addr = tlb.pfnohi | (address & tlb.mask2);
        } else {
          valid         = (tlb.pfne & TLBLO_V) !== 0;
          physical_addr = tlb.pfnehi | (address & tlb.mask2);
        }

        if (valid)
          return physical_addr;

        this.throwTLBReadInvalid(address);
        throw new TLBException(address);
    }

    this.throwTLBReadMiss(address);
    throw new TLBException(address);
  };

  CPU0.prototype.translateWrite = function (address) {
    var tlb = this.tlbFindEntry(address);
    if (tlb) {
        var valid;
        var physical_addr;
        if (address & tlb.checkbit) {
          valid         = (tlb.pfno & TLBLO_V) !== 0;
          physical_addr = tlb.pfnohi | (address & tlb.mask2);
        } else {
          valid         = (tlb.pfne & TLBLO_V) !== 0;
          physical_addr = tlb.pfnehi | (address & tlb.mask2);
        }

        if (valid)
          return physical_addr;

        this.throwTLBWriteInvalid(address);
        throw new TLBException(address);
    }

    this.throwTLBWriteMiss(address);
    throw new TLBException(address);
  };



  function CPU1() {

    this.control = new Uint32Array(32);

    this.mem     = new ArrayBuffer(32 * 4);   // 32 32-bit regs
    this.float32 = new Float32Array(this.mem);
    this.float64 = new Float64Array(this.mem);
    this.int32   = new Int32Array(this.mem);
    this.uint32  = new Uint32Array(this.mem);

    this.reset = function () {

      for (var i = 0; i < 32; ++i) {
        this.control[i] = 0;
        this.int32[i]   = 0;
      }

      this.control[0] = 0x00000511;
    };

    this.setCondition = function (v) {
      if (v)
        this.control[31] |=  FPCSR_C;
      else
        this.control[31] &= ~FPCSR_C;
    };

    this.store_64 = function (i, lo, hi) {
      this.int32[i+0] = lo;
      this.int32[i+1] = hi;
    };

    this.load_f64 = function (i) {
      return this.float64[i>>1];
    };
    this.load_s64_as_double = function (i) {
        return (this.int32[i+1] * k1Shift32) + this.int32[i];
    };

    this.store_float_as_long = function (i, v) {
      this.int32[i  ] = v & 0xffffffff;
      this.int32[i+1] = Math.floor( v / k1Shift32 );
    };

    this.store_f64 = function (i, v) {
      this.float64[i>>1] = v;
    };
  }

  // Expose the cpu state
  var cpu0 = new CPU0();
  var cpu1 = new CPU1();
  n64js.cpu0 = cpu0;
  n64js.cpu1 = cpu1;


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

  function tlbop(i)     { return i&0x3f; }
  function cop1_func(i) { return i&0x3f; }
  function cop1_bc(i)   { return (i>>>16)&0x3; }

  function target(i) { return (i     )&0x3ffffff; }
  function    imm(i) { return (i     )&0xffff; }
  function   imms(i) { return ((i&0xffff)<<16)>>16; }   // treat immediate value as signed
  function   base(i) { return (i>>>21)&0x1f; }

  function memaddr(i) {
      return cpu0.gprLo[base(i)] + imms(i);
  }

  function branchAddress(pc,i) { return ((pc+4) + (offset(i)*4))>>>0; }
  //function branchAddress(pc,i) { return (((pc>>>2)+1) + offset(i))<<2; }  // NB: convoluted calculation to avoid >>>0 (deopt)
  function   jumpAddress(pc,i) { return ((pc&0xf0000000) | (target(i)*4))>>>0; }

  function performBranch(new_pc) {
    //if (new_pc < 0) {
    //  n64js.log('Oops, branching to negative address: ' + new_pc);
    //  throw 'Oops, branching to negative address: ' + new_pc;
    //}
    cpu0.branchTarget = new_pc;
  }

  function setSignExtend(r,v) {
    cpu0.gprLo[r] = v;
    cpu0.gprHi_signed[r] = v >> 31;
  }

  function setZeroExtend(r, v) {
    cpu0.gprLo[r] = v;
    cpu0.gprHi_signed[r] = 0;
  }

  function setHiLoSignExtend(arr, v) {
    arr[0] = v;
    arr[1] = v >> 31;
  }
  function setHiLoZeroExtend(arr, v) {
    arr[0] = v;
    arr[1] = 0;
  }

  function genSrcRegLo(i) {
    if (i === 0)
      return '0';
    return 'rlo[' + i + ']';
  }
  function genSrcRegHi(i) {
    if (i === 0)
      return '0';
    return 'rhi[' + i + ']';
  }

  //
  // Memory access routines.
  //

  // These are out of line so that the >>>0 doesn't cause a shift-i deopt in the body of the calling function
  function lwu_slow(addr)       { return n64js.readMemoryU32(addr>>>0); }
  function lhu_slow(addr)       { return n64js.readMemoryU16(addr>>>0); }
  function lbu_slow(addr)       { return n64js.readMemoryU8( addr>>>0); }

  function lw_slow(addr)        { return n64js.readMemoryS32(addr>>>0); }
  function lh_slow(addr)        { return n64js.readMemoryS16(addr>>>0); }
  function lb_slow(addr)        { return n64js.readMemoryS8( addr>>>0); }

  function sw_slow(addr, value) { n64js.writeMemory32(addr>>>0, value); }
  function sh_slow(addr, value) { n64js.writeMemory16(addr>>>0, value); }
  function sb_slow(addr, value) { n64js.writeMemory8( addr>>>0, value); }


  n64js.load_u8 = function (ram, addr) {
    if (addr < -2139095040) {
      var phys = (addr + 0x80000000) | 0;  // NB: or with zero ensures we return an SMI if possible.
      return ram[phys];
    }
    return lbu_slow(addr);
  };

  n64js.load_s8 = function (ram, addr) {
    if (addr < -2139095040) {
      var phys = (addr + 0x80000000) | 0;  // NB: or with zero ensures we return an SMI if possible.
      return (ram[phys] << 24) >> 24;
    }
    return lb_slow(addr);
  };

  n64js.load_u16 = function (ram, addr) {
    if (addr < -2139095040) {
      var phys = (addr + 0x80000000) | 0;  // NB: or with zero ensures we return an SMI if possible.
      return (ram[phys] << 8) | ram[phys+1];
    }
    return lhu_slow(addr);
  };

  n64js.load_s16 = function (ram, addr) {
    if (addr < -2139095040) {
      var phys = (addr + 0x80000000) | 0;  // NB: or with zero ensures we return an SMI if possible.
      return ((ram[phys] << 24) | (ram[phys+1] << 16)) >> 16;
    }
    return lh_slow(addr);
  };

  n64js.load_u32 = function (ram, addr) {
    if (addr < -2139095040) {
      var phys = (addr + 0x80000000) | 0;  // NB: or with zero ensures we return an SMI if possible.
      return ((ram[phys] << 24) | (ram[phys+1] << 16) | (ram[phys+2] << 8) | ram[phys+3]) >>> 0;
    }
    return lwu_slow(addr);
  };

  n64js.load_s32 = function (ram, addr) {
    if (addr < -2139095040) {
      var phys = (addr + 0x80000000) | 0;  // NB: or with zero ensures we return an SMI if possible.
      return ((ram[phys] << 24) | (ram[phys+1] << 16) | (ram[phys+2] << 8) | ram[phys+3]) | 0;
    }
    return lw_slow(addr);
  };

  n64js.store_8 = function (ram, addr, value) {
    if (addr < -2139095040) {
      var phys = (addr + 0x80000000) | 0;  // NB: or with zero ensures we return an SMI if possible.
      ram[phys] = value;
    } else {
      sb_slow(addr, value);
    }
  };

  n64js.store_16 = function (ram, addr, value) {
    if (addr < -2139095040) {
      var phys = (addr + 0x80000000) | 0;  // NB: or with zero ensures we return an SMI if possible.
      ram[phys  ] = value >> 8;
      ram[phys+1] = value;
    } else {
      sh_slow(addr, value);
    }
  };

  n64js.store_32 = function (ram, addr, value) {
    if (addr < -2139095040) {
      var phys = (addr + 0x80000000) | 0;  // NB: or with zero ensures we return an SMI if possible.
      ram[phys+0] = value >> 24;
      ram[phys+1] = value >> 16;
      ram[phys+2] = value >>  8;
      ram[phys+3] = value;
    } else {
      sw_slow(addr, value);
    }
  };

  n64js.store_64 = function (ram, addr, value_lo, value_hi) {
    if (addr < -2139095040) {
      var phys = (addr + 0x80000000) | 0;  // NB: or with zero ensures we return an SMI if possible.
      ram[phys+0] = value_hi >> 24;
      ram[phys+1] = value_hi >> 16;
      ram[phys+2] = value_hi >>  8;
      ram[phys+3] = value_hi;
      ram[phys+4] = value_lo >> 24;
      ram[phys+5] = value_lo >> 16;
      ram[phys+6] = value_lo >>  8;
      ram[phys+7] = value_lo;
    } else {
      sw_slow(addr,     value_hi);
      sw_slow(addr + 4, value_lo);
    }
  };


  function unimplemented(pc,i) {
    var r = n64js.disassembleOp(pc,i);
    var e = 'Unimplemented op ' + n64js.toString32(i) + ' : ' + r.disassembly;
    n64js.log(e);
    throw e;
  }

  function executeUnknown(i) {
    throw 'Unknown op: ' + n64js.toString32(cpu0.pc) + ', ' + n64js.toString32(i);
  }

  function BreakpointException() {
  }

  function executeBreakpoint(i) {
    // NB: throw here so that we don't execute the op.
    throw new BreakpointException();
  }

  function generateShiftImmediate(ctx, op) {
    // Handle NOP for SLL
    if (ctx.instruction === 0)
      return generateNOPBoilerplate('/*NOP*/', ctx);

    var d     = ctx.instr_rd();
    var t     = ctx.instr_rt();
    var shift = ctx.instr_sa();

    var impl = '';
    impl += 'var result = ' + genSrcRegLo(t) + ' ' + op + ' ' + shift + ';\n';
    impl += 'rlo[' + d + '] = result;\n';
    impl += 'rhi[' + d + '] = result >> 31;\n';
    return generateTrivialOpBoilerplate(impl, ctx);
  }

  function generateSLL(ctx) { return generateShiftImmediate(ctx, '<<'); }
  function executeSLL(i) {
    // NOP
    if (i === 0)
      return;

    var d     = rd(i);
    var t     = rt(i);
    var shift = sa(i);

    var result = cpu0.gprLo_signed[t] << shift;
    cpu0.gprLo_signed[d] = result;
    cpu0.gprHi_signed[d] = result >> 31;    // sign extend
  }


  function generateSRL(ctx) { return generateShiftImmediate(ctx, '>>>'); }
  function executeSRL(i) {
    var d     = rd(i);
    var t     = rt(i);
    var shift = sa(i);

    var result = cpu0.gprLo_signed[t] >>> shift;
    cpu0.gprLo_signed[d] = result;
    cpu0.gprHi_signed[d] = result >> 31;    // sign extend
  }


  function generateSRA(ctx) { return generateShiftImmediate(ctx, '>>'); }
  function executeSRA(i) {
    var d     = rd(i);
    var t     = rt(i);
    var shift = sa(i);

    var result = cpu0.gprLo_signed[t] >> shift;
    cpu0.gprLo_signed[d] = result;
    cpu0.gprHi_signed[d] = result >> 31;    // sign extend
  }


  function generateShiftVariable(ctx, op) {
    var d = ctx.instr_rd();
    var s = ctx.instr_rs();
    var t = ctx.instr_rt();

    var impl = '';
    impl += 'var result = ' + genSrcRegLo(t) + ' ' + op + ' (' + genSrcRegLo(s) + ' & 0x1f);\n';
    impl += 'rlo[' + d + '] = result;\n';
    impl += 'rhi[' + d + '] = result >> 31;\n';
    return generateTrivialOpBoilerplate(impl, ctx);
  }

  function generateSLLV(ctx) { return generateShiftVariable(ctx, '<<'); }
  function executeSLLV(i) {
    var d = rd(i);
    var s = rs(i);
    var t = rt(i);

    var result = cpu0.gprLo_signed[t] << (cpu0.gprLo_signed[s] & 0x1f);
    cpu0.gprLo_signed[d] = result;
    cpu0.gprHi_signed[d] = result >> 31;    // sign extend
  }


  function generateSRLV(ctx) { return generateShiftVariable(ctx, '>>>'); }
  function executeSRLV(i) {
    var d = rd(i);
    var s = rs(i);
    var t = rt(i);

    var result = cpu0.gprLo_signed[t] >>> (cpu0.gprLo_signed[s] & 0x1f);
    cpu0.gprLo_signed[d] = result;
    cpu0.gprHi_signed[d] = result >> 31;    // sign extend
  }


  function generateSRAV(ctx) { return generateShiftVariable(ctx, '>>'); }
  function executeSRAV(i) {
    var d = rd(i);
    var s = rs(i);
    var t = rt(i);

    var result = cpu0.gprLo_signed[t] >> (cpu0.gprLo_signed[s] & 0x1f);
    cpu0.gprLo_signed[d] = result;
    cpu0.gprHi_signed[d] = result >> 31;    // sign extend
  }

  function executeDSLLV(i) {
    var d = rd(i);
    var t = rt(i);
    var s = rs(i);

    var shift = cpu0.gprLo[s] & 0x3f;

    var lo = cpu0.gprLo[t];
    var hi = cpu0.gprHi[t];

    if (shift < 32) {
      var nshift = 32-shift;

      cpu0.gprLo[d] = (lo<<shift);
      cpu0.gprHi[d] = (hi<<shift) | (lo>>>nshift);
    } else {
      cpu0.gprLo_signed[d] = 0;
      cpu0.gprHi_signed[d] = lo << (shift - 32);
    }
  }

  function executeDSRLV(i) {
    var d = rd(i);
    var t = rt(i);
    var s = rs(i);

    var shift = cpu0.gprLo[s] & 0x3f;

    var lo = cpu0.gprLo[t];
    var hi = cpu0.gprHi[t];

    if (shift < 32) {
      var nshift = 32-shift;

      cpu0.gprLo[d] = (lo>>>shift) | (hi<<nshift);
      cpu0.gprHi[d] = (hi>>>shift);
    } else {
      cpu0.gprLo[d] = hi >>> (shift - 32);
      cpu0.gprHi_signed[d] = 0;
    }
  }

  function executeDSRAV(i) {
    var d = rd(i);
    var t = rt(i);
    var s = rs(i);

    var shift = cpu0.gprLo[s] & 0x3f;

    var lo = cpu0.gprLo[t];
    var hi = cpu0.gprHi_signed[t];

    if (shift < 32) {
      var nshift = 32-shift;

      cpu0.gprLo[d] = (lo>>>shift) | (hi<<nshift);
      cpu0.gprHi[d] = (hi>>shift);
    } else {
      var olo = hi >> (shift - 32);
      cpu0.gprLo_signed[d] = olo;
      cpu0.gprHi_signed[d] = olo >> 31;
    }
  }

  function executeDSLL(i) {
    var d     = rd(i);
    var t     = rt(i);
    var shift = sa(i);
    var nshift = 32-shift;

    var lo = cpu0.gprLo[t];
    var hi = cpu0.gprHi[t];

    cpu0.gprLo[d] = (lo<<shift);
    cpu0.gprHi[d] = (hi<<shift) | (lo>>>nshift);
  }
  function executeDSLL32(i) {
    var d = rd(i);
    cpu0.gprLo_signed[d] = 0;
    cpu0.gprHi_signed[d] = cpu0.gprLo[rt(i)] << sa(i);
  }

  function executeDSRL(i) {
    var d     = rd(i);
    var t     = rt(i);
    var shift = sa(i);
    var nshift = 32-shift;

    var lo = cpu0.gprLo[t];
    var hi = cpu0.gprHi[t];

    cpu0.gprLo[d] = (lo>>>shift) | (hi<<nshift);
    cpu0.gprHi[d] = (hi>>>shift);
  }
  function executeDSRL32(i) {
    var d = rd(i);
    cpu0.gprLo[d] = cpu0.gprHi[rt(i)] >>> sa(i);
    cpu0.gprHi_signed[d] = 0;
  }

  function executeDSRA(i) {
    var d     = rd(i);
    var t     = rt(i);
    var shift = sa(i);
    var nshift = 32-shift;

    var lo = cpu0.gprLo[t];
    var hi = cpu0.gprHi_signed[t];

    cpu0.gprLo[d] = (lo>>>shift) | (hi<<nshift);
    cpu0.gprHi[d] = (hi>>shift);
  }
  function executeDSRA32(i) {
    var d   = rd(i);
    var olo = cpu0.gprHi_signed[rt(i)] >> sa(i);
    cpu0.gprLo_signed[d] = olo;
    cpu0.gprHi_signed[d] = olo >> 31;
  }


  function executeSYSCALL(i)    { unimplemented(cpu0.pc,i); }
  function executeBREAK(i)      { unimplemented(cpu0.pc,i); }
  function executeSYNC(i)       { unimplemented(cpu0.pc,i); }


  function generateMFHI(ctx) {
    var d = ctx.instr_rd();
    var impl = '';
    impl += 'rlo[' + d + '] = c.multHi_signed[0];\n';
    impl += 'rhi[' + d + '] = c.multHi_signed[1];\n';
    return generateTrivialOpBoilerplate(impl, ctx);
  }
  function executeMFHI(i) {
    var d = rd(i);

    cpu0.gprLo_signed[d] = cpu0.multHi_signed[0];
    cpu0.gprHi_signed[d] = cpu0.multHi_signed[1];
  }

  function generateMFLO(ctx) {
    var d = ctx.instr_rd();
    var impl = '';
    impl += 'rlo[' + d + '] = c.multLo_signed[0];\n';
    impl += 'rhi[' + d + '] = c.multLo_signed[1];\n';
    return generateTrivialOpBoilerplate(impl, ctx);
  }
  function executeMFLO(i) {
    var d = rd(i);
    cpu0.gprLo_signed[d] = cpu0.multLo_signed[0];
    cpu0.gprHi_signed[d] = cpu0.multLo_signed[1];
  }

  function generateMTHI(ctx) {
    var s = ctx.instr_rs();
    var impl = '';
    impl += 'c.multHi_signed[0] = rlo[' + s + '];\n';
    impl += 'c.multHi_signed[1] = rhi[' + s + '];\n';
    return generateTrivialOpBoilerplate(impl, ctx);
  }
  function executeMTHI(i) {
    var s = rs(i);
    cpu0.multHi_signed[0] = cpu0.gprLo_signed[s];
    cpu0.multHi_signed[1] = cpu0.gprHi_signed[s];
  }

  function generateMTLO(ctx) {
    var s = ctx.instr_rs();
    var impl = '';
    impl += 'c.multLo_signed[0] = rlo[' + s + '];\n';
    impl += 'c.multLo_signed[1] = rhi[' + s + '];\n';
    return generateTrivialOpBoilerplate(impl, ctx);
  }
  function executeMTLO(i)  {
    var s = rs(i);
    cpu0.multLo_signed[0] = cpu0.gprLo_signed[s];
    cpu0.multLo_signed[1] = cpu0.gprHi_signed[s];
  }

  function generateMULT(ctx) {
    var d = ctx.instr_rd();
    var s = ctx.instr_rs();
    var t = ctx.instr_rt();

    var impl = '';
    impl += 'var result = ' + genSrcRegLo(s) + ' * ' + genSrcRegLo(t) + ';\n';
    impl += 'var result_lo = result & 0xffffffff;\n';
    impl += 'var result_hi = n64js.getHi32(result);\n';
    impl += 'c.multLo[0] = result_lo;\n';
    impl += 'c.multLo[1] = result_lo >> 31;\n';
    impl += 'c.multHi[0] = result_hi;\n';
    impl += 'c.multHi[1] = result_hi >> 31;\n';
    return generateTrivialOpBoilerplate(impl, ctx);
  }
  function executeMULT(i) {
    var result = cpu0.gprLo_signed[rs(i)] * cpu0.gprLo_signed[rt(i)];

    var lo = result & 0xffffffff;
    var hi = n64js.getHi32(result);

    cpu0.multLo[0] = lo;
    cpu0.multLo[1] = lo >> 31;
    cpu0.multHi[0] = hi;
    cpu0.multHi[1] = hi >> 31;
  }

  function generateMULTU(ctx) {
    var d = ctx.instr_rd();
    var s = ctx.instr_rs();
    var t = ctx.instr_rt();

    var impl = '';
    impl += 'var result = c.gprLo[' + s + '] * c.gprLo[' + t + '];\n';
    impl += 'var result_lo = result & 0xffffffff;\n';
    impl += 'var result_hi = n64js.getHi32(result);\n';
    impl += 'c.multLo[0] = result_lo;\n';
    impl += 'c.multLo[1] = result_lo >> 31;\n';
    impl += 'c.multHi[0] = result_hi;\n';
    impl += 'c.multHi[1] = result_hi >> 31;\n';
    return generateTrivialOpBoilerplate(impl,  ctx);
  }
  function executeMULTU(i) {
    var result = cpu0.gprLo[rs(i)] * cpu0.gprLo[rt(i)];

    var lo = result & 0xffffffff;
    var hi = n64js.getHi32(result);

    cpu0.multLo[0] = lo;
    cpu0.multLo[1] = lo >> 31;
    cpu0.multHi[0] = hi;
    cpu0.multHi[1] = hi >> 31;
  }

  function executeDMULT(i) {
    var result = cpu0.getGPR_s64(rs(i)) * cpu0.getGPR_s64(rt(i));
    cpu0.multLo[0] = result & 0xffffffff;
    cpu0.multLo[1] = n64js.getHi32(result);
    cpu0.multHi_signed[0] = 0;
    cpu0.multHi_signed[1] = 0;
  }

  function executeDMULTU(i) {
    var result = cpu0.getGPR_u64(rs(i)) * cpu0.getGPR_u64(rt(i));
    cpu0.multLo[0] = result & 0xffffffff;
    cpu0.multLo[1] = n64js.getHi32(result);
    cpu0.multHi_signed[0] = 0;
    cpu0.multHi_signed[1] = 0;
  }

  function executeDIV(i) {
    var dividend = cpu0.gprLo_signed[rs(i)];
    var divisor  = cpu0.gprLo_signed[rt(i)];
    if (divisor) {
      setHiLoSignExtend( cpu0.multLo, Math.floor(dividend / divisor) );
      setHiLoSignExtend( cpu0.multHi, dividend % divisor );
    }
  }
  function executeDIVU(i) {
    var dividend = cpu0.gprLo[rs(i)];
    var divisor  = cpu0.gprLo[rt(i)];
    if (divisor) {
      setHiLoSignExtend( cpu0.multLo, Math.floor(dividend / divisor) );
      setHiLoSignExtend( cpu0.multHi, dividend % divisor );
    }
  }

  function executeDDIV(i) {
    var s = rs(i);
    var t = rt(i);

    if ((cpu0.gprHi[s] + (cpu0.gprLo[s] >>> 31) +
         cpu0.gprHi[t] + (cpu0.gprLo[t] >>> 31)) !== 0) {
      // FIXME: seems ok if dividend/divisor fit in mantissa of double...
      var dividend = cpu0.getGPR_s64(s);
      var divisor  = cpu0.getGPR_s64(t);
      if (divisor) {
        setHiLoZeroExtend( cpu0.multLo, Math.floor(dividend / divisor) );
        setHiLoZeroExtend( cpu0.multHi, dividend % divisor );
      }
    } else {
      var dividend = cpu0.gprLo_signed[s];
      var divisor  = cpu0.gprLo_signed[t];
      if (divisor) {
        setHiLoSignExtend( cpu0.multLo, Math.floor(dividend / divisor) );
        setHiLoSignExtend( cpu0.multHi, dividend % divisor );
      }
    }
  }
  function executeDDIVU(i) {

    var s = rs(i);
    var t = rt(i);

    if ((cpu0.gprHi[s] | cpu0.gprHi[t]) !== 0) {
      // FIXME: seems ok if dividend/divisor fit in mantissa of double...
      var dividend = cpu0.getGPR_u64(s);
      var divisor  = cpu0.getGPR_u64(t);
      if (divisor) {
        setHiLoZeroExtend( cpu0.multLo, Math.floor(dividend / divisor) );
        setHiLoZeroExtend( cpu0.multHi, dividend % divisor );
      }
    } else {
      var dividend = cpu0.gprLo[s];
      var divisor  = cpu0.gprLo[t];
      if (divisor) {
        setHiLoZeroExtend( cpu0.multLo, Math.floor(dividend / divisor) );
        setHiLoZeroExtend( cpu0.multHi, dividend % divisor );
      }
    }
  }

  function  generateTrivialArithmetic(ctx, op) {
    var d = ctx.instr_rd();
    var s = ctx.instr_rs();
    var t = ctx.instr_rt();
    var impl = '';
    impl += 'var result = ' + genSrcRegLo(s) + ' ' + op + ' ' + genSrcRegLo(t) + ';\n';
    impl += 'rlo[' + d + '] = result;\n';
    impl += 'rhi[' + d + '] = result >> 31;\n';
    return generateTrivialOpBoilerplate(impl,  ctx);
  }

  function  generateTrivialLogical(ctx, op) {
    var d = ctx.instr_rd();
    var s = ctx.instr_rs();
    var t = ctx.instr_rt();
    var impl = '';
    impl += 'rlo[' + d + '] = ' + genSrcRegLo(s) + ' ' + op + ' ' + genSrcRegLo(t) + ';\n';
    impl += 'rhi[' + d + '] = ' + genSrcRegHi(s) + ' ' + op + ' ' + genSrcRegHi(t) + ';\n';
    return generateTrivialOpBoilerplate(impl,  ctx);
  }




  function generateADD(ctx) { return generateTrivialArithmetic(ctx, '+'); }
  function executeADD(i) {
    var d = rd(i);
    var s = rs(i);
    var t = rt(i);
    var result = cpu0.gprLo_signed[s] + cpu0.gprLo_signed[t];
    cpu0.gprLo_signed[d] = result;
    cpu0.gprHi_signed[d] = result >> 31;
  }


  function generateADDU(ctx) { return generateTrivialArithmetic(ctx, '+'); }
  function executeADDU(i) {
    var d = rd(i);
    var s = rs(i);
    var t = rt(i);
    var result = cpu0.gprLo_signed[s] + cpu0.gprLo_signed[t];
    cpu0.gprLo_signed[d] = result;
    cpu0.gprHi_signed[d] = result >> 31;
  }

  function generateSUB(ctx) { return generateTrivialArithmetic(ctx, '-'); }
  function executeSUB(i) {
    var d = rd(i);
    var s = rs(i);
    var t = rt(i);
    var result = cpu0.gprLo_signed[s] - cpu0.gprLo_signed[t];
    cpu0.gprLo_signed[d] = result;
    cpu0.gprHi_signed[d] = result >> 31;
  }


  function generateSUBU(ctx) { return generateTrivialArithmetic(ctx, '-'); }
  function executeSUBU(i) {
    var d = rd(i);
    var s = rs(i);
    var t = rt(i);
    var result = cpu0.gprLo_signed[s] - cpu0.gprLo_signed[t];
    cpu0.gprLo_signed[d] = result;
    cpu0.gprHi_signed[d] = result >> 31;
  }

  function generateAND(ctx) { return generateTrivialLogical(ctx, '&'); }
  function executeAND(i) {
    var d = rd(i);
    var s = rs(i);
    var t = rt(i);
    cpu0.gprHi_signed[d] = cpu0.gprHi_signed[s] & cpu0.gprHi_signed[t];
    cpu0.gprLo_signed[d] = cpu0.gprLo_signed[s] & cpu0.gprLo_signed[t];
  }


  function generateOR(ctx) {
    var d = ctx.instr_rd();
    var s = ctx.instr_rs();
    var t = ctx.instr_rt();

    // OR is used to implement CLEAR and MOV
    if (t === 0) {
      var impl = '';
      impl += 'rlo[' + d + '] = ' + genSrcRegLo(s) + ';\n';
      impl += 'rhi[' + d + '] = ' + genSrcRegHi(s) + ';\n';

      return generateTrivialOpBoilerplate(impl,  ctx);
    }

    return generateTrivialLogical(ctx, '|');
  }

  function executeOR(i) {
    var d = rd(i);
    var s = rs(i);
    var t = rt(i);
    cpu0.gprHi_signed[d] = cpu0.gprHi_signed[s] | cpu0.gprHi_signed[t];
    cpu0.gprLo_signed[d] = cpu0.gprLo_signed[s] | cpu0.gprLo_signed[t];
  }


  function generateXOR(ctx) { return generateTrivialLogical(ctx, '^'); }
  function executeXOR(i) {
    var d = rd(i);
    var s = rs(i);
    var t = rt(i);
    cpu0.gprHi_signed[d] = cpu0.gprHi_signed[s] ^ cpu0.gprHi_signed[t];
    cpu0.gprLo_signed[d] = cpu0.gprLo_signed[s] ^ cpu0.gprLo_signed[t];
  }

  function  generateNOR(ctx) {
    var d = ctx.instr_rd();
    var s = ctx.instr_rs();
    var t = ctx.instr_rt();
    var impl = '';
    impl += 'rhi[' + d + '] = ~(' + genSrcRegHi(s) + ' | ' + genSrcRegHi(t) + ');\n';
    impl += 'rlo[' + d + '] = ~(' + genSrcRegLo(s) + ' | ' + genSrcRegLo(t) + ');\n';
    return generateTrivialOpBoilerplate(impl, ctx);
  }

  function  executeNOR(i) {
    var d = rd(i);
    var s = rs(i);
    var t = rt(i);
    cpu0.gprHi_signed[d] = ~(cpu0.gprHi_signed[s] | cpu0.gprHi_signed[t]);
    cpu0.gprLo_signed[d] = ~(cpu0.gprLo_signed[s] | cpu0.gprLo_signed[t]);
  }


  function generateSLT(ctx) {
    var d = ctx.instr_rd();
    var s = ctx.instr_rs();
    var t = ctx.instr_rt();
    var impl = '';

    impl += 'var r = 0;\n';
    impl += 'if (' + genSrcRegHi(s) + ' < ' + genSrcRegHi(t) + ') {\n';
    impl += '  r = 1;\n';
    impl += '} else if (' + genSrcRegHi(s) + ' === ' + genSrcRegHi(t) + ') {\n';
    impl += '  r = (c.gprLo[' + s + '] < c.gprLo[' + t + ']) ? 1 : 0;\n';
    impl += '}\n';
    impl += 'rlo[' + d + '] = r;\n';
    impl += 'rhi[' + d + '] = 0;\n';

    return generateTrivialOpBoilerplate(impl, ctx);
  }
  function executeSLT(i) {
    var d = rd(i);
    var s = rs(i);
    var t = rt(i);
    var r = 0;
    if (cpu0.gprHi_signed[s] < cpu0.gprHi_signed[t]) {
      r = 1;
    } else if (cpu0.gprHi_signed[s] === cpu0.gprHi_signed[t]) {
      r = (cpu0.gprLo[s] < cpu0.gprLo[t]) ? 1 : 0;
    }
    cpu0.gprLo_signed[d] = r;
    cpu0.gprHi_signed[d] = 0;
  }


  function generateSLTU(ctx) {
    var d = ctx.instr_rd();
    var s = ctx.instr_rs();
    var t = ctx.instr_rt();
    var impl = '';

    impl += 'var r = 0;\n';
    impl += 'if (c.gprHi[' + s + '] < c.gprHi[' + t + '] ||\n';
    impl += '    (' + genSrcRegHi(s) + ' === ' + genSrcRegHi(t) + ' && c.gprLo[' + s + '] < c.gprLo[' + t + '])) {\n';
    impl += '  r = 1;\n';
    impl += '}\n';
    impl += 'rlo[' + d + '] = r;\n';
    impl += 'rhi[' + d + '] = 0;\n';

    return generateTrivialOpBoilerplate(impl, ctx);
  }
  function executeSLTU(i) {
    var d = rd(i);
    var s = rs(i);
    var t = rt(i);
    var r = 0;
    if (cpu0.gprHi[s] < cpu0.gprHi[t] ||
        (cpu0.gprHi_signed[s] === cpu0.gprHi_signed[t] && cpu0.gprLo[s] < cpu0.gprLo[t])) { // NB signed cmps avoid deopts
      r = 1;
    }
    cpu0.gprLo_signed[d] = r;
    cpu0.gprHi_signed[d] = 0;
  }


  function executeDADD(i) {
    cpu0.setGPR_s64(rd(i), cpu0.getGPR_s64(rs(i)) + cpu0.getGPR_s64(rt(i)));
    // NB: identical to DADDU, but should throw exception on overflow
  }
  function executeDADDU(i) {
    cpu0.setGPR_s64(rd(i), cpu0.getGPR_s64(rs(i)) + cpu0.getGPR_s64(rt(i)));
  }

  function executeDSUB(i) {
    cpu0.setGPR_s64(rd(i), cpu0.getGPR_s64(rs(i)) - cpu0.getGPR_s64(rt(i)));
    // NB: identical to DSUBU, but should throw exception on overflow
  }
  function executeDSUBU(i) {
    cpu0.setGPR_s64(rd(i), cpu0.getGPR_s64(rs(i)) - cpu0.getGPR_s64(rt(i)));
  }

  function executeTGE(i)        { unimplemented(cpu0.pc,i); }
  function executeTGEU(i)       { unimplemented(cpu0.pc,i); }
  function executeTLT(i)        { unimplemented(cpu0.pc,i); }
  function executeTLTU(i)       { unimplemented(cpu0.pc,i); }
  function executeTEQ(i)        { unimplemented(cpu0.pc,i); }
  function executeTNE(i)        { unimplemented(cpu0.pc,i); }

  function executeMFC0(i) {
    var control_reg = fs(i);

    // Check consistency
    if (control_reg === cpu0.kControlCause) {
      checkCauseIP3Consistent();
    }

    if (control_reg === cpu0.kControlRand) {
      setZeroExtend( rt(i), cpu0.getRandom() );
    } else {
      setZeroExtend( rt(i), cpu0.control[control_reg] );
    }
  }

  function generateMTC0(ctx) {
    var s = ctx.instr_fs();
    if (s === cpu0.kControlSR) {
      ctx.fragment.cop1statusKnown = false;
    }

    var impl = '';
    impl += 'n64js.executeMTC0(' + n64js.toString32(ctx.instruction) + ');\n';
    return generateGenericOpBoilerplate(impl, ctx);
  }

  function executeMTC0(i) {
    var control_reg = fs(i);
    var new_value   = cpu0.gprLo[rt(i)];

    switch (control_reg) {
      case cpu0.kControlContext:
        n64js.log('Setting Context register to ' + n64js.toString32(new_value) );
        cpu0.control[cpu0.kControlContext] = new_value;
        break;

      case cpu0.kControlWired:
        n64js.log('Setting Wired register to ' + n64js.toString32(new_value) );
        // Set to top limit on write to wired
        cpu0.control[cpu0.kControlRand]  = 31;
        cpu0.control[cpu0.kControlWired] = new_value;
        break;

      case cpu0.kControlRand:
      case cpu0.kControlBadVAddr:
      case cpu0.kControlPRId:
      case cpu0.kControlCacheErr:
        // All these registers are read-only
        n64js.log('Attempted write to read-only cpu0 control register. ' + n64js.toString32(new_value) + ' --> ' + n64js.cop0ControlRegisterNames[control_reg] );
        break;

      case cpu0.kControlCause:
        n64js.log('Setting cause register to ' + n64js.toString32(new_value) );
        n64js.check(new_value === 0, 'Should only write 0 to Cause register.');
        cpu0.control[cpu0.kControlCause] &= ~0x300;
        cpu0.control[cpu0.kControlCause] |= (new_value & 0x300);
        break;

      case cpu0.kControlSR:
        cpu0.setSR(new_value);
        break;
      case cpu0.kControlCount:
        cpu0.control[cpu0.kControlCount] = new_value;
        break;
      case cpu0.kControlCompare:
        cpu0.setCompare(new_value);
        break;

      case cpu0.kControlEPC:
      case cpu0.kControlEntryHi:
      case cpu0.kControlEntryLo0:
      case cpu0.kControlEntryLo1:
      case cpu0.kControlIndex:
      case cpu0.kControlPageMask:
      case cpu0.kControlTagLo:
      case cpu0.kControlTagHi:
        cpu0.control[control_reg] = new_value;
        break;

      default:
        cpu0.control[control_reg] = new_value;
        n64js.log('Write to cpu0 control register. ' + n64js.toString32(new_value) + ' --> ' + n64js.cop0ControlRegisterNames[control_reg] );
        break;
    }
  }
  function executeTLB(i) {
     switch(tlbop(i)) {
       case 0x01:    cpu0.tlbRead();        return;
       case 0x02:    cpu0.tlbWriteIndex();  return;
       case 0x06:    cpu0.tlbWriteRandom(); return;
       case 0x08:    cpu0.tlbProbe();       return;
       case 0x18:    executeERET(i);        return;
     }
     executeUnknown(i);
  }


  function executeERET(i) {
    if (cpu0.control[cpu0.kControlSR] & SR_ERL) {
      cpu0.nextPC = cpu0.control[cpu0.kControlErrorEPC];
      cpu0.control[cpu0.kControlSR] &= ~SR_ERL;
      n64js.log('ERET from error trap - ' + cpu0.nextPC);
    } else {
      cpu0.nextPC = cpu0.control[cpu0.kControlEPC];
      cpu0.control[cpu0.kControlSR] &= ~SR_EXL;
      //n64js.log('ERET from interrupt/exception ' + cpu0.nextPC);
    }
  }

  function executeTGEI(i)       { unimplemented(cpu0.pc,i); }
  function executeTGEIU(i)      { unimplemented(cpu0.pc,i); }
  function executeTLTI(i)       { unimplemented(cpu0.pc,i); }
  function executeTLTIU(i)      { unimplemented(cpu0.pc,i); }
  function executeTEQI(i)       { unimplemented(cpu0.pc,i); }
  function executeTNEI(i)       { unimplemented(cpu0.pc,i); }

  // Jump
  function generateJ(ctx) {
    var addr = jumpAddress(ctx.pc, ctx.instruction);
    var impl = 'c.delayPC = ' + n64js.toString32(addr) + ';\n';
    return generateBranchOpBoilerplate(impl, ctx, false);
  }
  function executeJ(i) {
    performBranch( jumpAddress(cpu0.pc,i) );
  }


  function generateJAL(ctx) {
    var addr  = jumpAddress(ctx.pc, ctx.instruction);
    var ra    = ctx.pc + 8;
    var ra_hi = (ra & 0x80000000) ? -1 : 0;
    var impl  = '';
    impl += 'c.delayPC = ' + n64js.toString32(addr) + ';\n';
    impl += 'rlo[' + cpu0.kRegister_ra + '] = ' + n64js.toString32(ra) + ';\n';
    impl += 'rhi[' + cpu0.kRegister_ra + '] = ' + ra_hi + ';\n';
    return generateBranchOpBoilerplate(impl, ctx, false);
  }
  function executeJAL(i) {
    setSignExtend(cpu0.kRegister_ra, cpu0.pc + 8);
    performBranch( jumpAddress(cpu0.pc,i) );
  }


  function generateJALR(ctx) {
    var s    = ctx.instr_rs();
    var d    = ctx.instr_rd();

    var ra    = ctx.pc + 8;
    var ra_hi = (ra & 0x80000000) ? -1 : 0;
    var impl  = '';
    impl += 'c.delayPC = c.gprLo[' + s + '];\n';  // NB needs to be unsigned
    impl += 'rlo[' + d + '] = ' + n64js.toString32(ra) + ';\n';
    impl += 'rhi[' + d + '] = ' + ra_hi + ';\n';
    return generateBranchOpBoilerplate(impl, ctx, false);
  }
  function executeJALR(i) {
    var new_pc = cpu0.gprLo[rs(i)];
    setSignExtend(rd(i), cpu0.pc + 8);
    performBranch( new_pc );
  }


  function generateJR(ctx) {
    var impl = 'c.delayPC = c.gprLo[' + ctx.instr_rs() + '];\n'; // NB needs to be unsigned
    return generateBranchOpBoilerplate(impl, ctx, false);
   }
   function executeJR(i) {
    performBranch( cpu0.gprLo[rs(i)] );
  }

  function generateBEQ(ctx) {
    var s    = ctx.instr_rs();
    var t    = ctx.instr_rt();
    var off  = ctx.instr_offset();
    var addr = branchAddress(ctx.pc, ctx.instruction);

    var impl = '';

    if (s === t) {
      if (off === -1) {
        impl += 'c.speedHack();\n';
        ctx.bailOut = true;
      }
      impl += 'c.delayPC = ' + n64js.toString32(addr) + ';\n';
   } else {
      impl += 'if (' + genSrcRegHi(s) + ' === ' + genSrcRegHi(t) + ' &&\n';
      impl += '    ' + genSrcRegLo(s) + ' === ' + genSrcRegLo(t) + ' ) {\n';
      if (off === -1) {
        impl += '  c.speedHack();\n';
        ctx.bailOut = true;
      }
      impl += '  c.delayPC = ' + n64js.toString32(addr) + ';\n';
      impl += '}\n';
    }

    return generateBranchOpBoilerplate(impl, ctx, false);
  }

  function executeBEQ(i) {
    var s = rs(i);
    var t = rt(i);
    if (cpu0.gprHi_signed[s] === cpu0.gprHi_signed[t] &&
        cpu0.gprLo_signed[s] === cpu0.gprLo_signed[t] ) {
      if (offset(i) === -1 )
        cpu0.speedHack();
      performBranch( branchAddress(cpu0.pc,i) );
    }
  }


  function generateBEQL(ctx) {
    var s    = ctx.instr_rs();
    var t    = ctx.instr_rt();
    var off  = ctx.instr_offset();
    var addr = branchAddress(ctx.pc, ctx.instruction);

    var impl = '';

    impl += 'if (' + genSrcRegHi(s) + ' === ' + genSrcRegHi(t) + ' &&\n';
    impl += '    ' + genSrcRegLo(s) + ' === ' + genSrcRegLo(t) + ' ) {\n';
    impl += '  c.delayPC = ' + n64js.toString32(addr) + ';\n';
    impl += '} else {\n';
    impl += '  c.nextPC += 4;\n';
    impl += '}\n';

    return generateBranchOpBoilerplate(impl, ctx, true /* might_adjust_next_pc*/);
  }

  function executeBEQL(i) {
    var s = rs(i);
    var t = rt(i);
    if (cpu0.gprHi_signed[s] === cpu0.gprHi_signed[t] &&
        cpu0.gprLo_signed[s] === cpu0.gprLo_signed[t] ) {
      performBranch( branchAddress(cpu0.pc,i) );
    } else {
      cpu0.nextPC += 4;   // skip the next instruction
    }
  }


  function generateBNE(ctx) {
    var s    = ctx.instr_rs();
    var t    = ctx.instr_rt();
    var off  = ctx.instr_offset();
    var addr = branchAddress(ctx.pc, ctx.instruction);

    var impl = '';

    impl += 'if (' + genSrcRegHi(s) + ' !== ' + genSrcRegHi(t) + ' ||\n';
    impl += '    ' + genSrcRegLo(s) + ' !== ' + genSrcRegLo(t) + ' ) {\n';
    if (off === -1) {
      impl += '  c.speedHack();\n';
      ctx.bailOut = true;
    }
    impl += '  c.delayPC = ' + n64js.toString32(addr) + ';\n';
    impl += '}\n';

    return generateBranchOpBoilerplate(impl, ctx, false);
  }

  function executeBNE(i) {
    var s = rs(i);
    var t = rt(i);
    if (cpu0.gprHi_signed[s] !== cpu0.gprHi_signed[t] ||
        cpu0.gprLo_signed[s] !== cpu0.gprLo_signed[t] ) {      // NB: if imms(i) == -1 then this is a branch to self/busywait
      performBranch( branchAddress(cpu0.pc,i) );
    }
  }


  function generateBNEL(ctx) {
    var s    = ctx.instr_rs();
    var t    = ctx.instr_rt();
    var off  = ctx.instr_offset();
    var addr = branchAddress(ctx.pc, ctx.instruction);

    var impl = '';

    impl += 'if (' + genSrcRegHi(s) + ' !== ' + genSrcRegHi(t) + ' ||\n';
    impl += '    ' + genSrcRegLo(s) + ' !== ' + genSrcRegLo(t) + ' ) {\n';
    impl += '  c.delayPC = ' + n64js.toString32(addr) + ';\n';
    impl += '} else {\n';
    impl += '  c.nextPC += 4;\n';
    impl += '}\n';

    return generateBranchOpBoilerplate(impl, ctx, true /* might_adjust_next_pc*/);
  }

  function executeBNEL(i) {
    var s = rs(i);
    var t = rt(i);
    if (cpu0.gprHi_signed[s] !== cpu0.gprHi_signed[t] ||
        cpu0.gprLo_signed[s] !== cpu0.gprLo_signed[t] ) {
      performBranch( branchAddress(cpu0.pc,i) );
    } else {
      cpu0.nextPC += 4;   // skip the next instruction
    }
  }

  // Branch Less Than or Equal To Zero
  function generateBLEZ(ctx) {
    var s    = ctx.instr_rs();
    var addr = branchAddress(ctx.pc, ctx.instruction);

    var impl = '';
    impl += 'if ( ' + genSrcRegHi(s) + ' < 0 ||\n';
    impl += '    (' + genSrcRegHi(s) + ' === 0 && ' + genSrcRegLo(s) + ' === 0) ) {\n';
    impl += '  c.delayPC = ' + n64js.toString32(addr) + ';\n';
    impl += '}\n';

    return generateBranchOpBoilerplate(impl, ctx, false);
  }

  function executeBLEZ(i) {
    var s = rs(i);
    if ( cpu0.gprHi_signed[s] < 0 ||
        (cpu0.gprHi_signed[s] === 0 && cpu0.gprLo_signed[s] === 0) ) {
      performBranch( branchAddress(cpu0.pc,i) );
    }
  }
  function executeBLEZL(i) {
    var s = rs(i);
    // NB: if rs == r0 then this branch is always taken
    if ( cpu0.gprHi_signed[s] < 0 ||
        (cpu0.gprHi_signed[s] === 0 && cpu0.gprLo_signed[s] === 0) ) {
      performBranch( branchAddress(cpu0.pc,i) );
    } else {
      cpu0.nextPC += 4;   // skip the next instruction
    }
  }

  // Branch Greater Than Zero
  function generateBGTZ(ctx) {
    var s    = ctx.instr_rs();
    var addr = branchAddress(ctx.pc, ctx.instruction);

    var impl = '';
    impl += 'if ( ' + genSrcRegHi(s) + ' >= 0 &&\n';
    impl += '    (' + genSrcRegHi(s) + ' !== 0 || ' + genSrcRegLo(s) + ' !== 0) ) {\n';
    impl += '  c.delayPC = ' + n64js.toString32(addr) + ';\n';
    impl += '}\n';

    return generateBranchOpBoilerplate(impl, ctx, false);
  }

  function executeBGTZ(i) {
    var s = rs(i);
    if ( cpu0.gprHi_signed[s] >= 0 &&
        (cpu0.gprHi_signed[s] !== 0 || cpu0.gprLo_signed[s] !== 0) ) {
      performBranch( branchAddress(cpu0.pc,i) );
    }
  }
  function executeBGTZL(i) {
    var s = rs(i);
    if ( cpu0.gprHi_signed[s] >= 0 &&
        (cpu0.gprHi_signed[s] !== 0 || cpu0.gprLo_signed[s] !== 0) ) {
      performBranch( branchAddress(cpu0.pc,i) );
    } else {
      cpu0.nextPC += 4;   // skip the next instruction
    }
  }


  // Branch Less Than Zero
  function generateBLTZ(ctx) {
    var s    = ctx.instr_rs();
    var addr = branchAddress(ctx.pc, ctx.instruction);

    var impl = '';
    impl += 'if (' + genSrcRegHi(s) + ' < 0) {\n';
    impl += '  c.delayPC = ' + n64js.toString32(addr) + ';\n';
    impl += '}\n';

    return generateBranchOpBoilerplate(impl, ctx, false);
  }

  function executeBLTZ(i) {
    if (cpu0.gprHi_signed[rs(i)] < 0) {
      performBranch( branchAddress(cpu0.pc,i) );
    }
  }


  function generateBLTZL(ctx) {
    var s    = ctx.instr_rs();
    var addr = branchAddress(ctx.pc, ctx.instruction);

    var impl = '';
    impl += 'if (' + genSrcRegHi(s) + ' < 0) {\n';
    impl += '  c.delayPC = ' + n64js.toString32(addr) + ';\n';
    impl += '} else {\n';
    impl += '  c.nextPC += 4;\n';
    impl += '}\n';

    return generateBranchOpBoilerplate(impl, ctx, true /* might_adjust_next_pc*/);
  }
  function executeBLTZL(i) {
    if (cpu0.gprHi_signed[rs(i)] < 0) {
      performBranch( branchAddress(cpu0.pc,i) );
    } else {
      cpu0.nextPC += 4;   // skip the next instruction
    }
  }



  function executeBLTZAL(i) {
    setSignExtend(cpu0.kRegister_ra, cpu0.pc + 8);
    if (cpu0.gprHi_signed[rs(i)] < 0) {
      performBranch( branchAddress(cpu0.pc,i) );
    }
  }
  function executeBLTZALL(i) {
    setSignExtend(cpu0.kRegister_ra, cpu0.pc + 8);
    if (cpu0.gprHi_signed[rs(i)] < 0) {
      performBranch( branchAddress(cpu0.pc,i) );
    } else {
      cpu0.nextPC += 4;   // skip the next instruction
    }
  }


  // Branch Greater Than Zero
  function generateBGEZ(ctx) {
    var s    = ctx.instr_rs();
    var addr = branchAddress(ctx.pc, ctx.instruction);

    var impl = '';
    impl += 'if (' + genSrcRegHi(s) + ' >= 0) {\n';
    impl += '  c.delayPC = ' + n64js.toString32(addr) + ';\n';
    impl += '}\n';

    return generateBranchOpBoilerplate(impl, ctx, false);
  }
  function executeBGEZ(i) {
    if (cpu0.gprHi_signed[rs(i)] >= 0) {
      performBranch( branchAddress(cpu0.pc,i) );
    }
  }

  function generateBGEZL(ctx) {
    var s    = ctx.instr_rs();
    var addr = branchAddress(ctx.pc, ctx.instruction);

    var impl = '';
    impl += 'if (' + genSrcRegHi(s) + ' >= 0) {\n';
    impl += '  c.delayPC = ' + n64js.toString32(addr) + ';\n';
    impl += '} else {\n';
    impl += '  c.nextPC += 4;\n';
    impl += '}\n';

    return generateBranchOpBoilerplate(impl, ctx, true /* might_adjust_next_pc*/);
  }
  function executeBGEZL(i) {
    if (cpu0.gprHi_signed[rs(i)] >= 0) {
      performBranch( branchAddress(cpu0.pc,i) );
    } else {
      cpu0.nextPC += 4;   // skip the next instruction
    }
  }


  function executeBGEZAL(i) {
    setSignExtend(cpu0.kRegister_ra, cpu0.pc + 8);
    if (cpu0.gprHi_signed[rs(i)] >= 0) {
      performBranch( branchAddress(cpu0.pc,i) );
    }
  }
  function executeBGEZALL(i) {
    setSignExtend(cpu0.kRegister_ra, cpu0.pc + 8);
    if (cpu0.gprHi_signed[rs(i)] >= 0) {
      performBranch( branchAddress(cpu0.pc,i) );
    } else {
      cpu0.nextPC += 4;   // skip the next instruction
    }
  }

  function generateADDI(ctx) {
    var s = ctx.instr_rs();
    var t = ctx.instr_rt();
    var impl = '';
    impl += 'var result = ' + genSrcRegLo(s) + ' + ' + imms(ctx.instruction) + ';\n';
    impl += 'rlo[' + t + '] = result;\n';
    impl += 'rhi[' + t + '] = result >> 31;\n';
    return generateTrivialOpBoilerplate(impl, ctx);
  }

  function executeADDI(i) {
    var s         = rs(i);
    var t         = rt(i);
    var result    = cpu0.gprLo_signed[s] + imms(i);
    cpu0.gprLo_signed[t] = result;
    cpu0.gprHi_signed[t] = result >> 31;
  }

  function generateADDIU(ctx) {
    var s = ctx.instr_rs();
    var t = ctx.instr_rt();
    var impl = '';
    impl += 'var result = ' + genSrcRegLo(s) + ' + ' + imms(ctx.instruction) + ';\n';
    impl += 'rlo[' + t + '] = result;\n';
    impl += 'rhi[' + t + '] = result >> 31;\n';
    return generateTrivialOpBoilerplate(impl, ctx);
  }

  function executeADDIU(i) {
    var s         = rs(i);
    var t         = rt(i);
    var result    = cpu0.gprLo_signed[s] + imms(i);
    cpu0.gprLo_signed[t] = result;
    cpu0.gprHi_signed[t] = result >> 31;
  }



  function executeDADDI(i) {
    cpu0.setGPR_s64(rt(i), cpu0.getGPR_s64(rs(i)) + imms(i));
  }
  function executeDADDIU(i) {
    cpu0.setGPR_s64(rt(i), cpu0.getGPR_s64(rs(i)) + imms(i));
  }



  function generateSLTI(ctx) {
    var s = ctx.instr_rs();
    var t = ctx.instr_rt();

    var immediate    = imms(ctx.instruction);
    var imm_hi       = immediate >> 31;
    var imm_unsigned = immediate >>> 0;

    var impl = '';
    impl += 'if (' + genSrcRegHi(s) + ' === ' + imm_hi + ') {\n';
    impl += '  rlo[' + t + '] = (c.gprLo[' + s  +'] < ' + imm_unsigned + ') ? 1 : 0;\n';
    impl += '} else {\n';
    impl += '  rlo[' + t + '] = (' + genSrcRegHi(s) + ' < ' + imm_hi + ') ? 1 : 0;\n';
    impl += '}\n';
    impl += 'rhi[' + t + '] = 0;\n';

    return generateTrivialOpBoilerplate(impl, ctx);
  }

  function executeSLTI(i) {
    var s         = rs(i);
    var t         = rt(i);

    var immediate = imms(i);
    var imm_hi    = immediate >> 31;
    var s_hi      = cpu0.gprHi_signed[s];

    if (s_hi === imm_hi) {
      cpu0.gprLo_signed[t] = (cpu0.gprLo[s] < (immediate>>>0)) ? 1 : 0;    // NB signed compare
    } else {
      cpu0.gprLo_signed[t] = (s_hi < imm_hi) ? 1 : 0;
    }
    cpu0.gprHi_signed[t] = 0;
  }


  function generateSLTIU(ctx) {
    var s = ctx.instr_rs();
    var t = ctx.instr_rt();

    var immediate    = imms(ctx.instruction);
    var imm_hi       = immediate >> 31;
    var imm_unsigned = immediate >>> 0;

    var impl = '';
    impl += 'if (' + genSrcRegHi(s) + ' === ' + imm_hi + ') {\n';
    impl += '  rlo[' + t + '] = (c.gprLo[' + s  +'] < ' + imm_unsigned + ') ? 1 : 0;\n';
    impl += '} else {\n';
    impl += '  rlo[' + t + '] = ((' + genSrcRegHi(s) + '>>>0) < (' + (imm_hi>>>0) + ')) ? 1 : 0;\n';
    impl += '}\n';
    impl += 'rhi[' + t + '] = 0;\n';

    return generateTrivialOpBoilerplate(impl, ctx);
  }

  function executeSLTIU(i) {
    var s         = rs(i);
    var t         = rt(i);

    // NB: immediate value is still sign-extended, but treated as unsigned
    var immediate = imms(i);
    var imm_hi    = immediate >> 31;
    var s_hi      = cpu0.gprHi_signed[s];

    if (s_hi === imm_hi) {
      cpu0.gprLo[t] = (cpu0.gprLo[s] < (immediate>>>0)) ? 1 : 0;
    } else {
      cpu0.gprLo[t] = ((s_hi>>>0) < (imm_hi>>>0)) ? 1 : 0;
    }
    cpu0.gprHi[t] = 0;

  }

  function generateANDI(ctx) {
    var s = ctx.instr_rs();
    var t = ctx.instr_rt();
    var impl = '';
    impl += 'rlo[' + t + '] = ' + genSrcRegLo(s) + ' & ' + imm(ctx.instruction) + ';\n';
    impl += 'rhi[' + t + '] = 0;\n';
    return generateTrivialOpBoilerplate(impl, ctx);
  }

  function executeANDI(i) {
    var s = rs(i);
    var t = rt(i);
    cpu0.gprLo_signed[t] = cpu0.gprLo_signed[s] & imm(i);
    cpu0.gprHi_signed[t] = 0;    // always 0, as sign extended immediate value is always 0
  }



  function generateORI(ctx) {
    var s = ctx.instr_rs();
    var t = ctx.instr_rt();
    var impl = '';
    impl += 'rlo[' + t + '] = ' + genSrcRegLo(s) + ' | ' + imm(ctx.instruction) + ';\n';
    if (s !== t)
      impl += 'rhi[' + t + '] = ' + genSrcRegHi(s) + ';\n';
    return generateTrivialOpBoilerplate(impl, ctx);
  }

  function executeORI(i) {
    var s = rs(i);
    var t = rt(i);
    cpu0.gprLo_signed[t] = cpu0.gprLo_signed[s] | imm(i);
    cpu0.gprHi_signed[t] = cpu0.gprHi_signed[s];
  }


  function generateXORI(ctx) {
    var s = ctx.instr_rs();
    var t = ctx.instr_rt();
    var impl = '';
    impl += 'rlo[' + t + '] = ' + genSrcRegLo(s) + ' ^ ' + imm(ctx.instruction) + ';\n';
    if (s !== t)
      impl += 'rhi[' + t + '] = ' + genSrcRegHi(s) + ';\n';
    return generateTrivialOpBoilerplate(impl, ctx);
  }

  function executeXORI(i) {
    // High 32 bits are always unchanged, as sign extended immediate value is always 0
    var s = rs(i);
    var t = rt(i);
    cpu0.gprLo_signed[t] = cpu0.gprLo_signed[s] ^ imm(i);
    cpu0.gprHi_signed[t] = cpu0.gprHi_signed[s];
  }


  function generateLUI(ctx) {
    var t = ctx.instr_rt();
    var value_lo = imms(ctx.instruction) << 16;
    var value_hi = (value_lo < 0) ? -1 : 0;

    var impl = '';
    impl += 'rlo[' + t +'] = ' + value_lo + ';\n';
    impl += 'rhi[' + t +'] = ' + value_hi + ';\n';
    return generateTrivialOpBoilerplate(impl, ctx);
  }

  function executeLUI(i) {
    var t = rt(i);
    var value = imms(i) << 16;
    cpu0.gprLo_signed[t] = value;
    cpu0.gprHi_signed[t] = value >> 31;
  }



  function generateLB(ctx) {
    var t = ctx.instr_rt();
    var b = ctx.instr_base();
    var o = ctx.instr_imms();

    var impl = '';
    impl += 'var value = n64js.load_s8(ram, ' + genSrcRegLo(b) + ' + ' + o + ');\n';
    impl += 'rlo[' + t + '] = value;\n';
    impl += 'rhi[' + t + '] = value >> 31;\n';

    return generateMemoryAccessBoilerplate(impl, ctx);
  }
  function executeLB(i) {
    var t = rt(i);
    var b = base(i);
    var o = imms(i);

    var value = n64js.load_s8(cpu0.ram, cpu0.gprLo_signed[b] + o);
    cpu0.gprLo_signed[t] = value;
    cpu0.gprHi_signed[t] = value >> 31;
  }

  function generateLBU(ctx) {
    var t = ctx.instr_rt();
    var b = ctx.instr_base();
    var o = ctx.instr_imms();

    var impl = '';
    impl += 'rlo[' + t + '] = n64js.load_u8(ram, ' + genSrcRegLo(b) + ' + ' + o + ');\n';
    impl += 'rhi[' + t + '] = 0;\n';

    return generateMemoryAccessBoilerplate(impl, ctx);
  }
  function executeLBU(i) {
    var t = rt(i);
    var b = base(i);
    var o = imms(i);

    cpu0.gprLo_signed[t] = n64js.load_u8(cpu0.ram, cpu0.gprLo_signed[b] + o);
    cpu0.gprHi_signed[t] = 0;
  }

  function generateLH(ctx) {
    var t = ctx.instr_rt();
    var b = ctx.instr_base();
    var o = ctx.instr_imms();

    var impl = '';
    impl += 'var value = n64js.load_s16(ram, ' + genSrcRegLo(b) + ' + ' + o + ');\n';
    impl += 'rlo[' + t + '] = value;\n';
    impl += 'rhi[' + t + '] = value >> 31;\n';

    return generateMemoryAccessBoilerplate(impl, ctx);
  }
  function executeLH(i) {
    var t = rt(i);
    var b = base(i);
    var o = imms(i);

    var value = n64js.load_s16(cpu0.ram, cpu0.gprLo_signed[b] + o);
    cpu0.gprLo_signed[t] = value;
    cpu0.gprHi_signed[t] = value >> 31;
  }

  function generateLHU(ctx) {
    var t = ctx.instr_rt();
    var b = ctx.instr_base();
    var o = ctx.instr_imms();

    var impl = '';
    impl += 'rlo[' + t + '] = n64js.load_u16(ram, ' + genSrcRegLo(b) + ' + ' + o + ');\n';
    impl += 'rhi[' + t + '] = 0;\n';

    return generateMemoryAccessBoilerplate(impl, ctx);
  }
  function executeLHU(i) {
    var t = rt(i);
    var b = base(i);
    var o = imms(i);

    cpu0.gprLo_signed[t] = n64js.load_u16(cpu0.ram, cpu0.gprLo_signed[b] + o);
    cpu0.gprHi_signed[t] = 0;
  }


  function generateLW(ctx) {
    var t = ctx.instr_rt();
    var b = ctx.instr_base();
    var o = ctx.instr_imms();
    // SF2049 requires this, apparently
    if (t === 0)
      return generateNOPBoilerplate('/*load to r0!*/', ctx);

    var impl = '';
    impl += 'var value = n64js.load_s32(ram, ' + genSrcRegLo(b) + ' + ' + o + ');\n';
    impl += 'rlo[' + t + '] = value;\n';
    impl += 'rhi[' + t + '] = value >> 31;\n';

    return generateMemoryAccessBoilerplate(impl, ctx);
  }
  function executeLW(i) {
    var t = rt(i);
    var b = base(i);
    var o = imms(i);

    // SF2049 requires this, apparently
    if (t === 0)
      return;

    var value = n64js.load_s32(cpu0.ram, cpu0.gprLo_signed[b] + o);
    cpu0.gprLo_signed[t] = value;
    cpu0.gprHi_signed[t] = value >> 31;
  }

  function generateLWU(ctx) {
    var t = ctx.instr_rt();
    var b = ctx.instr_base();
    var o = ctx.instr_imms();

    var impl = '';
    impl += 'rlo[' + t + '] = n64js.load_u32(ram, ' + genSrcRegLo(b) + ' + ' + o + ');\n';
    impl += 'rhi[' + t + '] = 0;\n';

    return generateMemoryAccessBoilerplate(impl, ctx);
  }
  function executeLWU(i) {
    var t = rt(i);
    var b = base(i);
    var o = imms(i);

    cpu0.gprLo_signed[t] = n64js.load_u32(cpu0.ram, cpu0.gprLo_signed[b] + o);
    cpu0.gprHi_signed[t] = 0;
  }


  function generateLD(ctx) {
    var t = ctx.instr_rt();
    var b = ctx.instr_base();
    var o = ctx.instr_imms();

    var impl = '';
    impl += 'var addr = ' + genSrcRegLo(b) + ' + ' + o + ';\n';
    impl += 'if (addr < -2139095040) {\n';
    impl += '  var phys = (addr + 0x80000000) | 0;\n';
    impl += '  rhi[' + t + '] = ((ram[phys  ] << 24) | (ram[phys+1] << 16) | (ram[phys+2] << 8) | ram[phys+3]);\n';
    impl += '  rlo[' + t + '] = ((ram[phys+4] << 24) | (ram[phys+5] << 16) | (ram[phys+6] << 8) | ram[phys+7]);\n';
    impl += '} else {\n';
    impl += '  rhi[' + t + '] = lw_slow(addr);\n';
    impl += '  rlo[' + t + '] = lw_slow(addr + 4);\n';
    impl += '}\n';
    return generateMemoryAccessBoilerplate(impl, ctx);
  }

  function executeLD(i) {
    var t = rt(i);
    var b = base(i);
    var o = imms(i);

    var addr = cpu0.gprLo_signed[b] + o;
    if (addr < -2139095040) {
      var phys = (addr + 0x80000000) | 0;  // NB: or with zero ensures we return an SMI if possible.
      var ram = cpu0.ram;
      cpu0.gprHi_signed[t] = ((ram[phys  ] << 24) | (ram[phys+1] << 16) | (ram[phys+2] << 8) | ram[phys+3]) | 0;
      cpu0.gprLo_signed[t] = ((ram[phys+4] << 24) | (ram[phys+5] << 16) | (ram[phys+6] << 8) | ram[phys+7]) | 0;
    } else {
      cpu0.gprHi_signed[t] = lw_slow(addr);
      cpu0.gprLo_signed[t] = lw_slow(addr + 4);
    }
  }

  function generateLWC1(ctx) {
    var t = ctx.instr_ft();
    var b = ctx.instr_base();
    var o = ctx.instr_imms();

    ctx.fragment.usesCop1 = true;

    var impl = 'cpu1.int32[' + t + '] = n64js.load_s32(ram, ' + genSrcRegLo(b) + ' + ' + o + ');\n';
    return generateMemoryAccessBoilerplate(impl, ctx);
  }

  // FIXME: needs to check Cop1Enabled - thanks Salvy!
  function executeLWC1(i) {
    var t = ft(i);
    var b = base(i);
    var o = imms(i);

    cpu1.int32[t] = n64js.load_s32(cpu0.ram, cpu0.gprLo_signed[b] + o);
  }

  function generateLDC1(ctx){
    var t = ctx.instr_ft();
    var b = ctx.instr_base();
    var o = ctx.instr_imms();

    ctx.fragment.usesCop1 = true;

    var impl = '';
    impl += 'var value_lo;\n';
    impl += 'var value_hi;\n';
    impl += 'var addr = ' + genSrcRegLo(b) + ' + ' + o + ';\n';
    impl += 'if (addr < -2139095040) {\n';
    impl += '  var phys = (addr + 0x80000000) | 0;\n';
    impl += '  value_hi = ((ram[phys  ] << 24) | (ram[phys+1] << 16) | (ram[phys+2] << 8) | ram[phys+3]) | 0;\n'; // FIXME: |0 needed?
    impl += '  value_lo = ((ram[phys+4] << 24) | (ram[phys+5] << 16) | (ram[phys+6] << 8) | ram[phys+7]) | 0;\n';
    impl += '} else {\n';
    impl += '  value_hi = lw_slow(addr);\n';
    impl += '  value_lo = lw_slow(addr + 4);\n';
    impl += '}\n';
    impl += 'cpu1.store_64(' + t + ', value_lo, value_hi);\n';

    return generateMemoryAccessBoilerplate(impl, ctx);
  }

  // FIXME: needs to check Cop1Enabled - thanks Salvy!
  function executeLDC1(i) {
    var t = ft(i);
    var b = base(i);
    var o = imms(i);

    var addr = cpu0.gprLo_signed[b] + o;
    var value_lo;
    var value_hi;
    if (addr < -2139095040) {
      var phys = (addr + 0x80000000) | 0;  // NB: or with zero ensures we return an SMI if possible.
      var ram = cpu0.ram;
      value_hi = ((ram[phys  ] << 24) | (ram[phys+1] << 16) | (ram[phys+2] << 8) | ram[phys+3]) | 0;
      value_lo = ((ram[phys+4] << 24) | (ram[phys+5] << 16) | (ram[phys+6] << 8) | ram[phys+7]) | 0;
    } else {
      value_hi = lw_slow(addr);
      value_lo = lw_slow(addr + 4);
    }

    cpu1.store_64( t, value_lo, value_hi );
  }

  function executeLDC2(i)       { unimplemented(cpu0.pc,i); }

  function executeLWL(i) {
    var address         = memaddr(i)>>>0;
    var address_aligned = (address & ~3)>>>0;
    var memory          = n64js.readMemoryU32(address_aligned);
    var reg             = cpu0.gprLo[rt(i)];

    var value;
    switch(address % 4) {
      case 0:       value = memory;                              break;
      case 1:       value = (reg & 0x000000ff) | (memory <<  8); break;
      case 2:       value = (reg & 0x0000ffff) | (memory << 16); break;
      default:      value = (reg & 0x00ffffff) | (memory << 24); break;
    }

    setSignExtend( rt(i), value );
  }
  function executeLWR(i) {
    var address         = memaddr(i)>>>0;
    var address_aligned = (address & ~3)>>>0;
    var memory          = n64js.readMemoryU32(address_aligned);
    var reg             = cpu0.gprLo[rt(i)];

    var value;
    switch(address % 4) {
      case 0:       value = (reg & 0xffffff00) | (memory >>> 24); break;
      case 1:       value = (reg & 0xffff0000) | (memory >>> 16); break;
      case 2:       value = (reg & 0xff000000) | (memory >>>  8); break;
      default:      value = memory;                               break;
    }

    setSignExtend( rt(i), value );
  }
  function executeLDL(i)        { unimplemented(cpu0.pc,i); }
  function executeLDR(i)        { unimplemented(cpu0.pc,i); }




  function generateSB(ctx) {
    var t = ctx.instr_rt();
    var b = ctx.instr_base();
    var o = ctx.instr_imms();

    var impl = '';
    impl += 'n64js.store_8(ram, ' + genSrcRegLo(b) + ' + ' + o + ', ' + genSrcRegLo(t) + ');\n';
    return generateMemoryAccessBoilerplate(impl, ctx);
  }
  function executeSB(i) {
    var t = rt(i);
    var b = base(i);
    var o = imms(i);

    n64js.store_8(cpu0.ram, cpu0.gprLo_signed[b] + o, cpu0.gprLo_signed[t] /*& 0xff*/);
  }

  function generateSH(ctx) {
    var t = ctx.instr_rt();
    var b = ctx.instr_base();
    var o = ctx.instr_imms();

    var impl = '';
    impl += 'n64js.store_16(ram, ' + genSrcRegLo(b) + ' + ' + o + ', ' + genSrcRegLo(t) + ');\n';
    return generateMemoryAccessBoilerplate(impl, ctx);
  }
  function executeSH(i) {
    var t = rt(i);
    var b = base(i);
    var o = imms(i);

    n64js.store_16(cpu0.ram, cpu0.gprLo_signed[b] + o, cpu0.gprLo_signed[t] /*& 0xffff*/);
  }

  function generateSW(ctx) {
    var t = ctx.instr_rt();
    var b = ctx.instr_base();
    var o = ctx.instr_imms();

    var impl = '';
    impl += 'n64js.store_32(ram, ' + genSrcRegLo(b) + ' + ' + o + ', ' + genSrcRegLo(t) + ');\n';
    return generateMemoryAccessBoilerplate(impl, ctx);
  }
  function executeSW(i) {
    var t = rt(i);
    var b = base(i);
    var o = imms(i);

    n64js.store_32(cpu0.ram, cpu0.gprLo_signed[b] + o, cpu0.gprLo_signed[t]);
  }


  function generateSD(ctx) {
    var t = ctx.instr_rt();
    var b = ctx.instr_base();
    var o = ctx.instr_imms();

    var impl = '';
    impl += 'var addr = ' + genSrcRegLo(b) + ' + ' + o + ';\n';
    impl += 'n64js.store_64(ram, addr,     ' + genSrcRegLo(t) + ',' + genSrcRegHi(t) + ');\n';

    return generateMemoryAccessBoilerplate(impl, ctx);
  }
  function executeSD(i) {
    var t = rt(i);
    var b = base(i);
    var o = imms(i);

    var addr = cpu0.gprLo_signed[b] + o;
    n64js.store_64(cpu0.ram, addr, cpu0.gprLo_signed[t], cpu0.gprHi_signed[t]);
  }


  function generateSWC1(ctx) {
    var t = ctx.instr_ft();
    var b = ctx.instr_base();
    var o = ctx.instr_imms();

    ctx.fragment.usesCop1 = true;

    // FIXME: can avoid cpuStuffToDo if we're writing to ram
    var impl = '';
    impl += 'n64js.store_32(ram, ' + genSrcRegLo(b) + ' + ' + o + ', cpu1.int32[' + t + ']);\n';
    return generateMemoryAccessBoilerplate(impl, ctx);
  }

  // FIXME: needs to check Cop1Enabled - thanks Salvy!
  function executeSWC1(i) {
    var t = ft(i);
    var b = base(i);
    var o = imms(i);

    n64js.store_32(cpu0.ram, cpu0.gprLo_signed[b] + o, cpu1.int32[t]);
  }


  function generateSDC1(ctx) {
    var t = ctx.instr_ft();
    var b = ctx.instr_base();
    var o = ctx.instr_imms();

    var hi = t+1;

    ctx.fragment.usesCop1 = true;

    // FIXME: can avoid cpuStuffToDo if we're writing to ram
    var impl = '';
    impl += 'var addr = ' + genSrcRegLo(b) + ' + ' + o + ';\n';
    impl += 'n64js.store_64(ram, addr, cpu1.int32[' + t + '], cpu1.int32[' + hi + ']);\n';
    return generateMemoryAccessBoilerplate(impl, ctx);
  }

  // FIXME: needs to check Cop1Enabled - thanks Salvy!
  function executeSDC1(i) {
    var t = ft(i);
    var b = base(i);
    var o = imms(i);

    // FIXME: this can do a single check that the address is in ram
    var addr = cpu0.gprLo_signed[b] + o;
    n64js.store_64(cpu0.ram, addr, cpu1.int32[t], cpu1.int32[t+1]);
  }

  function executeSDC2(i)       { unimplemented(cpu0.pc,i); }

  function executeSWL(i) {
    var address         = memaddr(i);
    var address_aligned = (address & ~3)>>>0;
    var memory          = n64js.readMemoryU32(address_aligned);
    var reg             = cpu0.gprLo[rt(i)];

    var value;
    switch(address % 4) {
      case 0:       value = reg;                                  break;
      case 1:       value = (memory & 0xff000000) | (reg >>>  8); break;
      case 2:       value = (memory & 0xffff0000) | (reg >>> 16); break;
      default:      value = (memory & 0xffffff00) | (reg >>> 24); break;
    }

    n64js.writeMemory32( address_aligned, value );
  }
  function executeSWR(i) {
    var address         = memaddr(i);
    var address_aligned = (address & ~3)>>>0;
    var memory          = n64js.readMemoryU32(address_aligned);
    var reg             = cpu0.gprLo[rt(i)];

    var value;
    switch(address % 4) {
      case 0:       value = (memory & 0x00ffffff) | (reg << 24); break;
      case 1:       value = (memory & 0x0000ffff) | (reg << 16); break;
      case 2:       value = (memory & 0x000000ff) | (reg <<  8); break;
      default:      value = reg;                                 break;
    }

    n64js.writeMemory32( address_aligned, value );
  }

  function executeSDL(i)        { unimplemented(cpu0.pc,i); }
  function executeSDR(i)        { unimplemented(cpu0.pc,i); }

  function generateCACHE(ctx) {
    var b        = ctx.instr_base();
    var o        = ctx.instr_imms();
    var cache_op = ctx.instr_rt();
    var cache    = (cache_op      ) & 0x3;
    var action   = (cache_op >>> 2) & 0x7;

    if(cache === 0 && (action === 0 || action === 4)) {
      var impl = '';
      impl += 'var addr = ' + genSrcRegLo(b) + ' + ' + o + ';\n';
      impl += "n64js.invalidateICacheEntry(addr);\n";
      return generateTrivialOpBoilerplate(impl, ctx);
    } else {
      return generateNOPBoilerplate('/*ignored CACHE*/', ctx);
    }
  }
  function executeCACHE(i) {
    var cache_op = rt(i);
    var cache    = (cache_op      ) & 0x3;
    var action   = (cache_op >>> 2) & 0x7;

    if(cache === 0 && (action === 0 || action === 4)) {
      // NB: only bother generating address if we handle the instruction - memaddr deopts like crazy
      var address  = memaddr(i);
      n64js.invalidateICacheEntry(address);
    }
  }

  function executeLL(i)         { unimplemented(cpu0.pc,i); }
  function executeLLD(i)        { unimplemented(cpu0.pc,i); }
  function executeSC(i)         { unimplemented(cpu0.pc,i); }
  function executeSCD(i)        { unimplemented(cpu0.pc,i); }

  function generateMFC1Stub(ctx) {
    var t = ctx.instr_rt();
    var s = ctx.instr_fs();

    ctx.fragment.usesCop1 = true;
    ctx.isTrivial         = true;

    var impl = '';
    impl += 'var result = cpu1.int32[' + s + '];\n';
    impl += 'rlo[' + t + '] = result;\n';
    impl += 'rhi[' + t + '] = result >> 31;\n';
    return impl;
  }
  function executeMFC1(i) {
    var t = rt(i);
    var s = fs(i);
    var result = cpu1.int32[s];
    cpu0.gprLo_signed[t] = result;
    cpu0.gprHi_signed[t] = result >> 31;
  }

  function generateDMFC1Stub(ctx) {
    var t = ctx.instr_rt();
    var s = ctx.instr_fs();
    var hi = s+1;

    ctx.fragment.usesCop1 = true;
    ctx.isTrivial         = true;

    var impl = '';
    impl += 'rlo[' + t + '] = cpu1.int32[' + s  + '];\n';
    impl += 'rhi[' + t + '] = cpu1.int32[' + hi + '];\n';
    return impl;
  }
  function executeDMFC1(i) {
    var t = rt(i);
    var s = fs(i);
    cpu0.gprLo_signed[t] = cpu1.int32[s];
    cpu0.gprHi_signed[t] = cpu1.int32[s+1];
  }


  function generateMTC1Stub(ctx) {
    var s = ctx.instr_fs();
    var t = ctx.instr_rt();

    ctx.fragment.usesCop1 = true;
    ctx.isTrivial         = true;

    return 'cpu1.int32[' + s + '] = rlo[' + t + '];\n';
  }
  function executeMTC1(i) {
    cpu1.int32[fs(i)] = cpu0.gprLo_signed[rt(i)];
  }

  function generateDMTC1Stub(ctx) {
    var s = ctx.instr_fs();
    var t = ctx.instr_rt();
    var hi = s+1;

    ctx.fragment.usesCop1 = true;
    ctx.isTrivial         = true;

    var impl = '';
    impl += 'cpu1.int32[' + s  + '] = rlo[' + t + '];\n';
    impl += 'cpu1.int32[' + hi + '] = rhi[' + t + '];\n';
    return impl;
  }
  function executeDMTC1(i) {
    var s = fs(i);
    var t = rt(i);

    cpu1.int32[s+0] = cpu0.gprLo_signed[t];
    cpu1.int32[s+1] = cpu0.gprHi_signed[t];
  }

  function generateCFC1Stub(ctx) {
    var s = ctx.instr_fs();
    var t = ctx.instr_rt();

    ctx.fragment.usesCop1 = true;
    ctx.isTrivial         = true;

    var impl = '';

    switch(s) {
      case 0:
      case 31:
        impl += 'var value = cpu1.control[' + s + '];\n';
        impl += 'rlo[' + t + '] = value;\n';
        impl += 'rhi[' + t + '] = value >> 31;\n';
        return impl;
    }

    return '/*CFC1 invalid reg*/\n';
  }

  function executeCFC1(i) {
    var s = fs(i);
    var t = rt(i);

    switch(s) {
      case 0:
      case 31:
        var value = cpu1.control[s];
        cpu0.gprLo_signed[t] = value;
        cpu0.gprHi_signed[t] = value >> 31;
        break;
    }
  }

  function generateCTC1Stub(ctx) {
    var s = ctx.instr_fs();
    var t = ctx.instr_rt();

    ctx.fragment.usesCop1 = true;
    ctx.isTrivial         = true;

    if (s === 31) {
      return 'cpu1.control[' + s + '] = rlo[' + t + '];\n';
    }

    return '/*CTC1 invalid reg*/\n';
  }

  function executeCTC1(i) {
    var s = fs(i);
    var t = rt(i);

    if (s === 31) {
      var v = cpu0.gprLo[t];

      // switch (v & FPCSR_RM_MASK) {
      // case FPCSR_RM_RN:     n64js.log('cop1 - setting round near');  break;
      // case FPCSR_RM_RZ:     n64js.log('cop1 - setting round zero');  break;
      // case FPCSR_RM_RP:     n64js.log('cop1 - setting round ceil');  break;
      // case FPCSR_RM_RM:     n64js.log('cop1 - setting round floor'); break;
      // }

      cpu1.control[s] = v;
    }
  }

  function generateBCInstrStub(ctx) {
    var i = ctx.instruction;
    n64js.assert( ((i>>>18)&0x7) === 0, "cc bit is not 0" );

    var condition = (i&0x10000) !== 0;
    var likely    = (i&0x20000) !== 0;
    var target    = branchAddress(ctx.pc, i);

    ctx.fragment.usesCop1 = true;
    ctx.isTrivial         = false; // NB: not trivial - branches!

    var impl = '';
    var test = condition ? '!==' : '===';
    impl += 'if ((cpu1.control[31] & FPCSR_C) ' + test + ' 0) {\n';
    impl += '  c.branchTarget = ' + n64js.toString32(target) + ';\n';
    if (likely) {
      impl += '} else {\n';
      impl += '  c.nextPC += 4;\n';
    }
    impl += '}\n';

    return impl;
  }

  function executeBCInstr(i) {
    n64js.assert( ((i>>>18)&0x7) === 0, "cc bit is not 0" );

    var condition = (i&0x10000) !== 0;
    var likely    = (i&0x20000) !== 0;
    var cc        = (cpu1.control[31] & FPCSR_C) !== 0;

    if (cc === condition) {
      performBranch( branchAddress(cpu0.pc, i) );
    } else {
      if (likely) {
        cpu0.nextPC += 4;   // skip the next instruction
      }
    }
  }

  n64js.trunc = function (x) {
    if (x < 0)
      return Math.ceil(x);
    else
      return Math.floor(x);
  };

  n64js.convert = function (x) {
    switch(cpu1.control[31] & FPCSR_RM_MASK) {
      case FPCSR_RM_RN:     return  Math.round(x);
      case FPCSR_RM_RZ:     return n64js.trunc(x);
      case FPCSR_RM_RP:     return  Math.ceil(x);
      case FPCSR_RM_RM:     return  Math.floor(x);
    }

    n64js.assert('unknown rounding mode');
  };

  function generateFloatCompare(op) {
    var impl = '';
    impl += 'var cc = false;\n';
    impl += 'if (isNaN(fs+ft)) {\n';
    if (op&0x8) {
      impl += '  n64js.halt("should raise Invalid Operation here.");\n';
    }
    if (op&0x1) {
      impl += '  cc = true;\n';
    }
    impl += '} else {\n';
    if (op&0x4) {
      impl += '  cc |= fs < ft;\n';
    }
    if (op&0x2) {
      impl += '  cc |= fs == ft;\n';
    }
    impl += '}\n';
    impl += 'if (cc) { cpu1.control[31] |= FPCSR_C; } else { cpu1.control[31] &= ~FPCSR_C; }\n';
    return impl;
  }

  function handleFloatCompare(op, fs, ft) {
      var c = false;
      if (isNaN(fs+ft)) {
        if (op&0x8) {
          n64js.halt('Should raise Invalid Operation here.');
        }
        if (op&0x1) c = true;
      } else {
        if (op&0x4) c |= fs <  ft;
        if (op&0x2) c |= fs == ft;
        // unordered is false here
      }
      cpu1.setCondition(c);
  }

  function generateSInstrStub(ctx) {

    var s = ctx.instr_fs();
    var t = ctx.instr_ft();
    var d = ctx.instr_fd();

    ctx.fragment.usesCop1 = true;
    ctx.isTrivial         = true;

    var op = cop1_func(ctx.instruction);

    if (op < 0x30) {
      switch(op) {
        case 0x00:    return 'cpu1.float32[' + d + '] = cpu1.float32[' + s + '] + cpu1.float32[' + t + '];\n';
        case 0x01:    return 'cpu1.float32[' + d + '] = cpu1.float32[' + s + '] - cpu1.float32[' + t + '];\n';
        case 0x02:    return 'cpu1.float32[' + d + '] = cpu1.float32[' + s + '] * cpu1.float32[' + t + '];\n';
        case 0x03:    return 'cpu1.float32[' + d + '] = cpu1.float32[' + s + '] / cpu1.float32[' + t + '];\n';
        case 0x04:    return 'cpu1.float32[' + d + '] = Math.sqrt( cpu1.float32[' + s + '] );\n';
        case 0x05:    return 'cpu1.float32[' + d + '] = Math.abs(  cpu1.float32[' + s + '] );\n';
        case 0x06:    return 'cpu1.float32[' + d + '] =  cpu1.float32[' + s + '];\n';
        case 0x07:    return 'cpu1.float32[' + d + '] = -cpu1.float32[' + s + '];\n';
        case 0x08:    /* 'ROUND.L.'*/     return 'cpu1.store_float_as_long(' + d + ',  Math.round( cpu1.float32[' + s + ']));\n';
        case 0x09:    /* 'TRUNC.L.'*/     return 'cpu1.store_float_as_long(' + d + ', n64js.trunc( cpu1.float32[' + s + ']));\n';
        case 0x0a:    /* 'CEIL.L.'*/      return 'cpu1.store_float_as_long(' + d + ',  Math.ceil(  cpu1.float32[' + s + ']));\n';
        case 0x0b:    /* 'FLOOR.L.'*/     return 'cpu1.store_float_as_long(' + d + ',  Math.floor( cpu1.float32[' + s + ']));\n';
        case 0x0c:    /* 'ROUND.W.'*/     return 'cpu1.int32[' + d + '] =  Math.round( cpu1.float32[' + s + '] );\n';  // TODO: check this
        case 0x0d:    /* 'TRUNC.W.'*/     return 'cpu1.int32[' + d + '] = n64js.trunc( cpu1.float32[' + s + '] );\n';
        case 0x0e:    /* 'CEIL.W.'*/      return 'cpu1.int32[' + d + '] =  Math.ceil(  cpu1.float32[' + s + '] );\n';
        case 0x0f:    /* 'FLOOR.W.'*/     return 'cpu1.int32[' + d + '] =  Math.floor( cpu1.float32[' + s + '] );\n';
        case 0x20:    /* 'CVT.S' */       break;
        case 0x21:    /* 'CVT.D' */       return 'cpu1.store_f64( ' + d + ', cpu1.float32[' + s + '] );\n';
        case 0x24:    /* 'CVT.W' */       return 'cpu1.int32[' + d + '] = n64js.convert( cpu1.float32[' + s + '] );\n';
        case 0x25:    /* 'CVT.L' */       break;
      }

      return 'unimplemented(' + n64js.toString32(ctx.pc) + ',' + n64js.toString32(ctx.instruction) + ');\n';
    }

    // It's a compare instruction
    var impl = '';
    impl += 'var fs = cpu1.float32[' + s + '];\n';
    impl += 'var ft = cpu1.float32[' + t + '];\n';
    impl += generateFloatCompare(op);
    return impl;
  }

  function executeSInstr(i) {

    var s = fs(i);
    var t = ft(i);
    var d = fd(i);

    var op = cop1_func(i);

    if (op < 0x30) {
      switch(op) {
        case 0x00:    cpu1.float32[d] = cpu1.float32[s] + cpu1.float32[t]; return;
        case 0x01:    cpu1.float32[d] = cpu1.float32[s] - cpu1.float32[t]; return;
        case 0x02:    cpu1.float32[d] = cpu1.float32[s] * cpu1.float32[t]; return;
        case 0x03:    cpu1.float32[d] = cpu1.float32[s] / cpu1.float32[t]; return;
        case 0x04:    cpu1.float32[d] = Math.sqrt( cpu1.float32[s] ); return;
        case 0x05:    cpu1.float32[d] = Math.abs(  cpu1.float32[s] ); return;
        case 0x06:    cpu1.float32[d] =  cpu1.float32[s]; return;
        case 0x07:    cpu1.float32[d] = -cpu1.float32[s]; return;
        case 0x08:    /* 'ROUND.L.'*/     cpu1.store_float_as_long(d,  Math.round( cpu1.float32[s] )); return;
        case 0x09:    /* 'TRUNC.L.'*/     cpu1.store_float_as_long(d, n64js.trunc( cpu1.float32[s] )); return;
        case 0x0a:    /* 'CEIL.L.'*/      cpu1.store_float_as_long(d,  Math.ceil(  cpu1.float32[s] )); return;
        case 0x0b:    /* 'FLOOR.L.'*/     cpu1.store_float_as_long(d,  Math.floor( cpu1.float32[s] )); return;
        case 0x0c:    /* 'ROUND.W.'*/     cpu1.int32[d] =  Math.round( cpu1.float32[s] )|0; return;  // TODO: check this
        case 0x0d:    /* 'TRUNC.W.'*/     cpu1.int32[d] = n64js.trunc( cpu1.float32[s] )|0; return;
        case 0x0e:    /* 'CEIL.W.'*/      cpu1.int32[d] =  Math.ceil(  cpu1.float32[s] )|0; return;
        case 0x0f:    /* 'FLOOR.W.'*/     cpu1.int32[d] =  Math.floor( cpu1.float32[s] )|0; return;

        case 0x20:    /* 'CVT.S' */       unimplemented(cpu0.pc,i); return;
        case 0x21:    /* 'CVT.D' */       cpu1.store_f64( d, cpu1.float32[s] ); return;
        case 0x24:    /* 'CVT.W' */       cpu1.int32[d] = n64js.convert( cpu1.float32[s] )|0; return;
        case 0x25:    /* 'CVT.L' */       unimplemented(cpu0.pc,i); return;
      }
      unimplemented(cpu0.pc,i);
    } else {
      var _s = cpu1.float32[s];
      var _t = cpu1.float32[t];
      handleFloatCompare(op, _s, _t);
    }
  }

  function generateDInstrStub(ctx) {

    var s = ctx.instr_fs();
    var t = ctx.instr_ft();
    var d = ctx.instr_fd();

    ctx.fragment.usesCop1 = true;
    ctx.isTrivial         = true;

    var op = cop1_func(ctx.instruction);

    if (op < 0x30) {
      switch(op) {
        case 0x00:    return 'cpu1.store_f64( ' + d + ', cpu1.load_f64( ' + s + ' ) + cpu1.load_f64( ' + t + ' ) );\n';
        case 0x01:    return 'cpu1.store_f64( ' + d + ', cpu1.load_f64( ' + s + ' ) - cpu1.load_f64( ' + t + ' ) );\n';
        case 0x02:    return 'cpu1.store_f64( ' + d + ', cpu1.load_f64( ' + s + ' ) * cpu1.load_f64( ' + t + ' ) );\n';
        case 0x03:    return 'cpu1.store_f64( ' + d + ', cpu1.load_f64( ' + s + ' ) / cpu1.load_f64( ' + t + ' ) );\n';
        case 0x04:    return 'cpu1.store_f64( ' + d + ', Math.sqrt( cpu1.load_f64( ' + s + ' ) ) );\n';
        case 0x05:    return 'cpu1.store_f64( ' + d + ', Math.abs(  cpu1.load_f64( ' + s + ' ) ) );\n';
        case 0x06:    return 'cpu1.store_f64( ' + d + ',  cpu1.load_f64( ' + s + ' ) );\n';
        case 0x07:    return 'cpu1.store_f64( ' + d + ', -cpu1.load_f64( ' + s + ' )  );\n';
        case 0x08:    /* 'ROUND.L.'*/     return 'cpu1.store_float_as_long(' + d + ',  Math.round( cpu1.load_f64( ' + s + ' )));\n';
        case 0x09:    /* 'TRUNC.L.'*/     return 'cpu1.store_float_as_long(' + d + ', n64js.trunc( cpu1.load_f64( ' + s + ' )));\n';
        case 0x0a:    /* 'CEIL.L.'*/      return 'cpu1.store_float_as_long(' + d + ',  Math.ceil(  cpu1.load_f64( ' + s + ' )));\n';
        case 0x0b:    /* 'FLOOR.L.'*/     return 'cpu1.store_float_as_long(' + d + ',  Math.floor( cpu1.load_f64( ' + s + ' )));\n';
        case 0x0c:    /* 'ROUND.W.'*/     return 'cpu1.int32[' + d + '] =  Math.round( cpu1.load_f64( ' + s + ' ) ) | 0;\n';  // TODO: check this
        case 0x0d:    /* 'TRUNC.W.'*/     return 'cpu1.int32[' + d + '] = n64js.trunc( cpu1.load_f64( ' + s + ' ) ) | 0;\n';
        case 0x0e:    /* 'CEIL.W.'*/      return 'cpu1.int32[' + d + '] =  Math.ceil(  cpu1.load_f64( ' + s + ' ) ) | 0;\n';
        case 0x0f:    /* 'FLOOR.W.'*/     return 'cpu1.int32[' + d + '] =  Math.floor( cpu1.load_f64( ' + s + ' ) ) | 0;\n';
        case 0x20:    /* 'CVT.S' */       return 'cpu1.float32[' + d + '] = cpu1.load_f64( ' + s + ' );\n';
        case 0x21:    /* 'CVT.D' */       break;
        case 0x24:    /* 'CVT.W' */       return 'cpu1.int32[' + d + '] = n64js.convert( cpu1.load_f64( ' + s + ' ) ) | 0;\n';
        case 0x25:    /* 'CVT.L' */       break;
      }
      return 'unimplemented(' + n64js.toString32(ctx.pc) + ',' + n64js.toString32(ctx.instruction) + ');\n';
    }

    // It's a compare instruction
    var impl = '';
    impl += 'var fs = cpu1.load_f64(' + s + ');\n';
    impl += 'var ft = cpu1.load_f64(' + t + ');\n';
    impl += generateFloatCompare(op);
    return impl;
  }

  function executeDInstr(i) {

    var s = fs(i);
    var t = ft(i);
    var d = fd(i);

    var op = cop1_func(i);

    if (op < 0x30) {
      switch(op) {
        case 0x00:    cpu1.store_f64( d, cpu1.load_f64( s ) + cpu1.load_f64( t ) ); return;
        case 0x01:    cpu1.store_f64( d, cpu1.load_f64( s ) - cpu1.load_f64( t ) ); return;
        case 0x02:    cpu1.store_f64( d, cpu1.load_f64( s ) * cpu1.load_f64( t ) ); return;
        case 0x03:    cpu1.store_f64( d, cpu1.load_f64( s ) / cpu1.load_f64( t ) ); return;
        case 0x04:    cpu1.store_f64( d, Math.sqrt( cpu1.load_f64( s ) ) ); return;
        case 0x05:    cpu1.store_f64( d, Math.abs(  cpu1.load_f64( s ) ) ); return;
        case 0x06:    cpu1.store_f64( d,  cpu1.load_f64( s ) ); return;
        case 0x07:    cpu1.store_f64( d, -cpu1.load_f64( s )  ); return;
        case 0x08:    /* 'ROUND.L.'*/     cpu1.store_float_as_long(d,  Math.round( cpu1.load_f64( s ) )); return;
        case 0x09:    /* 'TRUNC.L.'*/     cpu1.store_float_as_long(d, n64js.trunc( cpu1.load_f64( s ) )); return;
        case 0x0a:    /* 'CEIL.L.'*/      cpu1.store_float_as_long(d,  Math.ceil(  cpu1.load_f64( s ) )); return;
        case 0x0b:    /* 'FLOOR.L.'*/     cpu1.store_float_as_long(d,  Math.floor( cpu1.load_f64( s ) )); return;
        case 0x0c:    /* 'ROUND.W.'*/     cpu1.int32[d] =  Math.round( cpu1.load_f64( s ) ) | 0; return;  // TODO: check this
        case 0x0d:    /* 'TRUNC.W.'*/     cpu1.int32[d] = n64js.trunc( cpu1.load_f64( s ) ) | 0; return;
        case 0x0e:    /* 'CEIL.W.'*/      cpu1.int32[d] =  Math.ceil(  cpu1.load_f64( s ) ) | 0; return;
        case 0x0f:    /* 'FLOOR.W.'*/     cpu1.int32[d] =  Math.floor( cpu1.load_f64( s ) ) | 0; return;

        case 0x20:    /* 'CVT.S' */       cpu1.float32[d] = cpu1.load_f64( s ); return;
        case 0x21:    /* 'CVT.D' */       unimplemented(cpu0.pc,i); return;
        case 0x24:    /* 'CVT.W' */       cpu1.int32[d] = n64js.convert( cpu1.load_f64( s ) ) | 0; return;
        case 0x25:    /* 'CVT.L' */       unimplemented(cpu0.pc,i); return;
      }
      unimplemented(cpu0.pc,i);
    } else {
      var _s = cpu1.load_f64( s );
      var _t = cpu1.load_f64( t );
      handleFloatCompare(op, _s, _t);
    }
  }

  function generateWInstrStub(ctx) {
    var s = ctx.instr_fs();
    var d = ctx.instr_fd();

    ctx.fragment.usesCop1 = true;
    ctx.isTrivial         = true;
    switch(cop1_func(ctx.instruction)) {
      case 0x20:    /* 'CVT.S' */       return 'cpu1.float32[' + d + '] = cpu1.int32[' + s + '];\n';
      case 0x21:    /* 'CVT.D' */       return 'cpu1.store_f64(' + d + ', cpu1.int32[' + s + ']);\n';
    }
    return 'unimplemented(' + n64js.toString32(ctx.pc) + ',' + n64js.toString32(ctx.instruction) + ');\n';
  }
  function executeWInstr(i) {
    var s = fs(i);
    var d = fd(i);

    switch(cop1_func(i)) {
      case 0x20:    cpu1.float32[d] = cpu1.int32[s];  return;
      case 0x21:    cpu1.store_f64(d, cpu1.int32[s]); return;
    }
    unimplemented(cpu0.pc,i);
  }


  function generateLInstrStub(ctx) {
    var s = ctx.instr_fs();
    var d = ctx.instr_fd();

    ctx.fragment.usesCop1 = true;
    ctx.isTrivial         = true;
    switch(cop1_func(ctx.instruction)) {
      case 0x20:    /* 'CVT.S' */       return 'cpu1.float32[' + d + '] = cpu1.load_s64_as_double(' + s + ');\n';
      case 0x21:    /* 'CVT.D' */       return 'cpu1.store_f64(' + d + ', cpu1.load_s64_as_double(' + s + ') );\n';
    }
    return 'unimplemented(' + n64js.toString32(ctx.pc) + ',' + n64js.toString32(ctx.instruction) + ');\n';
  }
  function executeLInstr(i) {
    var s = fs(i);
    var d = fd(i);

    switch(cop1_func(i)) {
      case 0x20:    /* 'CVT.S' */ cpu1.float32[d] = cpu1.load_s64_as_double(s); return;
      case 0x21:    /* 'CVT.D' */ cpu1.store_f64(d, cpu1.load_s64_as_double(s)); return;
    }
    unimplemented(cpu0.pc,i);
  }

  var specialTable = [
    executeSLL,           executeUnknown,       executeSRL,         executeSRA,
    executeSLLV,          executeUnknown,       executeSRLV,        executeSRAV,
    executeJR,            executeJALR,          executeUnknown,     executeUnknown,
    executeSYSCALL,       executeBREAK,         executeUnknown,     executeSYNC,
    executeMFHI,          executeMTHI,          executeMFLO,        executeMTLO,
    executeDSLLV,         executeUnknown,       executeDSRLV,       executeDSRAV,
    executeMULT,          executeMULTU,         executeDIV,         executeDIVU,
    executeDMULT,         executeDMULTU,        executeDDIV,        executeDDIVU,
    executeADD,           executeADDU,          executeSUB,         executeSUBU,
    executeAND,           executeOR,            executeXOR,         executeNOR,
    executeUnknown,       executeUnknown,       executeSLT,         executeSLTU,
    executeDADD,          executeDADDU,         executeDSUB,        executeDSUBU,
    executeTGE,           executeTGEU,          executeTLT,         executeTLTU,
    executeTEQ,           executeUnknown,       executeTNE,         executeUnknown,
    executeDSLL,          executeUnknown,       executeDSRL,        executeDSRA,
    executeDSLL32,        executeUnknown,       executeDSRL32,      executeDSRA32
  ];
  if (specialTable.length != 64) {
    throw "Oops, didn't build the special table correctly";
  }
  n64js.executeUnknown = executeUnknown;

  function executeSpecial(i) {
    var fn = i & 0x3f;
    specialTable[fn](i);
  }

  var cop0Table = [
    executeMFC0,          executeUnknown,       executeUnknown,     executeUnknown,
    executeMTC0,          executeUnknown,       executeUnknown,     executeUnknown,
    executeUnknown,       executeUnknown,       executeUnknown,     executeUnknown,
    executeUnknown,       executeUnknown,       executeUnknown,     executeUnknown,
    executeTLB,           executeUnknown,       executeUnknown,     executeUnknown,
    executeUnknown,       executeUnknown,       executeUnknown,     executeUnknown,
    executeUnknown,       executeUnknown,       executeUnknown,     executeUnknown,
    executeUnknown,       executeUnknown,       executeUnknown,     executeUnknown
  ];
  if (cop0Table.length != 32) {
    throw "Oops, didn't build the cop0 table correctly";
  }


  var cop0TableGen = [
    'executeMFC0',          'executeUnknown',       'executeUnknown',     'executeUnknown',
    generateMTC0,           'executeUnknown',       'executeUnknown',     'executeUnknown',
    'executeUnknown',       'executeUnknown',       'executeUnknown',     'executeUnknown',
    'executeUnknown',       'executeUnknown',       'executeUnknown',     'executeUnknown',
    'executeTLB',           'executeUnknown',       'executeUnknown',     'executeUnknown',
    'executeUnknown',       'executeUnknown',       'executeUnknown',     'executeUnknown',
    'executeUnknown',       'executeUnknown',       'executeUnknown',     'executeUnknown',
    'executeUnknown',       'executeUnknown',       'executeUnknown',     'executeUnknown'
  ];
  if (cop0TableGen.length != 32) {
    throw "Oops, didn't build the cop0 table correctly";
  }

  // Expose all the functions that we don't yet generate
  n64js.executeMFC0 = executeMFC0;
  n64js.executeMTC0 = executeMTC0;  // There's a generateMTC0, but it calls through to the interpreter
  n64js.executeTLB  = executeTLB;


  function executeCop0(i) {
    var fmt = (i >>> 21) & 0x1f;
    cop0Table[fmt](i);
  }

  var cop1Table = [
    executeMFC1,          executeDMFC1,         executeCFC1,        executeUnknown,
    executeMTC1,          executeDMTC1,         executeCTC1,        executeUnknown,
    executeBCInstr,       executeUnknown,       executeUnknown,     executeUnknown,
    executeUnknown,       executeUnknown,       executeUnknown,     executeUnknown,
    executeSInstr,        executeDInstr,        executeUnknown,     executeUnknown,
    executeWInstr,        executeLInstr,        executeUnknown,     executeUnknown,
    executeUnknown,       executeUnknown,       executeUnknown,     executeUnknown,
    executeUnknown,       executeUnknown,       executeUnknown,     executeUnknown
  ];
  if (cop1Table.length != 32) {
    throw "Oops, didn't build the cop1 table correctly";
  }

  var cop1TableGen = [
    generateMFC1Stub,       generateDMFC1Stub,      generateCFC1Stub,     'executeUnknown',
    generateMTC1Stub,       generateDMTC1Stub,      generateCTC1Stub,     'executeUnknown',
    generateBCInstrStub,    'executeUnknown',       'executeUnknown',     'executeUnknown',
    'executeUnknown',       'executeUnknown',       'executeUnknown',     'executeUnknown',
    generateSInstrStub,     generateDInstrStub,     'executeUnknown',     'executeUnknown',
    generateWInstrStub,     generateLInstrStub,     'executeUnknown',     'executeUnknown',
    'executeUnknown',       'executeUnknown',       'executeUnknown',     'executeUnknown',
    'executeUnknown',       'executeUnknown',       'executeUnknown',     'executeUnknown'
  ];
  if (cop1TableGen.length != 32) {
    throw "Oops, didn't build the cop1 gen table correctly";
  }

  function generateCop1(ctx) {
    var fmt = (ctx.instruction >>> 21) & 0x1f;
    var fn = cop1TableGen[fmt];

    var op_impl;
    if (typeof fn === 'string') {
      //n64js.log(fn);
      op_impl = 'n64js.' + fn + '(' + n64js.toString32(ctx.instruction) + ');\n';
    } else {
      op_impl = fn(ctx);
    }

    var impl = '';

    ctx.fragment.usesCop1 = true;

    if (ctx.fragment.cop1statusKnown) {
      // Assert that cop1 is enabled
      impl += ctx.genAssert('(c.control[12] & SR_CU1) !== 0', 'cop1 should be enabled');
      impl += op_impl;

    } else {
      impl += 'if( (c.control[12] & SR_CU1) === 0 ) {\n';
      impl += '  executeCop1_disabled(' + n64js.toString32(ctx.instruction) + ');\n';
      impl += '} else {\n';
      impl += '  ' + op_impl;
      impl += '}\n';

      ctx.isTrivial = false;    // Not trivial!
      ctx.fragment.cop1statusKnown = true;
      return generateGenericOpBoilerplate(impl, ctx);   // Ensure we generate full boilerplate here, even for trivial ops
    }

    if (ctx.isTrivial) {
     return generateTrivialOpBoilerplate(impl, ctx);
    }
    return generateGenericOpBoilerplate(impl, ctx);
  }

  function executeCop1(i) {
    //n64js.assert( (cpu0.control[cpu0.kControlSR] & SR_CU1) !== 0, "SR_CU1 in inconsistent state" );

    var fmt = (i >>> 21) & 0x1f;
    cop1Table[fmt](i);
  }
  function executeCop1_disabled(i) {
    n64js.log('Thread accessing cop1 for first time, throwing cop1 unusable exception');

    n64js.assert( (cpu0.control[cpu0.kControlSR] & SR_CU1) === 0, "SR_CU1 in inconsistent state" );

    cpu0.throwCop1Unusable();
  }

  function setCop1Enable(enable) {
    simpleTable[0x11] = enable ? executeCop1 : executeCop1_disabled;
  }

  var regImmTable = [
    executeBLTZ,          executeBGEZ,          executeBLTZL,       executeBGEZL,
    executeUnknown,       executeUnknown,       executeUnknown,     executeUnknown,
    executeTGEI,          executeTGEIU,         executeTLTI,        executeTLTIU,
    executeTEQI,          executeUnknown,       executeTNEI,        executeUnknown,
    executeBLTZAL,        executeBGEZAL,        executeBLTZALL,     executeBGEZALL,
    executeUnknown,       executeUnknown,       executeUnknown,     executeUnknown,
    executeUnknown,       executeUnknown,       executeUnknown,     executeUnknown,
    executeUnknown,       executeUnknown,       executeUnknown,     executeUnknown
  ];
  if (regImmTable.length != 32) {
    throw "Oops, didn't build the regimm table correctly";
  }

  function executeRegImm(i) {
    var rt = (i >>> 16) & 0x1f;
    return regImmTable[rt](i);
  }

  var simpleTable = [
    executeSpecial,       executeRegImm,        executeJ,           executeJAL,
    executeBEQ,           executeBNE,           executeBLEZ,        executeBGTZ,
    executeADDI,          executeADDIU,         executeSLTI,        executeSLTIU,
    executeANDI,          executeORI,           executeXORI,        executeLUI,
    executeCop0,          executeCop1_disabled, executeUnknown,     executeUnknown,
    executeBEQL,          executeBNEL,          executeBLEZL,       executeBGTZL,
    executeDADDI,         executeDADDIU,        executeLDL,         executeLDR,
    executeUnknown,       executeUnknown,       executeUnknown,     executeUnknown,
    executeLB,            executeLH,            executeLWL,         executeLW,
    executeLBU,           executeLHU,           executeLWR,         executeLWU,
    executeSB,            executeSH,            executeSWL,         executeSW,
    executeSDL,           executeSDR,           executeSWR,         executeCACHE,
    executeLL,            executeLWC1,          executeUnknown,     executeUnknown,
    executeLLD,           executeLDC1,          executeLDC2,        executeLD,
    executeSC,            executeSWC1,          executeBreakpoint,  executeUnknown,
    executeSCD,           executeSDC1,          executeSDC2,        executeSD
  ];
  if (simpleTable.length != 64) {
    throw "Oops, didn't build the simple table correctly";
  }

  function executeOp(i) {
    var opcode = (i >>> 26) & 0x3f;
    return simpleTable[opcode](i);
  }

  var specialTableGen = [
    generateSLL,            'executeUnknown',       generateSRL,          generateSRA,
    generateSLLV,           'executeUnknown',       generateSRLV,         generateSRAV,
    generateJR,             generateJALR,           'executeUnknown',     'executeUnknown',
    'executeSYSCALL',       'executeBREAK',         'executeUnknown',     'executeSYNC',
    generateMFHI,           generateMTHI,           generateMFLO,         generateMTLO,
    'executeDSLLV',         'executeUnknown',       'executeDSRLV',       'executeDSRAV',
    generateMULT,           generateMULTU,          'executeDIV',         'executeDIVU',
    'executeDMULT',         'executeDMULTU',        'executeDDIV',        'executeDDIVU',
    generateADD,            generateADDU,           generateSUB,          generateSUBU,
    generateAND,            generateOR,             generateXOR,          generateNOR,
    'executeUnknown',       'executeUnknown',       generateSLT,          generateSLTU,
    'executeDADD',          'executeDADDU',         'executeDSUB',        'executeDSUBU',
    'executeTGE',           'executeTGEU',          'executeTLT',         'executeTLTU',
    'executeTEQ',           'executeUnknown',       'executeTNE',         'executeUnknown',
    'executeDSLL',          'executeUnknown',       'executeDSRL',        'executeDSRA',
    'executeDSLL32',        'executeUnknown',       'executeDSRL32',      'executeDSRA32'
  ];
  if (specialTableGen.length != 64) {
    throw "Oops, didn't build the special gen table correctly";
  }

  // Expose all the functions that we don't yet generate
  n64js.executeSYSCALL = executeSYSCALL;
  n64js.executeBREAK   = executeBREAK;
  n64js.executeSYNC    = executeSYNC;
  n64js.executeDSLLV   = executeDSLLV;
  n64js.executeDSRLV   = executeDSRLV;
  n64js.executeDSRAV   = executeDSRAV;
  n64js.executeDIV     = executeDIV;
  n64js.executeDIVU    = executeDIVU;
  n64js.executeDMULT   = executeDMULT;
  n64js.executeDMULTU  = executeDMULTU;
  n64js.executeDDIV    = executeDDIV;
  n64js.executeDDIVU   = executeDDIVU;
  n64js.executeDADD    = executeDADD;
  n64js.executeDADDU   = executeDADDU;
  n64js.executeDSUB    = executeDSUB;
  n64js.executeDSUBU   = executeDSUBU;
  n64js.executeTGE     = executeTGE;
  n64js.executeTGEU    = executeTGEU;
  n64js.executeTLT     = executeTLT;
  n64js.executeTLTU    = executeTLTU;
  n64js.executeTEQ     = executeTEQ;
  n64js.executeTNE     = executeTNE;
  n64js.executeDSLL    = executeDSLL;
  n64js.executeDSRL    = executeDSRL;
  n64js.executeDSRA    = executeDSRA;
  n64js.executeDSLL32  = executeDSLL32;
  n64js.executeDSRL32  = executeDSRL32;
  n64js.executeDSRA32  = executeDSRA32;

  var regImmTableGen = [
    generateBLTZ,           generateBGEZ,           generateBLTZL,        generateBGEZL,
    'executeUnknown',       'executeUnknown',       'executeUnknown',     'executeUnknown',
    'executeTGEI',          'executeTGEIU',         'executeTLTI',        'executeTLTIU',
    'executeTEQI',          'executeUnknown',       'executeTNEI',        'executeUnknown',
    'executeBLTZAL',        'executeBGEZAL',        'executeBLTZALL',     'executeBGEZALL',
    'executeUnknown',       'executeUnknown',       'executeUnknown',     'executeUnknown',
    'executeUnknown',       'executeUnknown',       'executeUnknown',     'executeUnknown',
    'executeUnknown',       'executeUnknown',       'executeUnknown',     'executeUnknown'
  ];
  if (regImmTableGen.length != 32) {
    throw "Oops, didn't build the regimm gen table correctly";
  }

  // Expose all the functions that we don't yet generate
  n64js.executeTGEI    = executeTGEI;
  n64js.executeTGEIU   = executeTGEIU;
  n64js.executeTLTI    = executeTLTI;
  n64js.executeTLTIU   = executeTLTIU;
  n64js.executeTEQI    = executeTEQI;
  n64js.executeTNEI    = executeTNEI;
  n64js.executeBLTZAL  = executeBLTZAL;
  n64js.executeBGEZAL  = executeBGEZAL;
  n64js.executeBLTZALL = executeBLTZALL;
  n64js.executeBGEZALL = executeBGEZALL;

  var simpleTableGen = [
    generateSpecial,        generateRegImm,         generateJ,            generateJAL,
    generateBEQ,            generateBNE,            generateBLEZ,         generateBGTZ,
    generateADDI,           generateADDIU,          generateSLTI,         generateSLTIU,
    generateANDI,           generateORI,            generateXORI,         generateLUI,
    generateCop0,           generateCop1,           'executeUnknown',     'executeUnknown',
    generateBEQL,           generateBNEL,           'executeBLEZL',       'executeBGTZL',
    'executeDADDI',         'executeDADDIU',        'executeLDL',         'executeLDR',
    'executeUnknown',       'executeUnknown',       'executeUnknown',     'executeUnknown',
    generateLB,             generateLH,             'executeLWL',         generateLW,
    generateLBU,            generateLHU,            'executeLWR',         generateLWU,
    generateSB,             generateSH,             'executeSWL',         generateSW,
    'executeSDL',           'executeSDR',           'executeSWR',         generateCACHE,
    'executeLL',            generateLWC1,           'executeUnknown',     'executeUnknown',
    'executeLLD',           generateLDC1,           'executeLDC2',        generateLD,
    'executeSC',            generateSWC1,           'executeUnknown',     'executeUnknown',
    'executeSCD',           generateSDC1,           'executeSDC2',        generateSD
  ];
  if (simpleTableGen.length != 64) {
    throw "Oops, didn't build the simple gen table correctly";
  }
  // Expose all the functions that we don't yet generate
  n64js.executeBLEZL   = executeBLEZL;
  n64js.executeBGTZL   = executeBGTZL;
  n64js.executeDADDI   = executeDADDI;
  n64js.executeDADDIU  = executeDADDIU;
  n64js.executeLDL     = executeLDL;
  n64js.executeLDR     = executeLDR;
  n64js.executeLWL     = executeLWL;
  n64js.executeLWR     = executeLWR;
  n64js.executeSWL     = executeSWL;
  n64js.executeSDL     = executeSDL;
  n64js.executeSDR     = executeSDR;
  n64js.executeSWR     = executeSWR;
  n64js.executeLL      = executeLL;
  n64js.executeLLD     = executeLLD;
  n64js.executeLDC2    = executeLDC2;
  n64js.executeSC      = executeSC;
  n64js.executeSCD     = executeSCD;
  n64js.executeSDC2    = executeSDC2;


  function FragmentContext() {
    this.fragment    = undefined;
    this.pc          = 0;
    this.instruction = 0;
    this.post_pc     = 0;
    this.bailOut     = false;       // Set this if the op does something to manipulate event timers.

    this.needsDelayCheck = true;    // Set on entry to generate handler. If set, must check for delayPC when updating the pc.
    this.isTrivial       = false;   // Set by the code generation handler if the op is considered trivial.
    this.delayedPCUpdate = 0;       // Trivial ops can try to delay setting the pc so that back-to-back trivial ops can emit them entirely.
    this.dump            = false;   // Display this op when finished.
  }

  FragmentContext.prototype.genAssert = function (test, msg) {
    if (kDebugDynarec) {
      return 'n64js.assert(' + test + ', "' + msg + '");\n';
    }
    return '';
  };

  FragmentContext.prototype.newFragment = function () {
    this.delayedPCUpdate = 0;
  };

  FragmentContext.prototype.set = function (fragment, pc, instruction, post_pc) {
    this.fragment    = fragment;
    this.pc          = pc;
    this.instruction = instruction;
    this.post_pc     = post_pc;
    this.bailOut     = false;

    this.needsDelayCheck = true;
    this.isTrivial       = false;

    this.dump        = false;

    // Persist this between ops
    //this.delayedPCUpdate = 0;
  };

  FragmentContext.prototype.instr_rs     = function () { return rs(this.instruction); };
  FragmentContext.prototype.instr_rt     = function () { return rt(this.instruction); };
  FragmentContext.prototype.instr_rd     = function () { return rd(this.instruction); };
  FragmentContext.prototype.instr_sa     = function () { return sa(this.instruction); };

  FragmentContext.prototype.instr_fs     = function () { return fs(this.instruction); };
  FragmentContext.prototype.instr_ft     = function () { return ft(this.instruction); };
  FragmentContext.prototype.instr_fd     = function () { return fd(this.instruction); };

  FragmentContext.prototype.instr_base   = function () { return base(this.instruction); };
  FragmentContext.prototype.instr_offset = function () { return offset(this.instruction); };
  FragmentContext.prototype.instr_imms   = function () { return imms(this.instruction); };



  function checkCauseIP3Consistent() {
    var mi_interrupt_set = n64js.miInterruptsUnmasked();
    var cause_int_3_set  = (cpu0.control[cpu0.kControlCause] & CAUSE_IP3) !== 0;
    n64js.assert(mi_interrupt_set === cause_int_3_set, 'CAUSE_IP3 inconsistent with MI_INTR_REG');
  }

  function mix(a,b,c)
  {
    a -= b; a -= c; a ^= (c>>>13);
    b -= c; b -= a; b ^= (a<<8);
    c -= a; c -= b; c ^= (b>>>13);
    a -= b; a -= c; a ^= (c>>>12);
    b -= c; b -= a; b ^= (a<<16);
    c -= a; c -= b; c ^= (b>>>5);
    a -= b; a -= c; a ^= (c>>>3);
    b -= c; b -= a; b ^= (a<<10);
    c -= a; c -= b; c ^= (b>>>15);

    return a;
  }

  function checkSyncState(sync, pc) {
    var i;

    if (!sync.sync32(pc, 'pc'))
      return false;

    // var next_vbl = 0;
    // for (i = 0; i < cpu0.events.length; ++i) {
    //   var event = cpu0.events[i];
    //   next_vbl += event.countdown;
    //   if (event.type === kEventVbl) {
    //     next_vbl = next_vbl*2+1;
    //     break;
    //   } else if (event.type == kEventCompare) {
    //     next_vbl = next_vbl*2;
    //     break;
    //   }
    // }

    // if (!sync.sync32(next_vbl, 'event'))
    //   return false;

    if (1) {
      var a = 0;
      for (i = 0; i < 32; ++i) {
        a = mix(a,cpu0.gprLo[i], 0);
      }
      a = a>>>0;

      if (!sync.sync32(a, 'regs'))
        return false;
    }

    // if(0) {
    //   if (!sync.sync32(cpu0.multLo[0], 'multlo'))
    //     return false;
    //   if (!sync.sync32(cpu0.multHi[0], 'multhi'))
    //     return false;
    // }

    // if(0) {
    //   if (!sync.sync32(cpu0.control[cpu0.kControlCount], 'count'))
    //     return false;
    //   if (!sync.sync32(cpu0.control[cpu0.kControlCompare], 'compare'))
    //     return false;
    // }

    return true;
  }

  function handleTLBException() {
    cpu0.pc      = cpu0.nextPC;
    cpu0.delayPC = cpu0.branchTarget;
    cpu0.control_signed[cpu0.kControlCount] += COUNTER_INCREMENT_PER_OP;

    var evt = cpu0.events[0];
    evt.countdown -= COUNTER_INCREMENT_PER_OP;
    if (evt.countdown <= 0) {
      handleCounter();
    }
  }

  function handleCounter() {

    while (cpu0.events.length > 0 && cpu0.events[0].countdown <= 0) {
      var evt = cpu0.events[0];
      cpu0.events.splice(0, 1);

      // if it's our cycles event then just bail
      if (evt.type === kEventRunForCycles) {
        cpu0.stuffToDo |= kStuffToDoBreakout;
      } else if (evt.type === kEventCompare) {
        cpu0.control[cpu0.kControlCause] |= CAUSE_IP8;
        if (cpu0.checkForUnmaskedInterrupts()) {
          cpu0.stuffToDo |= kStuffToDoCheckInterrupts;
        }
      } else if (evt.type === kEventVbl) {
        // FIXME: this should be based on VI_V_SYNC_REG
        cpu0.addEvent(kEventVbl, kVIIntrCycles);

        n64js.verticalBlank();
        cpu0.stuffToDo |= kStuffToDoBreakout;
      } else {
        n64js.halt('unhandled event!');
      }
    }
  }

  n64js.singleStep = function () {
    var restore_breakpoint_address = 0;
    if (n64js.isBreakpoint(cpu0.pc)) {
      restore_breakpoint_address = cpu0.pc;
      n64js.toggleBreakpoint(restore_breakpoint_address);
    }

    n64js.run(1);

    if (restore_breakpoint_address) {
      n64js.toggleBreakpoint(restore_breakpoint_address);
    }
  };

  n64js.run = function (cycles) {

    cpu0.stuffToDo &= ~kStuffToDoHalt;

    checkCauseIP3Consistent();
    n64js.checkSIStatusConsistent();

    cpu0.addEvent(kEventRunForCycles, cycles);

    while (cpu0.hasEvent(kEventRunForCycles)) {

      try {

        // NB: the bulk of run() is implemented as a separate function.
        // v8 won't optimise code with try/catch blocks, so structuring the code in this way allows runImpl to be optimised.
        runImpl();
        break;

      } catch (e) {

        if (e instanceof TLBException) {
          // If we hit a TLB exception we apply the nextPC (which should have been set to an exception vector) and continue looping.
          handleTLBException();
        } else if (e instanceof BreakpointException) {
          n64js.stopForBreakpoint();
        } else {
          // Other exceptions are bad news, so display an error and bail out.
          n64js.halt('Exception :' + e);
          break;
        }
      }
    }

    // Clean up any kEventRunForCycles events before we bail out
    var cycles_remaining = cpu0.removeEventsOfType(kEventRunForCycles);

    // If the event no longer exists, assume we've executed all the cycles
    if (cycles_remaining < 0) {
      cycles_remaining = 0;
    }
    if (cycles_remaining < cycles) {
      cpu0.opsExecuted += cycles - cycles_remaining;
    }
  };

  function executeFragment(fragment, c, ram, events) {
    var evt = events[0];
    if (evt.countdown >= fragment.opsCompiled*COUNTER_INCREMENT_PER_OP) {
      fragment.executionCount++;
      var ops_executed = fragment.func(c, c.gprLo_signed, c.gprHi_signed, ram);   // Absolute value is number of ops executed.

      // refresh latest event - may have changed
      evt = events[0];
      evt.countdown -= ops_executed * COUNTER_INCREMENT_PER_OP;

      if (!accurateCountUpdating) {
        c.control_signed[c.kControlCount] += ops_executed * COUNTER_INCREMENT_PER_OP;
      }

      //n64js.assert(fragment.bailedOut || evt.countdown >= 0, "Executed too many ops. Possibly didn't bail out of trace when new event was set up?");
      if (evt.countdown <= 0) {
        handleCounter();
      }

      // If stuffToDo is set, we'll break on the next loop

      var next_fragment = fragment.nextFragments[ops_executed];
      if (!next_fragment || next_fragment.entryPC !== c.pc) {
        next_fragment = fragment.getNextFragment(c.pc, ops_executed);
      }
      fragment = next_fragment;

    } else {
      // We're close to another event: drop to the interpreter
      fragment = null;
    }

    return fragment;
  }

  // We need just one of these - declare at global scope to avoid generating garbage
  var fragmentContext = new FragmentContext(); // NB: first pc is entry_pc, cpu0.pc is post_pc by this point

  function addOpToFragment(fragment, entry_pc, instruction, c) {
    if (fragment.opsCompiled === 0) {
      fragmentContext.newFragment();
    }
    fragment.opsCompiled++;
    updateFragment(fragment, entry_pc);

    fragmentContext.set(fragment, entry_pc, instruction, c.pc); // NB: first pc is entry_pc, c.pc is post_pc by this point
    generateCodeForOp(fragmentContext);

    // Break out of the trace as soon as we branch, or  too many ops, or last op generated an interrupt (stuffToDo set)
    var long_fragment = fragment.opsCompiled > 8;
    if ((long_fragment && c.pc !== entry_pc+4) || fragment.opsCompiled >= 250 || c.stuffToDo) {

      // Check if the last op has a delayed pc update, and do it now.
      if (fragmentContext.delayedPCUpdate !== 0) {
          fragment.body_code += 'c.pc = ' + n64js.toString32(fragmentContext.delayedPCUpdate) + ';\n';
          fragmentContext.delayedPCUpdate = 0;
      }

      fragment.body_code += 'return ' + fragment.opsCompiled + ';\n';    // Return the number of ops exected

      var sync = n64js.getSyncFlow();
      if (sync) {
        fragment.body_code = 'var sync = n64js.getSyncFlow();\n' + fragment.body_code;
      }

      if (fragment.usesCop1) {
        var cpu1_shizzle = '';
        cpu1_shizzle += 'var cpu1 = n64js.cpu1;\n';
        cpu1_shizzle += 'var SR_CU1 = ' + n64js.toString32(SR_CU1) + ';\n';
        cpu1_shizzle += 'var FPCSR_C = ' + n64js.toString32(FPCSR_C) + ';\n';
        fragment.body_code = cpu1_shizzle + '\n\n' + fragment.body_code;
      }

      var code = 'return function fragment_' + n64js.toString32(fragment.entryPC) + '_' + fragment.opsCompiled + '(c, rlo, rhi, ram) {\n' + fragment.body_code + '}\n';

      // Clear these strings to reduce garbage
      fragment.body_code ='';

      fragment.func = new Function(code)();
      fragment.nextFragments = [];
      for (var i = 0; i < fragment.opsCompiled; i++) {
        fragment.nextFragments.push(undefined);
      }
      fragment = lookupFragment(c.pc);
    }

    return fragment;
  }

  function runImpl() {
    //var sync = n64js.getSyncFlow();
    var c      = cpu0;
    var events = c.events;
    var ram    = c.ram;

    var fragment;
    var evt;

    while (c.hasEvent(kEventRunForCycles)) {

      fragment = lookupFragment(c.pc);
      //fragment = null;

      while (!c.stuffToDo) {

        if (fragment && fragment.func) {
          fragment = executeFragment(fragment, c, ram, events);
        } else {

          // if (sync) {
          //   if (!checkSyncState(sync, cpu0.pc)) {
          //     n64js.halt('sync error');
          //     break;
          //   }
          // }

          var pc = c.pc;   // take a copy of this, so we can refer to it later

          // NB: set nextPC before the call to readMemoryS32. If this throws an exception, we need nextPC to be set up correctly.
          if (c.delayPC) { c.nextPC = c.delayPC; } else { c.nextPC = c.pc + 4; }

          // NB: load instruction using normal memory access routines - this means that we throw a tlb miss/refill approptiately
          //var instruction = n64js.load_s32(ram, pc);
          var instruction;
          if (pc < -2139095040) {
            var phys = (pc + 0x80000000) | 0;  // NB: or with zero ensures we return an SMI if possible.
            instruction = ((ram[phys] << 24) | (ram[phys+1] << 16) | (ram[phys+2] << 8) | ram[phys+3]) | 0;
          } else {
            instruction = lw_slow(pc);
          }

          c.branchTarget = 0;
          executeOp(instruction);
          c.pc      = c.nextPC;
          c.delayPC = c.branchTarget;
          c.control_signed[c.kControlCount] += COUNTER_INCREMENT_PER_OP;
          //checkCauseIP3Consistent();
          //n64js.checkSIStatusConsistent();

          evt = events[0];
          evt.countdown -= COUNTER_INCREMENT_PER_OP;
          if (evt.countdown <= 0) {
            handleCounter();
          }

          // If we have a fragment, we're assembling code as we go
          if (fragment) {
            fragment = addOpToFragment(fragment, pc, instruction, c);
          } else {
            // If there's no current fragment and we branch backwards, this is possibly a new loop
            if (c.pc < pc) {
              fragment = lookupFragment(c.pc);
            }
          }
        }
      }

      c.stuffToDo &= ~kStuffToDoBreakout;

      if (c.stuffToDo & kStuffToDoCheckInterrupts) {
        c.stuffToDo &= ~kStuffToDoCheckInterrupts;
        c.handleInterrupt();
      } else if (c.stuffToDo & kStuffToDoHalt) {
        break;
      } else if (c.stuffToDo) {
        n64js.warn("Don't know how to handle this event!");
        break;
      }
    }
  }

  n64js.getFragmentMap = function () {
    return fragmentMap;
  };

  n64js.getFragmentInvalidationEvents = function() {
    var t = fragmentInvalidationEvents;
    fragmentInvalidationEvents = [];
    return t;
  };

  function Fragment(pc) {
    this.entryPC          = pc;
    this.minPC            = pc;
    this.maxPC            = pc+4;
    this.func             = undefined;
    this.opsCompiled      = 0;
    this.executionCount   = 0;
    this.bailedOut        = false;    // Set if a fragment bailed out.
    this.nextFragments    = [];       // One slot per op

    // State used when compiling
    this.body_code        = '';
    this.needsDelayCheck  = true;

    this.cop1statusKnown = false;
    this.usesCop1        = false;
  }

  Fragment.prototype.invalidate = function () {
    // reset all but entryPC
    this.minPC            = this.entryPC;
    this.maxPC            = this.entryPC+4;
    this.func             = undefined;
    this.opsCompiled      = 0;
    this.bailedOut        = false;
    this.executionCount   = 0;
    this.nextFragments    = [];

    this.body_code        = '';
    this.needsDelayCheck  = true;

    this.cop1statusKnown  = false;
    this.usesCop1         = false;
  };

  Fragment.prototype.getNextFragment = function (pc, ops_executed) {
    var next_fragment = this.nextFragments[ops_executed];
    if (!next_fragment || next_fragment.entryPC !== pc) {

      // If not jump to self, look up
      if (pc === this.entryPC) {
        next_fragment = this;
      } else {
        next_fragment = lookupFragment(pc);
      }

      // And cache for next time around.
      this.nextFragments[ops_executed] = next_fragment;
    }
    return next_fragment;
  };

  function lookupFragment(pc) {
    // Check if we already have a fragment
    var fragment = fragmentMap[pc];
    if (!fragment) {

      if (!kEnableDynarec) {
        return null;
      }

      // Check if this pc is hot enough yet
      var hc = hitCounts[pc] || 0;
      hc++;
      hitCounts[pc] = hc;

      if (hc < kHotFragmentThreshold) {
        return null;
      }

      fragment = new Fragment(pc);
      fragmentMap[pc] = fragment;
    }

    // If we failed to complete the fragment for any reason, reset it
    if (!fragment.func) {
      fragment.invalidate();
    }

    return fragment;
  }

  var invals = 0;

  function FragmentMapWho() {
    var i;

    this.kNumEntries = 16*1024;

    this.entries = [];
    for (i = 0; i < this.kNumEntries; ++i) {
      this.entries.push({});
    }
  }

  FragmentMapWho.prototype.addressToCacheLine = function (address) {
    return Math.floor(address >>> 5);
  };

  FragmentMapWho.prototype.addressToCacheLineRoundUp = function (address) {
    return Math.floor((address+31) >>> 5);
  };

  FragmentMapWho.prototype.add = function (pc, fragment) {
    var cache_line_idx = this.addressToCacheLine(pc);
    var entry_idx      = cache_line_idx % this.entries.length;
    var entry          = this.entries[entry_idx];
    entry[fragment.entryPC] = fragment;
  };

  FragmentMapWho.prototype.invalidateEntry = function (address) {
    var cache_line_idx = this.addressToCacheLine(address),
        entry_idx      = cache_line_idx % this.entries.length,
        entry          = this.entries[entry_idx],
        removed        = 0;

    var i, fragment;


    for (i in entry) {
      if (entry.hasOwnProperty(i)) {
        fragment = entry[i];

        if (fragment.minPC <= address && fragment.maxPC > address) {
          fragment.invalidate();
          delete entry[i];
          removed++;
        }
      }
    }

    if (removed) {
      n64js.log('Fragment cache removed ' + removed + ' entries.');
    }

     //fragmentInvalidationEvents.push({'address': address, 'length': 0x20, 'system': 'CACHE', 'fragmentsRemoved': removed});
  };

  FragmentMapWho.prototype.invalidateRange = function (address, length) {
    var minaddr   = address,
        maxaddr   = address + length,
        minpage   = this.addressToCacheLine(minaddr),
        maxpage   = this.addressToCacheLineRoundUp(maxaddr),
        entries   = this.entries,
        removed   = 0;

    var cache_line_idx, entry_idx, entry, i, fragment;

    for (cache_line_idx = minpage; cache_line_idx <= maxpage; ++cache_line_idx) {
      entry_idx = cache_line_idx % entries.length;
      entry     = entries[entry_idx];

      for (i in entry) {
        if (entry.hasOwnProperty(i)) {
          fragment = entry[i];

          if (fragment.minPC <= maxaddr && fragment.maxPC > minaddr) {
            fragment.invalidate();
            delete entry[i];
            removed++;
          }
        }
      }
    }

    if (removed) {
      n64js.log('Fragment cache removed ' + removed + ' entries.');
    }

     //fragmentInvalidationEvents.push({'address': address, 'length': length, 'system': system, 'fragmentsRemoved': removed});
  };

  // Invalidate a single cache line
  n64js.invalidateICacheEntry = function (address) {
      //n64js.log('cache flush ' + n64js.toString32(address));

     ++invals;
     if ((invals%10000) === 0) {
      n64js.log(invals + ' invals');
     }

     fragmentMapWho.invalidateEntry(address);
  };

  // This isn't called right now. We
  n64js.invalidateICacheRange = function (address, length, system) {
      //n64js.log('cache flush ' + n64js.toString32(address) + ' ' + n64js.toString32(length));
      // FIXME: check for overlapping ranges

     // NB: not sure PI events are useful right now.
     if (system==='PI') {
      return;
     }

     fragmentMapWho.invalidateRange(address, length);
  };

  var fragmentMapWho = new FragmentMapWho();

  function updateFragment(fragment, pc) {
    fragment.minPC = Math.min(fragment.minPC, pc);
    fragment.maxPC = Math.max(fragment.maxPC, pc+4);

    fragmentMapWho.add(pc, fragment);
  }

  function checkEqual(a,b,m) {
    if (a !== b) {
      var msg = n64js.toString32(a) + ' !== ' + n64js.toString32(b) + ' : ' + m;
      console.assert(false, msg);
      n64js.halt(msg);
      return false;
    }
    return true;
  }

  n64js.checkSyncState = checkSyncState;    // Needs to be callable from dynarec

  function generateCodeForOp(ctx) {

    ctx.needsDelayCheck = ctx.fragment.needsDelayCheck;
    ctx.isTrivial       = false;

    var fn_code = generateOp(ctx);

    if (ctx.dump) {
      console.log(fn_code);
    }

    // if (fn_code.indexOf('execute') >= 0 && fn_code.indexOf('executeCop1_disabled') < 0 ) {
    //   console.log('slow' + fn_code);
    // }

    // If the last op tried to delay updating the pc, see if it needs updating now.
    if (!ctx.isTrivial && ctx.delayedPCUpdate !== 0) {
        ctx.fragment.body_code += '/*applying delayed pc*/\nc.pc = ' + n64js.toString32(ctx.delayedPCUpdate) + ';\n';
        ctx.delayedPCUpdate = 0;
    }

    ctx.fragment.needsDelayCheck = ctx.needsDelayCheck;

    //code += 'if (!checkEqual( n64js.readMemoryU32(cpu0.pc), ' + n64js.toString32(instruction) + ', "unexpected instruction (need to flush icache?)")) { return false; }\n';

    ctx.fragment.bailedOut |= ctx.bailOut;

    var sync = n64js.getSyncFlow();
    if (sync) {
      fn_code = 'if (!n64js.checkSyncState(sync, ' + n64js.toString32(ctx.pc) + ')) { return ' + ctx.fragment.opsCompiled + '; }\n' + fn_code;
    }

    ctx.fragment.body_code += fn_code + '\n';
  }

  function generateOp(ctx) {
    var opcode = (ctx.instruction >>> 26) & 0x3f;
    var fn = simpleTableGen[opcode];
    return generateOpHelper(fn, ctx);
  }

  function generateSpecial(ctx) {
    var special_fn = ctx.instruction & 0x3f;
    var fn = specialTableGen[special_fn];
    return generateOpHelper(fn, ctx);
  }

  function generateRegImm(ctx) {
    var rt = (ctx.instruction >>> 16) & 0x1f;
    var fn = regImmTableGen[rt];
    return generateOpHelper(fn, ctx);
  }

  function generateCop0(ctx) {
    var fmt = (ctx.instruction >>> 21) & 0x1f;
    var fn = cop0TableGen[fmt];
    return generateOpHelper(fn,ctx);
  }

  // This takes a fn - either a string (in which case we generate some unoptimised boilerplate) or a function (which we call recursively)
  function generateOpHelper(fn,ctx) {
    // fn can be a handler function, in which case defer to that.
    if (typeof fn === 'string') {
      //n64js.log(fn);
      return generateGenericOpBoilerplate('n64js.' + fn + '(' + n64js.toString32(ctx.instruction) + ');\n', ctx);
    } else {
      return fn(ctx);
    }
  }

  function generateGenericOpBoilerplate(fn,ctx) {
    var code = '';
    code += ctx.genAssert('c.pc === ' + n64js.toString32(ctx.pc), 'pc mismatch');

    if (ctx.needsDelayCheck) {
      // NB: delayPC not cleared here - it's always overwritten with branchTarget below.
      code += 'if (c.delayPC) { c.nextPC = c.delayPC; } else { c.nextPC = ' + n64js.toString32(ctx.pc+4) +'; }\n';
    } else {
      code += ctx.genAssert('c.delayPC === 0', 'delay pc should be zero');
      code += 'c.nextPC = ' + n64js.toString32(ctx.pc+4) + ';\n';
    }
    code += 'c.branchTarget = 0;\n';

    code += fn;

    code += 'c.pc = c.nextPC;\n';
    code += 'c.delayPC = c.branchTarget;\n';

    // We don't know if the generic op set delayPC, so assume the worst
    ctx.needsDelayCheck = true;

    if (accurateCountUpdating) {
      code += 'c.control_signed[9] += 1;\n';
    }

    // If bailOut is set, always return immediately
    if (ctx.bailOut) {
      code += 'return ' + ctx.fragment.opsCompiled + ';\n';
    } else {
      code += 'if (c.stuffToDo) { return ' + ctx.fragment.opsCompiled + '; }\n';
      code += 'if (c.pc !== ' + n64js.toString32(ctx.post_pc) + ') { return ' + ctx.fragment.opsCompiled + '; }\n';
    }

    return code;
  }

  // Standard code for manipulating the pc
  function generateStandardPCUpdate(fn, ctx, might_adjust_next_pc) {
    var code = '';
    code += ctx.genAssert('c.pc === ' + n64js.toString32(ctx.pc), 'pc mismatch');

    if (ctx.needsDelayCheck) {
      // We should probably assert on this - two branch instructions back-to-back is weird, but the flag could just be set because of a generic op
      code += 'if (c.delayPC) { c.nextPC = c.delayPC; c.delayPC = 0; } else { c.nextPC = ' + n64js.toString32(ctx.pc+4) +'; }\n';
      code += fn;
      code += 'c.pc = c.nextPC;\n';
    } else if (might_adjust_next_pc) {
      // If the branch op might manipulate nextPC, we need to ensure that it's set to the correct value
      code += ctx.genAssert('c.delayPC === 0', 'delay pc should be zero');
      code += 'c.nextPC = ' + n64js.toString32(ctx.pc+4) + ';\n';
      code += fn;
      code += 'c.pc = c.nextPC;\n';
    } else {
      code += ctx.genAssert('c.delayPC === 0', 'delay pc should be zero');
      code += fn;
      code += 'c.pc = ' + n64js.toString32(ctx.pc+4) + ';\n';
    }

    return code;
  }

  // Memory access does not adjust branchTarget, but nextPC may be adjusted if they cause an exception.
  function generateMemoryAccessBoilerplate(fn,ctx) {
    var code = '';

    var might_adjust_next_pc = true;
    code += generateStandardPCUpdate(fn, ctx, might_adjust_next_pc);

    // Memory instructions never cause a branch delay
    code += ctx.genAssert('c.delayPC === 0', 'delay pc should be zero');
    ctx.needsDelayCheck = false;

    if (accurateCountUpdating) {
      code += 'c.control_signed[9] += 1;\n';
    }

    // If bailOut is set, always return immediately
    n64js.assert(!ctx.bailOut, "Not expecting bailOut to be set for memory access");
    code += 'if (c.stuffToDo) { return ' + ctx.fragment.opsCompiled + '; }\n';
    code += 'if (c.pc !== ' + n64js.toString32(ctx.post_pc) + ') { return ' + ctx.fragment.opsCompiled + '; }\n';
    return code;
  }

  // Branch ops explicitly manipulate nextPC rather than branchTarget. They also guarnatee that stuffToDo is not set.
  // might_adjust_next_pc is typically used by branch likely instructions.
  function generateBranchOpBoilerplate(fn,ctx, might_adjust_next_pc) {
    var code = '';

    // We only need to check for off-trace branches
    var need_pc_test = ctx.needsDelayCheck || might_adjust_next_pc || ctx.post_pc !== ctx.pc+4;

    code += generateStandardPCUpdate(fn, ctx, might_adjust_next_pc);

    // Branch instructions can always set a branch delay
    ctx.needsDelayCheck = true;

    if (accurateCountUpdating) {
      code += 'c.control_signed[9] += 1;\n';
    }

    code += ctx.genAssert('c.stuffToDo === 0', 'stuffToDo should be zero');

    // If bailOut is set, always return immediately
    if (ctx.bailOut) {
      code += 'return ' + ctx.fragment.opsCompiled + ';\n';
    } else {
      if (need_pc_test) {
        code += 'if (c.pc !== ' + n64js.toString32(ctx.post_pc) + ') { return ' + ctx.fragment.opsCompiled + '; }\n';
      }
      else
      {
        code += '/* skipping pc test */\n';
      }
    }

    return code;
  }

  // Trivial ops can use this specialised handler which eliminates a lot of overhead.
  // Trivial ops are defined as those which:
  // Don't require cpu0.pc to be set correctly (required by branches, stuff that can throw exceptions for instance)
  // Don't set cpu0.stuffToDo
  // Don't set branchTarget
  // Don't manipulate nextPC (e.g. ERET, cop1 unusable, likely instructions)

  function generateTrivialOpBoilerplate(fn,ctx) {

    var code = '';

    // NB: trivial functions don't rely on pc being set up, so we perform the op before updating the pc.
    code += fn;

    ctx.isTrivial = true;

    if (accurateCountUpdating) {
      code += 'c.control_signed[9] += 1;\n';
    }

    // NB: do delay handler after executing op, so we can set pc directly
    if (ctx.needsDelayCheck) {
      code += 'if (c.delayPC) { c.pc = c.delayPC; c.delayPC = 0; } else { c.pc = ' + n64js.toString32(ctx.pc+4) + '; }\n';
      // Might happen: delay op from previous instruction takes effect
      code += 'if (c.pc !== ' + n64js.toString32(ctx.post_pc) + ') { return ' + ctx.fragment.opsCompiled + '; }\n';
    } else {
      code += ctx.genAssert('c.delayPC === 0', 'delay pc should be zero');

      // We can avoid off-branch checks in this case.
      if (ctx.post_pc !== ctx.pc+4) {
        n64js.assert("post_pc should always be pc+4 for trival ops?");
        code += 'c.pc = ' + n64js.toString32(ctx.pc+4) + ';\n';
        code += 'if (c.pc !== ' + n64js.toString32(ctx.post_pc) + ') { return ' + ctx.fragment.opsCompiled + '; }\n';
      } else {
        //code += 'c.pc = ' + n64js.toString32(ctx.pc+4) + ';\n';
        code += '/* delaying pc update */\n';
        ctx.delayedPCUpdate = ctx.pc+4;
      }
    }


    // Trivial instructions never cause a branch delay
    code += ctx.genAssert('c.delayPC === 0', 'delay pc should be zero');
    ctx.needsDelayCheck = false;

    // Trivial instructions never cause stuffToDo to be set
    code += ctx.genAssert('c.stuffToDo === 0', 'stuffToDo should be zero');

    return code;
  }

  function generateNOPBoilerplate(comment, ctx) {
    return generateTrivialOpBoilerplate(comment + '\n',ctx);
  }

}(window.n64js = window.n64js || {}));
