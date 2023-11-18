/*global n64js*/

import { Device } from './device.js';
import * as mi from './mi.js';
import * as logger from '../logger.js';
import { toString32 } from '../format.js';
import { presentBackBuffer } from '../hle/hle_graphics.js';
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

const VI_PAL_CLOCK = 49_656_530;
const VI_NTSC_CLOCK = 48_681_812;
const VI_MPAL_CLOCK = 48_628_316;

const kVIInterrupt = 'VI Interrupt';

function videoClockForTVType(tvType) {
  switch (tvType) {
    case OS_TV_PAL: return VI_PAL_CLOCK;
    case OS_TV_NTSC: return VI_NTSC_CLOCK;
    case OS_TV_MPAL: return VI_MPAL_CLOCK;
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
    this.videoClock = 0;
    this.refreshRate = 0;
    this.countPerScanline = 0;
    this.countPerVbl = 0;

    this.reset();
  }

  reset() {
    const ntsc = this.hardware.rominfo.tvType == OS_TV_NTSC;
    this.videoClock = videoClockForTVType(ntsc);
    this.refreshRate = refreshRateForTVType(ntsc);
    this.countPerScanline = 0;
    this.countPerVbl = 0;

    this.screenWidth = 640;
    this.screenHeight = ntsc ? 480 : 576;
    this.hScanMin = ntsc ? 108 : 128;
    this.hScanMax = this.hScanMin + this.screenWidth;
    this.vScanMin = ntsc ? 34 : 44;
    this.vScanMax = this.vScanMin + this.screenHeight;
    this.dims = new Dimensions(this.screenWidth, this.screenHeight);
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
  get is16BitMode() { return this.modeType == VI_CTRL_TYPE_16; }
  get xScale() { return (this.xScaleReg & 0xfff) / 1024; }
  get yScale() { return (this.yScaleReg & 0xfff) / 1024; }

  get bitDepth() {
    switch (this.modeType) {
      case VI_CTRL_TYPE_32: return 32;
      case VI_CTRL_TYPE_16: return 16;
    }
    return 0;
  }

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
    this.hardware.verticalBlank();

    this.field ^= (this.interlaced ? 1 : 0);

    // TODO: compensate for over/under cycles.
    this.addInterruptEvent();

    this.hardware.mi_reg.setBits32(mi.MI_INTR_REG, mi.MI_INTR_VI);
    n64js.cpu0.updateCause3();

    presentBackBuffer();
    n64js.returnControlToSystem();
  }

  initInterrupt() {
    if (n64js.cpu0.hasEvent(kVIInterrupt)) {
      return;
    }
    const intr = this.mem.getU32(VI_V_INTR_REG);
    const sync = this.mem.getU32(VI_V_SYNC_REG);
    if (intr >= sync) {
      logger.log(`not setting VI interrupt - intr ${intr} >= sync ${sync}`);
      return;
    }
    this.addInterruptEvent();
  }

  addInterruptEvent() {
    n64js.cpu0.addEvent(kVIInterrupt, this.countPerVbl, () => {
      this.verticalBlank();
    });
  }

  getVblCount() {
    const cycles = n64js.cpu0.getCyclesUntilEvent(kVIInterrupt);
    return cycles >= 0 ? cycles : 0;
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
        {
          const lastSync = this.mem.getU32(ea);
          if (lastSync != value) {
            const scanlines = value + 1;
            this.countPerScanline = ((this.hardware.systemFrequency / this.refreshRate) / scanlines) >> 0;
            this.countPerVbl = scanlines * this.countPerScanline;
            logger.log(`VI_V_SYNC_REG set to ${value}, cycles per scanline = ${this.countPerScanline}, cycles per vbl = ${this.countPerVbl}`);
            this.mem.set32(ea, value);
            this.initInterrupt();
          }
        }
        break;

      default:
        this.mem.set32(ea, value);
        break;
    }
  }

  readU32(address) {
    this.logRead(address);
    const ea = this.calcReadEA(address);
    if (ea + 4 > this.u8.length) {
      throw 'Read is out of range';
    }

    if (ea === VI_V_CURRENT_LINE_REG) {
      // Figure out the current scanline based on how many cycles to the next interrupt.
      const cyclesToNextVbl = this.getVblCount();
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
    return this.mem.getU32(ea);
  }

  computeDimensions() {
    // If there is no mode (16 or 32 bit) set, don't render anything.
    if (this.modeType == 0) {
      logger.log('mode type is 0 - not rendering');
      return null;
    }

    const hStartReg = this.hVideoReg;
    const hStart = (hStartReg >> 16) & 0x03ff;
    const hEnd = hStartReg & 0x03ff;

    let x0 = Math.max(hStart, this.hScanMin);
    let x1 = Math.min(hEnd, this.hScanMax);

    const vStartReg = this.vVideoReg;
    const vStart = (vStartReg >> 16) & 0x03ff;
    const vEnd = vStartReg & 0x03ff;

    let y0 = Math.max(vStart, this.vScanMin);
    let y1 = vEnd < vStart ? this.vScanMax : Math.min(vEnd, this.vScanMax);

    // Implement VI guard band (hardware bug?)
    // https://github.com/ares-emu/parallel-rdp/blob/0097af2f4d1f880d403c150f5fc4d55d825cd799/parallel-rdp/video_interface.cpp#L660s
    if (x0 >= this.hScanMin) x0 += 8;
    if (x1 < this.hScanMax) x1 -= 7;

    const dims = this.dims;
    dims.interlaced = this.interlaced;
    dims.field = this.field;

    dims.xSubpixel = (this.xScaleReg >> 16) & 0xfff;
    dims.ySubpixel = (this.yScaleReg >> 16) & 0xfff;

    dims.xScale = this.xScaleReg & 0xfff;
    dims.yScale = this.yScaleReg & 0xfff;

    // Offset relative to source image
    dims.sx0 = x0 - hStart;
    dims.sy0 = y0 - vStart;

    // Offset relative to PAL/NTSC bounds.
    dims.dx0 = x0 - this.hScanMin;
    dims.dy0 = y0 - this.vScanMin;

    dims.dstWidth = x1 - x0;
    dims.dstHeight = y1 - y0;

    dims.srcPitch = this.hWidthReg;

    // Matches srcWidth/srcHeight except vFudge?
    const sEndX = ((dims.sx0 + dims.dstWidth) * dims.xScale) >> 10;
    const sEndY = ((dims.sy0 + dims.dstHeight) * dims.yScale) >> 11;

    // Double the y resolution in certain (interlaced?) modes.
    // This corrects height in various games ex : Megaman 64, CyberTiger
    const vFudge = (dims.srcPitch > 0x300 || dims.srcPitch >= (sEndX * 2)) ? 2 : 1;

    dims.srcWidth = sEndX;
    dims.srcHeight = sEndY * vFudge;

    // ECW Hardcore Revolution - stretched horizontally.
    // logger.log(`screen w/h = ${dims.screenWidth}, ${dims.screenHeight}${this.interlaced ? 'i' : 'p'}, pitch ${dims.srcPitch}, srcW/H = ${dims.srcWidth}, ${dims.srcHeight}, , dstW/H = ${dims.dstWidth}, ${dims.dstHeight}`);
    return dims;
  }

  renderBackBuffer() {
    const dims = this.computeDimensions();
    if (!dims) {
      return null;
    }

    const dramAddr = this.dramAddrReg & 0x00fffffe; // Clear top bit to make address physical. Clear bottom bit (sometimes odd valued addresses are passed through)
    if (!dramAddr) {
      return null;
    }

    const ramDV = this.hardware.cachedMemDevice.mem.dataView;
    if (this.is32BitMode) {
      return dims.renderBackBuffer32(ramDV, dramAddr);
    }
    if (this.is16BitMode) {
      return dims.renderBackBuffer16(ramDV, dramAddr);
    }
    return null
  }
}

