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
    this.write8 = function(offset, value) {
      that.u8[offset+0] = (value >>> 0);
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

    this.clearBits32 = function(offset, bits) {
      this.write32(offset, this.read32(offset) & ~bits);
    },
    this.setBits32 = function(offset, bits) {
      this.write32(offset, this.read32(offset) | bits);
    },

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

  var running       = false;
  var rom           = null;   // Will be memory, mapped at 0xb0000000
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

  var kBootstrapOffset = 0x40;
  var kGameOffset      = 0x1000;

  var cpu0 = {
    gprLo   : new Uint32Array(32),
    gprHi   : new Uint32Array(32),
    control : new Uint32Array(32),

    pc      : 0,
    delayPC : 0,

    halt : false,     // used to flag r4300 to cease execution

    multHi : new Uint32Array(2),
    multLo : new Uint32Array(2),

    opsExecuted : 0,

    branch : function(new_pc) {
      if (new_pc < 0) {
        n64js.log('Oops, branching to negative address: ' + new_pc);
        throw 'Oops, branching to negative address: ' + new_pc;
      }
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
    cpu0.halt = true;
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
    cpu0.multLo[0] = cpu0.multLo[1] = 0;
    cpu0.multHi[0] = cpu0.multHi[1] = 0;

    cpu0.opsExecuted = 0;

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

        var name = cpu0.gprRegisterNames[i+r];
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

  var MI_MODE_REG       = 0x00;
  var MI_VERSION_REG    = 0x04;
  var MI_INTR_REG       = 0x08;
  var MI_INTR_MASK_REG  = 0x0C;


  var MI_INTR_SP        = 0x01;
  var MI_INTR_SI        = 0x02;
  var MI_INTR_AI        = 0x04;
  var MI_INTR_VI        = 0x08;
  var MI_INTR_PI        = 0x10;
  var MI_INTR_DP        = 0x20;

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
      if (!this.quiet) n64js.log('Reading from ' + this.name + ' registers: ' + toString32(address) );
      var ea = this.calcEA(address);
      if (ea+3 < this.mem.length)
        return this.mem.read32(ea);

      throw 'Read is out of range';
    },
    read8 : function (address) {
      if (!this.quiet) n64js.log('Reading from ' + this.name + ' registers: ' + toString32(address) );
      var ea = this.calcEA(address);
      if (ea < this.mem.length)
        return this.mem.read8(ea);

      throw 'Read is out of range';
    },


    write32 : function (address, value) {
      if (!this.quiet) n64js.log('Writing to ' + this.name + ' registers: ' + toString8(value) + ' -> [' + toString32(address) + ']' );
      var ea = this.calcEA(address);
      if (ea+3 < this.mem.length)
        return this.mem.write32(ea, value);

      throw 'Write is out of range';
    },
    write8 : function (address, value) {
      if (!this.quiet) n64js.log('Writing to ' + this.name + ' registers: ' + toString32(value) + ' -> [' + toString32(address) + ']' );
      var ea = address - this.rangeStart;
      if (ea < this.mem.length)
        return this.mem.write8(ea, value);

      throw 'Write is out of range';
    }
  };

  var rom_handler_uncached       = new Device("ROM",      rom,          0xb0000000, 0xbfc00000);
  var rdram_handler_cached       = new Device("RAM",      ram,          0x80000000, 0x80800000);
  var rdram_handler_uncached     = new Device("RAM",      ram,          0xa0000000, 0xa0800000);
  var rdram_reg_handler_uncached = new Device("RDRAMReg", rdram_reg,    0xa3f00000, 0xa4000000);
  var sp_mem_handler_uncached    = new Device("SPMem",    sp_mem,       0xa4000000, 0xa4002000);
  var sp_reg_handler_uncached    = new Device("SPReg",    sp_reg,       0xa4040000, 0xa4040020);
  var sp_ibist_handler_uncached  = new Device("SPIBIST",  sp_ibist_mem, 0xa4080000, 0xa4080008);
  var mi_reg_handler_uncached    = new Device("MIReg",    mi_reg,       0xa4300000, 0xa4300010);
  var pi_reg_handler_uncached    = new Device("PIReg",    pi_reg,       0xa4600000, 0xa4600034);
  var ri_reg_handler_uncached    = new Device("RIReg",    ri_reg,       0xa4700000, 0xa4700020);

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

  pi_reg_handler_uncached.write32 = function (address, value) {
    n64js.log('Writing to PI registers: ' + toString32(value) + ' -> [' + toString32(address) + ']' );
    var ea = address - this.rangeStart;
    if (ea+3 < this.mem.length) {

      switch( ea ) {
        case PI_DRAM_ADDR_REG:
        case PI_CART_ADDR_REG:
          this.mem.write32(ea, value);
          break;
        case PI_RD_LEN_REG:
          n64js.halt('PI copy from rdram triggered!');
          this.mem.write32(ea, value);
          break;
        case PI_WR_LEN_REG:
          this.mem.write32(ea, value);
          PICopyToRDRAM();
          break;
        case PI_STATUS_REG:
          n64js.halt('PI_STATUS_REG written ' + toString32(value));

          if (value & PI_STATUS_RESET) {
            this.mem.write32(PI_STATUS_REG, 0);
          }
          if (value & PI_STATUS_CLR_INTR) {
            n64js.halt('PI_STATUS_REG written - need to reset interrupt');
          }

          break;
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
         ri_reg_handler_uncached,
         pi_reg_handler_uncached,
            rom_handler_uncached
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

  function AssertException(message) { this.message = message; }
  AssertException.prototype.toString = function () {
    return 'AssertException: ' + this.message;
  }

  function assert(e,m) {
    if (!e) {
      throw new AssertException(m);
    }
  }

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

  n64js.log = function (s) {
    $output.append(toString32(cpu0.pc) + ': ' + s + '<br>');
    $output.scrollTop($output[0].scrollHeight);
  }

  n64js.toHex = function (r, bits) {
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
    return '0x' + n64js.toHex((v&0xff)>>>0, 8);
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