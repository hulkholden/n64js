/*jshint jquery:true browser:true */
/*global $, n64js*/

import { padString, toHex } from '../format.js';
import { makeColorTextRGBA16, makeColorTextRGBA, makeColorTextABGR } from './disassemble.js';
import * as gbi from './gbi.js';
import * as microcodes from './microcodes.js';
import { RSPState } from './rsp_state.js';
import * as shaders from './shaders.js';
import { Renderer } from './renderer.js';

window.n64js = window.n64js || {};

const $dlistContent = $('#dlist-content');

// Initialised in initDebugUI.
let $dlistOutput;
let $dlistState;
let $dlistScrub;

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

class DebugController {
  constructor() {
    // This is updated as we're executing, so that we know which instruction to halt on.
    this.currentOp = 0;
    this.numOps = 0;
    this.bailAfter = -1;
    this.lastTask;  // The last task that we executed.
    this.stateTimeShown = -1;
    this.running = false;
    this.requested = false;
  }

  onNewTask(task) {
    // Bodgily track these parameters so that we can call again with the same params.
    this.lastTask = task;

    // Force the cpu to stop at the point that we render the display list.
    if (this.requested) {
      this.requested = false;

      // Finally, break execution so we can keep replaying the display list
      // before any other state changes.
      n64js.breakEmulationForDisplayListDebug();

      this.stateTimeShown = -1;
      this.running = true;
    }
  }

  toggle() {
    if (this.running) {
      this.hideUI();
      this.bailAfter = -1;
      this.running = false;
      n64js.toggleRun();
    } else {
      this.showUI();
      this.requested = true;
    }
  }

  halt() {
    // Ensure the ui is visible
    this.showUI();

    // We're already executing a display list, so clear the Requested flag, set Running
    this.requested = false;
    this.running = true;

    // End set up the context
    this.bailAfter = this.currentOp;
    this.stateTimeShown = -1;
  }

  debugDisplayList() {
    if (this.stateTimeShown == -1) {
      // Build some disassembly for this display list
      const disassembler = new Disassembler();
      processDList(this.lastTask, disassembler, -1);
      disassembler.finalise();
  
      // Update the scrubber based on the new length of disassembly
      this.numOps = disassembler.numOps > 0 ? (disassembler.numOps - 1) : 0;
      setScrubRange(this.numOps);
  
      // If this.bailAfter hasn't been set (e.g. by hleHalt), stop at the end of the list
      const timeToShow = (this.bailAfter == -1) ? this.numOps : this.bailAfter;
      setScrubTime(timeToShow);
    }
  
    // Replay the last display list using the captured task/ram
    processDList(this.lastTask, null, this.bailAfter);
  
    // Only update the state display when needed, otherwise it's impossible to
    // debug the dom in Chrome
    if (this.stateTimeShown !== this.bailAfter) {
      updateStateUI();
      this.stateTimeShown = this.bailAfter;
    }
  }

  initUI() {
    const $dlistControls = $dlistContent.find('#controls');

    this.bailAfter = -1;
    this.numOps = 0;

    $dlistControls.find('#rwd').click(() => {
      if (this.running && this.bailAfter > 0) {
        setScrubTime(this.bailAfter - 1);
      }
    });
    $dlistControls.find('#fwd').click(() => {
      if (this.running && this.bailAfter < this.numOps) {
        setScrubTime(this.bailAfter + 1);
      }
    });
    $dlistControls.find('#stop').click(() => {
      toggleDebugDisplayList();
    });

    $dlistScrub = $dlistControls.find('.scrub');
    $dlistScrub.find('input').change(function () {
      setScrubTime($(this).val() | 0);
    });
    setScrubRange(0);

    $dlistState = $dlistContent.find('.hle-state');

    $dlistOutput = $('<div class="hle-disasm"></div>');
    $('#adjacent-debug').empty().append($dlistOutput);
  }

  showUI() {
    $('.debug').show();
    $('#dlist-tab').tab('show');
  }
  
  hideUI() {
    $('.debug').hide();
  }
}
const debugController = new DebugController();

let gl = null; // WebGL context for the canvas.

let renderer;

// Scale factor to apply to the canvas.
// TODO: expose this on the UI somewhere.
let canvasScale = 1;

const state = new RSPState();

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

class Disassembler {
  constructor() {
    this.$currentDis = $('<pre></pre>');
    this.$span = undefined;
    this.numOps = 0;
  }

