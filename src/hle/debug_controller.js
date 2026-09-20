/*global $, n64js*/

import { padString, toHex, toString32 } from '../format.js';
import { makeColorTextRGBA16, makeColorTextRGBA, makeColorTextABGR } from './disassemble.js';
import * as gbi from './gbi.js';
import * as shaders from './shaders.js';

// TODO: make fields.
let dlistScrub;
let dlistState;
let $dlistOutput;

// Which displaylist in the frame to stop on.
let dlFocusIndex = 0;
// Which type of displaylsit to focus on, e.g. S2DEX.
let dlFocusSubstr = '';

export class DebugController {
  constructor(state, processDList) {
    this.state = state;
    this.processDList = processDList;

    this.numOps = 0;
    this.bailAfter = -1;
    this.lastTask;  // The last task that we executed.
    this.stateTimeShown = -1;
    this.running = false;

    // Whether displaylist debugging has been requested.
    this.requested = false;

    // A counter that's incremented for every matching displaylist that's
    // rendered after being requested.
    this.dlFocusCounter = 0;
  }

  onNewTask(task) {
    // Bodgily track these parameters so that we can call again with the same params.
    this.lastTask = task;

    // Force the cpu to stop at the point that we render the display list.
    if (this.requested) {
      if (dlFocusSubstr == '' || task.detectVersionString().includes(dlFocusSubstr)) {
        if (this.dlFocusCounter == dlFocusIndex) {
          this.requested = false;

          // Finally, break execution so we can keep replaying the display list
          // before any other state changes.
          n64js.breakEmulationForDisplayListDebug();

          this.stateTimeShown = -1;
          this.running = true;
        }
        this.dlFocusCounter++;
      }
    } else {
      this.dlFocusCounter = 0;
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
    this.bailAfter = this.state.currentOp;
    this.stateTimeShown = -1;
  }

  debugDisplayList() {
    if (this.stateTimeShown == -1) {
      // Build some disassembly for this display list
      const disassembler = new Disassembler(this);
      this.processDList(this.lastTask, disassembler, -1);
      disassembler.finalise();

      // Update the scrubber based on the new length of disassembly
      this.numOps = disassembler.numOps > 0 ? (disassembler.numOps - 1) : 0;
      this.setScrubRange(this.numOps);

      // If this.bailAfter hasn't been set (e.g. by hleHalt), stop at the end of the list
      const timeToShow = (this.bailAfter == -1) ? this.numOps : this.bailAfter;
      this.setScrubTime(timeToShow);
    }

    // Replay the last display list using the captured task/ram
    this.processDList(this.lastTask, null, this.bailAfter);

    // Only update the state display when needed, otherwise it's impossible to
    // debug the dom in Chrome
    if (this.stateTimeShown !== this.bailAfter) {
      this.updateStateUI();
      this.stateTimeShown = this.bailAfter;
    }
  }

  updateStateUI() {
    dlistState.querySelector('#dl-geometrymode-content').replaceChildren(this.buildStateTab());
    dlistState.querySelector('#dl-vertices-content').replaceChildren(this.buildVerticesTab());
    dlistState.querySelector('#dl-tiles-content').replaceChildren(this.buildTilesTab());
    dlistState.querySelector('#dl-combiner-content').replaceChildren(this.buildCombinerTab());
    dlistState.querySelector('#dl-rdp-content').replaceChildren(this.buildRDPTab());
  }

  setScrubText(x, max) {
    dlistScrub.querySelector('.scrub-text').textContent = `uCode op ${x}/${max}.`;
  }

  setScrubRange(max) {
    const input = dlistScrub.querySelector('input');
    input.min = 0;
    input.max = max;
    input.value = max;
    this.setScrubText(max, max);
  }

  setScrubTime(t) {
    this.bailAfter = t;
    this.setScrubText(this.bailAfter, this.numOps);

    const $instr = $dlistOutput.find(`#I${this.bailAfter}`);

    $dlistOutput.scrollTop($dlistOutput.scrollTop() + $instr.position().top -
      $dlistOutput.height() / 2 + $instr.height() / 2);

    const cls = 'hle-cur-instr';
    $dlistOutput.find('.hle-instr').removeClass(cls);
    $instr.addClass(cls);
  }

  initUI() {
    const controls = document.querySelector('#dlist-content #controls');

    this.bailAfter = -1;
    this.numOps = 0;

    controls.querySelector('#rwd').addEventListener('click', () => {
      if (this.running && this.bailAfter > 0) {
        this.setScrubTime(this.bailAfter - 1);
      }
    });
    controls.querySelector('#fwd').addEventListener('click', () => {
      if (this.running && this.bailAfter < this.numOps) {
        this.setScrubTime(this.bailAfter + 1);
      }
    });
    controls.querySelector('#stop').addEventListener('click', () => {
      this.toggle();
    });

    dlistScrub = controls.querySelector('.scrub');
    dlistScrub.querySelector('input').addEventListener('change', event => {
      this.setScrubTime(event.currentTarget.value | 0);
    });
    this.setScrubRange(0);

    dlistState = document.querySelector('#dlist-content .hle-state');

    $dlistOutput = $('<div class="hle-disasm"></div>');
    $('#adjacent-debug').empty().append($dlistOutput);
  }

  showUI() {
    n64js.debugger().show();
    n64js.ui().showTab('dlist-tab');
  }

  hideUI() {
    n64js.debugger().hide();
  }

  setDisplayListOutput(output) {
    $dlistOutput.html(output);
    output.find('.dl-tip').parent().click(function () {
      $(this).find('.dl-tip').toggle();
    });
    // output.find('.dl-branch').click(function () {
    // });
  }

  buildStateTab() {
    const table = createDebugTable();
    const row = table.tBodies[0].insertRow();
    for (const [name, enabled] of Object.entries(this.state.geometryMode)) {
      const cell = row.insertCell();
      cell.textContent = name;
      cell.className = enabled ? 'dl-debug-geommode-enabled' : 'dl-debug-geommode-disabled';
    }
    return table;
  }

  buildRDPTab() {
    const l = this.state.rdpOtherModeL;
    const h = this.state.rdpOtherModeH;
    const ti = this.state.textureImage;

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
      ['', '\u00a0'],
      ['TI.format', gbi.ImageFormat.nameOf(ti.format)],
      ['TI.size', gbi.ImageSize.nameOf(ti.size)],
      ['TI.width', ti.width],
      ['TI.address', toString32(ti.address)],
    ]);

