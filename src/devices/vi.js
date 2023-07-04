import { Device } from './device.js';
import * as mi from './mi.js';
import * as logger from '../logger.js';
import { toString32 } from '../format.js';
import { presentBackBuffer } from '../hle.js';
import { OS_TV_PAL, OS_TV_NTSC, OS_TV_MPAL } from '../system_constants.js';

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

// Alternate names.
const VI_CONTROL_REG = VI_STATUS_REG;
const VI_DRAM_ADDR_REG = VI_ORIGIN_REG;
const VI_H_WIDTH_REG = VI_WIDTH_REG;
const VI_V_INTR_REG = VI_INTR_REG;
const VI_V_CURRENT_LINE_REG = VI_CURRENT_REG;
const VI_TIMING_REG = VI_BURST_REG;
const VI_H_SYNC_LEAP_REG = VI_LEAP_REG;
const VI_H_VIDEO_REG = VI_H_START_REG;
const VI_V_VIDEO_REG = VI_V_START_REG;

const VI_CTRL_TYPE_16 = 0x00002;
const VI_CTRL_TYPE_32 = 0x00003;
const VI_CTRL_GAMMA_DITHER_ON = 0x00004;
const VI_CTRL_GAMMA_ON = 0x00008;
const VI_CTRL_DIVOT_ON = 0x00010;
const VI_CTRL_SERRATE_ON = 0x00040;
const VI_CTRL_ANTIALIAS_MASK = 0x00300;
const VI_CTRL_DITHER_FILTER_ON = 0x10000;

const controlTypeMask = 0x3;

const VI_PAL_CLOCK = 49656530;
const VI_NTSC_CLOCK = 48681812;
const VI_MPAL_CLOCK = 48628316;

function videoClockForTVType(tvType) {
  switch (tvType) {
    case OS_TV_PAL: return VI_PAL_CLOCK; break;
    case OS_TV_NTSC: return VI_NTSC_CLOCK; break;
    case OS_TV_MPAL: return VI_MPAL_CLOCK; break;
  }
  return VI_NTSC_CLOCK;
}

function refreshRateForTVType(tvType) {
  return tvType == OS_TV_PAL ? 50 : 60;
}

export class VIRegDevice extends Device {
  constructor(hardware, rangeStart, rangeEnd) {
    super("VIReg", hardware, hardware.vi_reg, rangeStart, rangeEnd);

    this.field = 0;
    this.clock = 0;
    this.refreshRate = 0;
    this.countPerScanline = 0;
    this.countPerVbl = 0;

    this.reset();
  }

  reset() {
    this.clock = videoClockForTVType(this.hardware.rominfo.tvType);
    this.refreshRate = refreshRateForTVType(this.hardware.rominfo.tvType);
    this.countPerScanline = 0;
    this.countPerVbl = 0;
  }

  get interlaced() {
    return (this.viControl() & VI_CTRL_SERRATE_ON) != 0;
  }

  viControl() { return this.mem.readU32(VI_CONTROL_REG); }

  // TODO: rename viDramAddr
  viOrigin() { return this.mem.readU32(VI_ORIGIN_REG); }
  viWidth() { return this.mem.readU32(VI_WIDTH_REG); }

  viHVideo() { return this.mem.readU32(VI_H_VIDEO_REG); }
  viVVideo() { return this.mem.readU32(VI_V_VIDEO_REG); }
  viXScale() { return this.mem.readU32(VI_X_SCALE_REG); }
  viYScale() { return this.mem.readU32(VI_Y_SCALE_REG); }

  viXScaleFrac() { return (this.viXScale() & 0xfff) / 1024; }
  viYScaleFrac() { return (this.viYScale() & 0xfff) / 1024; }

  dump() {
    console.log(`VI_CONTROL = ${toString32(this.viControl())}`);
    console.log(`VI_DRAM_ADDR = ${toString32(this.mem.readU32(VI_DRAM_ADDR_REG))}`);
    console.log(`VI_H_WIDTH = ${toString32(this.mem.readU32(VI_H_WIDTH_REG))}`);
    console.log(`VI_V_INTR = ${toString32(this.mem.readU32(VI_V_INTR_REG))}`);
    console.log(`VI_V_CURRENT_LINE = ${toString32(this.mem.readU32(VI_V_CURRENT_LINE_REG))}`);
    console.log(`VI_TIMING = ${toString32(this.mem.readU32(VI_TIMING_REG))}`);
    console.log(`VI_V_SYNC = ${toString32(this.mem.readU32(VI_V_SYNC_REG))}`);
    console.log(`VI_H_SYNC = ${toString32(this.mem.readU32(VI_H_SYNC_REG))}`);
    console.log(`VI_H_SYNC_LEAP = ${toString32(this.mem.readU32(VI_H_SYNC_LEAP_REG))}`);
    console.log(`VI_H_VIDEO = ${toString32(this.viHVideo())}`);
    console.log(`VI_V_VIDEO = ${toString32(this.viVVideo())}`);
    console.log(`VI_V_BURST = ${toString32(this.mem.readU32(VI_V_BURST_REG))}`);
    console.log(`VI_X_SCALE = ${toString32(this.viXScale())} = ${this.viXScaleFrac()}`);
    console.log(`VI_Y_SCALE = ${toString32(this.viYScale())} = ${this.viYScaleFrac()}`);
  }

