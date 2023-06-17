/*jshint jquery:true, browser:true, devel:true */
/*global Stats:false */

import { Controllers } from './controllers.js';
import * as _debugger from './debugger.js';
import { fixRomByteOrder } from './endian.js';
import * as format from './format.js';
import { Hardware } from './hardware.js';
import * as logger from './logger.js';
import { romdb } from './romdb.js';

(function (n64js) {'use strict';
  const toString32 = format.toString32;

  var stats = null;

  const kCyclesPerUpdate = 100000000;

  n64js.syncFlow = null;
  n64js.syncInput = null;
  function initSync() {
    n64js.syncFlow  = undefined;//n64js.createSyncConsumer();
    n64js.syncInput = undefined;//n64js.createSyncConsumer();
  }
  n64js.getSyncFlow = function () {
    return n64js.syncFlow;
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

  var running       = false;

  var resetCallbacks = [];

  const rominfo = {
    id:             '',
    name:           '',
    cic:            '6101',
    country:        0x45,
    save:           'Eeprom4k'
  };

  /**
   * An exception thrown when an assert fails.
   */
  class AssertException {
    constructor(message) {
    this.message = message;
    }
    toString() {
      return 'AssertException: ' + this.message;
    }
  }  

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

  // Keep a DataView around as a view onto the RSP task
  var kTaskOffset   = 0x0fc0;

  // FIXME - encapsulate this better.
  n64js.rsp_task_view = new DataView(hardware.sp_mem.arrayBuffer, kTaskOffset, 0x40);

  n64js.hardware = function () {
    return hardware;
  };

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
    fixRomByteOrder(arrayBuffer);

    const rom = hardware.createROM(arrayBuffer);

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
    return (n64js.syncFlow || n64js.syncInput) ? true : false;
  }

  function syncTick(maxCount) {
    const kEstimatedBytePerCycle = 8;
    let syncObjects = [n64js.syncFlow, n64js.syncInput];
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
        n64js.presentBackBuffer(n64js.getRamU8Array(), hardware.viRegDevice.viOrigin());
      }
    }

    if (stats) {
      stats.end();
    }
  }

  n64js.getRamU8Array = function () {
    return hardware.cachedMemDevice.u8;
  };

  n64js.getRamS32Array = function () {
    return hardware.cachedMemDevice.mem.s32;
  };

  n64js.getRamDataView = function () {
    // FIXME: should cache this object, or try to get rid of DataView entirely (Uint8Array + manual shuffling is faster)
    return new DataView(hardware.ram.arrayBuffer);
  };


  // Should read noise?
  n64js.getRandomU32 = function() {
    var hi = Math.floor( Math.random() * 0xffff ) & 0xffff;
    var lo = Math.floor( Math.random() * 0xffff ) & 0xffff;

    var v = (hi<<16) | lo;

    if (n64js.syncInput) {
      v = n64js.syncInput.reflect32(v);
    }

    return v;
  }

  const controllers = new Controllers(hardware);

  n64js.controllers = function () {
    return controllers;
  }

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
    switch (key) {
      case 'A'.charCodeAt(0): controllers.setButton(0, kButtonStart, down); break;
      case 'S'.charCodeAt(0): controllers.setButton(0, kButtonA, down); break;
      case 'X'.charCodeAt(0): controllers.setButton(0, kButtonB, down); break;
      case 'Z'.charCodeAt(0): controllers.setButton(0, kButtonZ, down); break;
      case 'Y'.charCodeAt(0): controllers.setButton(0, kButtonZ, down); break;
      case 'C'.charCodeAt(0): controllers.setButton(0, kButtonL, down); break;
      case 'V'.charCodeAt(0): controllers.setButton(0, kButtonR, down); break;

      case 'T'.charCodeAt(0): controllers.setButton(0, kButtonJUp, down); break;
      case 'G'.charCodeAt(0): controllers.setButton(0, kButtonJDown, down); break;
      case 'F'.charCodeAt(0): controllers.setButton(0, kButtonJLeft, down); break;
      case 'H'.charCodeAt(0): controllers.setButton(0, kButtonJRight, down); break;

      case 'I'.charCodeAt(0): controllers.setButton(0, kButtonCUp, down); break;
      case 'K'.charCodeAt(0): controllers.setButton(0, kButtonCDown, down); break;
      case 'J'.charCodeAt(0): controllers.setButton(0, kButtonCLeft, down); break;
      case 'L'.charCodeAt(0): controllers.setButton(0, kButtonCRight, down); break;

      case kKeyLeft:  controllers.setStickX(0, down ? -80 : 0); break;
      case kKeyRight: controllers.setStickX(0, down ? +80 : 0); break;
      case kKeyDown:  controllers.setStickY(0, down ? -80 : 0); break;
      case kKeyUp:    controllers.setStickY(0, down ? +80 : 0); break;
      //default: logger.log( 'up code:' + event.which);
    }
  };

  n64js.checkSIStatusConsistent = function() { hardware.checkSIStatusConsistent(); };

  n64js.getInstruction = address => {
    var instruction = hardware.memMap.readMemoryInternal32(address);
    if (((instruction>>26)&0x3f) === kOpBreakpoint) {
      instruction = breakpoints[address] || 0;
    }

    return instruction;
  };

  n64js.isBreakpoint = address => {
    var orig_op = hardware.memMap.readMemoryInternal32(address);
    return ((orig_op>>26)&0x3f) === kOpBreakpoint;
  };

  n64js.toggleBreakpoint = address => {
    var orig_op = hardware.memMap.readMemoryInternal32(address);
    var new_op;

    if (((orig_op>>26)&0x3f) === kOpBreakpoint) {
      // breakpoint is already set
      new_op = breakpoints[address] || 0;
      delete breakpoints[address];
    } else {
      new_op = (kOpBreakpoint<<26);
      breakpoints[address] = orig_op;
    }

    hardware.memMap.writeMemoryInternal32(address, new_op);
  };

  // 'emulated' read. May cause exceptions to be thrown in the emulated process
  const getMemoryHandler = hardware.memMap.getMemoryHandler.bind(hardware.memMap);
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

  //
  // Performance
  //
  var startTime;
  var lastPresentTime;

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

    hardware.reset();

    n64js.cpu0.reset();
    n64js.cpu1.reset();

    n64js.resetRenderer();

    // Simulate boot

    if (hardware.rom) {
      memoryCopy(hardware.sp_mem, kBootstrapOffset, hardware.rom, kBootstrapOffset, kGameOffset - kBootstrapOffset);
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

    for (let i = 0; i < resetCallbacks.length; ++i) {
      resetCallbacks[i]();
    }
  };

  n64js.verticalBlank = function () {
    // FIXME: framerate limit etc
    hardware.verticalBlank();
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
