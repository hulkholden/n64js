/*jshint jquery:true */
/*global $, n64js*/

import * as cpu0reg from './cpu0reg.js';
import { disassembleRange, cop0gprNames, cop1RegisterNames } from './disassemble.js';
import * as disassemble_rsp from "./disassemble_rsp.js";
import { getFragmentMap } from './fragments.js';
import { toggleDebugDisplayList } from './hle/hle_graphics.js';
import { TaskOffsets } from './hle/rsp_task.js';
import { toHex, toString8, toString16, toString32, toString64 } from './format.js';
import * as logger from './logger.js';
import { cpu0, cpu1 } from './r4300.js';
import * as r4300 from './r4300.js';
import { rsp } from './rsp.js';
import * as mi from './devices/mi.js';
import * as dbgUI from './dbg_ui.js';

window.n64js = window.n64js || {};

export class Debugger {
  constructor() {
    /** @type {boolean} Whether the debugger is active. */
    this.active = false;

    /** @type {?jQuery} */
    this.$cpuContent = $('#cpu-content');

    /** @type {?Array<?jQuery>} */
    this.cpuTabs = [$('#cpu0-content'), $('#cpu1-content')];

    /** @type {?jQuery} */
    this.$cpu0Disassembly = $('#cpu-disasm');

    /** @type {?jQuery} */
    this.$rspContent = $('#rsp-content');

    /** @type {?Array<?jQuery>} */
    this.rspTabs = [$('#rsp-scalar-content'), $('#rsp-vector-content'), $('#rsp-task-content')];

    /** @type {?jQuery} */
    this.$rspDisassembly = $('#rsp-disasm');

    /** @type {?jQuery} */
    this.$dynarecContent = $('#dynarec-content');

    /** @type {?jQuery} */
    this.$memoryContent = $('#memory-content');

    /** @type {?jQuery} */
    this.$timelineContent = $('#timeline-content');

    /** @type {R4300DebugState} */
    this.cpu0State = new R4300DebugState();

    /** @type {RSPDebugState} */
    this.rspState = new RSPDebugState();

    /** @type {number} The number of cycles executed the last time the display was updated. */
    this.lastOpExecuted = 0;

    /** @type {!Array<!Object>} A list of recent memory accesses. */
    this.recentMemoryAccesses = [];

    /** @type {number} The address of the last memory access. */
    this.lastMemoryAccessAddress = 0;

    /**
     * When we execute a store instruction, keep track of some details so we can
     * show the value that was written.
     * @type {?Object} The address of the last memory access.
     */
    this.lastStore = null;

    /** @type {!Map<number, string>} A map of labels keyed by address. */
    this.labelMap = new Map();

    /** @type {number} How many cycles to execute before updating the debugger. */
    this.debugCycles = Math.pow(10, 0);

    logger.initialise($('.output'), () => {
      return toString32(cpu0.pc);
    });

    n64js.addResetCallback(this.onReset.bind(this));

    $('#output').find('#clear').click(function () {
      logger.clear();
    });

    const that = this;

    $('#cpu-speed').change(function () {
      that.debugCycles = Math.pow(10, $(this).val() | 0);
      logger.log('Speed is now ' + that.debugCycles);
    });

    $('#cpu').find('#address').change(function () {
      that.disasmAddress = parseInt($(this).val(), 16);
      that.updateCPU();
    });
    this.refreshLabelSelect();

    this.$memoryContent.find('input').change(function () {
      that.lastMemoryAccessAddress = parseInt($(this).val(), 16);
      that.updateMemoryView();
    });
    this.updateMemoryView();

    $('body').keydown(function (event) {
      let consumed = false;
      switch (event.key) {
        case 'ArrowDown': consumed = true; that.disassemblerDown(); break;
        case 'ArrowUp': consumed = true; that.disassemblerUp(); break;
        case 'PageDown': consumed = true; that.disassemblerPageDown(); break;
        case 'PageUp': consumed = true; that.disassemblerPageUp(); break;
        case 'F8': consumed = true; n64js.toggleRun(); break;
        case 'F9': consumed = true; toggleDebugDisplayList(); break;
        case 'F10': consumed = true; n64js.step(); break;
        // default: console.log(`code: ${event.key}`);
      }
      if (consumed) {
        event.preventDefault();
      }
    });

    document.querySelector('#cpu-tab').addEventListener('click', () => {
      this.updateCPU();
    })
    document.querySelector('#rsp-tab').addEventListener('click', () => {
      this.updateRSP();
    })
    document.querySelector('#memory-tab').addEventListener('click', () => {
      this.updateMemoryView();
    })
    document.querySelector('#dynarec-tab').addEventListener('click', () => {
      this.updateDynarec();
    })
    document.querySelector('#timeline-tab').addEventListener('click', () => {
      this.updateTimeline();
    })
  }

