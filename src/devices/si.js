/*global n64js*/

import { Device } from './device.js';
import * as mi from './mi.js';
import * as logger from '../logger.js';
import { toString32 } from '../format.js';

// Serial Interface
export const SI_DRAM_ADDR_REG = 0x00;
export const SI_PIF_ADDR_RD64B_REG = 0x04;
export const SI_PIF_ADDR_WR64B_REG = 0x10;
export const SI_STATUS_REG = 0x18;

export const SI_STATUS_DMA_BUSY = 0x0001;
export const SI_STATUS_RD_BUSY = 0x0002;
export const SI_STATUS_DMA_ERROR = 0x0008;
export const SI_STATUS_INTERRUPT = 0x1000;

const kSIDMAEvent = 'SI DMA';
// Nominal Count cycles for a 64-byte transfer (also Mupen64Plus's default).
// https://github.com/mupen64plus/mupen64plus-core/blob/master/src/main/rom.c
// This approximates SI/PIF timing; instantaneous completion lets NBA Pro 98
// reuse a queued display-list buffer before the graphics task consumes it.
const dmaCycles = 0x900;

export class SIRegDevice extends Device {
  constructor(hardware, rangeStart, rangeEnd) {
    super("SIReg", hardware, hardware.si_reg, rangeStart, rangeEnd);
  }

  reset() {
    this.hardware.cpu0.removeEvent(kSIDMAEvent);
  }

  readU32(address) {
    this.logRead(address);
    const ea = this.calcReadEA(address);

    if (ea + 4 > this.u8.length) {
      throw 'Read is out of range';
    }
    if (ea === SI_STATUS_REG) {
      this.checkStatusConsistent();
    }
    return this.mem.getU32(ea);
  }

  write32(address, value) {
    const ea = this.calcWriteEA(address);
    if (ea + 4 > this.u8.length) {
      throw 'Write is out of range';
    }

    switch (ea) {
      case SI_DRAM_ADDR_REG:
        if (!this.quiet) { logger.log(`Writing to SI dram address reigster: ${toString32(value)}`); }
        this.mem.set32(ea, value);
        break;
      case SI_PIF_ADDR_RD64B_REG:
        this.mem.set32(ea, value);
        this.copyToRDRAM();
        break;
      case SI_PIF_ADDR_WR64B_REG:
        this.mem.set32(ea, value);
        this.copyFromRDRAM();
        break;
      case SI_STATUS_REG:
        if (!this.quiet) { logger.log('SI interrupt cleared'); }
        this.mem.clearBits32(SI_STATUS_REG, SI_STATUS_INTERRUPT);
        this.hardware.mi_reg.clearBits32(mi.MI_INTR_REG, mi.MI_INTR_SI);
        n64js.cpu0.updateCause3();
        break;
      default:
        logger.log(`Unhandled write to SIReg: ${toString32(value)} -> [${toString32(address)}]`);
        this.mem.set32(ea, value);
        break;
    }
  }

  checkStatusConsistent() {
    const miIntrSI = this.hardware.mi_reg.getBits32(mi.MI_INTR_REG, mi.MI_INTR_SI) !== 0;
    const siStatusIntr = this.mem.getBits32(SI_STATUS_REG, SI_STATUS_INTERRUPT) !== 0;
    if (miIntrSI !== siStatusIntr) {
      n64js.halt("SI_STATUS register is in an inconsistent state");
    }
  }

  copyFromRDRAM() {
    if (!this.beginDMA()) return;
    const dramAddr = this.mem.getU32(SI_DRAM_ADDR_REG) & 0x1fffffff;
    
    if (!this.quiet) { logger.log(`SI: copying from ${toString32(dramAddr)} to PIF RAM`); }
    
    n64js.joybus().dmaWrite(this.hardware.ram, dramAddr);
  }

  copyToRDRAM() {
    if (!this.beginDMA()) return;
    const dramAddr = this.mem.getU32(SI_DRAM_ADDR_REG) & 0x1fffffff;
    
    if (!this.quiet) { logger.log(`SI: copying from PIF RAM to ${toString32(dramAddr)}`); }
    
    n64js.joybus().dmaRead(this.hardware.ram, dramAddr);
  }

  beginDMA() {
    // Reject overlapping requests with DMA_ERROR, preserving the active
    // transfer and its scheduled completion without copying any new data.
    if (this.mem.getBits32(SI_STATUS_REG, SI_STATUS_DMA_BUSY)) {
      this.mem.setBits32(SI_STATUS_REG, SI_STATUS_DMA_ERROR);
      return false;
    }
    // Keep the existing synchronous data copy, but expose an in-flight DMA
    // until completion. A status-register acknowledgement must not cancel it.
    this.mem.setBits32(SI_STATUS_REG, SI_STATUS_DMA_BUSY);
    this.hardware.cpu0.addEvent(kSIDMAEvent, dmaCycles, () => {
      this.mem.clearBits32(SI_STATUS_REG, SI_STATUS_DMA_BUSY);
      this.mem.setBits32(SI_STATUS_REG, SI_STATUS_INTERRUPT);
      this.hardware.mi_reg.setBits32(mi.MI_INTR_REG, mi.MI_INTR_SI);
      n64js.cpu0.updateCause3();
    });
    return true;
  }
}
