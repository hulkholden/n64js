/*jshint jquery:true browser:true */
/*global $, n64js*/

import { padString, toHex, toString8, toString16, toString32 } from '../format.js';
import * as gbi from './gbi.js';
import * as logger from '../logger.js';
import { convertTexels, convertRGBA16Pixel } from './convert.js';
import * as shaders from './shaders.js';
import { Texture, clampTexture } from './textures.js';
import { Matrix4x4 } from '../graphics/Matrix4x4.js';
import { Transform2D } from '../graphics/Transform2D.js';
import { TriangleBuffer } from './triangle_buffer.js';
import { Vector2 } from '../graphics/Vector2.js';
import { Vector3 } from '../graphics/Vector3.js';
import * as disassemble from './disassemble.js';
import { RSPState } from './rsp_state.js';

window.n64js = window.n64js || {};

const $textureOutput = $('#texture-content');
const $dlistContent = $('#dlist-content');

// Initialised in initDebugUI.
let $dlistOutput;
let $dlistState;
let $dlistScrub;

export let debugDisplayListRequested = false;
export let debugDisplayListRunning = false;

let debugNumOps = 0;
let debugBailAfter = -1;
let debugLastTask;  // The last task that we executed.
let debugStateTimeShown = -1;
let debugCurrentOp = 0; // This is updated as we're executing, so that we know which instruction to halt on.

const textureCache = new Map();

const kDebugColorImages = true;
let colorImages = new Map();

let gl = null; // WebGL context for the canvas.

let frameBuffer;
let frameBufferTexture3D;  // For roms using display lists
let frameBufferTexture2D;  // For roms writing directly to the frame buffer
let nativeTransform;

// Scale factor to apply to the canvas.
// TODO: expose this on the UI somewhere.
let canvasScale = 1;

// Configured:
var config = {
  vertexStride: 10
};

const kMaxTris = 64;
var triangleBuffer = new TriangleBuffer(kMaxTris);

var ram_dv;

var state = new RSPState();

//
const kUCode_GBI0 = 0;
const kUCode_GBI1 = 1;
const kUCode_GBI2 = 2;
const kUCode_GBI1_SDEX = 3;
const kUCode_GBI2_SDEX = 4;
const kUCode_GBI0_WR = 5;
const kUCode_GBI0_DKR = 6;
const kUCode_GBI1_LL = 7;
const kUCode_GBI0_SE = 8;
const kUCode_GBI0_GE = 9;
const kUCode_GBI2_CONKER = 10;
const kUCode_GBI0_PD = 11;

const kUcodeStrides = [
  10, // Super Mario 64, Tetrisphere, Demos
  2, // Mario Kart, Star Fox
  2, // Zelda, and newer games
  2, // Yoshi's Story, Pokemon Puzzle League
  2, // Neon Evangelion, Kirby
  5, // Wave Racer USA
  10, // Diddy Kong Racing, Gemini, and Mickey
  2, // Last Legion, Toukon, Toukon 2
  5, // Shadows of the Empire (SOTE)
  10, // Golden Eye
  2, // Conker BFD
  10, // Perfect Dark
];

// TODO: provide a HLE object and instantiate these in the constructor.
function getRamU8Array() { return n64js.hardware().cachedMemDevice.u8; }
function getRamDataView() { return n64js.hardware().cachedMemDevice.mem.dataView; }

class NativeTransform {
  constructor() {
    this.initDimensions(320, 240);
  }

  initDimensions(viWidth, viHeight) {
    this.viWidth = viWidth;
    this.viHeight = viHeight;
    // Convert n64 framebuffer coordinates into normalised device coordinates (-1 to +1).
    this.n64FramebufferToDevice = new Transform2D(new Vector2(2 / viWidth, -2 / viHeight), new Vector2(-1, +1));
    // Displaylist-defined viewport - defaults to the entire screen.
    this.n64ViewportTransform = new Transform2D(new Vector2(viWidth, viHeight), new Vector2(0, 0));
  }

  setN64Viewport(t2d) {
    // TODO: is this affected by VI sx0/sy0 etc?
    this.n64ViewportTransform = t2d;
  }

  // Used by fillRec/texRect - ignores viewport.
  convertN64ToDisplay(n64Vec2) {
    return this.n64FramebufferToDevice.transform(n64Vec2);
  }
}

function loadMatrix(address) {
  const recip = 1.0 / 65536.0;
  var dv = new DataView(ram_dv.buffer, address);

  var elements = new Float32Array(16);
  for (var i = 0; i < 4; ++i) {
    elements[4 * 0 + i] = (dv.getInt16(i * 8 + 0) << 16 | dv.getUint16(i * 8 + 0 + 32)) * recip;
    elements[4 * 1 + i] = (dv.getInt16(i * 8 + 2) << 16 | dv.getUint16(i * 8 + 2 + 32)) * recip;
    elements[4 * 2 + i] = (dv.getInt16(i * 8 + 4) << 16 | dv.getUint16(i * 8 + 4 + 32)) * recip;
    elements[4 * 3 + i] = (dv.getInt16(i * 8 + 6) << 16 | dv.getUint16(i * 8 + 6 + 32)) * recip;
  }

  return new Matrix4x4(elements);
}

function previewViewport(address) {
  var result = '';
  result += `scale = (${ram_dv.getInt16(address + 0) / 4.0}, ${ram_dv.getInt16(address + 2) / 4.0}) `;
  result += `trans = (${ram_dv.getInt16(address + 8) / 4.0}, ${ram_dv.getInt16(address + 10) / 4.0}) `;
  return result;
}

function moveMemViewport(address) {
  const scale = new Vector2(
    ram_dv.getInt16(address + 0) / 4.0,
    ram_dv.getInt16(address + 2) / 4.0,
  );
  const trans = new Vector2(
    ram_dv.getInt16(address + 8) / 4.0,
    ram_dv.getInt16(address + 10) / 4.0,
  );

  //logger.log(`Viewport: scale=${scale.x},${scale.y} trans=${trans.x},${trans.y}` );
  state.viewport.scale = scale;
  state.viewport.trans = trans;

  // N64 provides the center point and distance to each edge,
  // but we want the width/height and translate to bottom left.
  const t2d = new Transform2D(scale.scale(2), trans.sub(scale));
  nativeTransform.setN64Viewport(t2d);
}

function previewLight(address) {
  var result = '';
  result += `color = ${makeColorTextRGBA(ram_dv.getUint32(address + 0))} `;
  result += `colorCopy = ${makeColorTextRGBA(ram_dv.getUint32(address + 4))} `;
  var dir = Vector3.create([
    ram_dv.getInt8(address + 8),
    ram_dv.getInt8(address + 9),
    ram_dv.getInt8(address + 10)
  ]).normaliseInPlace();
  result += `norm = (${dir.x}, ${dir.y}, ${dir.z})`;
  return result;
}

function moveMemLight(lightIdx, address) {
  if (lightIdx >= state.lights.length) {
    logger.log(`light index ${lightIdx} out of range`);
    return;
  }
  state.lights[lightIdx].color = unpackRGBAToColor(ram_dv.getUint32(address + 0));
  state.lights[lightIdx].dir = Vector3.create([
    ram_dv.getInt8(address + 8),
    ram_dv.getInt8(address + 9),
    ram_dv.getInt8(address + 10)
  ]).normaliseInPlace();
}

function rdpSegmentAddress(addr) {
  var segment = (addr >>> 24) & 0xf;
  // TODO: this should probably mask against 0x00ff_ffff (same as SP_DRAM_ADDR_REG)
  // but that can result in out of bounds accesses in some DataViews (e.g. Wetrix)
  // which tries to load from 0x00f000ff. Really we should try to emulate SP DMA more accurately.
  return (state.segments[segment] & 0x007fffff) + (addr & 0x007fffff);
}

function makeRGBAFromRGBA16(col) {
  return {
    'r': ((col >>> 11) & 0x1f) / 31.0,
    'g': ((col >>> 6) & 0x1f) / 31.0,
    'b': ((col >>> 1) & 0x1f) / 31.0,
    'a': ((col >>> 0) & 0x1) / 1.0,
  };
}

function makeRGBAFromRGBA32(col) {
  return {
    'r': ((col >>> 24) & 0xff) / 255.0,
    'g': ((col >>> 16) & 0xff) / 255.0,
    'b': ((col >>> 8) & 0xff) / 255.0,
    'a': ((col >>> 0) & 0xff) / 1.0,
  };
}

function unpackRGBAToColor(col) {
  return {
    'r': ((col >>> 24) & 0xff) / 255.0,
    'g': ((col >>> 16) & 0xff) / 255.0,
    'b': ((col >>> 8) & 0xff) / 255.0,
    'a': ((col >>> 0) & 0xff) / 255.0,
  };
}

function makeColourText(r, g, b, a) {
  const rgb = `${r}, ${g}, ${b}`;
  const rgba = `${rgb}, ${a}`;

  if ((r < 128 && g < 128) ||
      (g < 128 && b < 128) ||
      (b < 128 && r < 128)) {
    return `<span style="color: white; background-color: rgb(${rgb})">${rgba}</span>`;
  }
  return `<span style="background-color: rgb(${rgb})">${rgba}</span>`;
}

function makeColorTextRGBA(rgba) {
  var r = (rgba >>> 24) & 0xff;
  var g = (rgba >>> 16) & 0xff;
  var b = (rgba >>> 8) & 0xff;
  var a = (rgba) & 0xff;

  return makeColourText(r, g, b, a);
}

function makeColorTextABGR(abgr) {
  var r = abgr & 0xff;
  var g = (abgr >>> 8) & 0xff;
  var b = (abgr >>> 16) & 0xff;
  var a = (abgr >>> 24) & 0xff;

  return makeColourText(r, g, b, a);
}

function makeColorTextRGBA16(col) {
  return makeColorTextRGBA(convertRGBA16Pixel(col));
}

function haltUnimplemented(cmd0, cmd1) {
  hleHalt(`Unimplemented display list op ${toString8(cmd0 >>> 24)}`);
}

// Map to keep track of which unimplemented ops we've already warned about.
const loggedUnimplemented = new Map();

function logUnimplemented(name) {
  if (loggedUnimplemented.get(name)) {
    return;
  }
  loggedUnimplemented.set(name, true);
  n64js.warn(`${name} unimplemented`);
}

// Map to keep track of which unimplemented blend modes we've already warned about.
const loggedBlendModes = new Map();

function logUnhandledBlendMode(activeBlendMode, alphaCvgSel, cvgXAlpha) {
  if (loggedBlendModes.get(activeBlendMode)) {
    return;
  }
  loggedBlendModes.set(activeBlendMode, true);
  n64js.warn(`Unhandled blend mode: ${toString16(activeBlendMode)} = ${gbi.blendOpText(activeBlendMode)}, alphaCvgSel ${alphaCvgSel}, cvgXAlpha ${cvgXAlpha}`);
}

const loggedMicrocodes = new Map();

function logMicrocode(str, ucode) {
  if (loggedMicrocodes.get(str)) {
    return;
  }
  loggedMicrocodes.set(str, true);
  logger.log(`New RSP graphics ucode seen: ${str} = ucode ${ucode}`);
}

function executeUnknown(cmd0, cmd1) {
  hleHalt(`Unknown display list op ${toString8(cmd0 >>> 24)}`);
  state.pc = 0;
}

function executeGBI1_SpNoop(cmd0, cmd1, dis) {
  if (dis) {
    dis.text('gsSPNoOp();');
  }
}

function executeGBI1_Noop(cmd0, cmd1, dis) {
  if (dis) {
    dis.text('gsDPNoOp();');
  }
}

function executeRDPLoadSync(cmd0, cmd1, dis) {
  if (dis) {
    dis.text('gsDPLoadSync();');
  }
}

function executeRDPPipeSync(cmd0, cmd1, dis) {
  if (dis) {
    dis.text('gsDPPipeSync();');
  }
}

function executeRDPTileSync(cmd0, cmd1, dis) {
  if (dis) {
    dis.text('gsDPTileSync();');
  }
}

function executeRDPFullSync(cmd0, cmd1, dis) {
  if (dis) {
    dis.text('gsDPFullSync();');
  }
}

function executeGBI1_DL(cmd0, cmd1, dis) {
  var param = ((cmd0 >>> 16) & 0xff);
  var address = rdpSegmentAddress(cmd1);

  if (dis) {
    var fn = (param === gbi.G_DL_PUSH) ? 'gsSPDisplayList' : 'gsSPBranchList';
    dis.text(`${fn}(<span class="dl-branch">${toString32(address)}</span>);`);
  }

  if (param === gbi.G_DL_PUSH) {
    state.dlistStack.push({ pc: state.pc });
  }
  state.pc = address;
}

function executeGBI1_EndDL(cmd0, cmd1, dis) {
  if (dis) {
    dis.text('gsSPEndDisplayList();');
  }

  if (state.dlistStack.length > 0) {
    state.pc = state.dlistStack.pop().pc;
  } else {
    state.pc = 0;
  }
}

function executeGBI1_BranchZ(cmd0, cmd1) {
  var address = rdpSegmentAddress(state.rdpHalf1);
  // FIXME
  // Just branch all the time for now
  //if (vtxDepth(cmd.vtx) <= cmd.branchzvalue)
  state.pc = address;
}

function previewMatrix(matrix) {
  var m = matrix.elems;

  var a = [m[0], m[1], m[2], m[3]];
  var b = [m[4], m[5], m[6], m[7]];
  var c = [m[8], m[9], m[10], m[11]];
  var d = [m[12], m[13], m[14], m[15]];

  return `<div><table class="matrix-table">
    <tr><td>${a.join('</td><td>')}</td></tr>
    <tr><td>${b.join('</td><td>')}</td></tr>
    <tr><td>${c.join('</td><td>')}</td></tr>
    <tr><td>${d.join('</td><td>')}</td></tr>
  </table></div>`;
}

function executeGBI1_Matrix(cmd0, cmd1, dis) {
  var flags = (cmd0 >>> 16) & 0xff;
  var length = (cmd0 >>> 0) & 0xffff;
  var address = rdpSegmentAddress(cmd1);

  var matrix = loadMatrix(address);

  if (dis) {
    var t = '';
    t += (flags & gbi.G_MTX_PROJECTION) ? 'G_MTX_PROJECTION' : 'G_MTX_MODELVIEW';
    t += (flags & gbi.G_MTX_LOAD) ? '|G_MTX_LOAD' : '|G_MTX_MUL';
    t += (flags & gbi.G_MTX_PUSH) ? '|G_MTX_PUSH' : ''; //'|G_MTX_NOPUSH';

    dis.text(`gsSPMatrix(${toString32(address)}, ${t});`);
    dis.tip(previewMatrix(matrix));
  }

  var stack = (flags & gbi.G_MTX_PROJECTION) ? state.projection : state.modelview;

  if ((flags & gbi.G_MTX_LOAD) == 0) {
    matrix = stack[stack.length - 1].multiply(matrix);
  }

  if (flags & gbi.G_MTX_PUSH) {
    stack.push(matrix);
  } else {
    stack[stack.length - 1] = matrix;
  }
}

