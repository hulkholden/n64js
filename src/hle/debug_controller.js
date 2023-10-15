/*global $, n64js*/
import { padString, toHex, toString32 } from '../format.js';
import { makeColorTextRGBA16, makeColorTextRGBA, makeColorTextABGR } from './disassemble.js';
import * as gbi from './gbi.js';
import * as shaders from './shaders.js';

// TODO: make fields.
let $dlistScrub;
let $dlistState;
let $dlistOutput;

const $dlistContent = $('#dlist-content');

// Which displaylist in the frame to stop on.
let dlFocusIndex = 0;
// Which type of displaylsit to focus on, e.g. S2DEX.
let dlFocusSubstr = '';

export class DebugController {
  constructor(state, processDList) {
    this.state = state;
    this.processDList = processDList;

    // This is updated as we're executing, so that we know which instruction to halt on.
    this.currentOp = 0;
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
    this.bailAfter = this.currentOp;
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

  postOp(bailAfter) {
    if (bailAfter > -1 && this.currentOp >= bailAfter) {
      return true;
    }
    this.currentOp++;
    return false;
  }

  updateStateUI() {
    $dlistState.find('#dl-geometrymode-content').html(this.buildStateTab());
    $dlistState.find('#dl-vertices-content').html(this.buildVerticesTab());
    $dlistState.find('#dl-tiles-content').html(this.buildTilesTab());
    $dlistState.find('#dl-combiner-content').html(this.buildCombinerTab());
    $dlistState.find('#dl-rdp-content').html(this.buildRDPTab());
  }

  setScrubText(x, max) {
    $dlistScrub.find('.scrub-text').html(`uCode op ${x}/${max}.`);
  }

  setScrubRange(max) {
    $dlistScrub.find('input').attr({
      min: 0,
      max: max,
      value: max
    });
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
    const $dlistControls = $dlistContent.find('#controls');

    this.bailAfter = -1;
    this.numOps = 0;

    const that = this;

    $dlistControls.find('#rwd').click(() => {
      if (that.running && that.bailAfter > 0) {
        that.setScrubTime(that.bailAfter - 1);
      }
    });
    $dlistControls.find('#fwd').click(() => {
      if (that.running && that.bailAfter < that.numOps) {
        that.setScrubTime(that.bailAfter + 1);
      }
    });
    $dlistControls.find('#stop').click(() => {
      this.toggle();
    });

    $dlistScrub = $dlistControls.find('.scrub');
    $dlistScrub.find('input').change(function () {
      that.setScrubTime($(this).val() | 0);
    });
    this.setScrubRange(0);

    $dlistState = $dlistContent.find('.hle-state');

    $dlistOutput = $('<div class="hle-disasm"></div>');
    $('#adjacent-debug').empty().append($dlistOutput);
  }

  showUI() {
    n64js.debugger().show();
    $('#dlist-tab').tab('show');
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
    const $table = $('<table class="table table-condensed dl-debug-table" style="width: auto;"></table>');
    const $tr = $('<tr />');

    for (let i in this.state.geometryMode) {
      if (Object.prototype.hasOwnProperty.call(this.state.geometryMode, i)) {
        const $td = $(`<td>${i}</td>`);
        $td.addClass(this.state.geometryMode[i] ? 'dl-debug-geommode-enabled' : 'dl-debug-geommode-disabled');
        $tr.append($td);
      }
    }

    $table.append($tr);
    return $table;
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
      ['', '&nbsp'],
      ['TI.format', gbi.ImageFormat.nameOf(ti.format)],
      ['TI.size', gbi.ImageSize.nameOf(ti.size)],
      ['TI.width', ti.width],
      ['TI.address', toString32(ti.address)],
    ]);

    const $table = $('<table class="table table-condensed dl-debug-table" style="width: auto;"></table>');
    for (let [name, value] of vals) {
      let $tr = $(`<tr><td>${name}</td><td>${value}</td></tr>`);
      $table.append($tr);
    }
    return $table;
  }

  buildColorsTable() {
    const colors = ['fillColor', 'envColor', 'primColor', 'blendColor', 'fogColor'];

    const $table = $('<table class="table table-condensed dl-debug-table" style="width: auto;"></table>');
    for (let color of colors) {
      let row = $(`<tr><td>${color}</td><td>${makeColorTextRGBA(this.state[color])}</td></tr>`);
      $table.append(row);
    }
    return $table;
  }

  buildCombinerTab() {
    const $p = $('<pre class="combine"></pre>');
    $p.append(gbi.CycleType.nameOf(this.state.getCycleType()) + '\n');
    $p.append(this.buildColorsTable());
    $p.append(shaders.getCombinerText(this.state.combine.hi, this.state.combine.lo));
    const shader = this.renderer.getCurrentN64Shader();
    if (shader) {
      $p.append(shader.shaderSource);
    }
    return $p;
  }

  buildTexture(tileIdx) {
    const texture = this.renderer.lookupTexture(tileIdx);
    if (texture) {
      const kScale = 8;
      return texture.createScaledCanvas(kScale);
    }
  }

  buildTilesTab() {
    const $d = $('<div />');
    $d.append(this.buildTilesTable());

    const headings = [];
    const $textures = $('<tr />');
    for (let i = 0; i < 8; ++i) {
      let $t = this.buildTexture(i);
      headings.push(gbi.getTileText(i));
      let $td = $('<td />')
      $td.append($t ? $t : '');
      $textures.append($td);
    }
    const $table = $('<table class="table table-condensed dl-debug-table" style="width: auto"></table>');
    $table.append($(`<tr><th>${headings.join('</th><th>')}</th></tr>`));
    $table.append($textures);
    $d.append($table)
    return $d;
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

    const $table = $('<table class="table table-condensed dl-debug-table" style="width: auto"></table>');
    const $headingTR = $(`<tr><th>${tileFields.join('</th><th>')}</th></tr>`);
    $table.append($headingTR);

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

      const tr = $(`<tr><td>${vals.join('</td><td>')}</td></tr>`);
      $table.append(tr);
    }

    return $table;
  }

  buildVerticesTab() {
    const vtxFields = ['vtx #', 'x', 'y', 'z', 'px', 'py', 'pz', 'pw', 'color', 'u', 'v', 'clip'];

    const $table = $('<table class="table table-condensed dl-debug-table" style="width: auto"></table>');
    const headingTR = $(`<tr><th>${vtxFields.join('</th><th>')}</th></tr>`);
    $table.append(headingTR);

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
      vals.push(makeColorTextABGR(vtx.color));
      vals.push(vtx.u.toFixed(3));
      vals.push(vtx.v.toFixed(3));
      vals.push(makeClipFlagsText(vtx.clipFlags));

      const tr = $(`<tr><td>${vals.join('</td><td>')}</td></tr>`);
      $table.append(tr);
    }

    return $table;
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

  let cls = '';
  let t = '';
  if (p && n) { cls = 'clip-err'; t = '!'; }
  else if (p) { cls = 'clip-pos'; t = '>'; }
  else if (n) { cls = 'clip-neg'; t = '<'; }
  else { cls = 'clip-none'; t = '0'; }
  return `<span class="${cls}">${dim}${t}</span>`
}