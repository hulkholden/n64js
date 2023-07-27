import { Device } from './device.js';
import * as mi from './mi.js';
import * as logger from '../logger.js';
import { toString32 } from '../format.js';
import { presentBackBuffer } from '../hle.js';
import { OS_TV_PAL, OS_TV_NTSC, OS_TV_MPAL } from '../system_constants.js';

// Video Interface
const VI_CONTROL_REG = 0x00;
const VI_DRAM_ADDR_REG = 0x04;
const VI_H_WIDTH_REG = 0x08;
const VI_V_INTR_REG = 0x0C;
const VI_V_CURRENT_LINE_REG = 0x10;
const VI_TIMING_REG = 0x14;
const VI_V_SYNC_REG = 0x18;
const VI_H_SYNC_REG = 0x1C;
const VI_H_SYNC_LEAP_REG = 0x20;
const VI_H_VIDEO_REG = 0x24;
const VI_V_VIDEO_REG = 0x28;
const VI_V_BURST_REG = 0x2C;
const VI_X_SCALE_REG = 0x30;
const VI_Y_SCALE_REG = 0x34;

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

  // Raw register values.
  get controlReg() { return this.mem.getU32(VI_CONTROL_REG); }
  get dramAddrReg() { return this.mem.getU32(VI_DRAM_ADDR_REG); }
  get hWidthReg() { return this.mem.getU32(VI_H_WIDTH_REG); }
  get vIntrReg() { return this.mem.getU32(VI_V_INTR_REG); }
  get vCurrentLineReg() { return this.mem.getU32(VI_V_CURRENT_LINE_REG); }
  get timingReg() { return this.mem.getU32(VI_TIMING_REG); }
  get vSyncReg() { return this.mem.getU32(VI_V_SYNC_REG); }
  get hSyncReg() { return this.mem.getU32(VI_H_SYNC_REG); }
  get hSyncLeapReg() { return this.mem.getU32(VI_H_SYNC_LEAP_REG); }
  get hVideoReg() { return this.mem.getU32(VI_H_VIDEO_REG); }
  get vVideoReg() { return this.mem.getU32(VI_V_VIDEO_REG); }
  get vBurstReg() { return this.mem.getU32(VI_V_BURST_REG); }
  get xScaleReg() { return this.mem.getU32(VI_X_SCALE_REG); }
  get yScaleReg() { return this.mem.getU32(VI_Y_SCALE_REG); }

  // Values derived from the registers.
  get interlaced() { return (this.controlReg & VI_CTRL_SERRATE_ON) != 0; }
  get modeType() { return this.controlReg & controlTypeMask; }
  get is32BitMode() { return this.modeType == VI_CTRL_TYPE_32; }
  get xScale() { return (this.xScaleReg & 0xfff) / 1024; }
  get yScale() { return (this.yScaleReg & 0xfff) / 1024; }

  dump() {
    console.log(`VI_CONTROL = ${toString32(this.controlReg)}`);
    console.log(`VI_DRAM_ADDR = ${toString32(this.dramAddrReg)}`);
    console.log(`VI_H_WIDTH = ${toString32(this.hWidthReg)}`);
    console.log(`VI_V_INTR = ${toString32(this.vIntrReg)}`);
    console.log(`VI_V_CURRENT_LINE = ${toString32(this.vCurrentLineReg)}`);
    console.log(`VI_TIMING = ${toString32(this.timingReg)}`);
    console.log(`VI_V_SYNC = ${toString32(this.vSyncReg)}`);
    console.log(`VI_H_SYNC = ${toString32(this.hSyncReg)}`);
    console.log(`VI_H_SYNC_LEAP = ${toString32(this.hSyncLeapReg)}`);
    console.log(`VI_H_VIDEO = ${toString32(this.hVideoReg)}`);
    console.log(`VI_V_VIDEO = ${toString32(this.vVideoReg)}`);
    console.log(`VI_V_BURST = ${toString32(this.vBurstReg)}`);
    console.log(`VI_X_SCALE = ${toString32(this.xScaleReg)} = ${this.xScale}`);
    console.log(`VI_Y_SCALE = ${toString32(this.yScaleReg)} = ${this.yScale}`);
  }

  verticalBlank() {
    const control = this.mem.getU32(VI_CONTROL_REG);
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
    const intr = this.mem.getU32(VI_V_INTR_REG);
    const sync = this.mem.getU32(VI_V_SYNC_REG);
    if (intr >= sync) {
      logger.log(`not setting VI interrupt - intr ${intr} >= sync ${sync}`);
      return;
    }
    n64js.cpu0.addVblEvent(this.countPerVbl);
  }

  write32(address, value) {
    const ea = this.calcWriteEA(address);
    if (ea + 4 > this.u8.length) {
      throw 'Write is out of range';
    }

    switch (ea) {
      case VI_DRAM_ADDR_REG:
        this.mem.set32(ea, value);
        break;

      case VI_CONTROL_REG:
        if (!this.quiet) { logger.log(`VI control set to: ${toString32(value)}`); }
        this.mem.set32(ea, value);
        break;

      case VI_H_WIDTH_REG:
        if (!this.quiet) { logger.log(`VI width set to: ${value}`); }
        this.mem.set32(ea, value);
        break;

      case VI_V_INTR_REG:
        if (!this.quiet) { logger.log(`VI intr set to: ${value}`); }
        this.mem.set32(ea, value);
        this.initInterrupt();
        break;

      case VI_V_CURRENT_LINE_REG:
        if (!this.quiet) { logger.log(`VI current set to: ${toString32(value)}`); }
        if (!this.quiet) { logger.log(`VI interrupt cleared`); }
        this.hardware.mi_reg.clearBits32(mi.MI_INTR_REG, mi.MI_INTR_VI);
        n64js.cpu0.updateCause3();
        break;

      case VI_V_SYNC_REG:
        const lastSync = this.mem.getU32(ea);
        if (lastSync != value) {
          const scanlines = value + 1;
          this.countPerScanline = ((this.clock / this.refreshRate) / scanlines) >> 0;
          this.countPerVbl = scanlines * this.countPerScanline;
          logger.log(`VI_V_SYNC_REG set to ${value}, cycles per scanline = ${this.countPerScanline}, cycles per vbl = ${this.countPerVbl}`);
          this.mem.set32(ea, value);
          this.initInterrupt();
        }
        break;

      default:
        this.mem.set32(ea, value);
        break;
    }
  }

  readS32(address) {
    this.logRead(address);
    const ea = this.calcReadEA(address);
    if (ea + 4 > this.u8.length) {
      throw 'Read is out of range';
    }

    if (ea === VI_V_CURRENT_LINE_REG) {
      // Figure out the current scanline based on how many cycles to the next interrupt.
      const cyclesToNextVbl = n64js.cpu0.getVblCount();
      const countExecuted = (this.countPerVbl - cyclesToNextVbl);
      const scanline = (countExecuted / this.countPerScanline) >> 0;

      // Wrap around the sync value.
      const sync = this.mem.getU32(VI_V_SYNC_REG);
      let value = scanline;
      if (value >= sync) {
        value -= sync;
      }

      // Bit 0 is constant for non-interlaced modes. In interlaced modes, bit 0 gives the field number.
      value = (value & (~1)) | this.field;

      this.mem.set32(ea, value);
    }
    return this.mem.getS32(ea);
  }

  readU32(address) {
    return this.readS32(address) >>> 0;
  }

  computeDimensions() {
    // If there is no mode (16 or 32 bit) set, don't render anything.
    if (this.modeType == 0) {
      logger.log('mode type is 0 - not rendering');
      return null;
    }
  
    // Some games don't seem to set VI_X_SCALE, so default this.
    const scaleX = (this.xScaleReg & 0xfff) || 0x200;
    const scaleY = (this.yScaleReg & 0xfff) || 0x400;
  
    const hStartReg = this.hVideoReg;
    const hStart = (hStartReg >> 16) & 0x03ff;
    const hEnd = hStartReg & 0x03ff;
  
    const vStartReg = this.vVideoReg;
    const vStart = (vStartReg >> 16) & 0x03ff;
    const vEnd = vStartReg & 0x03ff;

    // Sometimes hStartReg can be zero.. e.g. PD, Lode Runner, Cyber Tiger.
    // This might just be to avoid displaying garbage while the game is booting.
    if (hEnd <= hStart || vEnd <= vStart) {
      // logger.log(`got bad h or v start/end: h: (${hStart}, ${hEnd}), v (${vStart}, ${vEnd})`);
      return null;
    }
  
    // The extra shift for vDelta is to convert half lines to lines.
    const hDelta = hEnd - hStart;
    const vDelta = (vEnd - vStart) >> 1;
  
    // Apply scale and shift to divide by 2.10 fixed point denominator.
    const viWidth = (hDelta * scaleX) >> 10;
    // Double the y resolution in certain (interlaced?) modes.
    // This corrects height in various games ex : Megaman 64, CyberTiger
    const vFudge = (this.hWidthReg > 0x300 || this.hWidthReg >= (viWidth * 2)) ? 2 : 1;
    const viHeight = (vFudge * vDelta * scaleY) >> 10;
    
    // logger.log(`w/h = ${viWidth}, ${viHeight} - scale_x/y ${this.xScale}, ${this.yScale} - h/v start/end (${hStart}, ${hEnd}) = ${hDelta}, (${vStart}, ${vEnd}) = ${vDelta}`);
    return new Dimensions(viWidth, viHeight);
  }
}

class Dimensions {
  constructor(w, h) {
    this.width = w;
    this.height = h;
  }
}
