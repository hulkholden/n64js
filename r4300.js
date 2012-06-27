if (typeof n64js === 'undefined') {
  var n64js = {};
}

(function () {'use strict';
  var debugTLB = 0;

  var k1Shift32 = 4294967296.0;

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

  var kVIIntrCycles = 62500;

  var kEventVbl          = 0;
  var kEventCompare      = 1;
  var kEventRunForCycles = 2;

  function TLBEntry() {
    this.pagemask = 0;
    this.hi       = 0;
    this.pfne     = 0;
    this.pfno     = 0;
    this.mask     = 0;
    this.global   = 0;
  }

  TLBEntry.prototype = {
    update : function(index, pagemask, hi, entrylo0, entrylo1) {
      if (debugTLB) {
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

      this.mask     = pagemask | (~TLBHI_VPN2MASK);
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
    }
  };

  function CPU0() {

    this.gprLoMem       = new ArrayBuffer(32*4);
    this.gprHiMem       = new ArrayBuffer(32*4);

    this.gprLo          = new Uint32Array(this.gprLoMem);
    this.gprHi          = new Uint32Array(this.gprHiMem);
    this.gprLo_signed   = new Int32Array(this.gprLoMem);
    this.gprHi_signed   = new Int32Array(this.gprHiMem);

    this.control        = new Uint32Array(32);

    this.pc             = 0;
    this.delayPC        = 0;
    this.nextPC         = 0;      // Set to the next expected PC before an op executes. Ops can update this to change control flow without branch delay (e.g. likely branches, ERET)
    this.branchTarget   = 0;      // Set to indicate a branch has been taken. Sets the delayPC for the subsequent op.

    var E_VEC           = 0x80000180;

    this.stuffToDo      = 0;     // used to flag r4300 to cease execution

    this.events         = [];

    this.multHi         = new Uint32Array(2);
    this.multLo         = new Uint32Array(2);

    this.opsExecuted    = 0;

    this.tlbEntries = [];
    for (var i = 0; i < 32; ++i) {
      this.tlbEntries.push(new TLBEntry());
    }

    this.getGPR_s64 = function (r) {
      return (this.gprHi_signed[r] * k1Shift32) + this.gprLo[r];
    }

    this.getGPR_u64 = function (r) {
      return (this.gprHi[r] * k1Shift32) + this.gprLo[r];
    }

    this.setGPR_s64 = function (r, v) {
      this.gprHi[r] = Math.floor( v / k1Shift32 );
      this.gprLo[r] = (v&0xffffffff)>>>0;
    }

    this.reset = function () {

      for (var i = 0; i < 32; ++i) {
        this.gprLo[i]   = 0;
        this.gprHi[i]   = 0;
        this.control[i] = 0;
      }
      for (var i = 0; i < 32; ++i) {
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

      this.opsExecuted  = 0;

      this.control[this.kControlRand]   = 32-1;
      this.control[this.kControlSR]     = 0x70400004;
      this.control[this.kControlConfig] = 0x0006e463;

      this.addEvent(kEventVbl, kVIIntrCycles);
    };

    this.breakExecution = function () {
      this.stuffToDo |= kStuffToDoHalt;
    }

    this.speedHack = function () {
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
        n64js.log('next instruction does something');
      }
    }

    this.updateCause3 = function () {
      if (n64js.miInterruptsUnmasked()) {
        this.control[this.kControlCause] |= CAUSE_IP3;

        if (this.checkForUnmaskedInterrupts()) {
          this.stuffToDo |= kStuffToDoCheckInterrupts;
        }
      } else {
        this.control[this.kControlCause] &= ~CAUSE_IP3;
      }

      checkCauseIP3Consistent();
    }

    this.setSR = function (value) {
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

    this.checkForUnmaskedInterrupts = function () {
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
    }

    this.throwCop1Unusable = function () {
      // XXXX check we're not inside exception handler before snuffing CAUSE reg?
      this.setException( CAUSE_EXCMASK|CAUSE_CEMASK, EXC_CPU | 0x10000000 );
      this.nextPC = E_VEC;
    }

    this.handleInterrupt = function () {
      if (this.checkForUnmaskedInterrupts()) {
          this.setException( CAUSE_EXCMASK, EXC_INT );
          // this is handled outside of the main dispatch loop, so need to update pc directly
          this.pc      = E_VEC;
          this.delayPC = 0;

      } else {
        n64js.assert(false, "Was expecting an unmasked interrupt - something wrong with kStuffToDoCheckInterrupts?");
      }
    }

    this.setException = function (mask, exception) {
      this.control[this.kControlCause] &= ~mask;
      this.control[this.kControlCause] |= exception
      this.control[this.kControlSR]  |= SR_EXL;
      this.control[this.kControlEPC]  = this.pc;
      if (this.delayPC) {
        this.control[this.kControlCause] |= CAUSE_BD;
        this.control[this.kControlEPC]   -= 4;
      } else {
        this.control[this.kControlCause] &= ~CAUSE_BD;
      }
    }

    this.setCompare = function (value) {
      this.control[this.kControlCause] &= ~CAUSE_IP8;
      if (value === this.control[this.kControlCompare]) {
        // just clear the IP8 flag
      } else {
        if (value != 0) {
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

    Event.prototype = {
      getName : function () {
        switch(this.type) {
          case kEventVbl:           return 'Vbl';
          case kEventCompare:       return 'Compare';
          case kEventRunForCycles:  return 'Run';
        }

        return '?';
      }
    }

    this.addEvent = function(type, countdown) {
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
    }


    this.removeEventsOfType = function (type) {
      for (var i = 0; i < this.events.length; ++i) {
        if (this.events[i].type == type) {
          // Add this countdown on to the subsequent event
          if ((i+1) < this.events.length) {
            this.events[i+1].countdown += this.events[i].countdown;
          }
          this.events.splice(i, 1);
          return;
        }
      }
    };

    this.hasEvent = function(type) {
      for (var i = 0; i < this.events.length; ++i) {
        if (this.events[i].type == type) {
          return true;
        }
      }
      return false;
    }

    this.getRandom = function () {
      var wired = this.control[this.kControlWired] & 0x1f;
      var random = Math.floor(Math.random() * (32-wired)) + wired;
      n64js.assert(random >= wired && random <= 31, "Ooops - random should be in range " + wired + "..31, but got " + random);
      return random;
    }

    function setTLB(cpu, index) {
      var pagemask = cpu.control[cpu.kControlPageMask];
      var entryhi  = cpu.control[cpu.kControlEntryHi];
      var entrylo1 = cpu.control[cpu.kControlEntryLo1];
      var entrylo0 = cpu.control[cpu.kControlEntryLo0];

      cpu.tlbEntries[index].update(index, pagemask, entryhi, entrylo0, entrylo1);
    }

    this.tlbWriteIndex = function () {
      setTLB(this, this.control[this.kControlIndex] & 0x1f);
    }

    this.tlbWriteRandom = function () {
      setTLB(this, this.getRandom());
    }

    this.tlbRead = function () {
      var index = this.control[this.kControlIndex] & 0x1f;
      var tlb   = this.tlbEntries[index];

      this.control[this.kControlPageMask] = tlb.mask;
      this.control[this.kControlEntryHi ] = tlb.hi;
      this.control[this.kControlEntryLo0] = tlb.pfne | tlb.global;
      this.control[this.kControlEntryLo1] = tlb.pfno | tlb.global;

      if (debugTLB) {
        n64js.log('TLB Read Index ' + n64js.toString8(index) + '.');
        n64js.log('  PageMask: ' + n64js.toString32(this.control[this.kControlPageMask]));
        n64js.log('  EntryHi:  ' + n64js.toString32(this.control[this.kControlEntryHi]));
        n64js.log('  EntryLo0: ' + n64js.toString32(this.control[this.kControlEntryLo0]));
        n64js.log('  EntryLo1: ' + n64js.toString32(this.control[this.kControlEntryLo1]));
      }
    }

    this.tlbProbe = function () {
      var entryhi      = this.control[this.kControlEntryHi];
      var entryhi_vpn2 = entryhi & TLBHI_VPN2MASK;
      var entryhi_pid  = entryhi & TLBHI_PIDMASK;

      for (var i = 0; i < 32; ++i) {
        var tlb = this.tlbEntries[i];
        if (   (tlb.hi & TLBHI_VPN2MASK) === entryhi_vpn2) {
          if (((tlb.hi & TLBHI_PIDMASK)  === entryhi_pid) ||
               tlb.global) {
            if (debugTLB) {
              n64js.log('TLB Probe. EntryHi:' + n64js.toString32(entryhi) + '. Found matching TLB entry - ' + n64js.toString8(i));
            }
            this.control[this.kControlIndex] = i;
            return;
          }
        }
      }

      if (debugTLB) {
        n64js.log('TLB Probe. EntryHi:' + n64js.toString32(entryhi) + ". Didn't find matching entry");
      }
      this.control[this.kControlIndex] = TLBINX_PROBE;
    }

    this.tlbFindEntry = function (address) {
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
    }

    this.translate = function (address) {
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

          if (!valid) {
            n64js.halt('Need to throw tlbinvalid for ' + n64js.toString32(address));
          }

          return valid ? physical_addr : 0;

      } else {
        // throw TLBRefll
        n64js.halt('Need to throw tlbrefill for ' + n64js.toString32(address));
        return 0;
      }
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
    }

    this.setCondition = function (v) {
      if (v)
        this.control[31] |=  FPCSR_C;
      else
        this.control[31] &= ~FPCSR_C;
    }

    this.store_u32 = function (i, v) {
      this.uint32[i+0] = v;
    }
    this.store_u64 = function (i, lo, hi) {
      this.uint32[i+0] = lo;
      this.uint32[i+1] = hi;
    }

    this.load_u32 = function (i) {
      return this.uint32[i+0];
    }
    this.load_u32hi = function (i) {
      return this.uint32[i+1];
    }
    this.load_s32 = function (i) {
      return this.int32[i+0];
    }
    this.load_f32 = function (i) {
      return this.float32[i+0];
    }
    this.load_f64 = function (i) {
      return this.float64[i/2];
    }

    this.store_s32 = function(i, v) {
      this.int32[i+0] = v;
    }
    this.store_f32 = function(i, v) {
      this.float32[i+0] = v;
    }
    this.store_f64 = function(i, v) {
      this.float64[i/2] = v;
    }

  };

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
  function   jumpAddress(pc,i) { return ((pc&0xf0000000) | (target(i)*4))>>>0; }

  function performBranch(new_pc) {
    if (new_pc < 0) {
      n64js.log('Oops, branching to negative address: ' + new_pc);
      throw 'Oops, branching to negative address: ' + new_pc;
    }
    cpu0.branchTarget = new_pc;
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
    arr[0] = v; //(v&0xffffffff) >>> 0; -- is this necessary?
    arr[1] = (v&0x80000000) ? 0xffffffff : 0x00000000;
  }
  function setHiLoZeroExtend(arr, v) {
    arr[0] = v; //(v&0xffffffff) >>> 0; -- is this necessary?
    arr[1] = 0x00000000;
  }

  function getHi32(v) {
    // >>32 just seems to no-op? Argh.
    return Math.floor( v / k1Shift32 );
  }
  function getLo32(v) {
    return (v&0xffffffff)>>>0;
  }

  function unimplemented(pc,i) {
    var r = n64js.disassembleOp(pc,i);
    var e = 'Unimplemented op ' + n64js.toString32(i) + ' : ' + r.disassembly + '<br>';

    $('#output').append(e);
    throw e;
  }

  function executeUnknown(i) {
    throw 'Unknown op: ' + n64js.toString32(cpu0.pc) + ', ' + n64js.toString32(i);
  }

  function executeSLL(i) {
    // Special-case NOP
    if (i == 0)
      return;

    setSignExtend( rd(i), ((cpu0.gprLo[rt(i)] << sa(i)) & 0xffffffff)>>>0 );
  }

  function executeSRL(i) {
    setSignExtend( rd(i), cpu0.gprLo[rt(i)] >>> sa(i) );
  }
  function executeSRA(i) {
    setSignExtend( rd(i), cpu0.gprLo[rt(i)] >> sa(i) );
  }
  function executeSLLV(i) {
    setSignExtend( rd(i), (cpu0.gprLo[rt(i)] <<  (cpu0.gprLo[rs(i)] & 0x1f)) & 0xffffffff );
  }
  function executeSRLV(i) {
    setSignExtend( rd(i),  cpu0.gprLo[rt(i)] >>> (cpu0.gprLo[rs(i)] & 0x1f) );
  }
  function executeSRAV(i) {
    setSignExtend( rd(i),  cpu0.gprLo[rt(i)] >>  (cpu0.gprLo[rs(i)] & 0x1f) );
  }

  function executeDSLLV(i)      { unimplemented(cpu0.pc,i); }
  function executeDSRLV(i)      { unimplemented(cpu0.pc,i); }
  function executeDSRAV(i)      { unimplemented(cpu0.pc,i); }

  function executeDSLL(i)       { unimplemented(cpu0.pc,i); }
  function executeDSRL(i)       { unimplemented(cpu0.pc,i); }
  function executeDSRA(i)       { unimplemented(cpu0.pc,i); }

  function executeDSLL32(i) {
    cpu0.gprLo[rd(i)] = 0;
    cpu0.gprHi[rd(i)] = cpu0.gprLo[rt(i)] << sa(i);
  }
  function executeDSRL32(i) {
    setZeroExtend( rd(i), cpu0.gprHi[rt(i)] >>> sa(i) );
  }
  function executeDSRA32(i) {
    setSignExtend( rd(i), cpu0.gprHi[rt(i)] >> sa(i) );
  }


  function executeSYSCALL(i)    { unimplemented(cpu0.pc,i); }
  function executeBREAK(i)      { unimplemented(cpu0.pc,i); }
  function executeSYNC(i)       { unimplemented(cpu0.pc,i); }



  function executeMFHI(i) {
    cpu0.gprHi[rd(i)] = cpu0.multHi[1]; 
    cpu0.gprLo[rd(i)] = cpu0.multHi[0]; 
  }
  function executeMFLO(i) {
    cpu0.gprHi[rd(i)] = cpu0.multLo[1]; 
    cpu0.gprLo[rd(i)] = cpu0.multLo[0]; 
  }
  function executeMTHI(i) {
    cpu0.multHi[0] = cpu0.gprLo[rs(i)];
    cpu0.multHi[1] = cpu0.gprHi[rs(i)];
  }
  function executeMTLO(i)  {
    cpu0.multLo[0] = cpu0.gprLo[rs(i)];
    cpu0.multLo[1] = cpu0.gprHi[rs(i)];
  }

  function executeMULT(i) {
    var result = cpu0.gprLo_signed[rs(i)] * cpu0.gprLo_signed[rt(i)];   // needs to be 64-bit!
    setHiLoSignExtend( cpu0.multLo, getLo32(result) );
    setHiLoSignExtend( cpu0.multHi, getHi32(result) );
  }
  function executeMULTU(i) {
    var result = cpu0.gprLo[rs(i)] * cpu0.gprLo[rt(i)];   // needs to be 64-bit!
    setHiLoSignExtend( cpu0.multLo, getLo32(result) );
    setHiLoSignExtend( cpu0.multHi, getHi32(result) );
  }
  function executeDMULT(i) {
    var result = cpu0.gprLo_signed[rs(i)] * cpu0.gprLo_signed[rt(i)];   // needs to be 64-bit!
    cpu0.multLo[0] = getLo32(result);
    cpu0.multLo[1] = getHi32(result);
    cpu0.multHi[0] = 0;
    cpu0.multHi[1] = 0;
  }
  function executeDMULTU(i) {
    var result = cpu0.gprLo[rs(i)] * cpu0.gprLo[rt(i)];   // needs to be 64-bit!
    cpu0.multLo[0] = getLo32(result);
    cpu0.multLo[1] = getHi32(result);
    cpu0.multHi[0] = 0;
    cpu0.multHi[1] = 0;
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
    var dividend = cpu0.gprLo_signed[rs(i)];
    var divisor  = cpu0.gprLo_signed[rt(i)];
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
      n64js.halt('Full 64 bit division not handled!');
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

  function executeADD(i) {
    setSignExtend( rd(i), cpu0.gprLo[rs(i)] + cpu0.gprLo[rt(i)] ); // s32 + s32
  }
  function executeADDU(i) {
    setSignExtend( rd(i), cpu0.gprLo[rs(i)] + cpu0.gprLo[rt(i)] ); // s32 + s32
  }

  function executeSUB(i) {
    setSignExtend( rd(i), cpu0.gprLo[rs(i)] - cpu0.gprLo[rt(i)] ); // s32 - s32
  }
  function executeSUBU(i) {
    setSignExtend( rd(i), cpu0.gprLo[rs(i)] - cpu0.gprLo[rt(i)] ); // s32 - s32
  }

  function executeAND(i) {
    cpu0.gprHi[rd(i)] = cpu0.gprHi[rs(i)] & cpu0.gprHi[rt(i)];
    cpu0.gprLo[rd(i)] = cpu0.gprLo[rs(i)] & cpu0.gprLo[rt(i)];
  }

  function executeOR(i) {
    cpu0.gprHi[rd(i)] = cpu0.gprHi[rs(i)] | cpu0.gprHi[rt(i)];
    cpu0.gprLo[rd(i)] = cpu0.gprLo[rs(i)] | cpu0.gprLo[rt(i)];
  }

  function executeXOR(i) {
    cpu0.gprHi[rd(i)] = cpu0.gprHi[rs(i)] ^ cpu0.gprHi[rt(i)];
    cpu0.gprLo[rd(i)] = cpu0.gprLo[rs(i)] ^ cpu0.gprLo[rt(i)];
  }

  function executeNOR(i) {
    cpu0.gprHi[rd(i)] = ~(cpu0.gprHi[rs(i)] | cpu0.gprHi[rt(i)]);
    cpu0.gprLo[rd(i)] = ~(cpu0.gprLo[rs(i)] | cpu0.gprLo[rt(i)]);
  }


  // ffffffff fffffff0    // -16          false
  // ffffffff 00000001    // -4294967295

  // 00000000 fffffff0    // 4294967280   false
  // 00000000 00000001    // 1

  // 00000000 fffffff0    // 4294967280
  // ffffffff 00000001    // -4294967295  false

  // ffffffff fffffff0    // -16  true
  // 00000000 00000001    // 1

  function executeSLT(i) {
    var r = 0;
    if (cpu0.gprHi_signed[rs(i)] < cpu0.gprHi_signed[rt(i)]) {
      r = 1;
    } else if (cpu0.gprHi_signed[rs(i)] === cpu0.gprHi_signed[rt(i)]) {
      r = cpu0.gprLo[rs(i)] < cpu0.gprLo[rt(i)];
    }
    setZeroExtend(rd(i), r);
  }
  function executeSLTU(i) {
    var r = 0;
    if (cpu0.gprHi[rs(i)] < cpu0.gprHi[rt(i)] ||
        (cpu0.gprHi[rs(i)] === cpu0.gprHi[rt(i)] && cpu0.gprLo[rs(i)] < cpu0.gprLo[rt(i)])) {
      r = 1;
    }
    setZeroExtend(rd(i), r);
  }
  function executeDADD(i)       { unimplemented(cpu0.pc,i); }
  function executeDADDU(i)      { unimplemented(cpu0.pc,i); }
  function executeDSUB(i)       { unimplemented(cpu0.pc,i); }
  function executeDSUBU(i)      { unimplemented(cpu0.pc,i); }
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
  function executeJ(i) {
    performBranch( jumpAddress(cpu0.pc,i) );
  }
  function executeJAL(i) {
    setSignExtend(cpu0.kRegister_ra, cpu0.pc + 8);
    performBranch( jumpAddress(cpu0.pc,i) );
  }
  function executeJALR(i) {
    var new_pc = cpu0.gprLo[rs(i)];
    setSignExtend(rd(i), cpu0.pc + 8);
    performBranch( new_pc );
  }

  function executeJR(i) {
    performBranch( cpu0.gprLo[rs(i)] );
  }

  function executeBEQ(i) {
    var s = rs(i);
    var t = rt(i);
    if (cpu0.gprHi[s] === cpu0.gprHi[t] &&
        cpu0.gprLo[s] === cpu0.gprLo[t] ) {

        if (offset(i) === -1) {
          cpu0.speedHack();
        }

      performBranch( branchAddress(cpu0.pc,i) );
    }
  }
  function executeBEQL(i) {
    var s = rs(i);
    var t = rt(i);
    if (cpu0.gprHi[s] === cpu0.gprHi[t] &&
        cpu0.gprLo[s] === cpu0.gprLo[t] ) {
      performBranch( branchAddress(cpu0.pc,i) );
    } else {
      cpu0.nextPC += 4;   // skip the next instruction
    }
  }

  function executeBNE(i) {
    var s = rs(i);
    var t = rt(i);
    if (cpu0.gprHi[s] !== cpu0.gprHi[t] ||
        cpu0.gprLo[s] !== cpu0.gprLo[t] ) {      // NB: if imms(i) == -1 then this is a branch to self/busywait
      performBranch( branchAddress(cpu0.pc,i) );
    }
  }
  function executeBNEL(i) {
    var s = rs(i);
    var t = rt(i);
    if (cpu0.gprHi[s] !== cpu0.gprHi[t] ||
        cpu0.gprLo[s] !== cpu0.gprLo[t] ) {
      performBranch( branchAddress(cpu0.pc,i) );
    } else {
      cpu0.nextPC += 4;   // skip the next instruction
    }
  }

  // Branch Less Than or Equal To Zero
  function executeBLEZ(i) {
    var s = rs(i);
    if ( cpu0.gprHi_signed[s] < 0 ||
        (cpu0.gprHi[s] === 0 && cpu0.gprLo[s] === 0) ) {
      performBranch( branchAddress(cpu0.pc,i) );
    }
  }
  function executeBLEZL(i) {
    var s = rs(i);
    // NB: if rs == r0 then this branch is always taken
    if ( cpu0.gprHi_signed[s] < 0 ||
        (cpu0.gprHi[s] === 0 && cpu0.gprLo[s] === 0) ) {
      performBranch( branchAddress(cpu0.pc,i) );
    } else {
      cpu0.nextPC += 4;   // skip the next instruction
    }
  }

  // Branch Greater Than Zero
  function executeBGTZ(i) {
    var s = rs(i);
    if ( cpu0.gprHi_signed[s] >= 0 &&
        (cpu0.gprHi[s] !== 0 || cpu0.gprLo[s] !== 0) ) {
      performBranch( branchAddress(cpu0.pc,i) );
    }
  }
  function executeBGTZL(i) {
    var s = rs(i);
    if ( cpu0.gprHi_signed[s] >= 0 &&
        (cpu0.gprHi[s] !== 0 || cpu0.gprLo[s] !== 0) ) {
      performBranch( branchAddress(cpu0.pc,i) );
    } else {
      cpu0.nextPC += 4;   // skip the next instruction
    }
  }


  // Branch Less Than Zero
  function executeBLTZ(i) {
    if (cpu0.gprHi_signed[rs(i)] < 0) {
      performBranch( branchAddress(cpu0.pc,i) );
    }
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
  function executeBGEZ(i) {
    if (cpu0.gprHi_signed[rs(i)] >= 0) {
      performBranch( branchAddress(cpu0.pc,i) );
    }
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


  function executeADDI(i) {
    var a = cpu0.gprLo[rs(i)];
    var v = imms(i);
    setSignExtend(rt(i), a + v);
  }
  function executeADDIU(i) {
    var a = cpu0.gprLo[rs(i)];
    var v = imms(i);
    setSignExtend(rt(i), a + v);
  }

  function executeDADDI(i) {
    cpu0.setGPR_s64(rt(i), cpu0.getGPR_s64(rs(i)) + imms(i));
  }
  function executeDADDIU(i) {
    cpu0.setGPR_s64(rt(i), cpu0.getGPR_s64(rs(i)) + imms(i));
  }

  function executeSLTI(i) {
    var s         = rs(i);
    var t         = rt(i);

    var immediate = imms(i);
    var imm_hi    = immediate >> 31;
    var s_hi      = cpu0.gprHi_signed[s];

    if (s_hi === imm_hi) {
      cpu0.gprLo[t] = cpu0.gprLo[s] < (immediate>>>0);    // NB signed compare
    } else {
      cpu0.gprLo[t] = s_hi < imm_hi;
    }
    cpu0.gprHi[t] = 0;
  }
  function executeSLTIU(i) {
    var s         = rs(i);
    var t         = rt(i);

    // NB: immediate value is still sign-extended, but treated as unsigned
    var immediate = imms(i);
    var imm_hi    = immediate >> 31;
    var s_hi      = cpu0.gprHi_signed[s];

    if (s_hi === imm_hi) {
      cpu0.gprLo[t] = cpu0.gprLo[s] < (immediate>>>0);
    } else {
      cpu0.gprLo[t] = (s_hi>>>0) < (imm_hi>>>0);
    }
    cpu0.gprHi[t] = 0;

  }

  function executeANDI(i) {
    cpu0.gprHi[rt(i)] = 0;    // always 0, as sign extended immediate value is always 0
    cpu0.gprLo[rt(i)] = cpu0.gprLo[rs(i)] & imm(i);    
  }
  
  function executeORI(i) {
    cpu0.gprHi[rt(i)] = cpu0.gprHi[rs(i)];
    cpu0.gprLo[rt(i)] = cpu0.gprLo[rs(i)] | imm(i);
  }
  
  function executeXORI(i) {
    // High 32 bits are always unchanged, as sign extended immediate value is always 0
    cpu0.gprHi[rt(i)] = cpu0.gprHi[rs(i)];
    cpu0.gprLo[rt(i)] = cpu0.gprLo[rs(i)] ^ imm(i);
  }
  
  function executeLUI(i) {
    var v  = imms(i) << 16;
    setSignExtend(rt(i), v);
  }
  
  function executeLB(i) {
    setSignExtend(rt(i), (n64js.readMemory8( memaddr(i) )<<24)>>24);
  }
  function executeLH(i) {
    setSignExtend(rt(i), (n64js.readMemory16( memaddr(i) )<<16)>>16);
  }
  function executeLW(i) {
    // SF2049 requires this, apparently
    if (rt(i) == 0)
      return;
    setSignExtend(rt(i), n64js.readMemory32( memaddr(i) ));
  }

  function executeLBU(i) {
    setZeroExtend(rt(i), n64js.readMemory8( memaddr(i) ));
  }
  function executeLHU(i) {
    setZeroExtend(rt(i), n64js.readMemory16( memaddr(i) ));
  }
  function executeLWU(i) {
    setZeroExtend(rt(i), n64js.readMemory32( memaddr(i) ));
  }
  function executeLD(i) {
    cpu0.gprHi[rt(i)] = n64js.readMemory32( memaddr(i) + 0 );
    cpu0.gprLo[rt(i)] = n64js.readMemory32( memaddr(i) + 4 );
  }

  function executeLWC1(i) {
    cpu1.store_u32( ft(i), n64js.readMemory32( memaddr(i)) );
  }
  function executeLDC1(i){
    cpu1.store_u64( ft(i), n64js.readMemory32( memaddr(i)+4 ), n64js.readMemory32( memaddr(i)+0 ) );
  }
  function executeLDC2(i)       { unimplemented(cpu0.pc,i); }

  function executeLWL(i) {
    var address         = memaddr(i)>>>0;
    var address_aligned = (address & ~3)>>>0;
    var memory          = n64js.readMemory32(address_aligned);
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
    var memory          = n64js.readMemory32(address_aligned);
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


  function executeSB(i) {
    n64js.writeMemory8(memaddr(i), cpu0.gprLo[rt(i)] & 0xff );
  }
  function executeSH(i) {
    n64js.writeMemory16(memaddr(i), cpu0.gprLo[rt(i)] & 0xffff );
  }
  function executeSW(i) {
    n64js.writeMemory32(memaddr(i), cpu0.gprLo[rt(i)]);
  }
  function executeSD(i) {
    n64js.writeMemory32( memaddr(i) + 0, cpu0.gprHi[rt(i)] );
    n64js.writeMemory32( memaddr(i) + 4, cpu0.gprLo[rt(i)] );
  }

  function executeSWC1(i) {
    n64js.writeMemory32( memaddr(i), cpu1.load_u32( ft(i) ) );
  }
  function executeSDC1(i) {
    n64js.writeMemory32( memaddr(i) + 0, cpu1.load_u32hi( ft(i) ) );
    n64js.writeMemory32( memaddr(i) + 4, cpu1.load_u32(   ft(i) ) );
  }

  function executeSDC2(i)       { unimplemented(cpu0.pc,i); }

  function executeSWL(i) {
    var address         = memaddr(i);
    var address_aligned = (address & ~3)>>>0;
    var memory          = n64js.readMemory32(address_aligned);
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
    var memory          = n64js.readMemory32(address_aligned);
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

  function executeCACHE(i) {
    // ignore!
  }

  function executeLL(i)         { unimplemented(cpu0.pc,i); }
  function executeLLD(i)        { unimplemented(cpu0.pc,i); }
  function executeSC(i)         { unimplemented(cpu0.pc,i); }
  function executeSCD(i)        { unimplemented(cpu0.pc,i); }

  function executeMFC1(i) {
    setSignExtend( rt(i), cpu1.load_u32( fs(i) ) );
  }
  function executeDMFC1(i) {
    cpu0.gprLo[rt(i)] = cpu1.load_u32( fs(i) );
    cpu0.gprHi[rt(i)] = cpu1.load_u32hi( fs(i) );
    n64js.halt('DMFC1');
  }
  function executeMTC1(i) {
    cpu1.store_u32( fs(i), cpu0.gprLo[rt(i)] );
  }
  function executeDMTC1(i) {
    cpu1.store_u64( fs(i), cpu0.gprLo[rt(i)], cpu0.gprHi[rt(i)] );
    n64js.halt('DMTC1');
  }

  function executeCFC1(i) {
    var r = fs(i);
    switch(r) {
      case 0:
      case 31:
        setSignExtend( rt(i), cpu1.control[r] );
        break;
    }
  }
  function executeCTC1(i) {
    var r = fs(i);
    if (r == 31) {
      var v = cpu0.gprLo[rt(i)];

      /*
      switch (v & FPCSR_RM_MASK) {
      case FPCSR_RM_RN:     n64js.log('cop1 - setting round near');  break;
      case FPCSR_RM_RZ:     n64js.log('cop1 - setting round zero');  break;
      case FPCSR_RM_RP:     n64js.log('cop1 - setting round ceil');  break;
      case FPCSR_RM_RM:     n64js.log('cop1 - setting round floor'); break;
      }
      */

      cpu1.control[r] = v;

    }
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

  function trunc(x) {
    return x < 0 ? Math.ceil(x) : Math.floor(x);
  }

  function executeSInstr(i) {

    switch(cop1_func(i)) {
      case 0x00:    cpu1.store_f32( fd(i), cpu1.load_f32( fs(i) ) + cpu1.load_f32( ft(i) ) ); return;
      case 0x01:    cpu1.store_f32( fd(i), cpu1.load_f32( fs(i) ) - cpu1.load_f32( ft(i) ) ); return;
      case 0x02:    cpu1.store_f32( fd(i), cpu1.load_f32( fs(i) ) * cpu1.load_f32( ft(i) ) ); return;
      case 0x03:    cpu1.store_f32( fd(i), cpu1.load_f32( fs(i) ) / cpu1.load_f32( ft(i) ) ); return;
      case 0x04:    cpu1.store_f32( fd(i), Math.sqrt( cpu1.load_f32( fs(i) ) ) ); return;
      case 0x05:    cpu1.store_f32( fd(i), Math.abs(  cpu1.load_f32( fs(i) ) ) ); return;
      case 0x06:    cpu1.store_f32( fd(i),  cpu1.load_f32( fs(i) ) ); return;
      case 0x07:    cpu1.store_f32( fd(i), -cpu1.load_f32( fs(i) )  ); return;
      case 0x08:    /* 'ROUND.L.'*/     unimplemented(cpu0.pc,i); return;
      case 0x09:    /* 'TRUNC.L.'*/     unimplemented(cpu0.pc,i); return;
      case 0x0a:    /* 'CEIL.L.'*/      unimplemented(cpu0.pc,i); return;
      case 0x0b:    /* 'FLOOR.L.'*/     unimplemented(cpu0.pc,i); return;
      case 0x0c:    /* 'ROUND.W.'*/     cpu1.store_s32( fd(i), Math.round( cpu1.load_f32( fs(i) ) ) ); return;  // TODO: check this
      case 0x0d:    /* 'TRUNC.W.'*/     cpu1.store_s32( fd(i),      trunc( cpu1.load_f32( fs(i) ) ) ); return;
      case 0x0e:    /* 'CEIL.W.'*/      cpu1.store_s32( fd(i), Math.ceil(  cpu1.load_f32( fs(i) ) ) ); return;
      case 0x0f:    /* 'FLOOR.W.'*/     cpu1.store_s32( fd(i), Math.floor( cpu1.load_f32( fs(i) ) ) ); return;

      case 0x20:    /* 'CVT.S' */       unimplemented(cpu0.pc,i); return;
      case 0x21:    /* 'CVT.D' */       cpu1.store_f64( fd(i), cpu1.load_f32( fs(i) ) ); return;
      case 0x24:    /* 'CVT.W' */       cpu1.store_s32( fd(i), Math.floor( cpu1.load_f32( fs(i) ) ) ); return;  // FIXME: apply correct conversion mode
      case 0x25:    /* 'CVT.L' */       unimplemented(cpu0.pc,i); return;
      case 0x30:    /* 'C.F' */         cpu1.setCondition( false );; return;
      case 0x31:    /* 'C.UN' */        unimplemented(cpu0.pc,i); return;
      case 0x32:    /* 'C.EQ' */        cpu1.setCondition( cpu1.load_f32( fs(i) ) == cpu1.load_f32( ft(i) ) ); return;
      case 0x33:    /* 'C.UEQ' */       unimplemented(cpu0.pc,i); return;
      case 0x34:    /* 'C.OLT' */       unimplemented(cpu0.pc,i); return;
      case 0x35:    /* 'C.ULT' */       unimplemented(cpu0.pc,i); return;
      case 0x36:    /* 'C.OLE' */       unimplemented(cpu0.pc,i); return;
      case 0x37:    /* 'C.ULE' */       unimplemented(cpu0.pc,i); return;
      case 0x38:    /* 'C.SF' */        cpu1.setCondition( false );; return;
      case 0x39:    /* 'C.NGLE' */      unimplemented(cpu0.pc,i); return;
      case 0x3a:    /* 'C.SEQ' */       unimplemented(cpu0.pc,i); return;
      case 0x3b:    /* 'C.NGL' */       cpu1.setCondition( cpu1.load_f32( fs(i) ) == cpu1.load_f32( ft(i) ) ); return;
      case 0x3c:    /* 'C.LT' */        cpu1.setCondition( cpu1.load_f32( fs(i) ) < cpu1.load_f32( ft(i) ) ); return;
      case 0x3d:    /* 'C.NGE' */       unimplemented(cpu0.pc,i); return;
      case 0x3e:    /* 'C.LE' */        cpu1.setCondition( cpu1.load_f32( fs(i) ) <= cpu1.load_f32( ft(i) ) ); return;
      case 0x3f:    /* 'C.NGT' */       cpu1.setCondition( cpu1.load_f32( fs(i) ) <= cpu1.load_f32( ft(i) ) ); return;
    }

    unimplemented(cpu0.pc,i);
  }

  function executeDInstr(i) {

    switch(cop1_func(i)) {
      case 0x00:    cpu1.store_f64( fd(i), cpu1.load_f64( fs(i) ) + cpu1.load_f64( ft(i) ) ); return;
      case 0x01:    cpu1.store_f64( fd(i), cpu1.load_f64( fs(i) ) - cpu1.load_f64( ft(i) ) ); return;
      case 0x02:    cpu1.store_f64( fd(i), cpu1.load_f64( fs(i) ) * cpu1.load_f64( ft(i) ) ); return;
      case 0x03:    cpu1.store_f64( fd(i), cpu1.load_f64( fs(i) ) / cpu1.load_f64( ft(i) ) ); return;
      case 0x04:    cpu1.store_f64( fd(i), Math.sqrt( cpu1.load_f64( fs(i) ) ) ); return;
      case 0x05:    cpu1.store_f64( fd(i), Math.abs(  cpu1.load_f64( fs(i) ) ) ); return;
      case 0x06:    cpu1.store_f64( fd(i),  cpu1.load_f64( fs(i) ) ); return;
      case 0x07:    cpu1.store_f64( fd(i), -cpu1.load_f64( fs(i) )  ); return;
      case 0x08:    /* 'ROUND.L.'*/     unimplemented(cpu0.pc,i); return;
      case 0x09:    /* 'TRUNC.L.'*/     unimplemented(cpu0.pc,i); return;
      case 0x0a:    /* 'CEIL.L.'*/      unimplemented(cpu0.pc,i); return;
      case 0x0b:    /* 'FLOOR.L.'*/     unimplemented(cpu0.pc,i); return;
      case 0x0c:    /* 'ROUND.W.'*/     cpu1.store_s32( fd(i), Math.round( cpu1.load_f64( fs(i) ) ) ); return;  // TODO: check this
      case 0x0d:    /* 'TRUNC.W.'*/     cpu1.store_s32( fd(i),      trunc( cpu1.load_f64( fs(i) ) ) ); return;
      case 0x0e:    /* 'CEIL.W.'*/      cpu1.store_s32( fd(i), Math.ceil(  cpu1.load_f64( fs(i) ) ) ); return;
      case 0x0f:    /* 'FLOOR.W.'*/     cpu1.store_s32( fd(i), Math.floor( cpu1.load_f64( fs(i) ) ) ); return;

      case 0x20:    /* 'CVT.S' */       cpu1.store_f32( fd(i), cpu1.load_f64( fs(i) ) ); return;
      case 0x21:    /* 'CVT.D' */       unimplemented(cpu0.pc,i); return;
      case 0x24:    /* 'CVT.W' */       cpu1.store_s32( fd(i), Math.floor( cpu1.load_f64( fs(i) ) ) ); return;  // FIXME: apply correct conversion mode
      case 0x25:    /* 'CVT.L' */       unimplemented(cpu0.pc,i); return;
      case 0x30:    /* 'C.F' */         cpu1.setCondition( false );; return;
      case 0x31:    /* 'C.UN' */        unimplemented(cpu0.pc,i); return;
      case 0x32:    /* 'C.EQ' */        cpu1.setCondition( cpu1.load_f64( fs(i) ) == cpu1.load_f64( ft(i) ) ); return;
      case 0x33:    /* 'C.UEQ' */       unimplemented(cpu0.pc,i); return;
      case 0x34:    /* 'C.OLT' */       unimplemented(cpu0.pc,i); return;
      case 0x35:    /* 'C.ULT' */       unimplemented(cpu0.pc,i); return;
      case 0x36:    /* 'C.OLE' */       unimplemented(cpu0.pc,i); return;
      case 0x37:    /* 'C.ULE' */       unimplemented(cpu0.pc,i); return;
      case 0x38:    /* 'C.SF' */        cpu1.setCondition( false );; return;
      case 0x39:    /* 'C.NGLE' */      unimplemented(cpu0.pc,i); return;
      case 0x3a:    /* 'C.SEQ' */       unimplemented(cpu0.pc,i); return;
      case 0x3b:    /* 'C.NGL' */       cpu1.setCondition( cpu1.load_f64( fs(i) ) == cpu1.load_f64( ft(i) ) ); return;
      case 0x3c:    /* 'C.LT' */        cpu1.setCondition( cpu1.load_f64( fs(i) ) < cpu1.load_f64( ft(i) ) ); return;
      case 0x3d:    /* 'C.NGE' */       unimplemented(cpu0.pc,i); return;
      case 0x3e:    /* 'C.LE' */        cpu1.setCondition( cpu1.load_f64( fs(i) ) <= cpu1.load_f64( ft(i) ) ); return;
      case 0x3f:    /* 'C.NGT' */       cpu1.setCondition( cpu1.load_f64( fs(i) ) <= cpu1.load_f64( ft(i) ) ); return;
    }

    unimplemented(cpu0.pc,i);
  }

  function executeWInstr(i) {
    switch(cop1_func(i)) {
      case 0x20:    cpu1.store_f32( fd(i), cpu1.load_s32( fs(i) ) ); return;
      case 0x21:    cpu1.store_f64( fd(i), cpu1.load_s32( fs(i) ) ); return;
    }
    unimplemented(cpu0.pc,i);
  }
  function executeLInstr(i)     { unimplemented(cpu0.pc,i); }

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
    executeUnknown,       executeUnknown,       executeUnknown,     executeUnknown,
  ];
  if (cop0Table.length != 32) {
    throw "Oops, didn't build the cop0 table correctly";
  }
  function executeCop0(i) {
    var fmt = (i>>21) & 0x1f;
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
    executeUnknown,       executeUnknown,       executeUnknown,     executeUnknown,
  ];
  if (cop1Table.length != 32) {
    throw "Oops, didn't build the cop1 table correctly";
  }
  function executeCop1(i) {
    //n64js.assert( (cpu0.control[cpu0.kControlSR] & SR_CU1) !== 0, "SR_CU1 in inconsistent state" );

    var fmt = (i>>21) & 0x1f;
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
    executeUnknown,       executeUnknown,       executeUnknown,     executeUnknown,
  ];
  if (regImmTable.length != 32) {
    throw "Oops, didn't build the special table correctly";
  }  

  function executeRegImm(i) {
    var rt = (i >> 16) & 0x1f;
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
    executeSC,            executeSWC1,          executeUnknown,     executeUnknown,
    executeSCD,           executeSDC1,          executeSDC2,        executeSD,
  ];
  if (simpleTable.length != 64) {
    throw "Oops, didn't build the simple table correctly";
  }

  function executeOp(i) {
    var opcode = (i >> 26) & 0x3f;

    return simpleTable[opcode](i);
  }

  function checkCauseIP3Consistent() {
    var mi_interrupt_set = n64js.miInterruptsUnmasked();
    var cause_int_3_set  = (cpu0.control[cpu0.kControlCause] & CAUSE_IP3) !== 0;
    n64js.assert(mi_interrupt_set === cause_int_3_set, 'CAUSE_IP3 inconsistent with MI_INTR_REG');
  }

  n64js.step = function () {
    n64js.run(1);
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

  function checkSyncState(sync) {

    var sync_a = sync.pop();
    var sync_b = sync.pop();
    var sync_c = sync.pop();
    var sync_d = sync.pop();

    if (checkOOS(cpu0.pc, sync_a, 'pc'))
      return false;

    var next_vbl = 0;
    for( var i = 0; i < cpu0.events.length; ++i )
    {
      var event = cpu0.events[i];
      next_vbl += event.countdown;
      if (event.type === kEventVbl){
        next_vbl = next_vbl*2+1;
        break;
      } else if (event.type == kEventCompare) {
        next_vbl = next_vbl*2;
        break;
      }
    }

    if (checkOOS(next_vbl, sync_b, 'event'))
      return false;

    if (0) {
      var a = 0;
      var b = 0;
      for (var i = 0; i < 16; ++i) {
        a = mix(a,cpu0.gprLo[i], 0);
        b = mix(b,cpu0.gprLo[i+16], 0);
      }
      a = (a&0xffffffff)>>>0;
      b = (b&0xffffffff)>>>0;

      if (checkOOS(a, sync_c, 't1'))
        return false;
      if (checkOOS(b, sync_d, 'r16-r31'))
        return false;
    }

    if(0) {
      if (checkOOS(cpu0.multLo[0], sync_c, 'multlo'))
        return false;
      if (checkOOS(cpu0.multHi[0], sync_d, 'multhi'))
        return false;
    }

    if(0) {
      if (checkOOS(cpu0.control[cpu0.kControlCount], sync_c, 'count'))
        return false;
      if (checkOOS(cpu0.control[cpu0.kControlCompare], sync_d, 'compare'))
        return false;
    }

    return true;
  }

  function checkOOS(a, b, msg) {
    if (a !== b) {
      n64js.halt(msg + ' mismatch: local ' + n64js.toString32(a) + ' remote ' + n64js.toString32(b));
      n64js.nukeSync();
      return true;
    }

    return false;
  }

  function handleCounter() {

    var breakout = false;

    while (cpu0.events.length > 0 && cpu0.events[0].countdown <= 0) {
      var evt = cpu0.events[0];
      cpu0.events.splice(0, 1);

      // if it's our cycles event then just bail
      if (evt.type === kEventRunForCycles) {
        breakout = true;
      } else if (evt.type === kEventCompare) {
        cpu0.control[cpu0.kControlCause] |= CAUSE_IP8;
        if (cpu0.checkForUnmaskedInterrupts()) {
          cpu0.stuffToDo |= kStuffToDoCheckInterrupts;
        }
        breakout = true;
      } else if (evt.type === kEventVbl) {
        // FIXME: this should be based on VI_V_SYNC_REG
        cpu0.addEvent(kEventVbl, kVIIntrCycles);

        n64js.verticalBlank();

        breakout = true;
      } else {
        n64js.halt('unhandled event!');
      }
    }

    return breakout;
  }

  n64js.run = function (cycles) {

    cpu0.stuffToDo &= ~kStuffToDoHalt;

    checkCauseIP3Consistent();
    n64js.checkSIStatusConsistent();

    var COUNTER_INCREMENT_PER_OP = 1;

    cpu0.addEvent(kEventRunForCycles, cycles);

    //var sync = n64js.getSync();

    try {
      while (cpu0.hasEvent(kEventRunForCycles)) {
        while (!cpu0.stuffToDo) {

          //if (sync) {
          //  if (!checkSyncState(sync))
          //    break;
          //}

          cpu0.nextPC       = cpu0.delayPC ? cpu0.delayPC : cpu0.pc + 4;
          cpu0.branchTarget = 0;

          var instruction = n64js.readMemory32(cpu0.pc);
          executeOp(instruction);

          cpu0.pc      = cpu0.nextPC;
          cpu0.delayPC = cpu0.branchTarget;

          //checkCauseIP3Consistent();
          //n64js.checkSIStatusConsistent();
          cpu0.control[cpu0.kControlCount] += COUNTER_INCREMENT_PER_OP;
          ++cpu0.opsExecuted;

          var evt = cpu0.events[0];
          evt.countdown -= COUNTER_INCREMENT_PER_OP;
          if (evt.countdown <= 0)
          {
            if (handleCounter())
              break;
          }
        }

        if (cpu0.stuffToDo & kStuffToDoCheckInterrupts) {
          cpu0.stuffToDo &= ~kStuffToDoCheckInterrupts;
          cpu0.handleInterrupt();
        } else if (cpu0.stuffToDo & kStuffToDoHalt) {
          break;
        } else if (cpu0.stuffToDo) {
          n64js.warn("Don't know how to handle this event!");
          break;
        }
      }

    } catch (e) {
      n64js.halt('Exception :' + e);
    }

    // Clean up any kEventRunForCycles events before we bail out
    cpu0.removeEventsOfType(kEventRunForCycles);
  }

})();