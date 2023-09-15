/*global n64js*/

import { hleGraphics } from "./hle_graphics.js";

// Whether to skip audio task emulator or run it on the RSP.
// Set this to false to enable audio in most games.
export let skipAudioTaskEmulation = false;

// Task offset in dmem.
const kTaskOffset = 0x0fc0;

// Task length in dmem.
const kTaskLength = 0x40;

const kOffset_type             = 0x00; // u32
const kOffset_flags            = 0x04; // u32
const kOffset_ucode_boot       = 0x08; // u64*
const kOffset_ucode_boot_size  = 0x0c; // u32
const kOffset_ucode            = 0x10; // u64*
const kOffset_ucode_size       = 0x14; // u32
const kOffset_ucode_data       = 0x18; // u64*
const kOffset_ucode_data_size  = 0x1c; // u32
const kOffset_dram_stack       = 0x20; // u64*
const kOffset_dram_stack_size  = 0x24; // u32
const kOffset_output_buff      = 0x28; // u64*
const kOffset_output_buff_size = 0x2c; // u64*
const kOffset_data_ptr         = 0x30; // u64*
const kOffset_data_size        = 0x34; // u32
const kOffset_yield_data_ptr   = 0x38; // u64*
const kOffset_yield_data_size  = 0x3c; // u32

const M_GFXTASK = 1;
const M_AUDTASK = 2;
const M_VIDTASK = 3;
const M_JPGTASK = 4;

class RSPTask {
  /**
   * Constructs a new RSPTask instance.
   * @param {Uint8Array} ram_u8 Main memory.
   * @param {MemoryRegion} taskMem RSP task memmory.
   */
  constructor(ram_u8, taskMem) {
    this.ram_u8 = ram_u8;
    this.type = taskMem.getU32(kOffset_type);
    this.code = taskMem.getU32(kOffset_ucode) & 0x1fffffff;
    this.code_size = this.clampCodeSize(taskMem.getU32(kOffset_ucode_size));
    this.data = taskMem.getU32(kOffset_ucode_data) & 0x1fffffff;
    this.data_size = taskMem.getU32(kOffset_ucode_data_size);
    this.data_ptr = taskMem.getU32(kOffset_data_ptr);
  }

  clampCodeSize(val) {
    // Some roms don't seem to set this, or set to large/negative values 
    // that look suspiciously like addresses (like 0x80130000).
    if (val == 0 || val > 0x1000) {
      return 0x1000;
    }
    return val;
  }

  dataByte(offset) {
    return this.ram_u8[this.data + offset]
  }

  codeByte(offset) {
    return this.ram_u8[this.code + offset];
  }

  detectVersionString() {
    const r = 'R'.charCodeAt(0);
    const s = 'S'.charCodeAt(0);
    const p = 'P'.charCodeAt(0);

    for (let i = 0; i + 2 < this.data_size; ++i) {
      if (this.dataByte(i + 0) === r &&
        this.dataByte(i + 1) === s &&
        this.dataByte(i + 2) === p) {
        let str = '';
        for (let j = i; j < this.data_size; ++j) {
          const c = this.dataByte(j);
          if (c === 0) {
            return str;
          }
          str += String.fromCharCode(c);
        }
      }
    }
    return '';
  }

  computeMicrocodeHash() {
    let c = 0;
    for (let i = 0; i < this.code_size; ++i) {
      // Best hash ever!
      c = ((c * 17) + this.codeByte(i)) >>> 0;
    }
    return c;
  }
}

export function hleProcessRSPTask() {
    const ramU8 = n64js.hardware().cachedMemDevice.u8;
    const taskMem = n64js.hardware().sp_mem.subRegion(kTaskOffset, kTaskLength);
    var task = new RSPTask(ramU8, taskMem);
  
    let handled = false;
  
    switch (task.type) {
      case M_GFXTASK:
        hleGraphics(task);
        n64js.hardware().miRegDevice.interruptDP();
        handled = true;
        break;
      case M_AUDTASK:
        // Ignore for now (pretend we handled it to avoid running RSP).
        handled = skipAudioTaskEmulation;
        break;
      case M_VIDTASK:
        // Run on the RSP.
        break;
      case M_JPGTASK:
        // Run on the RSP.
        break;
    }
  
    return handled;
  }
  