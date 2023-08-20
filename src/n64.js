/*jshint jquery:true, browser:true, devel:true */
/*global Stats:false */

import { simulateBoot } from './boot.js';
import { Controllers } from './controllers.js';
import { Debugger } from './debugger.js';
import { fixRomByteOrder } from './endian.js';
import { toString32 } from './format.js';
import { Hardware } from './hardware.js';
import { debugDisplayList, debugDisplayListRequested, debugDisplayListRunning, presentBackBuffer, initialiseRenderer, resetRenderer } from './hle.js';
import * as json from './json.js';
import * as logger from './logger.js';
import { romdb, generateRomId, generateCICType, uint8ArrayReadString } from './romdb.js';
import { countryNorthAmerica, OS_TV_NTSC, tvTypeFromCountry } from './system_constants.js';
import { UI } from './ui.js';
import { initSync, syncActive, syncTick, syncInput } from './sync.js';

window.n64js = window.n64js || {};

const kOpBreakpoint = 28;
const kCyclesPerUpdate = 100000000;

let stats = null;
let running = false;
const breakpoints = new Map();     // address -> original op
const resetCallbacks = [];

const rominfo = {
  id: '',
  name: '',
  cic: '6101',
  country: countryNorthAmerica,
  tvType: OS_TV_NTSC,
  save: 'Eeprom4k'
};

const hardware = new Hardware(rominfo);
const controllers = new Controllers(hardware);
const ui = new UI();
let dbg = null; // FIXME: can't use debugger as a variable name - fix this when wrapping in a class.

function setRunning(value) {
  running = value;
  ui.setRunning(value);
}

function computeHash(arrayBuffer) {
  const hash = md5(arrayBuffer);
  logger.log(`hash is ${hash}`);
}

function loadRom(arrayBuffer) {
  fixRomByteOrder(arrayBuffer);

  computeHash(arrayBuffer);

  const rom = hardware.createROM(arrayBuffer);

  const hdr = {
    header: rom.getU32(0),
    clock: rom.getU32(4),
    bootAddress: rom.getU32(8),
    release: rom.getU32(12),
    crclo: rom.getU32(16),   // or hi?
    crchi: rom.getU32(20),   // or lo?
    unk0: rom.getU32(24),
    unk1: rom.getU32(28),
    name: uint8ArrayReadString(rom.u8, 32, 20),
    unk2: rom.getU32(52),
    unk3: rom.getU16(56),
    unk4: rom.getU8(58),
    manufacturer: rom.getU8(59),
    cartId: rom.getU16(60),
    countryId: rom.getU8(62),  // char
    unk5: rom.getU8(63)
  };

  const $table = $('<table class="register-table"><tbody></tbody></table>');
  const $tb = $table.find('tbody');
  for (let i in hdr) {
    const value = typeof hdr[i] === 'string' ? hdr[i] : toString32(hdr[i]);
    $tb.append(`<tr><td>${i}</td><td>${value}</td></tr>`);
  }
  logger.logHTML($table);

  // Set up rominfo
  rominfo.cic = generateCICType(rom.u8);
  rominfo.id = generateRomId(hdr.crclo, hdr.crchi);
  rominfo.country = hdr.countryId;
  rominfo.tvType = tvTypeFromCountry(hdr.countryId);

  const info = romdb[rominfo.id];
  if (info) {
    logger.log(`Loaded info for ${rominfo.id} from db`);
    rominfo.name = info.name;
    rominfo.save = info.save;
  } else {
    logger.log(`No info for ${rominfo.id} in db`);
    rominfo.name = hdr.name;
    rominfo.save = 'Eeprom4k';
  }

  logger.log(`rominfo is ${json.serialize(rominfo)}`);

  $('#title').text(`n64js - ${rominfo.name}`);
}

n64js.hardware = () => hardware;
n64js.controllers = () => controllers
n64js.ui = () => ui;
n64js.debugger = () => dbg;

// Keep a DataView around as a view onto the RSP task
// FIXME - encapsulate this better.
const kTaskOffset = 0x0fc0;
n64js.rsp_task_view = new DataView(hardware.sp_mem.arrayBuffer, kTaskOffset, 0x40);

n64js.loadRomAndStartRunning = (arrayBuffer) => {
  loadRom(arrayBuffer);
  n64js.reset();
  dbg.redraw();
  setRunning(false);
  n64js.toggleRun();
};

n64js.toggleRun = () => {
  setRunning(!running);
  if (running) {
    updateLoopAnimframe();
  }
};

n64js.breakEmulationForDisplayListDebug = () => {
  if (running) {
    n64js.toggleRun();
    breakAllExecution();
    //updateLoopAnimframe();
  }
};

n64js.step = () => {
  if (!running) {
    n64js.singleStep();
    dbg.redraw();
  }
};