  visible() { return this.active; }
  show() { this.setVisible(true); }
  hide() { this.setVisible(false); }
  toggle() { this.setVisible(!this.active); }

  setVisible(value) {
    this.active = value;

    document.querySelectorAll('.debug').forEach(e => {
      e.classList.toggle('hidden', !value);
    });
    dbgUI.setVisible(value);
  }

  showTimeline() {
    this.updateTimeline();
    this.show();
    $('#timeline-tab').tab('show');
  }

  updateMemoryView() {
    const addr = this.lastMemoryAccessAddress || 0x80000000;
    const $pre = this.$memoryContent.find('pre');
    $pre.empty().append(this.makeMemoryAccessRow(addr, 1024));
  }

  refreshLabelSelect() {
    const $select = $('#cpu').find('#labels');
    const arr = Array.from(this.labelMap.keys());

    const that = this;
    arr.sort((a, b) => {
      const aVal = that.labelMap.get(a);
      const bVal = that.labelMap.get(b);
      return aVal.localeCompare(bVal);
    });

    $select.html('');

    for (let address of arr) {
      const label = this.labelMap.get(address);
      const $option = $(`<option value="${label}">${label}</option>`);
      $option.data('address', address);
      $select.append($option);
    }

    $select.change(() => {
      let contents = $select.find('option:selected').data('address');
      that.cpu0State.disasmAddress = /** @type {number} */(contents) >>> 0;
      that.updateCPU();
    });
  }

  onReset() {
    this.restoreLabelMap();
    this.updateCPU();
    this.updateRSP();
  }

  restoreLabelMap() {
    this.labelMap = n64js.getLocalStorageItem('debugLabelMap') || new Map();
    this.refreshLabelSelect();
  }

  storeLabelMap() {
    n64js.setLocalStorageItem('debugLabelMap', this.labelMap);
  }

  /**
   * Constructs HTML for a row of memory values.
   * @param {number} focusAddress The address to focus on.
   * @param {number} contextBytes The number of bytes of context.
   * @param {number=} bytesPerRow The number of bytes per row. Should be a power of two.
   * @param {Map<number,string>=} highlights Colours to highlight addresses with.
   * @return {!jQuery}
   */
  makeMemoryAccessRow(focusAddress, contextBytes, bytesPerRow = 64, highlights = null) {
    let s = roundDown(focusAddress, bytesPerRow) - roundDown(contextBytes / 2, bytesPerRow);
    let e = s + contextBytes;

    let t = '';
    for (let a = s; a < e; a += bytesPerRow) {
      let r = toHex(a, 32) + ':';

      for (let o = 0; o < bytesPerRow; o += 4) {
        let curAddress = a + o >>> 0;
        let mem = n64js.hardware().memMap.readMemoryInternal32(curAddress);
        let style = '';
        if (highlights && highlights.has(curAddress)) {
          style = ` style="background-color: ${highlights.get(curAddress)}"`;
        }
        r += ` <span id="mem-${toHex(curAddress, 32)}"${style}>${toHex(mem, 32)}</span>`;
      }

      r += '\n';
      t += r;
    }

    return $(`<span>${t}</span>`);
  }

  // access is {reg,offset,mode}
  makeRecentMemoryAccessRow(address, mode) {
    let col = (mode === 'store') ? '#faa' : '#ffa';
    if (mode === 'update') {
      col = '#afa';
    }

    let highlights = new Map();
    let alignedAddress = (address & ~3) >>> 0;
    highlights.set(alignedAddress, col);
    return this.makeMemoryAccessRow(address, 32, 32, highlights);
  }

  makeLabelColor(address) {
    let i = address >>> 2;  // Lowest bits are always 0
    let hash = (i >>> 16) ^ ((i & 0xffff) * 2803);
    let r = (hash) & 0x1f;
    let g = (hash >>> 5) & 0x1f;
    let b = (hash >>> 10) & 0x1f;
    let h = (hash >>> 15) & 0x3;

    r *= 4;
    g *= 4;
    b *= 4;
    switch (h) {
      case 0: r *= 2; g *= 2; break;
      case 1: g *= 2; b *= 2; break;
      case 2: b *= 2; r *= 2; break;
      default: r *= 2; g *= 2; b *= 2; break;
    }

    return '#' + toHex(r, 8) + toHex(g, 8) + toHex(b, 8);
  }

