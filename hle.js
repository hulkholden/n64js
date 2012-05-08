if (typeof n64js === 'undefined') {
  var n64js = {};
}

(function () {'use strict';

  var graphics_task_count = 0;

  n64js.RSPHLEProcessTask = function() {
    var task_offset = 0x0fc0;

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

    var M_GFXTASK = 1;
    var M_AUDTASK = 2;
    var M_VIDTASK = 3;
    var M_JPGTASK = 4;


    var type = n64js.sp_mem.read32(task_offset + kOffset_type);
    switch (type) {
      case M_GFXTASK:
        n64js.log('graphics task ' + graphics_task_count);
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


})();