function executeGBI1_PopMatrix(cmd0, cmd1, dis) {
  var flags = (cmd1 >>> 0) & 0xff;

  if (dis) {
    var t = '';
    t += (flags & gbi.G_MTX_PROJECTION) ? 'G_MTX_PROJECTION' : 'G_MTX_MODELVIEW';
    dis.text(`gsSPPopMatrix(${t});`);
  }

  // FIXME: pop is always modelview?
  if (state.modelview.length > 0) {
    state.modelview.pop();
  }
}

function previewGBI1_MoveMem(type, length, address, dis) {
  var tip = '';

  for (var i = 0; i < length; ++i) {
    tip += toHex(ram_dv.getUint8(address + i), 8) + ' ';
  }
  tip += '<br>';

  switch (type) {
    case gbi.MoveMemGBI1.G_MV_VIEWPORT:
      tip += previewViewport(address);
      break;

    case gbi.MoveMemGBI1.G_MV_L0:
    case gbi.MoveMemGBI1.G_MV_L1:
    case gbi.MoveMemGBI1.G_MV_L2:
    case gbi.MoveMemGBI1.G_MV_L3:
    case gbi.MoveMemGBI1.G_MV_L4:
    case gbi.MoveMemGBI1.G_MV_L5:
    case gbi.MoveMemGBI1.G_MV_L6:
    case gbi.MoveMemGBI1.G_MV_L7:
      tip += previewLight(address);
      break;
  }

  dis.tip(tip);
}

function executeGBI1_MoveMem(cmd0, cmd1, dis) {
  var type = (cmd0 >>> 16) & 0xff;
  var length = (cmd0 >>> 0) & 0xffff;
  var address = rdpSegmentAddress(cmd1);

  if (dis) {
    var address_str = toString32(address);

    var type_str = gbi.MoveMemGBI1.nameOf(type);
    var text = `gsDma1p(G_MOVEMEM, ${address_str}, ${length}, ${type_str});`;

    switch (type) {
      case gbi.MoveMemGBI1.G_MV_VIEWPORT:
        if (length === 16) {
          text = `gsSPViewport(${address_str});`;
        }
        break;
    }

    dis.text(text);
    previewGBI1_MoveMem(type, length, address, dis);
  }

  switch (type) {
    case gbi.MoveMemGBI1.G_MV_VIEWPORT:
      moveMemViewport(address);
      break;

    case gbi.MoveMemGBI1.G_MV_L0:
    case gbi.MoveMemGBI1.G_MV_L1:
    case gbi.MoveMemGBI1.G_MV_L2:
    case gbi.MoveMemGBI1.G_MV_L3:
    case gbi.MoveMemGBI1.G_MV_L4:
    case gbi.MoveMemGBI1.G_MV_L5:
    case gbi.MoveMemGBI1.G_MV_L6:
    case gbi.MoveMemGBI1.G_MV_L7:
      var light_idx = (type - gbi.MoveMemGBI1.G_MV_L0) / 2;
      moveMemLight(light_idx, address);
      break;
  }
}

function executeGBI1_MoveWord(cmd0, cmd1, dis) {
  var type = (cmd0) & 0xff;
  var offset = (cmd0 >>> 8) & 0xffff;
  var value = cmd1;

  if (dis) {
    var text = `gMoveWd(${gbi.MoveWord.nameOf(type)}, ${toString16(offset)}, ${toString32(value)});`;

    switch (type) {
      case gbi.MoveWord.G_MW_NUMLIGHT:
        if (offset === gbi.G_MWO_NUMLIGHT) {
          let v = ((value - 0x80000000) >>> 5) - 1;
          text = `gsSPNumLights(${gbi.NumLights.nameOf(v)});`;
        }
        break;
      case gbi.MoveWord.G_MW_SEGMENT:
        {
          let v = value === 0 ? '0' : toString32(value);
          text = `gsSPSegment(${(offset >>> 2) & 0xf}, ${v});`;
        }
        break;
    }
    dis.text(text);
  }

  switch (type) {
    case gbi.MoveWord.G_MW_MATRIX:
      haltUnimplemented(cmd0, cmd1);
      break;
    case gbi.MoveWord.G_MW_NUMLIGHT:
      state.numLights = ((value - 0x80000000) >>> 5) - 1;
      break;
    case gbi.MoveWord.G_MW_CLIP:
      /*unimplemented(cmd0,cmd1);*/ break;
    case gbi.MoveWord.G_MW_SEGMENT:
      state.segments[((offset >>> 2) & 0xf)] = value;
      break;
    case gbi.MoveWord.G_MW_FOG:
      /*unimplemented(cmd0,cmd1);*/ break;
    case gbi.MoveWord.G_MW_LIGHTCOL:
      haltUnimplemented(cmd0, cmd1);
      break;
    case gbi.MoveWord.G_MW_POINTS:
      haltUnimplemented(cmd0, cmd1);
      break;
    case gbi.MoveWord.G_MW_PERSPNORM:
      /*unimplemented(cmd0,cmd1);*/ break;
    default:
      haltUnimplemented(cmd0, cmd1);
      break;
  }
}

const X_NEG = 0x01; //left
const Y_NEG = 0x02; //bottom
const Z_NEG = 0x04; //far
const X_POS = 0x08; //right
const Y_POS = 0x10; //top
const Z_POS = 0x20; //near

function calculateLighting(normal) {
  var num_lights = state.numLights;
  var r = state.lights[num_lights].color.r;
  var g = state.lights[num_lights].color.g;
  var b = state.lights[num_lights].color.b;

  for (var l = 0; l < num_lights; ++l) {
    var light = state.lights[l];
    var d = normal.dot(light.dir);
    if (d > 0.0) {
      r += light.color.r * d;
      g += light.color.g * d;
      b += light.color.b * d;
    }
  }

  r = Math.min(r, 1.0) * 255.0;
  g = Math.min(g, 1.0) * 255.0;
  b = Math.min(b, 1.0) * 255.0;
  let a = 255;

  return (a << 24) | (b << 16) | (g << 8) | r;
}

function previewVertexImpl(v0, n, dv, dis, light) {
  const cols = ['#', 'x', 'y', 'z', '?', 'u', 'v', light ? 'norm' : 'rgba'];

  let tip = '';
  tip += '<table class="vertex-table">';
  tip += `<tr><th>${cols.join('</th><th>')}</th></tr>\n`;

  for (var i = 0; i < n; ++i) {
    const base = i * 16;
    const normOrCol = light ? `${dv.getInt8(base + 12)},${dv.getInt8(base + 13)},${dv.getInt8(base + 14)}` : makeColorTextRGBA(dv.getUint32(base + 12));

    var v = [
      v0 + i,
      dv.getInt16(base + 0), // x
      dv.getInt16(base + 2), // y
      dv.getInt16(base + 4), // z
      dv.getInt16(base + 6), // ?
      dv.getInt16(base + 8), // u
      dv.getInt16(base + 10), // v
      normOrCol, // norm or rgba
    ];

    tip += `<tr><td>${v.join('</td><td>')}</td></tr>\n`;
  }
  tip += '</table>';
  dis.tip(tip);
}

function executeVertexImpl(v0, n, address, dis) {
  var light = state.geometryMode.lighting;
  var texgen = state.geometryMode.textureGen;
  var texgenlin = state.geometryMode.textureGenLinear;
  var dv = new DataView(ram_dv.buffer, address);

  if (dis) {
    previewVertexImpl(v0, n, dv, dis, light);
  }

  if (v0 + n >= 64) { // FIXME or 80 for later GBI
    hleHalt('Too many verts');
    state.pc = 0;
    return;
  }

  var mvmtx = state.modelview[state.modelview.length - 1];
  var pmtx = state.projection[state.projection.length - 1];

  var wvp = pmtx.multiply(mvmtx);

  // Texture coords are provided in 11.5 fixed point format, so divide by 32 here to normalise
  var scale_s = state.texture.scaleS / 32.0;
  var scale_t = state.texture.scaleT / 32.0;

  var xyz = new Vector3();
  var normal = new Vector3();
  var transformedNormal = new Vector3();

  for (var i = 0; i < n; ++i) {
    var vtx_base = i * 16;
    var vertex = state.projectedVertices[v0 + i];

    vertex.set = true;

    xyz.x = dv.getInt16(vtx_base + 0);
    xyz.y = dv.getInt16(vtx_base + 2);
    xyz.z = dv.getInt16(vtx_base + 4);
    //var w = dv.getInt16(vtx_base + 6);
    var u = dv.getInt16(vtx_base + 8);
    var v = dv.getInt16(vtx_base + 10);

    var projected = vertex.pos;
    wvp.transformPoint(xyz, projected);

    //hleHalt(`${x},${y},${z}-&gt;${projected.x},${projected.y},${projected.z}`);

    // var clip_flags = 0;
    //      if (projected[0] < -projected[3]) clip_flags |= X_POS;
    // else if (projected[0] >  projected[3]) clip_flags |= X_NEG;

    //      if (projected[1] < -projected[3]) clip_flags |= Y_POS;
    // else if (projected[1] >  projected[3]) clip_flags |= Y_NEG;

    //      if (projected[2] < -projected[3]) clip_flags |= Z_POS;
    // else if (projected[2] >  projected[3]) clip_flags |= Z_NEG;
    // state.projectedVertices.clipFlags = clip_flags;

    if (light) {
      normal.x = dv.getInt8(vtx_base + 12);
      normal.y = dv.getInt8(vtx_base + 13);
      normal.z = dv.getInt8(vtx_base + 14);

      // calculate transformed normal
      mvmtx.transformNormal(normal, transformedNormal);
      transformedNormal.normaliseInPlace();

      vertex.color = calculateLighting(transformedNormal);

      if (texgen) {
        // retransform using wvp
        // wvp.transformNormal(normal, transformedNormal);
        // transformedNormal.normaliseInPlace();

        if (texgenlin) {
          vertex.u = 0.5 * (1.0 + transformedNormal.x);
          vertex.v = 0.5 * (1.0 + transformedNormal.y); // 1-y?
        } else {
          vertex.u = Math.acos(transformedNormal.x) / 3.141;
          vertex.v = Math.acos(transformedNormal.y) / 3.141;
        }
      } else {
        vertex.u = u * scale_s;
        vertex.v = v * scale_t;
      }
    } else {
      vertex.u = u * scale_s;
      vertex.v = v * scale_t;

      var r = dv.getUint8(vtx_base + 12);
      var g = dv.getUint8(vtx_base + 13);
      var b = dv.getUint8(vtx_base + 14);
      var a = dv.getUint8(vtx_base + 15);

      vertex.color = (a << 24) | (b << 16) | (g << 8) | r;
    }

    //var flag = dv.getUint16(vtx_base + 6);
    //var tu = dv.getInt16(vtx_base + 8);
    //var tv = dv.getInt16(vtx_base + 10);
    //var rgba = dv.getInt16(vtx_base + 12);    // nx/ny/nz/a
  }
}

function executeGBI1_Sprite2DBase(cmd0, cmd1) {
  logUnimplemented('executeGBI1_Sprite2DBase');
}

function executeGBI1_RDPHalf_Cont(cmd0, cmd1) {
  logUnimplemented('executeGBI1_RDPHalf_Cont');
}

function executeGBI1_RDPHalf_2(cmd0, cmd1, dis) {
  if (dis) {
    dis.text(`gsImmp1(G_RDPHALF_2, ${toString32(cmd1)});`);
  }
  state.rdpHalf2 = cmd1;
}

function executeGBI1_RDPHalf_1(cmd0, cmd1, dis) {
  if (dis) {
    dis.text(`gsImmp1(G_RDPHALF_1, ${toString32(cmd1)});`);
  }
  state.rdpHalf1 = cmd1;
}

function executeGBI1_ClrGeometryMode(cmd0, cmd1, dis) {
  if (dis) {
    dis.text(`gsSPClearGeometryMode(${gbi.getGeometryModeFlagsText(gbi.GeometryModeGBI1, cmd1)});`);
  }
  state.geometryModeBits &= ~cmd1;
  state.updateGeometryModeFromBits(gbi.GeometryModeGBI1);
}

function executeGBI1_SetGeometryMode(cmd0, cmd1, dis) {
  if (dis) {
    dis.text(`gsSPSetGeometryMode(${gbi.getGeometryModeFlagsText(gbi.GeometryModeGBI1, cmd1)});`);
  }
  state.geometryModeBits |= cmd1;
  state.updateGeometryModeFromBits(gbi.GeometryModeGBI1);
}

function executeGBI1_SetOtherModeL(cmd0, cmd1, dis) {
  var shift = (cmd0 >>> 8) & 0xff;
  var len = (cmd0 >>> 0) & 0xff;
  var data = cmd1;
  var mask = (((1 << len) - 1) << shift) >>> 0;
  if (dis) {
    disassemble.SetOtherModeL(dis, mask, data);
  }
  state.rdpOtherModeL = (state.rdpOtherModeL & ~mask) | data;
}

function executeGBI1_SetOtherModeH(cmd0, cmd1, dis) {
  var shift = (cmd0 >>> 8) & 0xff;
  var len = (cmd0 >>> 0) & 0xff;
  var data = cmd1;
  var mask = (((1 << len) - 1) << shift) >>> 0;
  if (dis) {
    disassemble.SetOtherModeH(dis, mask, len, shift, data);
  }
  state.rdpOtherModeH = (state.rdpOtherModeH & ~mask) | data;
}

function calcTextureScale(v) {
  if (v === 0 || v === 0xffff) {
    return 1.0;
  }
  return v / 65536.0;
}

function executeGBI1_Texture(cmd0, cmd1, dis) {
  const xparam = (cmd0 >>> 16) & 0xff;
  const level = (cmd0 >>> 11) & 0x3;
  const tileIdx = (cmd0 >>> 8) & 0x7;
  const on = (cmd0 >>> 0) & 0xff;
  const s = calcTextureScale(((cmd1 >>> 16) & 0xffff));
  const t = calcTextureScale(((cmd1 >>> 0) & 0xffff));

  if (dis) {
    const s_text = s.toString();
    const t_text = t.toString();
    const tile_text = gbi.getTileText(tileIdx);
    const on_text = on ? 'G_ON' : 'G_OFF';

    if (xparam !== 0) {
      dis.text(`gsSPTextureL(${s_text}, ${t_text}, ${level}, ${xparam}, ${tile_text}, ${on_text});`);
    } else {
      dis.text(`gsSPTexture(${s_text}, ${t_text}, ${level}, ${tile_text}, ${on_text});`);
    }
  }

  state.setTexture(s, t, level, tileIdx);
  if (on) {
    state.geometryModeBits |= gbi.GeometryModeGBI1.G_TEXTURE_ENABLE;
  } else {
    state.geometryModeBits &= ~gbi.GeometryModeGBI1.G_TEXTURE_ENABLE;
  }
  state.updateGeometryModeFromBits(gbi.GeometryModeGBI1);
}

function executeGBI1_CullDL(cmd0, cmd1, dis) {
  // FIXME: culldl
  if (dis) {
    dis.text(`gSPCullDisplayList(/* TODO */); // TODO: implement`);
  }
}

