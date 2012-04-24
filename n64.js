if (typeof n64js === 'undefined') {
  var n64js = {};
}

(function () {'use strict';
  function Memory(arraybuffer) {
    this.bytes  = arraybuffer;      
    this.length = arraybuffer.byteLength;
    this.u32    = new Uint32Array(this.bytes);
    this.u8     = new  Uint8Array(this.bytes);

    var that = this;

    this.read32 = function (offset) {
      return (that.u8[offset+0]<<24) | (that.u8[offset+1]<<16) | (that.u8[offset+2]<<8) | that.u8[offset+3];
    }
    this.read16 = function (offset) {
      return (that.u8[offset+0]<<8) | that.u8[offset+1];
    }
    this.read8 = function (offset) {
      return that.u8[offset];
    }

    this.write32 = function(offset, value) {
      that.u8[offset+0] = (value >>> 24);
      that.u8[offset+1] = (value >>> 16);
      that.u8[offset+2] = (value >>>  8);
      that.u8[offset+3] = (value       );
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

  var running   = false;
  var rom       = null;   // Will be memory, mapped at 0xb0000000
  var ram       = new Memory(new ArrayBuffer(4*1024*1024));
  var sp_mem    = new Memory(new ArrayBuffer(0x2000));
  var rdram_reg = new Memory(new ArrayBuffer(0x30));
  var mi_reg    = new Memory(new ArrayBuffer(0x10));
  var vi_reg    = new Memory(new ArrayBuffer(0x38));
  var ai_reg    = new Memory(new ArrayBuffer(0x18));
  var pi_reg    = new Memory(new ArrayBuffer(0x34));
  var ri_reg    = new Memory(new ArrayBuffer(0x20));
  var si_reg    = new Memory(new ArrayBuffer(0x1c));

  var kBootstrapOffset = 0x40;
  var kGameOffset      = 0x1000;

  var cpu0 = {
    gprLo   : new Uint32Array(32),
    gprHi   : new Uint32Array(32),
    control : new Uint32Array(32),

    pc      : 0,
    delayPC : 0,

    branch : function(new_pc) {
      this.delayPC = new_pc;
    },

    gprRegisterNames : [
            "r0", "at", "v0", "v1", "a0", "a1", "a2", "a3",
            "t0", "t1", "t2", "t3", "t4", "t5", "t6", "t7",
            "s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7",
            "t8", "t9", "k0", "k1", "gp", "sp", "s8", "ra",
    ],

    // General purpose register constants
    kRegister_r0 : 0x00,
    kRegister_at : 0x01,
    kRegister_v0 : 0x02,
    kRegister_v1 : 0x03,
    kRegister_a0 : 0x04,
    kRegister_a1 : 0x05,
    kRegister_a2 : 0x06,
    kRegister_a3 : 0x07,
    kRegister_t0 : 0x08,
    kRegister_t1 : 0x09,
    kRegister_t2 : 0x0a,
    kRegister_t3 : 0x0b,
    kRegister_t4 : 0x0c,
    kRegister_t5 : 0x0d,
    kRegister_t6 : 0x0e,
    kRegister_t7 : 0x0f,
    kRegister_s0 : 0x10,
    kRegister_s1 : 0x11,
    kRegister_s2 : 0x12,
    kRegister_s3 : 0x13,
    kRegister_s4 : 0x14,
    kRegister_s5 : 0x15,
    kRegister_s6 : 0x16,
    kRegister_s7 : 0x17,
    kRegister_t8 : 0x18,
    kRegister_t9 : 0x19,
    kRegister_k0 : 0x1a,
    kRegister_k1 : 0x1b,
    kRegister_gp : 0x1c,
    kRegister_sp : 0x1d,
    kRegister_s8 : 0x1e,
    kRegister_ra : 0x1f,    

    // Control register constants
    kControlIndex     : 0,
    kControlRand      : 1,
    kControlEntryLo0  : 2,
    kControlEntryLo1  : 3,
    kControlContext   : 4,
    kControlPageMask  : 5,
    kControlWired     : 6,
    //...
    kControlBadVAddr  : 8,
    kControlCount     : 9,
    kControlEntryHi   : 10,
    kControlCompare   : 11,
    kControlSR        : 12,
    kControlCause     : 13,
    kControlEPC       : 14,
    kControlPRId      : 15,
    kControlConfig    : 16,
    kControlLLAddr    : 17,
    kControlWatchLo   : 18,
    kControlWatchHi   : 19,
    //...
    kControlECC       : 26,
    kControlCacheErr  : 27,
    kControlTagLo     : 28,
    kControlTagHi     : 29,
    kControlErrorEPC  : 30    
  };

  // Expose the cpu state
  n64js.cpu0 = cpu0;

  var $rominfo     = null;
  var $registers   = null;
  var $output      = null;
  var $disassembly = null;

  var disasmAddress = 0;

  function setGPR(reg, hi, lo) {
    cpu0.gprHi[reg] = hi;
    cpu0.gprLo[reg] = lo;
  }

  function setPC(a) {
    cpu0.pc = a;
    disasmAddress = a;
  }

  n64js.halt = function (msg) {
    running = false;
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

  n64js.reset = function () {
    var country  = 0x45;  // USA  
    var cic_chip = '6102';

    for (var i = 0; i < ram.length; ++i) {
      ram[i] = 0;
    }
    for (var i = 0; i < 32; ++i) {
      cpu0.gprLo[i]   = 0;
      cpu0.gprHi[i]   = 0;
      cpu0.control[i] = 0;
    }

    if (rom) {
      MemoryCopy( sp_mem, kBootstrapOffset, rom, kBootstrapOffset, kGameOffset - kBootstrapOffset );
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

    setPC(0xA4000040);
  }

  n64js.loadRom = function (bytes) {
    rom = new Memory(bytes);

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

  var last_pc = 0;
  n64js.refreshDisplay = function () {

    // If the pc has changed since the last update, recenter the display (e.g. when we take a branch)
    if (cpu0.pc != last_pc) {
      disasmAddress = cpu0.pc;
      last_pc = cpu0.pc;
    }

    var cur_instr;

    var disassembly = n64js.disassemble(disasmAddress - 64, disasmAddress + 64);
    var dis_body = disassembly.map(function (a) {
    
      var label_span = a.isJumpTarget ? '<span class="dis-label-target" style="color: ' + a.isJumpTarget + '">' : '<span class="dis-label">';
      var label      = label_span    + n64js.toHex(a.instruction.address, 32) + ':</span>';
      var t          = label + '   ' + n64js.toHex(a.instruction.opcode, 32) + '    ' + a.disassembly;
      if (a.instruction.address == cpu0.pc) {
        cur_instr = a.instruction;
        t = '<span style="background-color: #ffa">' + t + '</span>';
      }
      return t;
    }).join('<br>');
    $disassembly.html('<pre>' + dis_body + '</pre>');


    var $table = $('<table class="register-table"><tbody></tbody></table>');
    var $tb = $table.find('tbody');

    var dpc = '<td>delayPC</td><td class="fixed">' + toString32(cpu0.delayPC) + '</td>';

    $tb.append('<tr><td>PC</td><td class="fixed">' + toString32(cpu0.pc) + '</td>' + dpc + '</tr>');

    var kRegistersPerRow = 2;
    for (var i = 0; i < 32; i+=kRegistersPerRow) {
      var $tr = $('<tr />');
      for (var r = 0; r < kRegistersPerRow; ++r) {

        var name = cpu0.gprRegisterNames[i+r];
        var $td = $('<td>' + name + '</td><td class="fixed">' + toString64(cpu0.gprLo[i+r], cpu0.gprHi[i+r]) + '</td>');

        if (cur_instr) {
          var col = '';
          if(cur_instr.srcRegs.hasOwnProperty(name) && cur_instr.dstRegs.hasOwnProperty(name)) {
            col = '#F4EEAF'; // yellow
          } else if (cur_instr.srcRegs.hasOwnProperty(name)) {
            col = '#AFF4BB'; // green
          } else if (cur_instr.dstRegs.hasOwnProperty(name)) {
            col = '#F4AFBE'; // blue
          }

          if (col) {
            $td.attr('bgcolor', col);
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
  var sp_mem_handler_uncached = {
    rangeStart : 0xa4000000,
    rangeEnd   : 0xa4002000,

    readInternal32 : function (address) {
      if (address+3 < this.rangeEnd)
        return sp_mem.read32(address-this.rangeStart);
      return 0xdddddddd;
    },

    read32 : function (address) {
      if (address+3 < this.rangeEnd)
        return sp_mem.read32(address-this.rangeStart);

      throw 'Read is out of range';
    },

    write32 : function (address, value) {
      if (address+3 < this.rangeEnd)
        return sp_mem.write32(address-this.rangeStart, value);

      throw 'Write is out of range';
    }      
  };

  var rdram_reg_handler_uncached = {
    rangeStart : 0xa3f00000,
    rangeEnd   : 0xa4000000,

    readInternal32 : function (address) {
      var ea = (address&0xff);
      return rdram_reg.read32(ea);
    },

    read32 : function (address) {
      n64js.log('Reading from RD RAM registers: ' + toString32(address) );
      var ea = (address&0xff);
      return rdram_reg.read32(ea);
    },

    write32 : function (address, value) {
      n64js.log('Writing to RD RAM registers: ' + toString32(address) + ' = ' + toString32(value) );
      var ea = (address&0xff);
      return rdram_reg.write32(ea, value);
    }    
  };


  var mi_reg_handler_uncached = {
    rangeStart : 0xa4300000,
    rangeEnd   : 0xa4300010,

    readInternal32 : function (address) {
      if (address+3 < this.rangeEnd)
        return mi_reg.read32(address-this.rangeStart);
     
      return 0xdddddddd;
    },

    read32 : function (address) {
      n64js.log('Reading from MI registers: ' + toString32(address) );
      if (address+3 < this.rangeEnd)
        return mi_reg.read32(address-this.rangeStart);

      throw 'Read is out of range';
    },

    write32 : function (address, value) {
      n64js.log('Writing to MI registers: ' + toString32(address) + ' = ' + toString32(value) );
      if (address+3 < this.rangeEnd)
        return mi_reg.write32(address-this.rangeStart, value);

      throw 'Write is out of range';
    }    
  };

  var ri_reg_handler_uncached = {
    rangeStart : 0xa4700000,
    rangeEnd   : 0xa4700020,

    readInternal32 : function (address) {
      if (address+3 < this.rangeEnd)
        return ri_reg.read32(address-this.rangeStart);
     
      return 0xdddddddd;
    },

    read32 : function (address) {
      n64js.log('Reading from RI registers: ' + toString32(address) );
      if (address+3 < this.rangeEnd)
        return ri_reg.read32(address-this.rangeStart);

      throw 'Read is out of range';
    },

    write32 : function (address, value) {
      n64js.log('Writing to RI registers: ' + toString32(address) + ' = ' + toString32(value) );
      if (address+3 < this.rangeEnd)
        return ri_reg.write32(address-this.rangeStart, value);

      throw 'Write is out of range';
    }    
  };  

  // We create a memory map of 1<<14 entries, corresponding to the top bits of the address range. 
  var memMap = (function () {
    var map = new Array(0x4000);
    for (var i = 0; i < 0x4000; ++i)
      map[i] = undefined;

    [
         sp_mem_handler_uncached,
      rdram_reg_handler_uncached,
         mi_reg_handler_uncached,
         ri_reg_handler_uncached
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
    var handler  = memMap[address >>> 18];
    if (!handler) {
      n64js.log('internal read from unhandled location ' + toString32(address));
      return 0xdddddddd;
    }
    return handler ? handler.readInternal32(address) : 0xdddddddd;
  }

  // 'emulated' read. May cause exceptions to be thrown in the emulated process
  n64js.readMemory32 = function (address) {
    var handler  = memMap[address >>> 18];
    if (!handler) {
      n64js.log('read from unhandled location ' + toString32(address));
      throw 'unmapped read - need to set exception';
    }
    return handler.read32(address);
  }

  // 'emulated' write. May cause exceptions to be thrown in the emulated process
  n64js.writeMemory32 = function (address, value) {
    var handler  = memMap[address >>> 18];
    if (!handler) {
      n64js.log('write to unhandled location ' + toString32(address));
      throw 'unmapped write - need to set exception';
    }
    return handler.write32(address, value);
  }  

  n64js.log = function(s) {
    $output.append(toString32(cpu0.pc) + ': ' + s + '<br>');
  }

  n64js.toHex = function(r, bits) {
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

  function toString32(v) {
    return '0x' + n64js.toHex(v, 32);
  }

  function toString64(lo, hi) {
    var t = n64js.toHex(lo, 32);
    var u = n64js.toHex(hi, 32);
    return '0x' + u + t;
  }
})();