  begin(pc, cmd0, cmd1, depth) {
    const indent = (new Array(depth + 1)).join('  ');
    const pcStr = ' '; //  ` [${toHex(pc, 32)}] `

    this.$span = $(`<span class="hle-instr" id="I${this.numOps}" />`);
    this.$span.append(`${padString(this.numOps, 5)}${pcStr}${toHex(cmd0, 32)}${toHex(cmd1, 32)} ${indent}`);
    this.$currentDis.append(this.$span);
  }

  text(t) {
    this.$span.append(t);
  }

  tip(t) {
    const $d = $(`<div class="dl-tip">${t}</div>`);
    $d.hide();
    this.$span.append($d);
  }

  end() {
    this.$span.append('<br>');
    this.numOps++;
  }

  finalise = function () {
    $dlistOutput.html(this.$currentDis);
    this.$currentDis.find('.dl-tip').parent().click(function () {
      $(this).find('.dl-tip').toggle();
    });
    // this.$currentDis.find('.dl-branch').click(function () {
    // });
  }

  rgba8888(col) { return makeColorTextRGBA(col); }
  rgba5551(col) { return makeColorTextRGBA16(col); }
}

function buildStateTab() {
  const $table = $('<table class="table table-condensed dl-debug-table" style="width: auto;"></table>');
  const $tr = $('<tr />');

  for (let i in state.geometryMode) {
    if (state.geometryMode.hasOwnProperty(i)) {
      const $td = $(`<td>${i}</td>`);
      if (state.geometryMode[i]) {
        $td.css('background-color', '#AFF4BB');
      }
      $tr.append($td);
    }
  }

  $table.append($tr);
  return $table;
}

function buildRDPTab() {
  const l = state.rdpOtherModeL;
  const h = state.rdpOtherModeH;
  const vals = new Map([
    ['alphaCompare', gbi.AlphaCompare.nameOf(l & gbi.G_AC_MASK)],
    ['depthSource', gbi.DepthSource.nameOf(l & gbi.G_ZS_MASK)],
    ['renderMode', gbi.getRenderModeText(l)],
    ['alphaDither', gbi.AlphaDither.nameOf(h & gbi.G_AD_MASK)],
    ['colorDither', gbi.ColorDither.nameOf(h & gbi.G_CD_MASK)],
    ['combineKey', gbi.CombineKey.nameOf(h & gbi.G_CK_MASK)],
    ['textureConvert', gbi.TextureConvert.nameOf(h & gbi.G_TC_MASK)],
    ['textureFilter', gbi.TextureFilter.nameOf(h & gbi.G_TF_MASK)],
    ['textureLUT', gbi.TextureLUT.nameOf(h & gbi.G_TT_MASK)],
    ['textureLOD', gbi.TextureLOD.nameOf(h & gbi.G_TL_MASK)],
    ['texturePersp', gbi.TexturePerspective.nameOf(h & gbi.G_TP_MASK)],
    ['textureDetail', gbi.TextureDetail.nameOf(h & gbi.G_TD_MASK)],
    ['cycleType', gbi.CycleType.nameOf(h & gbi.G_CYC_MASK)],
    ['pipelineMode', gbi.PipelineMode.nameOf(h & gbi.G_PM_MASK)],
  ]);

  const $table = $('<table class="table table-condensed dl-debug-table" style="width: auto;"></table>');
  for (let [name, value] of vals) {
    let $tr = $(`<tr><td>${name}</td><td>${value}</td></tr>`);
    $table.append($tr);
  }
  return $table;
}

function buildColorsTable() {
  const colors = ['fillColor', 'envColor', 'primColor', 'blendColor', 'fogColor'];

  const $table = $('<table class="table table-condensed dl-debug-table" style="width: auto;"></table>');
  for (let color of colors) {
    let row = $(`<tr><td>${color}</td><td>${makeColorTextRGBA(state[color])}</td></tr>`);
    $table.append(row);
  }
  return $table;
}

function buildCombinerTab() {
  const $p = $('<pre class="combine"></pre>');
  $p.append(gbi.CycleType.nameOf(state.getCycleType()) + '\n');
  $p.append(buildColorsTable());
  $p.append(shaders.getCombinerText(state.combine.hi, state.combine.lo));
  return $p;
}

function buildTexture(tileIdx) {
  const texture = renderer.lookupTexture(tileIdx);
  if (texture) {
    const kScale = 8;
    return texture.createScaledCanvas(kScale);
  }
}

function buildTexturesTab() {
  const $d = $('<div />');
  $d.append(buildTilesTable());
  for (let i = 0; i < 8; ++i) {
    let $t = buildTexture(i);
    if ($t) {
      $d.append($t);
    }
  }
  return $d;
}