  setLabelText($elem, address) {
    if (this.labelMap.has(address)) {
      $elem.append(` (${this.labelMap.get(address)})`);
    }
  }

  setLabelColor($elem, address) {
    $elem.css('color', this.makeLabelColor(address));
  }

  makeLabelText(address) {
    let t = this.labelMap.get(address) || '';
    while (t.length < 20) {
      t += ' ';
    }
    return t;
  }

  onLabelClicked(e) {
    let $label = $(e.delegateTarget);
    let address = /** @type {number} */($label.data('address')) >>> 0;
    let existing = this.labelMap.get(address) || '';
    let $input = $(`<input class="input-mini" value="${existing}" />`);

    const that = this;

    $input.keypress((event) => {
      if (event.which == 13) {
        const newVal = $input.val();
        if (newVal) {
          that.labelMap.set(address, newVal.toString());
        } else {
          that.labelMap.delete(address);
        }
        that.storeLabelMap();
        that.refreshLabelSelect();
        this.updateCPU();
      }
    });
    $input.blur(() => {
      $label.html(that.makeLabelText(address));
    });
    $label.empty().append($input);
    $input.focus();
  }

  onFragmentClicked(e) {
    let $elem = $(e.delegateTarget);
    let frag = $elem.data('fragment');
    logger.log(`<pre>${frag.func.toString()}</pre>`);
  }

  onClickBreakpoint(e) {
    let $elem = $(e.delegateTarget);
    let address = /** @type {number} */($elem.data('address')) >>> 0;
    n64js.breakpoints().toggle(address);
    this.updateCPU();
  }

  updateCPU() {
    this.cpu0State.setPC(cpu0.pc);

    // Figure out if we've just stepped by a single instruction. Ergh.
    let opsExecuted = cpu0.getOpsExecuted();
    let isSingleStep = this.lastOpExecuted === (opsExecuted - 1);
    this.lastOpExecuted = opsExecuted;

    let fragmentMap = getFragmentMap();
    let disassembly = this.cpu0State.disassembleRange();

    let $disGutter = $('<pre/>');
    let $disText = $('<pre/>');
    let currentInstruction;

    for (let i = 0; i < disassembly.length; ++i) {
      let a = disassembly[i];
      let address = a.instruction.address;
      let isTarget = a.isJumpTarget || this.labelMap.has(address);
      let addressStr = (isTarget ? '<span class="dis-address-target">' : '<span class="dis-address">') + toHex(address, 32) + ':</span>';
      let label = `<span class="dis-label">${this.makeLabelText(address)}</span>`;
      let t = `${addressStr}  ${toHex(a.instruction.opcode, 32)}  ${label}${a.disassembly}`;

      let fragment = fragmentMap.get(address);
      if (fragment) {
        const span = `<span class="dis-fragment-link"> frag - ops=${fragment.opsCompiled} hit=${fragment.executionCount}</span>`;
        t += span;
      }

      let $line = $(`<span class="dis-line">${t}</span>`);
      $line.find('.dis-label')
        .data('address', address)
        .css('color', this.makeLabelColor(address))
        .click(this.onLabelClicked.bind(this));

      if (fragment) {
        $line.find('.dis-fragment-link')
          .data('fragment', fragment)
          .click(this.onFragmentClicked.bind(this));
      }

      // Keep track of the current instruction (for register formatting) and highlight.
      if (address === cpu0.pc) {
        currentInstruction = a.instruction;
        $line.addClass('dis-line-cur');
      }
      if (isTarget) {
        $line.addClass('dis-line-target');

        this.setLabelColor($line.find('.dis-address-target'), address);
      }

      $disText.append($line);
      $disText.append('<br>');

      let bpText = '&nbsp;';
      if (n64js.breakpoints().isBreakpoint(address)) {
        bpText = '&bull;';
      }
      let $bp = $(`<span>${bpText}</span>`).data('address', address).click(this.onClickBreakpoint.bind(this));

      $disGutter.append($bp);
      $disGutter.append('<br>');
    }

    // Links for branches, jumps etc should jump to the target address.
    $disText.find('.dis-address-jump').each(function () {
      let address = parseInt($(this).text(), 16);

      this.setLabelText($(this), address);
      this.setLabelColor($(this), address);

      $(this).click(function () {
        this.cpu0state.disasmAddress = address;
        this.redraw();
      });
    }.bind(this));

    // TODO: apply a class rather than a colour.
    let registerColours = this.makeRegisterColours(currentInstruction);
    for (let [reg, colour] of registerColours) {
      $disText.find('.dis-reg-' + reg).css('background-color', colour);
    }

    this.$cpu0Disassembly.find('.dis-recent-memory').html(this.makeRecentMemoryAccesses(isSingleStep, currentInstruction, cpu0.calcDebuggerAddress.bind(cpu0)));

    this.$cpu0Disassembly.find('.dis-gutter').empty().append($disGutter);
    this.$cpu0Disassembly.find('.dis-view').empty().append($disText);

    this.cpu0State.updateStatusTable();

    this.cpuTabs[0].empty().append(this.cpu0State.makeCop0RegistersTable(registerColours));
    this.cpuTabs[1].empty().append(this.cpu0State.makeCop1RegistersTable(registerColours));
  }

