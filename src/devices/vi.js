import { Device } from './device.js';
import * as mi from './mi.js';
import * as logger from '../logger.js';
import { toString32 } from '../format.js';

// Video Interface
const VI_STATUS_REG = 0x00;
const VI_ORIGIN_REG = 0x04;
const VI_WIDTH_REG = 0x08;
const VI_INTR_REG = 0x0C;
const VI_CURRENT_REG = 0x10;
const VI_BURST_REG = 0x14;
const VI_V_SYNC_REG = 0x18;
const VI_H_SYNC_REG = 0x1C;
const VI_LEAP_REG = 0x20;
const VI_H_START_REG = 0x24;
const VI_V_START_REG = 0x28;
const VI_V_BURST_REG = 0x2C;
const VI_X_SCALE_REG = 0x30;
const VI_Y_SCALE_REG = 0x34;

const VI_CONTROL_REG = VI_STATUS_REG;
const VI_DRAM_ADDR_REG = VI_ORIGIN_REG;
const VI_H_WIDTH_REG = VI_WIDTH_REG;
const VI_V_INTR_REG = VI_INTR_REG;
const VI_V_CURRENT_LINE_REG = VI_CURRENT_REG;
const VI_TIMING_REG = VI_BURST_REG;
const VI_H_SYNC_LEAP_REG = VI_LEAP_REG;
const VI_H_VIDEO_REG = VI_H_START_REG;
const VI_V_VIDEO_REG = VI_V_START_REG;


export class VIRegDevice extends Device {
  constructor(hardware, rangeStart, rangeEnd) {
    super("VIReg", hardware, hardware.vi_reg, rangeStart, rangeEnd);

    this.curVbl = 0;
    this.lastVbl = 0;
  }

  verticalBlank() {
    this.hardware.mi_reg.setBits32(mi.MI_INTR_REG, mi.MI_INTR_VI);
    n64js.cpu0.updateCause3();

    ++this.curVbl;
  }

  viOrigin() { return this.mem.readU32(VI_ORIGIN_REG); };
  viWidth() { return this.mem.readU32(VI_WIDTH_REG); };
  viXScale() { return this.mem.readU32(VI_X_SCALE_REG); };
  viYScale() { return this.mem.readU32(VI_Y_SCALE_REG); };
  viHStart() { return this.mem.readU32(VI_H_START_REG); };
  viVStart() { return this.mem.readU32(VI_V_START_REG); };

  write32(address, value) {
    var ea = this.calcEA(address);
    if (ea + 4 > this.u8.length) {
      throw 'Write is out of range';
    }

    switch (ea) {
      case VI_ORIGIN_REG:
        var last_origin = this.mem.readU32(ea);
        var new_origin = value >>> 0;
        if (new_origin !== last_origin/* || this.curVbl !== this.lastVbl*/) {
          n64js.presentBackBuffer(n64js.getRamU8Array(), new_origin);
          n64js.returnControlToSystem();
          this.lastVbl = this.curVbl;
        }
        this.mem.write32(ea, value);
        break;
      case VI_CONTROL_REG:
        if (!this.quiet) { logger.log('VI control set to: ' + toString32(value)); }
        this.mem.write32(ea, value);
        break;
      case VI_WIDTH_REG:
        if (!this.quiet) { logger.log('VI width set to: ' + value); }
        this.mem.write32(ea, value);
        break;
      case VI_CURRENT_REG:
        if (!this.quiet) { logger.log('VI current set to: ' + toString32(value) + '.'); }
        if (!this.quiet) { logger.log('VI interrupt cleared'); }
        this.hardware.mi_reg.clearBits32(mi.MI_INTR_REG, mi.MI_INTR_VI);
        n64js.cpu0.updateCause3();
        break;

      default:
        this.mem.write32(ea, value);
        break;
    }
  }

  readS32(address) {
    this.logRead(address);
    var ea = this.calcEA(address);

    if (ea + 4 > this.u8.length) {
      throw 'Read is out of range';
    }
    var value = this.mem.readS32(ea);
    if (ea === VI_CURRENT_REG) {
      value = (value + 2) % 512;
      this.mem.write32(ea, value);
    }
    return value;
  }

  readU32(address) {
    return this.readS32(address) >>> 0;
  }
}
