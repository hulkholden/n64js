/*jshint jquery:true, browser:true, devel:true */
/*global Stats:false */

(function (n64js) {'use strict';

  var stats = null;

  var kCyclesPerUpdate = 100000000;

  var syncFlow;
  var syncInput;
  function initSync() {
    syncFlow  = undefined;//n64js.createSyncConsumer();
    syncInput = undefined;//n64js.createSyncConsumer();
  }
  n64js.getSyncFlow = function () {
    return syncFlow;
  };

  var kBootstrapOffset = 0x40;
  var kGameOffset      = 0x1000;

  var kOpBreakpoint = 58;

  var breakpoints = {};     // address -> original op

  var SP_MEM_ADDR_REG     = 0x00;
  var SP_DRAM_ADDR_REG    = 0x04;
  var SP_RD_LEN_REG       = 0x08;
  var SP_WR_LEN_REG       = 0x0C;
  var SP_STATUS_REG       = 0x10;
  var SP_DMA_FULL_REG     = 0x14;
  var SP_DMA_BUSY_REG     = 0x18;
  var SP_SEMAPHORE_REG    = 0x1C;

  var SP_CLR_HALT           = 0x0000001;
  var SP_SET_HALT           = 0x0000002;
  var SP_CLR_BROKE          = 0x0000004;
  var SP_CLR_INTR           = 0x0000008;
  var SP_SET_INTR           = 0x0000010;
  var SP_CLR_SSTEP          = 0x0000020;
  var SP_SET_SSTEP          = 0x0000040;
  var SP_CLR_INTR_BREAK     = 0x0000080;
  var SP_SET_INTR_BREAK     = 0x0000100;
  var SP_CLR_SIG0           = 0x0000200;
  var SP_SET_SIG0           = 0x0000400;
  var SP_CLR_SIG1           = 0x0000800;
  var SP_SET_SIG1           = 0x0001000;
  var SP_CLR_SIG2           = 0x0002000;
  var SP_SET_SIG2           = 0x0004000;
  var SP_CLR_SIG3           = 0x0008000;
  var SP_SET_SIG3           = 0x0010000;
  var SP_CLR_SIG4           = 0x0020000;
  var SP_SET_SIG4           = 0x0040000;
  var SP_CLR_SIG5           = 0x0080000;
  var SP_SET_SIG5           = 0x0100000;
  var SP_CLR_SIG6           = 0x0200000;
  var SP_SET_SIG6           = 0x0400000;
  var SP_CLR_SIG7           = 0x0800000;
  var SP_SET_SIG7           = 0x1000000;

  var SP_STATUS_HALT        = 0x0001;
  var SP_STATUS_BROKE       = 0x0002;
  var SP_STATUS_DMA_BUSY    = 0x0004;
  var SP_STATUS_DMA_FULL    = 0x0008;
  var SP_STATUS_IO_FULL     = 0x0010;
  var SP_STATUS_SSTEP       = 0x0020;
  var SP_STATUS_INTR_BREAK  = 0x0040;
  var SP_STATUS_SIG0        = 0x0080;
  var SP_STATUS_SIG1        = 0x0100;
  var SP_STATUS_SIG2        = 0x0200;
  var SP_STATUS_SIG3        = 0x0400;
  var SP_STATUS_SIG4        = 0x0800;
  var SP_STATUS_SIG5        = 0x1000;
  var SP_STATUS_SIG6        = 0x2000;
  var SP_STATUS_SIG7        = 0x4000;

  var SP_STATUS_YIELD       = SP_STATUS_SIG0;
  var SP_STATUS_YIELDED     = SP_STATUS_SIG1;
  var SP_STATUS_TASKDONE    = SP_STATUS_SIG2;

  // DP Command
  var DPC_START_REG         = 0x00;
  var DPC_END_REG           = 0x04;
  var DPC_CURRENT_REG       = 0x08;
  var DPC_STATUS_REG        = 0x0C;
  var DPC_CLOCK_REG         = 0x10;
  var DPC_BUFBUSY_REG       = 0x14;
  var DPC_PIPEBUSY_REG      = 0x18;
  var DPC_TMEM_REG          = 0x1C;

  var DPC_CLR_XBUS_DMEM_DMA = 0x0001;
  var DPC_SET_XBUS_DMEM_DMA = 0x0002;
  var DPC_CLR_FREEZE        = 0x0004;
  var DPC_SET_FREEZE        = 0x0008;
  var DPC_CLR_FLUSH         = 0x0010;
  var DPC_SET_FLUSH         = 0x0020;
  var DPC_CLR_TMEM_CTR      = 0x0040;
  var DPC_CLR_PIPE_CTR      = 0x0080;
  var DPC_CLR_CMD_CTR       = 0x0100;
  var DPC_CLR_CLOCK_CTR     = 0x0200;

  var DPC_STATUS_XBUS_DMEM_DMA = 0x001;
  var DPC_STATUS_FREEZE        = 0x002;
  var DPC_STATUS_FLUSH         = 0x004;
  var DPC_STATUS_START_GCLK    = 0x008;
  var DPC_STATUS_TMEM_BUSY     = 0x010;
  var DPC_STATUS_PIPE_BUSY     = 0x020;
  var DPC_STATUS_CMD_BUSY      = 0x040;
  var DPC_STATUS_CBUF_READY    = 0x080;
  var DPC_STATUS_DMA_BUSY      = 0x100;
  var DPC_STATUS_END_VALID     = 0x200;
  var DPC_STATUS_START_VALID   = 0x400;


  // DP Span
  var DPS_TBIST_REG        = 0x00;
  var DPS_TEST_MODE_REG    = 0x04;
  var DPS_BUFTEST_ADDR_REG = 0x08;
  var DPS_BUFTEST_DATA_REG = 0x0C;

  var DPS_TBIST_CHECK      = 0x01;
  var DPS_TBIST_GO         = 0x02;
  var DPS_TBIST_CLEAR      = 0x04;

  var DPS_TBIST_DONE      = 0x004;
  var DPS_TBIST_FAILED    = 0x7F8;

  // MIPS Interface
  var MI_MODE_REG         = 0x00;
  var MI_VERSION_REG      = 0x04;
  var MI_INTR_REG         = 0x08;
  var MI_INTR_MASK_REG    = 0x0C;

  var MI_CLR_INIT         = 0x0080;
  var MI_SET_INIT         = 0x0100;
  var MI_CLR_EBUS         = 0x0200;
  var MI_SET_EBUS         = 0x0400;
  var MI_CLR_DP_INTR      = 0x0800;
  var MI_CLR_RDRAM        = 0x1000;
  var MI_SET_RDRAM        = 0x2000;

  var MI_MODE_INIT        = 0x0080;
  var MI_MODE_EBUS        = 0x0100;
  var MI_MODE_RDRAM       = 0x0200;

  var MI_INTR_MASK_CLR_SP = 0x0001;
  var MI_INTR_MASK_SET_SP = 0x0002;
  var MI_INTR_MASK_CLR_SI = 0x0004;
  var MI_INTR_MASK_SET_SI = 0x0008;
  var MI_INTR_MASK_CLR_AI = 0x0010;
  var MI_INTR_MASK_SET_AI = 0x0020;
  var MI_INTR_MASK_CLR_VI = 0x0040;
  var MI_INTR_MASK_SET_VI = 0x0080;
  var MI_INTR_MASK_CLR_PI = 0x0100;
  var MI_INTR_MASK_SET_PI = 0x0200;
  var MI_INTR_MASK_CLR_DP = 0x0400;
  var MI_INTR_MASK_SET_DP = 0x0800;

  var MI_INTR_MASK_SP   = 0x01;
  var MI_INTR_MASK_SI   = 0x02;
  var MI_INTR_MASK_AI   = 0x04;
  var MI_INTR_MASK_VI   = 0x08;
  var MI_INTR_MASK_PI   = 0x10;
  var MI_INTR_MASK_DP   = 0x20;

  var MI_INTR_SP        = 0x01;
  var MI_INTR_SI        = 0x02;
  var MI_INTR_AI        = 0x04;
  var MI_INTR_VI        = 0x08;
  var MI_INTR_PI        = 0x10;
  var MI_INTR_DP        = 0x20;

  // Video Interface
  var VI_STATUS_REG     = 0x00;
  var VI_ORIGIN_REG     = 0x04;
  var VI_WIDTH_REG      = 0x08;
  var VI_INTR_REG       = 0x0C;
  var VI_CURRENT_REG    = 0x10;
  var VI_BURST_REG      = 0x14;
  var VI_V_SYNC_REG     = 0x18;
  var VI_H_SYNC_REG     = 0x1C;
  var VI_LEAP_REG       = 0x20;
  var VI_H_START_REG    = 0x24;
  var VI_V_START_REG    = 0x28;
  var VI_V_BURST_REG    = 0x2C;
  var VI_X_SCALE_REG    = 0x30;
  var VI_Y_SCALE_REG    = 0x34;

  var VI_CONTROL_REG        = VI_STATUS_REG;
  var VI_DRAM_ADDR_REG      = VI_ORIGIN_REG;
  var VI_H_WIDTH_REG        = VI_WIDTH_REG;
  var VI_V_INTR_REG         = VI_INTR_REG;
  var VI_V_CURRENT_LINE_REG = VI_CURRENT_REG;
  var VI_TIMING_REG         = VI_BURST_REG;
  var VI_H_SYNC_LEAP_REG    = VI_LEAP_REG;
  var VI_H_VIDEO_REG        = VI_H_START_REG;
  var VI_V_VIDEO_REG        = VI_V_START_REG;

  // Audio Interface
  var AI_DRAM_ADDR_REG  = 0x00;
  var AI_LEN_REG        = 0x04;
  var AI_CONTROL_REG    = 0x08;
  var AI_STATUS_REG     = 0x0C;
  var AI_DACRATE_REG    = 0x10;
  var AI_BITRATE_REG    = 0x14;

  // Peripheral Interface
  var PI_DRAM_ADDR_REG    = 0x00;
  var PI_CART_ADDR_REG    = 0x04;
  var PI_RD_LEN_REG       = 0x08;
  var PI_WR_LEN_REG       = 0x0C;
  var PI_STATUS_REG       = 0x10;
  var PI_BSD_DOM1_LAT_REG = 0x14;
  var PI_BSD_DOM1_PWD_REG = 0x18;
  var PI_BSD_DOM1_PGS_REG = 0x1C;
  var PI_BSD_DOM1_RLS_REG = 0x20;
  var PI_BSD_DOM2_LAT_REG = 0x24;
  var PI_BSD_DOM2_PWD_REG = 0x28;
  var PI_BSD_DOM2_PGS_REG = 0x2C;
  var PI_BSD_DOM2_RLS_REG = 0x30;

  // Values read from status reg
  var PI_STATUS_DMA_BUSY    = 0x01;
  var PI_STATUS_IO_BUSY     = 0x02;
  var PI_STATUS_DMA_IO_BUSY = 0x03;
  var PI_STATUS_ERROR       = 0x04;

  // Values written to status reg
  var PI_STATUS_RESET     = 0x01;
  var PI_STATUS_CLR_INTR  = 0x02;

  var PI_DOM1_ADDR1   = 0x06000000;
  var PI_DOM1_ADDR2   = 0x10000000;
  var PI_DOM1_ADDR3   = 0x1FD00000;
  var PI_DOM2_ADDR1   = 0x05000000;
  var PI_DOM2_ADDR2   = 0x08000000;

  function isDom1Addr1(address) { return address >= PI_DOM1_ADDR1 && address < PI_DOM2_ADDR2; }
  function isDom1Addr2(address) { return address >= PI_DOM1_ADDR2 && address < 0x1FBFFFFF;    }
  function isDom1Addr3(address) { return address >= PI_DOM1_ADDR3 && address < 0x7FFFFFFF;    }
  function isDom2Addr1(address) { return address >= PI_DOM2_ADDR1 && address < PI_DOM1_ADDR1; }
  function isDom2Addr2(address) { return address >= PI_DOM2_ADDR2 && address < PI_DOM1_ADDR2; }

  // RDRAM Interface
  var RI_MODE_REG             = 0x00;
  var RI_CONFIG_REG           = 0x04;
  var RI_CURRENT_LOAD_REG     = 0x08;
  var RI_SELECT_REG           = 0x0C;
  var RI_REFRESH_REG          = 0x10;
  var RI_COUNT_REG            = RI_REFRESH_REG;
  var RI_LATENCY_REG          = 0x14;
  var RI_RERROR_REG           = 0x18;
  var RI_WERROR_REG           = 0x1C;
  var RI_LAST_REG             = RI_WERROR_REG;

  // Serial Interface
  var SI_DRAM_ADDR_REG      = 0x00;
  var SI_PIF_ADDR_RD64B_REG = 0x04;
  var SI_PIF_ADDR_WR64B_REG = 0x10;
  var SI_STATUS_REG         = 0x18;

  var SI_STATUS_DMA_BUSY    = 0x0001;
  var SI_STATUS_RD_BUSY     = 0x0002;
  var SI_STATUS_DMA_ERROR   = 0x0008;
  var SI_STATUS_INTERRUPT   = 0x1000;

  var running       = false;

  var setMemorySize = false;

  var cur_vbl       = 0;
  var last_vbl      = 0;

  var gRumblePakActive = false;
  var gEnableRumble = false;

  var resetCallbacks = [];

  var rominfo = {
    id:             '',
    name:           '',
    cic:            '6101',
    country:        0x45,
    save:           'Eeprom4k'
  };

  function padString(v,len) {
    var t = v.toString();
    while (t.length < len) {
      t = '0' + t;
    }
    return t;
  }

  function toHex(r, bits) {
    r = Number(r);
    if (r < 0) {
        r = 0xFFFFFFFF + r + 1;
    }

    var t = r.toString(16);

    if (bits) {
      var len = Math.floor(bits / 4); // 4 bits per hex char
      while (t.length < len) {
        t = '0' + t;
      }
    }

    return t;
  }

  function toString8(v) {
    return '0x' + toHex((v&0xff)>>>0, 8);
  }
  function toString16(v) {
    return '0x' + toHex((v&0xffff)>>>0, 16);
  }
  function toString32(v) {
    return '0x' + toHex(v, 32);
  }

  function toString64(hi, lo) {
    var t = toHex(lo, 32);
    var u = toHex(hi, 32);
    return '0x' + u + t;
  }

  function AssertException(message) {
    this.message = message;
  }

  AssertException.prototype.toString = function () {
    return 'AssertException: ' + this.message;
  };

  function assert(e, m) {
    if (!e) {
      throw new AssertException(m);
    }
  }

  //
  // Memory just wraps an ArrayBuffer and provides some useful accessors
  //
  function Memory(arrayBuffer) {
    this.arrayBuffer = arrayBuffer;
    this.length      = arrayBuffer.byteLength;
    this.u8          = new Uint8Array(arrayBuffer);
    this.s32         = new Int32Array(arrayBuffer);
  }

  Memory.prototype = {
    clear : function () {
      var i;
      for (i = 0; i < this.u8.length; ++i) {
        this.u8[i] = 0;
      }
    },

    readU32 : function (offset) {
      return ((this.u8[offset] << 24) | (this.u8[offset+1] << 16) | (this.u8[offset+2] << 8) | this.u8[offset+3])>>>0;
    },
    readU16 : function (offset) {
      return (this.u8[offset] <<  8) | (this.u8[offset+1]      );
    },
    readU8  : function (offset) {
      return this.u8[offset];
    },

    readS32 : function (offset) {
      return ((this.u8[offset] << 24) | (this.u8[offset+1] << 16) | (this.u8[offset+2] << 8) | this.u8[offset+3]) | 0;
    },
    readS16 : function (offset) {
      return  ((this.u8[offset] << 24) | (this.u8[offset+1] << 16) ) >> 16;
    },
    readS8  : function (offset) {
      return  ((this.u8[offset] << 24) ) >> 24;
    },

    write32 : function (offset, value) {
      this.u8[offset  ] = value >> 24;
      this.u8[offset+1] = value >> 16;
      this.u8[offset+2] = value >>  8;
      this.u8[offset+3] = value;
    },

    write16 : function (offset,value) {
      this.u8[offset  ] = value >> 8;
      this.u8[offset+1] = value;
    },

    write8 : function (offset,value) {
      this.u8[offset] = value;
    },

    clearBits32 : function (offset, bits) {
      var value = this.readU32(offset) & ~bits;
      this.write32(offset, value);
      return value;
    },
    setBits32 : function (offset, bits) {
      var value = this.readU32(offset) | bits;
      this.write32(offset, value);
      return value;
    },
    getBits32 : function (offset, bits) {
      return this.readU32(offset) & bits;
    }
  };

  function memoryCopy(dst, dstoff, src, srcoff, len) {
    var i;
    for (i = 0; i < len; ++i) {
      dst.u8[dstoff+i] = src.u8[srcoff+i];
    }
  }

  //
  // A device represents a region of memory mapped at a certain address
  //
  function Device(name, mem, rangeStart, rangeEnd) {
    this.name       = name;
    this.mem        = mem;
    this.u8         = mem ? mem.u8 : null;  // Cache the underlying Uint8Array.
    this.rangeStart = rangeStart;
    this.rangeEnd   = rangeEnd;
    this.quiet      = false;
  }

  Device.prototype = {

    setMem : function (mem) {
      this.mem = mem;
      this.u8  = mem.u8;
    },

    calcEA : function (address) {
      return address - this.rangeStart;
    },

    readInternal32 : function (address) {
      var ea = this.calcEA(address);

      // We need to make sure this doesn't throw, so do a bounds check
      if (ea+4 <= this.u8.length) {
        return this.mem.readU32(ea);
      }
      return 0xdddddddd;
    },
    writeInternal32 : function (address, value) {
      var ea = this.calcEA(address);

      // We need to make sure this doesn't throw, so do a bounds check
      if (ea+4 <= this.u8.length) {
        this.mem.write32(ea, value);
      }
    },

    logRead : function (address) {
      if (!this.quiet) {
        n64js.log('Reading from ' + this.name + ': ' + toString32(address) );
      }
    },

    logWrite : function (address, value_str) {
      if (!this.quiet) {
        n64js.log('Writing to ' + this.name + ': ' + value_str + ' -> [' + toString32(address) + ']' );
      }
    },

    readU32 : function (address) {
      this.logRead(address);
      var ea = this.calcEA(address);
      return this.mem.readU32(ea);
    },
    readU16 : function (address) {
      this.logRead(address);
      var ea = this.calcEA(address);
      return this.mem.readU16(ea);
    },
    readU8 : function (address) {
      this.logRead(address);
      var ea = this.calcEA(address);
      return this.mem.readU8(ea);
    },

    readS32 : function (address) {
      this.logRead(address);
      var ea = this.calcEA(address);
      return this.mem.readS32(ea);
    },
    readS16 : function (address) {
      this.logRead(address);
      var ea = this.calcEA(address);
      return this.mem.readS16(ea);
    },
    readS8 : function (address) {
      this.logRead(address);
      var ea = this.calcEA(address);
      return this.mem.readS8(ea);
    },


    write32 : function (address, value) {
      this.logWrite(address, toString32(value));
      var ea = this.calcEA(address);
      this.mem.write32(ea, value);
    },
    write16 : function (address, value) {
      this.logWrite(address, toString16(value));
      var ea = this.calcEA(address);
      this.mem.write16(ea, value);
    },
    write8 : function (address, value) {
      this.logWrite(address, toString8(value));
      var ea = this.calcEA(address);
      this.mem.write8(ea, value);
    }
  };

  var rom           = null;   // Will be memory, mapped at 0xb0000000
  var pi_mem        = new Memory(new ArrayBuffer(0x7c0 + 0x40));   // rom+ram
  var ram           = new Memory(new ArrayBuffer(8*1024*1024));
  var sp_mem        = new Memory(new ArrayBuffer(0x2000));
  var sp_reg        = new Memory(new ArrayBuffer(0x20));
  var sp_ibist_mem  = new Memory(new ArrayBuffer(0x8));
  var dpc_mem       = new Memory(new ArrayBuffer(0x20));
  var dps_mem       = new Memory(new ArrayBuffer(0x10));
  var rdram_reg     = new Memory(new ArrayBuffer(0x30));
  var mi_reg        = new Memory(new ArrayBuffer(0x10));
  var vi_reg        = new Memory(new ArrayBuffer(0x38));
  var ai_reg        = new Memory(new ArrayBuffer(0x18));
  var pi_reg        = new Memory(new ArrayBuffer(0x34));
  var ri_reg        = new Memory(new ArrayBuffer(0x20));
  var si_reg        = new Memory(new ArrayBuffer(0x1c));

  var eeprom        = null;   // Initialised during reset, using correct size for this rom (may be null if eeprom isn't used)
  var eepromDirty   = false;

  // Keep a DataView around as a view onto the RSP task
  var kTaskOffset   = 0x0fc0;
  var rsp_task_view = new DataView(sp_mem.arrayBuffer, kTaskOffset, 0x40);

  var mapped_mem_handler         = new Device("VMEM",     null,         0x00000000, 0x80000000);
  var rdram_handler_cached       = new Device("RAM",      ram,          0x80000000, 0x80800000);
  var rdram_handler_uncached     = new Device("RAM",      ram,          0xa0000000, 0xa0800000);
  var rdram_reg_handler_uncached = new Device("RDRAMReg", rdram_reg,    0xa3f00000, 0xa4000000);
  var sp_mem_handler_uncached    = new Device("SPMem",    sp_mem,       0xa4000000, 0xa4002000);
  var sp_reg_handler_uncached    = new Device("SPReg",    sp_reg,       0xa4040000, 0xa4040020);
  var sp_ibist_handler_uncached  = new Device("SPIBIST",  sp_ibist_mem, 0xa4080000, 0xa4080008);
  var dpc_handler_uncached       = new Device("DPC",      dpc_mem,      0xa4100000, 0xa4100020);
  var dps_handler_uncached       = new Device("DPS",      dps_mem,      0xa4200000, 0xa4200010);
  var mi_reg_handler_uncached    = new Device("MIReg",    mi_reg,       0xa4300000, 0xa4300010);
  var vi_reg_handler_uncached    = new Device("VIReg",    vi_reg,       0xa4400000, 0xa4400038);
  var ai_reg_handler_uncached    = new Device("AIReg",    ai_reg,       0xa4500000, 0xa4500018);
  var pi_reg_handler_uncached    = new Device("PIReg",    pi_reg,       0xa4600000, 0xa4600034);
  var ri_reg_handler_uncached    = new Device("RIReg",    ri_reg,       0xa4700000, 0xa4700020);
  var si_reg_handler_uncached    = new Device("SIReg",    si_reg,       0xa4800000, 0xa480001c);
  var rom_d2a1_handler_uncached  = new Device("ROMd2a1",  null,         0xa5000000, 0xa6000000);
  var rom_d1a1_handler_uncached  = new Device("ROMd1a1",  rom,          0xa6000000, 0xa8000000);
  var rom_d2a2_handler_uncached  = new Device("ROMd2a2",  null,         0xa8000000, 0xb0000000);
  var rom_d1a2_handler_uncached  = new Device("ROMd1a2",  rom,          0xb0000000, 0xbfc00000);
  var pi_mem_handler_uncached    = new Device("PIRAM",    pi_mem,       0xbfc00000, 0xbfc00800);
  var rom_d1a3_handler_uncached  = new Device("ROMd1a3",  rom,          0xbfd00000, 0xc0000000);


  function fixEndian(arrayBuffer) {
    var dataView = new DataView(arrayBuffer);

    function byteSwap(buffer, i0, i1, i2, i3) {

      var u8 = new Uint8Array(buffer);
      var i;
      for (i = 0; i < u8.length; i += 4) {
        var a = u8[i+i0], b = u8[i+i1], c = u8[i+i2], d = u8[i+i3];
        u8[i  ] = a;
        u8[i+1] = b;
        u8[i+2] = c;
        u8[i+3] = d;
      }
    }

    switch (dataView.getUint32(0)) {
      case 0x80371240:
        // ok
        break;
      case 0x40123780:
        byteSwap(arrayBuffer, 3, 2, 1, 0);
        break;
      case 0x12408037:
        byteSwap(arrayBuffer, 2, 3, 0, 1);
        break;
      case 0x37804012:
        byteSwap(arrayBuffer, 1, 0, 3, 2);
        break;
      default:
        throw 'Unhandled byteswapping: ' + dataView.getUint32(0).toString(16);
    }
  }

  function uint8ArrayReadString(u8array, offset, max_len) {
    var s = '';
    var i;
    for (i = 0; i < max_len; ++i) {
      var c = u8array[offset+i];
      if (c === 0) {
        break;
      }
      s += String.fromCharCode(c);
    }
    return s;
  }

  function byteswap(a) {
    return ((a>>24)&0x000000ff) |
           ((a>> 8)&0x0000ff00) |
           ((a<< 8)&0x00ff0000) |
           ((a<<24)&0xff000000);
  }

  function generateRomId(crclo, crchi) {
    return toHex(byteswap(crclo),32) + toHex(byteswap(crchi),32);
  }

  function generateCICType(u8array)
  {
    var cic = 0;
    var i;
    for (i = 0; i < 0xFC0; i++) {
      cic = cic + u8array[0x40 + i];
    }

    switch (cic) {
      case 0x33a27: return '6101';
      case 0x3421e: return '6101';
      case 0x34044: return '6102';
      case 0x357d0: return '6103';
      case 0x47a81: return '6105';
      case 0x371cc: return '6106';
      case 0x343c9: return '6106';
      default:
        n64js.log('Unknown CIC Code ' + toString32(cic) );
        return '6102';
    }
  }

  function loadRom(arrayBuffer) {
    fixEndian(arrayBuffer);

    rom = new Memory(arrayBuffer);
    rom_d1a1_handler_uncached.setMem(rom);
    rom_d1a2_handler_uncached.setMem(rom);
    rom_d1a3_handler_uncached.setMem(rom);

    var hdr = {
      header:       rom.readU32(0),
      clock:        rom.readU32(4),
      bootAddress:  rom.readU32(8),
      release:      rom.readU32(12),
      crclo:        rom.readU32(16),   // or hi?
      crchi:        rom.readU32(20),   // or lo?
      unk0:         rom.readU32(24),
      unk1:         rom.readU32(28),
      name:         uint8ArrayReadString(rom.u8, 32, 20),
      unk2:         rom.readU32(52),
      unk3:         rom.readU16(56),
      unk4:         rom.readU8 (58),
      manufacturer: rom.readU8 (59),
      cartId:       rom.readU16(60),
      countryId:    rom.readU8 (62),  // char
      unk5:         rom.readU8 (63)
    };


    var $table = $('<table class="register-table"><tbody></tbody></table>');
    var $tb = $table.find('tbody');
    var i;
    for (i in hdr) {
      $tb.append('<tr>' +
        '<td>' + i + '</td><td>' + (typeof hdr[i] === 'string' ? hdr[i] : toString32(hdr[i])) + '</td>' +
        '</tr>');
    }
    n64js.outputAppendHTML($table);

    // Set up rominfo
    rominfo.cic     = generateCICType(rom.u8);
    rominfo.id      = generateRomId(hdr.crclo, hdr.crchi);
    rominfo.country = hdr.countryId;

    var info = n64js.romdb[rominfo.id];
    if (info) {
      n64js.log('Loaded info for ' + rominfo.id + ' from db');
      rominfo.name = info.name;
      rominfo.save = info.save;
    } else {
      n64js.log('No info for ' + rominfo.id + ' in db');
      rominfo.name = hdr.name;
      rominfo.save = 'Eeprom4k';
    }

    n64js.log('rominfo is ' + JSON.stringify(rominfo));

    $('#title').text('n64js - ' + rominfo.name);
  }

  n64js.toggleRun = function () {
    running = !running;
    $('#runbutton').html(running ? '<i class="icon-pause"></i> Pause' : '<i class="icon-play"></i> Run');
    if (running) {
      updateLoopAnimframe();
    }
  };

  n64js.breakEmulationForDisplayListDebug = function () {
    if (running) {
      n64js.toggleRun();
      n64js.cpu0.breakExecution();
      //updateLoopAnimframe();
    }
  };

  n64js.triggerLoad = function () {
    var $fileinput = $('#fileInput');

    // Reset fileInput value, otherwise onchange doesn't recognise when we select the same rome back-to-back
    $fileinput.val('');
    $fileinput.click();
  };

  n64js.loadFile = function () {
    var f = document.getElementById("fileInput");
    if (f && f.files.length > 0) {
      var file = f.files[0];
      var name = file.fileName;
      var size = file.fileSize;

      var reader = new FileReader();

      reader.onerror = function (e) {
        n64js.displayWarning('error loading file');
      };
      reader.onload = function (e) {
        loadRom(e.target.result);
        n64js.reset();
        n64js.refreshDebugger();
        running = false;
        n64js.toggleRun();
      };

      reader.readAsArrayBuffer(file);
    }
  };

  n64js.step = function () {
    if (!running) {
      n64js.singleStep();
      n64js.refreshDebugger();
    }
  };

  function syncActive() {
    return (syncFlow || syncInput) ? true : false;
  }

  function syncTick(max_count) {
    var kEstimatedBytePerCycle = 8;
    var sync_objects   = [syncFlow, syncInput],
        max_safe_count = max_count,
        count,
        i;

    for (i = 0; i < sync_objects.length; ++i) {
      var s = sync_objects[i];
      if (s) {
        if (!s.tick()) {
          max_safe_count = 0;
        }

        // Guesstimate num bytes used per cycle
        count = Math.floor(s.getAvailableBytes() / kEstimatedBytePerCycle);

        // Ugh - bodgy hacky hacky for input sync
        count = Math.max(0, count - 100);

        max_safe_count = Math.min(max_safe_count, count);
      }
    }

    return max_safe_count;
  }

  function updateLoopAnimframe() {
    if (stats) {
      stats.begin();
    }

    if (running) {
      requestAnimationFrame(updateLoopAnimframe);

      var max_cycles = kCyclesPerUpdate;

      // NB: don't slow down debugger when we're waiting for a display list to be debugged.
      var debugging = $('.debug').is(':visible');
      if (debugging && !n64js.debugDisplayListRequested()) {
        max_cycles = n64js.getDebugCycles();
      }

      if (syncActive()) {
        // Check how many cycles we can safely execute
        var sync_count = syncTick(max_cycles);
        if (sync_count > 0) {
          n64js.run(sync_count);
          n64js.refreshDebugger();
        }
      } else {
        n64js.run(max_cycles);
        n64js.refreshDebugger();
      }

      if (!running) {
        $('#runbutton').html('<i class="icon-play"></i> Run');
      }
    } else if (n64js.debugDisplayListRunning()) {
      requestAnimationFrame(updateLoopAnimframe);
      if (n64js.debugDisplayList()) {
        n64js.presentBackBuffer(n64js.getRamU8Array(), n64js.viOrigin());
      }
    }

    if (stats) {
      stats.end();
    }
  }

  n64js.getRamU8Array = function () {
    return rdram_handler_cached.u8;
  };

  n64js.getRamS32Array = function () {
    return rdram_handler_cached.mem.s32;
  };

  n64js.getRamDataView = function () {
    // FIXME: should cache this object, or try to get rid of DataView entirely (Uint8Array + manual shuffling is faster)
    return new DataView(ram.arrayBuffer);
  };

  // This function gets hit A LOT, so eliminate as much fat as possible.
  rdram_handler_cached.readU32 = function (address) {
    var off = address - 0x80000000;
    return ((this.u8[off+0] << 24) | (this.u8[off+1] << 16) | (this.u8[off+2] << 8) | (this.u8[off+3]))>>>0;
  };
  rdram_handler_cached.readS32 = function (address) {
    var off = address - 0x80000000;
    return (this.u8[off+0] << 24) | (this.u8[off+1] << 16) | (this.u8[off+2] << 8) | (this.u8[off+3]);
  };
  rdram_handler_cached.write32 = function (address, value) {
    var off = address - 0x80000000;
    this.u8[off+0] = value >> 24;
    this.u8[off+1] = value >> 16;
    this.u8[off+2] = value >>  8;
    this.u8[off+3] = value;
  };

  mapped_mem_handler.readInternal32 = function (address) {
    var mapped = n64js.cpu0.translateReadInternal(address) & 0x007fffff;
    if (mapped !== 0) {
      if (mapped+4 <= ram.u8.length) {
        return ram.readU32(mapped);
      }
    }
    return 0x00000000;
  };
  mapped_mem_handler.writeInternal32 = function (address, value) {
    var mapped = n64js.cpu0.translateReadInternal(address) & 0x007fffff;
    if (mapped !== 0) {
      if (mapped+4 <= ram.u8.length) {
        ram.write32(mapped);
      }
    }
  };

  mapped_mem_handler.readU32 = function (address) {
    var mapped = n64js.cpu0.translateRead(address) & 0x007fffff;
    if (mapped !== 0) {
      return ram.readU32(mapped);
    }
    n64js.halt('virtual readU32 failed - need to throw refill/invalid');
    return 0x00000000;
  };
  mapped_mem_handler.readU16 = function (address) {
    var mapped = n64js.cpu0.translateRead(address) & 0x007fffff;
    if (mapped !== 0) {
      return ram.readU16(mapped);
    }
    n64js.halt('virtual readU16 failed - need to throw refill/invalid');
    return 0x0000;
  };
  mapped_mem_handler.readU8 = function (address) {
    var mapped = n64js.cpu0.translateRead(address) & 0x007fffff;
    if (mapped !== 0) {
      return ram.readU8(mapped);
    }
    n64js.halt('virtual readU8 failed - need to throw refill/invalid');
    return 0x00;
  };

  mapped_mem_handler.readS32 = function (address) {
    var mapped = n64js.cpu0.translateRead(address) & 0x007fffff;
    if (mapped !== 0) {
      return ram.readS32(mapped);
    }
// FIXME: need to somehow interrupt the current instruction from executing, before it has chance to modify state.
// For now, goldeneye hits this initially when reading the current instruction. I laemly return 0 so that I execute a NOP and then jump to the exception handler.
//    n64js.halt('virtual readS32 failed - need to throw refill/invalid');
    return 0x00000000;
  };
  mapped_mem_handler.readS16 = function (address) {
    var mapped = n64js.cpu0.translateRead(address) & 0x007fffff;
    if (mapped !== 0) {
      return ram.readS16(mapped);
    }
    n64js.halt('virtual readS16 failed - need to throw refill/invalid');
    return 0x0000;
  };
  mapped_mem_handler.readS8 = function (address) {
    var mapped = n64js.cpu0.translateRead(address);
    if (mapped !== 0) {
      return ram.readS8(mapped);
    }
    n64js.halt('virtual readS8 failed - need to throw refill/invalid');
    return 0x00;
  };

  mapped_mem_handler.write32 = function (address, value) {
    var mapped = n64js.cpu0.translateWrite(address) & 0x007fffff;
    if (mapped !== 0) {
      ram.write32(mapped, value);
      return;
    }
    n64js.halt('virtual write32 failed - need to throw refill/invalid');
  };
  mapped_mem_handler.write16 = function (address, value) {
    var mapped = n64js.cpu0.translateWrite(address) & 0x007fffff;
    if (mapped !== 0) {
      ram.write16(mapped, value);
      return;
    }
    n64js.halt('virtual write16 failed - need to throw refill/invalid');
  };
  mapped_mem_handler.write8 = function (address, value) {
    var mapped = n64js.cpu0.translateWrite(address) & 0x007fffff;
    if (mapped !== 0) {
      ram.write8(mapped, value);
      return;
    }
    n64js.halt('virtual write8 failed - need to throw refill/invalid');
  };

  rom_d1a1_handler_uncached.write32 = function (address, value) { throw 'Writing to rom d1a1'; };
  rom_d1a1_handler_uncached.write16 = function (address, value) { throw 'Writing to rom d1a1'; };
  rom_d1a1_handler_uncached.write8  = function (address, value) { throw 'Writing to rom d1a1'; };

  rom_d1a2_handler_uncached.write32 = function (address, value) { throw 'Writing to rom d1a2'; };
  rom_d1a2_handler_uncached.write16 = function (address, value) { throw 'Writing to rom d1a2'; };
  rom_d1a2_handler_uncached.write8  = function (address, value) { throw 'Writing to rom d1a2'; };

  rom_d1a3_handler_uncached.write32 = function (address, value) { throw 'Writing to rom d1a3'; };
  rom_d1a3_handler_uncached.write16 = function (address, value) { throw 'Writing to rom d1a3'; };
  rom_d1a3_handler_uncached.write8  = function (address, value) { throw 'Writing to rom d1a3'; };

  // Should read noise?
  function getRandomU32() {
    var hi = Math.floor( Math.random() * 0xffff ) & 0xffff;
    var lo = Math.floor( Math.random() * 0xffff ) & 0xffff;

    var v = (hi<<16) | lo;

    if (syncInput) {
      v = syncInput.reflect32(v);
    }

    return v;
  }

  rom_d2a1_handler_uncached.readU32  = function (address)        { n64js.log('reading noise'); return getRandomU32(); };
  rom_d2a1_handler_uncached.readU16  = function (address)        { n64js.log('reading noise'); return getRandomU32() & 0xffff; };
  rom_d2a1_handler_uncached.readU8   = function (address)        { n64js.log('reading noise'); return getRandomU32() & 0xff; };
  rom_d2a1_handler_uncached.readS32  = function (address)        { n64js.log('reading noise'); return getRandomU32(); };
  rom_d2a1_handler_uncached.readS16  = function (address)        { n64js.log('reading noise'); return getRandomU32() & 0xffff; };
  rom_d2a1_handler_uncached.readS8   = function (address)        { n64js.log('reading noise'); return getRandomU32() & 0xff; };
  rom_d2a1_handler_uncached.write32  = function (address, value) { throw 'Writing to rom'; };
  rom_d2a1_handler_uncached.write16  = function (address, value) { throw 'Writing to rom'; };
  rom_d2a1_handler_uncached.write8   = function (address, value) { throw 'Writing to rom'; };

  rom_d2a2_handler_uncached.readU32  = function (address)        { throw 'Reading from rom d2a2'; };
  rom_d2a2_handler_uncached.readU16  = function (address)        { throw 'Reading from rom d2a2'; };
  rom_d2a2_handler_uncached.readU8   = function (address)        { throw 'Reading from rom d2a2'; };
  rom_d2a2_handler_uncached.readS32  = function (address)        { throw 'Reading from rom d2a2'; };
  rom_d2a2_handler_uncached.readS16  = function (address)        { throw 'Reading from rom d2a2'; };
  rom_d2a2_handler_uncached.readS8   = function (address)        { throw 'Reading from rom d2a2'; };
  rom_d2a2_handler_uncached.write32  = function (address, value) { throw 'Writing to rom'; };
  rom_d2a2_handler_uncached.write16  = function (address, value) { throw 'Writing to rom'; };
  rom_d2a2_handler_uncached.write8   = function (address, value) { throw 'Writing to rom'; };

  rdram_reg_handler_uncached.calcEA  = function (address) {
    return address&0xff;
  };

  function spUpdateStatus(flags) {

    if (!sp_reg_handler_uncached.quiet) {
      if (flags & SP_CLR_HALT)       { n64js.log( 'SP: Clearing Halt' ); }
      if (flags & SP_SET_HALT)       { n64js.log( 'SP: Setting Halt' ); }
      if (flags & SP_CLR_BROKE)      { n64js.log( 'SP: Clearing Broke' ); }
      // No SP_SET_BROKE
      if (flags & SP_CLR_INTR)       { n64js.log( 'SP: Clearing Interrupt' ); }
      if (flags & SP_SET_INTR)       { n64js.log( 'SP: Setting Interrupt' ); }
      if (flags & SP_CLR_SSTEP)      { n64js.log( 'SP: Clearing Single Step' ); }
      if (flags & SP_SET_SSTEP)      { n64js.log( 'SP: Setting Single Step' ); }
      if (flags & SP_CLR_INTR_BREAK) { n64js.log( 'SP: Clearing Interrupt on break' ); }
      if (flags & SP_SET_INTR_BREAK) { n64js.log( 'SP: Setting Interrupt on break' ); }
      if (flags & SP_CLR_SIG0)       { n64js.log( 'SP: Clearing Sig0 (Yield)' ); }
      if (flags & SP_SET_SIG0)       { n64js.log( 'SP: Setting Sig0 (Yield)' ); }
      if (flags & SP_CLR_SIG1)       { n64js.log( 'SP: Clearing Sig1 (Yielded)' ); }
      if (flags & SP_SET_SIG1)       { n64js.log( 'SP: Setting Sig1 (Yielded)' ); }
      if (flags & SP_CLR_SIG2)       { n64js.log( 'SP: Clearing Sig2 (TaskDone)' ); }
      if (flags & SP_SET_SIG2)       { n64js.log( 'SP: Setting Sig2 (TaskDone)' ); }
      if (flags & SP_CLR_SIG3)       { n64js.log( 'SP: Clearing Sig3' ); }
      if (flags & SP_SET_SIG3)       { n64js.log( 'SP: Setting Sig3' ); }
      if (flags & SP_CLR_SIG4)       { n64js.log( 'SP: Clearing Sig4' ); }
      if (flags & SP_SET_SIG4)       { n64js.log( 'SP: Setting Sig4' ); }
      if (flags & SP_CLR_SIG5)       { n64js.log( 'SP: Clearing Sig5' ); }
      if (flags & SP_SET_SIG5)       { n64js.log( 'SP: Setting Sig5' ); }
      if (flags & SP_CLR_SIG6)       { n64js.log( 'SP: Clearing Sig6' ); }
      if (flags & SP_SET_SIG6)       { n64js.log( 'SP: Setting Sig6' ); }
      if (flags & SP_CLR_SIG7)       { n64js.log( 'SP: Clearing Sig7' ); }
      if (flags & SP_SET_SIG7)       { n64js.log( 'SP: Setting Sig7' ); }
    }

    var clr_bits = 0;
    var set_bits = 0;

    var start_rsp = false;
    var stop_rsp = false;

    if (flags & SP_CLR_HALT)       { clr_bits |= SP_STATUS_HALT; start_rsp = true; }
    if (flags & SP_SET_HALT)       { set_bits |= SP_STATUS_HALT; stop_rsp  = true; }

    if (flags & SP_SET_INTR)       { mi_reg.setBits32  (MI_INTR_REG, MI_INTR_SP); n64js.cpu0.updateCause3(); }   // Shouldn't ever set this?
    else if (flags & SP_CLR_INTR)  { mi_reg.clearBits32(MI_INTR_REG, MI_INTR_SP); n64js.cpu0.updateCause3(); }

    clr_bits |= (flags & SP_CLR_BROKE) >> 1;
    clr_bits |= (flags & SP_CLR_SSTEP);
    clr_bits |= (flags & SP_CLR_INTR_BREAK) >> 1;
    clr_bits |= (flags & SP_CLR_SIG0) >> 2;
    clr_bits |= (flags & SP_CLR_SIG1) >> 3;
    clr_bits |= (flags & SP_CLR_SIG2) >> 4;
    clr_bits |= (flags & SP_CLR_SIG3) >> 5;
    clr_bits |= (flags & SP_CLR_SIG4) >> 6;
    clr_bits |= (flags & SP_CLR_SIG5) >> 7;
    clr_bits |= (flags & SP_CLR_SIG6) >> 8;
    clr_bits |= (flags & SP_CLR_SIG7) >> 9;

    set_bits |= (flags & SP_SET_SSTEP) >> 1;
    set_bits |= (flags & SP_SET_INTR_BREAK) >> 2;
    set_bits |= (flags & SP_SET_SIG0) >> 3;
    set_bits |= (flags & SP_SET_SIG1) >> 4;
    set_bits |= (flags & SP_SET_SIG2) >> 5;
    set_bits |= (flags & SP_SET_SIG3) >> 6;
    set_bits |= (flags & SP_SET_SIG4) >> 7;
    set_bits |= (flags & SP_SET_SIG5) >> 8;
    set_bits |= (flags & SP_SET_SIG6) >> 9;
    set_bits |= (flags & SP_SET_SIG7) >> 10;

    var status_bits = sp_reg.readU32(SP_STATUS_REG);
    status_bits &= ~clr_bits;
    status_bits |=  set_bits;
    sp_reg.write32(SP_STATUS_REG, status_bits);

    if (start_rsp) {
      n64js.rspProcessTask(rsp_task_view);
    } //else if (stop_rsp) {
      // As we handle all RSP via HLE, nothing to do here.
    //}
  }

  function spCopyFromRDRAM() {
    var sp_mem_address = sp_reg.readU32(SP_MEM_ADDR_REG);
    var rd_ram_address = sp_reg.readU32(SP_DRAM_ADDR_REG);
    var rdlen_reg      = sp_reg.readU32(SP_RD_LEN_REG);
    var splen          = (rdlen_reg & 0xfff) + 1;

    if (!sp_reg_handler_uncached.quiet) {
      n64js.log('SP: copying from ram ' + toString32(rd_ram_address) + ' to sp ' + toString16(sp_mem_address) );
    }

    memoryCopy( sp_mem, sp_mem_address & 0xfff, ram, rd_ram_address & 0xffffff, splen );

    sp_reg.setBits32(SP_DMA_BUSY_REG, 0);
    sp_reg.clearBits32(SP_STATUS_REG, SP_STATUS_DMA_BUSY);
  }

  function spCopyToRDRAM() {
    var sp_mem_address = sp_reg.readU32(SP_MEM_ADDR_REG);
    var rd_ram_address = sp_reg.readU32(SP_DRAM_ADDR_REG);
    var wrlen_reg      = sp_reg.readU32(SP_WR_LEN_REG);
    var splen          = (wrlen_reg & 0xfff) + 1;

    if (!sp_reg_handler_uncached.quiet) {
      n64js.log('SP: copying from sp ' + toString16(sp_mem_address) + ' to ram ' + toString32(rd_ram_address) );
    }

    memoryCopy( ram, rd_ram_address & 0xffffff, sp_mem, sp_mem_address & 0xfff, splen );

    sp_reg.setBits32(SP_DMA_BUSY_REG, 0);
    sp_reg.clearBits32(SP_STATUS_REG, SP_STATUS_DMA_BUSY);
  }


  sp_reg_handler_uncached.write32 = function (address, value) {
    var ea = this.calcEA(address);
    if (ea+4 > this.u8.length) {
      throw 'Write is out of range';
    }

    switch( ea ) {
      case SP_MEM_ADDR_REG:
      case SP_DRAM_ADDR_REG:
      case SP_SEMAPHORE_REG:
        this.mem.write32(ea, value);
        break;
      case SP_RD_LEN_REG:
        this.mem.write32(ea, value);
        spCopyFromRDRAM();
        break;

      case SP_WR_LEN_REG:
        this.mem.write32(ea, value);
        spCopyToRDRAM();
        break;

      case SP_STATUS_REG:
        spUpdateStatus( value );
        break;

      case SP_DMA_FULL_REG:
      case SP_DMA_BUSY_REG:
        // Prevent writing to read-only mem
        break;

      default:
        n64js.log('Unhandled write to SPReg: ' + toString32(value) + ' -> [' + toString32(address) + ']' );
        this.mem.write32(ea, value);
    }
  };

  function dpcUpdateStatus(value)
  {
    var dpc_status  =  dpc_mem.readU32(DPC_STATUS_REG);

    if (value & DPC_CLR_XBUS_DMEM_DMA)      { dpc_status &= ~DPC_STATUS_XBUS_DMEM_DMA; }
    if (value & DPC_SET_XBUS_DMEM_DMA)      { dpc_status |=  DPC_STATUS_XBUS_DMEM_DMA; }
    if (value & DPC_CLR_FREEZE)             { dpc_status &= ~DPC_STATUS_FREEZE; }
    //if (value & DPC_SET_FREEZE)           { dpc_status |=  DPC_STATUS_FREEZE; }  // Thanks Lemmy! <= what's wrong with this? ~ Salvy
    if (value & DPC_CLR_FLUSH)              { dpc_status &= ~DPC_STATUS_FLUSH; }
    if (value & DPC_SET_FLUSH)              { dpc_status |=  DPC_STATUS_FLUSH; }

    // These should be ignored ! - Salvy
    /*
    if (value & DPC_CLR_TMEM_CTR)          { dpc_mem.write32(DPC_TMEM_REG, 0); }
    if (value & DPC_CLR_PIPE_CTR)          { dpc_mem.write32(DPC_PIPEBUSY_REG, 0); }
    if (value & DPC_CLR_CMD_CTR)           { dpc_mem.write32(DPC_BUFBUSY_REG, 0); }
    if (value & DPC_CLR_CLOCK_CTR)         { dpc_mem.write32(DPC_CLOCK_REG, 0); }
    */

    // if (value & DPC_CLR_XBUS_DMEM_DMA)  { n64js.log('DPC_CLR_XBUS_DMEM_DMA'); }
    // if (value & DPC_SET_XBUS_DMEM_DMA)  { n64js.log('DPC_SET_XBUS_DMEM_DMA'); }
    // if (value & DPC_CLR_FREEZE)         { n64js.log('DPC_CLR_FREEZE'); }
    // if (value & DPC_SET_FREEZE)         { n64js.log('DPC_SET_FREEZE'); }
    // if (value & DPC_CLR_FLUSH)          { n64js.log('DPC_CLR_FLUSH'); }
    // if (value & DPC_SET_FLUSH)          { n64js.log('DPC_SET_FLUSH'); }
    // if (value & DPC_CLR_TMEM_CTR)       { n64js.log('DPC_CLR_TMEM_CTR'); }
    // if (value & DPC_CLR_PIPE_CTR)       { n64js.log('DPC_CLR_PIPE_CTR'); }
    // if (value & DPC_CLR_CMD_CTR)        { n64js.log('DPC_CLR_CMD_CTR'); }
    // if (value & DPC_CLR_CLOCK_CTR)      { n64js.log('DPC_CLR_CLOCK_CTR'); }

    //n64js.log( 'Modified DPC_STATUS_REG - now ' + toString32(dpc_status) );

    dpc_mem.write32(DPC_STATUS_REG, dpc_status);
  }

  dpc_handler_uncached.write32 = function (address, value) {
    var ea = this.calcEA(address);
    if (ea+4 > this.u8.length) {
      throw 'Write is out of range';
    }

    switch( ea ) {
      case DPC_START_REG:
        if (!this.quiet) { n64js.log('DPC start set to: ' + toString32(value) ); }
        this.mem.write32(ea, value);
        this.mem.write32(DPC_CURRENT_REG, value);
        break;
      case DPC_END_REG:
        if (!this.quiet) { n64js.log('DPC end set to: ' + toString32(value) ); }
        this.mem.write32(ea, value);
        //mi_reg.setBits32(MI_INTR_REG, MI_INTR_DP);
        //n64js.cpu0.updateCause3();
        break;
      case DPC_STATUS_REG:
        //if (!this.quiet) { n64js.log('DPC status set to: ' + toString32(value) ); }
        dpcUpdateStatus(value);
        break;

      // Read only
      case DPC_CURRENT_REG:
      case DPC_CLOCK_REG:
      case DPC_BUFBUSY_REG:
      case DPC_PIPEBUSY_REG:
      case DPC_TMEM_REG:
        n64js.log('Wrote to read only DPC reg');
        break;

      default:
        this.mem.write32(ea, value);
        break;
    }
  };

  dpc_handler_uncached.readS32 = function (address) {
    this.logRead(address);
    var ea = this.calcEA(address);

    if (ea+4 > this.u8.length) {
      throw 'Read is out of range';
    }
   return this.mem.readS32(ea);
  };

  dpc_handler_uncached.readU32 = function (address) {
    return this.readS32(address)>>>0;
  };



  dps_handler_uncached.write32 = function (address, value) {
    var ea = this.calcEA(address);
    if (ea+4 > this.u8.length) {
      throw 'Write is out of range';
    }
    throw 'DPS writes are unhandled';
    //this.mem.write32(ea, value);
  };

  dps_handler_uncached.readS32 = function (address) {
    this.logRead(address);
    var ea = this.calcEA(address);

    if (ea+4 > this.u8.length) {
      throw 'Read is out of range';
    }
    throw 'DPS reads are unhandled';
    //return this.mem.readS32(ea);
  };

  dps_handler_uncached.readU32 = function (address) {
    return this.readS32(address)>>>0;
  };



  function miWriteModeReg(value) {
    var mi_mode_reg = mi_reg.readU32(MI_MODE_REG);

    if (value & MI_SET_RDRAM)   { mi_mode_reg |=  MI_MODE_RDRAM; }
    if (value & MI_CLR_RDRAM)   { mi_mode_reg &= ~MI_MODE_RDRAM; }

    if (value & MI_SET_INIT)    { mi_mode_reg |=  MI_MODE_INIT; }
    if (value & MI_CLR_INIT)    { mi_mode_reg &= ~MI_MODE_INIT; }

    if (value & MI_SET_EBUS)    { mi_mode_reg |=  MI_MODE_EBUS; }
    if (value & MI_CLR_EBUS)    { mi_mode_reg &= ~MI_MODE_EBUS; }

    mi_reg.write32(MI_MODE_REG, mi_mode_reg);

    if (value & MI_CLR_DP_INTR) {
      mi_reg.clearBits32(MI_INTR_REG, MI_INTR_DP);
      n64js.cpu0.updateCause3();
    }
  }

  function miWriteIntrMaskReg(value) {
    var mi_intr_mask_reg = mi_reg.readU32(MI_INTR_MASK_REG);
    var mi_intr_reg      = mi_reg.readU32(MI_INTR_REG);

    var clr = 0;
    var set = 0;

    // From Corn - nicer way to avoid branching
    clr |= (value & MI_INTR_MASK_CLR_SP) >>> 0;
    clr |= (value & MI_INTR_MASK_CLR_SI) >>> 1;
    clr |= (value & MI_INTR_MASK_CLR_AI) >>> 2;
    clr |= (value & MI_INTR_MASK_CLR_VI) >>> 3;
    clr |= (value & MI_INTR_MASK_CLR_PI) >>> 4;
    clr |= (value & MI_INTR_MASK_CLR_DP) >>> 5;

    set |= (value & MI_INTR_MASK_SET_SP) >>> 1;
    set |= (value & MI_INTR_MASK_SET_SI) >>> 2;
    set |= (value & MI_INTR_MASK_SET_AI) >>> 3;
    set |= (value & MI_INTR_MASK_SET_VI) >>> 4;
    set |= (value & MI_INTR_MASK_SET_PI) >>> 5;
    set |= (value & MI_INTR_MASK_SET_DP) >>> 6;

    mi_intr_mask_reg &= ~clr;
    mi_intr_mask_reg |=  set;

    mi_reg.write32(MI_INTR_MASK_REG, mi_intr_mask_reg);

    // Check if any interrupts are enabled now, and immediately trigger an interrupt
    if (mi_intr_mask_reg & mi_intr_reg) {
      n64js.cpu0.updateCause3();
    }
  }

  mi_reg_handler_uncached.write32 = function (address, value) {
    var ea = this.calcEA(address);
    if (ea+4 > this.u8.length) {
      throw 'Write is out of range';
    }

    switch( ea ) {
      case MI_MODE_REG:
        if (!this.quiet) { n64js.log('Wrote to MI mode register: ' + toString32(value) ); }
        miWriteModeReg(value);
        break;
      case MI_INTR_MASK_REG:
        if (!this.quiet) { n64js.log('Wrote to MI interrupt mask register: ' + toString32(value) ); }
        miWriteIntrMaskReg(value);
        break;

      case MI_VERSION_REG:
      case MI_INTR_REG:
        // Read only
        break;

      default:
        n64js.log('Unhandled write to MIReg: ' + toString32(value) + ' -> [' + toString32(address) + ']' );
        this.mem.write32(ea, value);
        break;
    }
  };


  ai_reg_handler_uncached.write32 = function (address, value) {
    var ea = this.calcEA(address);
    if (ea+4 > this.u8.length) {
      throw 'Write is out of range';
    }

    switch( ea ) {
      case AI_DRAM_ADDR_REG:
      case AI_CONTROL_REG:
      case AI_BITRATE_REG:
        if(!this.quiet) { n64js.log('Wrote to AIReg: ' + toString32(value) + ' -> [' + toString32(address) + ']' ); }
        this.mem.write32(ea, value);
        break;

      case AI_LEN_REG:
        if(!this.quiet) { n64js.log('AI len changed to ' + value); }
        this.mem.write32(ea, value);
        break;
      case AI_DACRATE_REG:
        if(!this.quiet) { n64js.log('AI dacrate changed to ' + value); }
        this.mem.write32(ea, value);
        break;

      case AI_STATUS_REG:
        n64js.log('AI interrupt cleared');
        ai_reg.clearBits32(MI_INTR_REG, MI_INTR_AI);
        n64js.cpu0.updateCause3();
        break;

      default:
        n64js.log('Unhandled write to AIReg: ' + toString32(value) + ' -> [' + toString32(address) + ']' );
        this.mem.write32(ea, value);
        break;
    }
  };

  vi_reg_handler_uncached.write32 = function (address, value) {
    var ea = this.calcEA(address);
    if (ea+4 > this.u8.length) {
      throw 'Write is out of range';
    }

    switch( ea ) {
      case VI_ORIGIN_REG:
        var last_origin = this.mem.readU32(ea);
        var new_origin = value>>>0;
        if (new_origin !== last_origin/* || cur_vbl !== last_vbl*/) {
          n64js.presentBackBuffer(n64js.getRamU8Array(), new_origin);
          n64js.returnControlToSystem();
          last_vbl = cur_vbl;
        }
        this.mem.write32(ea, value);
        break;
      case VI_CONTROL_REG:
        if (!this.quiet) { n64js.log('VI control set to: ' + toString32(value) ); }
        this.mem.write32(ea, value);
        break;
      case VI_WIDTH_REG:
        if (!this.quiet) { n64js.log('VI width set to: ' + value ); }
        this.mem.write32(ea, value);
        break;
      case VI_CURRENT_REG:
        if (!this.quiet) { n64js.log('VI current set to: ' + toString32(value) + '.' ); }
        if (!this.quiet) { n64js.log('VI interrupt cleared'); }
        mi_reg.clearBits32(MI_INTR_REG, MI_INTR_VI);
        n64js.cpu0.updateCause3();
        break;

      default:
        this.mem.write32(ea, value);
        break;
    }
  };

  vi_reg_handler_uncached.readS32 = function (address) {
    this.logRead(address);
    var ea = this.calcEA(address);

    if (ea+4 > this.u8.length) {
      throw 'Read is out of range';
    }
    var value = this.mem.readS32(ea);
    if (ea === VI_CURRENT_REG) {
      value = (value + 2) % 512;
      this.mem.write32(ea, value);
    }
    return value;
  };

  vi_reg_handler_uncached.readU32 = function (address) {
    return this.readS32(address)>>>0;
  };


  pi_reg_handler_uncached.write32 = function (address, value) {
    var ea = this.calcEA(address);
    if (ea+4 > this.u8.length) {
      throw 'Write is out of range';
    }
    switch( ea ) {
      case PI_DRAM_ADDR_REG:
      case PI_CART_ADDR_REG:
        if (!this.quiet) { n64js.log('Writing to PIReg: ' + toString32(value) + ' -> [' + toString32(address) + ']' ); }
        this.mem.write32(ea, value);
        break;
      case PI_RD_LEN_REG:
        this.mem.write32(ea, value);
        n64js.halt('PI copy from rdram triggered!');
        break;
      case PI_WR_LEN_REG:
        this.mem.write32(ea, value);
        piCopyToRDRAM();
        break;
      case PI_STATUS_REG:
        if (value & PI_STATUS_RESET) {
          if (!this.quiet) { n64js.log('PI_STATUS_REG reset'); }
          this.mem.write32(PI_STATUS_REG, 0);
        }
        if (value & PI_STATUS_CLR_INTR) {
          if (!this.quiet) { n64js.log('PI interrupt cleared'); }
          mi_reg.clearBits32(MI_INTR_REG, MI_INTR_PI);
          n64js.cpu0.updateCause3();
        }

        break;
      default:
        n64js.log('Unhandled write to PIReg: ' + toString32(value) + ' -> [' + toString32(address) + ']' );
        this.mem.write32(ea, value);
        break;
    }

  };

  function siCopyFromRDRAM() {
    var dram_address = si_reg.readU32(SI_DRAM_ADDR_REG) & 0x1fffffff;
    var pi_ram       = new Uint8Array(pi_mem.arrayBuffer, 0x7c0, 0x040);

    if (!si_reg_handler_uncached.quiet) { n64js.log('SI: copying from ' + toString32(dram_address) + ' to PI RAM'); }

    var i;
    for (i = 0; i < 64; ++i) {
      pi_ram[i] = ram.u8[dram_address+i];
    }

    var control_byte = pi_ram[0x3f];
    if (control_byte > 0) {
      if (!si_reg_handler_uncached.quiet) { n64js.log('SI: wrote ' + control_byte + ' to the control byte'); }
    }

    si_reg.setBits32(SI_STATUS_REG, SI_STATUS_INTERRUPT);
    mi_reg.setBits32(MI_INTR_REG, MI_INTR_SI);
    n64js.cpu0.updateCause3();
  }

  function siCopyToRDRAM() {

    // Update controller state here
    updateController();

    var dram_address = si_reg.readU32(SI_DRAM_ADDR_REG) & 0x1fffffff;
    var pi_ram       = new Uint8Array(pi_mem.arrayBuffer, 0x7c0, 0x040);

    if (!si_reg_handler_uncached.quiet) { n64js.log('SI: copying from PI RAM to ' + toString32(dram_address)); }

    var i;
    for (i = 0; i < 64; ++i) {
      ram.u8[dram_address+i] = pi_ram[i];
    }

    si_reg.setBits32(SI_STATUS_REG, SI_STATUS_INTERRUPT);
    mi_reg.setBits32(MI_INTR_REG, MI_INTR_SI);
    n64js.cpu0.updateCause3();
  }


  var PC_CONTROLLER_0      = 0;
  var PC_CONTROLLER_1      = 1;
  var PC_CONTROLLER_2      = 2;
  var PC_CONTROLLER_3      = 3;
  var PC_EEPROM            = 4;
  var PC_UNKNOWN_1         = 5;
  var NUM_CHANNELS         = 5;

  var CONT_GET_STATUS      = 0x00;
  var CONT_READ_CONTROLLER = 0x01;
  var CONT_READ_MEMPACK    = 0x02;
  var CONT_WRITE_MEMPACK   = 0x03;
  var CONT_READ_EEPROM     = 0x04;
  var CONT_WRITE_EEPROM    = 0x05;
  var CONT_RTC_STATUS      = 0x06;
  var CONT_RTC_READ        = 0x07;
  var CONT_RTC_WRITE       = 0x08;
  var CONT_RESET           = 0xff;

  var CONT_TX_SIZE_CHANSKIP   = 0x00;         // Channel Skip
  var CONT_TX_SIZE_DUMMYDATA  = 0xFF;         // Dummy Data
  var CONT_TX_SIZE_FORMAT_END = 0xFE;         // Format End
  var CONT_TX_SIZE_CHANRESET  = 0xFD;         // Channel Reset

  function updateController() {

    // read controllers

    var pi_ram = new Uint8Array(pi_mem.arrayBuffer, 0x7c0, 0x040);

    var count   = 0;
    var channel = 0;
    while (count < 64) {
      var cmd = pi_ram.subarray(count);

      if (cmd[0] === CONT_TX_SIZE_FORMAT_END) {
        count = 64;
        break;
      }

      if ((cmd[0] === CONT_TX_SIZE_DUMMYDATA) || (cmd[0] === CONT_TX_SIZE_CHANRESET)) {
        count++;
        continue;
      }

      if (cmd[0] === CONT_TX_SIZE_CHANSKIP) {
        count++;
        channel++;
        continue;
      }

      // 0-3: controller channels
      if (channel < PC_EEPROM) {
        // copy controller status
        if (!processController(cmd, channel)) {
          count = 64;
          break;
        }
      } else if (channel === PC_EEPROM) {
        if (!processEeprom(cmd)) {
          count = 64;
          break;
        }
        break;
      } else {
        n64js.halt('Trying to read from invalid controller channel ' + channel + '!');
        return;
      }

      channel++;
      count += cmd[0] + (cmd[1]&0x3f) + 2;
    }

    pi_ram[63] = 0;
  }

  var controllers = [{buttons: 0, stick_x: 0, stick_y: 0, present:true, mempack:true},
                     {buttons: 0, stick_x: 0, stick_y: 0, present:true, mempack:false},
                     {buttons: 0, stick_x: 0, stick_y: 0, present:true, mempack:false},
                     {buttons: 0, stick_x: 0, stick_y: 0, present:true, mempack:false}];

  var mempack_memory = [
    new Uint8Array(0x400 * 32),
    new Uint8Array(0x400 * 32),
    new Uint8Array(0x400 * 32),
    new Uint8Array(0x400 * 32)
  ];

  var kButtonA      = 0x8000;
  var kButtonB      = 0x4000;
  var kButtonZ      = 0x2000;
  var kButtonStart  = 0x1000;
  var kButtonJUp    = 0x0800;
  var kButtonJDown  = 0x0400;
  var kButtonJLeft  = 0x0200;
  var kButtonJRight = 0x0100;

  var kButtonL      = 0x0020;
  var kButtonR      = 0x0010;
  var kButtonCUp    = 0x0008;
  var kButtonCDown  = 0x0004;
  var kButtonCLeft  = 0x0002;
  var kButtonCRight = 0x0001;

  var kKeyLeft      = 37;
  var kKeyUp        = 38;
  var kKeyRight     = 39;
  var kKeyDown      = 40;


  n64js.handleKey = function (key, down) {
    var button = 0;
    switch (key) {
      case 'A'.charCodeAt(0): button = kButtonStart;  break;
      case 'S'.charCodeAt(0): button = kButtonA;      break;
      case 'X'.charCodeAt(0): button = kButtonB;      break;
      case 'Z'.charCodeAt(0): button = kButtonZ;      break;
      case 'Y'.charCodeAt(0): button = kButtonZ;      break;
      case 'C'.charCodeAt(0): button = kButtonL;      break;
      case 'V'.charCodeAt(0): button = kButtonR;      break;

      case 'T'.charCodeAt(0): button = kButtonJUp;    break;
      case 'G'.charCodeAt(0): button = kButtonJDown;  break;
      case 'F'.charCodeAt(0): button = kButtonJLeft;  break;
      case 'H'.charCodeAt(0): button = kButtonJRight; break;

      case 'I'.charCodeAt(0): button = kButtonCUp;    break;
      case 'K'.charCodeAt(0): button = kButtonCDown;  break;
      case 'J'.charCodeAt(0): button = kButtonCLeft;  break;
      case 'L'.charCodeAt(0): button = kButtonCRight; break;

      case kKeyLeft:  controllers[0].stick_x = down ? -80 : 0; break;
      case kKeyRight: controllers[0].stick_x = down ? +80 : 0; break;
      case kKeyDown:  controllers[0].stick_y = down ? -80 : 0; break;
      case kKeyUp:    controllers[0].stick_y = down ? +80 : 0; break;
      //default: n64js.log( 'up code:' + event.which);
    }

    if (button) {
      var buttons = controllers[0].buttons;

      if (down) {
        buttons |= button;
      } else {
        buttons &= ~button;
      }
      controllers[0].buttons = buttons;
    }
  };

  function processController(cmd, channel) {
    if (!controllers[channel].present)
    {
      cmd[1] |= 0x80;
      cmd[3]  = 0xff;
      cmd[4]  = 0xff;
      cmd[5]  = 0xff;
      return true;
    }

    var buttons, stick_x, stick_y;

    switch (cmd[2]) {
      case CONT_RESET:
      case CONT_GET_STATUS:
        cmd[3] = 0x05;
        cmd[4] = 0x00;
        cmd[5] = controllers[channel].mempack ? 0x01 : 0x00;
        break;

      case CONT_READ_CONTROLLER:

        buttons = controllers[channel].buttons;
        stick_x = controllers[channel].stick_x;
        stick_y = controllers[channel].stick_y;

        if (syncInput) {
          syncInput.sync32(0xbeeff00d, 'input');
          buttons = syncInput.reflect32(buttons); // FIXME reflect16
          stick_x = syncInput.reflect32(stick_x); // FIXME reflect8
          stick_y = syncInput.reflect32(stick_y); // FIXME reflect8
        }

        cmd[3] = buttons >>> 8;
        cmd[4] = buttons & 0xff;
        cmd[5] = stick_x;
        cmd[6] = stick_y;
        break;

      case CONT_READ_MEMPACK:
        if (gEnableRumble) {
          commandReadRumblePack(cmd);
        } else {
          commandReadMemPack(cmd, channel);
        }
        return false;
      case CONT_WRITE_MEMPACK:
        if (gEnableRumble) {
          commandWriteRumblePack(cmd);
        } else {
          commandWriteMemPack(cmd, channel);
        }
        return false;
      default:
        n64js.halt('Unknown controller command ' + cmd[2]);
        break;
    }

    return true;
  }

  function processEeprom(cmd) {
    var i, offset;

    switch(cmd[2])
    {
    case CONT_RESET:
    case CONT_GET_STATUS:
      cmd[3] = 0x00;
      cmd[4] = 0x80; /// FIXME GetEepromContType();
      cmd[5] = 0x00;
      break;

    case CONT_READ_EEPROM:
      offset = cmd[3]*8;
      n64js.log('Reading from eeprom+' + offset);
      for (i = 0; i < 8; ++i) {
        cmd[4+i] = eeprom.u8[offset+i];
      }
      break;

    case CONT_WRITE_EEPROM:
      offset = cmd[3]*8;
      n64js.log('Writing to eeprom+' + offset);
      for (i = 0; i < 8; ++i) {
        eeprom.u8[offset+i] = cmd[4+i];
      }
      eepromDirty = true;
      break;

    // RTC credit: Mupen64 source
    //
    case CONT_RTC_STATUS: // RTC status query
        cmd[3] = 0x00;
        cmd[4] = 0x10;
        cmd[5] = 0x00;
      break;

    case CONT_RTC_READ: // read RTC block
      n64js.halt('rtc read unhandled');
      //CommandReadRTC( cmd );
      break;

    case CONT_RTC_WRITE:  // write RTC block
      n64js.halt('rtc write unhandled');
      break;

    default:
      n64js.halt('unknown eeprom command: ' + toString8(cmd[2]));
      break;
    }

    return false;
  }

  function calculateDataCrc(buf, offset)
  {
    var c = 0, i;
    for (i = 0; i < 32; i++) {
      var s = buf[offset+i];

      c = (((c << 1) | ((s >> 7) & 1))) ^ ((c & 0x80) ? 0x85 : 0);
      c = (((c << 1) | ((s >> 6) & 1))) ^ ((c & 0x80) ? 0x85 : 0);
      c = (((c << 1) | ((s >> 5) & 1))) ^ ((c & 0x80) ? 0x85 : 0);
      c = (((c << 1) | ((s >> 4) & 1))) ^ ((c & 0x80) ? 0x85 : 0);
      c = (((c << 1) | ((s >> 3) & 1))) ^ ((c & 0x80) ? 0x85 : 0);
      c = (((c << 1) | ((s >> 2) & 1))) ^ ((c & 0x80) ? 0x85 : 0);
      c = (((c << 1) | ((s >> 1) & 1))) ^ ((c & 0x80) ? 0x85 : 0);
      c = (((c << 1) | ((s >> 0) & 1))) ^ ((c & 0x80) ? 0x85 : 0);
    }

    for (i = 8; i !== 0; i--) {
      c = (c << 1) ^ ((c & 0x80) ? 0x85 : 0);
    }

    return c;
  }

  function commandReadMemPack(cmd, channel) {
    var addr = ((cmd[3] << 8) | cmd[4]);
    var i;

    if (addr === 0x8001) {
      for (i = 0; i < 32; ++i) {
        cmd[5+i] = 0;
      }
    } else {
      n64js.log('Reading from mempack+' + addr);
      addr &= 0xFFE0;

      if (addr <= 0x7FE0) {
        for (i = 0; i < 32; ++i) {
          cmd[5+i] = mempack_memory[channel][addr+i];
        }
      } else {
        // RumblePak
        for (i = 0; i < 32; ++i) {
          cmd[5+i] = 0;
        }
      }
    }

    cmd[37] = calculateDataCrc(cmd, 5);
  }

  function commandWriteMemPack(cmd, channel) {
    var addr = ((cmd[3] << 8) | cmd[4]);
    var i;

    if (addr !== 0x8001) {
      n64js.log('Writing to mempack+' + addr);
      addr &= 0xFFE0;

      if (addr <= 0x7FE0) {
        for (i = 0; i < 32; ++i) {
          mempack_memory[channel][addr+i] = cmd[5+i];
        }
      } else {
        // Do nothing, eventually enable rumblepak
      }

    }

    cmd[37] = calculateDataCrc(cmd, 5);
  }

  function commandReadRumblePack(cmd) {
    var addr = ((cmd[3] << 8) | cmd[4]) & 0xFFE0;
    var val = (addr === 0x8000) ? 0x80 : 0x00;
    var i;
    for (i = 0; i < 32; ++i) {
      cmd[5+i] = val;
    }

    cmd[37] = calculateDataCrc(cmd, 5);
  }

  function commandWriteRumblePack(cmd) {
    var addr = ((cmd[3] << 8) | cmd[4]) & 0xFFE0;

    if (addr === 0xC000) {
      gRumblePakActive = cmd[5];
    }

    cmd[37] = calculateDataCrc(cmd, 5);
  }

  function checkSIStatusConsistent() {
    var mi_si_int_set     = mi_reg.getBits32(MI_INTR_REG,   MI_INTR_SI)          !== 0;
    var si_status_int_set = si_reg.getBits32(SI_STATUS_REG, SI_STATUS_INTERRUPT) !== 0;
    if (mi_si_int_set !== si_status_int_set) {
      n64js.halt("SI_STATUS register is in an inconsistent state");
    }
  }
  n64js.checkSIStatusConsistent = checkSIStatusConsistent;

  si_reg_handler_uncached.readS32 = function (address) {
    this.logRead(address);
    var ea = this.calcEA(address);

    if (ea+4 > this.u8.length) {
      throw 'Read is out of range';
    }
    if (ea === SI_STATUS_REG) {
      checkSIStatusConsistent();
    }
    return this.mem.readS32(ea);
  };

  si_reg_handler_uncached.readU32 = function (address) {
    return this.readS32(address)>>>0;
  };

  si_reg_handler_uncached.write32 = function (address, value) {
    var ea = this.calcEA(address);
    if (ea+4 > this.u8.length) {
      throw 'Write is out of range';
    }

    switch( ea ) {
      case SI_DRAM_ADDR_REG:
        if (!this.quiet) { n64js.log('Writing to SI dram address reigster: ' + toString32(value) ); }
        this.mem.write32(ea, value);
        break;
      case SI_PIF_ADDR_RD64B_REG:
        this.mem.write32(ea, value);
        siCopyToRDRAM();
        break;
      case SI_PIF_ADDR_WR64B_REG:
        this.mem.write32(ea, value);
        siCopyFromRDRAM();
        break;
      case SI_STATUS_REG:
        if (!this.quiet) { n64js.log('SI interrupt cleared'); }
        si_reg.clearBits32(SI_STATUS_REG, SI_STATUS_INTERRUPT);
        mi_reg.clearBits32(MI_INTR_REG,   MI_INTR_SI);
        n64js.cpu0.updateCause3();
        break;
      default:
        n64js.log('Unhandled write to SIReg: ' + toString32(value) + ' -> [' + toString32(address) + ']' );
        this.mem.write32(ea, value);
        break;
    }
  };


  function piCopyToRDRAM() {
    var dram_address = pi_reg.readU32(PI_DRAM_ADDR_REG) & 0x00ffffff;
    var cart_address = pi_reg.readU32(PI_CART_ADDR_REG);
    var transfer_len = pi_reg.readU32(PI_WR_LEN_REG) + 1;

    if (!pi_reg_handler_uncached.quiet) { n64js.log('PI: copying ' + transfer_len + ' bytes of data from ' + toString32(cart_address) + ' to ' + toString32(dram_address)); }

    if (transfer_len&1) {
      n64js.log('PI: Warning - odd address');
      transfer_len++;
    }

    var copy_succeeded = false;

    if (isDom1Addr1(cart_address)) {
      cart_address -= PI_DOM1_ADDR1;
      memoryCopy( ram, dram_address, rom, cart_address, transfer_len );
      n64js.invalidateICacheRange( 0x80000000 | dram_address, transfer_len, 'PI' );
      copy_succeeded = true;
    } else if (isDom1Addr2(cart_address)) {
      cart_address -= PI_DOM1_ADDR2;
      memoryCopy( ram, dram_address, rom, cart_address, transfer_len );
      n64js.invalidateICacheRange( 0x80000000 | dram_address, transfer_len, 'PI' );
      copy_succeeded = true;
    } else if (isDom1Addr3(cart_address)) {
      cart_address -= PI_DOM1_ADDR3;
      memoryCopy( ram, dram_address, rom, cart_address, transfer_len );
      n64js.invalidateICacheRange( 0x80000000 | dram_address, transfer_len, 'PI' );
      copy_succeeded = true;

    } else if (isDom2Addr1(cart_address)) {
      cart_address -= PI_DOM2_ADDR1;
      n64js.halt('PI: dom2addr1 transfer is unhandled (save)');

    } else if (isDom2Addr2(cart_address)) {
      cart_address -= PI_DOM2_ADDR2;
      n64js.halt('PI: dom2addr2 transfer is unhandled (save/flash)');

    } else {
      n64js.halt('PI: unknown cart address: ' + cart_address);
    }

    if (!setMemorySize) {
      var addr = (rominfo.cic === '6105') ? 0x800003F0 : 0x80000318;
      ram.write32(addr - 0x80000000, 8*1024*1024);
      n64js.log('Setting memory size');
      setMemorySize = true;
    }

    // If this is the first DMA write the ram size to 0x800003F0 (cic6105) or 0x80000318 (others)
    pi_reg.clearBits32(PI_STATUS_REG, PI_STATUS_DMA_BUSY);
    mi_reg.setBits32(MI_INTR_REG, MI_INTR_PI);
    n64js.cpu0.updateCause3();
  }

  function pifUpdateControl() {
    var pi_rom = new Uint8Array(pi_mem.arrayBuffer, 0x000, 0x7c0);
    var pi_ram = new Uint8Array(pi_mem.arrayBuffer, 0x7c0, 0x040);
    var command = pi_ram[0x3f];
    var i;

    switch (command) {
      case 0x01:
        n64js.log('PI: execute block\n');
        break;
      case 0x08:
        n64js.log('PI: interrupt control\n');
        pi_ram[0x3f] = 0x00;
        si_reg.setBits32(SI_STATUS_REG, SI_STATUS_INTERRUPT);
        mi_reg.setBits32(MI_INTR_REG,   MI_INTR_SI);
        n64js.cpu0.updateCause3();
        break;
      case 0x10:
        n64js.log('PI: clear rom\n');
        for(i = 0; i < pi_rom.length; ++i) {
          pi_rom[i] = 0;
        }
        break;
      case 0x30:
        n64js.log('PI: set 0x80 control \n');
        pi_ram[0x3f] = 0x80;
        break;
      case 0xc0:
        n64js.log('PI: clear ram\n');
        for(i = 0; i < pi_ram.length; ++i) {
          pi_ram[i] = 0;
        }
        break;
      default:
        n64js.halt('Unkown PI control value: ' + toString8(command));
        break;
    }
  }

  pi_mem_handler_uncached.readS32 = function (address) {
    var ea = this.calcEA(address);

    if (ea+4 > this.u8.length) {
      throw 'Read is out of range';
    }
    var v = this.mem.readS32(ea);

    if (ea < 0x7c0) {
      n64js.log('Reading from PIF rom (' + toString32(address) + '). Got ' + toString32(v));
    } else {
      var ram_offset = ea - 0x7c0;
      switch(ram_offset) {
        case 0x24:  n64js.log('Reading CIC values: '   + toString32(v)); break;
        case 0x3c:  n64js.log('Reading Control byte: ' + toString32(v)); break;
        default:    n64js.log('Reading from PI ram ['  + toString32(address) + ']. Got ' + toString32(v));
      }
    }
    return v;
  };

  pi_mem_handler_uncached.readU32 = function (address) {
    return this.readS32(address)>>>0;
  };

  pi_mem_handler_uncached.readS8 = function (address) {
    var ea = this.calcEA(address);

    var v = pi_mem.readU8(ea);

    if (ea < 0x7c0) {
      n64js.log('Reading from PIF rom (' + toString32(address) + '). Got ' + toString8(v));
    } else {
      var ram_offset = ea - 0x7c0;
      switch(ram_offset) {
        case 0x24:  n64js.log('Reading CIC values: '   + toString8(v)); break;
        case 0x3c:  n64js.log('Reading Control byte: ' + toString8(v)); break;
        default:    n64js.log('Reading from PI ram ['  + toString32(address) + ']. Got ' + toString8(v));
      }
    }
    return v;
  };

  pi_mem_handler_uncached.readU8 = function (address) {
    return this.mem.readS8(address)>>>0;
  };
  pi_mem_handler_uncached.write32 = function (address, value) {
    var ea = this.calcEA(address);

    if (ea < 0x7c0) {
      n64js.log('Attempting to write to PIF ROM');
    } else {
      var ram_offset = ea - 0x7c0;
      this.mem.write32(ea, value);
      switch(ram_offset) {
      case 0x24:  n64js.log('Writing CIC values: '   + toString32(value) ); break;
      case 0x3c:  n64js.log('Writing Control byte: ' + toString32(value) ); pifUpdateControl(); break;
      default:    n64js.log('Writing directly to PI ram [' + toString32(address) + '] <-- ' + toString32(value)); break;
      }
    }
  };

  // We create a memory map of 1<<14 entries, corresponding to the top bits of the address range.
  var memMap = (function () {
    var map = [];
    var i;
    for (i = 0; i < 0x4000; ++i) {
      map.push(undefined);
    }

    [
     mapped_mem_handler,
          rdram_handler_cached,
          rdram_handler_uncached,
         sp_mem_handler_uncached,
         sp_reg_handler_uncached,
       sp_ibist_handler_uncached,
            dpc_handler_uncached,
            dps_handler_uncached,
      rdram_reg_handler_uncached,
         mi_reg_handler_uncached,
         vi_reg_handler_uncached,
         ai_reg_handler_uncached,
         pi_reg_handler_uncached,
         ri_reg_handler_uncached,
         si_reg_handler_uncached,
       rom_d2a1_handler_uncached,
       rom_d2a2_handler_uncached,
       rom_d1a1_handler_uncached,
       rom_d1a2_handler_uncached,
       rom_d1a3_handler_uncached,
         pi_mem_handler_uncached
    ].map(function (e){
        var i;
        var beg = (e.rangeStart)>>>18;
        var end = (e.rangeEnd-1)>>>18;
        for (i = beg; i <= end; ++i) {
          map[i] = e;
        }
    });

    if (map.length !== 0x4000) {
      throw 'initialisation error';
    }

    return map;

  }());

  function getMemoryHandler(address) {
    //assert(address>=0, "Address is negative");
    var handler = memMap[address >>> 18];
    if (handler) {
      return handler;
    }

    n64js.log('read from unhandled location ' + toString32(address));
    throw 'unmapped read ' + toString32(address) + ' - need to set exception';
  }

  // Read/Write memory internal is used for stuff like the debugger. It shouldn't ever throw or change the state of the emulated program.
  n64js.readMemoryInternal32 = function (address) {
    var handler = memMap[address >>> 18];
    if (handler) {
      return handler.readInternal32(address);
    }
    return 0xdddddddd;
  };

  n64js.writeMemoryInternal32 = function (address, value) {
    var handler = memMap[address >>> 18];
    if (handler) {
      handler.writeInternal32(address, value);
    }
  };

  n64js.getInstruction = function (address) {
    var instruction = n64js.readMemoryInternal32(address);
    if (((instruction>>26)&0x3f) === kOpBreakpoint) {
      instruction = breakpoints[address] || 0;
    }

    return instruction;
  };

  n64js.isBreakpoint = function (address) {
    var orig_op = n64js.readMemoryInternal32(address);
    return ((orig_op>>26)&0x3f) === kOpBreakpoint;
  };

  n64js.toggleBreakpoint = function (address) {
    var orig_op = n64js.readMemoryInternal32(address);
    var new_op;

    if (((orig_op>>26)&0x3f) === kOpBreakpoint) {
      // breakpoint is already set
      new_op = breakpoints[address] || 0;
      delete breakpoints[address];
    } else {
      new_op = (kOpBreakpoint<<26);
      breakpoints[address] = orig_op;
    }

    n64js.writeMemoryInternal32(address, new_op);
  };

  // 'emulated' read. May cause exceptions to be thrown in the emulated process
  n64js.readMemoryU32 = function (address) { return getMemoryHandler(address).readU32(address); };
  n64js.readMemoryU16 = function (address) { return getMemoryHandler(address).readU16(address); };
  n64js.readMemoryU8  = function (address) { return getMemoryHandler(address).readU8(address);  };

  n64js.readMemoryS32 = function (address) { return getMemoryHandler(address).readS32(address); };
  n64js.readMemoryS16 = function (address) { return getMemoryHandler(address).readS16(address); };
  n64js.readMemoryS8  = function (address) { return getMemoryHandler(address).readS8(address);  };

  // 'emulated' write. May cause exceptions to be thrown in the emulated process
  n64js.writeMemory32 = function (address, value) { return getMemoryHandler(address).write32(address, value); };
  n64js.writeMemory16 = function (address, value) { return getMemoryHandler(address).write16(address, value); };
  n64js.writeMemory8  = function (address, value) { return getMemoryHandler(address).write8(address, value); };

  var Base64 = {
    lookup : "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",
    encodeArray : function (arr) {
      var t = '';
      var i;
      for (i = 0; i < arr.length; i += 3) {
        var c0 = arr[i+0];
        var c1 = arr[i+1];
        var c2 = arr[i+2];

        // aaaaaabb bbbbcccc ccdddddd
        var a = c0>>>2;
        var b = ((c0 & 3)<<4) | (c1>>>4);
        var c = ((c1 & 15)<<2) | (c2>>>6);
        var d = c2 & 63;

        if (i+1 >= arr.length) {
          c = 64;
        }
        if (i+2 >= arr.length) {
          d = 64;
        }

        t += this.lookup.charAt(a) + this.lookup.charAt(b) + this.lookup.charAt(c) + this.lookup.charAt(d);
      }
      return t;
    },

    decodeArray : function (str, arr) {
      var outi = 0;

      var i;
      for (i = 0; i < str.length; i += 4) {
        var a = this.lookup.indexOf(str.charAt(i+0));
        var b = this.lookup.indexOf(str.charAt(i+1));
        var c = this.lookup.indexOf(str.charAt(i+2));
        var d = this.lookup.indexOf(str.charAt(i+3));

        var c0 = (a << 2) | (b >>> 4);
        var c1 = ((b & 15) << 4) | (c >>> 2);
        var c2 = ((c & 3) << 6) | d;

        arr[outi++] = c0;
        if (c !== 64) {
          arr[outi++] = c1;
        }
        if (d !== 64) {
          arr[outi++] = c2;
        }
      }
    }
  };

  function getLocalStorageName(item) {
    return item + '-' + rominfo.id;
  }

  n64js.getLocalStorageItem = function(name) {
    var ls_name  = getLocalStorageName(name);
    var data_str = localStorage.getItem(ls_name);
    var data     = data_str ? JSON.parse(data_str) : undefined;
    return data;
  };

  n64js.setLocalStorageItem = function(name, data) {
    var ls_name = getLocalStorageName(name);
    var data_str = JSON.stringify(data);
    localStorage.setItem(ls_name, data_str);
  };

  function initEeprom(size, eeprom_data) {
    var memory = new Memory(new ArrayBuffer(size));
    if (eeprom_data && eeprom_data.data) {
      Base64.decodeArray(eeprom_data.data, memory.u8);
    }
    return memory;
  }

  function initSaveGame(save_type) {
    eeprom      = null;
    eepromDirty = false;

    if (save_type) {
      switch (save_type) {
        case 'Eeprom4k':
          eeprom = initEeprom(4*1024, n64js.getLocalStorageItem('eeprom'));
          break;
        case 'Eeprom16k':
          eeprom = initEeprom(16*1024, n64js.getLocalStorageItem('eeprom'));
          break;

        default:
          n64js.displayWarning('Unhandled savegame type: ' + save_type + '.');
      }
    }
  }

  function saveEeprom() {
    if (eeprom && eepromDirty) {

      var encoded = Base64.encodeArray(eeprom.u8);

      // Store the name and id so that we can provide some kind of save management in the future
      var d = {
        name: rominfo.name,
        id:   rominfo.id,
        data: encoded
      };

      n64js.setLocalStorageItem('eeprom', d);
      eepromDirty = false;
    }
  }

  //
  // Performance
  //
  var startTime;
  var lastPresentTime;
  var frameTimeSeries;

  n64js.emitRunningTime  = function (msg) {
    var cur_time = new Date();
    n64js.displayWarning('Time to ' + msg + ' ' + (cur_time.getTime() - startTime.getTime()).toString());
  };

  function setFrameTime(t) {
    var title_text ;
    if (rominfo.name)
      title_text = 'n64js - ' + rominfo.name + ' - ' + t + 'mspf';
    else
      title_text = 'n64js - ' + t + 'mspf';

    $('#title').text(title_text);
  }

  n64js.onPresent = function () {
    var cur_time = new Date();
    if (lastPresentTime) {
      var t = cur_time.getTime() - lastPresentTime.getTime();
      setFrameTime(t);
    }

    lastPresentTime = cur_time;
  };

  n64js.addResetCallback = function (fn) {
    resetCallbacks.push(fn);
  };

  n64js.reset = function () {
    var country  = rominfo.country;
    var cic_chip = rominfo.cic;

    breakpoints = {};

    initSync();

    setMemorySize = false;

    initSaveGame(rominfo.save);

    // NB: don't set eeprom to 0 - we handle this in initSaveGame
    var memory_regions = [ pi_mem, ram, sp_mem, sp_reg, sp_ibist_mem, rdram_reg, mi_reg, vi_reg, ai_reg, pi_reg, ri_reg, si_reg ];
    var i;
    for (i = 0; i < memory_regions.length; ++i) {
      memory_regions[i].clear();
    }

    n64js.cpu0.reset();
    n64js.cpu1.reset();

    n64js.resetRenderer();

    mi_reg.write32(MI_VERSION_REG, 0x02020102);
    ri_reg.write32(RI_SELECT_REG, 1);           // This skips most of init

    // Simulate boot

    if (rom) {
      memoryCopy( sp_mem, kBootstrapOffset, rom, kBootstrapOffset, kGameOffset - kBootstrapOffset );
    }

    var cpu0 = n64js.cpu0;

    function setGPR(reg, hi, lo) {
      cpu0.gprHi[reg] = hi;
      cpu0.gprLo[reg] = lo;
    }

    cpu0.control[cpu0.kControlSR]       = 0x34000000;
    cpu0.control[cpu0.kControlConfig]   = 0x0006E463;
    cpu0.control[cpu0.kControlCount]    = 0x5000;
    cpu0.control[cpu0.kControlCause]    = 0x0000005c;
    cpu0.control[cpu0.kControlContext]  = 0x007FFFF0;
    cpu0.control[cpu0.kControlEPC]      = 0xFFFFFFFF;
    cpu0.control[cpu0.kControlBadVAddr] = 0xFFFFFFFF;
    cpu0.control[cpu0.kControlErrorEPC] = 0xFFFFFFFF;

    setGPR(0, 0x00000000, 0x00000000);
    setGPR(6, 0xFFFFFFFF, 0xA4001F0C);
    setGPR(7, 0xFFFFFFFF, 0xA4001F08);
    setGPR(8, 0x00000000, 0x000000C0);
    setGPR(9, 0x00000000, 0x00000000);
    setGPR(10, 0x00000000, 0x00000040);
    setGPR(11, 0xFFFFFFFF, 0xA4000040);
    setGPR(16, 0x00000000, 0x00000000);
    setGPR(17, 0x00000000, 0x00000000);
    setGPR(18, 0x00000000, 0x00000000);
    setGPR(19, 0x00000000, 0x00000000);
    setGPR(21, 0x00000000, 0x00000000);
    setGPR(26, 0x00000000, 0x00000000);
    setGPR(27, 0x00000000, 0x00000000);
    setGPR(28, 0x00000000, 0x00000000);
    setGPR(29, 0xFFFFFFFF, 0xA4001FF0);
    setGPR(30, 0x00000000, 0x00000000);

    switch (country) {
      case 0x44: //Germany
      case 0x46: //french
      case 0x49: //Italian
      case 0x50: //Europe
      case 0x53: //Spanish
      case 0x55: //Australia
      case 0x58: // ????
      case 0x59: // X (PAL)
        switch (cic_chip) {
          case '6102':
            setGPR(5, 0xFFFFFFFF, 0xC0F1D859);
            setGPR(14, 0x00000000, 0x2DE108EA);
            setGPR(24, 0x00000000, 0x00000000);
            break;
          case '6103':
            setGPR(5, 0xFFFFFFFF, 0xD4646273);
            setGPR(14, 0x00000000, 0x1AF99984);
            setGPR(24, 0x00000000, 0x00000000);
            break;
          case '6105':
            //*(u32 *)&pIMemBase[0x04] = 0xBDA807FC;
            setGPR(5, 0xFFFFFFFF, 0xDECAAAD1);
            setGPR(14, 0x00000000, 0x0CF85C13);
            setGPR(24, 0x00000000, 0x00000002);
            break;
          case '6106':
            setGPR(5, 0xFFFFFFFF, 0xB04DC903);
            setGPR(14, 0x00000000, 0x1AF99984);
            setGPR(24, 0x00000000, 0x00000002);
            break;
          default:
            break;
        }

        setGPR(20, 0x00000000, 0x00000000);
        setGPR(23, 0x00000000, 0x00000006);
        setGPR(31, 0xFFFFFFFF, 0xA4001554);
        break;
      case 0x37: // 7 (Beta)
      case 0x41: // ????
      case 0x45: //USA
      case 0x4A: //Japan
      default:
        switch (cic_chip) {
          case '6102':
            setGPR(5, 0xFFFFFFFF, 0xC95973D5);
            setGPR(14, 0x00000000, 0x2449A366);
            break;
          case '6103':
            setGPR(5, 0xFFFFFFFF, 0x95315A28);
            setGPR(14, 0x00000000, 0x5BACA1DF);
            break;
          case '6105':
            //*(u32  *)&pIMemBase[0x04] = 0x8DA807FC;
            setGPR(5, 0x00000000, 0x5493FB9A);
            setGPR(14, 0xFFFFFFFF, 0xC2C20384);
            break;
          case '6106':
            setGPR(5, 0xFFFFFFFF, 0xE067221F);
            setGPR(14, 0x00000000, 0x5CD2B70F);
            break;
          default:
            break;
        }
        setGPR(20, 0x00000000, 0x00000001);
        setGPR(23, 0x00000000, 0x00000000);
        setGPR(24, 0x00000000, 0x00000003);
        setGPR(31, 0xFFFFFFFF, 0xA4001550);
    }


    switch (cic_chip) {
      case '6101':
        setGPR(22, 0x00000000, 0x0000003F);
        break;
      case '6102':
        setGPR(1, 0x00000000, 0x00000001);
        setGPR(2, 0x00000000, 0x0EBDA536);
        setGPR(3, 0x00000000, 0x0EBDA536);
        setGPR(4, 0x00000000, 0x0000A536);
        setGPR(12, 0xFFFFFFFF, 0xED10D0B3);
        setGPR(13, 0x00000000, 0x1402A4CC);
        setGPR(15, 0x00000000, 0x3103E121);
        setGPR(22, 0x00000000, 0x0000003F);
        setGPR(25, 0xFFFFFFFF, 0x9DEBB54F);
        break;
      case '6103':
        setGPR(1, 0x00000000, 0x00000001);
        setGPR(2, 0x00000000, 0x49A5EE96);
        setGPR(3, 0x00000000, 0x49A5EE96);
        setGPR(4, 0x00000000, 0x0000EE96);
        setGPR(12, 0xFFFFFFFF, 0xCE9DFBF7);
        setGPR(13, 0xFFFFFFFF, 0xCE9DFBF7);
        setGPR(15, 0x00000000, 0x18B63D28);
        setGPR(22, 0x00000000, 0x00000078);
        setGPR(25, 0xFFFFFFFF, 0x825B21C9);
        break;
      case '6105':
        //*(u32  *)&pIMemBase[0x00] = 0x3C0DBFC0;
        //*(u32  *)&pIMemBase[0x08] = 0x25AD07C0;
        //*(u32  *)&pIMemBase[0x0C] = 0x31080080;
        //*(u32  *)&pIMemBase[0x10] = 0x5500FFFC;
        //*(u32  *)&pIMemBase[0x14] = 0x3C0DBFC0;
        //*(u32  *)&pIMemBase[0x18] = 0x8DA80024;
        //*(u32  *)&pIMemBase[0x1C] = 0x3C0BB000;
        setGPR(1, 0x00000000, 0x00000000);
        setGPR(2, 0xFFFFFFFF, 0xF58B0FBF);
        setGPR(3, 0xFFFFFFFF, 0xF58B0FBF);
        setGPR(4, 0x00000000, 0x00000FBF);
        setGPR(12, 0xFFFFFFFF, 0x9651F81E);
        setGPR(13, 0x00000000, 0x2D42AAC5);
        setGPR(15, 0x00000000, 0x56584D60);
        setGPR(22, 0x00000000, 0x00000091);
        setGPR(25, 0xFFFFFFFF, 0xCDCE565F);
        break;
      case '6106':
        setGPR(1, 0x00000000, 0x00000000);
        setGPR(2, 0xFFFFFFFF, 0xA95930A4);
        setGPR(3, 0xFFFFFFFF, 0xA95930A4);
        setGPR(4, 0x00000000, 0x000030A4);
        setGPR(12, 0xFFFFFFFF, 0xBCB59510);
        setGPR(13, 0xFFFFFFFF, 0xBCB59510);
        setGPR(15, 0x00000000, 0x7A3C07F4);
        setGPR(22, 0x00000000, 0x00000085);
        setGPR(25, 0x00000000, 0x465E3F72);
        break;
      default:
        break;
    }

    cpu0.pc = 0xA4000040;

    startTime = new Date();
    lastPresentTime = undefined;

    for (i = 0; i < resetCallbacks.length; ++i) {
      resetCallbacks[i]();
    }
  };


  n64js.verticalBlank = function () {
    // FIXME: framerate limit etc

    saveEeprom();

    mi_reg.setBits32(MI_INTR_REG, MI_INTR_VI);
    n64js.cpu0.updateCause3();

    ++cur_vbl;
  };

  n64js.padString  = padString;
  n64js.toHex      = toHex;
  n64js.toString8  = toString8;
  n64js.toString16 = toString16;
  n64js.toString32 = toString32;
  n64js.toString64 = toString64;

  n64js.miInterruptsUnmasked = function () {
    return (mi_reg.readU32(MI_INTR_MASK_REG) & mi_reg.readU32(MI_INTR_REG)) !== 0;
  };

  n64js.miIntrReg = function () {
    return mi_reg.readU32(MI_INTR_REG);
  };

  n64js.miIntrMaskReg = function () {
    return mi_reg.readU32(MI_INTR_MASK_REG);
  };

  n64js.viOrigin = function () { return vi_reg.readU32(VI_ORIGIN_REG); };
  n64js.viWidth  = function () { return vi_reg.readU32(VI_WIDTH_REG); };
  n64js.viXScale = function () { return vi_reg.readU32(VI_X_SCALE_REG); };
  n64js.viYScale = function () { return vi_reg.readU32(VI_Y_SCALE_REG); };
  n64js.viHStart = function () { return vi_reg.readU32(VI_H_START_REG); };
  n64js.viVStart = function () { return vi_reg.readU32(VI_V_START_REG); };

  n64js.haltSP = function () {
    var status = sp_reg.setBits32(SP_STATUS_REG, SP_STATUS_TASKDONE|SP_STATUS_BROKE|SP_STATUS_HALT);
    if (status & SP_STATUS_INTR_BREAK) {
      mi_reg.setBits32(MI_INTR_REG, MI_INTR_SP);
      n64js.cpu0.updateCause3();
    }
  };

  n64js.interruptDP = function () {
    mi_reg.setBits32(MI_INTR_REG, MI_INTR_DP);
    n64js.cpu0.updateCause3();
  };

  n64js.assert = assert;

  n64js.check = function (e, m) {
    if (!e) {
      n64js.log(m);
    }
  };

  n64js.warn = function (m) {
    n64js.log(m);
  };

  n64js.stopForBreakpoint = function () {
    running = false;
    n64js.cpu0.breakExecution();
    n64js.log('<span style="color:red">Breakpoint</span>');
  };

  n64js.halt = function (msg) {
    running = false;
    n64js.cpu0.breakExecution();
    n64js.log('<span style="color:red">' + msg + '</span>');

    n64js.displayError(msg);
  };

  n64js.displayWarning = function (message) {
    var $alert = $('<div class="alert"><button class="close" data-dismiss="alert">×</button><strong>Warning!</strong> ' + message + '</div>');
    $('#alerts').append($alert);
  };
  n64js.displayError = function (message) {
    var $alert = $('<div class="alert alert-error"><button class="close" data-dismiss="alert">×</button><strong>Error!</strong> ' + message + '</div>');
    $('#alerts').append($alert);
  };

  // Similar to halt, but just relinquishes control to the system
  n64js.returnControlToSystem = function () {
    n64js.cpu0.breakExecution();
  };

  n64js.init = function () {

    rdram_handler_cached.quiet      = true;
    rdram_handler_uncached.quiet    = true;
    sp_mem_handler_uncached.quiet   = true;
    sp_reg_handler_uncached.quiet   = true;
    sp_ibist_handler_uncached.quiet = true;
    mi_reg_handler_uncached.quiet   = true;
    vi_reg_handler_uncached.quiet   = true;
    ai_reg_handler_uncached.quiet   = true;
    pi_reg_handler_uncached.quiet   = true;
    si_reg_handler_uncached.quiet   = true;
    rom_d1a2_handler_uncached.quiet = true;
    dpc_handler_uncached.quiet      = true;

    n64js.reset();

    $('.debug').hide();

    n64js.initialiseDebugger();

    n64js.initialiseRenderer($('#display'));

    $('body').keyup(function (event) {
      n64js.handleKey(event.which, false);
    });
    $('body').keydown(function (event) {
      n64js.handleKey(event.which, true);
    });
    // $('body').keypress(function (event) {
    //   switch (event.which) {
    //     case 'o'.charCodeAt(0): $('#output-tab').tab('show'); break;
    //     case 'd'.charCodeAt(0): $( '#debug-tab').tab('show'); break;
    //     case 'm'.charCodeAt(0): $('#memory-tab').tab('show'); break;
    //     case 'l'.charCodeAt(0): n64js.triggerLoad();          break;
    //     case 'g'.charCodeAt(0): n64js.toggleRun();            break;
    //     case 's'.charCodeAt(0): n64js.step();                 break;
    //   }
    // });

    // Make sure that the tabs refresh when clicked
    $('.tabbable a').on('shown', function (e) {
      n64js.refreshDebugger();
    });

    n64js.refreshDebugger();
  };

  n64js.togglePerformance = function () {
    if (stats) {
      $('#performance').html('');
      stats = null;
    } else {
      stats = new Stats();
      stats.setMode(1); // 0: fps, 1: ms

      // Align top-left
      stats.domElement.style.position = 'relative';
      stats.domElement.style.left = '8px';
      stats.domElement.style.top = '0px';

      //document.body.appendChild( stats.domElement );
      $('#performance').append(stats.domElement);
    }
  };

}(window.n64js = window.n64js || {}));