  updateRSP() {
    this.rspState.setPC(rsp.pc);

    // Figure out if we've just stepped by a single instruction. Ergh.
    // let opsExecuted = rsp.getOpsExecuted();
    // let isSingleStep = this.lastOpExecuted === (opsExecuted - 1);
    // this.lastOpExecuted = opsExecuted;
    const isSingleStep = true;

    // let fragmentMap = getFragmentMap();
    let disassembly = this.rspState.disassembleRange();

    let $disGutter = $('<pre/>');
    let $disText = $('<pre/>');

    for (let i = 0; i < disassembly.length; ++i) {
      let a = disassembly[i];
      let address = a.instruction.address;
      // TODO: figure out if we want a separate labelMap for RSP.
      let isTarget = a.isJumpTarget || this.labelMap.has(address);
      let addressStr = (isTarget ? '<span class="dis-address-target">' : '<span class="dis-address">') + toHex(address, 32) + ':</span>';
      let label = `<span class="dis-label">${this.makeLabelText(address)}</span>`;
      let t = `${addressStr}  ${toHex(a.instruction.opcode, 32)}  ${label}${a.disassembly}`;

      let $line = $(`<span class="dis-line">${t}</span>`);
      $line.find('.dis-label')
        .data('address', address)
        .css('color', this.makeLabelColor(address))
        .click(this.onLabelClicked.bind(this)); // FIXME: needs to be RSP labels.

      if (address === rsp.pc) {
        $line.addClass('dis-line-cur');
      }
      if (isTarget) {
        $line.addClass('dis-line-target');
        this.setLabelColor($line.find('.dis-address-target'), address);
      }

      $disText.append($line);
      $disText.append('<br>');

      // FIXME: Add breakpoint support for RSP.
      let bpText = '&nbsp;';
      if (n64js.breakpoints().isBreakpoint(address)) {
        bpText = '&bull;';
      }
      let $bp = $(`<span>${bpText}</span>`).data('address', address).click(this.onClickBreakpoint.bind(this));

      $disGutter.append($bp);
      $disGutter.append('<br>');
    }

    // Links for branches, jumps etc should jump to the target address.
    $disText.find('.dis-address-jump').each(function () {
      let address = parseInt($(this).text(), 16);

      this.setLabelText($(this), address);
      this.setLabelColor($(this), address);

      $(this).click(function () {
        this.rspstate.disasmAddress = address;
        this.redraw();
      });
    }.bind(this));

    const curInstrDis = disassemble_rsp.disassembleInstruction(rsp.pc, rsp.imem.getU32(rsp.pc));
    const curInstruction = curInstrDis.instruction;
    let registerColours = this.makeRegisterColours(curInstruction);
    for (let [reg, colour] of registerColours) {
      $disText.find('.dis-reg-' + reg).css('background-color', colour);
    }

    this.$rspDisassembly.find('.dis-recent-memory').html(this.makeRecentMemoryAccesses(isSingleStep, curInstruction, rsp.calcDebuggerAddress.bind(rsp)));

    this.$rspDisassembly.find('.dis-gutter').empty().append($disGutter);
    this.$rspDisassembly.find('.dis-view').empty().append($disText);

    this.rspState.updateStatusTable();

    this.rspTabs[0].empty().append(this.rspState.makeScalarRegistersTable(registerColours));
    this.rspTabs[1].empty().append(this.rspState.makeVectorRegistersTable(registerColours));
    this.rspTabs[2].empty().append(this.rspState.makeTaskTable());
  }

  /**
   * Makes a map of colours keyed by register name.
   * @param {?Object} instruction The instruction to produce colours for.
   * @return {!Map<string, string>}
   */
  makeRegisterColours(instruction) {
    const availColours = [
      '#fd7e14', // yellow
      '#198754', // green
      '#0d6efd'  // blue
    ];

    let registerColours = new Map();
    if (instruction) {
      let nextColIdx = 0;
      for (let i in instruction.srcRegs) {
        if (!Object.prototype.hasOwnProperty.call(registerColours, i)) {
          registerColours.set(i, availColours[nextColIdx++]);
        }
      }
      for (let i in instruction.dstRegs) {
        if (!Object.prototype.hasOwnProperty.call(registerColours, i)) {
          registerColours.set(i, availColours[nextColIdx++]);
        }
      }
    }
    return registerColours;
  }