class Dimensions {
  constructor(screenW, screenH) {
    // Display output resolution.
    this.screenWidth = 640;
    this.screenHeight = 480;

    // Buffers to use in renderBackBuffer32/16.
    this.pixels32bpp = new Uint8Array(screenW * screenH * 4);
    this.pixels16bpp = new Uint16Array(screenW * screenH);

    // Interlaced mode and field number.
    this.interlaced = false;
    this.field = 0;

    // Output resolution.
    this.dstWidth = 640;
    this.dstHeight = 480;

    // Input resolution.
    this.srcPitch = 320;
    this.srcWidth = 320;
    this.srcHeight = 240;

    // 10.2 subpixel offset and scale factor.
    this.xSubpixel = 0;
    this.ySubpixel = 0;
    this.xScale = 0x200;
    this.yScale = 0x400;

    // Offset relative to source image
    this.sx0 = 0;
    this.sy0 = 0;

    // Offset relative to PAL/NTSC bounds.
    this.dx0 = 0;
    this.dy0 = 0;
  }

  renderBackBuffer32(ramDV, dramAddr) {
    const pixels = this.pixels32bpp;

    // We need to flip Y-axis for the texture's coordinate system so start at the bottom and work upwards.
    const dstPitch = -this.screenWidth;
    let dstRow = (this.screenHeight - 1 - this.dy0) * this.screenWidth;

    const alpha = 0xff;

    let sy = (this.sy0 * this.yScale) + this.ySubpixel;
    for (let y = 0; y < this.dstHeight; y++) {
      if (!this.interlaced || ((this.dy0 + y) & 1) != this.field) {
        const srcOff = dramAddr + ((sy >>> 11) * this.srcPitch * 4);
        let dstOff = dstRow + this.dx0;
        let sx = (this.sx0 * this.xScale) + this.xSubpixel;
        for (let x = 0; x < this.dstWidth; x++) {
          const pixel = ramDV.getInt32(srcOff + (sx >>> 10) * 4, false);
          pixels[dstOff * 4 + 0] = pixel >>> 24;
          pixels[dstOff * 4 + 1] = pixel >>> 16;
          pixels[dstOff * 4 + 2] = pixel >>> 8;
          pixels[dstOff * 4 + 3] = alpha;
          dstOff++;
          sx += this.xScale;
        }
      }
      sy += this.yScale;
      dstRow += dstPitch;
    }
    return pixels;
  }

  renderBackBuffer16(ramDV, dramAddr) {
    const pixels = this.pixels16bpp;

    // We need to flip Y-axis for the texture's coordinate system so start at the bottom and work upwards.
    const dstPitch = -this.screenWidth;
    let dstRow = (this.screenHeight - 1 - this.dy0) * this.screenWidth;

    const alpha = 0x0001;

    let sy = (this.sy0 * this.yScale) + this.ySubpixel;
    for (let y = 0; y < this.dstHeight; y++) {
      if (!this.interlaced || ((this.dy0 + y) & 1) != this.field) {
        const srcOff = dramAddr + ((sy >>> 11) * this.srcPitch * 2);
        let dstOff = dstRow + this.dx0;
        let sx = (this.sx0 * this.xScale) + this.xSubpixel;
        for (let x = 0; x < this.dstWidth; x++) {
          pixels[dstOff++] = ramDV.getInt16(srcOff + (sx >>> 10) * 2, false) | alpha;
          sx += this.xScale;
        }
      }
      sy += this.yScale;
      dstRow += dstPitch;
    }
    return pixels;
  }

}
