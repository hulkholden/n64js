/*jshint jquery:true, browser:true, devel:true */
/*global $, n64js, Stats, md5, __BUILD_VERSION__*/

import { simulateBoot } from './boot.js';
import { Breakpoints } from './debug/breakpoints.js';
import { Controllers } from './controllers.js';
import { Joybus } from './joybus.js';
import { Debugger } from './debug/debugger.js';
import { fixRomByteOrder } from './endian.js';
import { toString32 } from './format.js';
import { FramePacer } from './frame_pacer.js';
import { Hardware } from './hardware.js';
import { debugDisplayList, debugDisplayListRequested, debugDisplayListRunning, presentBackBuffer, initialiseRenderer, graphics } from './hle/hle_graphics.js';
import * as json from './json.js';
import * as logger from './logger.js';
import { initCPU, invalidateCode } from './cpu/r4300.js';
import { romdb, generateRomId, generateCICType, uint8ArrayReadString } from './romdb.js';
import { initRSP } from './rsp/rsp.js';
import { categoryCodeDescriptionFromU8, countryNorthAmerica, OS_TV_NTSC, tvTypeFromCountry } from './system_constants.js';
import { UI } from './ui/ui.js';
import { initSync, syncActive, syncTick } from './sync.js';
import { dbgGUI } from './debug/dbg_ui.js';

window.n64js = window.n64js || {};

const kCyclesPerUpdate = 100_000_000;

let stats = null;
let running = false;
let animationFrame = null;
const framePacer = new FramePacer();
const resetCallbacks = [];

const testOptions = {
  runTest: runTest,
  recordTimeline: recordTimeline,
};
dbgGUI.add(testOptions, 'runTest').name('Run n64-systemtest');
dbgGUI.add(testOptions, 'recordTimeline').name('Record Timeline');

const rominfo = {
  id: '',
  name: '',
  cic: '6101',
  country: countryNorthAmerica,
  tvType: OS_TV_NTSC,
  save: 'Eeprom4k'
};

const hardware = new Hardware(rominfo, { graphics });
const breakpoints = new Breakpoints(hardware, invalidateCode);
const controllers = new Controllers();
const joybus = new Joybus(hardware, controllers.inputs);
const ui = new UI();
let dbg = null; // FIXME: can't use debugger as a variable name - fix this when wrapping in a class.

function setRunning(value) {
  resetFrameTime();
  if (animationFrame !== null) {
    cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }
  framePacer.reset();
  running = value;
  if (running) {
    hardware.aiRegDevice.audioContext.resume().catch(err => console.warn('Unable to resume audio:', err));
  }
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
    release: rom.getU32(12),  // libultra version
    crclo: rom.getU32(16),   // or hi?
    crchi: rom.getU32(20),   // or lo?
    unk0: rom.getU32(24),
    unk1: rom.getU32(28),
    name: uint8ArrayReadString(rom.u8, 32, 20),
    unk2: rom.getU32(52),
    unk3: rom.getU16(56),
    unk4: rom.getU8(58),
    categoryCode: categoryCodeDescriptionFromU8(rom.getU8(59)),
    cartId: rom.getU16(60),     // unique id for the cart
    countryId: rom.getU8(62),  // char
    romVersion: rom.getU8(63),  // or homebrew savetype - see https://n64brew.dev/wiki/ROM_Header
  };
  console.log(hdr);

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
n64js.joybus = () => joybus
n64js.ui = () => ui;
n64js.debugger = () => dbg;

n64js.loadRomAndStartRunning = (arrayBuffer) => {
  loadRom(arrayBuffer);
  n64js.reset();
  dbg.hide();
  // TODO: this seems a bit hacky.
  setRunning(false);
  n64js.toggleRun();
};

function runTest() {
  const byteArray = [];
  const req = new XMLHttpRequest();
  req.open('GET', 'roms/n64-systemtest-all.z64', true);
  req.responseType = "arraybuffer";
  req.onload = () => {
    const arrayBuffer = req.response; // Note: not req.responseText
    if (arrayBuffer) {
      n64js.loadRomAndStartRunning(arrayBuffer);
    }
  };
  req.send(null);

  if (req.status != 200) return;
  for (let i = 0; i < req.responseText.length; ++i) {
    byteArray.push(req.responseText.charCodeAt(i) & 0xff)
  }
}

