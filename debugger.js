(function (n64js) {'use strict';

  var $debugContent   = null;
  var $status         = null;
  var $registers      = null;
  var $disassembly    = null;
  var $dynarecContent = null;
  var $memoryContent  = null;
  var $output         = null;

  var disasmAddress = 0;
  var lastCycles;
  var lastPC               = -1;
  var recentMemoryAccesses = [];
  var lastMemoryAccessAddress;
  var lastStore;                  // When we execute a store instruction, keep track of some details so we can show the value that was written

  var labelMap = {
    0x80328730: 'setFP',
    0x8032b030: 'siIsBusy',
    0x80328740: 'siReadPIFControl',
    0x80328790: 'siWritePIFControl',
    0x80324258: 'mult64',
    0x80324158: 'div64'
  };

  n64js.initialiseDebugger = function () {
    $debugContent   = $('#debug-content');
    $status         = $('#status');
    $registers      = [$('#cpu0-content'), $('#cpu1-content')];
    $disassembly    = $('#disasm');
    $output         = $('.output');
    $dynarecContent = $('#dynarec-content');
    $memoryContent  = $('#memory-content');

    $('#output').find('#clear').click(function () {
      n64js.clearLog();
    });

    $('#cpu').find('input').change(function () {
      disasmAddress = parseInt($(this).val());
      updateDebug();
    });

    var addr = 0x80000000;
    $memoryContent.find('input').change(function () {
      lastMemoryAccessAddress = parseInt($(this).val());
      updateMemoryView();
    });
    updateMemoryView();


    var kEnter    = 13;
    var kPageUp   = 33;
    var kPageDown = 34;
    var kLeft     = 37;
    var kUp       = 38;
    var kRight    = 39;
    var kDown     = 40;
    var kF10      = 121;
    var kF9       = 120;
    var kF8       = 119;

    $('body').keydown(function (event) {
      var consumed = false;
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
    var addr = lastMemoryAccessAddress || 0x80000000;
    $memoryContent.find('pre').html( makeMemoryTable(addr, 1024) );
  }

  // bytes_per_row should be power-of-two
  function makeMemoryTable(focus_address, context_bytes, bytes_per_row, highlights) {
    bytes_per_row = bytes_per_row || 64;
    highlights = highlights || {};

    function roundDown(x, a) {
      return x & ~(a-1);
    }

    var s = roundDown(focus_address, bytes_per_row) - roundDown(context_bytes/2, bytes_per_row);
    var e = s + context_bytes;

    var t = '';

    var a, o;

    for (a = s; a < e; a += bytes_per_row) {
      var r = n64js.toHex(a, 32) + ':';

      for (o = 0; o < bytes_per_row; o += 4) {
        var cur_address = a+o >>> 0;
        var mem = n64js.readMemoryInternal32(cur_address);

        var style = '';
        if (highlights.hasOwnProperty(cur_address)) {
          style = ' style="background-color: ' + highlights[cur_address] + '"';
        }

        r += ' <span id="mem-' + n64js.toHex(cur_address, 32) + '"' + style + '>' + n64js.toHex(mem, 32) + '</span>';
      }

      r += '\n';
      t += r;
    }

    return $('<span>' + t + '</span>');
  }

  // access is {reg,offset,mode}
  function addRecentMemoryAccess(address, mode) {

    var col = (mode === 'store') ? '#faa' : '#ffa';
    if (mode === 'update') {
      col = '#afa';
    }

    var highlights = {};
    var aligned_addr = (address&~3)>>>0;
    highlights[aligned_addr] = col;

    return makeMemoryTable(address, 32, 32, highlights);
  }

  function makeLabelColor(address) {
    var i = (address>>>2);  // Lowest bits are always 0
    var hash = (i>>>16) ^ ((i&0xffff) * 2803);
    var r = (hash     )&0x1f;
    var g = (hash>>> 5)&0x1f;
    var b = (hash>>>10)&0x1f;
    var h = (hash>>>15)&0x3;

    r = (r*4);
    g = (g*4);
    b = (b*4);
    if (h === 0) {
      r*=2; g*=2;
    } else if (h === 1) {
      g*=2; b*=2;
    } else if (h === 2) {
      b*=2; r*=2;
    } else {
      r*=2;g*=2;b*=2;
    }

    return '#' + n64js.toHex(r,8) + n64js.toHex(g,8) + n64js.toHex(b,8);
  }

  function addCop1($tb, regColours) {

    var cpu1 = n64js.cpu1;

    var i, $tr, $td;
    for (i = 0; i < 32; ++i) {
      var name = n64js.cop1RegisterNames[i];

      if ((i&1) === 0) {
        $td = $('<td>' + name +
          '</td><td class="fixed fp-w">' + n64js.toString32(cpu1.uint32[i]) +
          '</td><td class="fixed fp-s">' + cpu1.float32[i] +
          '</td><td class="fixed fp-d">' + cpu1.float64[i/2] +
          '</td>' );
      } else {
        $td = $('<td>' + name +
          '</td><td class="fixed fp-w">' + n64js.toString32(cpu1.uint32[i]) +
          '</td><td class="fixed fp-s">' + cpu1.float32[i] +
          '</td><td>' +
          '</td>' );
      }

      $tr = $('<tr />');
      $tr.append($td);

      if (regColours.hasOwnProperty(name)) {
        $tr.attr('bgcolor', regColours[name]);
      } else if (regColours.hasOwnProperty(name + '-w')) {
        $tr.find('.fp-w').attr('bgcolor', regColours[name + '-w']);
      } else if (regColours.hasOwnProperty(name + '-s')) {
        $tr.find('.fp-s').attr('bgcolor', regColours[name + '-s']);
      } else if (regColours.hasOwnProperty(name + '-d')) {
        $tr.find('.fp-d').attr('bgcolor', regColours[name + '-d']);
      }

      $tb.append($tr);
    }
  }

  function addSR($tb) {
    var $tr = $('<tr />');
    $tr.append( '<td>SR</td>' );

    var flag_names = ['IE', 'EXL', 'ERL' ];//, '', '', 'UX', 'SX', 'KX' ];

    var sr = n64js.cpu0.control[n64js.cpu0.kControlSR];

    var $td = $('<td />');
    $td.append( n64js.toString32(sr) );
    $td.append('&nbsp;');

    var i;
    for (i = flag_names.length-1; i >= 0; --i) {
      if (flag_names[i]) {
        var is_set = (sr & (1<<i)) !== 0;

        var $b = $('<span>' + flag_names[i] + '</span>');
        if (is_set) {
          $b.css('font-weight', 'bold');
        }

        $td.append($b);
        $td.append('&nbsp;');
      }
    }

    $tr.append($td);
    $tb.append($tr);
  }

  function addMipsInterrupts($tb) {
    var mi_intr_names = ['SP', 'SI', 'AI', 'VI', 'PI', 'DP'];

    var mi_intr_live = n64js.miIntrReg();
    var mi_intr_mask = n64js.miIntrMaskReg();

    var $tr = $('<tr />');
    $tr.append( '<td>MI Intr</td>' );
    var $td = $('<td />');
    var i;
    for (i = 0; i < mi_intr_names.length; ++i) {
      var is_set     = (mi_intr_live & (1<<i)) !== 0;
      var is_enabled = (mi_intr_mask & (1<<i)) !== 0;

      var $b = $('<span>' + mi_intr_names[i] + '</span>');
      if (is_set) {
        $b.css('font-weight', 'bold');
      }
      if (is_enabled) {
        $b.css('background-color', '#AFF4BB');
      }

      $td.append($b);
      $td.append('&nbsp;');
    }
    $tr.append($td);
    $tb.append($tr);
  }

  function makeStatusTable() {
    var cpu0 = n64js.cpu0;

    var $status_table = $('<table class="register-table"><tbody></tbody></table>');
    var $status_body = $status_table.find('tbody');

    $status_body.append('<tr><td>Ops</td><td class="fixed">' + cpu0.opsExecuted + '</td></tr>');
    $status_body.append('<tr><td>PC</td><td class="fixed">' + n64js.toString32(cpu0.pc) + '</td><td>delayPC</td><td class="fixed">' + n64js.toString32(cpu0.delayPC) + '</td></tr>');
    $status_body.append('<tr><td>EPC</td><td class="fixed">' + n64js.toString32(cpu0.control[cpu0.kControlEPC]) + '</td></tr>');
    $status_body.append('<tr><td>MultHi</td><td class="fixed">' + n64js.toString64(cpu0.multHi[1], cpu0.multHi[0]) +
                        '</td><td>Cause</td><td class="fixed">' + n64js.toString32(n64js.cpu0.control[n64js.cpu0.kControlCause]) + '</td></tr>');
    $status_body.append('<tr><td>MultLo</td><td class="fixed">' + n64js.toString64(cpu0.multLo[1], cpu0.multLo[0]) +
                        '</td><td>Count</td><td class="fixed">' + n64js.toString32(n64js.cpu0.control[n64js.cpu0.kControlCount]) + '</td></tr>');
    $status_body.append('<tr><td></td><td class="fixed">' +
                      '</td><td>Compare</td><td class="fixed">' + n64js.toString32(n64js.cpu0.control[n64js.cpu0.kControlCompare]) + '</td></tr>');

    var i;
    for (i = 0; i < cpu0.events.length; ++i) {
      $status_body.append('<tr><td>Event' + i + '</td><td class="fixed">' + cpu0.events[i].countdown + ', ' + cpu0.events[i].getName() + '</td></tr>');
    }

    addSR($status_body);
    addMipsInterrupts($status_body);

    return $status_table;
  }

  function updateDebug() {
    var i, element;
    var cpu0 = n64js.cpu0;

    // If the pc has changed since the last update, recenter the display (e.g. when we take a branch)
    if (cpu0.pc !== lastPC) {
      disasmAddress = cpu0.pc;
      lastPC = cpu0.pc;
    }

    var cpu_count = cpu0.getCount();
    var is_single_step = lastCycles === (cpu_count-1);
    lastCycles = cpu_count;

    var cur_instr;

    var disassembly = n64js.disassemble(disasmAddress - 64, disasmAddress + 64);
    var dis_body = disassembly.map(function (a) {

      var label_span = a.isJumpTarget ? '<span class="dis-label-target">' : '<span class="dis-label">';
      var label      = label_span    + n64js.toHex(a.instruction.address, 32) + ':</span>';
      var t          = label + '   ' + n64js.toHex(a.instruction.opcode, 32) + '    ' + a.disassembly;
      if (a.instruction.address === cpu0.pc) {
        cur_instr = a.instruction;
        t = '<span style="background-color: #ffa">' + t + '</span>';
      }
      return t;
    }).join('<br>');

    // Keep a small queue showing recent memory accesses
    if (is_single_step) {
      // Check if we've just stepped over a previous write op, and update the result
      if (lastStore) {
        if (lastStore.cycle+1 === cpu0.opsExecuted) {
          var updated_element = addRecentMemoryAccess(lastStore.address, 'update');
          lastStore.element.append(updated_element);
        }
        lastStore = undefined;
      }

      if (cur_instr.memory) {
        var access   = cur_instr.memory;
        var new_addr = n64js.cpu0.gprLo[access.reg] + access.offset;
        element      = addRecentMemoryAccess(new_addr, access.mode);

        if (access.mode === 'store') {
          lastStore = {address:new_addr, cycle:cpu0.opsExecuted, element:element};
        }

        recentMemoryAccesses.push({element:element});

        // Nuke anything that happened more than N cycles ago
        //while (recentMemoryAccesses.length > 0 && recentMemoryAccesses[0].cycle+10 < cycle)
        if (recentMemoryAccesses.length > 4) {
          recentMemoryAccesses.splice(0,1);
        }

        lastMemoryAccessAddress = new_addr;
      }
    } else {
      // Clear the recent memory accesses when running.
      recentMemoryAccesses = [];
      lastStore = undefined;
    }

    var regColours = {};

    var availColours = [
      '#F4EEAF', // yellow
      '#AFF4BB', // green
      '#F4AFBE'  // blue
    ];

    if (cur_instr) {
      var nextColIdx = 0;
      for (i in cur_instr.srcRegs) {
        if (!regColours.hasOwnProperty(i)) {
          regColours[i] = availColours[nextColIdx++];
        }
      }
      for (i in cur_instr.dstRegs) {
        if (!regColours.hasOwnProperty(i)) {
          regColours[i] = availColours[nextColIdx++];
        }
      }
    }

    var $dis = $('<pre>' + dis_body + '</pre>');
    $dis.find('.dis-label').each(function (){
      var address = parseInt($(this).text(), 16);
      if (labelMap.hasOwnProperty(address)) {
        $(this).prepend(labelMap[address] + '\n');
      }
    });
    $dis.find('.dis-label-target').each(function (){
      var address = parseInt($(this).text(), 16);

      if (labelMap.hasOwnProperty(address)) {
        $(this).text(labelMap[address]);
      }

      $(this).css('color', makeLabelColor(address));
      $(this).click(function () {
        disasmAddress = address;
        n64js.refreshDebugger();
      });
    });

    $disassembly.html('');

    if (recentMemoryAccesses.length > 0) {
      var $recent = $('<pre />');
      var fading_cols = ['#bbb', '#999', '#666', '#333'];
      for (i = 0; i < recentMemoryAccesses.length; ++i) {
        element = recentMemoryAccesses[i].element;
        element.css('color', fading_cols[i]);
        $recent.append(element);
      }
      $disassembly.append($recent);
    }

    $disassembly.append($dis);

    for (i in regColours) {
      $dis.find('.dis-reg-' + i).css('background-color', regColours[i]);
    }

    $status.html(makeStatusTable());


    var $table0 = $('<table class="register-table"><tbody></tbody></table>');
    var $body0 = $table0.find('tbody');

    var kRegistersPerRow = 2;
    for (i = 0; i < 32; i+=kRegistersPerRow) {
      var $tr = $('<tr />');
      var r;
      for (r = 0; r < kRegistersPerRow; ++r) {

        var name = n64js.cop0gprNames[i+r];
        var $td = $('<td>' + name + '</td><td class="fixed">' + n64js.toString64(cpu0.gprHi[i+r], cpu0.gprLo[i+r]) + '</td>');

        if (regColours.hasOwnProperty(name)) {
          $td.attr('bgcolor', regColours[name]);
        }

        $tr.append($td);
      }
      $body0.append($tr);
    }

    $registers[0].html($table0);


    var $table1 = $('<table class="register-table"><tbody></tbody></table>');
    addCop1($table1.find('tbody'), regColours);
    $registers[1].html($table1);
  }

  function initFragmentRow($tr, fragment, $code) {
    $tr.click(function () {
      $code.html('<pre>' + fragment.func.toString() + '</pre>');
    });
  }

  function createHotFragmentsTable($fragment_div, fragments_list) {
    var $code = $fragment_div.find('#fragment_code');

    var $table = $('<table class="table table-condensed" />');

    var columns = ['Address', 'Execution Count', 'Length', 'ExecCount * Length'];

    $table.append('<tr><th>' + columns.join('</th><th>') + '</th></tr>');
    var i;
    for (i = 0; i < fragments_list.length && i < 20; ++i) {
      var fragment = fragments_list[i];

      var vals = [
        n64js.toString32(fragment.entryPC),
        fragment.executionCount,
        fragment.opsCompiled,
        fragment.executionCount * fragment.opsCompiled
      ];

      var $tr = $('<tr><td>' + vals.join('</td><td>') + '</td></tr>');
      initFragmentRow($tr, fragment, $code);
      $table.append($tr);
    }

    $fragment_div.find('#fragments').append($table);

    if (fragments_list.length > 0) {
      $code.append('<pre>' + fragments_list[0].func.toString() + '</pre>');
    }
  }

  function log10(x) {
    return Math.log(x) / Math.log(10);
  }

  function updateDynarec() {

    var fragmentMap = n64js.getFragmentMap();
    var invals = n64js.getFragmentInvalidationEvents();
    var histo = {};

    // Build a flattened list of all fragments
    var fragments_list = [];

    var i;
    for(i in fragmentMap) {
      if (fragmentMap.hasOwnProperty(i)) {
        var fragment = fragmentMap[i];
        var logv     = fragment.executionCount > 0 ? Math.floor(log10(fragment.executionCount)) : 0;

        histo[logv] = (histo[logv] || 0) + 1;

        fragments_list.push(fragment);
      }
    }

    fragments_list.sort(function (a,b) {
      return b.opsCompiled*b.executionCount - a.opsCompiled*a.executionCount;
    });

    var $t = $('<div />');

    // Histogram showing execution counts
    var t = '';
    t += '<div class="row-fluid">';
    t += '<div class="span4"><table class="table table-condensed"><tr><th>Execution Count</th><th>Frequency</th></tr>';
    for(i in histo) {
      var v = Number(i);
      var range = Math.pow(10, v) + '..' + Math.pow(10, v+1);
      t += '<tr><td>' + range + '</td><td>' + histo[i] + '</td></tr>';
    }
    t += '</table></div>';
    t += '</div>';
    $t.append(t);

    // Table of hot fragments, and the corresponding js
    t = '';
    t += '<div class="row-fluid">';
    t += '  <div class="span6" id="fragments" />';
    t += '  <div class="span6" id="fragment_code" />';
    t += '</div>';
    var $fragment_div = $(t);

    createHotFragmentsTable($fragment_div, fragments_list);

    $t.append($fragment_div);

    // Evictions
    if (invals.length > 0) {
      t = '';
      t += '<div class="row-fluid">';
      t += '<div class="span6"><table class="table table-condensed"><tr><th>Address</th><th>Length</th><th>System</th><th>Fragments Removed</th></tr>';
      for (i = 0; i < invals.length; ++i) {

        var vals = [
          n64js.toString32(invals[i].address),
          invals[i].length,
          invals[i].system,
          invals[i].fragmentsRemoved
        ];

        t += '<tr><td>' + vals.join('</td><td>') + '</td></tr>';
      }
      t += '</table></div>';
      t += '</div>';

      $t.append(t);
    }

    $dynarecContent.html($t);
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

  n64js.clearLog = function () {
    $output.html('');
  };

  n64js.log = function (s) {
    $output.append(n64js.toString32(n64js.cpu0.pc) + ': ' + s + '<br>');
    $output.scrollTop($output[0].scrollHeight);
  };

  n64js.outputAppendHTML = function (s) {
    $output.append(s);
  };

}(window.n64js = window.n64js || {}));
