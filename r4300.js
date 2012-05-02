if (typeof n64js === 'undefined') {
  var n64js = {};
}

(function () {'use strict';


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

  var kEventCompare      = 0;
  var kEventRunForCycles = 1;

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
      n64js.log('TLB update: index=' + index +
                ', pagemask=' + n64js.toString32(pagemask) +
                ', entryhi='  + n64js.toString32(hi) +
                ', entrylo0=' + n64js.toString32(entrylo0) +
                ', entrylo1=' + n64js.toString32(entrylo1)
              );

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
        case TLBPGMASK_4K:
          n64js.log('       4k Pagesize');
          this.checkbit = 0x00001000;   // bit 12
          break;
        case TLBPGMASK_16K:
          n64js.log('       16k Pagesize');
          this.checkbit = 0x00004000;   // bit 14
          break;
        case TLBPGMASK_64K:
          n64js.log('       64k Pagesize');
          this.checkbit = 0x00010000;   // bit 16
          break;
        case TLBPGMASK_256K:
          n64js.log('       256k Pagesize');
          this.checkbit = 0x00040000;   // bit 18
          break;
        case TLBPGMASK_1M:
          n64js.log('       1M Pagesize');
          this.checkbit = 0x00100000;   // bit 20
          break;
        case TLBPGMASK_4M:
          n64js.log('       4M Pagesize');
          this.checkbit = 0x00400000;   // bit 22
          break;
        case TLBPGMASK_16M:
          n64js.log('       16M Pagesize');
          this.checkbit = 0x01000000;   // bit 24
          break;
        default: // should not happen!
          n64js.log('       Unknown Pagesize');
          this.checkbit = 0;
          break;
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

    this.reset = function () {

      for (var i = 0; i < 32; ++i) {
        this.gprLo[i]   = 0;
        this.gprHi[i]   = 0;
        this.control[i] = 0;
      }

      this.pc          = 0;
      this.delayPC     = 0;

      this.stuffToDo   = 0;

      this.events      = [];

      this.multLo[0]   = this.multLo[1] = 0;
      this.multHi[0]   = this.multHi[1] = 0;

      this.opsExecuted = 0;

      this.control[this.kControlRand]   = 32-1;
      this.control[this.kControlSR]     = 0x70400004;
      this.control[this.kControlConfig] = 0x0006e463;
    };

    this.halt = function () {
      this.stuffToDo |= kStuffToDoHalt;
    }

    this.updateCause3 = function () {
      var interrupts_masked = (n64js.mi_reg.read32(MI_INTR_MASK_REG) & n64js.mi_reg.read32(MI_INTR_REG)) === 0;
      if (interrupts_masked) {
        this.control[this.kControlCause] &= ~CAUSE_IP3;
      } else {
        this.control[this.kControlCause] |=  CAUSE_IP3;

        if (this.checkForUnmaskedInterrupts()) {
          this.stuffToDo |= kStuffToDoCheckInterrupts;
        }
      }

      checkCauseIP3Consistent();
    }

    this.setSR = function (value) {
      var old_value = this.control[this.kControlSR];
      if ((old_value & SR_FR) !== (value & SR_FR)) {
        n64js.log('Changing FPU to ' + ((value & SR_FR) ? '64bit' : '32bit' ));
      }

      this.control[this.kControlSR] = value;

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

    this.handleInterrupt = function () {
      if (this.checkForUnmaskedInterrupts()) {
          this.setException( CAUSE_EXCMASK, EXC_INT );
          this.jumpToInterruptVector( E_VEC );
      } else {
        n64js.assert(false, "Was expecting an unmasked interrupt - something wrong with kStuffToDoCheckInterrupts?");
      }
    }

    this.setException = function (mask, exception) {
      this.control[this.kControlCause] &= ~mask;
      this.control[this.kControlCause] |= exception
    }

    this.jumpToInterruptVector = function (vec) {
      this.control[this.kControlSR]  |= SR_EXL;
      this.control[this.kControlEPC]  = this.pc;
      if (this.delayPC) {
        this.control[this.kControlCause] |= CAUSE_BD;
        this.control[this.kControlEPC]   -= 4;
      } else {
        this.control[this.kControlCause] &= ~CAUSE_BD;
      }

      this.pc      = vec;
      this.delayPC = 0;
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

      n64js.log('TLB Read Index ' + n64js.toString8(index) + '.');
      n64js.log('  PageMask: ' + n64js.toString32(this.control[this.kControlPageMask]));
      n64js.log('  EntryHi:  ' + n64js.toString32(this.control[this.kControlEntryHi]));
      n64js.log('  EntryLo0: ' + n64js.toString32(this.control[this.kControlEntryLo0]));
      n64js.log('  EntryLo1: ' + n64js.toString32(this.control[this.kControlEntryLo1]));
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
            n64js.log('TLB Probe. EntryHi:' + n64js.toString32(entryhi) + '. Found matching TLB entry - ' + n64js.toString8(i));
            this.control[this.kControlIndex] = i;
            return;
          }
        }
      }

      n64js.log('TLB Probe. EntryHi:' + n64js.toString32(entryhi) + ". Didn't find matching entry");
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
          } else {
            n64js.halt('Translated ' + n64js.toString32(address) + ' to ' + n64js.toString32(physical_addr));
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

    this.mem     = new ArrayBuffer(32 * 4 * 2);   // 32 64-bit regs
    this.float32 = new Float32Array(this.mem);
    this.float64 = new Float64Array(this.mem);
    this.int32   = new Int32Array(this.mem);
    this.uint32  = new Uint32Array(this.mem);

    this.reset = function () {

      for (var i = 0; i < 32; ++i) {
        this.control[i] = 0;

        this.int32[i*2+0] = 0;
        this.int32[i*2+1] = 0;
      }

      this.control[0] = 0x00000511;
    }

    this.store_u32 = function (i, v) {
      this.uint32[i*2+0] = v;
    }
    this.store_u64 = function (i, lo, hi) {
      this.uint32[i*2+0] = lo;
      this.uint32[i*2+1] = hi;
    }

    this.load_u32 = function (i) {
      return this.uint32[i*2+0];
    }
    this.load_u32hi = function (i) {
      return this.uint32[i*2+1];
    }
    this.load_s32 = function (i) {
      return this.int32[i*2+0];
    }
    this.load_f32 = function (i) {
      return this.float32[i*2+0];
    }


    this.store_s32 = function(i, v) {
      this.int32[i*2+0] = v;
    }
    this.store_f32 = function(i, v) {
      this.float32[i*2+0] = v;
    }
    this.store_f64 = function(i, v) {
      this.float64[i] = v;
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
    arr[0] = v; //(v&0xffffffff) >>> 0; -- is this necessary?
    arr[1] = (v&0x80000000) ? 0xffffffff : 0x00000000;
  }
  function setHiLoZeroExtend(arr, v) {
    arr[0] = v; //(v&0xffffffff) >>> 0; -- is this necessary?
    arr[1] = 0x00000000;
  }

  function getHi32(v) {
    // >>32 just seems to no-op? Argh.
    return (v>>>16)>>>16;
  }
  function getLo32(v) {
    return (v&0xffffffff)>>>0;
  }

  function unimplemented(a,i) {
    var r = n64js.disassembleOp(a,i);
    var e = 'Unimplemented op ' + n64js.toString32(i) + ' : ' + r.disassembly + '<br>';

    $('#output').append(e);
    throw e;
  }

  function executeUnknown(a,i) {
    throw 'Unknown op: ' + n64js.toString32(a) + ', ' + n64js.toString32(i);
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

  function executeDSLLV(a,i)      { unimplemented(a,i); }
  function executeDSRLV(a,i)      { unimplemented(a,i); }
  function executeDSRAV(a,i)      { unimplemented(a,i); }

  function executeDSLL(a,i)       { unimplemented(a,i); }
  function executeDSRL(a,i)       { unimplemented(a,i); }
  function executeDSRA(a,i)       { unimplemented(a,i); }

  function executeDSLL32(a,i) {
    cpu0.gprLo[rd(i)] = 0;
    cpu0.gprHi[rd(i)] = cpu0.gprLo[rt(i)] << sa(i);
  }
  function executeDSRL32(a,i) {
    setZeroExtend( rd(i), cpu0.gprHi[rt(i)] >>> sa(i) );
  }
  function executeDSRA32(a,i) {
    setSignExtend( rd(i), cpu0.gprHi[rt(i)] >> sa(i) );
  }


  function executeSYSCALL(a,i)    { unimplemented(a,i); }
  function executeBREAK(a,i)      { unimplemented(a,i); }
  function executeSYNC(a,i)       { unimplemented(a,i); }



  function executeMFHI(a,i) {
    cpu0.gprHi[rd(i)] = cpu0.multHi[1]; 
    cpu0.gprLo[rd(i)] = cpu0.multHi[0]; 
  }
  function executeMFLO(a,i) {
    cpu0.gprHi[rd(i)] = cpu0.multLo[1]; 
    cpu0.gprLo[rd(i)] = cpu0.multLo[0]; 
  }
  function executeMTHI(a,i) {
    cpu0.multHi[0] = cpu0.gprLo[rs(i)];
    cpu0.multHi[1] = cpu0.gprHi[rs(i)];
  }
  function executeMTLO(a,i)  {
    cpu0.multLo[0] = cpu0.gprLo[rs(i)];
    cpu0.multLo[1] = cpu0.gprHi[rs(i)];
  }

  function executeMULT(a,i) {
    var result = cpu0.gprLo_signed[rs(i)] * cpu0.gprLo_signed[rt(i)];   // needs to be 64-bit!
    setHiLoSignExtend( cpu0.multLo, getLo32(result) );
    setHiLoSignExtend( cpu0.multHi, getHi32(result) );
  }
  function executeMULTU(a,i) {
    var result = cpu0.gprLo[rs(i)] * cpu0.gprLo[rt(i)];   // needs to be 64-bit!
    setHiLoSignExtend( cpu0.multLo, getLo32(result) );
    setHiLoSignExtend( cpu0.multHi, getHi32(result) );
  }
  function executeDMULT(a,i) {
    var result = cpu0.gprLo_signed[rs(i)] * cpu0.gprLo_signed[rt(i)];   // needs to be 64-bit!
    cpu0.multLo[0] = getLo32(result);
    cpu0.multLo[1] = getHi32(result);
    cpu0.multHi[0] = 0;
    cpu0.multHi[1] = 0;
  }
  function executeDMULTU(a,i) {
    var result = cpu0.gprLo[rs(i)] * cpu0.gprLo[rt(i)];   // needs to be 64-bit!
    cpu0.multLo[0] = getLo32(result);
    cpu0.multLo[1] = getHi32(result);
    cpu0.multHi[0] = 0;
    cpu0.multHi[1] = 0;
  }

  function executeDIV(a,i) {
    var dividend = cpu0.gprLo_signed[rs(i)];
    var divisor  = cpu0.gprLo_signed[rt(i)];
    if (divisor) {
      setHiLoSignExtend( cpu0.multLo, Math.floor(dividend / divisor) );
      setHiLoSignExtend( cpu0.multHi, dividend % divisor );
    }
  }
  function executeDIVU(a,i) {
    var dividend = cpu0.gprLo_signed[rs(i)];
    var divisor  = cpu0.gprLo_signed[rt(i)];
    if (divisor) {
      setHiLoSignExtend( cpu0.multLo, Math.floor(dividend / divisor) );
      setHiLoSignExtend( cpu0.multHi, dividend % divisor );
    }
  }

  function executeDDIV(a,i) {

    var s = rs(i);
    var t = rt(i);

    if ((cpu0.gprHi[s] + (cpu0.gprLo[s] >>> 31) +
         cpu0.gprHi[t] + (cpu0.gprLo[t] >>> 31)) === 0) {
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
  function executeDDIVU(a,i) {

    var s = rs(i);
    var t = rt(i);

    if ((cpu0.gprHi[s] | cpu0.gprHi[t]) !== 0) {
      n64js.halt('Full 64 bit division not handled!');
    } else {
      var dividend = cpu0.gprLo[s];
      var divisor  = cpu0.gprLo[t];
      if (divisor) {
        setHiLoZeroExtend( cpu0.multLo, Math.floor(dividend / divisor) );
        setHiLoZeroExtend( cpu0.multHi, dividend % divisor );
      }
    }
  }

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


  // ffffffff fffffff0    // -16          false
  // ffffffff 00000001    // -4294967295

  // 00000000 fffffff0    // 4294967280   false
  // 00000000 00000001    // 1

  // 00000000 fffffff0    // 4294967280
  // ffffffff 00000001    // -4294967295  false

  // ffffffff fffffff0    // -16  true
  // 00000000 00000001    // 1

  function executeSLT(a,i) {
    var r = 0;
    if (cpu0.gprHi_signed[rs(i)] < cpu0.gprHi_signed[rt(i)]) {
      r = 1;
    } else if (cpu0.gprHi_signed[rs(i)] === cpu0.gprHi_signed[rt(i)]) {
      r = cpu0.gprLo[rs(i)] < cpu0.gprLo[rt(i)];
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

  var MI_INTR_REG         = 0x08;
  var MI_INTR_MASK_REG    = 0x0C;

  function executeMFC0(a,i) {
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

  function executeMTC0(a,i) {
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

      default:
        cpu0.control[control_reg] = new_value;
        n64js.log('Write to cpu0 control register. ' + n64js.toString32(new_value) + ' --> ' + n64js.cop0ControlRegisterNames[control_reg] );
        break;
    }
  }
  function executeTLB(a,i) {
     switch(tlbop(i)) {
       case 0x01:    cpu0.tlbRead();        return;
       case 0x02:    cpu0.tlbWriteIndex();  return;
       case 0x06:    cpu0.tlbWriteRandom(); return;
       case 0x08:    cpu0.tlbProbe();       return;
       case 0x18:    executeERET(a,i);      return;
     }
     executeUnknown(a,i);
  }


  function executeERET(a,i) {
    if (cpu0.control[cpu0.kControlSR] & SR_ERL) {
      cpu0.pc = cpu0.control[cpu0.kControlErrorEPC]-4;    // -4 is to compensate for post-inc in interpreter loop
      cpu0.control[cpu0.kControlSR] &= ~SR_ERL;
      n64js.log('ERET from error trap - ' + cpu0.pc);
    } else {
      cpu0.pc = cpu0.control[cpu0.kControlEPC]-4;         // -4 is to compensate for post-inc in interpreter loop
      cpu0.control[cpu0.kControlSR] &= ~SR_EXL;
      n64js.log('ERET from interrupt/exception ' + cpu0.pc);
    }
  }

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
    var s = rs(i);
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
    var s         = rs(i);
    var t         = rt(i);

    var immediate = imms(i);
    var imm_hi    = immediate >> 31;
    var s_hi      = cpu0.gprHi_signed[s];

    if (s_hi === imm_hi) {
      cpu0.gprLo[t] = cpu0.gprLo[s] < (immediate>>>0);    // NB signed compare
    } else {
      cpu0.gprLo[t] = s_hi < imm_hi;
      n64js.halt('SLTI upper diff');
    }
    cpu0.gprHi[t] = 0;
  }
  function executeSLTIU(a,i) {
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
  
  function executeDADDI(a,i)      { unimplemented(a,i); }
  function executeDADDIU(a,i)     { unimplemented(a,i); }

  function executeLB(a,i) {
    setSignExtend(rt(i), n64js.readMemory8( memaddr(i) ));
  }
  function executeLH(a,i) {
    setSignExtend(rt(i), n64js.readMemory16( memaddr(i) ));
  }
  function executeLW(a,i)         {
    // SF2049 requires this, apparently
    if (rt(i) == 0)
      return;
    setSignExtend(rt(i), n64js.readMemory32( memaddr(i) ));
  }

  function executeLBU(a,i) {
    setZeroExtend(rt(i), n64js.readMemory8( memaddr(i) ));
  }
  function executeLHU(a,i) {
    setZeroExtend(rt(i), n64js.readMemory16( memaddr(i) ));
  }
  function executeLWU(a,i) {
    setZeroExtend(rt(i), n64js.readMemory32( memaddr(i) ));
  }
  function executeLD(a,i) {
    cpu0.gprHi[rt(i)] = n64js.readMemory32( memaddr(i) + 0 );
    cpu0.gprLo[rt(i)] = n64js.readMemory32( memaddr(i) + 4 );
  }

  function executeLWC1(a,i) {
    cpu1.store_u32( ft(i), n64js.readMemory32( memaddr(i)) );
  }
  function executeLDC1(a,i){
    cpu1.store_u64( ft(i), n64js.readMemory32( memaddr(i)+4 ), n64js.readMemory32( memaddr(i)+0 ) );
  }
  function executeLDC2(a,i)       { unimplemented(a,i); }

  function executeSB(a,i) {
    n64js.writeMemory8(memaddr(i), cpu0.gprLo[rt(i)] & 0xff );
  }
  function executeSH(a,i) {
    n64js.writeMemory16(memaddr(i), cpu0.gprLo[rt(i)] & 0xffff );
  }
  function executeSW(a,i)         {
    n64js.writeMemory32(memaddr(i), cpu0.gprLo[rt(i)]);
  }
  function executeSD(a,i) {
    n64js.writeMemory32( memaddr(i) + 0, cpu0.gprHi[rt(i)] );
    n64js.writeMemory32( memaddr(i) + 4, cpu0.gprLo[rt(i)] );
  }

  function executeSWC1(a,i) {
    n64js.writeMemory32( memaddr(i), cpu1.load_u32( ft(i) ) );
  }
  function executeSDC1(a,i) {
    n64js.writeMemory32( memaddr(i) + 0, cpu1.load_u32hi( ft(i) ) );
    n64js.writeMemory32( memaddr(i) + 4, cpu1.load_u32(   ft(i) ) );
  }

  function executeSDC2(a,i)       { unimplemented(a,i); }

  function executeLWL(a,i)        { unimplemented(a,i); }
  function executeLWR(a,i)        { unimplemented(a,i); }
  function executeLDL(a,i)        { unimplemented(a,i); }
  function executeLDR(a,i)        { unimplemented(a,i); }

  function executeSWL(a,i)        { unimplemented(a,i); }
  function executeSWR(a,i)        { unimplemented(a,i); }
  function executeSDL(a,i)        { unimplemented(a,i); }
  function executeSDR(a,i)        { unimplemented(a,i); }

  function executeCACHE(a,i) {
    // ignore!
  }

  function executeLL(a,i)         { unimplemented(a,i); }
  function executeLLD(a,i)        { unimplemented(a,i); }
  function executeSC(a,i)         { unimplemented(a,i); }
  function executeSCD(a,i)        { unimplemented(a,i); }

  function executeMFC1(a,i) {
    setSignExtend( rt(i), cpu1.load_u32( fs(i) ) );
  }
  function executeDMFC1(a,i) {
    cpu0.gprLo[rt(i)] = cpu1.load_u32( fs(i) );
    cpu0.gprHi[rt(i)] = cpu1.load_u32hi( fs(i) );
    n64js.halt('DMFC1');
  }
  function executeMTC1(a,i) {
    cpu1.store_u32( fs(i), cpu0.gprLo[rt(i)] );
  }
  function executeDMTC1(a,i) {
    cpu1.store_u64( fs(i), cpu0.gprLo[rt(i)], cpu0.gprHi[rt(i)] );
    n64js.halt('DMTC1');
  }

  function executeCFC1(a,i) {
    var r = fs(i);
    switch(r) {
      case 0:
      case 31:
        setSignExtend( rt(i), cpu1.control[r] );
        break;
    }
  }
  function executeCTC1(a,i) {
    var r = fs(i);
    if (r == 31) {
      var v = cpu0.gprLo[rt(i)];

      switch (v & FPCSR_RM_MASK) {
      case FPCSR_RM_RN:     n64js.log('cop1 - setting round near');  break;
      case FPCSR_RM_RZ:     n64js.log('cop1 - setting round zero');  break;
      case FPCSR_RM_RP:     n64js.log('cop1 - setting round ceil');  break;
      case FPCSR_RM_RM:     n64js.log('cop1 - setting round floor'); break;
      }

      cpu1.control[r] = v;

    }
  }

  function executeBCInstr(a,i)    { unimplemented(a,i); }
  function executeSInstr(a,i) {

    switch(cop1_func(i)) {
      case 0x00:    cpu1.store_f32( fd(i), cpu1.load_f32( fs(i) ) + cpu1.load_f32( ft(i) ) ); return;
      case 0x01:    cpu1.store_f32( fd(i), cpu1.load_f32( fs(i) ) - cpu1.load_f32( ft(i) ) ); return;
      case 0x02:    cpu1.store_f32( fd(i), cpu1.load_f32( fs(i) ) * cpu1.load_f32( ft(i) ) ); return;
      case 0x03:    cpu1.store_f32( fd(i), cpu1.load_f32( fs(i) ) / cpu1.load_f32( ft(i) ) ); return;
      case 0x04:    cpu1.store_f32( fd(i), Math.sqrt( cpu1.load_f32( fs(i) ) ) ); return;
      case 0x05:    cpu1.store_f32( fd(i), Math.abs( cpu1.load_f32( fs(i) ) ) ); return;
      case 0x06:    cpu1.store_f32( fd(i),  cpu1.load_f32( fs(i) ) ); return;
      case 0x07:    cpu1.store_f32( fd(i), -cpu1.load_f32( fs(i) )  ); return;
      case 0x08:    /* 'ROUND.L.'*/     unimplemented(a,i); return;
      case 0x09:    /* 'TRUNC.L.'*/     unimplemented(a,i); return;
      case 0x0a:    /* 'CEIL.L.'*/      unimplemented(a,i); return;
      case 0x0b:    /* 'FLOOR.L.'*/     unimplemented(a,i); return;
      case 0x0c:    /* 'ROUND.W.'*/     unimplemented(a,i); return;
      case 0x0d:    /* 'TRUNC.W.'*/     unimplemented(a,i); return;
      case 0x0e:    /* 'CEIL.W.'*/      unimplemented(a,i); return;
      case 0x0f:    /* 'FLOOR.W.'*/     unimplemented(a,i); return;

      case 0x20:    /* 'CVT.S' */       unimplemented(a,i); return;
      case 0x21:    /* 'CVT.D' */       unimplemented(a,i); return;
      case 0x24:    /* 'CVT.W' */       cpu1.store_s32( fd(i), Math.floor( cpu1.load_f32( fs(i) ) ) ); return;  // FIXME: apply correct conversion mode
      case 0x25:    /* 'CVT.L' */       unimplemented(a,i); return;
      case 0x30:    /* 'C.F' */         unimplemented(a,i); return;
      case 0x31:    /* 'C.UN' */        unimplemented(a,i); return;
      case 0x32:    /* 'C.EQ' */        unimplemented(a,i); return;
      case 0x33:    /* 'C.UEQ' */       unimplemented(a,i); return;
      case 0x34:    /* 'C.OLT' */       unimplemented(a,i); return;
      case 0x35:    /* 'C.ULT' */       unimplemented(a,i); return;
      case 0x36:    /* 'C.OLE' */       unimplemented(a,i); return;
      case 0x37:    /* 'C.ULE' */       unimplemented(a,i); return;
      case 0x38:    /* 'C.SF' */        unimplemented(a,i); return;
      case 0x39:    /* 'C.NGLE' */      unimplemented(a,i); return;
      case 0x3a:    /* 'C.SEQ' */       unimplemented(a,i); return;
      case 0x3b:    /* 'C.NGL' */       unimplemented(a,i); return;
      case 0x3c:    /* 'C.LT' */        unimplemented(a,i); return;
      case 0x3d:    /* 'C.NGE' */       unimplemented(a,i); return;
      case 0x3e:    /* 'C.LE' */        unimplemented(a,i); return;
      case 0x3f:    /* 'C.NGT' */       unimplemented(a,i); return;
    }

    unimplemented(a,i);
  }
  function executeDInstr(a,i)     { unimplemented(a,i); }
  function executeWInstr(a,i) {
    switch(cop1_func(i)) {
      case 0x20:    cpu1.store_f32( fd(i), cpu1.load_s32( fs(i) ) ); return;
      case 0x21:    cpu1.store_f64( fd(i), cpu1.load_s32( fs(i) ) ); n64js.halt('cvt.d'); return;
    }
    unimplemented(a,i);
  }
  function executeLInstr(a,i)     { unimplemented(a,i); }

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
    throw "Oops, didn't build the cop0 table correctly";
  }
  function executeCop0(a,i) {
    var fmt = (i>>21) & 0x1f;
    return cop0Table[fmt](a,i);
  }

  var cop1Table = [
    executeMFC1,
    executeDMFC1,
    executeCFC1,
    executeUnknown,
    executeMTC1,
    executeDMTC1,
    executeCTC1,
    executeUnknown,
    executeBCInstr,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,

    executeSInstr,
    executeDInstr,
    executeUnknown,
    executeUnknown,
    executeWInstr,
    executeLInstr,
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
  if (cop1Table.length != 32) {
    throw "Oops, didn't build the cop1 table correctly";
  }
  function executeCop1(a,i) {
    var fmt = (i>>21) & 0x1f;
    return cop1Table[fmt](a, i);
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
    executeCop1,
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

  function checkCauseIP3Consistent() {
    var mi_interrupt_set = (n64js.mi_reg.read32(MI_INTR_MASK_REG) & n64js.mi_reg.read32(MI_INTR_REG)) !== 0;
    var cause_int_3_set  = (cpu0.control[cpu0.kControlCause] & CAUSE_IP3) !== 0;
    n64js.assert(mi_interrupt_set === cause_int_3_set, 'CAUSE_IP3 inconsistent with MI_INTR_REG');
  }

  n64js.step = function () {
    n64js.run(1);
  }

  n64js.run = function (cycles) {

    cpu0.stuffToDo &= ~kStuffToDoHalt;

    checkCauseIP3Consistent();

    var COUNTER_INCREMENT_PER_OP = 1;

    cpu0.addEvent(kEventRunForCycles, cycles+1);

    try {
      while (cpu0.hasEvent(kEventRunForCycles)) {
        while (!cpu0.stuffToDo) {

            cpu0.control[cpu0.kControlCount] += COUNTER_INCREMENT_PER_OP;

            var evt = cpu0.events[0];
            evt.countdown -= COUNTER_INCREMENT_PER_OP;
            if (evt.countdown <= 0)
            {
              // if it's our cucles event then just bail
              cpu0.events.splice(0, 1);
              if( evt.type === kEventRunForCycles ) {
                break;
              } else if (evt.type === kEventCompare) {
                n64js.halt('compare fired!');
                break;
              }
            }

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

            //checkCauseIP3Consistent();

            ++cpu0.opsExecuted;
        }

        if (cpu0.stuffToDo & kStuffToDoCheckInterrupts) {
          cpu0.stuffToDo &= ~kStuffToDoCheckInterrupts;
          cpu0.handleInterrupt();
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


    n64js.refreshDisplay();
  }

})();