  makeRecentMemoryAccesses(isSingleStep, currentInstruction, resolveAccessAddr) {
    const opsExecuted = cpu0.opsExecuted;

    // Keep a small queue showing recent memory accesses
    if (isSingleStep) {
      // Check if we've just stepped over a previous write op, and update the result
      if (this.lastStore) {
        if ((this.lastStore.cycle + 1) === opsExecuted) {
          let updatedElement = this.makeRecentMemoryAccessRow(this.lastStore.address, 'update');
          this.lastStore.element.append(updatedElement);
        }
        this.lastStore = null;
      }

      const access = currentInstruction.memory;
      if (access) {
        const accessAddr = resolveAccessAddr(currentInstruction.opcode);
        let element = this.makeRecentMemoryAccessRow(accessAddr, access.mode);

        if (access.mode === 'store') {
          this.lastStore = {
            address: accessAddr,
            cycle: opsExecuted,
            element: element,
          };
        }

        this.recentMemoryAccesses.push({ element: element });

        // Nuke anything that happened more than N cycles ago
        //while (this.recentMemoryAccesses.length > 0 && this.recentMemoryAccesses[0].cycle+10 < cycle)
        if (this.recentMemoryAccesses.length > 4) {
          this.recentMemoryAccesses.splice(0, 1);
        }

        this.lastMemoryAccessAddress = accessAddr;
      }
    } else {
      // Clear the recent memory accesses when running.
      this.recentMemoryAccesses = [];
      this.lastStore = null;
    }

    let $recent = $('<pre />');
    if (this.recentMemoryAccesses.length > 0) {
      const fadingColours = ['#bbb', '#999', '#666', '#333'];
      for (let i = 0; i < this.recentMemoryAccesses.length; ++i) {
        let element = this.recentMemoryAccesses[i].element;
        element.css('color', fadingColours[i]);
        $recent.append(element);
      }
    }

    return $recent;
  }

  updateDynarec() {
    let histogram = new Map();
    let maxBucket = 0;

    // Build a flattened list of all fragments
    let fragmentsList = [];
    getFragmentMap().forEach((fragment) => {
      let i = fragment.executionCount > 0 ? Math.floor(Math.log10(fragment.executionCount)) : 0;
      histogram.set(i, (histogram.get(i) || 0) + 1);
      fragmentsList.push(fragment);
      maxBucket = Math.max(maxBucket, i);
    });

    fragmentsList.sort((a, b) => {
      return b.opsCompiled * b.executionCount - a.opsCompiled * a.executionCount;
    });

    let $t = $('<div class="container-fluid" />');

    // Histogram showing execution counts
    let t = '';
    t += '<div class="row">';
    t += '<table class="table table-condensed table-nonfluid"><tr><th>Execution Count</th><th>Frequency</th></tr>';
    for (let i = 0; i <= maxBucket; i++) {
      let count = histogram.get(i) || 0;
      let range = `< ${Math.pow(10, i + 1)}`;
      t += `<tr><td>${range}</td><td>${count}</td></tr>`;
    }
    t += '</table>';
    t += '</div>';
    $t.append(t);

    // Table of hot fragments, and the corresponding js
    t = '';
    t += '<div class="row">';
    t += '  <div class="col-lg-6" id="fragments" />';
    t += '  <div class="col-lg-6" id="fragment-code" />';
    t += '</div>';
    let $fragmentDiv = $(t);

    this.createHotFragmentsTable($fragmentDiv, fragmentsList);

    $t.append($fragmentDiv);

    this.$dynarecContent.empty().append($t);
  }

  createHotFragmentsTable($fragmentDiv, fragmentsList) {
    let $code = $fragmentDiv.find('#fragment-code');
    let $table = $('<table class="table table-condensed" />');
    let columns = ['Address', 'Execution Count', 'Length', 'ExecCount * Length'];

    $table.append(`<tr><th>${columns.join('</th><th>')}</th></tr>`);
    for (let i = 0; i < fragmentsList.length && i < 20; ++i) {
      let fragment = fragmentsList[i];
      let vals = [
        toString32(fragment.entryPC),
        fragment.executionCount,
        fragment.opsCompiled,
        fragment.executionCount * fragment.opsCompiled
      ];
      let $tr = $(`<tr><td>${vals.join('</td><td>')}</td></tr>`);
      this.initFragmentRow($tr, fragment, $code);
      $table.append($tr);
    }
    $fragmentDiv.find('#fragments').append($table);

    if (fragmentsList.length > 0) {
      $code.append(`<pre>${fragmentsList[0].func.toString()}</pre>`);
    }
  }

