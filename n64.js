var N64 = {};
(function() {'use strict';
  var running = false;
  var rom   = null;
  var ram   = new Uint32Array(4*1024*1024);
  var gprLo = new Uint32Array(32);
  var gprHi = new Uint32Array(32);

  var $rominfo = null;
  var $registers = null;

  var gprRegisterNames = [
          "r0", "at", "v0", "v1", "a0", "a1", "a2", "a3",
          "t0", "t1", "t2", "t3", "t4", "t5", "t6", "t7",
          "s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7",
          "t8", "t9", "k0", "k1", "gp", "sp", "s8", "ra",
  ];

  N64.isRunning = function () {
    return running;
  }

  N64.setRomInfoElement = function ($r) {
    $rominfo = $r;
  }   

  N64.setRegistersElement = function ($r) {
    $registers = $r;
  }

  N64.reset = function () {
    for (var i = 0; i < ram.length; ++i) {
      ram[i] = 0;
    }
    for (var i = 0; i < 32; ++i) {
      gprLo[i] = 0;
      gprHi[i] = 0;
    }
  }

  function Bytes(b) {
    var bytes = new Uint8Array(b);

    this.read32 = function (offset) {
      return (bytes[offset+0]<<24) | (bytes[offset+1]<<16) | (bytes[offset+2]<<8) | bytes[offset+3];
    }
    this.read16 = function (offset) {
      return (bytes[offset+0]<<8) | bytes[offset+1];
    }
    this.read8 = function (offset) {
      return bytes[offset];
    }

    this.readString = function (offset, max_len) {
      var s = '';
      for (var i = 0; i < max_len; ++i) {
        var c = bytes[offset+i];
        if (c == 0) {
          break;
        }
        s += String.fromCharCode(c);
      }
      return s;
    }

    this.swap_dcba = function () {
      for (var i = 0; i < bytes.length; i += 4) {
        var a = bytes[i+0], b = bytes[i+1], c = bytes[i+2], d = bytes[i+3];
        bytes[i+0] = d;
        bytes[i+1] = c;
        bytes[i+2] = b;
        bytes[i+3] = a;
      }
    }

    this.swap_cdab = function () {
      for (var i = 0; i < bytes.length; i += 4) {
        var a = bytes[i+0], b = bytes[i+1], c = bytes[i+2], d = bytes[i+3];
        bytes[i+0] = c;
        bytes[i+1] = d;
        bytes[i+2] = a;
        bytes[i+3] = b;
      }
    }

    this.swap_badc = function () {
      for (var i = 0; i < bytes.length; i += 4) {
        var a = bytes[i+0], b = bytes[i+1], c = bytes[i+2], d = bytes[i+3];
        bytes[i+0] = b;
        bytes[i+1] = a;
        bytes[i+2] = d;
        bytes[i+3] = c;
      }     
    }
  }

  N64.loadRom = function (bytes) {
    rom = new Bytes(bytes);

    switch (rom.read32(0)) {
      case 0x80371240:
        // ok
        break;
      case 0x40123780:
        rom.swap_dcba();
        break;
      case 0x12408037:
        rom.swap_cdab();
        break;
      case 0x37804012:
        rom.swap_badc();
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
        '<td>' + i + '</td><td>' + (typeof hdr[i] === 'string' ? hdr[i] : toHex(hdr[i])) + '</td>' +
        '</tr>');
    }
    $rominfo.append($table); 
  }

  N64.refreshDisplay = function () {
    $registers.html('');
    var $table = $('<table class="register-table"><tbody></tbody></table>');
    var $tb = $table.find('tbody');
    for (var i = 0; i < 32; i+=4) {
      $tb.append('<tr>' + 
        '<td>' + gprRegisterNames[i+0] + '</td><td>0x' + toString64(gprLo[i+0], gprHi[i+0]) + '</td>' +
        '<td>' + gprRegisterNames[i+1] + '</td><td>0x' + toString64(gprLo[i+1], gprHi[i+1]) + '</td>' +
        '<td>' + gprRegisterNames[i+2] + '</td><td>0x' + toString64(gprLo[i+2], gprHi[i+2]) + '</td>' +
        '<td>' + gprRegisterNames[i+3] + '</td><td>0x' + toString64(gprLo[i+3], gprHi[i+3]) + '</td>' +
        '</tr>');
    }
    $registers.append($table);
  }

  function toHex(r) {
    r = 0xffffffff + r + 1;  // fix signed vaues being generated
    return '0x' + r.toString(16);
  }

  function toString64(lo, hi) {
    var t = lo.toString(16);
    while (t.length < 8)
      t = '0' + t;
    var u = hi.toString(16);
    while (u.length < 8)
      u = '0' + u;
    return u + t;
  }
})();