    const table = createDebugTable();
    for (const [name, value] of vals) {
      appendDebugRow(table, [name, value]);
    }
    return table;
  }

  buildColorsTable() {
    const colors = ['fillColor', 'envColor', 'primColor', 'blendColor', 'fogColor'];
    const table = createDebugTable();
    for (const color of colors) {
      const row = appendDebugRow(table, [color, '']);
      // The colour formatter supplies the swatch markup.
      row.cells[1].innerHTML = makeColorTextRGBA(this.state[color]);
    }
    return table;
  }

  buildCombinerTab() {
    const pre = document.createElement('pre');
    pre.className = 'combine';
    pre.append(gbi.CycleType.nameOf(this.state.getCycleType()) + '\n');
    pre.append(this.buildColorsTable());
    pre.append(shaders.getCombinerText(this.state.combine.hi, this.state.combine.lo));
    const shader = this.renderer.getCurrentN64Shader();
    if (shader) {
      pre.append(shader.shaderSource);
    }
    return pre;
  }

  buildTexture(tileIdx) {
    const texture = this.renderer.lookupTexture(tileIdx);
    if (texture) {
      const kScale = 8;
      return texture.createScaledCanvas(kScale);
    }
  }

  buildTilesTab() {
    const container = document.createElement('div');
    container.append(this.buildTilesTable());

    const headings = Array.from({ length: 8 }, (_, i) => gbi.getTileText(i));
    const table = createDebugTable(headings);
    const row = table.tBodies[0].insertRow();
    for (let i = 0; i < 8; ++i) {
      const texture = this.buildTexture(i);
      const cell = row.insertCell();
      if (texture) {
        cell.append(texture);
      }
    }
    container.append(table);
    return container;
  }

  buildTilesTable() {
    const tileFields = [
      'tile #',
      'format', 'size', 'line', 'tmem', 'palette',
      'cmS', 'maskS', 'shiftS',
      'cmT', 'maskT', 'shiftT',
      'left', 'top', 'right', 'bottom',
      'width', 'height', 'unmasked w', 'unmasked h',
    ];

    const table = createDebugTable(tileFields);

    for (let tileIdx = 0; tileIdx < this.state.tiles.length; ++tileIdx) {
      const tile = this.state.tiles[tileIdx];

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

      appendDebugRow(table, vals);
    }

    return table;
  }

  buildVerticesTab() {
    const vtxFields = ['vtx #', 'x', 'y', 'z', 'px', 'py', 'pz', 'pw', 'color', 'u', 'v', 'clip'];

    const table = createDebugTable(vtxFields);

    for (let i = 0; i < this.state.projectedVertices.length; ++i) {
      const vtx = this.state.projectedVertices[i];
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
      vals.push(''); // Colour swatch is inserted as markup below.
      vals.push(vtx.u.toFixed(3));
      vals.push(vtx.v.toFixed(3));
      vals.push(''); // Clip flags are inserted as markup below.

      const row = appendDebugRow(table, vals);
      row.cells[8].innerHTML = makeColorTextABGR(vtx.color);
      row.cells[11].innerHTML = makeClipFlagsText(vtx.clipFlags);
    }

    return table;
  }
}

class Disassembler {
  constructor(dc) {
    this.debugController = dc;
    this.$currentDis = $('<pre></pre>');
    this.$span = undefined;
    this.numOps = 0;
  }

  begin(cmd0, cmd1, depth) {
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
    this.debugController.setDisplayListOutput(this.$currentDis);
  }

  rgba8888(col) { return makeColorTextRGBA(col); }
  rgba5551(col) { return makeColorTextRGBA16(col); }
}

function makeClipFlagsText(flags) {
  const x = makeFlagText('x', flags, gbi.X_POS, gbi.X_NEG);
  const y = makeFlagText('y', flags, gbi.Y_POS, gbi.Y_NEG);
  const z = makeFlagText('z', flags, gbi.Z_POS, gbi.Z_NEG);

  return `${x} ${y} ${z}`;
}

function makeFlagText(dim, flags, pos, neg) {
  const p = flags & pos;
  const n = flags & neg;

  let cls;
  let t;
  if (p && n) { cls = 'clip-err'; t = '!'; }
  else if (p) { cls = 'clip-pos'; t = '>'; }
  else if (n) { cls = 'clip-neg'; t = '<'; }
  else { cls = 'clip-none'; t = '0'; }
  return `<span class="${cls}">${dim}${t}</span>`
}

function createDebugTable(headings = []) {
  const table = document.createElement('table');
  table.className = 'table table-condensed dl-debug-table';
  table.style.width = 'auto';
  if (headings.length) {
    const row = table.createTHead().insertRow();
    for (const title of headings) {
      const heading = document.createElement('th');
      heading.textContent = title;
      row.append(heading);
    }
  }
  table.createTBody();
  return table;
}

function appendDebugRow(table, values) {
  const row = table.tBodies[0].insertRow();
  for (const value of values) {
    row.insertCell().textContent = value;
  }
  return row;
}