  initFragmentRow($tr, fragment, $code) {
    $tr.click(() => {
      $code.html(`<pre>${fragment.func.toString()}</pre>`);
    });
  }

  updateTimeline() {
    const timeline = n64js.hardware().timeline;

    const $tl = this.$timelineContent.find('.timeline-panel');
    $tl.empty();

    let minTime = Number.MAX_VALUE;
    let maxTime = 0;
    timeline.tracks.forEach(track => {
      track.events.forEach(e => {
        if (e.start < minTime) {
          minTime = e.start;
        }
        if (e.end > maxTime) {
          maxTime = e.end;
        }
      });
    });

    const duration = maxTime - minTime;
    if (duration <= 0) {
      return;
    }

    const timelineWidth = 4000;
    const rowHeight = 30;

    let baseDepth = 0;
    timeline.tracks.forEach(track => {
      let maxDepth = 0;
      track.events.forEach(e => {
        const left = timelineWidth * (e.start - minTime) / duration;
        const pixels = timelineWidth * (e.end - e.start) / duration;
        const width = (pixels < 1) ? 1 : pixels;

        const top = (baseDepth + e.depth) * rowHeight;
        const height = rowHeight;
        const name = e.name;

        let t = '';
        t += `<div class="timeline-block" style="left: ${left.toFixed(0)}px; top: ${top.toFixed(0)}px; width: ${width.toFixed(0)}px; height: ${height.toFixed(0)}px">`;
        t += `<div class="timeline-name">${name}</div>`;
        t += '</div>';
        $tl.append(t);

        if (e.depth > maxDepth) {
          maxDepth = e.depth;
        }
      });
      baseDepth += maxDepth + 1;
    });
  }

  disassemblerDown() {
    this.scrollActiveDisassemblyWindow(+1);
    this.redraw();
  }

  disassemblerUp() {
    this.scrollActiveDisassemblyWindow(-1);
    this.redraw();
  }

  disassemblerPageDown() {
    this.scrollActiveDisassemblyWindow(+16);
    this.redraw();
  }

  disassemblerPageUp() {
    this.scrollActiveDisassemblyWindow(-16);
    this.redraw();
  }

  scrollActiveDisassemblyWindow(amount) {
    const dis = this.activeDisassemblyWindow();
    if (dis) {
      dis.scroll(amount);
    }
  }

  activeDisassemblyWindow() {
    if (this.$cpuContent.hasClass('active')) {
      return this.cpu0State;
    }
    if (this.$rspContent.hasClass('active')) {
      return this.rspState;
    }
    return null;
  }

  redraw() {
    if (!this.active) {
      return;
    }

    if (this.$cpuContent.hasClass('active')) {
      this.updateCPU();
    }

    if (this.$rspContent.hasClass('active')) {
      this.updateRSP();
    }

    if (this.$memoryContent.hasClass('active')) {
      this.updateMemoryView();
    }

    if (this.$dynarecContent.hasClass('active')) {
      this.updateDynarec();
    }

    // The timeline doesn't change while the debugger is active
    // so there's no need to redraw it.
  }
}


class CPUDebugState {
  constructor() {
    /** @type {number} The address to disassemble. */
    this.disasmAddress = 0;

    /** @type {number} The program counter the last time the display was updated. */
    this.lastPC = -1;
  }

  setPC(newPC) {
    // If the pc has changed since the last update, recenter the display (e.g. when we take a branch)
    if (newPC !== this.lastPC) {
      this.disasmAddress = newPC;
      this.lastPC = newPC;
    }
  }

  scroll(offset) {
    this.disasmAddress += offset * 4;
    // TODO: trigger redraw from here.
  }
}

class R4300DebugState extends CPUDebugState {
  disassembleRange() {
    return disassembleRange(this.disasmAddress - 64, this.disasmAddress + 64, true);
  }