function executeGBI1_Tri1(cmd0, cmd1, dis) {
  var kTri1 = cmd0 >>> 24;
  var stride = config.vertexStride;
  var verts = state.projectedVertices;

  var numTris = 0;

  var pc = state.pc;
  do {
    var flag = (cmd1 >>> 24) & 0xff;
    var v0idx = ((cmd1 >>> 16) & 0xff) / stride;
    var v1idx = ((cmd1 >>> 8) & 0xff) / stride;
    var v2idx = ((cmd1 >>> 0) & 0xff) / stride;

    if (dis) {
      dis.text(`gsSP1Triangle(${v0idx}, ${v1idx}, ${v2idx}, ${flag});`);
    }

    triangleBuffer.pushTri(verts[v0idx], verts[v1idx], verts[v2idx], numTris);
    numTris++;

    cmd0 = ram_dv.getUint32(pc + 0);
    cmd1 = ram_dv.getUint32(pc + 4);
    ++debugCurrentOp;
    pc += 8;

    // NB: process triangles individually when disassembling
  } while ((cmd0 >>> 24) === kTri1 && numTris < kMaxTris && !dis);

  state.pc = pc - 8;
  --debugCurrentOp;

  flushTris(numTris);
}

function executeTri4_GBI0(cmd0, cmd1, dis) {
  var kTriCommand = cmd0 >>> 24;
  var stride = config.vertexStride;
  var verts = state.projectedVertices;

  var numTris = 0;

  var pc = state.pc;
  do {
    var v09_idx = ((cmd0 >>> 12) & 0xf);
    var v06_idx = ((cmd0 >>> 8) & 0xf);
    var v03_idx = ((cmd0 >>> 4) & 0xf);
    var v00_idx = ((cmd0 >>> 0) & 0xf);
    var v11_idx = ((cmd1 >>> 28) & 0xf);
    var v10_idx = ((cmd1 >>> 24) & 0xf);
    var v08_idx = ((cmd1 >>> 20) & 0xf);
    var v07_idx = ((cmd1 >>> 16) & 0xf);
    var v05_idx = ((cmd1 >>> 12) & 0xf);
    var v04_idx = ((cmd1 >>> 8) & 0xf);
    var v02_idx = ((cmd1 >>> 4) & 0xf);
    var v01_idx = ((cmd1 >>> 0) & 0xf);

    if (dis) {
      dis.text(`gsSP1Triangle4(${v00_idx},${v01_idx},${v02_idx}, ${v03_idx},${v04_idx},${v05_idx}, ${v06_idx},${v07_idx},${v08_idx}, ${v09_idx},${v10_idx},${v11_idx});`);
    }

    if (v00_idx !== v01_idx) {
      triangleBuffer.pushTri(verts[v00_idx], verts[v01_idx], verts[v02_idx], numTris);
      numTris++;
    }
    if (v03_idx !== v04_idx) {
      triangleBuffer.pushTri(verts[v03_idx], verts[v04_idx], verts[v05_idx], numTris);
      numTris++;
    }
    if (v06_idx !== v07_idx) {
      triangleBuffer.pushTri(verts[v06_idx], verts[v07_idx], verts[v08_idx], numTris);
      numTris++;
    }
    if (v09_idx !== v10_idx) {
      triangleBuffer.pushTri(verts[v09_idx], verts[v10_idx], verts[v11_idx], numTris);
      numTris++;
    }

    cmd0 = ram_dv.getUint32(pc + 0);
    cmd1 = ram_dv.getUint32(pc + 4);
    ++debugCurrentOp;
    pc += 8;
    // NB: process triangles individually when disassembling
  } while ((cmd0 >>> 24) === kTriCommand && numTris < kMaxTris && !dis);

  state.pc = pc - 8;
  --debugCurrentOp;

  flushTris(numTris);
}

function executeGBI1_Tri2(cmd0, cmd1, dis) {
  var kTriCommand = cmd0 >>> 24;
  var stride = config.vertexStride;
  var verts = state.projectedVertices;

  var numTris = 0;

  var pc = state.pc;
  do {
    var v0idx = ((cmd0 >>> 16) & 0xff) / stride;
    var v1idx = ((cmd0 >>> 8) & 0xff) / stride;
    var v2idx = ((cmd0 >>> 0) & 0xff) / stride;
    var v3idx = ((cmd1 >>> 16) & 0xff) / stride;
    var v4idx = ((cmd1 >>> 8) & 0xff) / stride;
    var v5idx = ((cmd1 >>> 0) & 0xff) / stride;

    if (dis) {
      dis.text(`gsSP1Triangle2(${v0idx},${v1idx},${v2idx}, ${v3idx},${v4idx},${v5idx});`);
    }

    triangleBuffer.pushTri(verts[v0idx], verts[v1idx], verts[v2idx], numTris + 0);
    triangleBuffer.pushTri(verts[v3idx], verts[v4idx], verts[v5idx], numTris + 1);
    numTris += 2;

    cmd0 = ram_dv.getUint32(pc + 0);
    cmd1 = ram_dv.getUint32(pc + 4);
    ++debugCurrentOp;
    pc += 8;
    // NB: process triangles individually when disassembling
  } while ((cmd0 >>> 24) === kTriCommand && numTris < kMaxTris && !dis);

  state.pc = pc - 8;
  --debugCurrentOp;

  flushTris(numTris);
}

let executeGBI1_Line3D_Warned = false;

function executeGBI1_Line3D(cmd0, cmd1, dis) {
  var kLineCommand = cmd0 >>> 24;
  var stride = config.vertexStride;
  var verts = state.projectedVertices;

  var numTris = 0;

  var pc = state.pc;
  do {
    var v3idx = ((cmd1 >>> 24) & 0xff) / stride;
    var v0idx = ((cmd1 >>> 16) & 0xff) / stride;
    var v1idx = ((cmd1 >>> 8) & 0xff) / stride;
    var v2idx = ((cmd1 >>> 0) & 0xff) / stride;

    if (dis) {
      dis.text(`gsSPLine3D(${v0idx}, ${v1idx}, ${v2idx}, ${v3idx});`);
    }

    // Tamagotchi World 64 seems to trigger this. 
    if (v0idx < verts.length && v1idx < verts.length && v2idx < verts.length) {
      triangleBuffer.pushTri(verts[v0idx], verts[v1idx], verts[v2idx], numTris);
      numTris++;
    } else if (!executeGBI1_Line3D_Warned) {
      console.log(`verts out of bounds, ignoring: ${v0idx}, ${v1idx}, ${v2idx} vs ${verts.length}, stride ${stride}`);
      executeGBI1_Line3D_Warned = true;
    }
    if (v2idx < verts.length && v3idx < verts.length && v0idx < verts.length) {
      triangleBuffer.pushTri(verts[v2idx], verts[v3idx], verts[v0idx], numTris);
      numTris++;
    } else if (!executeGBI1_Line3D_Warned) {
      console.log(`verts out of bounds, ignoring: ${v2idx}, ${v3idx}, ${v0idx} vs ${verts.length}, stride ${stride}`);
      executeGBI1_Line3D_Warned = true;
    }

    cmd0 = ram_dv.getUint32(pc + 0);
    cmd1 = ram_dv.getUint32(pc + 4);
    ++debugCurrentOp;
    pc += 8;
    // NB: process triangles individually when disassembling
  } while ((cmd0 >>> 24) === kLineCommand && numTris + 1 < kMaxTris && !dis);

  state.pc = pc - 8;
  --debugCurrentOp;

  flushTris(numTris);
}

function executeSetKeyGB(cmd0, cmd1, dis) {
  if (dis) {
    dis.text('gsDPSetKeyGB(???);');
  }
}

function executeSetKeyR(cmd0, cmd1, dis) {
  if (dis) {
    dis.text('gsDPSetKeyR(???);');
  }
}

function executeSetConvert(cmd0, cmd1, dis) {
  if (dis) {
    dis.text('gsDPSetConvert(???);');
  }
}

function executeSetScissor(cmd0, cmd1, dis) {
  var x0 = ((cmd0 >>> 12) & 0xfff) / 4.0;
  var y0 = ((cmd0 >>> 0) & 0xfff) / 4.0;
  var x1 = ((cmd1 >>> 12) & 0xfff) / 4.0;
  var y1 = ((cmd1 >>> 0) & 0xfff) / 4.0;
  var mode = (cmd1 >>> 24) & 0x2;

  if (dis) {
    dis.text(`gsDPSetScissor(${gbi.ScissorMode.nameOf(mode)}, ${x0}, ${y0}, ${x1}, ${y1});`);
  }

  state.scissor.x0 = x0;
  state.scissor.y0 = y0;
  state.scissor.x1 = x1;
  state.scissor.y1 = y1;
  state.scissor.mode = mode;

  // FIXME: actually set this
}

function executeSetPrimDepth(cmd0, cmd1, dis) {
  var z = (cmd1 >>> 16) & 0xffff;
  var dz = (cmd1) & 0xffff;
  if (dis) {
    dis.text(`gsDPSetPrimDepth(${z},${dz});`);
  }

  // FIXME
}

function executeSetRDPOtherMode(cmd0, cmd1, dis) {
  if (dis) {
    dis.text(`gsDPSetOtherMode(${toString32(cmd0)}, ${toString32(cmd1)}); // TODO: fix formatting`);
  }

  state.rdpOtherModeH = cmd0;
  state.rdpOtherModeL = cmd1;
}

function calcTextureAddress(uls, ult, address, width, size) {
  return address + (ult * texelsToBytes(width, size)) + texelsToBytes(uls, size);
}

// TODO: why is this needed if we check the hash as it's needed?
function invalidateTileHashes() {
  for (let i = 0; i < 8; ++i) {
    state.tiles[i].hash = 0;
  }
}

function executeLoadBlock(cmd0, cmd1, dis) {
  const tileIdx = (cmd1 >>> 24) & 0x7;
  const lrs = (cmd1 >>> 12) & 0xfff;
  const dxt = (cmd1 >>> 0) & 0xfff;
  const uls = (cmd0 >>> 12) & 0xfff;
  const ult = (cmd0 >>> 0) & 0xfff;

  // Docs reckon these are ignored for all loadBlocks
  if (uls !== 0) { hleHalt('Unexpected non-zero uls in load block'); }
  if (ult !== 0) { hleHalt('Unexpected non-zero ult in load block'); }

  const tile = state.tiles[tileIdx];
  const tileX0 = uls >>> 2;
  const tileY0 = ult >>> 2;

  const ramAddress = calcTextureAddress(tileX0, tileY0, state.textureImage.address, state.textureImage.width, state.textureImage.size);

  const bytes = texelsToBytes(lrs + 1, state.textureImage.size);
  const qwords = (bytes + 7) >>> 3;

  if (dis) {
    const tt = gbi.getTileText(tileIdx);
    dis.text(`gsDPLoadBlock(${tt}, ${uls}, ${ult}, ${lrs}, ${dxt});`);
    dis.tip(`bytes ${bytes}, qwords ${qwords}`);
  }

  state.tmem.loadBlock(tile, ramAddress, dxt, qwords);
  invalidateTileHashes();
}

function texelsToBytes(texels, size) {
  return (texels << size) >>> 1;
}

function executeLoadTile(cmd0, cmd1, dis) {
  const tileIdx = (cmd1 >>> 24) & 0x7;
  const lrs = (cmd1 >>> 12) & 0xfff;
  const lrt = (cmd1 >>> 0) & 0xfff;
  const uls = (cmd0 >>> 12) & 0xfff;
  const ult = (cmd0 >>> 0) & 0xfff;

  const tile = state.tiles[tileIdx];
  const tileX1 = lrs >>> 2;
  const tileY1 = lrt >>> 2;
  const tileX0 = uls >>> 2;
  const tileY0 = ult >>> 2;

  const h = (tileY1 + 1) - tileY0;
  const w = (tileX1 + 1) - tileX0;

  const ramAddress = calcTextureAddress(tileX0, tileY0, state.textureImage.address, state.textureImage.width, state.textureImage.size);
  const ramStride = texelsToBytes(state.textureImage.width, state.textureImage.size);
  const rowBytes = texelsToBytes(w, state.textureImage.size);

  // loadTile pads rows to 8 bytes.
  const tmemStride = (state.textureImage.size == gbi.ImageSize.G_IM_SIZ_32b) ? tile.line << 4 : tile.line << 3;

  // TODO: Limit the load to fetchedQWords?
  // TODO: should be limited to 2048 texels, not 512 qwords.
  const bytes = h * rowBytes;
  const reqQWords = (bytes + 7) >>> 3;
  const fetchedQWords = (reqQWords > 512) ? 512 : reqQWords;

  if (dis) {
    var tt = gbi.getTileText(tileIdx);
    dis.text(`gsDPLoadTile(${tt}, ${uls / 4}, ${ult / 4}, ${lrs / 4}, ${lrt / 4});`);
    dis.tip(`size = (${w} x ${h}), rowBytes ${rowBytes}, ramStride ${ramStride}, tmemStride ${tmemStride}`);
  }

  state.tmem.loadTile(tile, ramAddress, h, ramStride, rowBytes, tmemStride);
  invalidateTileHashes();
}

function executeLoadTLut(cmd0, cmd1, dis) {
  var tileIdx = (cmd1 >>> 24) & 0x7;
  var count = (cmd1 >>> 14) & 0x3ff;

  // NB, in Daedalus, we interpret this similarly to a loadtile command,
  // but in other places it's defined as a simple count parameter.
  var uls = (cmd0 >>> 12) & 0xfff;
  var ult = (cmd0 >>> 0) & 0xfff;
  var lrs = (cmd1 >>> 12) & 0xfff;
  var lrt = (cmd1 >>> 0) & 0xfff;

  if (dis) {
    const tt = gbi.getTileText(tileIdx);
    dis.text(`gsDPLoadTLUTCmd(${tt}, ${count}); //${uls}, ${ult}, ${lrs}, ${lrt}`);
  }

  // Tlut fmt is sometimes wrong (in 007) and is set after tlut load, but
  // before tile load. Format is always 16bpp - RGBA16 or IA16:
  // var address = calcTextureAddress(uls >>> 2, ult >>> 2,
  //                                  state.textureImage.address,
  //                                  åstate.textureImage.width,
  //                                  åstate.textureImage.size);
  var ram_offset = calcTextureAddress(uls >>> 2, ult >>> 2,
                                      state.textureImage.address,
                                      state.textureImage.width,
    gbi.ImageSize.G_IM_SIZ_16b);

  var tile = state.tiles[tileIdx];
  var texels = ((lrs - uls) >>> 2) + 1;

  const ram_u8 = getRamU8Array();
  var tmem_offset = tile.tmem << 3;

  copyLineTLUT(state.tmem.tmemData, tmem_offset, ram_u8, ram_offset, texels);

  invalidateTileHashes();
}