function buildTilesTable() {
  const tileFields = [
    'tile #',
    'format', 'size', 'line', 'tmem', 'palette',
    'cmS', 'maskS', 'shiftS',
    'cmT', 'maskT', 'shiftT',
    'left', 'top', 'right', 'bottom',
    'width', 'height', 'unmasked w', 'unmasked h',
  ];

  const $table = $('<table class="table table-condensed dl-debug-table" style="width: auto"></table>');
  const $headingTR = $(`<tr><th>${tileFields.join('</th><th>')}</th></tr>`);
  $table.append($headingTR);

  for (let tileIdx = 0; tileIdx < state.tiles.length; ++tileIdx) {
    const tile = state.tiles[tileIdx];

    // Ignore any tiles that haven't been set up.
    if (tile.format === -1) {
      continue;
    }

    const vals = [];
    vals.push(gbi.getTileText(tileIdx));
    vals.push(gbi.ImageFormat.nameOf(tile.format));
    vals.push(gbi.ImageSize.nameOf(tile.size));
    vals.push(tile.line);
    vals.push(tile.tmem);
    vals.push(tile.palette);
    vals.push(gbi.getClampMirrorWrapText(tile.cmS));
    vals.push(tile.maskS);
    vals.push(tile.shiftS);
    vals.push(gbi.getClampMirrorWrapText(tile.cmT));
    vals.push(tile.maskT);
    vals.push(tile.shiftT);
    vals.push(tile.left);
    vals.push(tile.top);
    vals.push(tile.right);
    vals.push(tile.bottom);
    vals.push(tile.width);
    vals.push(tile.height);
    vals.push(tile.unmaskedWidth);
    vals.push(tile.unmaskedHeight);

    const tr = $(`<tr><td>${vals.join('</td><td>')}</td></tr>`);
    $table.append(tr);
  }

  return $table;
}

function buildVerticesTab() {
  const vtxFields = ['vtx #', 'x', 'y', 'z', 'px', 'py', 'pz', 'pw', 'color', 'u', 'v'];

  const $table = $('<table class="table table-condensed dl-debug-table" style="width: auto"></table>');
  const headingTR = $(`<tr><th>${vtxFields.join('</th><th>')}</th></tr>`);
  $table.append(headingTR);

  for (let i = 0; i < state.projectedVertices.length; ++i) {
    const vtx = state.projectedVertices[i];
    if (!vtx.set) {
      continue;
    }

    const x = vtx.pos.x / vtx.pos.w;
    const y = vtx.pos.y / vtx.pos.w;
    const z = vtx.pos.z / vtx.pos.w;

    const vals = [];
    vals.push(i);
    vals.push(x.toFixed(3));
    vals.push(y.toFixed(3));
    vals.push(z.toFixed(3));
    vals.push(vtx.pos.x.toFixed(3));
    vals.push(vtx.pos.y.toFixed(3));
    vals.push(vtx.pos.z.toFixed(3));
    vals.push(vtx.pos.w.toFixed(3));
    vals.push(makeColorTextABGR(vtx.color));
    vals.push(vtx.u.toFixed(3));
    vals.push(vtx.v.toFixed(3));

    const tr = $(`<tr><td>${vals.join('</td><td>')}</td></tr>`);
    $table.append(tr);
  }

  return $table;
}

function updateStateUI() {
  $dlistState.find('#dl-geometrymode-content').html(buildStateTab());
  $dlistState.find('#dl-vertices-content').html(buildVerticesTab());
  $dlistState.find('#dl-textures-content').html(buildTexturesTab());
  $dlistState.find('#dl-combiner-content').html(buildCombinerTab());
  $dlistState.find('#dl-rdp-content').html(buildRDPTab());
}

export function hleGraphics(task) {
  debugController.onNewTask(task)
  processDList(task, null, -1);
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

      if (bailAfter > -1 && debugController.currentOp >= bailAfter) {
        break;
      }
      debugController.currentOp++;
    }
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function setScrubText(x, max) {
  $dlistScrub.find('.scrub-text').html(`uCode op ${x}/${max}.`);
}

function setScrubRange(max) {
  $dlistScrub.find('input').attr({
    min: 0,
    max: max,
    value: max
  });
  setScrubText(max, max);
}

function setScrubTime(t) {
  debugController.bailAfter = t;
  setScrubText(debugController.bailAfter, debugController.numOps);

  const $instr = $dlistOutput.find(`#I${debugController.bailAfter}`);

  $dlistOutput.scrollTop($dlistOutput.scrollTop() + $instr.position().top -
    $dlistOutput.height() / 2 + $instr.height() / 2);

  $dlistOutput.find('.hle-instr').removeAttr('style');
  $instr.css('background-color', 'rgb(255,255,204)');
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