  /**
   * Makes a table showing the status register contents.
   * @return {!jQuery}
   */
  updateStatusTable() {
    setTextContent('#cpu0-status-opsexecuted', cpu0.opsExecuted);
    setTextContent('#cpu0-status-pc', toString32(cpu0.pc));
    setTextContent('#cpu0-status-delaypc', toString32(cpu0.delayPC));
    setTextContent('#cpu0-status-epc', toString32(cpu0.getControlU32(cpu0reg.controlEPC)));
    setTextContent('#cpu0-status-cause', toString32(Number(cpu0.moveFromControl(cpu0reg.controlCause) & 0xffff_ffffn)));
    setTextContent('#cpu0-status-count', toString32(Number(cpu0.moveFromControl(cpu0reg.controlCount) & 0xffff_ffffn)));
    setTextContent('#cpu0-status-compare', toString32(cpu0.getControlU32(cpu0reg.controlCompare)));
    setTextContent('#cpu0-status-multhi', toString64(cpu0.getMultHiU64()));
    setTextContent('#cpu0-status-multlo', toString64(cpu0.getMultLoU64()));

    this.updateStatusRegisterRow();
    this.updateMipsInterruptsRow();

    let $body = $('#cpu0-status-events').find('tbody');
    $body.empty();
    $body.append(`<tr><td>&nbsp;</td></tr>`);
    $body.append(`<tr><td>Events</td></tr>`);

    const eq = cpu0.eventQueue;
    let cycles = eq.cyclesToFirstEvent;
    for (let event = eq.firstEvent; event; event = event.next) {
      $body.append(`<tr><td>${event.getName()}</td><td class="fixed">${cycles}</td></tr>`);
      cycles += event.cyclesToNextEvent;
    }
  }

  updateStatusRegisterRow() {
    const sr = cpu0.getControlU32(cpu0reg.controlStatus);
    setTextContent('#cpu0-status-sr', toString32(sr));

    const ids = {
      '#cpu0-status-sr-ie': r4300.SR_IE,
      '#cpu0-status-sr-exl': r4300.SR_EXL,
      '#cpu0-status-sr-erl': r4300.SR_ERL,
      // ux
      // sx
      // kx
    };
    for (let [id, mask] of Object.entries(ids)) {
      const elem = document.querySelector(id);
      if (!elem) {
        continue;
      }
      const set = (sr & mask) !== 0;
      elem.classList.toggle('cpu0-status-bit-set', set);
    }
  }

  updateMipsInterruptsRow() {
    const miDev = n64js.hardware().miRegDevice;
    const setBits = miDev.intrReg();
    const enabledBits = miDev.intrMaskReg();

    const ids = {
      '#cpu0-status-mi-sp': mi.MI_INTR_SP,
      '#cpu0-status-mi-si': mi.MI_INTR_SI,
      '#cpu0-status-mi-ai': mi.MI_INTR_AI,
      '#cpu0-status-mi-vi': mi.MI_INTR_VI,
      '#cpu0-status-mi-pi': mi.MI_INTR_PI,
      '#cpu0-status-mi-dp': mi.MI_INTR_DP,
    }

    for (let [id, mask] of Object.entries(ids)) {
      const elem = document.querySelector(id);
      if (!elem) {
        continue;
      }
      const set = (setBits & mask) !== 0;
      const enabled = (enabledBits & mask) !== 0;
      elem.classList.toggle('cpu0-status-bit-enabled', enabled);
      elem.classList.toggle('cpu0-status-bit-set', set);
    }
  }

  /**
   * Makes a table of co-processor 0 registers.
   * @param {!Map<string, string>} registerColours Register colour map.
   * @return {!jQuery}
   */
  makeCop0RegistersTable(registerColours) {
    let $table = $('<table class="register-table"><tbody></tbody></table>');
    let $body = $table.find('tbody');

    const kRegistersPerRow = 2;

    for (let i = 0; i < 32; i += kRegistersPerRow) {
      let $tr = $('<tr />');
      for (let r = 0; r < kRegistersPerRow; ++r) {
        let name = cop0gprNames[i + r];
        let $td = $(`<td>${name}</td><td class="fixed">${toString64(cpu0.getRegU64(i + r))}</td>`);

        if (registerColours.has(name)) {
          $td.attr('bgcolor', registerColours.get(name));
        }
        $tr.append($td);
      }
      $body.append($tr);
    }

    return $table;
  }