function copyLineTLUT(tmem, tmem_offset, ram, ram_offset, texels) {
  // TLUT entries are "quadricated" across banks.
  // TODO: optimise this.
  for (let texel = 0; texel < texels; texel++) {
    const lo = ram[ram_offset + (texel * 2) + 0];
    const hi = ram[ram_offset + (texel * 2) + 1];

    tmem[tmem_offset + (texel * 8) + 0] = lo;
    tmem[tmem_offset + (texel * 8) + 1] = hi;
    tmem[tmem_offset + (texel * 8) + 2] = lo;
    tmem[tmem_offset + (texel * 8) + 3] = hi;
    tmem[tmem_offset + (texel * 8) + 4] = lo;
    tmem[tmem_offset + (texel * 8) + 5] = hi;
    tmem[tmem_offset + (texel * 8) + 6] = lo;
    tmem[tmem_offset + (texel * 8) + 7] = hi;
  }
}

function executeSetTile(cmd0, cmd1, dis) {
  var format = (cmd0 >>> 21) & 0x7;
  var size = (cmd0 >>> 19) & 0x3;
  //var pad0 = (cmd0 >>> 18) & 0x1;
  var line = (cmd0 >>> 9) & 0x1ff;
  var tmem = (cmd0 >>> 0) & 0x1ff;

  //var pad1 = (cmd1 >>> 27) & 0x1f;
  var tileIdx = (cmd1 >>> 24) & 0x7;
  var palette = (cmd1 >>> 20) & 0xf;

  var cm_t = (cmd1 >>> 18) & 0x3;
  var mask_t = (cmd1 >>> 14) & 0xf;
  var shift_t = (cmd1 >>> 10) & 0xf;

  var cm_s = (cmd1 >>> 8) & 0x3;
  var mask_s = (cmd1 >>> 4) & 0xf;
  var shift_s = (cmd1 >>> 0) & 0xf;

  if (dis) {
    const fmtText = gbi.ImageFormat.nameOf(format);
    const sizeText = gbi.ImageSize.nameOf(size);
    const tileText = gbi.getTileText(tileIdx);
    const cmsText = gbi.getClampMirrorWrapText(cm_s);
    const cmtText = gbi.getClampMirrorWrapText(cm_t);

    dis.text(`gsDPSetTile(${fmtText}, ${sizeText}, ${line}, ${tmem}, ${tileText}, ${palette}, ${cmtText}, ${mask_t}, ${shift_t}, ${cmsText}, ${mask_s}, ${shift_s});`);
  }

  var tile = state.tiles[tileIdx];
  tile.format = format;
  tile.size = size;
  tile.line = line;
  tile.tmem = tmem;
  tile.palette = palette;
  tile.cm_t = cm_t;
  tile.mask_t = mask_t;
  tile.shift_t = shift_t;
  tile.cm_s = cm_s;
  tile.mask_s = mask_s;
  tile.shift_s = shift_s;
  tile.hash = 0;
}

function executeSetTileSize(cmd0, cmd1, dis) {
  const uls = (cmd0 >>> 12) & 0xfff;
  const ult = (cmd0 >>> 0) & 0xfff;
  const tileIdx = (cmd1 >>> 24) & 0x7;
  const lrs = (cmd1 >>> 12) & 0xfff;
  const lrt = (cmd1 >>> 0) & 0xfff;

  const tile = state.tiles[tileIdx];
  tile.uls = uls;
  tile.ult = ult;
  tile.lrs = lrs;
  tile.lrt = lrt;
  tile.hash = 0;

  if (dis) {
    const tt = gbi.getTileText(tileIdx);
    dis.text(`gsDPSetTileSize(${tt}, ${tile.left}, ${tile.top}, ${tile.right}, ${tile.bottom});`);
    dis.tip(`size (${tile.width} x ${tile.height}), unmasked (${tile.unmaskedWidth} x ${tile.unmaskedHeight})`);
  }
}

function executeFillRect(cmd0, cmd1, dis) {
  // NB: fraction is ignored
  var x0 = ((cmd1 >>> 12) & 0xfff) >>> 2;
  var y0 = ((cmd1 >>> 0) & 0xfff) >>> 2;
  var x1 = ((cmd0 >>> 12) & 0xfff) >>> 2;
  var y1 = ((cmd0 >>> 0) & 0xfff) >>> 2;

  if (dis) {
    dis.text(`gsDPFillRectangle(${x0}, ${y0}, ${x1}, ${y1});`);
  }

  if (state.depthImage.address == state.colorImage.address) {
    // TODO: should use depth source.
    // const depthSourcePrim = (state.rdpOtherModeL & gbi.DepthSource.G_ZS_PRIM) !== 0;
    // const depth = depthSourcePrim ? state.primDepth : 0.0;
    gl.clearDepth(1.0);
    gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    return;
  }

  var cycle_type = state.getCycleType();

  var color = { r: 0, g: 0, b: 0, a: 0 };

  if (cycle_type === gbi.CycleType.G_CYC_FILL) {
    x1 += 1;
    y1 += 1;

    if (state.colorImage.size === gbi.ImageSize.G_IM_SIZ_16b) {
      color = makeRGBAFromRGBA16(state.fillColor & 0xffff);
    } else {
      color = makeRGBAFromRGBA32(state.fillColor);
    }

    // Clear whole screen in one?
    const w = x1 - x0;
    const h = y1 - y0;
    if (w === nativeTransform.viWidth && h === nativeTransform.viHeight) {
      gl.clearColor(color.r, color.g, color.b, color.a);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }
  } else if (cycle_type === gbi.CycleType.G_CYC_COPY) {
    x1 += 1;
    y1 += 1;
  }

  // TODO: Apply scissor.

  fillRect(x0, y0, x1, y1, color);
}

function executeTexRect(cmd0, cmd1, dis) {
  // The following 2 commands contain additional info
  // TODO: check op code matches what we expect?
  var cmd2 = ram_dv.getUint32(state.pc + 4);
  var cmd3 = ram_dv.getUint32(state.pc + 12);
  state.pc += 16;

  var xh = ((cmd0 >>> 12) & 0xfff) / 4.0;
  var yh = ((cmd0 >>> 0) & 0xfff) / 4.0;
  var tileIdx = (cmd1 >>> 24) & 0x7;
  var xl = ((cmd1 >>> 12) & 0xfff) / 4.0;
  var yl = ((cmd1 >>> 0) & 0xfff) / 4.0;
  var s0 = ((cmd2 >>> 16) & 0xffff) / 32.0;
  var t0 = ((cmd2 >>> 0) & 0xffff) / 32.0;
  // NB - signed value
  var dsdx = ((cmd3 | 0) >> 16) / 1024.0;
  var dtdy = ((cmd3 << 16) >> 16) / 1024.0;

  var cycle_type = state.getCycleType();

  // In copy mode 4 pixels are copied at once.
  if (cycle_type === gbi.CycleType.G_CYC_COPY) {
    dsdx *= 0.25;
  }

  // In Fill/Copy mode the coordinates are inclusive (i.e. add 1.0f to the w/h)
  if (cycle_type === gbi.CycleType.G_CYC_COPY ||
    cycle_type === gbi.CycleType.G_CYC_FILL) {
    xh += 1.0;
    yh += 1.0;
  }

  // If the texture coords are inverted, start from the end of the texel (?).
  // Fixes California Speed.
  if (dsdx < 0) { s0++; }
  if (dtdy < 0) { t0++; }

  var s1 = s0 + dsdx * (xh - xl);
  var t1 = t0 + dtdy * (yh - yl);

  if (dis) {
    var tt = gbi.getTileText(tileIdx);
    dis.text(`gsSPTextureRectangle(${xl},${yl},${xh},${yh},${tt},${s0},${t0},${dsdx},${dtdy});`);
    dis.tip(`cmd2 = ${toString32(cmd2)}, cmd3 = ${toString32(cmd3)}`)
    dis.tip(`st0 = (${s0}, ${t0}) st1 = (${s1}, ${t1})`)
  }

  texRect(tileIdx, xl, yl, xh, yh, s0, t0, s1, t1, false);
}

function executeTexRectFlip(cmd0, cmd1, dis) {
  // The following 2 commands contain additional info
  // TODO: check op code matches what we expect?
  var cmd2 = ram_dv.getUint32(state.pc + 4);
  var cmd3 = ram_dv.getUint32(state.pc + 12);
  state.pc += 16;

  var xh = ((cmd0 >>> 12) & 0xfff) / 4.0;
  var yh = ((cmd0 >>> 0) & 0xfff) / 4.0;
  var tileIdx = (cmd1 >>> 24) & 0x7;
  var xl = ((cmd1 >>> 12) & 0xfff) / 4.0;
  var yl = ((cmd1 >>> 0) & 0xfff) / 4.0;
  var s0 = ((cmd2 >>> 16) & 0xffff) / 32.0;
  var t0 = ((cmd2 >>> 0) & 0xffff) / 32.0;
  // NB - signed value
  var dsdx = ((cmd3 | 0) >> 16) / 1024.0;
  var dtdy = ((cmd3 << 16) >> 16) / 1024.0;

  var cycle_type = state.getCycleType();

  // In copy mode 4 pixels are copied at once.
  if (cycle_type === gbi.CycleType.G_CYC_COPY) {
    dsdx *= 0.25;
  }

  // In Fill/Copy mode the coordinates are inclusive (i.e. add 1.0f to the w/h)
  if (cycle_type === gbi.CycleType.G_CYC_COPY ||
    cycle_type === gbi.CycleType.G_CYC_FILL) {
    xh += 1.0;
    yh += 1.0;
  }

  // If the texture coords are inverted, start from the end of the texel (?).
  if (dsdx < 0) { s0++; }
  if (dtdy < 0) { t0++; }

  // NB x/y are flipped
  var s1 = s0 + dsdx * (yh - yl);
  var t1 = t0 + dtdy * (xh - xl);

  if (dis) {
    var tt = gbi.getTileText(tileIdx);
    dis.text(`gsSPTextureRectangleFlip(${xl},${yl},${xh},${yh},${tt},${s0},${t0},${dsdx},${dtdy});`);
    dis.tip(`cmd2 = ${toString32(cmd2)}, cmd3 = ${toString32(cmd3)}`)
    dis.tip(`st0 = (${s0}, ${t0}) st1 = (${s1}, ${t1})`)
  }

  texRect(tileIdx, xl, yl, xh, yh, s0, t0, s1, t1, true);
}

function executeSetFillColor(cmd0, cmd1, dis) {
  if (dis) {
    // Can be 16 or 32 bit
    dis.text(`gsDPSetFillColor(${makeColorTextRGBA(cmd1)}); // hi as 5551 = ${makeColorTextRGBA16(cmd1 >>> 16)}, lo as 5551 = ${makeColorTextRGBA16(cmd1 & 0xffff)} `);
  }
  state.fillColor = cmd1;
}

function executeSetFogColor(cmd0, cmd1, dis) {
  if (dis) {
    dis.text(`gsDPSetFogColor(${makeColorTextRGBA(cmd1)});`);
  }
  state.fogColor = cmd1;
}

function executeSetBlendColor(cmd0, cmd1, dis) {
  if (dis) {
    dis.text(`gsDPSetBlendColor(${makeColorTextRGBA(cmd1)});`);
  }
  state.blendColor = cmd1;
}

function executeSetPrimColor(cmd0, cmd1, dis) {
  if (dis) {
    var m = (cmd0 >>> 8) & 0xff;
    var l = (cmd0 >>> 0) & 0xff;
    dis.text(`gsDPSetPrimColor(${m}, ${l}, ${makeColorTextRGBA(cmd1)});`);
  }
  // minlevel, primlevel ignored!
  state.primColor = cmd1;
}

function executeSetEnvColor(cmd0, cmd1, dis) {
  if (dis) {
    dis.text(`gsDPSetEnvColor(${makeColorTextRGBA(cmd1)});`);
  }
  state.envColor = cmd1;
}

function executeSetCombine(cmd0, cmd1, dis) {

  if (dis) {
    var mux0 = cmd0 & 0x00ffffff;
    var mux1 = cmd1;
    var decoded = shaders.getCombinerText(mux0, mux1);

    dis.text(`gsDPSetCombine(${toString32(mux0)}, ${toString32(mux1)});\n${decoded}`);
  }

  state.combine.hi = cmd0 & 0x00ffffff;
  state.combine.lo = cmd1;
}

function executeSetTImg(cmd0, cmd1, dis) {
  var format = (cmd0 >>> 21) & 0x7;
  var size = (cmd0 >>> 19) & 0x3;
  var width = ((cmd0 >>> 0) & 0xfff) + 1;
  var address = rdpSegmentAddress(cmd1);

  if (dis) {
    dis.text(`gsDPSetTextureImage(${gbi.ImageFormat.nameOf(format)}, ${gbi.ImageSize.nameOf(size)}, ${width}, ${toString32(address)});`);
  }

  state.textureImage = {
    format: format,
    size: size,
    width: width,
    address: address
  };
}

function executeSetZImg(cmd0, cmd1, dis) {
  var address = rdpSegmentAddress(cmd1);

  if (dis) {
    dis.text(`gsDPSetDepthImage(${toString32(address)});`);
  }

  state.depthImage.address = address;
}

function executeSetCImg(cmd0, cmd1, dis) {
  var format = (cmd0 >>> 21) & 0x7;
  var size = (cmd0 >>> 19) & 0x3;
  var width = ((cmd0 >>> 0) & 0xfff) + 1;
  var address = rdpSegmentAddress(cmd1);

  if (dis) {
    dis.text(`gsDPSetColorImage(${gbi.ImageFormat.nameOf(format)}, ${gbi.ImageSize.nameOf(size)}, ${width}, ${toString32(address)});`);
  }

  state.colorImage = {
    format: format,
    size: size,
    width: width,
    address: address
  };

  // TODO: Banjo Tooie and Pokemon Stadium render to multiple buffers in each display list.
  // Need to set these up as separate framebuffers somehow
  if (kDebugColorImages && !colorImages.get(address)) {
    logger.log(`Setting colorImage to ${toString32(address)}, ${width}, size ${gbi.ImageSize.nameOf(size)}, format ${gbi.ImageFormat.nameOf(format)}`);
    colorImages.set(address, true);
  }
}

function executeGBI0_Vertex(cmd0, cmd1, dis) {
  var n = ((cmd0 >>> 20) & 0xf) + 1;
  var v0 = (cmd0 >>> 16) & 0xf;
  //var length = (cmd0 >>>  0) & 0xffff;
  var address = rdpSegmentAddress(cmd1);

  if (dis) {
    dis.text(`gsSPVertex(${toString32(address)}, ${n}, ${v0});`);
  }

  executeVertexImpl(v0, n, address, dis);
}

function executeVertex_GBI0_WR(cmd0, cmd1, dis) {
  var n = ((cmd0 >>> 9) & 0x7f);
  var v0 = ((cmd0 >>> 16) & 0xff) / 5;
  //var length = (cmd0 >>> 0) & 0x1ff;
  var address = rdpSegmentAddress(cmd1);

  if (dis) {
    dis.text(`gsSPVertex(${toString32(address)}, ${n}, ${v0});`);
  }

  executeVertexImpl(v0, n, address, dis);
}

