if (typeof n64js === 'undefined') {
  var n64js = {};
}

(function () {'use strict';

  var SP_MEM_ADDR_REG     = 0x00;
  var SP_DRAM_ADDR_REG    = 0x04;
  var SP_RD_LEN_REG       = 0x08;
  var SP_WR_LEN_REG       = 0x0C;
  var SP_STATUS_REG       = 0x10;
  var SP_DMA_FULL_REG     = 0x14;
  var SP_DMA_BUSY_REG     = 0x18;
  var SP_SEMAPHORE_REG    = 0x1C;

  var SP_CLR_HALT           = 0x0000001;
  var SP_SET_HALT           = 0x0000002;
  var SP_CLR_BROKE          = 0x0000004;
  var SP_CLR_INTR           = 0x0000008;
  var SP_SET_INTR           = 0x0000010;
  var SP_CLR_SSTEP          = 0x0000020;
  var SP_SET_SSTEP          = 0x0000040;
  var SP_CLR_INTR_BREAK     = 0x0000080;
  var SP_SET_INTR_BREAK     = 0x0000100;
  var SP_CLR_SIG0           = 0x0000200;
  var SP_SET_SIG0           = 0x0000400;
  var SP_CLR_SIG1           = 0x0000800;
  var SP_SET_SIG1           = 0x0001000;
  var SP_CLR_SIG2           = 0x0002000;
  var SP_SET_SIG2           = 0x0004000;
  var SP_CLR_SIG3           = 0x0008000;
  var SP_SET_SIG3           = 0x0010000;
  var SP_CLR_SIG4           = 0x0020000;
  var SP_SET_SIG4           = 0x0040000;
  var SP_CLR_SIG5           = 0x0080000;
  var SP_SET_SIG5           = 0x0100000;
  var SP_CLR_SIG6           = 0x0200000;
  var SP_SET_SIG6           = 0x0400000;
  var SP_CLR_SIG7           = 0x0800000;
  var SP_SET_SIG7           = 0x1000000;

  var SP_STATUS_HALT        = 0x0001;
  var SP_STATUS_BROKE       = 0x0002;
  var SP_STATUS_DMA_BUSY    = 0x0004;
  var SP_STATUS_DMA_FULL    = 0x0008;
  var SP_STATUS_IO_FULL     = 0x0010;
  var SP_STATUS_SSTEP       = 0x0020;
  var SP_STATUS_INTR_BREAK  = 0x0040;
  var SP_STATUS_SIG0        = 0x0080;
  var SP_STATUS_SIG1        = 0x0100;
  var SP_STATUS_SIG2        = 0x0200;
  var SP_STATUS_SIG3        = 0x0400;
  var SP_STATUS_SIG4        = 0x0800;
  var SP_STATUS_SIG5        = 0x1000;
  var SP_STATUS_SIG6        = 0x2000;
  var SP_STATUS_SIG7        = 0x4000;

  var SP_STATUS_YIELD       = SP_STATUS_SIG0;
  var SP_STATUS_YIELDED     = SP_STATUS_SIG1;
  var SP_STATUS_TASKDONE    = SP_STATUS_SIG2;


  var MI_MODE_REG         = 0x00;
  var MI_VERSION_REG      = 0x04;
  var MI_INTR_REG         = 0x08;
  var MI_INTR_MASK_REG    = 0x0C;

  var MI_CLR_INIT         = 0x0080;
  var MI_SET_INIT         = 0x0100;
  var MI_CLR_EBUS         = 0x0200;
  var MI_SET_EBUS         = 0x0400;
  var MI_CLR_DP_INTR      = 0x0800;
  var MI_CLR_RDRAM        = 0x1000;
  var MI_SET_RDRAM        = 0x2000;

  var MI_MODE_INIT        = 0x0080;
  var MI_MODE_EBUS        = 0x0100;
  var MI_MODE_RDRAM       = 0x0200;

  var MI_INTR_MASK_CLR_SP = 0x0001;
  var MI_INTR_MASK_SET_SP = 0x0002;
  var MI_INTR_MASK_CLR_SI = 0x0004;
  var MI_INTR_MASK_SET_SI = 0x0008;
  var MI_INTR_MASK_CLR_AI = 0x0010;
  var MI_INTR_MASK_SET_AI = 0x0020;
  var MI_INTR_MASK_CLR_VI = 0x0040;
  var MI_INTR_MASK_SET_VI = 0x0080;
  var MI_INTR_MASK_CLR_PI = 0x0100;
  var MI_INTR_MASK_SET_PI = 0x0200;
  var MI_INTR_MASK_CLR_DP = 0x0400;
  var MI_INTR_MASK_SET_DP = 0x0800;

  var MI_INTR_MASK_SP   = 0x01;
  var MI_INTR_MASK_SI   = 0x02;
  var MI_INTR_MASK_AI   = 0x04;
  var MI_INTR_MASK_VI   = 0x08;
  var MI_INTR_MASK_PI   = 0x10;
  var MI_INTR_MASK_DP   = 0x20;

  var MI_INTR_SP        = 0x01;
  var MI_INTR_SI        = 0x02;
  var MI_INTR_AI        = 0x04;
  var MI_INTR_VI        = 0x08;
  var MI_INTR_PI        = 0x10;
  var MI_INTR_DP        = 0x20;

  var AI_DRAM_ADDR_REG  = 0x00;
  var AI_LEN_REG        = 0x04;
  var AI_CONTROL_REG    = 0x08;
  var AI_STATUS_REG     = 0x0C;
  var AI_DACRATE_REG    = 0x10;
  var AI_BITRATE_REG    = 0x14;

  var VI_STATUS_REG     = 0x00;
  var VI_ORIGIN_REG     = 0x04;
  var VI_WIDTH_REG      = 0x08;
  var VI_INTR_REG       = 0x0C;
  var VI_CURRENT_REG    = 0x10;
  var VI_BURST_REG      = 0x14;
  var VI_V_SYNC_REG     = 0x18;
  var VI_H_SYNC_REG     = 0x1C;
  var VI_LEAP_REG       = 0x20;
  var VI_H_START_REG    = 0x24;
  var VI_V_START_REG    = 0x28;
  var VI_V_BURST_REG    = 0x2C;
  var VI_X_SCALE_REG    = 0x30;
  var VI_Y_SCALE_REG    = 0x34;

  var VI_CONTROL_REG        = VI_STATUS_REG;
  var VI_DRAM_ADDR_REG      = VI_ORIGIN_REG;
  var VI_H_WIDTH_REG        = VI_WIDTH_REG;
  var VI_V_INTR_REG         = VI_INTR_REG;
  var VI_V_CURRENT_LINE_REG = VI_CURRENT_REG;
  var VI_TIMING_REG         = VI_BURST_REG;
  var VI_H_SYNC_LEAP_REG    = VI_LEAP_REG;
  var VI_H_VIDEO_REG        = VI_H_START_REG;
  var VI_V_VIDEO_REG        = VI_V_START_REG;


  var PI_DRAM_ADDR_REG    = 0x00;
  var PI_CART_ADDR_REG    = 0x04;
  var PI_RD_LEN_REG       = 0x08;
  var PI_WR_LEN_REG       = 0x0C;
  var PI_STATUS_REG       = 0x10;
  var PI_BSD_DOM1_LAT_REG = 0x14;
  var PI_BSD_DOM1_PWD_REG = 0x18;
  var PI_BSD_DOM1_PGS_REG = 0x1C;
  var PI_BSD_DOM1_RLS_REG = 0x20;
  var PI_BSD_DOM2_LAT_REG = 0x24;
  var PI_BSD_DOM2_PWD_REG = 0x28;
  var PI_BSD_DOM2_PGS_REG = 0x2C;
  var PI_BSD_DOM2_RLS_REG = 0x30;

  // Values read from status reg
  var PI_STATUS_DMA_BUSY    = 0x01;
  var PI_STATUS_IO_BUSY     = 0x02;
  var PI_STATUS_DMA_IO_BUSY = 0x03;
  var PI_STATUS_ERROR       = 0x04;

  // Values written to status reg
  var PI_STATUS_RESET     = 0x01;
  var PI_STATUS_CLR_INTR  = 0x02;

  var PI_DOM1_ADDR1   = 0x06000000;
  var PI_DOM1_ADDR2   = 0x10000000;
  var PI_DOM1_ADDR3   = 0x1FD00000;
  var PI_DOM2_ADDR1   = 0x05000000;
  var PI_DOM2_ADDR2   = 0x08000000;


  function IsDom1Addr1( address )    { return address >= PI_DOM1_ADDR1 && address < PI_DOM2_ADDR2; }
  function IsDom1Addr2( address )    { return address >= PI_DOM1_ADDR2 && address < 0x1FBFFFFF;    }
  function IsDom1Addr3( address )    { return address >= PI_DOM1_ADDR3 && address < 0x7FFFFFFF;    }
  function IsDom2Addr1( address )    { return address >= PI_DOM2_ADDR1 && address < PI_DOM1_ADDR1; }
  function IsDom2Addr2( address )    { return address >= PI_DOM2_ADDR2 && address < PI_DOM1_ADDR2; }

  var RI_MODE_REG             = 0x00;
  var RI_CONFIG_REG           = 0x04;
  var RI_CURRENT_LOAD_REG     = 0x08;
  var RI_SELECT_REG           = 0x0C;
  var RI_REFRESH_REG          = 0x10;
  var RI_COUNT_REG            = RI_REFRESH_REG;
  var RI_LATENCY_REG          = 0x14;
  var RI_RERROR_REG           = 0x18;
  var RI_WERROR_REG           = 0x1C;
  var RI_LAST_REG             = RI_WERROR_REG;

  var SI_DRAM_ADDR_REG      = 0x00;
  var SI_PIF_ADDR_RD64B_REG = 0x04;
  var SI_PIF_ADDR_WR64B_REG = 0x10;
  var SI_STATUS_REG         = 0x18;

  var SI_STATUS_DMA_BUSY    = 0x0001;
  var SI_STATUS_RD_BUSY     = 0x0002;
  var SI_STATUS_DMA_ERROR   = 0x0008;
  var SI_STATUS_INTERRUPT   = 0x1000;

  function AssertException(message) { this.message = message; }
  AssertException.prototype.toString = function () {
    return 'AssertException: ' + this.message;
  }

  function assert(e,m) {
    if (!e) {
      throw new AssertException(m);
    }
  }
  n64js.assert = assert;

  n64js.log = function (s) {
    $output.append(toString32(n64js.cpu0.pc) + ': ' + s + '<br>');
    $output.scrollTop($output[0].scrollHeight);
  }

  n64js.check = function(e, m) {
    if (!e) {
      n64js.log(m);
    }
  }

  n64js.warn = function(m) {
    n64js.log(m);
  }

  n64js.halt = function (msg) {
    running = false;
    n64js.cpu0.breakExecution();
    n64js.log('<span style="color:red">' + msg + '</span>');
  }

  // Similar to halt, but just relinquishes control to the system
  n64js.returnControlToSystem = function() {
    n64js.cpu0.breakExecution();
  }

  n64js.isRunning = function () {
    return running;
  }

  n64js.toggleRun = function () {
    running = !running;
    return running;
  }

  n64js.setOutputElement = function ($e) {
    $output = $e;
  }

  n64js.setRomInfoElement = function ($e) {
    $rominfo = $e;
  }   

  n64js.setDebugElements = function ($stat, $regs, $disasm) {
    $status      = $stat;
    $registers   = $regs;
    $disassembly = $disasm;
  }

  n64js.setMemoryElement = function ($e) {
    $memory = $e;
  }

  n64js.down = function () {
    disasmAddress += 4;
    n64js.refreshDisplay();
  }

  n64js.up = function () {
    disasmAddress -= 4;
    n64js.refreshDisplay();
  }

  n64js.pageDown = function () {
    disasmAddress += 64;
    n64js.refreshDisplay();
  }

  n64js.pageUp = function () {
    disasmAddress -= 64;
    n64js.refreshDisplay();
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
      b*=2; r*=2
    } else {
      r*=2;g*=2;b*=2;
    }

    return '#' + n64js.toHex(r,8) + n64js.toHex(g,8) + n64js.toHex(b,8);
  }

  var lastCycles;
  var lastPC               = -1;
  var recentMemoryAccesses = [];
  var lastMemoryAccessAddress;
  var lastStore;                  // When we execute a store instruction, keep track of some details so we can show the value that was written

  // access is {reg,offset,mode}
  function addRecentMemoryAccess(address, mode, cycle) {

    var col = (mode === 'store') ? '#faa' : '#ffa';
    if (mode == 'update') {
      col = '#afa';
    }

    var highlights = {};
    var aligned_addr = (address&~3)>>>0;
    highlights[aligned_addr] = col;

    return makeMemoryTable(address, 32, 32, highlights);
  }


  n64js.refreshDisplay = function () {

    var cpu0 = n64js.cpu0;

    // If the pc has changed since the last update, recenter the display (e.g. when we take a branch)
    if (cpu0.pc !== lastPC) {
      disasmAddress = cpu0.pc;
      lastPC = cpu0.pc;
    }

    var is_single_step = lastCycles === (cpu0.opsExecuted-1);
    lastCycles = cpu0.opsExecuted;

    var cur_instr;

    var disassembly = n64js.disassemble(disasmAddress - 64, disasmAddress + 64);
    var dis_body = disassembly.map(function (a) {
    
      var label_span = a.isJumpTarget ? '<span class="dis-label-target">' : '<span class="dis-label">';
      var label      = label_span    + n64js.toHex(a.instruction.address, 32) + ':</span>';
      var t          = label + '   ' + n64js.toHex(a.instruction.opcode, 32) + '    ' + a.disassembly;
      if (a.instruction.address == cpu0.pc) {
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
        var element  = addRecentMemoryAccess(new_addr, access.mode);

        if (access.mode === 'store') {
          lastStore = {address:new_addr, cycle:cpu0.opsExecuted, element:element};
        }

        recentMemoryAccesses.push({element:element});

        // Nuke anything that happened more than N cycles ago
        //while (recentMemoryAccesses.length > 0 && recentMemoryAccesses[0].cycle+10 < cycle)
        if (recentMemoryAccesses.length > 4)
          recentMemoryAccesses.splice(0,1);

        lastMemoryAccessAddress = new_addr;
      }
    } else {
      // Clear the recent memory accesses when running.
      recentMemoryAccesses = [];
      lastStore = undefined;
    }


    var labelMap = {
      0x80328730: 'setFP',
      0x8032b030: 'siIsBusy',
      0x80328740: 'siReadPIFControl',
      0x80328790: 'siWritePIFControl',
      0x80324258: 'mult64',
      0x80324158: 'div64'
    };

    var regColours = {};

    var availColours = [
      '#F4EEAF', // yellow
      '#AFF4BB', // green
      '#F4AFBE'  // blue
    ];

    if (cur_instr) {
      var nextColIdx = 0;
      for (var i in cur_instr.srcRegs) {
        if (!regColours.hasOwnProperty(i)) {
          regColours[i] = availColours[nextColIdx++];
        }
      }
      for (var i in cur_instr.dstRegs) {
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
        n64js.refreshDisplay();
      });
    });

    $disassembly.html('');

    if (recentMemoryAccesses.length > 0) {
      var $recent = $('<pre />');
      var fading_cols = ['#bbb', '#999', '#666', '#333'];
      for (var i = 0; i < recentMemoryAccesses.length; ++i) {
        var element = recentMemoryAccesses[i].element;
        element.css('color', fading_cols[i]);
        $recent.append(element);
      }
      $disassembly.append($recent);
    }

    $disassembly.append($dis);

    for (var i in regColours) {
      $dis.find('.dis-reg-' + i).css('background-color', regColours[i]);
    }

    $status.html(makeStatusTable());


    var $table0 = $('<table class="register-table"><tbody></tbody></table>');
    var $body0 = $table0.find('tbody');

    var kRegistersPerRow = 2;
    for (var i = 0; i < 32; i+=kRegistersPerRow) {
      var $tr = $('<tr />');
      for (var r = 0; r < kRegistersPerRow; ++r) {

        var name = n64js.cop0gprNames[i+r];
        var $td = $('<td>' + name + '</td><td class="fixed">' + toString64(cpu0.gprHi[i+r], cpu0.gprLo[i+r]) + '</td>');

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

    var $mem = $('<pre></pre>');
    $mem.append( makeMemoryTable(lastMemoryAccessAddress || 0x80000000, 1024) );
    $memory.html($mem);
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

    for (var a = s; a < e; a += bytes_per_row) {
      var r = toHex(a, 32) + ':';

      for (var o = 0; o < bytes_per_row; o += 4) {
        var cur_address = a+o >>> 0;
        var mem = n64js.readMemoryInternal32(cur_address);

        var style = '';
        if (highlights.hasOwnProperty(cur_address))
          style = ' style="background-color: ' + highlights[cur_address] + '"'; 

        r += ' <span id="mem-' + toHex(cur_address, 32) + '"' + style + '>' + toHex(mem, 32) + '</span>';
      }

      r += '\n';
      t += r;
    }

    return $('<span>' + t + '</span>');
  }

  function makeStatusTable() {
    var cpu0 = n64js.cpu0;

    var $status_table = $('<table class="register-table"><tbody></tbody></table>');
    var $status_body = $status_table.find('tbody');

    $status_body.append('<tr><td>Ops</td><td class="fixed">' + cpu0.opsExecuted + '</td></tr>');
    $status_body.append('<tr><td>PC</td><td class="fixed">' + toString32(cpu0.pc) + '</td><td>delayPC</td><td class="fixed">' + toString32(cpu0.delayPC) + '</td></tr>');
    $status_body.append('<tr><td>MultHi</td><td class="fixed">' + toString64(cpu0.multHi[1], cpu0.multHi[0]) +
              '</td><td>Cause</td><td class="fixed">' + toString32(n64js.cpu0.control[n64js.cpu0.kControlCause]) + '</td></tr>');
    $status_body.append('<tr><td>MultLo</td><td class="fixed">' + toString64(cpu0.multLo[1], cpu0.multLo[0]) +
              '</td><td>Count</td><td class="fixed">' + toString32(n64js.cpu0.control[n64js.cpu0.kControlCount]) + '</td></tr>');
    $status_body.append('<tr><td></td><td class="fixed">' +
              '</td><td>Compare</td><td class="fixed">' + toString32(n64js.cpu0.control[n64js.cpu0.kControlCompare]) + '</td></tr>');

    for (var i = 0; i < cpu0.events.length; ++i) {
      $status_body.append('<tr><td>Event' + i + '</td><td class="fixed">' + cpu0.events[i].countdown + ', ' + cpu0.events[i].getName() + '</td></tr>');
    }

    addSR($status_body);
    addMipsInterrupts($status_body);

    return $status_table;
  }

  function addCop1($tb, regColours) {

    var cpu1 = n64js.cpu1;

    for (var i = 0; i < 32; ++i) {
      var name = n64js.cop1RegisterNames[i];

      if ((i&1) === 0) {
        var $td = $('<td>' + name +
          '</td><td class="fixed fp-w">' + toString32(cpu1.uint32[i]) +
          '</td><td class="fixed fp-s">' + cpu1.float32[i] +
          '</td><td class="fixed fp-d">' + cpu1.float64[i/2] +
          '</td>' );
      } else {
        var $td = $('<td>' + name +
          '</td><td class="fixed fp-w">' + toString32(cpu1.uint32[i]) +
          '</td><td class="fixed fp-s">' + cpu1.float32[i] +
          '</td><td>' +
          '</td>' );
      }

      var $tr = $('<tr />');
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


    var SR_IE           = 0x00000001;
    var SR_EXL          = 0x00000002;
    var SR_ERL          = 0x00000004;
    var SR_KSU_SUP      = 0x00000008;
    var SR_KSU_USR      = 0x00000010;
    var SR_UX           = 0x00000020;
    var SR_SX           = 0x00000040;
    var SR_KX           = 0x00000080;

    var flag_names = ['IE', 'EXL', 'ERL' ];//, '', '', 'UX', 'SX', 'KX' ];

    var sr = n64js.cpu0.control[n64js.cpu0.kControlSR];

    var $td = $('<td />');
    $td.append( toString32(sr) );
    $td.append('&nbsp;');

    for (var i = flag_names.length-1; i >= 0; --i) {
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

    var mi_intr_live = mi_reg.read32(MI_INTR_REG);
    var mi_intr_mask = mi_reg.read32(MI_INTR_MASK_REG);

    var $tr = $('<tr />');
    $tr.append( '<td>MI Intr</td>' );
    var $td = $('<td />');
    for (var i = 0; i < mi_intr_names.length; ++i) {
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

  //
  // Memory handlers
  //
  function Memory(arrayBuffer) {
    this.arrayBuffer = arrayBuffer;
    this.length      = arrayBuffer.byteLength;
    this.u8          = new Uint8Array(arrayBuffer);
    this.dataView    = new DataView(arrayBuffer);
  }

  Memory.prototype = {
    clear : function () {
      var u32s = new Uint32Array(this.arrayBuffer);
      for (var i = 0; i < u32s.length; ++i) {
        u32s[i] = 0;
      }
    },

    read32 : function (offset) {
      return this.dataView.getUint32(offset);
    },

    write32 : function (offset, value) {
      this.dataView.setUint32(offset, value);
    },

    clearBits32 : function (offset, bits) {
      var value = this.dataView.getUint32(offset) & ~bits;
      this.dataView.setUint32(offset, value);
      return value;
    },
    setBits32 : function (offset, bits) {
      var value = this.dataView.getUint32(offset) | bits;
      this.dataView.setUint32(offset, value);
      return value;
    },
    getBits32 : function (offset, bits) {
      return this.dataView.getUint32(offset) & bits;
    }
  };

  function MemoryCopy(dst, dstoff, src, srcoff, len) {
    for (var i = 0; i < len; ++i) {
      dst.u8[dstoff+i] = src.u8[srcoff+i];
    }
  }


  function Device(name, mem, rangeStart, rangeEnd) {
    this.name       = name;
    this.dataView   = mem ? mem.dataView : null;
    this.rangeStart = rangeStart;
    this.rangeEnd   = rangeEnd;
    this.quiet      = false;
  }

  Device.prototype = {
    calcEA : function (address) {
      return address - this.rangeStart;
    },

    readInternal32 : function (address) {
      var ea = this.calcEA(address);

      // We need to make sure this doesn't throw, so do a bounds check
      if (ea+3 < this.dataView.byteLength)
        return this.dataView.getUint32(ea);
      return 0xdddddddd;
    },

    read32 : function (address) {
      if (!this.quiet) n64js.log('Reading from ' + this.name + ': ' + toString32(address) );
      var ea = this.calcEA(address);
      return this.dataView.getUint32(ea);
    },
    read16 : function (address) {
      if (!this.quiet) n64js.log('Reading from ' + this.name + ': ' + toString32(address) );
      var ea = this.calcEA(address);
      return this.dataView.getUint16(ea);
    },
    read8 : function (address) {
      if (!this.quiet) n64js.log('Reading from ' + this.name + ': ' + toString32(address) );
      var ea = this.calcEA(address);
      return this.dataView.getUint8(ea);
    },


    write32 : function (address, value) {
      if (!this.quiet) n64js.log('Writing to ' + this.name + ': ' + toString32(value) + ' -> [' + toString32(address) + ']' );
      var ea = this.calcEA(address);
      this.dataView.setUint32(ea, value);
    },
    write16 : function (address, value) {
      if (!this.quiet) n64js.log('Writing to ' + this.name + ': ' + toString16(value) + ' -> [' + toString32(address) + ']' );
      var ea = this.calcEA(address);
      this.dataView.setUint16(ea, value);
    },
    write8 : function (address, value) {
      if (!this.quiet) n64js.log('Writing to ' + this.name + ': ' + toString8(value) + ' -> [' + toString32(address) + ']' );
      var ea = this.calcEA(address);
      this.dataView.setUint8(ea, value);
    }
  };

  var $rominfo     = null;
  var $status      = null;
  var $registers   = null;
  var $disassembly = null;
  var $memory      = null;
  var $output      = null;

  var disasmAddress = 0;

  var running       = false;
  var rom           = null;   // Will be memory, mapped at 0xb0000000
  var pi_mem        = new Memory(new ArrayBuffer(0x7c0 + 0x40));   // rom+ram
  var ram           = new Memory(new ArrayBuffer(8*1024*1024));
  var sp_mem        = new Memory(new ArrayBuffer(0x2000));
  var sp_reg        = new Memory(new ArrayBuffer(0x20));
  var sp_ibist_mem  = new Memory(new ArrayBuffer(0x8));
  var rdram_reg     = new Memory(new ArrayBuffer(0x30));
  var mi_reg        = new Memory(new ArrayBuffer(0x10));
  var vi_reg        = new Memory(new ArrayBuffer(0x38));
  var ai_reg        = new Memory(new ArrayBuffer(0x18));
  var pi_reg        = new Memory(new ArrayBuffer(0x34));
  var ri_reg        = new Memory(new ArrayBuffer(0x20));
  var si_reg        = new Memory(new ArrayBuffer(0x1c));

  var eeprom        = new Memory(new ArrayBuffer(4*1024));    // Or 16KB
  var eepromDirty   = false;

  // Keep a DataView around as a view onto the RSP task
  var kTaskOffset   = 0x0fc0;
  var rsp_task_view = new DataView(sp_mem.arrayBuffer, kTaskOffset, 0x40);

  var mapped_mem_handler         = new Device("VMEM",     null,         0x00000000, 0x80000000);
  var rdram_handler_cached       = new Device("RAM",      ram,          0x80000000, 0x80800000);
  var rdram_handler_uncached     = new Device("RAM",      ram,          0xa0000000, 0xa0800000);
  var rdram_reg_handler_uncached = new Device("RDRAMReg", rdram_reg,    0xa3f00000, 0xa4000000);
  var sp_mem_handler_uncached    = new Device("SPMem",    sp_mem,       0xa4000000, 0xa4002000);
  var sp_reg_handler_uncached    = new Device("SPReg",    sp_reg,       0xa4040000, 0xa4040020);
  var sp_ibist_handler_uncached  = new Device("SPIBIST",  sp_ibist_mem, 0xa4080000, 0xa4080008);
  var mi_reg_handler_uncached    = new Device("MIReg",    mi_reg,       0xa4300000, 0xa4300010);
  var vi_reg_handler_uncached    = new Device("VIReg",    vi_reg,       0xa4400000, 0xa4400038);
  var ai_reg_handler_uncached    = new Device("AIReg",    ai_reg,       0xa4500000, 0xa4500018);
  var pi_reg_handler_uncached    = new Device("PIReg",    pi_reg,       0xa4600000, 0xa4600034);
  var ri_reg_handler_uncached    = new Device("RIReg",    ri_reg,       0xa4700000, 0xa4700020);
  var si_reg_handler_uncached    = new Device("SIReg",    si_reg,       0xa4800000, 0xa480001c);
  var rom_d2a1_handler_uncached  = new Device("ROMd2a1",  rom,          0xa5000000, 0xa6000000);
  var rom_d1a1_handler_uncached  = new Device("ROMd1a1",  rom,          0xa6000000, 0xa8000000);
  var rom_d2a2_handler_uncached  = new Device("ROMd2a2",  rom,          0xa8000000, 0xb0000000);
  var rom_d1a2_handler_uncached  = new Device("ROMd1a2",  rom,          0xb0000000, 0xbfc00000);
  var pi_mem_handler_uncached    = new Device("PIRAM",    pi_mem,       0xbfc00000, 0xbfc00800);

  rdram_handler_cached.quiet      = true;
  rdram_handler_uncached.quiet    = true;
  sp_mem_handler_uncached.quiet   = true;
  sp_reg_handler_uncached.quiet   = true;
  sp_ibist_handler_uncached.quiet = true;
  mi_reg_handler_uncached.quiet   = true;
  vi_reg_handler_uncached.quiet   = true;
  ai_reg_handler_uncached.quiet   = true;
  pi_reg_handler_uncached.quiet   = true;
  si_reg_handler_uncached.quiet   = true;

  // This function gets hit A LOT, so eliminate as much fat as possible.
  rdram_handler_cached.read32 = function (address) {
    return this.dataView.getUint32(address - 0x80000000);
  }
  rdram_handler_cached.write32 = function (address, value) {
    return this.dataView.setUint32(address - 0x80000000, value);
  }

  mapped_mem_handler.readInternal32 = function(address) {
    return 0xffffffff;
  }

  mapped_mem_handler.translate = function(address) {
    //if (!this.quiet) n64js.log('Reading from ' + this.name + ': ' + toString32(address) );
    var ea = this.calcEA(address);

    return n64js.cpu0.translate(ea) & 0x007fffff;
  }

  mapped_mem_handler.read32 = function(address) {
    var mapped = this.translate(address);
    if (mapped != 0) {
      return ram.dataView.getUint32(mapped);
    }
    n64js.halt('virtual read32 failed - need to throw refill/invalid');
    return 0xffffffff;
  }
  mapped_mem_handler.read16 = function(address) {
    var mapped = this.translate(address);
    if (mapped != 0) {
      return ram.dataView.getUint16(mapped);
    }
    n64js.halt('virtual read16 failed - need to throw refill/invalid');
    return 0xffff;
  }
  mapped_mem_handler.read8 = function(address) {
    var mapped = this.translate(address);
    if (mapped != 0) {
      return ram.dataView.getUint8(mapped);
    }
    n64js.halt('virtual read8 failed - need to throw refill/invalid');
    return 0xff;
  }

  mapped_mem_handler.write32 = function (address, value) {
    throw 'Writing to vram';
  };
  mapped_mem_handler.write16 = function (address, value) {
    throw 'Writing to vram';
  };
  mapped_mem_handler.write8 = function (address, value) {
    throw 'Writing to vram';
  };

  rom_d1a1_handler_uncached.read32  = function(address)         { throw 'Reading from rom d1a1'; }
  rom_d1a1_handler_uncached.read16  = function(address)         { throw 'Reading from rom d1a1'; }
  rom_d1a1_handler_uncached.read8   = function(address)         { throw 'Reading from rom d1a1'; }
  rom_d1a1_handler_uncached.write32 = function (address, value) { throw 'Writing to rom'; };
  rom_d1a1_handler_uncached.write16 = function (address, value) { throw 'Writing to rom'; };
  rom_d1a1_handler_uncached.write8  = function (address, value) { throw 'Writing to rom'; };

  //rom_d1a2_handler_uncached.read32 = function(address)         { throw 'Reading from rom'; }
  //rom_d1a2_handler_uncached.read16 = function(address)         { throw 'Reading from rom'; }
  //rom_d1a2_handler_uncached.read8  = function(address)         { throw 'Reading from rom'; }
  rom_d1a2_handler_uncached.write32  = function (address, value) { throw 'Writing to rom'; };
  rom_d1a2_handler_uncached.write16  = function (address, value) { throw 'Writing to rom'; };
  rom_d1a2_handler_uncached.write8   = function (address, value) { throw 'Writing to rom'; };

  // Should read noise?
  function getRandomU8() {
    return Math.floor( Math.random() * 255.0 ) & 0xff;
  }
  function getRandomU32() {
    return (getRandomU8()<<24) | (getRandomU8()<<16) | (getRandomU8()<<8) | getRandomU8();
  }

  rom_d2a1_handler_uncached.read32  = function(address)         { n64js.log('reading noise'); return getRandomU32(); }
  rom_d2a1_handler_uncached.read16  = function(address)         { n64js.log('reading noise'); return (getRandomU8()<<8) | getRandomU8(); }
  rom_d2a1_handler_uncached.read8   = function(address)         { n64js.log('reading noise'); return getRandomU8(); }
  rom_d2a1_handler_uncached.write32 = function (address, value) { throw 'Writing to rom'; };
  rom_d2a1_handler_uncached.write16 = function (address, value) { throw 'Writing to rom'; };
  rom_d2a1_handler_uncached.write8  = function (address, value) { throw 'Writing to rom'; };

  rom_d2a2_handler_uncached.read32  = function(address)         { throw 'Reading from rom d2a2'; }
  rom_d2a2_handler_uncached.read16  = function(address)         { throw 'Reading from rom d2a2'; }
  rom_d2a2_handler_uncached.read8   = function(address)         { throw 'Reading from rom d2a2'; }
  rom_d2a2_handler_uncached.write32 = function (address, value) { throw 'Writing to rom'; };
  rom_d2a2_handler_uncached.write16 = function (address, value) { throw 'Writing to rom'; };
  rom_d2a2_handler_uncached.write8  = function (address, value) { throw 'Writing to rom'; };

  rdram_reg_handler_uncached.calcEA  = function (address) {
    return address&0xff;
  };

  function SPUpdateStatus(flags) {

    if (!sp_reg_handler_uncached.quiet) {
      if (flags & SP_CLR_HALT)       n64js.log( 'SP: Clearing Halt' );
      if (flags & SP_SET_HALT)       n64js.log( 'SP: Setting Halt' );
      if (flags & SP_CLR_BROKE)      n64js.log( 'SP: Clearing Broke' );
      // No SP_SET_BROKE
      if (flags & SP_CLR_INTR)       n64js.log( 'SP: Clearing Interrupt' );
      if (flags & SP_SET_INTR)       n64js.log( 'SP: Setting Interrupt' );
      if (flags & SP_CLR_SSTEP)      n64js.log( 'SP: Clearing Single Step' );
      if (flags & SP_SET_SSTEP)      n64js.log( 'SP: Setting Single Step' );
      if (flags & SP_CLR_INTR_BREAK) n64js.log( 'SP: Clearing Interrupt on break' );
      if (flags & SP_SET_INTR_BREAK) n64js.log( 'SP: Setting Interrupt on break' );
      if (flags & SP_CLR_SIG0)       n64js.log( 'SP: Clearing Sig0 (Yield)' );
      if (flags & SP_SET_SIG0)       n64js.log( 'SP: Setting Sig0 (Yield)' );
      if (flags & SP_CLR_SIG1)       n64js.log( 'SP: Clearing Sig1 (Yielded)' );
      if (flags & SP_SET_SIG1)       n64js.log( 'SP: Setting Sig1 (Yielded)' );
      if (flags & SP_CLR_SIG2)       n64js.log( 'SP: Clearing Sig2 (TaskDone)' );
      if (flags & SP_SET_SIG2)       n64js.log( 'SP: Setting Sig2 (TaskDone)' );
      if (flags & SP_CLR_SIG3)       n64js.log( 'SP: Clearing Sig3' );
      if (flags & SP_SET_SIG3)       n64js.log( 'SP: Setting Sig3' );
      if (flags & SP_CLR_SIG4)       n64js.log( 'SP: Clearing Sig4' );
      if (flags & SP_SET_SIG4)       n64js.log( 'SP: Setting Sig4' );
      if (flags & SP_CLR_SIG5)       n64js.log( 'SP: Clearing Sig5' );
      if (flags & SP_SET_SIG5)       n64js.log( 'SP: Setting Sig5' );
      if (flags & SP_CLR_SIG6)       n64js.log( 'SP: Clearing Sig6' );
      if (flags & SP_SET_SIG6)       n64js.log( 'SP: Setting Sig6' );
      if (flags & SP_CLR_SIG7)       n64js.log( 'SP: Clearing Sig7' );
      if (flags & SP_SET_SIG7)       n64js.log( 'SP: Setting Sig7' );
    }

    var clr_bits = 0;
    var set_bits = 0;

    var start_rsp = false;
    var stop_rsp = false;

    if (flags & SP_CLR_HALT)       { clr_bits |= SP_STATUS_HALT; start_rsp = true; }
    if (flags & SP_SET_HALT)       { set_bits |= SP_STATUS_HALT; stop_rsp  = true; }

    if (flags & SP_SET_INTR)        { mi_reg.setBits32  (MI_INTR_REG, MI_INTR_SP); n64js.cpu0.updateCause3(); }   // Shouldn't ever set this?
    else if (flags & SP_CLR_INTR)   { mi_reg.clearBits32(MI_INTR_REG, MI_INTR_SP); n64js.cpu0.updateCause3(); }

    clr_bits |= (flags & SP_CLR_BROKE) >> 1;
    clr_bits |= (flags & SP_CLR_SSTEP);
    clr_bits |= (flags & SP_CLR_INTR_BREAK) >> 1;
    clr_bits |= (flags & SP_CLR_SIG0) >> 2;
    clr_bits |= (flags & SP_CLR_SIG1) >> 3;
    clr_bits |= (flags & SP_CLR_SIG2) >> 4;
    clr_bits |= (flags & SP_CLR_SIG3) >> 5;
    clr_bits |= (flags & SP_CLR_SIG4) >> 6;
    clr_bits |= (flags & SP_CLR_SIG5) >> 7;
    clr_bits |= (flags & SP_CLR_SIG6) >> 8;
    clr_bits |= (flags & SP_CLR_SIG7) >> 9;

    set_bits |= (flags & SP_SET_SSTEP) >> 1;
    set_bits |= (flags & SP_SET_INTR_BREAK) >> 2;
    set_bits |= (flags & SP_SET_SIG0) >> 3;
    set_bits |= (flags & SP_SET_SIG1) >> 4;
    set_bits |= (flags & SP_SET_SIG2) >> 5;
    set_bits |= (flags & SP_SET_SIG3) >> 6;
    set_bits |= (flags & SP_SET_SIG4) >> 7;
    set_bits |= (flags & SP_SET_SIG5) >> 8;
    set_bits |= (flags & SP_SET_SIG6) >> 9;
    set_bits |= (flags & SP_SET_SIG7) >> 10;

    var status_bits = sp_reg.read32(SP_STATUS_REG);
    status_bits &= ~clr_bits;
    status_bits |=  set_bits;
    sp_reg.write32(SP_STATUS_REG, status_bits);

    if (start_rsp) {
      n64js.RSPHLEProcessTask(rsp_task_view, ram.dataView);
    } else if (stop_rsp) {
      // As we handle all RSP via HLE, nothing to do here.
    }
  }

  function SPCopyFromRDRAM() {
    var sp_mem_address = sp_reg.read32(SP_MEM_ADDR_REG);
    var rd_ram_address = sp_reg.read32(SP_DRAM_ADDR_REG);
    var rdlen_reg      = sp_reg.read32(SP_RD_LEN_REG);
    var splen          = (rdlen_reg & 0xfff) + 1;

    if (!sp_reg_handler_uncached.quiet) {
      n64js.log('SP: copying from ram ' + toString32(rd_ram_address) + ' to sp ' + toString16(sp_mem_address) );
    }

    MemoryCopy( sp_mem, sp_mem_address & 0xfff, ram, rd_ram_address & 0xffffff, splen );

    sp_reg.setBits32(SP_DMA_BUSY_REG, 0);
    sp_reg.clearBits32(SP_STATUS_REG, SP_STATUS_DMA_BUSY);
  }

  function SPCopyToRDRAM() {
    var sp_mem_address = sp_reg.read32(SP_MEM_ADDR_REG);
    var rd_ram_address = sp_reg.read32(SP_DRAM_ADDR_REG);
    var wrlen_reg      = sp_reg.read32(SP_WR_LEN_REG);
    var splen          = (wrlen_reg & 0xfff) + 1;

    if (!sp_reg_handler_uncached.quiet) {
      n64js.log('SP: copying from sp ' + toString16(sp_mem_address) + ' to ram ' + toString32(rd_ram_address) );
    }

    MemoryCopy( ram, rd_ram_address & 0xffffff, sp_mem, sp_mem_address & 0xfff, splen );

    sp_reg.setBits32(SP_DMA_BUSY_REG, 0);
    sp_reg.clearBits32(SP_STATUS_REG, SP_STATUS_DMA_BUSY);
  }


  sp_reg_handler_uncached.write32 = function (address, value) {
    var ea = this.calcEA(address);
    if (ea+3 < this.dataView.byteLength) {

      switch( ea ) {
        case SP_MEM_ADDR_REG:
        case SP_DRAM_ADDR_REG:
        case SP_SEMAPHORE_REG:
          this.dataView.setUint32(ea, value);
          break;
        case SP_RD_LEN_REG:
          this.dataView.setUint32(ea, value);
          SPCopyFromRDRAM();
          break;

        case SP_WR_LEN_REG:
          this.dataView.setUint32(ea, value);
          SPCopyToRDRAM();
          break;

        case SP_STATUS_REG:
          SPUpdateStatus( value );
          break;

        case SP_DMA_FULL_REG:
        case SP_DMA_BUSY_REG:
          // Prevent writing to read-only mem
          break;

        default:
          n64js.log('Unhandled write to SPReg: ' + toString32(value) + ' -> [' + toString32(address) + ']' );
          this.dataView.setUint32(ea, value);
      }
    } else {
      throw 'Write is out of range';
    }
  };



  function MIWriteModeReg(value) {
    var mi_mode_reg = mi_reg.read32(MI_MODE_REG);

    if (value & MI_SET_RDRAM)   mi_mode_reg |=  MI_MODE_RDRAM;
    if (value & MI_CLR_RDRAM)   mi_mode_reg &= ~MI_MODE_RDRAM;

    if (value & MI_SET_INIT)    mi_mode_reg |=  MI_MODE_INIT;
    if (value & MI_CLR_INIT)    mi_mode_reg &= ~MI_MODE_INIT;

    if (value & MI_SET_EBUS)    mi_mode_reg |=  MI_MODE_EBUS;
    if (value & MI_CLR_EBUS)    mi_mode_reg &= ~MI_MODE_EBUS;

    mi_reg.write32(MI_MODE_REG, mi_mode_reg);

    if (value & MI_CLR_DP_INTR) {
      mi_reg.clearBits32(MI_INTR_REG, MI_INTR_DP);
      n64js.cpu0.updateCause3();
    }
  }

  function MIWriteIntrMaskReg(value) {
    var mi_intr_mask_reg = mi_reg.read32(MI_INTR_MASK_REG);
    var mi_intr_reg      = mi_reg.read32(MI_INTR_REG);

    var clr = 0;
    var set = 0;

    // From Corn - nicer way to avoid branching
    clr |= (value & MI_INTR_MASK_CLR_SP) >>> 0;
    clr |= (value & MI_INTR_MASK_CLR_SI) >>> 1;
    clr |= (value & MI_INTR_MASK_CLR_AI) >>> 2;
    clr |= (value & MI_INTR_MASK_CLR_VI) >>> 3;
    clr |= (value & MI_INTR_MASK_CLR_PI) >>> 4;
    clr |= (value & MI_INTR_MASK_CLR_DP) >>> 5;

    set |= (value & MI_INTR_MASK_SET_SP) >>> 1;
    set |= (value & MI_INTR_MASK_SET_SI) >>> 2;
    set |= (value & MI_INTR_MASK_SET_AI) >>> 3;
    set |= (value & MI_INTR_MASK_SET_VI) >>> 4;
    set |= (value & MI_INTR_MASK_SET_PI) >>> 5;
    set |= (value & MI_INTR_MASK_SET_DP) >>> 6;

    mi_intr_mask_reg &= ~clr;
    mi_intr_mask_reg |=  set;

    mi_reg.write32(MI_INTR_MASK_REG, mi_intr_mask_reg);

    // Check if any interrupts are enabled now, and immediately trigger an interrupt
    if (mi_intr_mask_reg & mi_intr_reg) {
      n64js.cpu0.updateCause3();
    }
  }

  mi_reg_handler_uncached.write32 = function (address, value) {
    var ea = this.calcEA(address);
    if (ea+3 < this.dataView.byteLength) {

      switch( ea ) {
        case MI_MODE_REG:
          if (!this.quiet) n64js.log('Wrote to MI mode register: ' + toString32(value) );
          MIWriteModeReg(value);
          break;
        case MI_INTR_MASK_REG:
          if (!this.quiet) n64js.log('Wrote to MI interrupt mask register: ' + toString32(value) );
          MIWriteIntrMaskReg(value);
          break;

        case MI_VERSION_REG:
        case MI_INTR_REG:
          // Read only
          break;

        default:
          n64js.log('Unhandled write to MIReg: ' + toString32(value) + ' -> [' + toString32(address) + ']' );
          this.dataView.setUint32(ea, value);
          break;
      }

    } else {
      throw 'Write is out of range';
    }
  };


  ai_reg_handler_uncached.write32 = function (address, value) {
    var ea = this.calcEA(address);
    if (ea+3 < this.dataView.byteLength) {

      switch( ea ) {
        case AI_DRAM_ADDR_REG:
        case AI_CONTROL_REG:
        case AI_BITRATE_REG:
          if(!this.quiet) n64js.log('Wrote to AIReg: ' + toString32(value) + ' -> [' + toString32(address) + ']' );
          this.dataView.setUint32(ea, value);
          break;

        case AI_LEN_REG:
          if(!this.quiet) n64js.log('AI len changed to ' + value);
          this.dataView.setUint32(ea, value);
          break;
        case AI_DACRATE_REG:
          if(!this.quiet) n64js.log('AI dacrate changed to ' + value);
          this.dataView.setUint32(ea, value);
          break;

        case AI_STATUS_REG:
          n64js.log('AI interrupt cleared');
          ai_reg.clearBits32(MI_INTR_REG, MI_INTR_AI);
          n64js.cpu0.updateCause3();
          break;

        default:
          n64js.log('Unhandled write to AIReg: ' + toString32(value) + ' -> [' + toString32(address) + ']' );
          this.dataView.setUint32(ea, value);
          break;
      }

    } else {
      throw 'Write is out of range';
    }
  };

  vi_reg_handler_uncached.write32 = function (address, value) {
    var ea = this.calcEA(address);
    if (ea+3 < this.dataView.byteLength) {

      switch( ea ) {
        case VI_CONTROL_REG:
          if (!this.quiet) n64js.log('VI control set to: ' + toString32(value) );
          this.dataView.setUint32(ea, value);
          break;
        case VI_WIDTH_REG:
          if (!this.quiet) n64js.log('VI width set to: ' + value );
          this.dataView.setUint32(ea, value);
          break;
        case VI_CURRENT_REG:
          if (!this.quiet) n64js.log('VI current set to: ' + toString32(value) + '.' );
          if (!this.quiet) n64js.log('VI interrupt cleared');
          mi_reg.clearBits32(MI_INTR_REG, MI_INTR_VI);
          n64js.cpu0.updateCause3();
          break;

        default:
          this.dataView.setUint32(ea, value);
          break;
      }

    } else {
      throw 'Write is out of range';
    }
  };

  vi_reg_handler_uncached.read32 = function (address) {
    if (!this.quiet) n64js.log('Reading from ' + this.name + ': ' + toString32(address) );
    var ea = this.calcEA(address);

    if (ea+3 < this.dataView.byteLength) {
      var value = this.dataView.getUint32(ea);
      if (ea == VI_CURRENT_REG) {
        value = (value + 2) % 512;
        this.dataView.setUint32(ea, value);
      }
      return value;
    } else {
      throw 'Read is out of range';
    }
  };


  pi_reg_handler_uncached.write32 = function (address, value) {
    var ea = this.calcEA(address);
    if (ea+3 < this.dataView.byteLength) {

      switch( ea ) {
        case PI_DRAM_ADDR_REG:
        case PI_CART_ADDR_REG:
          if (!this.quiet) n64js.log('Writing to PIReg: ' + toString32(value) + ' -> [' + toString32(address) + ']' );
          this.dataView.setUint32(ea, value);
          break;
        case PI_RD_LEN_REG:
          this.dataView.setUint32(ea, value);
          n64js.halt('PI copy from rdram triggered!');
          break;
        case PI_WR_LEN_REG:
          this.dataView.setUint32(ea, value);
          PICopyToRDRAM();
          break;
        case PI_STATUS_REG:
          if (value & PI_STATUS_RESET) {
            if (!this.quiet) n64js.log('PI_STATUS_REG reset');
            this.dataView.setUint32(PI_STATUS_REG, 0);
          }
          if (value & PI_STATUS_CLR_INTR) {
            if (!this.quiet) n64js.log('PI interrupt cleared');
            mi_reg.clearBits32(MI_INTR_REG, MI_INTR_PI);
            n64js.cpu0.updateCause3();
          }

          break;
        default:
          n64js.log('Unhandled write to PIReg: ' + toString32(value) + ' -> [' + toString32(address) + ']' );
          this.dataView.setUint32(ea, value);
          break;

      }

    } else {
      throw 'Write is out of range';
    }
  };

  function SICopyFromRDRAM() {
    var dram_address = si_reg.read32(SI_DRAM_ADDR_REG) & 0x1fffffff;
    var pi_ram       = new Uint8Array(pi_mem.arrayBuffer, 0x7c0, 0x040);

    if (!si_reg_handler_uncached.quiet) n64js.log('SI: copying from ' + toString32(dram_address) + ' to PI RAM');

    for (var i = 0; i < 64; ++i) {
      pi_ram[i] = ram.u8[dram_address+i];
    }

    var control_byte = pi_ram[0x3f];
    if (control_byte > 0) {
      if (!si_reg_handler_uncached.quiet) n64js.log('SI: wrote ' + control_byte + ' to the control byte');
    }

    si_reg.setBits32(SI_STATUS_REG, SI_STATUS_INTERRUPT);
    mi_reg.setBits32(MI_INTR_REG, MI_INTR_SI);
    n64js.cpu0.updateCause3();
  }

  function SICopyToRDRAM() {

    // Update controller state here
    UpdateController();

    var dram_address = si_reg.read32(SI_DRAM_ADDR_REG) & 0x1fffffff;
    var pi_ram       = new Uint8Array(pi_mem.arrayBuffer, 0x7c0, 0x040);

    if (!si_reg_handler_uncached.quiet) n64js.log('SI: copying from PI RAM to ' + toString32(dram_address));

    for (var i = 0; i < 64; ++i) {
      ram.u8[dram_address+i] = pi_ram[i];
    }

    si_reg.setBits32(SI_STATUS_REG, SI_STATUS_INTERRUPT);
    mi_reg.setBits32(MI_INTR_REG, MI_INTR_SI);
    n64js.cpu0.updateCause3();
  }


  var PC_CONTROLLER_0      = 0;
  var PC_CONTROLLER_1      = 1;
  var PC_CONTROLLER_2      = 2;
  var PC_CONTROLLER_3      = 3;
  var PC_EEPROM            = 4;
  var PC_UNKNOWN_1         = 5;
  var NUM_CHANNELS         = 5;

  var CONT_GET_STATUS      = 0x00;
  var CONT_READ_CONTROLLER = 0x01;
  var CONT_READ_MEMPACK    = 0x02;
  var CONT_WRITE_MEMPACK   = 0x03;
  var CONT_READ_EEPROM     = 0x04;
  var CONT_WRITE_EEPROM    = 0x05;
  var CONT_RTC_STATUS      = 0x06;
  var CONT_RTC_READ        = 0x07;
  var CONT_RTC_WRITE       = 0x08;
  var CONT_RESET           = 0xff;

  var CONT_TX_SIZE_CHANSKIP   = 0x00;         // Channel Skip
  var CONT_TX_SIZE_DUMMYDATA  = 0xFF;         // Dummy Data
  var CONT_TX_SIZE_FORMAT_END = 0xFE;         // Format End
  var CONT_TX_SIZE_CHANRESET  = 0xFD;         // Channel Reset

  function UpdateController() {

    // read controllers

    var pi_ram       = new Uint8Array(pi_mem.arrayBuffer, 0x7c0, 0x040);

    var count   = 0;
    var channel = 0;
    while (count < 64) {
      var cmd = pi_ram.subarray(count);

      if (cmd[0] == CONT_TX_SIZE_FORMAT_END) {
        count = 64;
        break;
      }

      if ((cmd[0] == CONT_TX_SIZE_DUMMYDATA) || (cmd[0] == CONT_TX_SIZE_CHANRESET)) {
        count++;
        continue;
      }

      if (cmd[0] == CONT_TX_SIZE_CHANSKIP) {
        count++;
        channel++;
        continue;
      }

      // 0-3: controller channels
      if (channel < PC_EEPROM) {
        // copy controller status
        if (!ProcessController(cmd, channel)) {
          count = 64;
          break;
        }
      } else if (channel === PC_EEPROM) {
        if (!ProcessEeprom(cmd)) {
          count = 64;
          break;
        }
        break;
      } else {
        n64js.halt('Trying to read from invalid controller channel ' + channel + '!');
        return;
      }

      channel++;
      count += cmd[0] + (cmd[1]&0x3f) + 2;
    }

    pi_ram[63] = 0;
  }

  var controllers = [{present:true, mempack:true},
                     {present:true, mempack:false},
                     {present:true, mempack:false},
                     {present:true, mempack:false}];
  function ProcessController(cmd, channel) {
    if (!controllers[channel].present)
    {
      cmd[1] |= 0x80;
      cmd[3]  = 0xff;
      cmd[4]  = 0xff;
      cmd[5]  = 0xff;
      return true;
    }

    switch (cmd[2]) {
      case CONT_RESET:
      case CONT_GET_STATUS:
        cmd[3] = 0x05;
        cmd[4] = 0x00;
        cmd[5] = controllers[channel].mempack ? 0x01 : 0x00;
        break;

      case CONT_READ_CONTROLLER:
        cmd[3] = controllers[channel].buttons >>> 8;
        cmd[4] = controllers[channel].buttons & 0xff;
        cmd[5] = controllers[channel].stick_x;
        cmd[6] = controllers[channel].stick_y;
        break;

      case CONT_READ_MEMPACK:
        n64js.halt('CONT_READ_MEMPACK not implemented');
        return false;
      case CONT_WRITE_MEMPACK:
        n64js.halt('CONT_WRITE_MEMPACK not implemented');
        return false;
      default:
        n64js.halt('Unknown controller command ' + cmd[2]);
        break;
    }

    return true;
  }

  function ProcessEeprom(cmd) {

    switch(cmd[2])
    {
    case CONT_RESET:
    case CONT_GET_STATUS:
      cmd[3] = 0x00;
      cmd[4] = 0x80; /// FIXME GetEepromContType();
      cmd[5] = 0x00;
      break;

    case CONT_READ_EEPROM:
      var offset = cmd[3]*8;
      n64js.log('Reading from eeprom+' + offset);
      for (var i = 0; i < 8; ++i) {
        cmd[4+i] = eeprom.u8[offset+i];
      }
      break;

    case CONT_WRITE_EEPROM:
      //FIXME: marksavedirty
      var offset = cmd[3]*8;
      n64js.log('Writing to eeprom+' + offset);
      for (var i = 0; i < 8; ++i) {
        eeprom.u8[offset+i] = cmd[4+i];
      eepromDirty = true;
      }
      break;

    // RTC credit: Mupen64 source
    //
    case CONT_RTC_STATUS: // RTC status query
        cmd[3] = 0x00;
        cmd[4] = 0x10;
        cmd[5] = 0x00;
      break;

    case CONT_RTC_READ: // read RTC block
      n64js.halt('rtc read unhandled');
      //CommandReadRTC( cmd );
      break;

    case CONT_RTC_WRITE:  // write RTC block
      n64js.halt('rtc write unhandled');
      break;

    default:
      n64js.halt('unknown eeprom command: ' + toString8(cmd[2]));
      break;
    }

    return false;
  }

  function checkSIStatusConsistent() {
    var mi_si_int_set     = mi_reg.getBits32(MI_INTR_REG,   MI_INTR_SI)          !== 0;
    var si_status_int_set = si_reg.getBits32(SI_STATUS_REG, SI_STATUS_INTERRUPT) !== 0;
    if (mi_si_int_set != si_status_int_set) {
      n64js.halt("SI_STATUS register is in an inconsistent state");
    }
  }
  n64js.checkSIStatusConsistent = checkSIStatusConsistent;

  si_reg_handler_uncached.read32 = function (address) {
    if (!this.quiet) n64js.log('Reading from ' + this.name + ': ' + toString32(address) );
    var ea = this.calcEA(address);

    if (ea+3 < this.dataView.byteLength) {
      if (ea === SI_STATUS_REG) {
        checkSIStatusConsistent();
      }
      return this.dataView.getUint32(ea);
    } else {
      throw 'Read is out of range';
    }
  };

  si_reg_handler_uncached.write32 = function (address, value) {
    var ea = this.calcEA(address);
    if (ea+3 < this.dataView.byteLength) {

      switch( ea ) {
        case SI_DRAM_ADDR_REG:
          if (!this.quiet) n64js.log('Writing to SI dram address reigster: ' + toString32(value) );
          this.dataView.setUint32(ea, value);
          break;
        case SI_PIF_ADDR_RD64B_REG:
          this.dataView.setUint32(ea, value);
          SICopyToRDRAM();
          break;
        case SI_PIF_ADDR_WR64B_REG:
          this.dataView.setUint32(ea, value);
          SICopyFromRDRAM();
          break;
        case SI_STATUS_REG:
          if (!this.quiet) n64js.log('SI interrupt cleared');
          si_reg.clearBits32(SI_STATUS_REG, SI_STATUS_INTERRUPT);
          mi_reg.clearBits32(MI_INTR_REG,   MI_INTR_SI);
          n64js.cpu0.updateCause3();
          break;
        default:
          n64js.log('Unhandled write to SIReg: ' + toString32(value) + ' -> [' + toString32(address) + ']' );
          this.dataView.setUint32(ea, value);
          break;
      }

    } else {
      throw 'Write is out of range';
    }
  };


  function PICopyToRDRAM() {
    var dram_address = pi_reg.read32(PI_DRAM_ADDR_REG) & 0x00ffffff;
    var cart_address = pi_reg.read32(PI_CART_ADDR_REG);
    var transfer_len = pi_reg.read32(PI_WR_LEN_REG) + 1;

    if (!pi_reg_handler_uncached.quiet) n64js.log('PI: copying ' + transfer_len + ' bytes of data from ' + toString32(cart_address) + ' to ' + toString32(dram_address));

    if (transfer_len&1) {
      n64js.log('PI: Warning - odd address');
      transfer_len++;
    }

    var copy_succeeded = false;

    if (IsDom1Addr1(cart_address)) {
      cart_address -= PI_DOM1_ADDR1;
      MemoryCopy( ram, dram_address, rom, cart_address, transfer_len );
      copy_succeeded = true;
    } else if (IsDom1Addr2(cart_address)) {
      cart_address -= PI_DOM1_ADDR2;
      MemoryCopy( ram, dram_address, rom, cart_address, transfer_len );
      copy_succeeded = true;
    } else if (IsDom1Addr3(cart_address)) {
      cart_address -= PI_DOM1_ADDR3;
      MemoryCopy( ram, dram_address, rom, cart_address, transfer_len );
      copy_succeeded = true;

    } else if (IsDom2Addr1(cart_address)) {
      cart_address -= PI_DOM2_ADDR1;
      n64js.halt('PI: dom2addr1 transfer is unhandled (save)');

    } else if (IsDom2Addr2(cart_address)) {
      cart_address -= PI_DOM2_ADDR2;
      n64js.halt('PI: dom2addr2 transfer is unhandled (save/flash)');

    } else {
      n64js.halt('PI: unknown cart address: ' + cart_address);
    }

    // If this is the first DMA write the ram size to 0x800003F0 (cic6105) or 0x80000318 (others)
    pi_reg.clearBits32(PI_STATUS_REG, PI_STATUS_DMA_BUSY);
    mi_reg.setBits32(MI_INTR_REG, MI_INTR_PI);
    n64js.cpu0.updateCause3();
  }

  function PIFUpdateControl() {
    var pi_rom = new Uint8Array(pi_mem.arrayBuffer, 0x000, 0x7c0);
    var pi_ram = new Uint8Array(pi_mem.arrayBuffer, 0x7c0, 0x040);
    var command = pi_ram[0x3f];
    switch (command) {
      case 0x01:
        n64js.log('PI: execute block\n');
        break;
      case 0x08:
        n64js.log('PI: interrupt control\n');
        pi_ram[0x3f] = 0x00;
        si_reg.setBits32(SI_STATUS_REG, SI_STATUS_INTERRUPT);
        mi_reg.setBits32(MI_INTR_REG,   MI_INTR_SI);
        n64js.cpu0.updateCause3();
        break;
      case 0x10:
        n64js.log('PI: clear rom\n');
        for(var i = 0; i < pi_rom.length; ++i) {
          pi_rom[i] = 0;
        }
        break;
      case 0x30:
        n64js.log('PI: set 0x80 control \n');
        pi_ram[0x3f] = 0x80;
        break;
      case 0xc0:
        n64js.log('PI: clear ram\n');
        for(var i = 0; i < pi_ram.length; ++i) {
          pi_ram[i] = 0;
        }
        break;
      default:
        n64js.halt('Unkown PI control value: ' + toString8(command));
        break;
    }
  }

  pi_mem_handler_uncached.read32 = function (address) {
    var ea = this.calcEA(address);

    if (ea+3 < this.dataView.byteLength) {
      var v = this.dataView.getUint32(ea);

      if (ea < 0x7c0) {
        n64js.log('Reading from PIF rom (' + toString32(address) + '). Got ' + toString32(v));
        return v;
      } else {
        var ram_offset = ea - 0x7c0;
        switch(ram_offset) {
          case 0x24:  n64js.log('Reading CIC values: '   + toString32(v)); break;
          case 0x3c:  n64js.log('Reading Control byte: ' + toString32(v)); break;
          default:    n64js.log('Reading from PI ram ['  + toString32(address) + ']. Got ' + toString32(v));
        }
      }
      return v;
    } else {
      throw 'Read is out of range';
    }
  };
  pi_mem_handler_uncached.read8 = function (address) {
    var ea = this.calcEA(address);

    var v = pi_mem.dataView.getUint8(ea);

    if (ea < 0x7c0) {
      n64js.log('Reading from PIF rom (' + toString32(address) + '). Got ' + toString8(v));
      return v;
    } else {
      var ram_offset = ea - 0x7c0;
      switch(ram_offset) {
        case 0x24:  n64js.log('Reading CIC values: '   + toString8(v)); break;
        case 0x3c:  n64js.log('Reading Control byte: ' + toString8(v)); break;
        default:    n64js.log('Reading from PI ram ['  + toString32(address) + ']. Got ' + toString8(v));
      }
    }
    return v;
  };
  pi_mem_handler_uncached.write32 = function (address, value) {
    var ea = this.calcEA(address);

    if (ea < 0x7c0) {
      n64js.log('Attempting to write to PIF ROM');
    } else {
      var ram_offset = ea - 0x7c0;
      this.dataView.setUint32(ea, value);
      switch(ram_offset) {
      case 0x24:  n64js.log('Writing CIC values: '   + toString32(value) ); break;
      case 0x3c:  n64js.log('Writing Control byte: ' + toString32(value) ); PIFUpdateControl(); break;
      default:    n64js.log('Writing directly to PI ram [' + toString32(address) + '] <-- ' + toString32(value)); break;
      }
    }
  };

  // We create a memory map of 1<<14 entries, corresponding to the top bits of the address range. 
  var memMap = (function () {
    var map = new Array(0x4000);
    for (var i = 0; i < 0x4000; ++i)
      map[i] = undefined;

    [
     mapped_mem_handler,
          rdram_handler_cached,
          rdram_handler_uncached,
         sp_mem_handler_uncached,
         sp_reg_handler_uncached,
       sp_ibist_handler_uncached,
      rdram_reg_handler_uncached,
         mi_reg_handler_uncached,
         vi_reg_handler_uncached,
         ai_reg_handler_uncached,
         pi_reg_handler_uncached,
         ri_reg_handler_uncached,
         si_reg_handler_uncached,
       rom_d2a1_handler_uncached,
       rom_d2a2_handler_uncached,
       rom_d1a1_handler_uncached,
       rom_d1a2_handler_uncached,
         pi_mem_handler_uncached
    ].map(function (e){
        var beg = (e.rangeStart)>>>18;
        var end = (e.rangeEnd-1)>>>18;
        for( var i = beg; i <= end; ++i ) {
          map[i] = e;
        }
    });

    if (map.length != 0x4000)
      throw 'initialisation error';

    return map;

  })();


  // Read memory internal is used for stuff like the debugger. It shouldn't ever throw or change the state of the emulated program.
  n64js.readMemoryInternal32 = function (address) {
    //assert(address>=0, "Address is negative");
    var handler = memMap[address >>> 18];
    if (!handler) {
      //n64js.log('internal read from unhandled location ' + toString32(address));
      return 0xdddddddd;
    }
    return handler ? handler.readInternal32(address) : 0xdddddddd;
  }

  // 'emulated' read. May cause exceptions to be thrown in the emulated process
  n64js.readMemory32 = function (address) {
    //assert(address>=0, "Address is negative");
    var handler = memMap[address >>> 18];
    if (!handler) {
      n64js.log('read from unhandled location ' + toString32(address));
      throw 'unmapped read - need to set exception';
    }
    return handler.read32(address);
  }
  // 'emulated' read. May cause exceptions to be thrown in the emulated process
  n64js.readMemory16 = function (address) {
    //assert(address>=0, "Address is negative");
    var handler = memMap[address >>> 18];
    if (!handler) {
      n64js.log('read from unhandled location ' + toString32(address));
      throw 'unmapped read - need to set exception';
    }
    return handler.read16(address);
  }
  // 'emulated' read. May cause exceptions to be thrown in the emulated process
  n64js.readMemory8 = function (address) {
    //assert(address>=0, "Address is negative");
    var handler = memMap[address >>> 18];
    if (!handler) {
      n64js.log('read from unhandled location ' + toString32(address));
      throw 'unmapped read - need to set exception';
    }
    return handler.read8(address);
  }

  // 'emulated' write. May cause exceptions to be thrown in the emulated process
  n64js.writeMemory32 = function (address, value) {
    //assert(address>=0, "Address is negative");
    var handler = memMap[address >>> 18];
    if (!handler) {
      n64js.log('write to unhandled location ' + toString32(address));
      throw 'unmapped write - need to set exception';
    }
    return handler.write32(address, value);
  }

  // 'emulated' write. May cause exceptions to be thrown in the emulated process
  n64js.writeMemory16 = function (address, value) {
    //assert(address>=0, "Address is negative");
    var handler = memMap[address >>> 18];
    if (!handler) {
      n64js.log('write to unhandled location ' + toString32(address));
      throw 'unmapped write - need to set exception';
    }
    return handler.write16(address, value);
  }
    // 'emulated' write. May cause exceptions to be thrown in the emulated process
  n64js.writeMemory8 = function (address, value) {
    //assert(address>=0, "Address is negative");
    var handler = memMap[address >>> 18];
    if (!handler) {
      n64js.log('write to unhandled location ' + toString32(address));
      throw 'unmapped write - need to set exception';
    }
    return handler.write8(address, value);
  }

  var kBootstrapOffset = 0x40;
  var kGameOffset      = 0x1000;


  function BinaryRequest(url, args, cb) {

    var alwaysCallbacks = [];

    if (args) {
      var arg_str = '';
      for (var i in args) {
        if (args.hasOwnProperty(i)) {
          if (arg_str)
            arg_str += '&';
          arg_str += escape(i);
          if (args[i] !== undefined)
            arg_str += '=' + escape(args[i]);
        }
      }

      url += '?' + arg_str;
    }

    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    try {
      xhr.responseType = "arraybuffer";
    } catch (e){
      alert('responseType arrayBuffer not supported!');
    }
    xhr.onreadystatechange = function onreadystatechange () {
      if(xhr.readyState == 4) {
        invokeAlways();
      }
    }
    xhr.onload = function onload() {
      if (ArrayBuffer.prototype.isPrototypeOf(this.response)) {
        cb(this.response);
      } else {
        alert("wasn't arraybuffer, was " + typeof(this.response) + JSON.stringify(this.response));
      }
    }
    xhr.send();


    this.always = function(cb) {
      // If the request has already completed then ensure the callback is called.
      if(xhr.readyState == 4) {
        cb();
      }
      alwaysCallbacks.push(cb);
      return this;
    }

    function invokeAlways() {
      for (var i = 0; i < alwaysCallbacks.length; ++i)
        alwaysCallbacks[i]();
    }
  }

  function SyncBuffer() {

    var kBufferLength   = 1024*1024;

    var sync_buffer     = null;
    var sync_buffer_idx = 0;

    var file_offset     = 0;

    var cur_request     = null;

    this.refill = function () {

      if (!sync_buffer || sync_buffer_idx >= sync_buffer.length) {
        if (cur_request)
          return;
        cur_request = new BinaryRequest("synclog", {o:file_offset,l:kBufferLength}, function (result){
          sync_buffer = new Uint32Array(result);
          sync_buffer_idx = 0;
          file_offset += result.byteLength;
        }).always(function () {
          cur_request = null;
        });
      }
    };

    this.getAvailableOps = function () {
      return sync_buffer ? (sync_buffer.length - sync_buffer_idx) : 0;
    }

    this.pop = function () {
      if (sync_buffer && sync_buffer_idx < sync_buffer.length) {
        var r = sync_buffer[sync_buffer_idx];
        sync_buffer_idx++;
        return r;
      }

      return -1;
    }
  }

  var sync = null;//new SyncBuffer();

  n64js.getSync = function () {
    return sync;
  };

  n64js.nukeSync = function () {
    sync = null;
  }

  var Base64 = {
    _keyStr : "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",
    encodeArray : function (arr) {
      var t = '';
      for (var i = 0; i < arr.length; i += 3) {
        var c0 = arr[i+0];
        var c1 = arr[i+1];
        var c2 = arr[i+2];

        // aaaaaabb bbbbcccc ccdddddd
        var a = c0>>>2;
        var b = ((c0 & 3)<<4) | (c1>>>4);
        var c = ((c1 & 15)<<2) | (c2>>>6);
        var d = c2 & 63;

        if (i+1 >= arr.length)
          c = 64;
        if (i+2 >= arr.length)
          d = 64;

        t += this._keyStr.charAt(a) + this._keyStr.charAt(b) + this._keyStr.charAt(c) + this._keyStr.charAt(d);
      }
      return t;
    },

    decodeArray : function (str, arr) {
      var outi = 0;

      for (var i = 0; i < str.length; i += 4) {
        var a = this._keyStr.indexOf(str.charAt(i+0));
        var b = this._keyStr.indexOf(str.charAt(i+1));
        var c = this._keyStr.indexOf(str.charAt(i+2));
        var d = this._keyStr.indexOf(str.charAt(i+3));

        var c0 = (a << 2) | (b >>> 4);
        var c1 = ((b & 15) << 4) | (c >>> 2);
        var c2 = ((c & 3) << 6) | d;

        arr[outi++] = c0;
        if (c != 64)
          arr[outi++] = c1;
        if (d != 64)
          arr[outi++] = c2;
      }
    }
  }

  function loadEeprom() {
    var prev_eeprom = localStorage.getItem('eeprom');
    if (prev_eeprom) {
      var d = JSON.parse(prev_eeprom);
      if (d.data) {
        Base64.decodeArray(d.data, eeprom.u8);
      }
    }
  }

  function saveEeprom() {
    if (eepromDirty) {

      var encoded = Base64.encodeArray(eeprom.u8);

      var d = {
        data: encoded
      };

      var t = JSON.stringify(d);
      localStorage.setItem('eeprom', t);
      eepromDirty = false;
    }
  }

  n64js.reset = function () {
    var country  = 0x45;  // USA
    var cic_chip = '6102';

    var memory_regions = [ pi_mem, ram, sp_mem, sp_reg, sp_ibist_mem, rdram_reg, mi_reg, vi_reg, ai_reg, pi_reg, ri_reg, si_reg, eeprom ];
    for ( var i = 0; i < memory_regions.length; ++i ) {
      memory_regions[i].clear();
    }

    loadEeprom();

    n64js.cpu0.reset();
    n64js.cpu1.reset();

    mi_reg.write32(MI_VERSION_REG, 0x02020102);
    ri_reg.write32(RI_SELECT_REG, 1);           // This skips most of init

    // Simulate boot

    if (rom) {
      MemoryCopy( sp_mem, kBootstrapOffset, rom, kBootstrapOffset, kGameOffset - kBootstrapOffset );
    }

    var cpu0 = n64js.cpu0;

    function setGPR(reg, hi, lo) {
      cpu0.gprHi[reg] = hi;
      cpu0.gprLo[reg] = lo;
    }

    cpu0.control[cpu0.kControlSR]       = 0x34000000;
    cpu0.control[cpu0.kControlConfig]   = 0x0006E463;
    cpu0.control[cpu0.kControlCount]    = 0x5000;
    cpu0.control[cpu0.kControlCause]    = 0x0000005c;
    cpu0.control[cpu0.kControlContext]  = 0x007FFFF0;
    cpu0.control[cpu0.kControlEPC]      = 0xFFFFFFFF;
    cpu0.control[cpu0.kControlBadVAddr] = 0xFFFFFFFF;
    cpu0.control[cpu0.kControlErrorEPC] = 0xFFFFFFFF;

    setGPR(0, 0x00000000, 0x00000000);
    setGPR(6, 0xFFFFFFFF, 0xA4001F0C);
    setGPR(7, 0xFFFFFFFF, 0xA4001F08);
    setGPR(8, 0x00000000, 0x000000C0);
    setGPR(9, 0x00000000, 0x00000000);
    setGPR(10, 0x00000000, 0x00000040);
    setGPR(11, 0xFFFFFFFF, 0xA4000040);
    setGPR(16, 0x00000000, 0x00000000);
    setGPR(17, 0x00000000, 0x00000000);
    setGPR(18, 0x00000000, 0x00000000);
    setGPR(19, 0x00000000, 0x00000000);
    setGPR(21, 0x00000000, 0x00000000);
    setGPR(26, 0x00000000, 0x00000000);
    setGPR(27, 0x00000000, 0x00000000);
    setGPR(28, 0x00000000, 0x00000000);
    setGPR(29, 0xFFFFFFFF, 0xA4001FF0);
    setGPR(30, 0x00000000, 0x00000000);

    switch (country) {
      case 0x44: //Germany
      case 0x46: //french
      case 0x49: //Italian
      case 0x50: //Europe
      case 0x53: //Spanish
      case 0x55: //Australia
      case 0x58: // ????
      case 0x59: // X (PAL)
        switch (cic_chip) {
          case '6102':
            setGPR(5, 0xFFFFFFFF, 0xC0F1D859);
            setGPR(14, 0x00000000, 0x2DE108EA);
            setGPR(24, 0x00000000, 0x00000000);
            break;
          case '6103':
            setGPR(5, 0xFFFFFFFF, 0xD4646273);
            setGPR(14, 0x00000000, 0x1AF99984);
            setGPR(24, 0x00000000, 0x00000000);
            break;
          case '6105':
            //*(u32 *)&pIMemBase[0x04] = 0xBDA807FC;
            setGPR(5, 0xFFFFFFFF, 0xDECAAAD1);
            setGPR(14, 0x00000000, 0x0CF85C13);
            setGPR(24, 0x00000000, 0x00000002);
            break;
          case '6106':
            setGPR(5, 0xFFFFFFFF, 0xB04DC903);
            setGPR(14, 0x00000000, 0x1AF99984);
            setGPR(24, 0x00000000, 0x00000002);
            break;
          default:
            break;
        }

        setGPR(20, 0x00000000, 0x00000000);
        setGPR(23, 0x00000000, 0x00000006);
        setGPR(31, 0xFFFFFFFF, 0xA4001554);
        break;
      case 0x37: // 7 (Beta)
      case 0x41: // ????
      case 0x45: //USA
      case 0x4A: //Japan
      default:
        switch (cic_chip) {
          case '6102':
            setGPR(5, 0xFFFFFFFF, 0xC95973D5);
            setGPR(14, 0x00000000, 0x2449A366);
            break;
          case '6103':
            setGPR(5, 0xFFFFFFFF, 0x95315A28);
            setGPR(14, 0x00000000, 0x5BACA1DF);
            break;
          case '6105':
            //*(u32  *)&pIMemBase[0x04] = 0x8DA807FC;
            setGPR(5, 0x00000000, 0x5493FB9A);
            setGPR(14, 0xFFFFFFFF, 0xC2C20384);
          case '6106':
            setGPR(5, 0xFFFFFFFF, 0xE067221F);
            setGPR(14, 0x00000000, 0x5CD2B70F);
            break;
          default:
            break;
        }
        setGPR(20, 0x00000000, 0x00000001);
        setGPR(23, 0x00000000, 0x00000000);
        setGPR(24, 0x00000000, 0x00000003);
        setGPR(31, 0xFFFFFFFF, 0xA4001550);
    }


    switch (cic_chip) {
      case '6101':
        setGPR(22, 0x00000000, 0x0000003F);
        break;
      case '6102':
        setGPR(1, 0x00000000, 0x00000001);
        setGPR(2, 0x00000000, 0x0EBDA536);
        setGPR(3, 0x00000000, 0x0EBDA536);
        setGPR(4, 0x00000000, 0x0000A536);
        setGPR(12, 0xFFFFFFFF, 0xED10D0B3);
        setGPR(13, 0x00000000, 0x1402A4CC);
        setGPR(15, 0x00000000, 0x3103E121);
        setGPR(22, 0x00000000, 0x0000003F);
        setGPR(25, 0xFFFFFFFF, 0x9DEBB54F);
        break;
      case '6103':
        setGPR(1, 0x00000000, 0x00000001);
        setGPR(2, 0x00000000, 0x49A5EE96);
        setGPR(3, 0x00000000, 0x49A5EE96);
        setGPR(4, 0x00000000, 0x0000EE96);
        setGPR(12, 0xFFFFFFFF, 0xCE9DFBF7);
        setGPR(13, 0xFFFFFFFF, 0xCE9DFBF7);
        setGPR(15, 0x00000000, 0x18B63D28);
        setGPR(22, 0x00000000, 0x00000078);
        setGPR(25, 0xFFFFFFFF, 0x825B21C9);
        break;
      case '6105':
        //*(u32  *)&pIMemBase[0x00] = 0x3C0DBFC0;
        //*(u32  *)&pIMemBase[0x08] = 0x25AD07C0;
        //*(u32  *)&pIMemBase[0x0C] = 0x31080080;
        //*(u32  *)&pIMemBase[0x10] = 0x5500FFFC;
        //*(u32  *)&pIMemBase[0x14] = 0x3C0DBFC0;
        //*(u32  *)&pIMemBase[0x18] = 0x8DA80024;
        //*(u32  *)&pIMemBase[0x1C] = 0x3C0BB000;
        setGPR(1, 0x00000000, 0x00000000);
        setGPR(2, 0xFFFFFFFF, 0xF58B0FBF);
        setGPR(3, 0xFFFFFFFF, 0xF58B0FBF);
        setGPR(4, 0x00000000, 0x00000FBF);
        setGPR(12, 0xFFFFFFFF, 0x9651F81E);
        setGPR(13, 0x00000000, 0x2D42AAC5);
        setGPR(15, 0x00000000, 0x56584D60);
        setGPR(22, 0x00000000, 0x00000091);
        setGPR(25, 0xFFFFFFFF, 0xCDCE565F);
        break;
      case '6106':
        setGPR(1, 0x00000000, 0x00000000);
        setGPR(2, 0xFFFFFFFF, 0xA95930A4);
        setGPR(3, 0xFFFFFFFF, 0xA95930A4);
        setGPR(4, 0x00000000, 0x000030A4);
        setGPR(12, 0xFFFFFFFF, 0xBCB59510);
        setGPR(13, 0xFFFFFFFF, 0xBCB59510);
        setGPR(15, 0x00000000, 0x7A3C07F4);
        setGPR(22, 0x00000000, 0x00000085);
        setGPR(25, 0x00000000, 0x465E3F72);
        break;
      default:
        break;
    }

    cpu0.pc = 0xA4000040;
  };


  function fixEndian(arrayBuffer) {
    var dataView = new DataView(arrayBuffer);

    function byteSwap(buffer, _a, _b, _c, _d) {

      var u8 = new Uint8Array(buffer);

      for (var i = 0; i < u8.length; i += 4) {
        var a = u8[i+_a], b = u8[i+_b], c = u8[i+_c], d = u8[i+_d];
        u8[i+0] = a;
        u8[i+1] = b;
        u8[i+2] = c;
        u8[i+3] = d;
      }
    }

    switch (dataView.getUint32(0)) {
      case 0x80371240:
        // ok
        break;
      case 0x40123780:
        byteSwap(arrayBuffer, 3, 2, 1, 0);
        break;
      case 0x12408037:
        byteSwap(arrayBuffer, 2, 3, 0, 1);
        break;
      case 0x37804012:
        byteSwap(arrayBuffer, 1, 0, 3, 2);
        break;
      default:
        throw 'Unhandled byteswapping: ' + dataView.getUint32(0).toString(16);
        break;
    }
  }

  function dataViewReadString(dataView, offset, max_len) {
    var s = '';
    for (var i = 0; i < max_len; ++i) {
      var c = dataView.getUint8(offset+i);
      if (c == 0) {
        break;
      }
      s += String.fromCharCode(c);
    }
    return s;
  }

  n64js.loadRom = function (arrayBuffer) {
    fixEndian(arrayBuffer);

    rom = new Memory(arrayBuffer);
    rom_d1a1_handler_uncached.dataView = rom.dataView;
    rom_d1a2_handler_uncached.dataView = rom.dataView;
    rom_d2a1_handler_uncached.dataView = rom.dataView;
    rom_d2a2_handler_uncached.dataView = rom.dataView;

    var hdr = {};
    hdr.header       = rom.dataView.getUint32(0);
    hdr.clock        = rom.dataView.getUint32(4);
    hdr.bootAddress  = rom.dataView.getUint32(8);
    hdr.release      = rom.dataView.getUint32(12);
    hdr.crclo        = rom.dataView.getUint32(16);   // or hi?
    hdr.crchi        = rom.dataView.getUint32(20);   // or lo?
    hdr.unk0         = rom.dataView.getUint32(24);
    hdr.unk1         = rom.dataView.getUint32(28);
    hdr.name         = dataViewReadString(rom.dataView, 32, 20);
    hdr.unk2         = rom.dataView.getUint32(52);
    hdr.unk3         = rom.dataView.getUint16(56);
    hdr.unk4         = rom.dataView.getUint8 (58);
    hdr.manufacturer = rom.dataView.getUint8 (59);
    hdr.cartId       = rom.dataView.getUint16(60);
    hdr.countryId    = rom.dataView.getUint8 (62);  // char
    hdr.unk5         = rom.dataView.getUint8 (63);

    $rominfo.html('');
    var $table = $('<table class="register-table"><tbody></tbody></table>');
    var $tb = $table.find('tbody');
    for (var i in hdr) {
      $tb.append('<tr>' +
        '<td>' + i + '</td><td>' + (typeof hdr[i] === 'string' ? hdr[i] : toString32(hdr[i])) + '</td>' +
        '</tr>');
    }
    $rominfo.append($table);
  }

  n64js.verticalBlank = function() {
    // FIXME: framerate limit etc

    saveEeprom();

    mi_reg.setBits32(MI_INTR_REG, MI_INTR_VI);
    n64js.cpu0.updateCause3();
  }

  function toHex(r, bits) {
    r = Number(r);
    if (r < 0) {
        r = 0xFFFFFFFF + r + 1;
    }

    var t = r.toString(16);

    if (bits) {
      var len = Math.floor(bits / 4); // 4 bits per hex char
      while (t.length < len) {
        t = '0' + t;
      }
    }

    return t;
  }

  function toString8(v) {
    return '0x' + toHex((v&0xff)>>>0, 8);
  }
  function toString16(v) {
    return '0x' + toHex((v&0xffff)>>>0, 16);
  }
  function toString32(v) {
    return '0x' + toHex(v, 32);
  }

  function toString64(hi, lo) {
    var t = toHex(lo, 32);
    var u = toHex(hi, 32);
    return '0x' + u + t;
  }

  n64js.toHex      = toHex;
  n64js.toString8  = toString8;
  n64js.toString16 = toString16;
  n64js.toString32 = toString32;
  n64js.toString64 = toString64;

  n64js.miInterruptsUnmasked = function () {
    return (mi_reg.read32(MI_INTR_MASK_REG) & mi_reg.read32(MI_INTR_REG)) !== 0;
  }

  n64js.haltSP = function () {
    var status = sp_reg.setBits32(SP_STATUS_REG, SP_STATUS_TASKDONE|SP_STATUS_BROKE|SP_STATUS_HALT);
    if (status & SP_STATUS_INTR_BREAK) {
      mi_reg.setBits32(MI_INTR_REG, MI_INTR_SP);
      n64js.cpu0.updateCause3();
    }
  }

  n64js.interruptDP = function () {
    mi_reg.setBits32(MI_INTR_REG, MI_INTR_DP);
    n64js.cpu0.updateCause3();
  }

})();