/*jshint jquery:true browser:true */
/*global n64js*/

import { DebugController } from './debug_controller.js';
import * as microcodes from './microcodes.js';
import { RSPState } from './rsp_state.js';
import { Renderer } from './renderer.js';

window.n64js = window.n64js || {};

let numDisplayListsRendered = 0;

export function debugDisplayListRunning() {
  return debugController.running;
}

export function debugDisplayListRequested() {
  return debugController.requested;
}

export function toggleDebugDisplayList() {
  debugController.toggle();
}

export function debugDisplayList() {
  debugController.debugDisplayList();
}

export function hleGraphics(task) {
  debugController.onNewTask(task)
  processDList(task, null, -1);
}

let gl = null; // WebGL context for the canvas.

let renderer;

// Scale factor to apply to the canvas.
// TODO: expose this on the UI somewhere.
let canvasScale = 1;

const state = new RSPState();
const debugController = new DebugController(state);
// FIXME.
debugController.processDList = processDList;


function initWebGL(canvas) {
  if (gl) {
    return;
  }

  try {
    // Try to grab the standard context. If it fails, fallback to experimental.
    gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
  } catch (e) {
    // Ignore errors.
  }

  // If we don't have a GL context, give up now
  if (!gl) {
    alert("Unable to initialize WebGL. Your browser may not support it.");
  }
}

// const ucodeSprite2d = {
//   0xbe: executeSprite2dScaleFlip,
//   0xbd: executeSprite2dDraw
// };

// const ucodeDKR = {
//   0x05:  executeDMATri,
//   0x07:  executeGBI1_DLInMem,
// };

function buildUCodeTable(task, ramDV) {
  const microcode = microcodes.create(task, state, ramDV);
  // TODO: pass rendering object to microcode constructor.
  microcode.debugController = debugController;
  microcode.hleHalt = hleHalt;
  microcode.gl = gl;
  microcode.renderer = renderer;

  return microcode.buildCommandTable();
}

export function presentBackBuffer() {
  n64js.onPresent();

  if (numDisplayListsRendered !== 0) {
    renderer.copyBackBufferToFrontBuffer();
    return;
  }

  // If no display lists executed, interpret framebuffer as bytes
  initViScales();    // resize canvas to match VI res.

  const vi = n64js.hardware().viRegDevice;
  const pixels = vi.renderBackBuffer();
  if (!pixels) {
    return;
  }
  renderer.copyPixelsToFrontBuffer(pixels, vi.screenWidth, vi.screenHeight, vi.bitDepth);
}

function initViScales() {
  const vi = n64js.hardware().viRegDevice;
  const dims = vi.computeDimensions();
  if (!dims) {
    return;
  }

  renderer.nativeTransform.initDimensions(dims.srcWidth, dims.srcHeight);

  const canvas = document.getElementById('display');
  canvas.width = dims.screenWidth * canvasScale;
  canvas.height = dims.screenHeight * canvasScale;
}

function processDList(task, disassembler, bailAfter) {
  // Update a counter to tell the video code that we've rendered something.
  numDisplayListsRendered++;
  if (!gl) {
    return;
  }

  const ramDV = n64js.hardware().cachedMemDevice.mem.dataView
  state.reset(task.data_ptr);
  const ucodeTable = buildUCodeTable(task, ramDV);

  initViScales();

  renderer.newFrame();

  if (disassembler) {
    debugController.currentOp = 0;

    while (state.pc !== 0) {
      const pc = state.pc;
      const cmd0 = ramDV.getUint32(pc + 0);
      const cmd1 = ramDV.getUint32(pc + 4);
      state.pc += 8;

      disassembler.begin(pc, cmd0, cmd1, state.dlistStack.length);
      ucodeTable[cmd0 >>> 24](cmd0, cmd1, disassembler);
      disassembler.end();
      debugController.currentOp++;
    }
  } else {
    // Vanilla loop, no disassembler to worry about
    debugController.currentOp = 0;
    while (state.pc !== 0) {
      const pc = state.pc;
      const cmd0 = ramDV.getUint32(pc + 0);
      const cmd1 = ramDV.getUint32(pc + 4);
      state.pc += 8;

      ucodeTable[cmd0 >>> 24](cmd0, cmd1);

      if (debugController.postOp(bailAfter)) {
        break;
      }
    }
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

export function initialiseRenderer($canvas) {
  debugController.initUI();

  const canvas = $canvas[0];
  initWebGL(canvas); // Initialize the GL context

  // Only continue if WebGL is available and working
  if (!gl) {
    return;
  }

  renderer = new Renderer(gl, state, 640, 480);
  renderer.hleHalt = hleHalt;

  // FIXME - needed for buildTexture.
  debugController.renderer = renderer;
}

export function resetRenderer() {
  if (renderer) {
    renderer.reset();
  }
}

function hleHalt(msg) {
  if (!debugController.running) {
    return;
  }
  n64js.ui().displayWarning(msg);

  // Ensure the CPU emulation stops immediately
  n64js.breakEmulationForDisplayListDebug();

  debugController.halt();
}