function executeGBI1_Vertex(cmd0, cmd1, dis) {
  var v0 = ((cmd0 >>> 16) & 0xff) / config.vertexStride;
  var n = ((cmd0 >>> 10) & 0x3f);
  //var length = (cmd0 >>>  0) & 0x3ff;
  var address = rdpSegmentAddress(cmd1);

  if (dis) {
    dis.text(`gsSPVertex(${toString32(address)}, ${n}, ${v0});`);
  }

  executeVertexImpl(v0, n, address, dis);
}

function executeGBI1_ModifyVtx(cmd0, cmd1, dis) {
  if (dis) {
    dis.text('gsSPModifyVertex(???);');
  }

  // FIXME!
}


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

var fillShaderProgram;
var fill_vertexPositionAttribute;
var fill_uFillColor;

var blitShaderProgram;
var blit_vertexPositionAttribute;
var blit_texCoordAttribute;
var blit_uSampler;

var rectVerticesBuffer;
var n64PositionsBuffer;
var n64ColorsBuffer;
var n64UVBuffer;

const kBlendModeUnknown = 0;
const kBlendModeOpaque = 1;
const kBlendModeAlphaTrans = 2;
const kBlendModeFade = 3;
const kBlendModeFog = 4;

function setProgramState(positions, colours, coords, textureEnabled, texGenEnabled, tileIdx) {
  setGLBlendMode();

  const cycleType = state.getCycleType();

  // TODO: I think it would make more sense to check if the texture is referenced in the combiner.
  let tile0, tile1;
  let texture0, texture1;
  if (textureEnabled) {
    const tileIdx0 = (tileIdx + 0) & 7;
    const tileIdx1 = (tileIdx + 1) & 7;

    tile0 = state.tiles[tileIdx0];
    tile1 = state.tiles[tileIdx1];

    texture0 = lookupTexture(tileIdx0);
    texture1 = (cycleType == gbi.CycleType.G_CYC_2CYCLE) ? lookupTexture(tileIdx1) : null;
  }
  let enableAlphaThreshold = false;
  let alphaThreshold = -1.0;

  if ((state.getAlphaCompareType() === gbi.AlphaCompare.G_AC_THRESHOLD)) {
    // TODO: it's unclear if this depends on CVG_X_ALPHA and ALPHA_CVG_SEL.
    alphaThreshold = ((state.blendColor >>> 0) & 0xff) / 255.0;
    enableAlphaThreshold = true;
  }

  var shader = getCurrentN64Shader(cycleType, enableAlphaThreshold);
  gl.useProgram(shader.program);

  // aVertexPosition
  gl.enableVertexAttribArray(shader.vertexPositionAttribute);
  gl.bindBuffer(gl.ARRAY_BUFFER, n64PositionsBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
  gl.vertexAttribPointer(shader.vertexPositionAttribute, 4, gl.FLOAT, false, 0, 0);

  // aVertexColor
  gl.enableVertexAttribArray(shader.vertexColorAttribute);
  gl.bindBuffer(gl.ARRAY_BUFFER, n64ColorsBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, colours, gl.STATIC_DRAW);
  gl.vertexAttribPointer(shader.vertexColorAttribute, 4, gl.UNSIGNED_BYTE, true, 0, 0);

  // aTextureCoord
  gl.enableVertexAttribArray(shader.texCoordAttribute);
  gl.bindBuffer(gl.ARRAY_BUFFER, n64UVBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, coords, gl.STATIC_DRAW);
  gl.vertexAttribPointer(shader.texCoordAttribute, 2, gl.FLOAT, false, 0, 0);

  bindTexture(0, gl.TEXTURE0, tile0, texture0, texGenEnabled, shader.uSamplerUniform0, shader.uTexScaleUniform0, shader.uTexOffsetUniform0);
  bindTexture(1, gl.TEXTURE1, tile1, texture1, texGenEnabled, shader.uSamplerUniform1, shader.uTexScaleUniform1, shader.uTexOffsetUniform1);

  gl.uniform1f(shader.uAlphaThresholdUniform, alphaThreshold);

  gl.uniform4f(shader.uPrimColorUniform,
    ((state.primColor >>> 24) & 0xff) / 255.0,
    ((state.primColor >>> 16) & 0xff) / 255.0,
    ((state.primColor >>> 8) & 0xff) / 255.0,
    ((state.primColor >>> 0) & 0xff) / 255.0);
  gl.uniform4f(shader.uEnvColorUniform,
    ((state.envColor >>> 24) & 0xff) / 255.0,
    ((state.envColor >>> 16) & 0xff) / 255.0,
    ((state.envColor >>> 8) & 0xff) / 255.0,
    ((state.envColor >>> 0) & 0xff) / 255.0);
}

function bindTexture(slot, glTextureId, tile, texture, texGenEnabled, sampleUniform, texScaleUniform, texOffsetUniform) {
  gl.activeTexture(glTextureId);

  if (!texture) {
    gl.bindTexture(gl.TEXTURE_2D, null);
    return;
  }

  let uvOffsetU = tile.left;
  let uvOffsetV = tile.top;
  let uvScaleU = 1.0 / texture.nativeWidth;
  let uvScaleV = 1.0 / texture.nativeHeight;

  // Horrible hack for wetrix. For some reason uvs come out 2x what they should be.
  if (texture.width === 56 && texture.height === 29) {
    uvScaleU *= 0.5;
    uvScaleV *= 0.5;
  }

  // When texture coordinates are generated, they're already correctly
  // scaled. Maybe they should be generated in this coord space?
  if (texGenEnabled) {
    uvScaleU = 1;
    uvScaleV = 1;
    uvOffsetU = 0;
    uvOffsetV = 0;
  }

  uvScaleU *= shiftFactor(tile.shift_s);
  uvScaleV *= shiftFactor(tile.shift_t);

  gl.bindTexture(gl.TEXTURE_2D, texture.texture);
  gl.uniform1i(sampleUniform, slot);

  gl.uniform2f(texScaleUniform, uvScaleU, uvScaleV);
  gl.uniform2f(texOffsetUniform, uvOffsetU, uvOffsetV);

  if (state.getTextureFilterType() == gbi.TextureFilter.G_TF_POINT) {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_NEAREST);
  } else {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_NEAREST);
  }

  // When not masking, Clamp S,T is ignored and clamping is implicitly enabled
  var clampS = tile.cm_s === gbi.G_TX_CLAMP || (tile.mask_s === 0);
  var clampT = tile.cm_t === gbi.G_TX_CLAMP || (tile.mask_t === 0);
  var mirrorS = tile.cm_s === gbi.G_TX_MIRROR;
  var mirrorT = tile.cm_t === gbi.G_TX_MIRROR;

  var mode_s = clampS ? gl.CLAMP_TO_EDGE : (mirrorS ? gl.MIRRORED_REPEAT : gl.REPEAT);
  var mode_t = clampT ? gl.CLAMP_TO_EDGE : (mirrorT ? gl.MIRRORED_REPEAT : gl.REPEAT);

  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, mode_s);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, mode_t);
}

function shiftFactor(shift) {
  if (shift <= 10) {
    return 1 / (1 << shift);
  }
  return 1 << (16 - shift);
}

function setGLBlendMode() {
  // fragment coverage (0) or alpha (1)?
  const cvgXAlpha = state.getCoverageTimesAlpha();
  // use fragment coverage * fragment alpha
  const alphaCvgSel = state.getAlphaCoverageSelect();

  const cycleType = state.getCycleType();
  if (cycleType == gbi.CycleType.G_CYC_FILL || cycleType == gbi.CycleType.G_CYC_COPY) {
    // No blending in copy/fill modes, although they may set up alpha thresholding in the shader.
    gl.disable(gl.BLEND);
    return;
  }

  const blendMode = state.rdpOtherModeL >> gbi.G_MDSFT_BLENDER;
  const activeBlendMode = (cycleType === gbi.CycleType.G_CYC_2CYCLE ? blendMode : (blendMode >>> 2)) & 0x3333;

  let mode = kBlendModeUnknown;
  switch (activeBlendMode) {
    case 0x0000: // G_BL_CLR_IN, G_BL_A_IN, G_BL_CLR_IN, G_BL_1MA
    case 0x0302: // G_BL_CLR_IN, G_BL_0, G_BL_CLR_IN, G_BL_1
      mode = kBlendModeOpaque;
      break;
    // case 0x0321 = G_BL_CLR_IN, G_BL_0, G_BL_CLR_BL, G_BL_A_MEM - blend*alpha.

    case 0x0010: // G_BL_CLR_IN, G_BL_A_IN, G_BL_CLR_MEM, G_BL_1MA
    case 0x0011: // G_BL_CLR_IN, G_BL_A_IN, G_BL_CLR_MEM, G_BL_A_MEM
      // These modes either do a weighted sum of coverage (or coverage and alpha) or a plain alpha blend
      // If alpha_cvg_sel is 0, or if we're multiplying by fragment alpha, then we have alpha to blend with.
      if (!alphaCvgSel || cvgXAlpha) {
        mode = kBlendModeAlphaTrans;
      }
      break;

    case 0x0110: // G_BL_CLR_IN, G_BL_A_FOG, G_BL_CLR_MEM, G_BL_1MA, alpha_cvg_sel:false cvg_x_alpha:false
      // FIXME: this needs to blend the input colour with the fog alpha, but we don't compute this yet.
      mode = kBlendModeOpaque;
      break;

    case 0x0310: // G_BL_CLR_IN, G_BL_0, G_BL_CLR_MEM, G_BL_1MA, alpha_cvg_sel:false cvg_x_alpha:false
    case 0x1310: // G_BL_CLR_MEM, G_BL_0, G_BL_CLR_MEM, G_BL_1MA
      mode = kBlendModeFade;
      break;

    case 0x3110: // G_BL_CLR_FOG, G_BL_A_FOG, G_BL_CLR_MEM, G_BL_1MA
      mode = kBlendModeFog;
      break;
  }

  let logUnhandled = false;
  switch (mode) {
    case kBlendModeOpaque:
      gl.disable(gl.BLEND);
      break;
    case kBlendModeAlphaTrans:
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.blendEquation(gl.FUNC_ADD);
      gl.enable(gl.BLEND);
      break;
    case kBlendModeFade:
      gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
      gl.blendEquation(gl.FUNC_ADD);
      gl.enable(gl.BLEND);
      break;
    case kBlendModeFog:
      // TODO: figure out how to emulate this.
      // For now just render as opaque.
      logUnhandled = true;
      gl.disable(gl.BLEND);
      break;
    case kBlendModeUnknown:
      logUnhandled = true;
      gl.disable(gl.BLEND);
      break;
  }

  if (logUnhandled) {
    logUnhandledBlendMode(activeBlendMode, alphaCvgSel, cvgXAlpha);
  }
}

function flushTris(numTris) {
  const textureEnabled = state.geometryMode.texture;
  const texGenEnabled = state.geometryMode.lighting && state.geometryMode.textureGen;
  setProgramState(triangleBuffer.positions,
    triangleBuffer.colours,
    triangleBuffer.coords,
    textureEnabled,
    texGenEnabled,
    state.texture.tile);

  initDepth();

  // texture filter

  if (state.geometryMode.cullFront || state.geometryMode.cullBack) {
    gl.enable(gl.CULL_FACE);
    const mode = (state.geometryMode.cullFront) ? gl.FRONT : gl.BACK;
    gl.cullFace(mode);
  } else {
    gl.disable(gl.CULL_FACE);
  }

  gl.drawArrays(gl.TRIANGLES, 0, numTris * 3);
  //gl.drawArrays(gl.LINE_STRIP, 0, numTris * 3);
}

