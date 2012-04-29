if (typeof n64js === 'undefined') {
  var n64js = {};
}

(function () {'use strict';

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

  var AI_DRAM_ADDR_REG  = 0x00;
  var AI_LEN_REG        = 0x04;
  var AI_CONTROL_REG    = 0x08;
  var AI_STATUS_REG     = 0x0C;
  var AI_DACRATE_REG    = 0x10;
  var AI_BITRATE_REG    = 0x14;

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


  function IsDom1Addr1( address )    { return address >= PI_DOM1_ADDR1 && address < PI_DOM2_ADDR2; }
  function IsDom1Addr2( address )    { return address >= PI_DOM1_ADDR2 && address < 0x1FBFFFFF;    }
  function IsDom1Addr3( address )    { return address >= PI_DOM1_ADDR3 && address < 0x7FFFFFFF;    }
  function IsDom2Addr1( address )    { return address >= PI_DOM2_ADDR1 && address < PI_DOM1_ADDR1; }
  function IsDom2Addr2( address )    { return address >= PI_DOM2_ADDR2 && address < PI_DOM1_ADDR2; }

  var SI_DRAM_ADDR_REG      = 0x00;
  var SI_PIF_ADDR_RD64B_REG = 0x04;
  var SI_PIF_ADDR_WR64B_REG = 0x10;
  var SI_STATUS_REG         = 0x18;

  var SI_STATUS_DMA_BUSY    = 0x0001;
  var SI_STATUS_RD_BUSY     = 0x0002;
  var SI_STATUS_DMA_ERROR   = 0x0008;
  var SI_STATUS_INTERRUPT   = 0x1000;

  function AssertException(message) { this.message = message; }
  AssertException.prototype.toString = function () {
    return 'AssertException: ' + this.message;
  }

  function assert(e,m) {
    if (!e) {
      throw new AssertException(m);
    }
  }
  n64js.assert = assert;

  n64js.log = function (s) {
    $output.append(toString32(n64js.cpu0.pc) + ': ' + s + '<br>');
    $output.scrollTop($output[0].scrollHeight);
  }

  n64js.check = function(e, m) {
    if (!e) {
      n64js.log(m);
    }
  }

  n64js.warn = function(m) {
    n64js.log(m);
  }

  n64js.halt = function (msg) {
    running = false;
    n64js.cpu0.halt = true;
    n64js.log(msg);
  }

  n64js.isRunning = function () {
    return running;
  }

  n64js.toggleRun = function () {
    running = !running;
    return running;
  }

  n64js.setOutputElement = function ($e) {
    $output = $e;
  }

  n64js.setRomInfoElement = function ($e) {
    $rominfo = $e;
  }   

  n64js.setRegistersElement = function ($e) {
    $registers = $e;
  }

  n64js.setDisassemblyElement = function ($e) {
    $disassembly = $e;
  }

  n64js.down = function () {
    disasmAddress += 4;
    n64js.refreshDisplay();
  }

  n64js.up = function () {
    disasmAddress -= 4;
    n64js.refreshDisplay();
  }

  n64js.pageDown = function () {
    disasmAddress += 64;
    n64js.refreshDisplay();
  }

  n64js.pageUp = function () {
    disasmAddress -= 64;
    n64js.refreshDisplay();
  } 

  function makeLabelColor(address) {
    var i = (address>>>2);  // Lowest bits are always 0
    var hash = (i>>>16) ^ ((i&0xffff) * 2803);
    var r = (hash     )&0x1f;
    var g = (hash>>> 5)&0x1f;
    var b = (hash>>>10)&0x1f;
    var h = (hash>>>15)&0x3;

    r = (r*4);
    g = (g*4);
    b = (b*4);
    if (h === 0) {
      r*=2; g*=2;
    } else if (h === 1) {
      g*=2; b*=2;
    } else if (h === 2) {
      b*=2; r*=2
    } else {
      r*=2;g*=2;b*=2;
    }

    return '#' + n64js.toHex(r,8) + n64js.toHex(g,8) + n64js.toHex(b,8);
  }

  var last_pc = -1;
  n64js.refreshDisplay = function () {

    var cpu0 = n64js.cpu0;

    // If the pc has changed since the last update, recenter the display (e.g. when we take a branch)
    if (cpu0.pc !== last_pc) {
      disasmAddress = cpu0.pc;
      last_pc = cpu0.pc;
    }

    var cur_instr;

    var disassembly = n64js.disassemble(disasmAddress - 64, disasmAddress + 64);
    var dis_body = disassembly.map(function (a) {
    
      var label_span = a.isJumpTarget ? '<span class="dis-label-target">' : '<span class="dis-label">';
      var label      = label_span    + n64js.toHex(a.instruction.address, 32) + ':</span>';
      var t          = label + '   ' + n64js.toHex(a.instruction.opcode, 32) + '    ' + a.disassembly;
      if (a.instruction.address == cpu0.pc) {
        cur_instr = a.instruction;
        t = '<span style="background-color: #ffa">' + t + '</span>';
      }
      return t;
    }).join('<br>');

    var regColours = {};

    var availColours = [
      '#F4EEAF', // yellow
      '#AFF4BB', // green
      '#F4AFBE'  // blue
    ];

    if (cur_instr) {
      var nextColIdx = 0;
      for (var i in cur_instr.srcRegs) {
        if (!regColours.hasOwnProperty(i)) {
          regColours[i] = availColours[nextColIdx++];
        }
      }
      for (var i in cur_instr.dstRegs) {
        if (!regColours.hasOwnProperty(i)) {
          regColours[i] = availColours[nextColIdx++];
        }
      }
    }


    var $dis = $('<pre>' + dis_body + '</pre>');
    $dis.find('.dis-label-target').each(function (){
      var address = parseInt($(this).text(), 16);
      $(this).css('color', makeLabelColor(address));
      $(this).click(function () {
        disasmAddress = address;
        n64js.refreshDisplay();
      });
    });

    $disassembly.html($dis);

    for (var i in regColours) {
      $dis.find('.dis-reg-' + i).css('background-color', regColours[i]);
    }


    var $table = $('<table class="register-table"><tbody></tbody></table>');
    var $tb = $table.find('tbody');

    $tb.append('<tr><td>Ops</td><td class="fixed">' + cpu0.opsExecuted + '</td></tr>');
    $tb.append('<tr><td>PC</td><td class="fixed">' + toString32(cpu0.pc) + '</td><td>delayPC</td><td class="fixed">' + toString32(cpu0.delayPC) + '</td></tr>');
    $tb.append('<tr><td>MultHi</td><td class="fixed">' + toString64(cpu0.multHi[0], cpu0.multHi[1]) +
              '</td><td>MultLo</td><td class="fixed">' + toString64(cpu0.multLo[0], cpu0.multLo[1]) + '</td></tr>');

    var kRegistersPerRow = 2;
    for (var i = 0; i < 32; i+=kRegistersPerRow) {
      var $tr = $('<tr />');
      for (var r = 0; r < kRegistersPerRow; ++r) {

        var name = n64js.cop0gprNames[i+r];
        var $td = $('<td>' + name + '</td><td class="fixed">' + toString64(cpu0.gprLo[i+r], cpu0.gprHi[i+r]) + '</td>');

        if (cur_instr) {
          if (regColours.hasOwnProperty(name)) {
            $td.attr('bgcolor', regColours[name]);
          }
        }

        $tr.append($td);
      }
      $tb.append($tr);
    }

    $registers.html($table);
  }

  //
  // Memory handlers
  //
  function PICopyToRDRAM() {
    var dram_address = pi_reg.read32(PI_DRAM_ADDR_REG) & 0x00ffffff;
    var cart_address = pi_reg.read32(PI_CART_ADDR_REG);
    var transfer_len = pi_reg.read32(PI_WR_LEN_REG) + 1;

    n64js.log('PI: copying ' + transfer_len + ' bytes of data from ' + toString32(cart_address) + ' to ' + toString32(dram_address));

    if (transfer_len&1) {
      n64js.log('PI: Warning - odd address');
      transfer_len++;
    }

    var copy_succeeded = false;

    if (IsDom1Addr1(cart_address)) {
      cart_address -= PI_DOM1_ADDR1;
      MemoryCopy( ram, dram_address, rom, cart_address, transfer_len );
      copy_succeeded = true;
    } else if (IsDom1Addr2(cart_address)) {
      cart_address -= PI_DOM1_ADDR2;
      MemoryCopy( ram, dram_address, rom, cart_address, transfer_len );
      copy_succeeded = true;
    } else if (IsDom1Addr3(cart_address)) {
      cart_address -= PI_DOM1_ADDR3;
      MemoryCopy( ram, dram_address, rom, cart_address, transfer_len );
      copy_succeeded = true;

    } else if (IsDom2Addr1(cart_address)) {
      cart_address -= PI_DOM2_ADDR1;
      n64js.halt('PI: dom2addr1 transfer is unhandled (save)');

    } else if (IsDom2Addr2(cart_address)) {
      cart_address -= PI_DOM2_ADDR2;
      n64js.halt('PI: dom2addr2 transfer is unhandled (save/flash)');

    } else {
      n64js.halt('PI: unknown cart address: ' + cart_address);
    }

    // If this is the first DMA write the ram size to 0x800003F0 (cic6105) or 0x80000318 (others)
    pi_reg.clearBits32(PI_STATUS_REG, PI_STATUS_DMA_BUSY);
    mi_reg.setBits32(MI_INTR_REG, MI_INTR_PI);
    n64js.interruptUpdateCause3();
  }

  function PIUpdateControl() {
    var pif_rom = new Uint8Array(pif_mem.bytes, 0x000, 0x7c0);
    var pif_ram = new Uint8Array(pif_mem.bytes, 0x7c0, 0x040);
    var command = pif_ram[0x3f];
    switch (command) {
      case 0x01:
        n64js.log('PI: execute block\n');
        break;
      case 0x08:
        n64js.log('PI: interrupt control\n');
        pif_ram[0x3f] = 0x00;
        si_reg.setBits32(SI_STATUS_REG, SI_STATUS_INTERRUPT);
        si_reg.setBits32(MI_INTR_REG,   MI_INTR_SI);
        n64js.interruptUpdateCause3();
        break;
      case 0x10:
        n64js.log('PI: clear rom\n');
        for(var i = 0; i < pif_rom.length; ++i) {
          pif_rom[i] = 0;
        }
        break;
      case 0x30:
        n64js.log('PI: set 0x80 control \n');
        pif_ram[0x3f] = 0x80;
        break;
      case 0xc0:
        n64js.log('PI: clear ram\n');
        for(var i = 0; i < pif_ram.length; ++i) {
          pif_ram[i] = 0;
        }
        break;
      default:
        n64js.halt('Unkown PI control value: ' + toString8(command));
        break;
    }
  }


  function Memory(arraybuffer) {
    this.bytes  = arraybuffer;
    this.length = arraybuffer.byteLength;
    //this.u32    = new Uint32Array(this.bytes);
    this.u8     = new  Uint8Array(this.bytes);

    var that = this;

    this.read32 = function (offset) {
      var a = that.u8[offset+0];
      var b = that.u8[offset+1];
      var c = that.u8[offset+2];
      var d = that.u8[offset+3];

      return (a<<24) | (b<<16) | (c<<8) | d;
    }
    this.read16 = function (offset) {
      return (that.u8[offset+0]<<8) | that.u8[offset+1];
    }
    this.read8 = function (offset) {
      return that.u8[offset];
    }

    this.write32 = function (offset, value) {
      that.u8[offset+0] = (value >>> 24);
      that.u8[offset+1] = (value >>> 16);
      that.u8[offset+2] = (value >>>  8);
      // NB: Chrome seems to require this mask - without it, it seems to end up writing 0x00 for large values when jitted?
      that.u8[offset+3] = (value       ) & 0xff;
    }
    this.write8 = function (offset, value) {
      // NB: Chrome seems to require this mask - without it, it seems to end up writing 0x00 for large values when jitted?
      that.u8[offset+0] = value&0xff;
    }


    this.readString = function (offset, max_len) {
      var s = '';
      for (var i = 0; i < max_len; ++i) {
        var c = that.u8[offset+i];
        if (c == 0) {
          break;
        }
        s += String.fromCharCode(c);
      }
      return s;
    }

    this.clearBits32 = function (offset, bits) {
      this.write32(offset, this.read32(offset) & ~bits);
    },
    this.setBits32 = function (offset, bits) {
      this.write32(offset, this.read32(offset) | bits);
    },
    this.getBits32 = function (offset, bits) {
      return this.read32(offset) & bits;
    }

    this.swap = function (_a, _b, _c, _d) {
      for (var i = 0; i < that.u8.length; i += 4) {
        var a = that.u8[i+_a], b = that.u8[i+_b], c = that.u8[i+_c], d = that.u8[i+_d];
        that.u8[i+0] = a;
        that.u8[i+1] = b;
        that.u8[i+2] = c;
        that.u8[i+3] = d;
      }
    }
  }

  function MemoryCopy(dst, dstoff, src, srcoff, len) {
    for (var i = 0; i < len; ++i) {
      dst.u8[dstoff+i] = src.u8[srcoff+i];
    }
  }


  function Device(name, mem, rangeStart, rangeEnd) {
    this.name       = name;
    this.mem        = mem;
    this.rangeStart = rangeStart;
    this.rangeEnd   = rangeEnd;
    this.quiet      = false;
  }

  Device.prototype = {
    calcEA : function (address) {
      return address - this.rangeStart;
    },

    readInternal32 : function (address) {
      var ea = this.calcEA(address);
      if (ea+3 < this.mem.length)
        return this.mem.read32(ea);
      return 0xdddddddd;
    },

    read32 : function (address) {
      if (!this.quiet) n64js.log('Reading from ' + this.name + ': ' + toString32(address) );
      var ea = this.calcEA(address);
      if (ea+3 < this.mem.length)
        return this.mem.read32(ea);

      throw 'Read is out of range';
    },
    read8 : function (address) {
      if (!this.quiet) n64js.log('Reading from ' + this.name + ': ' + toString32(address) );
      var ea = this.calcEA(address);
      if (ea < this.mem.length)
        return this.mem.read8(ea);

      throw 'Read is out of range';
    },


    write32 : function (address, value) {
      if (!this.quiet) n64js.log('Writing to ' + this.name + ': ' + toString8(value) + ' -> [' + toString32(address) + ']' );
      var ea = this.calcEA(address);
      if (ea+3 < this.mem.length)
        return this.mem.write32(ea, value);

      throw 'Write is out of range';
    },
    write8 : function (address, value) {
      if (!this.quiet) n64js.log('Writing to ' + this.name + ': ' + toString32(value) + ' -> [' + toString32(address) + ']' );
      var ea = this.calcEA(address);
      if (ea < this.mem.length)
        return this.mem.write8(ea, value);

      throw 'Write is out of range';
    }
  };

  var $rominfo     = null;
  var $registers   = null;
  var $output      = null;
  var $disassembly = null;

  var disasmAddress = 0;

  var running       = false;
  var rom           = null;   // Will be memory, mapped at 0xb0000000
  var pif_mem       = new Memory(new ArrayBuffer(0x7c0 + 0x40));   // rom+ram
  var ram           = new Memory(new ArrayBuffer(8*1024*1024));
  var sp_mem        = new Memory(new ArrayBuffer(0x2000));
  var sp_reg        = new Memory(new ArrayBuffer(0x20));
  var sp_ibist_mem  = new Memory(new ArrayBuffer(0x8));
  var rdram_reg     = new Memory(new ArrayBuffer(0x30));
  var mi_reg        = new Memory(new ArrayBuffer(0x10));
  var vi_reg        = new Memory(new ArrayBuffer(0x38));
  var ai_reg        = new Memory(new ArrayBuffer(0x18));
  var pi_reg        = new Memory(new ArrayBuffer(0x34));
  var ri_reg        = new Memory(new ArrayBuffer(0x20));
  var si_reg        = new Memory(new ArrayBuffer(0x1c));

  var rdram_handler_cached       = new Device("RAM",      ram,          0x80000000, 0x80800000);
  var rdram_handler_uncached     = new Device("RAM",      ram,          0xa0000000, 0xa0800000);
  var rdram_reg_handler_uncached = new Device("RDRAMReg", rdram_reg,    0xa3f00000, 0xa4000000);
  var sp_mem_handler_uncached    = new Device("SPMem",    sp_mem,       0xa4000000, 0xa4002000);
  var sp_reg_handler_uncached    = new Device("SPReg",    sp_reg,       0xa4040000, 0xa4040020);
  var sp_ibist_handler_uncached  = new Device("SPIBIST",  sp_ibist_mem, 0xa4080000, 0xa4080008);
  var mi_reg_handler_uncached    = new Device("MIReg",    mi_reg,       0xa4300000, 0xa4300010);
  var vi_reg_handler_uncached    = new Device("VIReg",    vi_reg,       0xa4400000, 0xa4400038);
  var ai_reg_handler_uncached    = new Device("AIReg",    ai_reg,       0xa4500000, 0xa4500018);
  var pi_reg_handler_uncached    = new Device("PIReg",    pi_reg,       0xa4600000, 0xa4600034);
  var ri_reg_handler_uncached    = new Device("RIReg",    ri_reg,       0xa4700000, 0xa4700020);
  var si_reg_handler_uncached    = new Device("SIReg",    si_reg,       0xa4800000, 0xa480001c);
  var rom_handler_uncached       = new Device("ROM",      rom,          0xb0000000, 0xbfc00000);
  var pif_mem_handler_uncached   = new Device("PIFRAM",   pif_mem,      0xbfc00000, 0xbfc00800);

  rdram_handler_cached.quiet    = true;
  rdram_handler_uncached.quiet  = true;
  sp_mem_handler_uncached.quiet = true;

  rom_handler_uncached.write32 = function (address, value) {
    throw 'Writing to rom';
  };
  rom_handler_uncached.write8 = function (address, value) {
    throw 'Writing to rom';
  };

  rdram_reg_handler_uncached.calcEA  = function (address) {
    return address&0xff;
  };


  function MIWriteModeReg(value) {
    var mi_mode_reg = mi_reg.read32(MI_MODE_REG);

    if (value & MI_SET_RDRAM)   mi_mode_reg |=  MI_MODE_RDRAM;
    if (value & MI_CLR_RDRAM)   mi_mode_reg &= ~MI_MODE_RDRAM;

    if (value & MI_SET_INIT)    mi_mode_reg |=  MI_MODE_INIT;
    if (value & MI_CLR_INIT)    mi_mode_reg &= ~MI_MODE_INIT;

    if (value & MI_SET_EBUS)    mi_mode_reg |=  MI_MODE_EBUS;
    if (value & MI_CLR_EBUS)    mi_mode_reg &= ~MI_MODE_EBUS;

    mi_reg.write32(MI_MODE_REG, mi_mode_reg);

    if (value & MI_CLR_DP_INTR) {
      mi_reg.clearBits32(MI_INTR_REG, MI_INTR_DP);
      n64js.interruptUpdateCause3();
    }
  }

  function MIWriteIntrMaskReg(value) {
    var mi_intr_mask_reg = mi_reg.read32(MI_INTR_MASK_REG);
    var mi_intr_reg      = mi_reg.read32(MI_INTR_REG);

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
      n64js.interruptUpdateCause3();
    }
  }

  mi_reg_handler_uncached.write32 = function (address, value) {
    var ea = this.calcEA(address);
    if (ea+3 < this.mem.length) {

      switch( ea ) {
        case MI_MODE_REG:
          n64js.log('Wrote to MI mode register: ' + toString32(value) );
          MIWriteModeReg(value);
          break;
        case MI_INTR_MASK_REG:
          n64js.log('Wrote to MI interrupt mask register: ' + toString32(value) );
          MIWriteIntrMaskReg(value);
          break;

        case MI_VERSION_REG:
        case MI_INTR_REG:
          // Read only
          break;

        default:
          n64js.log('Unhandled write to MIReg: ' + toString32(value) + ' -> [' + toString32(address) + ']' );
          this.mem.write32(ea, value);
      }

    } else {
      throw 'Write is out of range';
    }
  };


  ai_reg_handler_uncached.write32 = function (address, value) {
    var ea = this.calcEA(address);
    if (ea+3 < this.mem.length) {

      switch( ea ) {
        case AI_DRAM_ADDR_REG:
        case AI_CONTROL_REG:
        case AI_BITRATE_REG:
          n64js.log('Wrote to AIReg: ' + toString32(value) + ' -> [' + toString32(address) + ']' );
          this.mem.write32(ea, value);
          break;

        case AI_LEN_REG:
          n64js.log('AI len changed to ' + value);
          this.mem.write32(ea, value);
          break;
        case AI_DACRATE_REG:
          n64js.log('AI dacrate changed to ' + value);
          this.mem.write32(ea, value);
          break;

        case AI_STATUS_REG:
          n64js.log('AI interrupt cleared');
          ai_reg.clearBits32(MI_INTR_REG, MI_INTR_AI);
          n64js.interruptUpdateCause3();
          break;

        default:
          n64js.log('Unhandled write to AIReg: ' + toString32(value) + ' -> [' + toString32(address) + ']' );
          this.mem.write32(ea, value);
      }

    } else {
      throw 'Write is out of range';
    }
  };


  vi_reg_handler_uncached.write32 = function (address, value) {
    var ea = this.calcEA(address);
    if (ea+3 < this.mem.length) {

      switch( ea ) {
        case VI_CONTROL_REG:
          n64js.log('VI control set to: ' + toString32(value) );
          this.mem.write32(ea, value);
          break;
        case VI_WIDTH_REG:
            n64js.log('VI width set to: ' + value );
            this.mem.write32(ea, value);
            break;
          case VI_CURRENT_REG:
            n64js.log('VI current set to: ' + toString32(value) + '.' );
            n64js.log('VI interrupt cleared');
            this.mem.write32(ea, value);
            mi_reg.clearBits32(MI_INTR_REG, MI_INTR_VI);
            n64js.interruptUpdateCause3();
            break;

        default:
          n64js.log('Unhandled write to VIReg: ' + toString32(value) + ' -> [' + toString32(address) + ']' );
          this.mem.write32(ea, value);
          break;
      }

    } else {
      throw 'Write is out of range';
    }
  };


  pi_reg_handler_uncached.write32 = function (address, value) {
    var ea = this.calcEA(address);
    if (ea+3 < this.mem.length) {

      switch( ea ) {
        case PI_DRAM_ADDR_REG:
        case PI_CART_ADDR_REG:
          n64js.log('Writing to PIReg: ' + toString32(value) + ' -> [' + toString32(address) + ']' );
          this.mem.write32(ea, value);
          break;
        case PI_RD_LEN_REG:
          this.mem.write32(ea, value);
          n64js.halt('PI copy from rdram triggered!');
          break;
        case PI_WR_LEN_REG:
          this.mem.write32(ea, value);
          PICopyToRDRAM();
          break;
        case PI_STATUS_REG:
          if (value & PI_STATUS_RESET) {
            n64js.log('PI_STATUS_REG reset');
            this.mem.write32(PI_STATUS_REG, 0);
          }
          if (value & PI_STATUS_CLR_INTR) {
            n64js.log('PI interrupt cleared');
            mi_reg.clearBits32(MI_INTR_REG, MI_INTR_PI);
            n64js.interruptUpdateCause3();
          }

          break;
        default:
          n64js.log('Unhandled write to PIReg: ' + toString32(value) + ' -> [' + toString32(address) + ']' );
          this.mem.write32(ea, value);
          break;

      }

    } else {
      throw 'Write is out of range';
    }
  };

  si_reg_handler_uncached.read32 = function (address) {
    if (!this.quiet) n64js.log('Reading from ' + this.name + ': ' + toString32(address) );
    var ea = this.calcEA(address);

    if (ea+3 < this.mem.length) {
      if (ea == SI_STATUS_REG) {
        var mi_si_int_set     = mi_reg.getBits32(MI_INTR_REG,   MI_INTR_SI)          !== 0;
        var si_status_int_set = si_reg.getBits32(SI_STATUS_REG, SI_STATUS_INTERRUPT) !== 0;
        if (mi_si_int_set != si_status_int_set) {
          n64js.log("SI_STATUS registuer is in an inconsistent state");
        }
      }
      return this.mem.read32(ea);
    } else {
      throw 'Read is out of range';
    }
  };

  si_reg_handler_uncached.write32 = function (address, value) {
    var ea = this.calcEA(address);
    if (ea+3 < this.mem.length) {

      switch( ea ) {
        case SI_DRAM_ADDR_REG:
          n64js.log('Writing to SI dram address reigster: ' + toString32(value) );
          this.mem.write32(ea, value);
          break;
        case SI_PIF_ADDR_RD64B_REG:
          this.mem.write32(ea, value);
          n64js.halt('SI copy to rdram triggered!');
          break;
        case SI_PIF_ADDR_WR64B_REG:
          this.mem.write32(ea, value);
          n64js.halt('SI copy from rdram triggered!');
          break;
        case SI_STATUS_REG:
          n64js.log('SI interrupt cleared');
          si_reg.clearBits32(SI_STATUS_REG, SI_STATUS_INTERRUPT);
          mi_reg.clearBits32(MI_INTR_REG,   MI_INTR_SI);
          n64js.interruptUpdateCause3();
          break;
        default:
          n64js.log('Unhandled write to SIReg: ' + toString32(value) + ' -> [' + toString32(address) + ']' );
          this.mem.write32(ea, value);
          break;
      }

    } else {
      throw 'Write is out of range';
    }
  };

  pif_mem_handler_uncached.read32 = function (address) {
    var ea = this.calcEA(address);

    if (ea+3 < this.mem.length) {
      var v = pif_mem.read32(ea);

      if (ea < 0x7c0) {
        n64js.log('Reading from PIF rom (' + toString32(address) + '). Got ' + toString32(v));
        return v;
      } else {
        var ram_offset = ea - 0x7c0;
        switch(ram_offset) {
          case 0x24:  n64js.log('Reading CIC values: '   + toString32(v)); break;
          case 0x3c:  n64js.log('Reading Control byte: ' + toString32(v)); break;
          default:    n64js.log('Reading from PI ram ['  + toString32(address) + ']. Got ' + toString32(v));
        }
      }
      return v;
    } else {
      throw 'Read is out of range';
    }
  };
  pif_mem_handler_uncached.read8 = function (address) {
    var ea = this.calcEA(address);

    if (ea < this.mem.length) {
      var v = pif_mem.read8(ea);

      if (ea < 0x7c0) {
        n64js.log('Reading from PIF rom (' + toString32(address) + '). Got ' + toString8(v));
        return v;
      } else {
        var ram_offset = ea - 0x7c0;
        switch(ram_offset) {
          case 0x24:  n64js.log('Reading CIC values: '   + toString8(v)); break;
          case 0x3c:  n64js.log('Reading Control byte: ' + toString8(v)); break;
          default:    n64js.log('Reading from PI ram ['  + toString32(address) + ']. Got ' + toString8(v));
        }
      }
      return v;
    } else {
      throw 'Read is out of range';
    }
  };
  pif_mem_handler_uncached.write32 = function (address, value) {
    var ea = this.calcEA(address);
    if (ea+3 < this.mem.length) {

      if (ea < 0x7c0) {
        n64js.log('Attempting to write to PIF ROM');
      } else {
        var ram_offset = ea - 0x7c0;
        this.mem.write32(ea, value);
        switch(ram_offset) {
        case 0x24:  n64js.log('Writing CIC values: '   + toString32(value) ); break;
        case 0x3c:  n64js.log('Writing Control byte: ' + toString32(value) ); PIUpdateControl(); break;
        default:    n64js.log('Writing directly to PI ram [' + toString32(address) + '] <-- ' + toString32(value)); break;
        }
      }

    } else {
      throw 'Write is out of range';
    }
  };

  // We create a memory map of 1<<14 entries, corresponding to the top bits of the address range. 
  var memMap = (function () {
    var map = new Array(0x4000);
    for (var i = 0; i < 0x4000; ++i)
      map[i] = undefined;

    [
          rdram_handler_cached,
          rdram_handler_uncached,
         sp_mem_handler_uncached,
         sp_reg_handler_uncached,
       sp_ibist_handler_uncached,
      rdram_reg_handler_uncached,
         mi_reg_handler_uncached,
         vi_reg_handler_uncached,
         ai_reg_handler_uncached,
         pi_reg_handler_uncached,
         ri_reg_handler_uncached,
         si_reg_handler_uncached,
            rom_handler_uncached,
        pif_mem_handler_uncached
    ].map(function (e){
        var beg = (e.rangeStart)>>>18;
        var end = (e.rangeEnd-1)>>>18;
        for( var i = beg; i <= end; ++i ) {
          map[i] = e;
        }
    });

    if (map.length != 0x4000)
      throw 'initialisation error';

    return map;

  })();


  // Read memory internal is used for stuff like the debugger. It shouldn't ever throw or change the state of the emulated program.
  n64js.readMemoryInternal32 = function (address) {
    assert(address>=0, "Address is negative");
    var handler = memMap[address >>> 18];
    if (!handler) {
      //n64js.log('internal read from unhandled location ' + toString32(address));
      return 0xdddddddd;
    }
    return handler ? handler.readInternal32(address>>>0) : 0xdddddddd;
  }

  // 'emulated' read. May cause exceptions to be thrown in the emulated process
  n64js.readMemory32 = function (address) {
    assert(address>=0, "Address is negative");
    var handler = memMap[address >>> 18];
    if (!handler) {
      n64js.log('read from unhandled location ' + toString32(address));
      throw 'unmapped read - need to set exception';
    }
    return handler.read32(address>>>0);
  }

  // 'emulated' read. May cause exceptions to be thrown in the emulated process
  n64js.readMemory8 = function (address) {
    assert(address>=0, "Address is negative");
    var handler = memMap[address >>> 18];
    if (!handler) {
      n64js.log('read from unhandled location ' + toString32(address));
      throw 'unmapped read - need to set exception';
    }
    return handler.read8(address>>>0);
  }

  // 'emulated' write. May cause exceptions to be thrown in the emulated process
  n64js.writeMemory32 = function (address, value) {
    assert(address>=0, "Address is negative");
    var handler = memMap[address >>> 18];
    if (!handler) {
      n64js.log('write to unhandled location ' + toString32(address));
      throw 'unmapped write - need to set exception';
    }
    return handler.write32(address>>>0, value);
  }

  // 'emulated' write. May cause exceptions to be thrown in the emulated process
  n64js.writeMemory8 = function (address, value) {
    assert(address>=0, "Address is negative");
    var handler = memMap[address >>> 18];
    if (!handler) {
      n64js.log('write to unhandled location ' + toString32(address));
      throw 'unmapped write - need to set exception';
    }
    return handler.write8(address>>>0, value);
  }

  n64js.interruptUpdateCause3 = function () {
    n64js.log('Need to handle interrupts');
  }


  var kBootstrapOffset = 0x40;
  var kGameOffset      = 0x1000;

  n64js.reset = function () {
    var country  = 0x45;  // USA
    var cic_chip = '6102';

    for (var i = 0; i < ram.length; ++i) {
      ram[i] = 0;
    }

    n64js.cpu0.reset();
    n64js.cpu1.reset();

    mi_reg.write32(MI_VERSION_REG, 0x02020102);
    //ri_reg.write32(RI_CONFIG_REG, 1);           // This skips most of init

    // Simulate boot

    if (rom) {
      MemoryCopy( sp_mem, kBootstrapOffset, rom, kBootstrapOffset, kGameOffset - kBootstrapOffset );
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
  }

  n64js.loadRom = function (bytes) {
    rom = new Memory(bytes);

    rom_handler_uncached.mem = rom;

    switch (rom.read32(0)) {
      case 0x80371240:
        // ok
        break;
      case 0x40123780:
        rom.swap(3, 2, 1, 0);
        break;
      case 0x12408037:
        rom.swap(2, 3, 0, 1);
        break;
      case 0x37804012:
        rom.swap(1, 0, 3, 2);
        break;
      default:
        throw 'Unhandled byteswapping: ' + rom.read32(0).toString(16);
        break;
    }

    var hdr = {};
    hdr.header       = rom.read32(0);
    hdr.clock        = rom.read32(4);
    hdr.bootAddress  = rom.read32(8);
    hdr.release      = rom.read32(12);
    hdr.crclo        = rom.read32(16);   // or hi?
    hdr.crchi        = rom.read32(20);   // or lo?
    hdr.unk0         = rom.read32(24);
    hdr.unk1         = rom.read32(28);
    hdr.name         = rom.readString(32, 20);
    hdr.unk2         = rom.read32(52);
    hdr.unk3         = rom.read16(56);
    hdr.unk4         = rom.read8 (58);
    hdr.manufacturer = rom.read8 (59);
    hdr.cartId       = rom.read16(60);
    hdr.countryId    = rom.read8 (62);  // char
    hdr.unk5         = rom.read8 (62);

    $rominfo.html('');
    var $table = $('<table class="register-table"><tbody></tbody></table>');
    var $tb = $table.find('tbody');
    for (var i in hdr) {
      $tb.append('<tr>' +
        '<td>' + i + '</td><td>' + (typeof hdr[i] === 'string' ? hdr[i] : toString32(hdr[i])) + '</td>' +
        '</tr>');
    }
    $rominfo.append($table);
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

  function toString32(v) {
    return '0x' + toHex(v, 32);
  }

  function toString64(lo, hi) {
    var t = toHex(lo, 32);
    var u = toHex(hi, 32);
    return '0x' + u + t;
  }

  n64js.toHex      = toHex;
  n64js.toString8  = toString8;
  n64js.toString32 = toString32;
  n64js.toString64 = toString64;

})();