function recordTimeline() {
  hardware.timeline.startRecording();
}

n64js.toggleRun = () => {
  setRunning(!running);
  if (running) {
    updateLoopAnimframe();
  }
};

n64js.toggleFullscreen = () => {
  const canvas = document.getElementById('display');
  canvas.requestFullscreen().catch((err) => {
    console.log(
      `Error attempting to enable fullscreen mode: ${err.message} (${err.name})`,
    );
  });
};

n64js.breakEmulationForDisplayListDebug = () => {
  if (running) {
    n64js.toggleRun();
    breakAllExecution();
    // Pausing cancels the emulation callback, but display-list replay still
    // needs its own animation loop while CPU execution is stopped.
    animationFrame = requestAnimationFrame(updateLoopAnimframe);
  }
};

n64js.step = () => {
  if (!running) {
    n64js.singleStep();
    dbg.redraw();
  }
};

function updateLoopAnimframe(now = performance.now()) {
  animationFrame = null;
  if (stats) {
    stats.begin();
  }

  if (running) {
    animationFrame = requestAnimationFrame(updateLoopAnimframe);

    // Poll for input changes.
    controllers.updateInput();

    // Don't slow down debugger if we're waiting for a display list to be debugged.
    const debugging = dbg.active && !debugDisplayListRequested();
    let frames = framePacer.framesDue(now, hardware.viRegDevice.refreshRate);
    if (debugging || syncActive()) {
      framePacer.reset();
      frames = 1;
    }

    for (let i = 0; i < frames && running; i++) {
      if (hardware.aiRegDevice.shouldSkipFrame()) {
        break;
      }
      let maxCycles = debugging ? dbg.debugCycles : kCyclesPerUpdate;
      if (syncActive()) {
        // Check how many cycles we can safely execute.
        maxCycles = syncTick(maxCycles);
      }
      if (maxCycles <= 0) {
        break;
      }
      n64js.cpu0.run(maxCycles);
    }
    dbg.redraw();
  } else if (debugDisplayListRunning()) {
    animationFrame = requestAnimationFrame(updateLoopAnimframe);
    debugDisplayList();
    presentBackBuffer();
  }

  if (stats) {
    stats.end();
  }
}

n64js.breakpoints = () => {
  return breakpoints;
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
let lastPresentTime;
let frameTimeTotal = 0;
let frameTimeCount = 0;

function resetFrameTime() {
  lastPresentTime = undefined;
  frameTimeTotal = 0;
  frameTimeCount = 0;
}

function setFrameTime(t) {
  const titleText = rominfo.name ? `n64js - ${rominfo.name} - ${t}mspf` : `n64js - ${t}mspf`;
  $('#title').text(titleText);
}

n64js.onPresent = () => {
  const curTime = performance.now();
  if (lastPresentTime !== undefined) {
    frameTimeTotal += curTime - lastPresentTime;
    frameTimeCount++;
    // Average over a quarter second and limit how often the counter changes.
    if (frameTimeTotal >= 250) {
      setFrameTime((frameTimeTotal / frameTimeCount).toFixed(1));
      frameTimeTotal = 0;
      frameTimeCount = 0;
    }
  }
  lastPresentTime = curTime;
};

n64js.addResetCallback = (fn) => {
  resetCallbacks.push(fn);
};

n64js.reset = () => {
  framePacer.reset();
  breakpoints.reset();

  initSync();

  hardware.reset();

  initCPU(hardware);
  initRSP(hardware);

  // Simulate boot
  hardware.loadROM();

  simulateBoot(n64js.cpu0, hardware, rominfo);

  resetFrameTime();

  for (let callback of resetCallbacks) {
    callback();
  }
};

n64js.check = (e, m) => {
  if (!e) {
    logger.log(m);
  }
};

n64js.warn = (m) => {
  logger.warn(m);
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
  document.getElementById('build-version').textContent = __BUILD_VERSION__;
  n64js.reset();
  dbg = new Debugger();
  initialiseRenderer($('#display'));
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
