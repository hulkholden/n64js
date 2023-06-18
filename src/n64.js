/*jshint jquery:true, browser:true, devel:true */
/*global Stats:false */

import { simulateBoot } from './boot.js';
import { Controllers } from './controllers.js';
import * as _debugger from './debugger.js';
import { fixRomByteOrder } from './endian.js';
import { toString32, toHex } from './format.js';
import { Hardware } from './hardware.js';
import * as logger from './logger.js';
import { romdb } from './romdb.js';

const kOpBreakpoint = 58;
const kCyclesPerUpdate = 100000000;

let stats = null;
let running = false;
let breakpoints = {};     // address -> original op
const resetCallbacks = [];

let syncFlow = null;
let syncInput = null;

const rominfo = {
  id: '',
  name: '',
  cic: '6101',
  country: 0x45,
  save: 'Eeprom4k'
};
const hardware = new Hardware(rominfo);
const controllers = new Controllers(hardware);

function initSync() {
  syncFlow = undefined;//n64js.createSyncConsumer();
  syncInput = undefined;//n64js.createSyncConsumer();
}

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

function uint8ArrayReadString(u8array, offset, maxLen) {
  let s = '';
  for (let i = 0; i < maxLen; ++i) {
    const c = u8array[offset + i];
    if (c === 0) {
      break;
    }
    s += String.fromCharCode(c);
  }
  return s;
}

function byteswap(a) {
  return ((a >> 24) & 0x000000ff) |
    ((a >> 8) & 0x0000ff00) |
    ((a << 8) & 0x00ff0000) |
    ((a << 24) & 0xff000000);
}

function generateRomId(crclo, crchi) {
  return toHex(byteswap(crclo), 32) + toHex(byteswap(crchi), 32);
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
      logger.log('Unknown CIC Code ' + toString32(cic));
      return '6102';
  }
}