function fillRect(x0, y0, x1, y1, color) {
  setGLBlendMode();

  var display0 = nativeTransform.convertN64ToDisplay(new Vector2(x0, y0));
  var display1 = nativeTransform.convertN64ToDisplay(new Vector2(x1, y1));

  var vertices = [
    display1.x, display1.y, 0.0, 1.0,
    display0.x, display1.y, 0.0, 1.0,
    display1.x, display0.y, 0.0, 1.0,
    display0.x, display0.y, 0.0, 1.0,
  ];

  gl.useProgram(fillShaderProgram);

  // aVertexPosition
  gl.enableVertexAttribArray(fill_vertexPositionAttribute);
  gl.bindBuffer(gl.ARRAY_BUFFER, rectVerticesBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
  gl.vertexAttribPointer(fill_vertexPositionAttribute, 4, gl.FLOAT, false, 0, 0);

  // uFillColor
  gl.uniform4f(fill_uFillColor, color.r, color.g, color.b, color.a);

  // Disable culling and depth testing.
  gl.disable(gl.CULL_FACE);
  gl.disable(gl.DEPTH_TEST);
  gl.depthMask(false);

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function texRect(tileIdx, x0, y0, x1, y1, s0, t0, s1, t1, flip) {
  // TODO: check scissor

  var display0 = nativeTransform.convertN64ToDisplay(new Vector2(x0, y0));
  var display1 = nativeTransform.convertN64ToDisplay(new Vector2(x1, y1));
  var depth_source_prim = (state.rdpOtherModeL & gbi.DepthSource.G_ZS_PRIM) !== 0;
  var depth = depth_source_prim ? state.primDepth : 0.0;

  var vertices = [
    display0.x, display0.y, depth, 1.0,
    display1.x, display0.y, depth, 1.0,
    display0.x, display1.y, depth, 1.0,
    display1.x, display1.y, depth, 1.0
  ];

  var uvs;

  if (flip) {
    uvs = [
      s0, t0,
      s0, t1,
      s1, t0,
      s1, t1,
    ];
  } else {
    uvs = [
      s0, t0,
      s1, t0,
      s0, t1,
      s1, t1,
    ];
  }

  var colours = [0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff];

  setProgramState(new Float32Array(vertices),
                  new Uint32Array(colours),
    new Float32Array(uvs), true /* textureEnabled */, false /*texGenEnabled*/, tileIdx);

  gl.disable(gl.CULL_FACE);

  var depth_enabled = depth_source_prim ? true : false;
  if (depth_enabled) {
    initDepth();
  } else {
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
  }
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function copyBackBufferToFrontBuffer(texture) {
  // Passing null binds the framebuffer to the canvas.
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  var vertices = [
    -1.0, -1.0, 0.0, 1.0,
    1.0, -1.0, 0.0, 1.0,
    -1.0, 1.0, 0.0, 1.0,
    1.0, 1.0, 0.0, 1.0
  ];

  var uvs = [
    0.0, 0.0,
    1.0, 0.0,
    0.0, 1.0,
    1.0, 1.0
  ];

  gl.useProgram(blitShaderProgram);

  const canvas = document.getElementById('display');
  gl.viewport(0, 0, canvas.width, canvas.height);

  // aVertexPosition
  gl.enableVertexAttribArray(blit_vertexPositionAttribute);
  gl.bindBuffer(gl.ARRAY_BUFFER, n64PositionsBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
  gl.vertexAttribPointer(blit_vertexPositionAttribute, 4, gl.FLOAT, false, 0, 0);

  // aTextureCoord
  gl.enableVertexAttribArray(blit_texCoordAttribute);
  gl.bindBuffer(gl.ARRAY_BUFFER, n64UVBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvs), gl.STATIC_DRAW);
  gl.vertexAttribPointer(blit_texCoordAttribute, 2, gl.FLOAT, false, 0, 0);

  // uSampler
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.uniform1i(blit_uSampler, 0);

  gl.disable(gl.CULL_FACE);
  gl.disable(gl.BLEND);
  gl.disable(gl.DEPTH_TEST);
  gl.depthMask(false);

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function initDepth() {
  // TODO: decal mode.
  //if (gRDPOtherMode.zmode == ZMODE_DEC) ...

  // Disable depth testing
  var zgeom_mode = (state.geometryMode.zbuffer) !== 0;
  var zcmp_rendermode = (state.rdpOtherModeL & gbi.RenderMode.Z_CMP) !== 0;
  var zupd_rendermode = (state.rdpOtherModeL & gbi.RenderMode.Z_UPD) !== 0;

  if ((zgeom_mode && zcmp_rendermode) || zupd_rendermode) {
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
  } else {
    gl.disable(gl.DEPTH_TEST);
  }

  gl.depthMask(zupd_rendermode);
}

// A lot of functions are common between all ucodes
// TOOD(hulkholden): Make this a Map?
const ucode_common = {
  0xe4: executeTexRect,
  0xe5: executeTexRectFlip,
  0xe6: executeRDPLoadSync,
  0xe7: executeRDPPipeSync,
  0xe8: executeRDPTileSync,
  0xe9: executeRDPFullSync,
  0xea: executeSetKeyGB,
  0xeb: executeSetKeyR,
  0xec: executeSetConvert,
  0xed: executeSetScissor,
  0xee: executeSetPrimDepth,
  0xef: executeSetRDPOtherMode,
  0xf0: executeLoadTLut,
  0xf2: executeSetTileSize,
  0xf3: executeLoadBlock,
  0xf4: executeLoadTile,
  0xf5: executeSetTile,
  0xf6: executeFillRect,
  0xf7: executeSetFillColor,
  0xf8: executeSetFogColor,
  0xf9: executeSetBlendColor,
  0xfa: executeSetPrimColor,
  0xfb: executeSetEnvColor,
  0xfc: executeSetCombine,
  0xfd: executeSetTImg,
  0xfe: executeSetZImg,
  0xff: executeSetCImg
};

const ucode_gbi0 = {
  0x00: executeGBI1_SpNoop,
  0x01: executeGBI1_Matrix,
  0x03: executeGBI1_MoveMem,
  0x04: executeGBI0_Vertex,
  0x06: executeGBI1_DL,
  0x09: executeGBI1_Sprite2DBase,

  0xb0: executeGBI1_BranchZ, // GBI1 only?
  0xb1: executeGBI1_Tri2, // GBI1 only?
  0xb2: executeGBI1_RDPHalf_Cont,
  0xb3: executeGBI1_RDPHalf_2,
  0xb4: executeGBI1_RDPHalf_1,
  0xb5: executeGBI1_Line3D,
  0xb6: executeGBI1_ClrGeometryMode,
  0xb7: executeGBI1_SetGeometryMode,
  0xb8: executeGBI1_EndDL,
  0xb9: executeGBI1_SetOtherModeL,
  0xba: executeGBI1_SetOtherModeH,
  0xbb: executeGBI1_Texture,
  0xbc: executeGBI1_MoveWord,
  0xbd: executeGBI1_PopMatrix,
  0xbe: executeGBI1_CullDL,
  0xbf: executeGBI1_Tri1,
  0xc0: executeGBI1_Noop
};

const ucode_gbi1 = {
  0x00: executeGBI1_SpNoop,
  0x01: executeGBI1_Matrix,
  0x03: executeGBI1_MoveMem,
  0x04: executeGBI1_Vertex,
  0x06: executeGBI1_DL,
  0x09: executeGBI1_Sprite2DBase,

  0xb0: executeGBI1_BranchZ,
  0xb1: executeGBI1_Tri2,
  0xb2: executeGBI1_ModifyVtx,
  0xb3: executeGBI1_RDPHalf_2,
  0xb4: executeGBI1_RDPHalf_1,
  0xb5: executeGBI1_Line3D,
  0xb6: executeGBI1_ClrGeometryMode,
  0xb7: executeGBI1_SetGeometryMode,
  0xb8: executeGBI1_EndDL,
  0xb9: executeGBI1_SetOtherModeL,
  0xba: executeGBI1_SetOtherModeH,
  0xbb: executeGBI1_Texture,
  0xbc: executeGBI1_MoveWord,
  0xbd: executeGBI1_PopMatrix,
  0xbe: executeGBI1_CullDL,
  0xbf: executeGBI1_Tri1,
  0xc0: executeGBI1_Noop
};

const ucode_gbi2 = {
  0x00: executeGBI2_Noop,
  0x01: executeGBI2_Vertex,
  0x02: executeGBI2_ModifyVtx,
  0x03: executeGBI2_CullDL,
  0x04: executeGBI2_BranchZ,
  0x05: executeGBI2_Tri1,
  0x06: executeGBI2_Tri2,
  0x07: executeGBI2_Quad,
  0x08: executeGBI2_Line3D,
  0x09: executeGBI2_BgRect1Cyc,
  0x0a: executeGBI2_BgRectCopy,
  0x0b: executeGBI2_ObjRenderMode,

  // 0xd3: executeGBI2_Special1,
  // 0xd4: executeGBI2_Special2,
  // 0xd5: executeGBI2_Special3,
  0xd6: executeGBI2_DmaIo,
  0xd7: executeGBI2_Texture,
  0xd8: executeGBI2_PopMatrix,
  0xd9: executeGBI2_GeometryMode,
  0xda: executeGBI2_Matrix,
  0xdb: executeGBI2_MoveWord,
  0xdc: executeGBI2_MoveMem,
  0xdd: executeGBI2_LoadUcode,
  0xde: executeGBI2_DL,
  0xdf: executeGBI2_EndDL,

  0xe0: executeGBI2_SpNoop,
  0xe1: executeGBI2_RDPHalf_1,
  0xe2: executeGBI2_SetOtherModeL,
  0xe3: executeGBI2_SetOtherModeH,

  0xf1: executeGBI2_RDPHalf_2
};

function executeGBI2_Noop(cmd0, cmd1, dis) {
  if (dis) {
    dis.text('gsDPNoOp();');
  }
}

function executeGBI2_Vertex(cmd0, cmd1, dis) {
  var vend = ((cmd0) & 0xff) >> 1;
  var n = (cmd0 >>> 12) & 0xff;
  var v0 = vend - n;
  var address = rdpSegmentAddress(cmd1);

  if (dis) {
    dis.text(`gsSPVertex(${toString32(address)}, ${n}, ${v0});`);
  }

  executeVertexImpl(v0, n, address, dis);
}

function executeGBI2_ModifyVtx(cmd0, cmd1, dis) {
  var vtx = (cmd0 >>> 1) & 0x7fff;
  var offset = (cmd0 >>> 16) & 0xff;
  var value = cmd1;

  if (dis) {
    dis.text(`gsSPModifyVertex(${vtx},${gbi.ModifyVtx.nameOf(offset)},${toString32(value)});`);
  }

  // Cures crash after swinging in Mario Golf
  if (vtx >= state.projectedVertices.length) {
    hleHalt('crazy vertex index');
    return;
  }

  var vertex = state.projectedVertices[vtx];

  switch (offset) {
    case gbi.ModifyVtx.G_MWO_POINT_RGBA:
      hleHalt('unhandled modifyVtx');
      break;

    case gbi.ModifyVtx.G_MWO_POINT_ST:
      // u/v are signed
      var u = (value >> 16);
      var v = ((value & 0xffff) << 16) >> 16;
      vertex.set = true;
      vertex.u = u * state.texture.scaleS / 32.0;
      vertex.v = v * state.texture.scaleT / 32.0;
      break;

    case gbi.ModifyVtx.G_MWO_POINT_XYSCREEN:
      hleHalt('unhandled modifyVtx');
      break;

    case gbi.ModifyVtx.G_MWO_POINT_ZSCREEN:
      hleHalt('unhandled modifyVtx');
      break;

    default:
      hleHalt('unhandled modifyVtx');
      break;
  }
}

function executeGBI2_CullDL(cmd0, cmd1, dis) {
  // Same imple as GBI1.
  executeGBI1_CullDL(cmd0, cmd1, dis);
}

function executeGBI2_BranchZ(cmd0, cmd1, dis) {
  logUnimplemented('executeGBI2_BranchZ')
}

function executeGBI2_Tri1(cmd0, cmd1, dis) {
  const kTriCommand = cmd0 >>> 24;
  const verts = state.projectedVertices;

  let numTris = 0;
  let pc = state.pc;
  do {
    const v0idx = (cmd0 >>> 1) & 0x7f;
    const v1idx = (cmd0 >>> 9) & 0x7f;
    const v2idx = (cmd0 >>> 17) & 0x7f;
    const flag = (cmd1 >>> 24) & 0xff;

    if (dis) {
      dis.text(`gsSP1Triangle(${v0idx},${v1idx},${v2idx}, ${flag});`);
    }

    triangleBuffer.pushTri(verts[v0idx], verts[v1idx], verts[v2idx], numTris);
    numTris++;

    cmd0 = ram_dv.getUint32(pc + 0);
    cmd1 = ram_dv.getUint32(pc + 4);
    ++debugCurrentOp;
    pc += 8;

    // NB: process triangles individually when disassembling
  } while ((cmd0 >>> 24) === kTriCommand && numTris < kMaxTris && !dis);

  state.pc = pc - 8;
  --debugCurrentOp;

  flushTris(numTris);
}

function executeGBI2_Tri2(cmd0, cmd1, dis) {
  const kTriCommand = cmd0 >>> 24;
  const verts = state.projectedVertices;

  let numTris = 0;
  let pc = state.pc;
  do {
    const v00idx = (cmd1 >>> 1) & 0x7f;
    const v01idx = (cmd1 >>> 9) & 0x7f;
    const v02idx = (cmd1 >>> 17) & 0x7f;
    const v10idx = (cmd0 >>> 1) & 0x7f;
    const v11idx = (cmd0 >>> 9) & 0x7f;
    const v12idx = (cmd0 >>> 17) & 0x7f;

    if (dis) {
      dis.text(`gsSP2Triangles(${v00idx},${v01idx},${v02idx}, ${v10idx},${v11idx},${v12idx});`);
    }

    triangleBuffer.pushTri(verts[v00idx], verts[v01idx], verts[v02idx], numTris + 0);
    triangleBuffer.pushTri(verts[v10idx], verts[v11idx], verts[v12idx], numTris + 1);
    numTris += 2;

    cmd0 = ram_dv.getUint32(pc + 0);
    cmd1 = ram_dv.getUint32(pc + 4);
    ++debugCurrentOp;
    pc += 8;
    // NB: process triangles individually when disassembling
  } while ((cmd0 >>> 24) === kTriCommand && numTris < kMaxTris && !dis);

  state.pc = pc - 8;
  --debugCurrentOp;

  flushTris(numTris);
}

// TODO: this is effectively the same as executeGBI2_Tri2, just different disassembly.
function executeGBI2_Quad(cmd0, cmd1, dis) {
  const kTriCommand = cmd0 >>> 24;
  const verts = state.projectedVertices;

  let numTris = 0;
  let pc = state.pc;
  do {
    const v00idx = (cmd1 >>> 1) & 0x7f;
    const v01idx = (cmd1 >>> 9) & 0x7f;
    const v02idx = (cmd1 >>> 17) & 0x7f;
    const v10idx = (cmd0 >>> 1) & 0x7f;
    const v11idx = (cmd0 >>> 9) & 0x7f;
    const v12idx = (cmd0 >>> 17) & 0x7f;

    if (dis) {
      dis.text(`gSP1Quadrangle(${v00idx},${v01idx},${v02idx}, ${v10idx},${v11idx},${v12idx});`);
    }

    triangleBuffer.pushTri(verts[v00idx], verts[v01idx], verts[v02idx], numTris + 0);
    triangleBuffer.pushTri(verts[v10idx], verts[v11idx], verts[v12idx], numTris + 1);
    numTris += 2;

    cmd0 = ram_dv.getUint32(pc + 0);
    cmd1 = ram_dv.getUint32(pc + 4);
    ++debugCurrentOp;
    pc += 8;
    // NB: process triangles individually when disassembling
  } while ((cmd0 >>> 24) === kTriCommand && numTris < kMaxTris && !dis);

  state.pc = pc - 8;
  --debugCurrentOp;

  flushTris(numTris);
}

function executeGBI2_Line3D(cmd0, cmd1, dis) {
  logUnimplemented('executeGBI2_Line3D');

  if (dis) {
    dis.text(`gsSPLine3D(/* TODO */);`);
  }
}

function executeGBI2_BgRect1Cyc(cmd0, cmd1, dis) {
  logUnimplemented('executeGBI2_BgRect1Cyc');

  if (dis) {
    dis.text(`gsSPBgRect1Cyc(/* TODO */);`);
  }
}

function executeGBI2_BgRectCopy(cmd0, cmd1, dis) {
  logUnimplemented('executeGBI2_BgRectCopy');

  if (dis) {
    dis.text(`gsSPBgRectCopy(/* TODO */);`);
  }
}

function executeGBI2_ObjRenderMode(cmd0, cmd1, dis) {
  logUnimplemented('executeGBI2_ObjRenderMode');

  if (dis) {
    dis.text(`gsSPObjRenderMode(/* TODO */);`);
  }
}

function executeGBI2_DmaIo(cmd0, cmd1, dis) {
  // No-op?

  if (dis) {
    dis.text(`DmaIo(/* TODO */);`);
  }
}

function executeGBI2_Texture(cmd0, cmd1, dis) {
  var xparam = (cmd0 >>> 16) & 0xff;
  var level = (cmd0 >>> 11) & 0x3;
  var tileIdx = (cmd0 >>> 8) & 0x7;
  var on = (cmd0 >>> 1) & 0x01; // NB: uses bit 1
  var s = calcTextureScale(((cmd1 >>> 16) & 0xffff));
  var t = calcTextureScale(((cmd1 >>> 0) & 0xffff));

  if (dis) {
    var s_text = s.toString();
    var t_text = t.toString();
    var tt = gbi.getTileText(tileIdx);

    if (xparam !== 0) {
      dis.text(`gsSPTextureL(${s_text}, ${t_text}, ${level}, ${xparam}, ${tt}, ${on});`);
    } else {
      dis.text(`gsSPTexture(${s_text}, ${t_text}, ${level}, ${tt}, ${on});`);
    }
  }

  state.setTexture(s, t, level, tileIdx);
  if (on) {
    state.geometryModeBits |= gbi.GeometryModeGBI2.G_TEXTURE_ENABLE;
  } else {
    state.geometryModeBits &= ~gbi.GeometryModeGBI2.G_TEXTURE_ENABLE;
  }
  state.updateGeometryModeFromBits(gbi.GeometryModeGBI2);
}

function executeGBI2_GeometryMode(cmd0, cmd1, dis) {
  var arg0 = cmd0 & 0x00ffffff;
  var arg1 = cmd1;

  if (dis) {
    const clr = gbi.getGeometryModeFlagsText(gbi.GeometryModeGBI2, ~arg0)
    const set = gbi.getGeometryModeFlagsText(gbi.GeometryModeGBI2, arg1);
    dis.text(`gsSPGeometryMode(~(${clr}),${set});`);
  }

  // Texture enablement is controlled via gsSPTexture, so ignore this.
  state.geometryModeBits &= (arg0 | gbi.GeometryModeGBI2.G_TEXTURE_ENABLE);
  state.geometryModeBits |= (arg1 & ~gbi.GeometryModeGBI2.G_TEXTURE_ENABLE);

  state.updateGeometryModeFromBits(gbi.GeometryModeGBI2);
}

function executeGBI2_Matrix(cmd0, cmd1, dis) {
  var address = rdpSegmentAddress(cmd1);
  var push = ((cmd0) & 0x1) === 0;
  var replace = (cmd0 >>> 1) & 0x1;
  var projection = (cmd0 >>> 2) & 0x1;

  var matrix = loadMatrix(address);

  if (dis) {
    var t = '';
    t += projection ? 'G_MTX_PROJECTION' : 'G_MTX_MODELVIEW';
    t += replace ? '|G_MTX_LOAD' : '|G_MTX_MUL';
    t += push ? '|G_MTX_PUSH' : ''; //'|G_MTX_NOPUSH';

    dis.text(`gsSPMatrix(${toString32(address)}, ${t});`);
    dis.tip(previewMatrix(matrix));
  }

  var stack = projection ? state.projection : state.modelview;

  if (!replace) {
    matrix = stack[stack.length - 1].multiply(matrix);
  }

  if (push) {
    stack.push(matrix);
  } else {
    stack[stack.length - 1] = matrix;
  }
}

function executeGBI2_PopMatrix(cmd0, cmd1, dis) {
  // FIXME: not sure what bit this is
  //var projection =  ??;
  var projection = 0;

  if (dis) {
    const t = projection ? 'G_MTX_PROJECTION' : 'G_MTX_MODELVIEW';
    dis.text(`gsSPPopMatrix(${t});`);
  }

  var stack = projection ? state.projection : state.modelview;
  if (stack.length > 0) {
    stack.pop();
  }
}

function executeGBI2_MoveWord(cmd0, cmd1, dis) {
  var type = (cmd0 >>> 16) & 0xff;
  var offset = (cmd0) & 0xffff;
  var value = cmd1;

  if (dis) {
    var text = `gMoveWd(${gbi.MoveWord.nameOf(type)}, ${toString16(offset)}, ${toString32(value)});`;

    switch (type) {
      case gbi.MoveWord.G_MW_NUMLIGHT:
        {
          let v = Math.floor(value / 24);
          text = `gsSPNumLights(${gbi.NumLights.nameOf(v)});`;
        }
        break;
      case gbi.MoveWord.G_MW_SEGMENT:
        {
          let v = value === 0 ? '0' : toString32(value);
          text = `gsSPSegment(${(offset >>> 2) & 0xf}, ${v});`;
        }
        break;
    }
    dis.text(text);
  }

  switch (type) {
    // case gbi.MoveWord.G_MW_MATRIX:  unimplemented(cmd0,cmd1); break;
    case gbi.MoveWord.G_MW_NUMLIGHT:
      state.numLights = Math.floor(value / 24);
      break;
    case gbi.MoveWord.G_MW_CLIP:
      /*unimplemented(cmd0,cmd1);*/ break;
    case gbi.MoveWord.G_MW_SEGMENT:
      state.segments[((offset >>> 2) & 0xf)] = value;
      break;
    case gbi.MoveWord.G_MW_FOG:
      /*unimplemented(cmd0,cmd1);*/ break;
    case gbi.MoveWord.G_MW_LIGHTCOL:
      /*unimplemented(cmd0,cmd1);*/ break;
    // case gbi.MoveWord.G_MW_POINTS:    unimplemented(cmd0,cmd1); break;
    case gbi.MoveWord.G_MW_PERSPNORM:
      /*unimplemented(cmd0,cmd1);*/ break;
    default:
      haltUnimplemented(cmd0, cmd1);
      break;
  }
}

function previewGBI2_MoveMem(type, length, address, dis) {
  let tip = '';
  for (let i = 0; i < length; i += 4) {
    tip += toHex(ram_dv.getUint32(address + i), 32) + ' ';
  }
  tip += '<br>';

  switch (type) {
    case gbi.MoveMemGBI2.G_GBI2_MV_VIEWPORT:
      tip += previewViewport(address);
      break;
    case gbi.MoveMemGBI2.G_GBI2_MV_LIGHT:
      tip += previewLight(address);
      break;
  }

  dis.tip(tip);
}

function executeGBI2_MoveMem(cmd0, cmd1, dis) {
  const address = rdpSegmentAddress(cmd1);
  const length = ((cmd0 >>> 16) & 0xff) << 1;
  const offset = ((cmd0 >>> 8) & 0xff) << 3;
  const type = cmd0 & 0xfe;

  let text;
  if (dis) {
    text = `gsDma1p(G_MOVEMEM, ${toString32(address)}, ${length}, ${offset}, ${gbi.MoveMemGBI2.nameOf(type)});`;
  }

  switch (type) {
    case gbi.MoveMemGBI2.G_GBI2_MV_VIEWPORT:
      if (dis) { text = `gsSPViewport(${toString32(address)});`; }
      moveMemViewport(address);
      break;
    case gbi.MoveMemGBI2.G_GBI2_MV_LIGHT:
      {
        if (offset == gbi.MoveMemGBI2.G_GBI2_MVO_LOOKATX) {
          if (dis) { text = `gSPLookAtX(${toString32(address)});`; }
          // TODO
        } else if (offset == gbi.MoveMemGBI2.G_GBI2_MVO_LOOKATY) {
          if (dis) { text = `gSPLookAtY(${toString32(address)});`; }
          // TODO
        } else if (offset >= gbi.MoveMemGBI2.G_GBI2_MVO_L0 && offset <= gbi.MoveMemGBI2.G_GBI2_MVO_L7) {
          let lightIdx = ((offset - gbi.MoveMemGBI2.G_GBI2_MVO_L0) / 24) >>> 0;
          if (dis) { text = `gsSPLight(${toString32(address)}, ${lightIdx})`; }
          moveMemLight(lightIdx, address);
          if (length != 16) {
            console.log(`unexpected gsSPLight length ${length}. Is this setting multiple lights?`);
          }
        } else {
          if (dis) { text += ` // (unknown offset ${toString16(offset)})`; }
        }
      }
      break;
    case gbi.MoveMemGBI2.G_GBI2_MV_POINT:
      hleHalt(`unhandled movemem G_GBI2_MV_POINT: ${type.toString(16)}`);
      break;
    case gbi.MoveMemGBI2.G_GBI2_MV_MATRIX:
      hleHalt(`unhandled movemem G_GBI2_MV_MATRIX: ${type.toString(16)}`);
      break;

    default:
      hleHalt(`unknown movemem: ${type.toString(16)}`);
  }

  if (dis) {
    dis.text(text);
    previewGBI2_MoveMem(type, length, address, dis);
  }
}

function executeGBI2_LoadUcode(cmd0, cmd1, dis) {
  logUnimplemented('executeGBI2_LoadUcode');
}

function executeGBI2_DL(cmd0, cmd1, dis) {
  var param = (cmd0 >>> 16) & 0xff;
  var address = rdpSegmentAddress(cmd1);

  if (dis) {
    var fn = (param === gbi.G_DL_PUSH) ? 'gsSPDisplayList' : 'gsSPBranchList';
    dis.text(`${fn}(<span class="dl-branch">${toString32(address)}</span>);`);
  }

  if (param === gbi.G_DL_PUSH) {
    state.dlistStack.push({ pc: state.pc });
  }
  state.pc = address;
}

function executeGBI2_EndDL(cmd0, cmd1, dis) {
  if (dis) {
    dis.text('gsSPEndDisplayList();');
  }

  if (state.dlistStack.length > 0) {
    state.pc = state.dlistStack.pop().pc;
  } else {
    state.pc = 0;
  }
}

function executeGBI2_SetOtherModeL(cmd0, cmd1, dis) {
  var shift = (cmd0 >>> 8) & 0xff;
  var len = (cmd0 >>> 0) & 0xff;
  var data = cmd1;
  var mask = (0x80000000 >> len) >>> shift;
  if (dis) {
    disassemble.SetOtherModeL(dis, mask, data);
  }
  state.rdpOtherModeL = (state.rdpOtherModeL & ~mask) | data;
}

function executeGBI2_SetOtherModeH(cmd0, cmd1, dis) {
  var shift = (cmd0 >>> 8) & 0xff;
  var len = (cmd0 >>> 0) & 0xff;
  var data = cmd1;
  var mask = (0x80000000 >> len) >>> shift;
  if (dis) {
    disassemble.SetOtherModeH(dis, mask, len, shift, data);
  }
  state.rdpOtherModeH = (state.rdpOtherModeH & ~mask) | data;
}

function executeGBI2_SpNoop(cmd0, cmd1, dis) {
  // No-op.
}

function executeGBI2_RDPHalf_1(cmd0, cmd1, dis) {
  if (dis) {
    dis.text(`gsImmp1(G_RDPHALF_1, ${toString32(cmd1)});`);
  }
  state.rdpHalf1 = cmd1;
}

function executeGBI2_RDPHalf_2(cmd0, cmd1, dis) {
  if (dis) {
    dis.text(`gsImmp1(G_RDPHALF_2, ${toString32(cmd1)});`);
  }
  state.rdpHalf2 = cmd1;
}

// var ucode_sprite2d = {
//   0xbe: executeSprite2dScaleFlip,
//   0xbd: executeSprite2dDraw
// };

// var ucode_dkr = {
//   0x05:  executeDMATri,
//   0x07:  executeGBI1_DLInMem,
// };

function buildUCodeTables(ucode) {
  var ucode_table = ucode_gbi0;

  switch (ucode) {
    case kUCode_GBI0:
    case kUCode_GBI0_WR:
    case kUCode_GBI0_DKR:
    case kUCode_GBI0_SE:
    case kUCode_GBI0_GE:
    case kUCode_GBI0_PD:
      ucode_table = ucode_gbi0;
      break;
    case kUCode_GBI1:
    case kUCode_GBI1_LL:
      ucode_table = ucode_gbi1;
      break;
    case kUCode_GBI2:
    case kUCode_GBI2_CONKER:
      ucode_table = ucode_gbi2;
      break;
    default:
      logger.log(`unhandled ucode during table init: ${ucode}`);
  }

  // Build a copy of the table as an array
  var table = [];
  for (var i = 0; i < 256; ++i) {
    var fn = executeUnknown;
    if (ucode_table.hasOwnProperty(i)) {
      fn = ucode_table[i];
    } else if (ucode_common.hasOwnProperty(i)) {
      fn = ucode_common[i];
    }
    table.push(fn);
  }

  // Patch in specific overrides
  switch (ucode) {
    case kUCode_GBI0_WR:
      table[0x04] = executeVertex_GBI0_WR;
      break;
    case kUCode_GBI0_GE:
      table[0xb1] = executeTri4_GBI0;
      table[0xb2] = executeGBI1_SpNoop; // FIXME
      table[0xb4] = executeGBI1_SpNoop; // FIXME - DLParser_RDPHalf1_GoldenEye;
      break;
  }

  return table;
}

let numDisplayListsRendered = 0;

export function presentBackBuffer() {
  n64js.onPresent();

  if (numDisplayListsRendered !== 0) {
    copyBackBufferToFrontBuffer(frameBufferTexture3D);
    return;
  }

  // If no display lists executed, interpret framebuffer as bytes
  initViScales();    // resize canvas to match VI res.

  const vi = n64js.hardware().viRegDevice;
  const pixels = vi.renderBackBuffer();
  if (!pixels) {
    return;
  }
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, frameBufferTexture2D);

  if (vi.is32BitMode) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, vi.screenWidth, vi.screenHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  } else if (vi.is16BitMode) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, vi.screenWidth, vi.screenHeight, 0, gl.RGBA, gl.UNSIGNED_SHORT_5_5_5_1, pixels);
  } else {
    // Invalid mode.
  }

  copyBackBufferToFrontBuffer(frameBufferTexture2D);
}