// http://paulirish.com/2011/requestanimationframe-for-smart-animating/
// http://my.opera.com/emoller/blog/2011/12/20/requestanimationframe-for-smart-er-animating

// requestAnimationFrame polyfill by Erik Möller
// fixes from Paul Irish and Tino Zijdel
(function () {
  var lastTime = 0;
  var vendors = ['ms', 'moz', 'webkit', 'o'];
  var x;
  for (x = 0; x < vendors.length && !window.requestAnimationFrame; ++x) {
    window.requestAnimationFrame = window[vendors[x]+'RequestAnimationFrame'];
     window.cancelAnimationFrame = window[vendors[x]+'CancelAnimationFrame'] ||
                                   window[vendors[x]+'CancelRequestAnimationFrame'];
  }

  if (!window.requestAnimationFrame) {
    window.requestAnimationFrame = function (callback, element) {
        var currTime = new Date().getTime();
        var timeToCall = Math.max(0, 16 - (currTime - lastTime));
        var id = window.setTimeout(function () { callback(currTime + timeToCall); },
          timeToCall);
        lastTime = currTime + timeToCall;
        return id;
    };
  }

  if (!window.cancelAnimationFrame) {
    window.cancelAnimationFrame = function (id) {
         clearTimeout(id);
    };
  }
}());
