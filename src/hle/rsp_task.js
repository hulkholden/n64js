/*global n64js*/

import { dbgGUI } from "../dbg_ui.js";
import { disassembleRemappedRange, dumpDMEM } from "../disassemble_rsp.js";
import { toHex } from "../format.js";
import { hleGraphics } from "./hle_graphics.js";

// Whether to skip audio task emulator or run it on the RSP.
// Set this to false to enable audio in most games.
const audioOptions = {
  enableAudioLLE: true,
};

const audioFolder = dbgGUI.addFolder('Audio');
audioFolder.add(audioOptions, 'enableAudioLLE').name('Audio LLE');

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

    this.codeAddr = taskMem.getU32(kOffset_ucode) & 0x1fffffff;
    this.codeSize = this.clampCodeSize(taskMem.getU32(kOffset_ucode_size));

    this.codeDataAddr = taskMem.getU32(kOffset_ucode_data) & 0x1fffffff;
    this.codeDataSize = taskMem.getU32(kOffset_ucode_data_size);

    this.dataPtr = taskMem.getU32(kOffset_data_ptr);
  }

  dumpCode() {
    const mem = n64js.hardware().cachedMemDevice.mem;
    // Set baseAddr to 0x1000 so we translate everything from the location in
    // RAM to where it will be loaded in IMEM.
    // TODO: Is there any way to figure this out automatically?
    // This value is for S2DEX 1.06.
    const loadAddress = 0x1080;
    const disassembly = disassembleRemappedRange(mem, loadAddress, this.codeAddr, this.codeSize);
    let text = `${this.detectVersionString()}\n`;
    for (let d of disassembly) {
      text += `${toHex(d.address, 16)} ${d.disassembly}\n`;
    }
    text += '\nDMEM\n';
    text += dumpDMEM(mem, 0x0000, this.codeDataAddr, this.codeDataSize);
    console.log(text);
  }

  loadUcode(codeAddr, codeSize, codeDataAddr, codeDataSize) {
    this.codeAddr = codeAddr & 0x1fffffff;
    this.codeSize = this.clampCodeSize(codeSize);
    this.codeDataAddr = codeDataAddr & 0x1fffffff;
    this.codeDataSize = codeDataSize;
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
    return this.ram_u8[this.codeDataAddr + offset]
  }

  codeByte(offset) {
    return this.ram_u8[this.codeAddr + offset];
  }

  detectVersionString() {
    const r = 'R'.charCodeAt(0);
    const s = 'S'.charCodeAt(0);
    const p = 'P'.charCodeAt(0);

    for (let i = 0; i + 2 < this.codeDataSize; ++i) {
      if (this.dataByte(i + 0) === r &&
        this.dataByte(i + 1) === s &&
        this.dataByte(i + 2) === p) {
        let str = '';
        for (let j = i; j < this.codeDataSize; ++j) {
          const c = this.dataByte(j);
          if (c === 0) {
            break;
          }
          if (c >= 32) {
            str += String.fromCharCode(c);
          }
        }
        return str;
      }
    }
    return '';
  }

  computeMicrocodeHash() {
    let c = 0;
    for (let i = 0; i < this.codeSize; ++i) {
      // Best hash ever!
      c = ((c * 17) + this.codeByte(i)) >>> 0;
    }
    return c;
  }
}

export function hleProcessRSPTask() {
  const hardware = n64js.hardware();
  const ramU8 = hardware.cachedMemDevice.u8;
  const taskMem = hardware.sp_mem.subRegion(kTaskOffset, kTaskLength);
  const task = new RSPTask(ramU8, taskMem);

  let handled = false;

  switch (task.type) {
    case M_GFXTASK:
      {
        const ev = hardware.timeline.startEvent(`HLE Task ${task.detectVersionString()}`);
        hleGraphics(task);
        hardware.miRegDevice.interruptDP();
        if (ev) {
          ev.stop();
        }
        handled = true;
      }
      break;
    case M_AUDTASK:
      // If enableAudioLLE is clear, pretend we handled the task (we'll play silence).
      handled = !audioOptions.enableAudioLLE;
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