function initViScales() {
  const vi = n64js.hardware().viRegDevice;
  const dims = vi.computeDimensions();
  if (!dims) {
    return;
  }

  nativeTransform.initDimensions(dims.srcWidth, dims.srcHeight);

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
    const pc_str = ' '; //  ` [${toHex(pc, 32)}] `

    this.$span = $(`<span class="hle-instr" id="I${this.numOps}" />`);
    this.$span.append(`${padString(this.numOps, 5)}${pc_str}${toHex(cmd0, 32)}${toHex(cmd1, 32)} ${indent}`);
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
}


function buildStateTab() {
  var $table = $('<table class="table table-condensed dl-debug-table" style="width: auto;"></table>');
  var $tr = $('<tr />');

  for (let i in state.geometryMode) {
    if (state.geometryMode.hasOwnProperty(i)) {
      var $td = $(`<td>${i}</td>`);
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
  var l = state.rdpOtherModeL;
  var h = state.rdpOtherModeH;
  const vals = new Map([
    //var G_MDSFT_BLENDMASK = 0;
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

  var $table = $('<table class="table table-condensed dl-debug-table" style="width: auto;"></table>');
  for (let [name, value] of vals) {
    let $tr = $(`<tr><td>${name}</td><td>${value}</td></tr>`);
    $table.append($tr);
  }
  return $table;
}

function buildColorsTable() {
  const colors = [
    'fillColor',
    'envColor',
    'primColor',
    'blendColor',
    'fogColor',
  ];

  var $table = $('<table class="table table-condensed dl-debug-table" style="width: auto;"></table>');
  for (let color of colors) {
    let row = $(`<tr><td>${color}</td><td>${makeColorTextRGBA(state[color])}</td></tr>`);
    $table.append(row);
  }
  return $table;
}

function buildCombinerTab() {
  var $p = $('<pre class="combine"></pre>');
  $p.append(gbi.CycleType.nameOf(state.getCycleType()) + '\n');
  $p.append(buildColorsTable());
  $p.append(shaders.getCombinerText(state.combine.hi, state.combine.lo));
  return $p;
}

function buildTexture(tileIdx) {
  var texture = lookupTexture(tileIdx);
  if (texture) {
    const kScale = 8;
    return texture.createScaledCanvas(kScale);
  }
}

function buildTexturesTab() {
  var $d = $('<div />');
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
  const tile_fields = [
    'tile #',
    'format',
    'size',
    'line',
    'tmem',
    'palette',
    'cm_s',
    'mask_s',
    'shift_s',
    'cm_t',
    'mask_t',
    'shift_t',
    'left',
    'top',
    'right',
    'bottom',
    'width',
    'height',
    'unmasked w',
    'unmasked h',
  ];

  var $table = $('<table class="table table-condensed dl-debug-table" style="width: auto"></table>');
  var $tr = $(`<tr><th>${tile_fields.join('</th><th>')}</th></tr>`);
  $table.append($tr);

  for (let tileIdx = 0; tileIdx < state.tiles.length; ++tileIdx) {
    var tile = state.tiles[tileIdx];

    // Ignore any tiles that haven't been set up.
    if (tile.format === -1) {
      continue;
    }

    var vals = [];
    vals.push(gbi.getTileText(tileIdx));
    vals.push(gbi.ImageFormat.nameOf(tile.format));
    vals.push(gbi.ImageSize.nameOf(tile.size));
    vals.push(tile.line);
    vals.push(tile.tmem);
    vals.push(tile.palette);
    vals.push(gbi.getClampMirrorWrapText(tile.cm_s));
    vals.push(tile.mask_s);
    vals.push(tile.shift_s);
    vals.push(gbi.getClampMirrorWrapText(tile.cm_t));
    vals.push(tile.mask_t);
    vals.push(tile.shift_t);
    vals.push(tile.left);
    vals.push(tile.top);
    vals.push(tile.right);
    vals.push(tile.bottom);
    vals.push(tile.width);
    vals.push(tile.height);
    vals.push(tile.unmaskedWidth);
    vals.push(tile.unmaskedHeight);

    $tr = $(`<tr><td>${vals.join('</td><td>')}</td></tr>`);
    $table.append($tr);
  }

  return $table;
}

function buildVerticesTab() {
  const vtx_fields = [
    'vtx #',
    'x',
    'y',
    'z',
    'px',
    'py',
    'pz',
    'pw',
    'color',
    'u',
    'v'
  ];

  var $table = $('<table class="table table-condensed dl-debug-table" style="width: auto"></table>');
  var $tr = $(`<tr><th>${vtx_fields.join('</th><th>')}</th></tr>`);
  $table.append($tr);

  for (let i = 0; i < state.projectedVertices.length; ++i) {
    var vtx = state.projectedVertices[i];
    if (!vtx.set) {
      continue;
    }

    var x = vtx.pos.x / vtx.pos.w;
    var y = vtx.pos.y / vtx.pos.w;
    var z = vtx.pos.z / vtx.pos.w;

    var vals = [];
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

    $tr = $(`<tr><td>${vals.join('</td><td>')}</td></tr>`);
    $table.append($tr);
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

function showDebugDisplayListUI() {
  $('.debug').show();
  $('#dlist-tab').tab('show');
}

function hideDebugDisplayListUI() {
  $('.debug').hide();
}

export function toggleDebugDisplayList() {
  if (debugDisplayListRunning) {
    hideDebugDisplayListUI();
    debugBailAfter = -1;
    debugDisplayListRunning = false;
    n64js.toggleRun();
  } else {
    showDebugDisplayListUI();
    debugDisplayListRequested = true;
  }
}

// This is called repeatedly so that we can update the UI.
// We can return false if we don't render anything, but it's useful to keep re-rendering so that we can plot a framerate graph
export function debugDisplayList() {
  if (debugStateTimeShown == -1) {
    // Build some disassembly for this display list
    var disassembler = new Disassembler();
    processDList(debugLastTask, disassembler, -1);
    disassembler.finalise();

    // Update the scrubber based on the new length of disassembly
    debugNumOps = disassembler.numOps > 0 ? (disassembler.numOps - 1) : 0;
    setScrubRange(debugNumOps);

    // If debugBailAfter hasn't been set (e.g. by hleHalt), stop at the end of the list
    var time_to_show = (debugBailAfter == -1) ? debugNumOps : debugBailAfter;
    setScrubTime(time_to_show);
  }

  // Replay the last display list using the captured task/ram
  processDList(debugLastTask, null, debugBailAfter);

  // Only update the state display when needed, otherwise it's impossible to
  // debug the dom in Chrome
  if (debugStateTimeShown !== debugBailAfter) {
    updateStateUI();
    debugStateTimeShown = debugBailAfter;
  }

  return true;
}

export function hleGraphics(task) {
  // Bodgily track these parameters so that we can call again with the same params.
  debugLastTask = task;

  // Force the cpu to stop at the point that we render the display list.
  if (debugDisplayListRequested) {
    debugDisplayListRequested = false;

    // Finally, break execution so we can keep replaying the display list
    // before any other state changes.
    n64js.breakEmulationForDisplayListDebug();

    debugStateTimeShown = -1;
    debugDisplayListRunning = true;
  }

  processDList(task, null, -1);
}

const ucodeOverrides = new Map([
  [0x60256efc, kUCode_GBI2_CONKER],	// "RSP Gfx ucode F3DEXBG.NoN fifo 2.08  Yoshitaka Yasumoto 1999 Nintendo.", "Conker's Bad Fur Day"
  [0x6d8bec3e, kUCode_GBI1_LL],	// "Dark Rift"
  [0x0c10181a, kUCode_GBI0_DKR],	// "Diddy Kong Racing (v1.0)"
  [0x713311dc, kUCode_GBI0_DKR],	// "Diddy Kong Racing (v1.1)"
  [0x23f92542, kUCode_GBI0_GE],	// "RSP SW Version: 2.0G, 09-30-96", "GoldenEye 007"
  [0x169dcc9d, kUCode_GBI0_DKR],	// "Jet Force Gemini"											
  [0x26da8a4c, kUCode_GBI1_LL],	// "Last Legion UX"				
  [0xcac47dc4, kUCode_GBI0_PD],	// "Perfect Dark (v1.1)"
  [0x6cbb521d, kUCode_GBI0_SE],	// "RSP SW Version: 2.0D, 04-01-96", "Star Wars - Shadows of the Empire (v1.0)"
  [0xdd560323, kUCode_GBI1_LL],	// "Toukon Road - Brave Spirits"				
  [0x64cc729d, kUCode_GBI0_WR],	// "RSP SW Version: 2.0D, 04-01-96", "Wave Race 64"

  [0xd73a12c4, kUCode_GBI0], // Fish demo
  [0x313f038b, kUCode_GBI0], // Pilotwings
]);

function processDList(task, disassembler, bail_after) {
  // Update a counter to tell the video code that we've rendered something.
  numDisplayListsRendered++;
  if (!gl) {
    return;
  }

  const str = task.detectVersionString();
  const hash = task.computeMicrocodeHash();
  let ucode = ucodeOverrides.get(hash);
  if (ucode === undefined) {
    const prefixes = ['F3', 'L3', 'S2DEX'];
    let index = -1;
    for (let prefix of prefixes) {
      index = str.indexOf(prefix);
      if (index >= 0) {
        break;
      }
    }

    // Assume this is GBI0 unless we get a better match.
    ucode = kUCode_GBI0;
    if (index >= 0) {
      if (str.indexOf('fifo', index) >= 0 || str.indexOf('xbux', index) >= 0) {
        ucode = (str.indexOf('S2DEX') >= 0) ? kUCode_GBI2_SDEX : kUCode_GBI2;
      } else {
        ucode = (str.indexOf('S2DEX') >= 0) ? kUCode_GBI1_SDEX : kUCode_GBI1;
      }
    }
  }

  logMicrocode(str, ucode);

  var ram = getRamDataView();

  resetState(ucode, ram, task.data_ptr);
  var ucode_table = buildUCodeTables(ucode);

  // Render everything to the back buffer. This prevents horrible flickering
  // if due to webgl clearing our context between updates.
  gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuffer);

  initViScales();

  // Set the viewport to match the framebuffer dimensions.
  gl.viewport(0, 0, frameBuffer.width, frameBuffer.height);

  var pc, cmd0, cmd1;

  if (disassembler) {
    debugCurrentOp = 0;

    while (state.pc !== 0) {
      pc = state.pc;
      cmd0 = ram.getUint32(pc + 0);
      cmd1 = ram.getUint32(pc + 4);
      state.pc += 8;

      disassembler.begin(pc, cmd0, cmd1, state.dlistStack.length);
      ucode_table[cmd0 >>> 24](cmd0, cmd1, disassembler);
      disassembler.end();
      debugCurrentOp++;
    }
  } else {
    // Vanilla loop, no disassembler to worry about
    debugCurrentOp = 0;
    while (state.pc !== 0) {
      pc = state.pc;
      cmd0 = ram.getUint32(pc + 0);
      cmd1 = ram.getUint32(pc + 4);
      state.pc += 8;

      ucode_table[cmd0 >>> 24](cmd0, cmd1);

      if (bail_after > -1 && debugCurrentOp >= bail_after) {
        break;
      }
      debugCurrentOp++;
    }
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function resetState(ucode, ram, pc) {
  config.vertexStride = kUcodeStrides[ucode];
  ram_dv = ram; // FIXME: remove DataView
  state.reset(pc);
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
  debugBailAfter = t;
  setScrubText(debugBailAfter, debugNumOps);

  var $instr = $dlistOutput.find(`#I${debugBailAfter}`);

  $dlistOutput.scrollTop($dlistOutput.scrollTop() + $instr.position().top -
    $dlistOutput.height() / 2 + $instr.height() / 2);

  $dlistOutput.find('.hle-instr').removeAttr('style');
  $instr.css('background-color', 'rgb(255,255,204)');
}

function initDebugUI() {
  var $dlistControls = $dlistContent.find('#controls');

  debugBailAfter = -1;
  debugNumOps = 0;

  $dlistControls.find('#rwd').click(() => {
    if (debugDisplayListRunning && debugBailAfter > 0) {
      setScrubTime(debugBailAfter - 1);
    }
  });
  $dlistControls.find('#fwd').click(() => {
    if (debugDisplayListRunning && debugBailAfter < debugNumOps) {
      setScrubTime(debugBailAfter + 1);
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

export function initialiseRenderer($canvas) {
  initDebugUI();

  const canvas = $canvas[0];
  initWebGL(canvas); // Initialize the GL context

  // Only continue if WebGL is available and working
  if (!gl) {
    return;
  }

  frameBufferTexture2D = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, frameBufferTexture2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  // We call texImage2D to initialise frameBufferTexture2D with the correct dimensions when it's used.

  frameBuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuffer);
  frameBuffer.width = 640;
  frameBuffer.height = 480;

  // Create a texture for color data and attach to the framebuffer.
  frameBufferTexture3D = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, frameBufferTexture3D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, frameBuffer.width, frameBuffer.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, frameBufferTexture3D, 0);
  gl.bindTexture(gl.TEXTURE_2D, null);

  // Create a render buffer and attach to the framebuffer.
  var renderbuffer = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, frameBuffer.width, frameBuffer.height);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, renderbuffer);
  gl.bindRenderbuffer(gl.RENDERBUFFER, null);

  // Passing null binds the framebuffer to the canvas.
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  fillShaderProgram = shaders.createShaderProgram(gl, "fill-shader-vs", "fill-shader-fs");
  fill_vertexPositionAttribute = gl.getAttribLocation(fillShaderProgram, "aVertexPosition");
  fill_uFillColor = gl.getUniformLocation(fillShaderProgram, "uFillColor");

  blitShaderProgram = shaders.createShaderProgram(gl, "blit-shader-vs", "blit-shader-fs");
  blit_vertexPositionAttribute = gl.getAttribLocation(blitShaderProgram, "aVertexPosition");
  blit_texCoordAttribute = gl.getAttribLocation(blitShaderProgram, "aTextureCoord");
  blit_uSampler = gl.getUniformLocation(blitShaderProgram, "uSampler");

  rectVerticesBuffer = gl.createBuffer();
  n64PositionsBuffer = gl.createBuffer();
  n64ColorsBuffer = gl.createBuffer();
  n64UVBuffer = gl.createBuffer();

  nativeTransform = new NativeTransform();
}

export function resetRenderer() {
  textureCache.clear();
  $textureOutput.html('');
  ram_dv = getRamDataView();
}

function getCurrentN64Shader(cycle_type, enableAlphaThreshold) {
  var mux0 = state.combine.hi;
  var mux1 = state.combine.lo;

  return shaders.getOrCreateN64Shader(gl, mux0, mux1, cycle_type, enableAlphaThreshold);
}

/**
 * Looks up the texture defined at the specified tile index.
 * @param {number} tileIdx
 * @return {?Texture}
 */
function lookupTexture(tileIdx) {
  const tile = state.tiles[tileIdx];
  // Skip empty tiles - this is primarily for the debug ui.
  if (tile.line === 0) {
    return null;
  }

  // FIXME: we can cache this if tile/tmem state hasn't changed since the last draw call.
  const hash = state.tmem.calculateCRC(tile);

  // Check if the texture is already cached.
  // The cacheID should include all the state that can affect how the texture is constructed.
  const cacheID = `${toString32(hash)}_${tile.format}_${tile.size}_${tile.width}_${tile.height}_${tile.palette}`;
  if (textureCache.has(cacheID)) {
    return textureCache.get(cacheID);
  }
  const texture = decodeTexture(tile, state.getTextureLUTType(), cacheID);
  textureCache.set(cacheID, texture);
  return texture;
}

/**
 * Decodes the texture defined by the specified tile.
 * @param {!Tile} tile
 * @param {number} tlutFormat
 * @return {?Texture}
 */
function decodeTexture(tile, tlutFormat, cacheID) {
  var texture = new Texture(gl, tile.width, tile.height);
  if (!texture.$canvas[0].getContext) {
    return null;
  }

  $textureOutput.append(
    `${cacheID}: ${gbi.ImageFormat.nameOf(tile.format)}, ${gbi.ImageSize.nameOf(tile.size)},${tile.width}x${tile.height}, <br>`);

  var ctx = texture.$canvas[0].getContext('2d');
  var imgData = ctx.createImageData(texture.nativeWidth, texture.nativeHeight);

  var handled = convertTexels(imgData, state.tmem.tmemData, tile, tlutFormat);
  if (handled) {
    clampTexture(imgData, tile.width, tile.height);

    ctx.putImageData(imgData, 0, 0);

    $textureOutput.append(texture.$canvas);
    $textureOutput.append('<br>');
  } else {
    var msg = `${gbi.ImageFormat.nameOf(tile.format)}/${gbi.ImageSize.nameOf(tile.size)} is unhandled`;
    $textureOutput.append(msg);
    // FIXME: fill with placeholder texture
    hleHalt(msg);
  }

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture.texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, texture.$canvas[0]);

  gl.generateMipmap(gl.TEXTURE_2D);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return texture;
}

function hleHalt(msg) {
  if (!debugDisplayListRunning) {
    n64js.ui().displayWarning(msg);

    // Ensure the CPU emulation stops immediately
    n64js.breakEmulationForDisplayListDebug();

    // Ensure the ui is visible
    showDebugDisplayListUI();

    // We're already executing a display list, so clear the Requested flag, set Running
    debugDisplayListRequested = false;
    debugDisplayListRunning = true;

    // End set up the context
    debugBailAfter = debugCurrentOp;
    debugStateTimeShown = -1;
  }
}
