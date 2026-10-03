/*global n64js*/

import { DebugController } from './debug_controller.js';
import { executeDisplayList } from './display_list.js';
import * as microcodes from './microcodes.js';
import { RDPGraphics } from './rdp_graphics.js';
import { RSPState } from './rsp_state.js';
import { Renderer } from './renderer.js';
import { graphicsOptions } from './graphics_options.js';
import { identifyMicrocode, MicrocodeId, microcodePrefixLength } from './microcode_identifier.js';
import * as logger from '../logger.js';
import { toString32 } from '../format.js';

window.n64js = window.n64js || {};

let numDisplayListsRendered = 0;
let gl = null; // WebGL context for the canvas.
let renderer;
let rdpGraphics;
let warnedF5Indi = false;

const state = new RSPState();
const debugController = new DebugController(state, processDList);

// Graphics processor backed by the shared browser renderer and debugger.
export const graphics = {
  processTask: hleGraphics,
  reset: resetRenderer,
  beginRDP,
  endRDP: () => gl?.bindFramebuffer(gl.FRAMEBUFFER, null),
  setDPFrozen: frozen => renderer?.renderTargets.setDPFrozen(frozen),
};

// Returns false for LLE, true for completed HLE, or a continuation while waiting.
export function dispatchGraphicsTask(hardware, mode, task) {
  const microcode = identifyMicrocode(task.detectVersionString(), task.computeMicrocodeHash(), task.computeMicrocodeHash(microcodePrefixLength));
  hardware.onGraphicsTask?.({ ...microcode });
  // Yakouchuu II submits its HVQM2 video decoder as a graphics task. Its input
  // is compressed video, not a display list; let the RSP write the decoded
  // pixels to RDRAM and signal completion itself.
  // BOSS ZSort combines graphics/audio and CPU/RSP signal exchanges. Execute
  // its actual instructions and render the resulting RDP stream.
  if (mode !== 'HLE' || microcode.id === MicrocodeId.HVQM2 || microcode.id === MicrocodeId.ZSORT_BOSS) {
    return false;
  }

  // Reject other unsupported protocols even when headless graphics are skipped.
  microcodes.assertHLESupported(microcode);
  const ev = hardware.timeline.startEvent(`HLE Task ${task.detectVersionString()}`);
  let continuation = null;

  // TODO: implement Factor 5's Indiana Jones microcode. Its linked display
  // lists loop indefinitely in the GBI0 fallback. Skip parsing them while
  // preserving normal task completion and interrupts for the guest.
  if (microcode.id === MicrocodeId.F5_INDI) {
    if (!warnedF5Indi) {
      logger.log('Skipping unsupported Factor 5 Indiana Jones graphics microcode');
      warnedF5Indi = true;
    }
    hardware.miRegDevice.interruptDP();
  } else {
    continuation = hardware.graphics.processTask(task);
  }

  const complete = () => {
    // SP completion is independent of DP: only an executed FullSync
    // requests a DP interrupt, and some games split a frame over tasks.
    if (ev) {
      ev.stop();
    }
  };
  if (continuation) {
    const resume = () => {
      continuation = continuation();
      if (continuation) {
        return resume;
      }
      complete();
      return null;
    };
    return resume;
  }
  complete();
  return true;
}

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
  numDisplayListsRendered = 0;
  rdpGraphics = null;
  state.reset(n64js.hardware().ram.dataView, 0);
  if (renderer) {
    renderer.reset();
  }
}

function beginRDP() {
  if (!renderer) {
    return null;
  }
  const hardware = n64js.hardware();
  const ramDV = hardware.ram.dataView;
  if (!rdpGraphics) {
    rdpGraphics = new RDPGraphics(state, ramDV, renderer);
    rdpGraphics.hleHalt = hleHalt;
  }
  numDisplayListsRendered++;
  initDimensionsFromVI(hardware.viRegDevice);
  renderer.onTextureUse = hardware.onTextureUse;
  renderer.newFrame();
  return rdpGraphics;
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

  // CRT animation follows emulated time, so a paused frame remains still.
  const timeSeconds = hardware.verticalBlankCount / vi.refreshRate;

  if (numDisplayListsRendered !== 0) {
    renderer.copyBackBufferToFrontBuffer(vi.dramAddrReg & 0x00fffffe, timeSeconds);
    return;
  }

  // If no display lists executed, interpret framebuffer as bytes
  initDimensionsFromVI(vi);    // resize canvas to match VI res.

  const pixels = vi.renderBackBuffer();
  if (!pixels) {
    return;
  }
  renderer.copyPixelsToFrontBuffer(pixels, vi.screenWidth, vi.screenHeight, vi.bitDepth, timeSeconds);
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
