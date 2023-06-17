
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



export class SIRegDevice extends Device {
  constructor(hardware, rangeStart, rangeEnd) {
    super("SIReg", hardware.si_reg, rangeStart, rangeEnd);
    this.hardware = hardware;
  }

  readS32(address) {
    this.logRead(address);
    var ea = this.calcEA(address);

    if (ea + 4 > this.u8.length) {
      throw 'Read is out of range';
    }
    if (ea === SI_STATUS_REG) {
      this.checkSIStatusConsistent();
    }
    return this.mem.readS32(ea);
  }

  readU32(address) {
    return this.readS32(address) >>> 0;
  }

  write32(address, value) {
    var ea = this.calcEA(address);
    if (ea + 4 > this.u8.length) {
      throw 'Write is out of range';
    }

    switch (ea) {
      case SI_DRAM_ADDR_REG:
        if (!this.quiet) { logger.log('Writing to SI dram address reigster: ' + toString32(value)); }
        this.mem.write32(ea, value);
        break;
      case SI_PIF_ADDR_RD64B_REG:
        this.mem.write32(ea, value);
        this.copyToRDRAM();
        break;
      case SI_PIF_ADDR_WR64B_REG:
        this.mem.write32(ea, value);
        this.copyFromRDRAM();
        break;
      case SI_STATUS_REG:
        if (!this.quiet) { logger.log('SI interrupt cleared'); }
        this.mem.clearBits32(SI_STATUS_REG, SI_STATUS_INTERRUPT);
        this.hardware.mi_reg.clearBits32(mi.MI_INTR_REG, mi.MI_INTR_SI);
        n64js.cpu0.updateCause3();
        break;
      default:
        logger.log('Unhandled write to SIReg: ' + toString32(value) + ' -> [' + toString32(address) + ']');
        this.mem.write32(ea, value);
        break;
    }
  }

  checkSIStatusConsistent() {
    var mi_si_int_set = this.hardware.mi_reg.getBits32(mi.MI_INTR_REG, mi.MI_INTR_SI) !== 0;
    var si_status_int_set = this.mem.getBits32(SI_STATUS_REG, SI_STATUS_INTERRUPT) !== 0;
    if (mi_si_int_set !== si_status_int_set) {
      n64js.halt("SI_STATUS register is in an inconsistent state");
    }
  }

  copyFromRDRAM() {
    var dram_address = this.mem.readU32(SI_DRAM_ADDR_REG) & 0x1fffffff;
    var pi_ram = new Uint8Array(this.hardware.pi_mem.arrayBuffer, 0x7c0, 0x040);

    if (!this.quiet) { logger.log('SI: copying from ' + toString32(dram_address) + ' to PI RAM'); }

    var i;
    for (i = 0; i < 64; ++i) {
      pi_ram[i] = this.hardware.ram.u8[dram_address + i];
    }

    var control_byte = pi_ram[0x3f];
    if (control_byte > 0) {
      if (!this.quiet) { logger.log('SI: wrote ' + control_byte + ' to the control byte'); }
    }

    this.mem.setBits32(SI_STATUS_REG, SI_STATUS_INTERRUPT);
    this.hardware.mi_reg.setBits32(mi.MI_INTR_REG, mi.MI_INTR_SI);
    n64js.cpu0.updateCause3();
  }

  copyToRDRAM() {
    n64js.updateController();

    var dram_address = this.mem.readU32(SI_DRAM_ADDR_REG) & 0x1fffffff;
    var pi_ram = new Uint8Array(this.hardware.pi_mem.arrayBuffer, 0x7c0, 0x040);

    if (!this.quiet) { logger.log('SI: copying from PI RAM to ' + toString32(dram_address)); }

    var i;
    for (i = 0; i < 64; ++i) {
      this.hardware.ram.u8[dram_address + i] = pi_ram[i];
    }

    this.mem.setBits32(SI_STATUS_REG, SI_STATUS_INTERRUPT);
    this.hardware.mi_reg.setBits32(mi.MI_INTR_REG, mi.MI_INTR_SI);
    n64js.cpu0.updateCause3();
  }
}