function loadRom(arrayBuffer) {
  fixRomByteOrder(arrayBuffer);

  const rom = hardware.createROM(arrayBuffer);

  const hdr = {
    header: rom.readU32(0),
    clock: rom.readU32(4),
    bootAddress: rom.readU32(8),
    release: rom.readU32(12),
    crclo: rom.readU32(16),   // or hi?
    crchi: rom.readU32(20),   // or lo?
    unk0: rom.readU32(24),
    unk1: rom.readU32(28),
    name: uint8ArrayReadString(rom.u8, 32, 20),
    unk2: rom.readU32(52),
    unk3: rom.readU16(56),
    unk4: rom.readU8(58),
    manufacturer: rom.readU8(59),
    cartId: rom.readU16(60),
    countryId: rom.readU8(62),  // char
    unk5: rom.readU8(63)
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
  rominfo.cic = generateCICType(rom.u8);
  rominfo.id = generateRomId(hdr.crclo, hdr.crchi);
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

(function (n64js) {
  'use strict';
  n64js.hardware = () => hardware;
  n64js.controllers = () => controllers

  n64js.getSyncFlow = () => syncFlow;
  n64js.getSyncInput = () => syncInput;

  // Keep a DataView around as a view onto the RSP task
  // FIXME - encapsulate this better.
  const kTaskOffset = 0x0fc0;
  n64js.rsp_task_view = new DataView(hardware.sp_mem.arrayBuffer, kTaskOffset, 0x40);

  n64js.toggleRun = () => {
    running = !running;
    $('#runbutton').html(running ? '<i class="glyphicon glyphicon-pause"></i> Pause' : '<i class="glyphicon glyphicon-play"></i> Run');
    if (running) {
      updateLoopAnimframe();
    }
  };

  n64js.breakEmulationForDisplayListDebug = () => {
    if (running) {
      n64js.toggleRun();
      n64js.cpu0.breakExecution();
      //updateLoopAnimframe();
    }
  };

  n64js.triggerLoad = () => {
    const $fileinput = $('#fileInput');
    // Reset fileInput value, otherwise onchange doesn't recognise when we select the same rome back-to-back
    $fileinput.val('');
    $fileinput.click();
  };

  n64js.loadFile = () => {
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

  n64js.getRamU8Array = () => hardware.cachedMemDevice.u8;
  n64js.getRamS32Array = () => hardware.cachedMemDevice.mem.s32;
  // FIXME: should cache this object, or try to get rid of DataView entirely (Uint8Array + manual shuffling is faster)
  n64js.getRamDataView = () => new DataView(hardware.ram.arrayBuffer);

  // Should read noise?
  n64js.getRandomU32 = () => {
    var hi = Math.floor(Math.random() * 0xffff) & 0xffff;
    var lo = Math.floor(Math.random() * 0xffff) & 0xffff;

    var v = (hi << 16) | lo;

    if (syncInput) {
      v = syncInput.reflect32(v);
    }

    return v;
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

  n64js.handleKey = (key, down) => {
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

      case kKeyLeft: controllers.setStickX(0, down ? -80 : 0); break;
      case kKeyRight: controllers.setStickX(0, down ? +80 : 0); break;
      case kKeyDown: controllers.setStickY(0, down ? -80 : 0); break;
      case kKeyUp: controllers.setStickY(0, down ? +80 : 0); break;
      //default: logger.log( 'up code:' + event.which);
    }
  };

  n64js.checkSIStatusConsistent = () => { hardware.checkSIStatusConsistent(); };

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

  n64js.getLocalStorageItem = (name) => {
    var ls_name = getLocalStorageName(name);
    var data_str = localStorage.getItem(ls_name);
    var data = data_str ? JSON.parse(data_str) : undefined;
    return data;
  };

  n64js.setLocalStorageItem = (name, data) => {
    var ls_name = getLocalStorageName(name);
    var data_str = JSON.stringify(data);
    localStorage.setItem(ls_name, data_str);
  };

  //
  // Performance
  //
  let startTime;
  let lastPresentTime;

  n64js.emitRunningTime  = (msg) => {
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

  n64js.onPresent = () => {
    var cur_time = new Date();
    if (lastPresentTime) {
      var t = cur_time.getTime() - lastPresentTime.getTime();
      setFrameTime(t);
    }

    lastPresentTime = cur_time;
  };

  n64js.addResetCallback = (fn) => {
    resetCallbacks.push(fn);
  };

  n64js.reset = () => {
    breakpoints = {};

    initSync();

    hardware.reset();

    n64js.cpu0.reset();
    n64js.cpu1.reset();

    n64js.resetRenderer();

    // Simulate boot
    hardware.loadROM();

    simulateBoot(n64js.cpu0, rominfo);

    startTime = new Date();
    lastPresentTime = undefined;

    for (let i = 0; i < resetCallbacks.length; ++i) {
      resetCallbacks[i]();
    }
  };

  n64js.verticalBlank = () => {
    // FIXME: framerate limit etc
    hardware.verticalBlank();
  };

  n64js.check = (e, m) => {
    if (!e) {
      logger.log(m);
    }
  };

  n64js.warn = (m) => {
    logger.log(m);
  };

  n64js.stopForBreakpoint = () => {
    running = false;
    n64js.cpu0.breakExecution();
    logger.log('<span style="color:red">Breakpoint</span>');
  };

  n64js.halt = (msg) => {
    running = false;
    n64js.cpu0.breakExecution();
    logger.log('<span style="color:red">' + msg + '</span>');

    n64js.displayError(msg);
  };

  n64js.displayWarning = (message) => {
    var $alert = $('<div class="alert"><button class="close" data-dismiss="alert">×</button><strong>Warning!</strong> ' + message + '</div>');
    $('#alerts').append($alert);
  };
  n64js.displayError = (message) => {
    var $alert = $('<div class="alert alert-error"><button class="close" data-dismiss="alert">×</button><strong>Error!</strong> ' + message + '</div>');
    $('#alerts').append($alert);
  };

  // Similar to halt, but just relinquishes control to the system
  n64js.returnControlToSystem = () => {
    n64js.cpu0.breakExecution();
  };

  n64js.init = () => {
    n64js.reset();

    $('.debug').hide();

    n64js.initialiseDebugger();

    n64js.initialiseRenderer($('#display'));

    $('body').keyup((event) => {
      n64js.handleKey(event.which, false);
    });
    $('body').keydown((event) => {
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
    $('.tabbable a').on('shown', (e) => {
        n64js.refreshDebugger();
      });

    n64js.refreshDebugger();
  };

  n64js.togglePerformance = () => {
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