function updateLoopAnimframe() {
  if (stats) {
    stats.begin();
  }

  if (running) {
    requestAnimationFrame(updateLoopAnimframe);

    let maxCycles = kCyclesPerUpdate;

    // Don't slow down debugger if we're waiting for a display list to be debugged.
    if (n64js.debuggerVisible() && !debugDisplayListRequested) {
      maxCycles = dbg.debugCycles;
    }

    if (syncActive()) {
      // Check how many cycles we can safely execute
      maxCycles = syncTick(maxCycles);
    }

    if (maxCycles > 0) {
      n64js.run(maxCycles);
      dbg.redraw();
    }
  } else if (debugDisplayListRunning) {
    requestAnimationFrame(updateLoopAnimframe);
    if (debugDisplayList()) {
      presentBackBuffer(n64js.getRamU8Array());
    }
  }

  if (stats) {
    stats.end();
  }
}

n64js.getRamU8Array = () => hardware.cachedMemDevice.u8;
n64js.getRamS32Array = () => hardware.cachedMemDevice.s32;
n64js.getRamDataView = () => hardware.cachedMemDevice.mem.dataView;

// Should read noise?
n64js.getRandomU32 = () => {
  const hi = Math.floor(Math.random() * 0xffff) & 0xffff;
  const lo = Math.floor(Math.random() * 0xffff) & 0xffff;
  const v = (hi << 16) | lo;
  if (syncInput) {
    return syncInput.reflect32(v);
  }
  return v;
}

n64js.checkSIStatusConsistent = () => { hardware.checkSIStatusConsistent(); };

n64js.getInstruction = address => {
  const instr = hardware.memMap.readMemoryInternal32(address);
  if (isBreakpointInstruction(instr)) {
    return breakpoints[address] || 0;
  }
  return instr;
};

n64js.isBreakpoint = address => {
  const instr = hardware.memMap.readMemoryInternal32(address);
  return isBreakpointInstruction(instr);
};

n64js.toggleBreakpoint = address => {
  const origInstr = hardware.memMap.readMemoryInternal32(address);

  let newInstr;
  if (isBreakpointInstruction(origInstr)) {
    // breakpoint is already set
    newInstr = breakpoints[address] || 0;
    delete breakpoints[address];
  } else {
    newInstr = (kOpBreakpoint << 26);
    breakpoints[address] = origInstr;
  }

  hardware.memMap.writeMemoryInternal32(address, newInstr);
};

function isBreakpointInstruction(instr) {
  return ((instr >> 26) & 0x3f) === kOpBreakpoint;
}

function getLocalStorageName(item) {
  return item + '-' + rominfo.id;
}

n64js.getLocalStorageItem = (name) => {
  const lsName = getLocalStorageName(name);
  const dataStr = localStorage.getItem(lsName);
  return dataStr ? json.deserialize(dataStr) : undefined;
};

n64js.setLocalStorageItem = (name, data) => {
  const lsName = getLocalStorageName(name);
  const dataStr = json.serialize(data);
  localStorage.setItem(lsName, dataStr);
};

//
// Performance
//
let startTime;
let lastPresentTime;

n64js.emitRunningTime = (msg) => {
  const curTime = new Date();
  const elapsed = curTime.getTime() - startTime.getTime();
  const elapsedStr = elapsed.toString();
  n64js.ui().displayWarning(`Time to ${msg} ${elapsedStr}`);
};

function setFrameTime(t) {
  const titleText = rominfo.name ? `n64js - ${rominfo.name} - ${t}mspf` : `n64js - ${t}mspf`;
  $('#title').text(titleText);
}

n64js.onPresent = () => {
  const curTime = new Date();
  if (lastPresentTime) {
    const elapsed = curTime.getTime() - lastPresentTime.getTime();
    setFrameTime(elapsed);
  }
  lastPresentTime = curTime;
};

n64js.addResetCallback = (fn) => {
  resetCallbacks.push(fn);
};

n64js.reset = () => {
  breakpoints.clear();

  initSync();

  hardware.reset();

  n64js.cpu0.reset();
  n64js.cpu1.reset();
  n64js.rsp.reset();

  resetRenderer();

  // Simulate boot
  hardware.loadROM();

  simulateBoot(n64js.cpu0, hardware, rominfo);

  startTime = new Date();
  lastPresentTime = undefined;

  for (let callback of resetCallbacks) {
    callback();
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

n64js.stopForBreakpoint = () => { stop("Breakpoint", false); };
n64js.halt = (msg) => { stop(msg, true); };

function stop(msg, isError) {
  setRunning(false);
  breakAllExecution();
  logger.log('<span style="color:red">' + msg + '</span>');
  if (isError) {
    n64js.ui().displayError(msg);
  }
}

// Similar to halt, but just relinquishes control to the system
n64js.returnControlToSystem = () => {
  breakAllExecution();
};

function breakAllExecution() {
  n64js.cpu0.breakExecution();
}

n64js.init = () => {
  n64js.reset();
  dbg = new Debugger();
  initialiseRenderer($('#display'));

  const body = document.querySelector('body');
  body.addEventListener('keyup', (event) => {
    controllers.handleKey(0, event.key, false);
  });
  body.addEventListener('keydown', (event) => {
    controllers.handleKey(0, event.key, true);
  });

  ui.domLoaded();
};

n64js.togglePerformance = () => {
  const parent = document.getElementById("performance");
  if (stats) {
    parent.removeChild(stats.dom);
    stats = null;
  } else {
    stats = new Stats();
    stats.showPanel(1); // 0: fps, 1: ms
    stats.dom.style.position = 'relative';
    parent.appendChild(stats.dom);
  }
};
