/*jshint jquery:true, browser:true, devel:true */
/*global Stats:false */

import { AIRegDevice } from './devices/ai.js';
import { Device } from './devices/device.js';
import { DPCDevice } from './devices/dpc.js';
import { DPSDevice } from './devices/dps.js';
import { MIRegDevice } from './devices/mi.js';
import * as pi from './devices/pi.js';
import { MappedMemDevice, CachedMemDevice, UncachedMemDevice } from './devices/ram.js';
import { RIRegDevice } from './devices/ri.js';
import { ROMD1A1Device, ROMD1A2Device, ROMD1A3Device, ROMD2A1Device, ROMD2A2Device } from './devices/rom.js';
import * as si from './devices/si.js';
import { SPMemDevice, SPRegDevice } from './devices/sp.js';
import { VIRegDevice } from './devices/vi.js';
import { MemoryRegion } from './MemoryRegion.js';
import * as _debugger from './debugger.js';
import * as format from './format.js';
import { Hardware } from './hardware.js';
import * as logger from './logger.js';
import { romdb } from './romdb.js';

(function (n64js) {'use strict';
  const toString32 = format.toString32;

  var stats = null;

  const kCyclesPerUpdate = 100000000;

  var syncFlow;
  var syncInput;
  function initSync() {
    syncFlow  = undefined;//n64js.createSyncConsumer();
    syncInput = undefined;//n64js.createSyncConsumer();
  }
  n64js.getSyncFlow = function () {
    return syncFlow;
  };

  const kBootstrapOffset = 0x40;
  const kGameOffset      = 0x1000;

  const kOpBreakpoint = 58;

  var breakpoints = {};     // address -> original op

  const SP_STATUS_REG       = 0x10;
  const SP_STATUS_HALT        = 0x0001;
  const SP_STATUS_BROKE       = 0x0002;
  const SP_STATUS_INTR_BREAK  = 0x0040;
  const SP_STATUS_SIG2        = 0x0200;
  const SP_STATUS_TASKDONE    = SP_STATUS_SIG2;

  // MIPS Interface
  const MI_MODE_REG         = 0x00;
  const MI_VERSION_REG      = 0x04;
  const MI_INTR_REG         = 0x08;
  const MI_INTR_MASK_REG    = 0x0C;

  const MI_INTR_SP        = 0x01;
  const MI_INTR_SI        = 0x02;
  const MI_INTR_AI        = 0x04;
  const MI_INTR_VI        = 0x08;
  const MI_INTR_PI        = 0x10;
  const MI_INTR_DP        = 0x20;

  // Serial Interface
  const SI_DRAM_ADDR_REG      = 0x00;
  const SI_PIF_ADDR_RD64B_REG = 0x04;
  const SI_PIF_ADDR_WR64B_REG = 0x10;
  const SI_STATUS_REG         = 0x18;

  const SI_STATUS_DMA_BUSY    = 0x0001;
  const SI_STATUS_RD_BUSY     = 0x0002;
  const SI_STATUS_DMA_ERROR   = 0x0008;
  const SI_STATUS_INTERRUPT   = 0x1000;

  var running       = false;

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

  /**
   * An exception thrown when an assert fails.
   * @constructor
   */
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

  // TODO: dedupe.
  function memoryCopy(dst, dstoff, src, srcoff, len) {
    var i;
    for (i = 0; i < len; ++i) {
      dst.u8[dstoff+i] = src.u8[srcoff+i];
    }
  }

  const hardware = new Hardware(rominfo);

  let rom           = hardware.rom;
  const pi_mem        = hardware.pi_mem;
  const ram           = hardware.ram
  const sp_mem        = hardware.sp_mem;
  const sp_reg        = hardware.sp_reg;
  const sp_ibist_mem  = hardware.sp_ibist_mem;
  const rdram_reg     = hardware.rdram_reg;
  const mi_reg        = hardware.mi_reg;
  const vi_reg        = hardware.vi_reg;
  const ai_reg        = hardware.ai_reg;
  const pi_reg        = hardware.pi_reg;
  const ri_reg        = hardware.ri_reg;
  const si_reg        = hardware.si_reg;

  var eeprom        = null;   // Initialised during reset, using correct size for this rom (may be null if eeprom isn't used)
  var eepromDirty   = false;

  // Keep a DataView around as a view onto the RSP task
  var kTaskOffset   = 0x0fc0;

  // FIXME - encapsulate this better.
  n64js.rsp_task_view = new DataView(sp_mem.arrayBuffer, kTaskOffset, 0x40);

  var mapped_mem_handler         = new MappedMemDevice(hardware, 0x00000000, 0x80000000);
  var rdram_handler_cached       = new CachedMemDevice(hardware, 0x80000000, 0x80800000);
  var rdram_handler_uncached     = new UncachedMemDevice(hardware, 0xa0000000, 0xa0800000);
  var rdram_reg_handler_uncached = new Device("RDRAMReg", rdram_reg,    0xa3f00000, 0xa4000000);
  var sp_mem_handler_uncached    = new SPMemDevice(hardware, 0xa4000000, 0xa4002000);
  var sp_reg_handler_uncached    = new SPRegDevice(hardware, 0xa4040000, 0xa4040020);
  var sp_ibist_handler_uncached  = new Device("SPIBIST",  sp_ibist_mem, 0xa4080000, 0xa4080008);
  var dpc_handler_uncached       = new DPCDevice(hardware, 0xa4100000, 0xa4100020);
  var dps_handler_uncached       = new DPSDevice(hardware, 0xa4200000, 0xa4200010);
  var mi_reg_handler_uncached    = new MIRegDevice(hardware, 0xa4300000, 0xa4300010);
  var vi_reg_handler_uncached    = new VIRegDevice(hardware, 0xa4400000, 0xa4400038);
  var ai_reg_handler_uncached    = new AIRegDevice(hardware, 0xa4500000, 0xa4500018);
  var pi_reg_handler_uncached    = new pi.PIRegDevice(hardware, 0xa4600000, 0xa4600034);
  var ri_reg_handler_uncached    = new RIRegDevice(hardware, 0xa4700000, 0xa4700020);
  var si_reg_handler_uncached    = new Device("SIReg",    si_reg,       0xa4800000, 0xa480001c);
  var rom_d2a1_handler_uncached  = new ROMD2A1Device(hardware, 0xa5000000, 0xa6000000);
  var rom_d1a1_handler_uncached  = new ROMD1A1Device(hardware, 0xa6000000, 0xa8000000);
  var rom_d2a2_handler_uncached  = new ROMD2A2Device(hardware, 0xa8000000, 0xb0000000);
  var rom_d1a2_handler_uncached  = new ROMD1A2Device(hardware, 0xb0000000, 0xbfc00000);
  var pi_mem_handler_uncached    = new pi.PIRamDevice(hardware, 0xbfc00000, 0xbfc00800);
  var rom_d1a3_handler_uncached  = new ROMD1A3Device(hardware, 0xbfd00000, 0xc0000000);

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

  function uint8ArrayReadString(u8array, offset, maxLen) {
    let s = '';
    for (let i = 0; i < maxLen; ++i) {
      const c = u8array[offset+i];
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
    return format.toHex(byteswap(crclo),32) + format.toHex(byteswap(crchi),32);
  }

  function generateCICType(u8array) {
    let cic = 0;
    for (let i = 0; i < 0xFC0; i++) {
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
        logger.log('Unknown CIC Code ' + toString32(cic) );
        return '6102';
    }
  }

  function loadRom(arrayBuffer) {
    fixEndian(arrayBuffer);

    hardware.createROM(arrayBuffer);
    rom = hardware.rom;

    rom_d1a1_handler_uncached.setMem(rom);
    rom_d1a2_handler_uncached.setMem(rom);
    rom_d1a3_handler_uncached.setMem(rom);

    const hdr = {
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

    const $table = $('<table class="register-table"><tbody></tbody></table>');
    const $tb = $table.find('tbody');
    for (let i in hdr) {
      $tb.append('<tr>' +
        '<td>' + i + '</td><td>' + (typeof hdr[i] === 'string' ? hdr[i] : toString32(hdr[i])) + '</td>' +
        '</tr>');
    }
    logger.logHTML($table);

    // Set up rominfo
    rominfo.cic     = generateCICType(rom.u8);
    rominfo.id      = generateRomId(hdr.crclo, hdr.crchi);
    rominfo.country = hdr.countryId;

    const info = romdb[rominfo.id];
    if (info) {
      logger.log('Loaded info for ' + rominfo.id + ' from db');
      rominfo.name = info.name;
      rominfo.save = info.save;
    } else {
      logger.log('No info for ' + rominfo.id + ' in db');
      rominfo.name = hdr.name;
      rominfo.save = 'Eeprom4k';
    }

    logger.log('rominfo is ' + JSON.stringify(rominfo));

    $('#title').text('n64js - ' + rominfo.name);
  }

  n64js.toggleRun = function () {
    running = !running;
    $('#runbutton').html(running ? '<i class="glyphicon glyphicon-pause"></i> Pause' : '<i class="glyphicon glyphicon-play"></i> Run');
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
    const $fileinput = $('#fileInput');
    // Reset fileInput value, otherwise onchange doesn't recognise when we select the same rome back-to-back
    $fileinput.val('');
    $fileinput.click();
  };

  n64js.loadFile = function () {
    const f = document.getElementById("fileInput");
    if (f && f.files.length > 0) {
      const file = f.files[0];
      const reader = new FileReader();

      reader.onerror = e => {
        n64js.displayWarning('error loading file');
      };
      reader.onload = e => {
        loadRom(e.target.result);
        n64js.reset();
        n64js.refreshDebugger();
        running = false;
        n64js.toggleRun();
      };

      reader.readAsArrayBuffer(file);
    }
  };

  n64js.step = () => {
    if (!running) {
      n64js.singleStep();
      n64js.refreshDebugger();
    }
  };

  function syncActive() {
    return (syncFlow || syncInput) ? true : false;
  }

  function syncTick(maxCount) {
    const kEstimatedBytePerCycle = 8;
    let syncObjects = [syncFlow, syncInput];
    let maxSafeCount = maxCount;

    for (let i = 0; i < syncObjects.length; ++i) {
      const s = syncObjects[i];
      if (s) {
        if (!s.tick()) {
          maxSafeCount = 0;
        }

        // Guesstimate num bytes used per cycle
        let count = Math.floor(s.getAvailableBytes() / kEstimatedBytePerCycle);

        // Ugh - bodgy hacky hacky for input sync
        count = Math.max(0, count - 100);

        maxSafeCount = Math.min(maxSafeCount, count);
      }
    }

    return maxSafeCount;
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
        $('#runbutton').html('<i class="glyphicon glyphicon-play"></i> Run');
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


  // Should read noise?
  n64js.getRandomU32 = function() {
    var hi = Math.floor( Math.random() * 0xffff ) & 0xffff;
    var lo = Math.floor( Math.random() * 0xffff ) & 0xffff;

    var v = (hi<<16) | lo;

    if (syncInput) {
      v = syncInput.reflect32(v);
    }

    return v;
  }

  rdram_reg_handler_uncached.calcEA  = function (address) {
    return address&0xff;
  };

  function siCopyFromRDRAM() {
    var dram_address = si_reg.readU32(SI_DRAM_ADDR_REG) & 0x1fffffff;
    var pi_ram       = new Uint8Array(pi_mem.arrayBuffer, 0x7c0, 0x040);

    if (!si_reg_handler_uncached.quiet) { logger.log('SI: copying from ' + toString32(dram_address) + ' to PI RAM'); }

    var i;
    for (i = 0; i < 64; ++i) {
      pi_ram[i] = ram.u8[dram_address+i];
    }

    var control_byte = pi_ram[0x3f];
    if (control_byte > 0) {
      if (!si_reg_handler_uncached.quiet) { logger.log('SI: wrote ' + control_byte + ' to the control byte'); }
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

    if (!si_reg_handler_uncached.quiet) { logger.log('SI: copying from PI RAM to ' + toString32(dram_address)); }

    var i;
    for (i = 0; i < 64; ++i) {
      ram.u8[dram_address+i] = pi_ram[i];
    }

    si_reg.setBits32(SI_STATUS_REG, SI_STATUS_INTERRUPT);
    mi_reg.setBits32(MI_INTR_REG, MI_INTR_SI);
    n64js.cpu0.updateCause3();
  }


  const PC_CONTROLLER_0      = 0;
  const PC_CONTROLLER_1      = 1;
  const PC_CONTROLLER_2      = 2;
  const PC_CONTROLLER_3      = 3;
  const PC_EEPROM            = 4;
  const PC_UNKNOWN_1         = 5;
  const NUM_CHANNELS         = 5;

  const CONT_GET_STATUS      = 0x00;
  const CONT_READ_CONTROLLER = 0x01;
  const CONT_READ_MEMPACK    = 0x02;
  const CONT_WRITE_MEMPACK   = 0x03;
  const CONT_READ_EEPROM     = 0x04;
  const CONT_WRITE_EEPROM    = 0x05;
  const CONT_RTC_STATUS      = 0x06;
  const CONT_RTC_READ        = 0x07;
  const CONT_RTC_WRITE       = 0x08;
  const CONT_RESET           = 0xff;

  const CONT_TX_SIZE_CHANSKIP   = 0x00;         // Channel Skip
  const CONT_TX_SIZE_DUMMYDATA  = 0xFF;         // Dummy Data
  const CONT_TX_SIZE_FORMAT_END = 0xFE;         // Format End
  const CONT_TX_SIZE_CHANRESET  = 0xFD;         // Channel Reset

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

  const kButtonA      = 0x8000;
  const kButtonB      = 0x4000;
  const kButtonZ      = 0x2000;
  const kButtonStart  = 0x1000;
  const kButtonJUp    = 0x0800;
  const kButtonJDown  = 0x0400;
  const kButtonJLeft  = 0x0200;
  const kButtonJRight = 0x0100;

  const kButtonL      = 0x0020;
  const kButtonR      = 0x0010;
  const kButtonCUp    = 0x0008;
  const kButtonCDown  = 0x0004;
  const kButtonCLeft  = 0x0002;
  const kButtonCRight = 0x0001;

  const kKeyLeft      = 37;
  const kKeyUp        = 38;
  const kKeyRight     = 39;
  const kKeyDown      = 40;


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
      //default: logger.log( 'up code:' + event.which);
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
    if (!controllers[channel].present) {
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

    switch(cmd[2]) {
    case CONT_RESET:
    case CONT_GET_STATUS:
      cmd[3] = 0x00;
      cmd[4] = 0x80; /// FIXME GetEepromContType();
      cmd[5] = 0x00;
      break;

    case CONT_READ_EEPROM:
      offset = cmd[3]*8;
      logger.log('Reading from eeprom+' + offset);
      for (i = 0; i < 8; ++i) {
        cmd[4+i] = eeprom.u8[offset+i];
      }
      break;

    case CONT_WRITE_EEPROM:
      offset = cmd[3]*8;
      logger.log('Writing to eeprom+' + offset);
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
      n64js.halt('unknown eeprom command: ' + format.toString8(cmd[2]));
      break;
    }

    return false;
  }

  function calculateDataCrc(buf, offset) {
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
      logger.log('Reading from mempack+' + addr);
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
      logger.log('Writing to mempack+' + addr);
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
        if (!this.quiet) { logger.log('Writing to SI dram address reigster: ' + toString32(value) ); }
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
        if (!this.quiet) { logger.log('SI interrupt cleared'); }
        si_reg.clearBits32(SI_STATUS_REG, SI_STATUS_INTERRUPT);
        mi_reg.clearBits32(MI_INTR_REG,   MI_INTR_SI);
        n64js.cpu0.updateCause3();
        break;
      default:
        logger.log('Unhandled write to SIReg: ' + toString32(value) + ' -> [' + toString32(address) + ']' );
        this.mem.write32(ea, value);
        break;
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

    logger.log('read from unhandled location ' + toString32(address));
    throw 'unmapped read ' + toString32(address) + ' - need to set exception';
  }

  // Read/Write memory internal is used for stuff like the debugger. It shouldn't ever throw or change the state of the emulated program.
  n64js.readMemoryInternal32 = address => {
    var handler = memMap[address >>> 18];
    if (handler) {
      return handler.readInternal32(address);
    }
    return 0xdddddddd;
  };

  n64js.writeMemoryInternal32 = (address, value) => {
    var handler = memMap[address >>> 18];
    if (handler) {
      handler.writeInternal32(address, value);
    }
  };

  n64js.getInstruction = address => {
    var instruction = n64js.readMemoryInternal32(address);
    if (((instruction>>26)&0x3f) === kOpBreakpoint) {
      instruction = breakpoints[address] || 0;
    }

    return instruction;
  };

  n64js.isBreakpoint = address => {
    var orig_op = n64js.readMemoryInternal32(address);
    return ((orig_op>>26)&0x3f) === kOpBreakpoint;
  };

  n64js.toggleBreakpoint = address => {
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
  n64js.readMemoryU32 = address => { return getMemoryHandler(address).readU32(address); };
  n64js.readMemoryU16 = address => { return getMemoryHandler(address).readU16(address); };
  n64js.readMemoryU8  = address => { return getMemoryHandler(address).readU8(address);  };

  n64js.readMemoryS32 = address => { return getMemoryHandler(address).readS32(address); };
  n64js.readMemoryS16 = address => { return getMemoryHandler(address).readS16(address); };
  n64js.readMemoryS8  = address => { return getMemoryHandler(address).readS8(address);  };

  // 'emulated' write. May cause exceptions to be thrown in the emulated process
  n64js.writeMemory32 = (address, value) => { return getMemoryHandler(address).write32(address, value); };
  n64js.writeMemory16 = (address, value) => { return getMemoryHandler(address).write16(address, value); };
  n64js.writeMemory8  = (address, value) => { return getMemoryHandler(address).write8(address, value); };

  var Base64 = {
    lookup : "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",
    encodeArray(arr) {
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

    decodeArray(str, arr) {
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
    var memory = new MemoryRegion(new ArrayBuffer(size));
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

    pi_reg_handler_uncached.reset();

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

    ri_reg_handler_uncached.reset();

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

    vi_reg_handler_uncached.verticalBlank();
  };

  n64js.miInterruptsUnmasked = function () {
    return (mi_reg.readU32(MI_INTR_MASK_REG) & mi_reg.readU32(MI_INTR_REG)) !== 0;
  };

  n64js.miIntrReg = function () {
    return mi_reg.readU32(MI_INTR_REG);
  };

  n64js.miIntrMaskReg = function () {
    return mi_reg.readU32(MI_INTR_MASK_REG);
  };

  n64js.viOrigin = function () { return vi_reg_handler_uncached.viOrigin(); };
  n64js.viWidth  = function () { return vi_reg_handler_uncached.viWidth(); };
  n64js.viXScale = function () { return vi_reg_handler_uncached.viXScale(); };
  n64js.viYScale = function () { return vi_reg_handler_uncached.viYScale(); };
  n64js.viHStart = function () { return vi_reg_handler_uncached.viHStart(); };
  n64js.viVStart = function () { return vi_reg_handler_uncached.viVStart(); };

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
      logger.log(m);
    }
  };

  n64js.warn = function (m) {
    logger.log(m);
  };

  n64js.stopForBreakpoint = function () {
    running = false;
    n64js.cpu0.breakExecution();
    logger.log('<span style="color:red">Breakpoint</span>');
  };

  n64js.halt = function (msg) {
    running = false;
    n64js.cpu0.breakExecution();
    logger.log('<span style="color:red">' + msg + '</span>');

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
