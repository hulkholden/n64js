/*global n64js*/

import { DebugController } from './debug_controller.js';
import { executeDisplayList } from './display_list.js';
import * as microcodes from './microcodes.js';
import { RSPState } from './rsp_state.js';
import { Renderer } from './renderer.js';
import { graphicsOptions } from './graphics_options.js';
import { toString32 } from '../format.js';

window.n64js = window.n64js || {};

let numDisplayListsRendered = 0;
let gl = null; // WebGL context for the canvas.
let renderer;

const state = new RSPState();
const debugController = new DebugController(state, processDList);

// Graphics processor backed by the shared browser renderer and debugger.
export const graphics = {
  processTask: hleGraphics,
  reset: resetRenderer,
};

export function initialiseRenderer(canvas) {
  debugController.initUI();

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

function resetRenderer() {
  if (renderer) {
    renderer.reset();
  }
}

function initWebGL(canvas) {
  if (gl) {
    return;
  }

  try {
    // Try to grab the standard context. If it fails, fallback to experimental.
    gl = canvas.getContext("webgl2");
  } catch (e) {
    // Ignore errors.
  }

  // If we don't have a GL context, give up now
  if (!gl) {
    alert("Unable to initialize WebGL. Your browser may not support it.");
  }
}

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

function hleGraphics(task) {
  debugController.onNewTask(task)
  return processDList(task, null, -1, () => n64js.hardware().dpcDevice.syncFullHLE());
}

export function presentBackBuffer() {
  n64js.onPresent();

  const hardware = n64js.hardware();
  const vi = hardware.viRegDevice;

  hardware.timeline.addEvent(`Present ${toString32(vi.dramAddrReg)}`);

  if (numDisplayListsRendered !== 0) {
    renderer.copyBackBufferToFrontBuffer(vi.dramAddrReg & 0x00fffffe);
    return;
  }

  // If no display lists executed, interpret framebuffer as bytes
  initDimensionsFromVI(vi);    // resize canvas to match VI res.

  const pixels = vi.renderBackBuffer();
  if (!pixels) {
    return;
  }
  renderer.copyPixelsToFrontBuffer(pixels, vi.screenWidth, vi.screenHeight, vi.bitDepth);
}

function processDList(task, disassembler, bailAfter, onFullSync = null) {
  // Update a counter to tell the video code that we've rendered something.
  numDisplayListsRendered++;
  if (!gl) {
    return;
  }

  const hardware = n64js.hardware();
  const ramDV = hardware.cachedMemDevice.mem.dataView
  renderer.onTextureUse = hardware.onTextureUse;
  state.reset(ramDV, task.dataPtr, onFullSync);
  const microcode = initMicrocode(task, ramDV, hardware.onMicrocodeLoad);

  initDimensionsFromVI(hardware.viRegDevice);

  renderer.newFrame();

  if (debugController.running) {
    renderer.debugClear();
  }

  let continuation = executeDisplayList(state, microcode, {
    loadMicrocode: (codeAddr, codeSize, codeDataAddr, codeDataSize) => {
      task.loadUcode(codeAddr, codeSize, codeDataAddr, codeDataSize);
      return initMicrocode(task, ramDV, hardware.onMicrocodeLoad);
    },
    disassembler,
    bailAfter,
  });

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return continuation ? resume : null;

  function resume() {
    renderer.newFrame();
    continuation = continuation();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return continuation ? resume : null;
  }
}

function initDimensionsFromVI(vi) {
  const dims = vi.computeDimensions();
  if (!dims) {
    return;
  }

  renderer.nativeTransform.initDimensions(dims.srcWidth, dims.srcHeight);

  const canvas = document.getElementById('display');
  canvas.width = dims.screenWidth * graphicsOptions.canvasScale;
  canvas.height = dims.screenHeight * graphicsOptions.canvasScale;
}

function initMicrocode(task, ramDV, onMicrocodeLoad) {
  const microcode = microcodes.create(task, state, ramDV, onMicrocodeLoad);
  // TODO: pass rendering object to microcode constructor.
  microcode.hleHalt = hleHalt;
  microcode.renderer = renderer;
  return microcode;
}

function hleHalt(msg) {
  if (debugController.running) {
    return;
  }
  n64js.ui().displayWarning(msg);

  // Ensure the CPU emulation stops immediately
  n64js.breakEmulationForDisplayListDebug();

  debugController.halt();
}
