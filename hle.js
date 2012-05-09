if (typeof n64js === 'undefined') {
  var n64js = {};
}

(function () {'use strict';

  var graphics_task_count = 0;

  var kOffset_type                = 0x00;    // u32
  var kOffset_flags               = 0x04;    // u32
  var kOffset_ucode_boot          = 0x08;    // u64*
  var kOffset_ucode_boot_size     = 0x0c;    // u32
  var kOffset_ucode               = 0x10;    // u64*
  var kOffset_ucode_size          = 0x14;    // u32
  var kOffset_ucode_data          = 0x18;    // u64*
  var kOffset_ucode_data_size     = 0x1c;    // u32
  var kOffset_dram_stack          = 0x20;    // u64*
  var kOffset_dram_stack_size     = 0x24;    // u32
  var kOffset_output_buff         = 0x28;    // u64*
  var kOffset_output_buff_size    = 0x2c;    // u64*
  var kOffset_data_ptr            = 0x30;    // u64*
  var kOffset_data_size           = 0x34;    // u32
  var kOffset_yield_data_ptr      = 0x38;    // u64*
  var kOffset_yield_data_size     = 0x3c;    // u32

  // task, ram are both DataView objects
  n64js.RSPHLEProcessTask = function(task, ram) {
    var M_GFXTASK = 1;
    var M_AUDTASK = 2;
    var M_VIDTASK = 3;
    var M_JPGTASK = 4;

    var type = task.getUint32(kOffset_type);
    switch (type) {
      case M_GFXTASK:
        n64js.log('graphics task ' + graphics_task_count);
        processDisplayList(task, ram);
        ++graphics_task_count;
        n64js.interruptDP();
        break;
      case M_AUDTASK:
        //n64js.log('audio task');
        break;
      case M_VIDTASK:
        n64js.log('video task');
        break;
      case M_JPGTASK:
        n64js.log('jpg task');
        break;

      default:
        n64js.log('unknown task');
        break;
    }

    n64js.haltSP();
  }

  function detectVersionString(ram, data_base, data_size) {
    var r = 'R'.charCodeAt(0);
    var s = 'S'.charCodeAt(0);
    var p = 'P'.charCodeAt(0);

    for (var i = 0; i+2 < data_size; ++i) {
      if (ram.getInt8(data_base+i+0) == r &&
          ram.getInt8(data_base+i+1) == s &&
          ram.getInt8(data_base+i+2) ==p) {
        var str = '';
        for (var p = i; p < data_size; ++p) {
          var c = ram.getInt8(data_base+p);
          if (c == 0)
            return str;

          str += String.fromCharCode(c);
        }
      }
    }
    return '';
  }

  function processDisplayList(task, ram) {
    var code_base = task.getUint32(kOffset_ucode) & 0x1fffffff;
    var code_size = task.getUint32(kOffset_ucode_size);
    var data_base = task.getUint32(kOffset_ucode_data) & 0x1fffffff;
    var data_size = task.getUint32(kOffset_ucode_data_size);

    var str = detectVersionString(ram, data_base, data_size);

    n64js.log('Found ' + str);
  }


})();