  /**
   * Makes a table of co-processor 1 registers.
   * @param {!Map<string, string>} registerColours Register colour map.
   * @return {!jQuery}
   */
  makeCop1RegistersTable(registerColours) {
    let $table = $('<table class="register-table"><tbody></tbody></table>');
    let $body = $table.find('tbody');

    for (let i = 0; i < 32; ++i) {
      let name = cop1RegisterNames[i];

      let $td;
      if ((i & 1) === 0) {
        $td = $(`<td>${name}</td>
                 <td class="fixed fp-w">${toString32(cpu1.regU32[i])}</td>
                 <td class="fixed fp-s">${cpu1.regF32[i]}</td>
                 <td class="fixed fp-d">${cpu1.regF64[i / 2]}</td>`);
      } else {
        $td = $(`<td>${name}</td>
                 <td class="fixed fp-w">${toString32(cpu1.regU32[i])}</td>
                 <td class="fixed fp-s">${cpu1.regF32[i]}</td>
                 <td></td>`);
      }

      let $tr = $('<tr />');
      $tr.append($td);

      if (registerColours.has(name)) {
        $tr.attr('bgcolor', registerColours.get(name));
      } else if (registerColours.has(name + '-w')) {
        $tr.find('.fp-w').attr('bgcolor', registerColours.get(name + '-w'));
      } else if (registerColours.has(name + '-s')) {
        $tr.find('.fp-s').attr('bgcolor', registerColours.get(name + '-s'));
      } else if (registerColours.has(name + '-d')) {
        $tr.find('.fp-d').attr('bgcolor', registerColours.get(name + '-d'));
      }

      $body.append($tr);
    }

    return $table;
  }
}

class RSPDebugState extends CPUDebugState {
  disassembleRange() {
    return disassemble_rsp.disassembleRange(rsp.imem, this.disasmAddress - 64, this.disasmAddress + 64, true);
  }

  updateStatusTable() {
    setTextContent('#rsp-status-halted', rsp.halted);
    setTextContent('#rsp-status-pc', toString32(rsp.pc));
    setTextContent('#rsp-status-delaypc', toString32(rsp.delayPC));
    setTextContent('#rsp-status-nextpc', toString32(rsp.nextPC));
    setTextContent('#rsp-status-branchtarget', toString32(rsp.branchTarget));
    setTextContent('#rsp-status-vco', toString16(rsp.VCO));
    setTextContent('#rsp-status-vcc', toString16(rsp.VCC));
    setTextContent('#rsp-status-vce', toString8(rsp.VCE));
  }

  /**
   * Makes a table of the scalar registers.
   * @param {!Map<string, string>} registerColours Register colour map.
   * @return {!jQuery}
   */
  makeScalarRegistersTable(registerColours) {
    let $table = $('<table class="register-table"><tbody></tbody></table>');
    let $body = $table.find('tbody');

    const kRegistersPerRow = 2;

    for (let i = 0; i < 32; i += kRegistersPerRow) {
      let $tr = $('<tr />');
      for (let r = 0; r < kRegistersPerRow; ++r) {
        let name = disassemble_rsp.gprNames[i + r];
        let $td = $(`<td>${name}</td><td class="fixed">${toString32(rsp.getRegU32(i + r))}</td>`);

        if (registerColours.has(name)) {
          $td.attr('bgcolor', registerColours.get(name));
        }
        $tr.append($td);
      }
      $body.append($tr);
    }

    return $table;
  }

  /**
   * Makes a table of the vector registers.
   * @param {!Map<string, string>} registerColours Register colour map.
   * @return {!jQuery}
   */
  makeVectorRegistersTable(registerColours) {
    let $table = $('<table class="register-table"><tbody></tbody></table>');
    let $body = $table.find('tbody');

    for (let r = 0; r < 32; r++) {
      let $tr = $('<tr />');
      const name = `V${r}`;
      $tr.append($(`<td>${name}</td>`));
      for (let el = 0; el < 8; ++el) {
        let $td = $(`<td class="fixed">${toHex(rsp.getVecU16(r, el), 16)}</td>`);
        // FIXME: make this work with vector registers.
        if (registerColours.has(name)) {
          $td.attr('bgcolor', registerColours.get(name));
        }
        $tr.append($td);
      }
      $body.append($tr);
    }
    return $table;
  }

  /**
   * Makes a table of the RSP task state.
   * @return {!jQuery}
   */
  makeTaskTable() {
    const kTaskOffset = 0x0fc0;
    const kTaskLength = 0x40;
    const taskMem = n64js.hardware().sp_mem.subRegion(kTaskOffset, kTaskLength);

    let $table = $('<table class="register-table"><tbody></tbody></table>');
    let $body = $table.find('tbody');

    for (let i = 0; i < kTaskLength; i += 4) {
      const $tr = $(`<tr><td>${TaskOffsets.nameOf(i)}</td><td class="fixed">${toHex(taskMem.getU32(i), 32)}</td></tr>`);
      $body.append($tr);
    }
    return $table;
  }
}

function roundDown(x, a) {
  return x & ~(a - 1);
}

function setTextContent(id, text) {
  const elem = document.querySelector(id);
  if (elem) {
    elem.textContent = text;
  }
}

