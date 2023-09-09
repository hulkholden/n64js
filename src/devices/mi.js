/*global n64js*/

import { Device } from './device.js';
import * as logger from '../logger.js';
import { toString32 } from '../format.js';

// MIPS Interface
export const MI_MODE_REG = 0x00;
export const MI_VERSION_REG = 0x04;
export const MI_INTR_REG = 0x08;
export const MI_INTR_MASK_REG = 0x0C;

export const MI_CLR_INIT = 0x0080;
export const MI_SET_INIT = 0x0100;
export const MI_CLR_EBUS = 0x0200;
export const MI_SET_EBUS = 0x0400;
export const MI_CLR_DP_INTR = 0x0800;
export const MI_CLR_RDRAM = 0x1000;
export const MI_SET_RDRAM = 0x2000;

export const MI_MODE_INIT = 0x0080;
export const MI_MODE_EBUS = 0x0100;
export const MI_MODE_RDRAM = 0x0200;

export const MI_INTR_MASK_CLR_SP = 0x0001;
export const MI_INTR_MASK_SET_SP = 0x0002;
export const MI_INTR_MASK_CLR_SI = 0x0004;
export const MI_INTR_MASK_SET_SI = 0x0008;
export const MI_INTR_MASK_CLR_AI = 0x0010;
export const MI_INTR_MASK_SET_AI = 0x0020;
export const MI_INTR_MASK_CLR_VI = 0x0040;
export const MI_INTR_MASK_SET_VI = 0x0080;
export const MI_INTR_MASK_CLR_PI = 0x0100;
export const MI_INTR_MASK_SET_PI = 0x0200;
export const MI_INTR_MASK_CLR_DP = 0x0400;
export const MI_INTR_MASK_SET_DP = 0x0800;

export const MI_INTR_MASK_SP = 0x01;
export const MI_INTR_MASK_SI = 0x02;
export const MI_INTR_MASK_AI = 0x04;
export const MI_INTR_MASK_VI = 0x08;
export const MI_INTR_MASK_PI = 0x10;
export const MI_INTR_MASK_DP = 0x20;

export const MI_INTR_SP = 0x01;
export const MI_INTR_SI = 0x02;
export const MI_INTR_AI = 0x04;
export const MI_INTR_VI = 0x08;
export const MI_INTR_PI = 0x10;
export const MI_INTR_DP = 0x20;

export class MIRegDevice extends Device {
  constructor(hardware, rangeStart, rangeEnd) {
    super("MIReg", hardware, hardware.mi_reg, rangeStart, rangeEnd);
  }

  reset() {
    this.mem.set32(MI_VERSION_REG, 0x02020102);
  }

  interruptsUnmasked() {
    return (this.mem.getU32(MI_INTR_MASK_REG) & this.mem.getU32(MI_INTR_REG)) !== 0;
  }

  intrReg() {
    return this.mem.getU32(MI_INTR_REG);
  }

  intrMaskReg() {
    return this.mem.getU32(MI_INTR_MASK_REG);
  }

  setInterruptBit(bit) {
    this.mem.setBits32(MI_INTR_REG, bit);
    n64js.cpu0.updateCause3();
  }

  interruptSP() {
    this.setInterruptBit(MI_INTR_SP);
  }

  interruptDP() {
    this.setInterruptBit(MI_INTR_DP);
  }

  write32(address, value) {
    const ea = this.calcWriteEA(address);
    if (ea + 4 > this.u8.length) {
      throw 'Write is out of range';
    }

    switch (ea) {
      case MI_MODE_REG:
        if (!this.quiet) { logger.log(`Wrote to MI mode register: ${toString32(value)}`); }
        this.writeModeReg(value);
        break;
      case MI_INTR_MASK_REG:
        if (!this.quiet) { logger.log(`Wrote to MI interrupt mask register: ${toString32(value)}`); }
        this.writeIntrMaskReg(value);
        break;

      case MI_VERSION_REG:
      case MI_INTR_REG:
        // Read only
        break;

      default:
        logger.log(`Unhandled write to MIReg: ${toString32(value)} -> [${toString32(address)}]`);
        this.mem.set32(ea, value);
        break;
    }
  }

  writeModeReg(value) {
    let mode = this.mem.getU32(MI_MODE_REG);

    if (value & MI_SET_RDRAM) { mode |= MI_MODE_RDRAM; }
    if (value & MI_CLR_RDRAM) { mode &= ~MI_MODE_RDRAM; }

    if (value & MI_SET_INIT) { mode |= MI_MODE_INIT; }
    if (value & MI_CLR_INIT) { mode &= ~MI_MODE_INIT; }

    if (value & MI_SET_EBUS) { mode |= MI_MODE_EBUS; }
    if (value & MI_CLR_EBUS) { mode &= ~MI_MODE_EBUS; }

    this.mem.set32(MI_MODE_REG, mode);

    if (value & MI_CLR_DP_INTR) {
      this.mem.clearBits32(MI_INTR_REG, MI_INTR_DP);
      n64js.cpu0.updateCause3();
    }
  }

  writeIntrMaskReg(value) {
    let clr = 0;
    let set = 0;

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

    let mask = this.mem.getU32(MI_INTR_MASK_REG);
    mask &= ~clr;
    mask |= set;
    this.mem.set32(MI_INTR_MASK_REG, mask);

    // Check if any interrupts are enabled now, and immediately trigger an interrupt
    n64js.cpu0.updateCause3();
  }
}

