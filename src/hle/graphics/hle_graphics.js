/*global n64js*/

import { EmulationMode } from '../emulation_mode.js';
import { DebugController } from './debug_controller.js';
import { executeDisplayList } from './display_list.js';
import * as microcodes from './microcodes.js';
import { RenderTargets } from './render_targets.js';
import { RDPGraphics } from './rdp_graphics.js';
import { RSPState } from './rsp_state.js';
import { Renderer } from './renderer.js';
import { graphicsOptions } from './graphics_options.js';
import { identifyMicrocode, MicrocodeId, microcodePrefixLength } from './microcode_identifier.js';
import { toString32 } from '../../format.js';
import { t3duxNeedsWriteback } from './microcodes/t3dux.js';

window.n64js = window.n64js || {};

let numDisplayListsRendered = 0;
let gl = null; // WebGL context for the canvas.
let renderer;
let rdpGraphics;

const state = new RSPState();
const debugController = new DebugController(state, replayDList);

// Graphics processor backed by the shared browser renderer and debugger.
export const graphics = {
  processTask: hleGraphics,
  reset: resetRenderer,
  beginRDP,
  endRDP: () => gl?.bindFramebuffer(gl.FRAMEBUFFER, null),
  setDPFrozen: frozen => renderer?.renderTargets.setDPFrozen(frozen),
};

// Returns false for LLE or a continuation for asynchronous HLE completion.
export function dispatchGraphicsTask(hardware, mode, task) {
  const microcode = identifyMicrocode(task.detectVersionString(), task.computeMicrocodeHash(), () => task.computeMicrocodeHash(microcodePrefixLength));
  hardware.onGraphicsTask?.({ ...microcode });
  // Yakouchuu II submits its HVQM2 video decoder as a graphics task. Its input
  // is compressed video, not a display list; let the RSP write the decoded
  // pixels to RDRAM and signal completion itself.
  // BOSS ZSort combines graphics/audio and CPU/RSP signal exchanges. Execute
  // its actual instructions and render the resulting RDP stream.
  // Indiana Jones and Battle for Naboo use linked blocks, code overlays and RDP
  // output buffers. Preserve those protocols by running their original RSP code;
  // SP completion and DP FullSync must come from execution, not a skipped task.
  if (mode !== EmulationMode.HLE || microcode.id === MicrocodeId.HVQM2 ||
    microcode.id === MicrocodeId.ZSORT_BOSS || microcode.id === MicrocodeId.F5_INDI ||
    microcode.id === MicrocodeId.F5_NABOO) {
    return false;
  }

  // T3DUX transform-only objects expose fixed-point results and adjacent DMEM
  // through DMA. Run the whole task on the RSP to preserve those bytes, prior
  // object state, and interleaved RDP output (see tools/t3dux_writeback.md).
  if ((microcode.id === MicrocodeId.T3DUX || microcode.id === MicrocodeId.T3DUX_BRAVE) &&
    t3duxNeedsWriteback(hardware.cachedMemDevice.mem.dataView, task.dataPtr)) {
    return false;
  }

  // Reject other unsupported protocols even when headless graphics are skipped.
  microcodes.assertHLESupported(microcode);
  const ev = hardware.timeline.startEvent(`HLE Task ${microcode.version}`);
  // Defer execution as well as SP completion so the submitting CPU can publish
  // its task state before either SP or DP interrupts it. Deferring only SP lets
  // the CPU handle FullSync while SP still appears busy, eventually stalling
  // Utchan Nanchan's scheduler. Taz Express also needs the submission delay.
  // The SP event supplies nominal latency, not an RSP timing model.
  let continuation = () => hardware.graphics.processTask(task);
  const resume = () => {
    continuation = continuation();
    if (continuation) {
      return resume;
    }
    // FullSync still signals DP where it occurs in the list, including before
    // a CPU producer wait. SP-only lists must not invent a DP interrupt.
    if (ev) {
      ev.stop();
    }
    return null;
  };
  return resume;
}

export function initialiseRenderer(canvas) {
  debugController.initUI();

  initWebGL(canvas); // Initialize the GL context

  // Only continue if WebGL is available and working
  if (!gl) {
    return;
  }

  renderer = new Renderer(gl, state, 320, 240);

  debugController.renderer = renderer;
}

function resetRenderer() {
  debugController.reset();
  debugController.clearTexturePreviews();
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

  const frame = vi.renderBackBuffer();
  if (frame) {
    renderer.copyPixelsToFrontBuffer(frame, timeSeconds);
  }
}

// Replay into disposable targets and memory so scrubbing cannot clear the live
// VI buffer or write framebuffer readback into the paused game's RDRAM.
function replayDList(task, disassembler, bailAfter) {
  if (!renderer) {
    return;
  }
  const liveTargets = renderer.renderTargets;
  const ram = n64js.hardware().cachedMemDevice.mem.dataView;
  const replayRAM = new DataView(ram.buffer.slice(ram.byteOffset, ram.byteOffset + ram.byteLength));
  const targets = new RenderTargets(gl, liveTargets.width, liveTargets.height);
  renderer.renderTargets = targets;
  try {
    renderer.debugClear();
    processDList(task, disassembler, bailAfter, null, replayRAM);
    if (!disassembler) {
      // The CPU has not yet switched VI to the image being constructed.
      renderer.copyTextureToFrontBuffer(targets.current.texture);
    }
  } finally {
    targets.reset();
    targets.deleteTarget(targets.fallback);
    gl.deleteRenderbuffer(targets.depth);
    renderer.renderTargets = liveTargets;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
}

function processDList(task, disassembler, bailAfter, onFullSync = null, replayRAM = null) {
  // Update a counter to tell the video code that we've rendered something.
  numDisplayListsRendered++;
  if (!gl) {
    return;
  }

  const hardware = n64js.hardware();
  const ramDV = replayRAM || hardware.cachedMemDevice.mem.dataView
  renderer.onTextureUse = hardware.onTextureUse;
  state.reset(ramDV, task.dataPtr, onFullSync);
  const microcode = initMicrocode(task, ramDV, hardware.onMicrocodeLoad);

  initDimensionsFromVI(hardware.viRegDevice);

  renderer.newFrame();

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
  const scanout = vi.computeScanout();
  if (!scanout) {
    return;
  }

  renderer.nativeTransform.initDimensions(scanout.renderWidth, scanout.renderHeight);
  if (scanout.renderWidth > 0 && scanout.renderHeight > 0) {
    renderer.renderTargets.resize(scanout.renderWidth * graphicsOptions.renderScale, scanout.renderHeight * graphicsOptions.renderScale);
  }

  const canvas = document.getElementById('display');
  canvas.width = scanout.displayWidth * graphicsOptions.canvasScale;
  canvas.height = scanout.displayHeight * graphicsOptions.canvasScale;
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
