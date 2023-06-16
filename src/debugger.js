/*jshint jquery:true */

import * as format from './format.js';
import * as logger from './logger.js';
import { getFragmentMap, consumeFragmentInvalidationEvents } from './fragments.js';


(function (n64js) {'use strict';
  /** @type {?jQuery} */
  let $debugContent = null;

  /** @type {?jQuery} */
  let $status = null;

  /** @type {?Array<?jQuery>} */
  let $registers = null;

  /** @type {?jQuery} */
  let $disassembly = null;

  /** @type {?jQuery} */
  let $dynarecContent = null;

  /** @type {?jQuery} */
  let $memoryContent = null;

  /** @type {number} The address to disassemble. */
  let disasmAddress = 0;

  /** @type {number} The number of cycles executed the last time the display was updated. */
  let lastCycles;

  /** @type {number} The program counter the last time the display was updated. */
  let lastPC               = -1;

  /** @type {!Array<!Object>} A list of recent memory accesses. */
  let recentMemoryAccesses = [];

  /** @type {number} The address of the last memory access. */
  let lastMemoryAccessAddress = 0;

  /**
   * When we execute a store instruction, keep track of some details so we can
   * show the value that was written.
   * @type {?Object} The address of the last memory access.
   */
  let lastStore = null;

  /** @type {!Object<number, string>} A map of labels keyed by address. */
  let labelMap = {};

  /** @type {number} How many cycles to execute before updating the debugger. */
  let debugCycles = Math.pow(10,0);

  n64js.getDebugCycles = () => {
    return debugCycles;
  };

  function refreshLabelSelect() {
    let $select = $('#cpu').find('#labels');

    let arr = [];
    for (let i in labelMap) {
      if (labelMap.hasOwnProperty(i)) {
        arr.push(i);
      }
    }
    arr.sort((a, b) => { return labelMap[a].localeCompare(labelMap[b]); });

    $select.html('');

    for (let i = 0; i < arr.length; ++i) {
      let address = arr[i];
      let label   = labelMap[address];
      let $option = $('<option value="' + label + '">' + label + '</option>');
      $option.data('address', address);
      $select.append($option);
    }

    $select.change(function () {
      let contents = $select.find('option:selected').data('address');
      disasmAddress = /** @type {number} */(contents) >>> 0;
      updateDebug();
    });
  }

  function onReset() {
    restoreLabelMap();
  }

  function restoreLabelMap() {
    labelMap = n64js.getLocalStorageItem('debugLabels') || {};
    refreshLabelSelect();
    updateDebug();
  }

  function storeLabelMap() {
    n64js.setLocalStorageItem('debugLabels', labelMap);
  }

  n64js.initialiseDebugger = function () {
    $debugContent   = $('#debug-content');
    $status         = $('#status');
    $registers      = [$('#cpu0-content'), $('#cpu1-content')];
    $disassembly    = $('#disasm');
    $dynarecContent = $('#dynarec-content');
    $memoryContent  = $('#memory-content');

    logger.initialise($('.output'), () => {
      return format.toString32(n64js.cpu0.pc);
    });

    n64js.addResetCallback(onReset);

    $('#output').find('#clear').click(function () {
      logger.clear();
    });

    $('#cpu-controls').find('#speed').change(function () {
      debugCycles = Math.pow(10, $(this).val() | 0);
      logger.log('Speed is now ' + debugCycles);
    });

    $('#cpu').find('#address').change(function () {
      disasmAddress = parseInt($(this).val(), 16);
      updateDebug();
    });
    refreshLabelSelect();

    $memoryContent.find('input').change(function () {
      lastMemoryAccessAddress = parseInt($(this).val(), 16);
      updateMemoryView();
    });
    updateMemoryView();

    const kEnter    = 13;
    const kPageUp   = 33;
    const kPageDown = 34;
    const kLeft     = 37;
    const kUp       = 38;
    const kRight    = 39;
    const kDown     = 40;
    const kF10      = 121;
    const kF9       = 120;
    const kF8       = 119;

    $('body').keydown(function (event) {
      let consumed = false;
      switch (event.which) {
        case kDown:     consumed = true; disassemblerDown();             break;
        case kUp:       consumed = true; disassemblerUp();               break;
        case kPageDown: consumed = true; disassemblerPageDown();         break;
        case kPageUp:   consumed = true; disassemblerPageUp();           break;
        case kF8:       consumed = true; n64js.toggleRun();              break;
        case kF9:       consumed = true; n64js.toggleDebugDisplayList(); break;
        case kF10:      consumed = true; n64js.step();                   break;
        //default: alert( 'code:' + event.which);
      }
      if (consumed) {
        event.preventDefault();
      }
    });
  };

  function updateMemoryView() {
    let addr = lastMemoryAccessAddress || 0x80000000;
    let $pre = $memoryContent.find('pre');
    $pre.empty().append(makeMemoryTable(addr, 1024));
  }

  function roundDown(x, a) {
    return x & ~(a-1);
  }

  /**
   * Constructs HTML for a table of memory values.
   * @param {number} focusAddress The address to focus on.
   * @param {number} contextBytes The number of bytes of context.
   * @param {number=} bytesPerRow The number of bytes per row. Should be a power of two.
   * @param {Map<number,string>=} highlights Colours to highlight addresses with.
   * @return {!jQuery}
   */
  function makeMemoryTable(focusAddress, contextBytes, bytesPerRow = 64, highlights = null) {
    let s = roundDown(focusAddress, bytesPerRow) - roundDown(contextBytes/2, bytesPerRow);
    let e = s + contextBytes;

    let t = '';
    for (let a = s; a < e; a += bytesPerRow) {
      let r = format.toHex(a, 32) + ':';

      for (let o = 0; o < bytesPerRow; o += 4) {
        let curAddress = a + o >>> 0;
        let mem = n64js.readMemoryInternal32(curAddress);
        let style = '';
        if (highlights && highlights.has(curAddress)) {
          style = ' style="background-color: ' + highlights.get(curAddress) + '"';
        }
        r += ' <span id="mem-' + format.toHex(curAddress, 32) + '"' + style + '>' + format.toHex(mem, 32) + '</span>';
      }

      r += '\n';
      t += r;
    }

    return $('<span>' + t + '</span>');
  }

  // access is {reg,offset,mode}
  function addRecentMemoryAccess(address, mode) {
    let col = (mode === 'store') ? '#faa' : '#ffa';
    if (mode === 'update') {
      col = '#afa';
    }

    let highlights = new Map();
    let alignedAddress = (address & ~3) >>> 0;
    highlights.set(alignedAddress, col);
    return makeMemoryTable(address, 32, 32, highlights);
  }

  function makeLabelColor(address) {
    let i = address >>> 2;  // Lowest bits are always 0
    let hash = (i >>> 16) ^ ((i & 0xffff) * 2803);
    let r = (hash       ) & 0x1f;
    let g = (hash >>>  5) & 0x1f;
    let b = (hash >>> 10) & 0x1f;
    let h = (hash >>> 15) & 0x3;

    r *= 4;
    g *= 4;
    b *= 4;
    switch (h) {
      case 0: r*=2; g*=2; break;
      case 1: g*=2; b*=2; break;
      case 2: b*=2; r*=2; break;
      default: r*=2;g*=2;b*=2; break;
    }

    return '#' + format.toHex(r, 8) + format.toHex(g, 8) + format.toHex(b, 8);
  }

  /**
   * Makes a table of co-processor 0 registers.
   * @param {!Map<string, string>} registerColours Register colour map.
   * @return {!jQuery}
   */
  function makeCop0RegistersTable(registerColours) {
    let cpu0 = n64js.cpu0;
    let $table = $('<table class="register-table"><tbody></tbody></table>');
    let $body = $table.find('tbody');

    const kRegistersPerRow = 2;

    for (let i = 0; i < 32; i+=kRegistersPerRow) {
      let $tr = $('<tr />');
      for (let r = 0; r < kRegistersPerRow; ++r) {
        let name = n64js.cop0gprNames[i+r];
        let $td = $('<td>' + name + '</td><td class="fixed">' + format.toString64(cpu0.gprHi[i+r], cpu0.gprLo[i+r]) + '</td>');

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
  function makeCop1RegistersTable(registerColours) {
    let $table = $('<table class="register-table"><tbody></tbody></table>');
    let $body = $table.find('tbody');
    let cpu1 = n64js.cpu1;

    for (let i = 0; i < 32; ++i) {
      let name = n64js.cop1RegisterNames[i];

      let $td;
      if ((i&1) === 0) {
        $td = $('<td>' + name +
          '</td><td class="fixed fp-w">' + format.toString32(cpu1.uint32[i]) +
          '</td><td class="fixed fp-s">' + cpu1.float32[i] +
          '</td><td class="fixed fp-d">' + cpu1.float64[i/2] +
          '</td>' );
      } else {
        $td = $('<td>' + name +
          '</td><td class="fixed fp-w">' + format.toString32(cpu1.uint32[i]) +
          '</td><td class="fixed fp-s">' + cpu1.float32[i] +
          '</td><td>' +
          '</td>' );
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

  /**
   * Makes a table showing the status register contents.
   * @return {!jQuery}
   */
  function makeStatusTable() {
    let cpu0 = n64js.cpu0;

    let $table = $('<table class="register-table"><tbody></tbody></table>');
    let $body = $table.find('tbody');

    $body.append('<tr><td>Ops</td><td class="fixed">' + cpu0.opsExecuted + '</td></tr>');
    $body.append('<tr><td>PC</td><td class="fixed">' + format.toString32(cpu0.pc) + '</td>' +
                     '<td>delayPC</td><td class="fixed">' + format.toString32(cpu0.delayPC) + '</td></tr>');
    $body.append('<tr><td>EPC</td><td class="fixed">' + format.toString32(cpu0.control[cpu0.kControlEPC]) + '</td></tr>');
    $body.append('<tr><td>MultHi</td><td class="fixed">' + format.toString64(cpu0.multHi[1], cpu0.multHi[0]) + '</td>' +
                     '<td>Cause</td><td class="fixed">' + format.toString32(cpu0.control[cpu0.kControlCause]) + '</td></tr>');
    $body.append('<tr><td>MultLo</td><td class="fixed">' + format.toString64(cpu0.multLo[1], cpu0.multLo[0]) + '</td>' +
                     '<td>Count</td><td class="fixed">' + format.toString32(cpu0.control[cpu0.kControlCount]) + '</td></tr>');
    $body.append('<tr><td></td><td class="fixed"></td>' +
                     '<td>Compare</td><td class="fixed">' + format.toString32(cpu0.control[cpu0.kControlCompare]) + '</td></tr>');

    for (let i = 0; i < cpu0.events.length; ++i) {
      $body.append('<tr><td>Event' + i + '</td><td class="fixed">' + cpu0.events[i].countdown + ', ' + cpu0.events[i].getName() + '</td></tr>');
    }

    $body.append(makeStatusRegisterRow());
    $body.append(makeMipsInterruptsRow());
    return $table;
  }

  function makeStatusRegisterRow() {
    let $tr = $('<tr />');
    $tr.append( '<td>SR</td>' );

    const flagNames = ['IE', 'EXL', 'ERL' ];//, '', '', 'UX', 'SX', 'KX' ];

    let sr = n64js.cpu0.control[n64js.cpu0.kControlSR];

    let $td = $('<td class="fixed" />');
    $td.append(format.toString32(sr));
    $td.append('&nbsp;');

    let i;
    for (i = flagNames.length-1; i >= 0; --i) {
      if (flagNames[i]) {
        let isSet = (sr & (1<<i)) !== 0;

        let $b = $('<span>' + flagNames[i] + '</span>');
        if (isSet) {
          $b.css('font-weight', 'bold');
        }

        $td.append($b);
        $td.append('&nbsp;');
      }
    }

    $tr.append($td);
    return $tr;
  }

  function makeMipsInterruptsRow() {
    const miIntrNames = ['SP', 'SI', 'AI', 'VI', 'PI', 'DP'];

    let miIntrLive = n64js.miIntrReg();
    let miIntrMask = n64js.miIntrMaskReg();

    let $tr = $('<tr />');
    $tr.append( '<td>MI Intr</td>' );
    let $td = $('<td class="fixed" />');
    let i;
    for (i = 0; i < miIntrNames.length; ++i) {
      let isSet = (miIntrLive & (1<<i)) !== 0;
      let isEnabled = (miIntrMask & (1<<i)) !== 0;

      let $b = $('<span>' + miIntrNames[i] + '</span>');
      if (isSet) {
        $b.css('font-weight', 'bold');
      }
      if (isEnabled) {
        $b.css('background-color', '#AFF4BB');
      }

      $td.append($b);
      $td.append('&nbsp;');
    }
    $tr.append($td);
    return $tr;
  }

  function setLabelText($elem, address) {
    if (labelMap.hasOwnProperty(address)) {
      $elem.append(' (' + labelMap[address] + ')');
    }
  }
  function setLabelColor($elem, address) {
    $elem.css('color', makeLabelColor(address));
  }

  function makeLabelText(address) {
    let t = '';
    if (labelMap.hasOwnProperty(address)) {
      t = labelMap[address];
    }
    while (t.length < 20) {
      t += ' ';
    }
    return t;
  }

  function onLabelClicked(e) {
      let $label = $(e.delegateTarget);
      let address = /** @type {number} */($label.data('address')) >>> 0;
      let existing = labelMap[address] || '';
      let $input = $('<input class="input-mini" value="' + existing + '" />');

      $input.keypress(function (event) {
        if (event.which == 13) {
          let newVal = $input.val();
          if (newVal) {
            labelMap[address] = newVal.toString();
          } else {
            delete labelMap[address];
          }
          storeLabelMap();
          refreshLabelSelect();
          updateDebug();
        }
      });
      $input.blur(function () {
        $label.html(makeLabelText(address));
      });
      $label.empty().append($input);
      $input.focus();
  }

  function onFragmentClicked(e) {
      let $elem = $(e.delegateTarget);
      let frag = $elem.data('fragment');
      logger.log('<pre>' + frag.func.toString() + '</pre>');
  }

  function onClickBreakpoint(e) {
    let $elem = $(e.delegateTarget);
    let address = /** @type {number} */($elem.data('address')) >>> 0;
    n64js.toggleBreakpoint(address);
    updateDebug();
  }

  function updateDebug() {
    // If the pc has changed since the last update, recenter the display (e.g. when we take a branch)
    if (n64js.cpu0.pc !== lastPC) {
      disasmAddress = n64js.cpu0.pc;
      lastPC = n64js.cpu0.pc;
    }

    // Figure out if we've just stepped by a single instruction. Ergh.
    let cpuCount = n64js.cpu0.getCount();
    let isSingleStep = lastCycles === (cpuCount-1);
    lastCycles = cpuCount;

    let fragmentMap = getFragmentMap();
    let disassembly = n64js.disassemble(disasmAddress - 64, disasmAddress + 64);

    let $disGutter = $('<pre/>');
    let $disText   = $('<pre/>');
    let currentInstruction;

    for (let i = 0; i < disassembly.length; ++i) {
      let a = disassembly[i];
      let address = a.instruction.address;
      let isTarget = a.isJumpTarget || labelMap.hasOwnProperty(address);
      let addressStr = (isTarget ? '<span class="dis-address-target">' : '<span class="dis-address">') + format.toHex(address, 32) + ':</span>';
      let label = '<span class="dis-label">' + makeLabelText(address) + '</span>';
      let t = addressStr + '  ' + format.toHex(a.instruction.opcode, 32) + '  ' + label + a.disassembly;

      let fragment = fragmentMap.get(address);
      if (fragment) {
        t += '<span class="dis-fragment-link"> frag - ops=' + fragment.opsCompiled + ' hit=' + fragment.executionCount + '</span>';
      }

      let $line = $('<span class="dis-line">' + t + '</span>');
      $line.find('.dis-label')
        .data('address', address)
        .css('color', makeLabelColor(address))
        .click(onLabelClicked);

      if (fragment) {
        $line.find('.dis-fragment-link')
          .data('fragment', fragment)
          .click(onFragmentClicked);
      }

      // Keep track of the current instruction (for register formatting) and highlight.
      if (address === n64js.cpu0.pc) {
        currentInstruction = a.instruction;
        $line.addClass('dis-line-cur');
      }
      if (isTarget) {
        $line.addClass('dis-line-target');

        setLabelColor($line.find('.dis-address-target'), address);
      }

      $disText.append($line);
      $disText.append('<br>');

      let bpText = '&nbsp;';
      if (n64js.isBreakpoint(address)) {
        bpText = '&bull;';
      }
      let $bp = $('<span>' + bpText + '</span>').data('address', address).click(onClickBreakpoint);

      $disGutter.append($bp);
      $disGutter.append('<br>');
    }

    // Links for branches, jumps etc should jump to the target address.
    $disText.find('.dis-address-jump').each(function () {
      let address = parseInt($(this).text(), 16);

      setLabelText($(this), address);
      setLabelColor($(this), address);

      $(this).click(function () {
        disasmAddress = address;
        n64js.refreshDebugger();
      });
    });

    let registerColours = makeRegisterColours(currentInstruction);
    for (let [reg, colour] of registerColours) {
      $disText.find('.dis-reg-' + reg).css('background-color', colour);
    }

    $disassembly.find('.dis-recent-memory').html(makeRecentMemoryAccesses(isSingleStep, currentInstruction));

    $disassembly.find('.dis-gutter').empty().append($disGutter);
    $disassembly.find('.dis-view').empty().append($disText);

    $status.empty().append(makeStatusTable());

    $registers[0].empty().append(makeCop0RegistersTable(registerColours));
    $registers[1].empty().append(makeCop1RegistersTable(registerColours));
  }

  /**
   * Makes a map of colours keyed by register name.
   * @param {?Object} instruction The instruction to produce colours for.
   * @return {!Map<string, string>}
   */
  function makeRegisterColours(instruction) {
    const availColours = [
      '#F4EEAF', // yellow
      '#AFF4BB', // green
      '#F4AFBE'  // blue
    ];

    let registerColours = new Map();
    if (instruction) {
      let nextColIdx = 0;
      for (let i in instruction.srcRegs) {
        if (!registerColours.hasOwnProperty(i)) {
          registerColours.set(i, availColours[nextColIdx++]);
        }
      }
      for (let i in instruction.dstRegs) {
        if (!registerColours.hasOwnProperty(i)) {
          registerColours.set(i, availColours[nextColIdx++]);
        }
      }
    }

    return registerColours;
  }

  function makeRecentMemoryAccesses(isSingleStep, currentInstruction) {
    // Keep a small queue showing recent memory accesses
    if (isSingleStep) {
      // Check if we've just stepped over a previous write op, and update the result
      if (lastStore) {
        if ((lastStore.cycle + 1) === n64js.cpu0.opsExecuted) {
          let updatedElement = addRecentMemoryAccess(lastStore.address, 'update');
          lastStore.element.append(updatedElement);
        }
        lastStore = null;
      }

      if (currentInstruction.memory) {
        let access  = currentInstruction.memory;
        let newAddress = n64js.cpu0.gprLo[access.reg] + access.offset;
        let element = addRecentMemoryAccess(newAddress, access.mode);

        if (access.mode === 'store') {
          lastStore = {
            address: newAddress,
            cycle: n64js.cpu0.opsExecuted,
            element: element,
          };
        }

        recentMemoryAccesses.push({element: element});

        // Nuke anything that happened more than N cycles ago
        //while (recentMemoryAccesses.length > 0 && recentMemoryAccesses[0].cycle+10 < cycle)
        if (recentMemoryAccesses.length > 4) {
          recentMemoryAccesses.splice(0,1);
        }

        lastMemoryAccessAddress = newAddress;
      }
    } else {
      // Clear the recent memory accesses when running.
      recentMemoryAccesses = [];
      lastStore = null;
    }

    let $recent = $('<pre />');
    if (recentMemoryAccesses.length > 0) {
      const fadingColours = ['#bbb', '#999', '#666', '#333'];
      for (let i = 0; i < recentMemoryAccesses.length; ++i) {
        let element = recentMemoryAccesses[i].element;
        element.css('color', fadingColours[i]);
        $recent.append(element);
      }
    }

    return $recent;
  }

  function updateDynarec() {
    let invals = consumeFragmentInvalidationEvents();
    let histogram = new Map();
    let maxBucket = 0;

    // Build a flattened list of all fragments
    let fragmentsList = [];
    for (let [pc, fragment] of getFragmentMap()) {
      let i = fragment.executionCount > 0 ? Math.floor(Math.log10(fragment.executionCount)) : 0;
      histogram.set(i, (histogram.get(i) || 0) + 1);
      fragmentsList.push(fragment);
      maxBucket = Math.max(maxBucket, i);
    }

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
      let range = '< ' + Math.pow(10, i + 1);
      t += '<tr><td>' + range + '</td><td>' + count + '</td></tr>';
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

    createHotFragmentsTable($fragmentDiv, fragmentsList);

    $t.append($fragmentDiv);

    // Evictions
    if (invals.length > 0) {
      t = '';
      t += '<div class="row">';
      t += '<div class="col-lg-6">';
      t += '<table class="table table-condensed">';
      t += '<tr><th>Address</th><th>Length</th><th>System</th><th>Fragments Removed</th></tr>';
      for (let i = 0; i < invals.length; ++i) {
        let vals = [
          format.toString32(invals[i].address),
          invals[i].length,
          invals[i].system,
          invals[i].fragmentsRemoved,
        ];
        t += '<tr><td>' + vals.join('</td><td>') + '</td></tr>';
      }
      t += '</table>';
      t += '</div>';
      t += '</div>';
      $t.append(t);
    }

    $dynarecContent.empty().append($t);
  }

  function createHotFragmentsTable($fragmentDiv, fragmentsList) {
    let $code = $fragmentDiv.find('#fragment-code');
    let $table = $('<table class="table table-condensed" />');
    let columns = ['Address', 'Execution Count', 'Length', 'ExecCount * Length'];

    $table.append('<tr><th>' + columns.join('</th><th>') + '</th></tr>');
    for (let i = 0; i < fragmentsList.length && i < 20; ++i) {
      let fragment = fragmentsList[i];
      let vals = [
        format.toString32(fragment.entryPC),
        fragment.executionCount,
        fragment.opsCompiled,
        fragment.executionCount * fragment.opsCompiled
      ];
      let $tr = $('<tr><td>' + vals.join('</td><td>') + '</td></tr>');
      initFragmentRow($tr, fragment, $code);
      $table.append($tr);
    }
    $fragmentDiv.find('#fragments').append($table);

    if (fragmentsList.length > 0) {
      $code.append('<pre>' + fragmentsList[0].func.toString() + '</pre>');
    }
  }

  function initFragmentRow($tr, fragment, $code) {
    $tr.click(() => {
      $code.html('<pre>' + fragment.func.toString() + '</pre>');
    });
  }

  function disassemblerDown() {
    disasmAddress += 4;
    n64js.refreshDebugger();
  }

  function disassemblerUp() {
    disasmAddress -= 4;
    n64js.refreshDebugger();
  }

  function disassemblerPageDown() {
    disasmAddress += 64;
    n64js.refreshDebugger();
  }

  function disassemblerPageUp() {
    disasmAddress -= 64;
    n64js.refreshDebugger();
  }

  n64js.refreshDebugger = function () {
    if ($dynarecContent.hasClass('active')) {
      updateDynarec();
    }

    if ($debugContent.hasClass('active')) {
      updateDebug();
    }

    if ($memoryContent.hasClass('active')) {
      updateMemoryView();
    }
  };

}(window.n64js = window.n64js || {}));