  verticalBlank() {
    const control = this.mem.readU32(VI_CONTROL_REG);
    const interlaced = (control & VI_CTRL_SERRATE_ON) ? 1 : 0;
    this.field ^= interlaced;

    // TODO: compensate for over/under cycles.
    n64js.cpu0.addVblEvent(this.countPerVbl);

    this.hardware.mi_reg.setBits32(mi.MI_INTR_REG, mi.MI_INTR_VI);
    n64js.cpu0.updateCause3();

    presentBackBuffer(n64js.getRamU8Array());
    n64js.returnControlToSystem();
  }

  initInterrupt() {
    if (n64js.cpu0.hasVblEvent()) {
      return;
    }
    const intr = this.mem.readU32(VI_V_INTR_REG);
    const sync = this.mem.readU32(VI_V_SYNC_REG);
    if (intr >= sync) {
      logger.log(`not setting VI interrupt - intr ${intr} >= sync ${sync}`);
      return;
    }
    n64js.cpu0.addVblEvent(this.countPerVbl);
  }

  viIs32Bit() {
    const control = this.mem.readU32(VI_CONTROL_REG);
    return (control & controlTypeMask) == VI_CTRL_TYPE_32;
  }

  write32(address, value) {
    const ea = this.calcEA(address);
    if (ea + 4 > this.u8.length) {
      throw 'Write is out of range';
    }

    switch (ea) {
      case VI_ORIGIN_REG:
        this.mem.write32(ea, value);
        break;

      case VI_CONTROL_REG:
        if (!this.quiet) { logger.log(`VI control set to: ${toString32(value)}`); }
        this.mem.write32(ea, value);
        break;

      case VI_WIDTH_REG:
        if (!this.quiet) { logger.log(`VI width set to: ${value}`); }
        this.mem.write32(ea, value);
        break;

      case VI_INTR_REG:
        if (!this.quiet) { logger.log(`VI intr set to: ${value}`); }
        this.mem.write32(ea, value);
        this.initInterrupt();
        break;

      case VI_CURRENT_REG:
        if (!this.quiet) { logger.log(`VI current set to: ${toString32(value)}`); }
        if (!this.quiet) { logger.log(`VI interrupt cleared`); }
        this.hardware.mi_reg.clearBits32(mi.MI_INTR_REG, mi.MI_INTR_VI);
        n64js.cpu0.updateCause3();
        break;

      case VI_V_SYNC_REG:
        const lastSync = this.mem.readU32(ea);
        if (lastSync != value) {
          const scanlines = value + 1;
          this.countPerScanline = ((this.clock / this.refreshRate) / scanlines) >> 0;
          this.countPerVbl = scanlines * this.countPerScanline;
          logger.log(`VI_V_SYNC_REG set to ${value}, cycles per scanline = ${this.countPerScanline}, cycles per vbl = ${this.countPerVbl}`);
          this.mem.write32(ea, value);
          this.initInterrupt();
        }
        break;

      default:
        this.mem.write32(ea, value);
        break;
    }
  }

  readS32(address) {
    this.logRead(address);
    const ea = this.calcEA(address);
    if (ea + 4 > this.u8.length) {
      throw 'Read is out of range';
    }

    if (ea === VI_CURRENT_REG) {
      // Figure out the current scanline based on how many cycles to the next interrupt.
      const cyclesToNextVbl = n64js.cpu0.getVblCount();
      const countExecuted = (this.countPerVbl - cyclesToNextVbl);
      const scanline = (countExecuted / this.countPerScanline) >> 0;

      // Wrap around the sync value.
      const sync = this.mem.readU32(VI_V_SYNC_REG);
      let value = scanline;
      if (value >= sync) {
        value -= sync;
      }

      // Bit 0 is constant for non-interlaced modes. In interlaced modes, bit 0 gives the field number.
      value = (value & (~1)) | this.field;

      this.mem.write32(ea, value);
    }
    return this.mem.readS32(ea);
  }

  readU32(address) {
    return this.readS32(address) >>> 0;
  }
}
