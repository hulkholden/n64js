/*global n64js*/

import { Device } from './device.js';
import * as mi from './mi.js';
import * as logger from '../logger.js';
import { toString32 } from '../format.js';

// Peripheral Interface
export const PI_DRAM_ADDR_REG = 0x00;
export const PI_CART_ADDR_REG = 0x04;
export const PI_RD_LEN_REG = 0x08;
export const PI_WR_LEN_REG = 0x0C;
export const PI_STATUS_REG = 0x10;
export const PI_BSD_DOM1_LAT_REG = 0x14;
export const PI_BSD_DOM1_PWD_REG = 0x18;
export const PI_BSD_DOM1_PGS_REG = 0x1C;
export const PI_BSD_DOM1_RLS_REG = 0x20;
export const PI_BSD_DOM2_LAT_REG = 0x24;
export const PI_BSD_DOM2_PWD_REG = 0x28;
export const PI_BSD_DOM2_PGS_REG = 0x2C;
export const PI_BSD_DOM2_RLS_REG = 0x30;

// Values read from status reg
export const PI_STATUS_DMA_BUSY = 0x01;
export const PI_STATUS_IO_BUSY = 0x02;
export const PI_STATUS_DMA_IO_BUSY = 0x03;
export const PI_STATUS_ERROR = 0x04;
export const PI_STATUS_INTERRUPT = 0x08;

// Values written to status reg
export const PI_STATUS_RESET = 0x01;
export const PI_STATUS_CLR_INTR = 0x02;

export const PI_DOM2_ADDR1 = 0x05000000; // 64DD Registers
export const PI_DOM1_ADDR1 = 0x06000000; // 64DD ROM
export const PI_DOM2_ADDR2 = 0x08000000; // SRAM
export const PI_DOM2_ADDR2_END = 0x0801ffff;
export const PI_DOM1_ADDR2 = 0x10000000; // ROM
export const PI_DOM1_ADDR2_END = 0x1FBFFFFF;
export const PI_DOM1_ADDR3 = 0x1FD00000;
export const P1_DOM1_ADDR3_END = 0x7FFFFFFF;

export function isDom2Addr1(address) { return address >= PI_DOM2_ADDR1 && address < PI_DOM1_ADDR1; }
export function isDom1Addr1(address) { return address >= PI_DOM1_ADDR1 && address < PI_DOM2_ADDR2; }
export function isDom2Addr2(address) { return address >= PI_DOM2_ADDR2 && address < PI_DOM1_ADDR2; }
export function isDom1Addr2(address) { return address >= PI_DOM1_ADDR2 && address <= PI_DOM1_ADDR2_END; }
export function isDom1Addr3(address) { return address >= PI_DOM1_ADDR3 && address <= P1_DOM1_ADDR3_END; }

function isFlashDomAddr(address) { return address >= PI_DOM2_ADDR2 && address <= PI_DOM2_ADDR2_END; }

const kPIInterrupt = 'PI Interrupt';

export class PIRegDevice extends Device {
  constructor(hardware, rangeStart, rangeEnd) {
    super("PIReg", hardware, hardware.pi_reg, rangeStart, rangeEnd);
    this.haveSetMemorySize = false;
  }

  reset() {
    this.haveSetMemorySize = false;
  }

  setMemorySize() {
    if (!this.haveSetMemorySize) {
      const addr = (this.hardware.rominfo.cic === '6105') ? 0x800003F0 : 0x80000318;
      this.hardware.ram.set32(addr - 0x80000000, 8 * 1024 * 1024);
      logger.log('Setting memory size');
      this.haveSetMemorySize = true;
    }
  }

  readU32(address) {
    const ea = this.calcReadEA(address);
    if (ea + 4 > this.u8.length) {
      throw 'Read is out of range';
    }
    let v = this.mem.getS32(ea);
    switch (ea) {
      case PI_DRAM_ADDR_REG:
        v &= 0x00fffffe;
        break;
      case PI_CART_ADDR_REG:
        v &= 0xfffffffe;
        break;
      case PI_RD_LEN_REG:
      case PI_WR_LEN_REG:
        // See https://n64brew.dev/wiki/Peripheral_Interface.
        v = 0x7f;
        break;
    }

    if (!this.quiet) { logger.log(`Reading from PIReg: [${toString32(address)}] -> ${toString32(v)}`); }

    return v >>> 0;
  }

  write32(address, value) {
    const ea = this.calcWriteEA(address);
    if (ea + 4 > this.u8.length) {
      throw 'Write is out of range';
    }
    if (!this.quiet) { logger.log(`Writing to PIReg: ${toString32(value)} -> [${toString32(address)}]`); }

    // Attempts to write to any register except the status reg results in an error bit being set.
    if (this.busy() && ea != PI_STATUS_REG) {
      n64js.warn(`Write to PI registers while DMA or IO busy`);
      this.mem.setBits32(PI_STATUS_REG, PI_STATUS_ERROR);
      return;
    }

    switch (ea) {
      case PI_DRAM_ADDR_REG:
      case PI_CART_ADDR_REG:
        this.mem.set32(ea, value);
        break;
      case PI_RD_LEN_REG:
        this.mem.set32(ea, value);
        this.copyFromRDRAM();
        break;
      case PI_WR_LEN_REG:
        this.mem.set32(ea, value);
        this.copyToRDRAM();
        break;
      case PI_STATUS_REG:
        if (value & PI_STATUS_RESET) {
          if (!this.quiet) { logger.log('PI_STATUS_REG reset'); }
          this.mem.set32(PI_STATUS_REG, 0);
          // Cancel any pending transfers.
          // This just removes the interrupt but in theory we should stop DMA mid-flight.
          this.removePIInterrupt();
        }
        if (value & PI_STATUS_CLR_INTR) {
          if (!this.quiet) { logger.log('PI interrupt cleared'); }
          this.mem.clearBits32(PI_STATUS_REG, PI_STATUS_INTERRUPT);
          this.hardware.mi_reg.clearBits32(mi.MI_INTR_REG, mi.MI_INTR_PI);
          n64js.cpu0.updateCause3();
        }
        break;
      case PI_BSD_DOM1_LAT_REG:
      case PI_BSD_DOM1_PWD_REG:
      case PI_BSD_DOM1_PGS_REG:
      case PI_BSD_DOM1_RLS_REG:
      case PI_BSD_DOM2_LAT_REG:
      case PI_BSD_DOM2_PWD_REG:
      case PI_BSD_DOM2_PGS_REG:
      case PI_BSD_DOM2_RLS_REG:
        this.mem.set32(ea, value);
        break;
      default:
        logger.log(`Unhandled write to PIReg: ${toString32(value)} -> [${toString32(address)}]`);
        this.mem.set32(ea, value);
        break;
    }
  }

  busy() {
    return this.mem.getBits32(PI_STATUS_REG, PI_STATUS_DMA_BUSY) != 0;
  }

  copyFromRDRAM() {
    const dramAddr = this.mem.getU32(PI_DRAM_ADDR_REG) & 0x00fffffe;
    const cartAddr = this.mem.getU32(PI_CART_ADDR_REG) & 0xfffffffe;
    let transferLen = (this.mem.getU32(PI_RD_LEN_REG) & 0x00ffffff) + 1;

    let dst;
    let dstOffset = 0;
    // TODO: better estimate for this.
    let cycles = 0x1000;

    // Short transfers are handled differently (see https://n64brew.dev/wiki/Peripheral_Interface)
    if (transferLen >= 0x7f && (transferLen & 1)) {
      transferLen++;
    }

    if (isDom2Addr2(cartAddr)) {
      if (isFlashDomAddr(cartAddr)) {
        switch (this.hardware.saveType) {
          case 'SRAM':
            dst = this.hardware.saveMem;
            dstOffset = cartAddr - PI_DOM2_ADDR2;
            this.hardware.saveDirty = true;
            break;
          case 'FlashRam':
            // DMAs to flash actually write to a.
            dst = this.hardware.romD2A2Device.flashBuffer;
            dstOffset = 0;
            if (transferLen > dst.length) {
              n64js.warn(`PI DMA to FlashRam exceeds buffer length (${transferLen} > ${dst.length})`);
              transferLen = dst.length;
            }
            // Don't set dirty as this is only committed when executing a write operation.
            break;
        }
      } else {
        n64js.halt(`PI: unknown dom2addr2 address for ram->cart DMA: ${toString32(cartAddr)}`);
      }
    } else {
      n64js.halt(`PI: unknown cart address for ram->cart DMA: ${toString32(cartAddr)}`);
    }

    if (dst) {
      dst.copy(dstOffset, this.hardware.ram, dramAddr, transferLen);
    }

    // TODO: Update address registers?

    this.mem.setBits32(PI_STATUS_REG, PI_STATUS_DMA_BUSY);

    this.addPIInterrupt(cycles);
  }

  copyToRDRAM() {
    const dramAddr = this.mem.getU32(PI_DRAM_ADDR_REG) & 0x00fffffe;
    const cartAddr = this.mem.getU32(PI_CART_ADDR_REG) & 0xfffffffe;
    let transferLen = (this.mem.getU32(PI_WR_LEN_REG) & 0x00ffffff) + 1;

    if (!this.quiet) {
      logger.log(`PI: copying ${transferLen} bytes of data from ${toString32(cartAddr)} to ${toString32(dramAddr)}`);
    }

    // Short transfers are handled differently (see https://n64brew.dev/wiki/Peripheral_Interface)
    if (transferLen >= 0x7f && (transferLen & 1)) {
      transferLen++;
    }
    if (transferLen <= 0x80) {
      transferLen -= dramAddr & 0x7;
    }

    let src;
    let srcOffset = 0;
    let cycles = this.estimateDMACyclesFromLength(transferLen);

    if (isDom1Addr1(cartAddr)) {
      src = this.hardware.rom;
      srcOffset = cartAddr - PI_DOM1_ADDR1;
    } else if (isDom1Addr2(cartAddr)) {
      src = this.hardware.rom;
      srcOffset = cartAddr - PI_DOM1_ADDR2;
    } else if (isDom1Addr3(cartAddr)) {
      src = this.hardware.rom;
      srcOffset = cartAddr - PI_DOM1_ADDR3;
    } else if (isDom2Addr1(cartAddr)) {
      n64js.halt('PI: dom2addr1 transfer is unhandled (save)');
    } else if (isDom2Addr2(cartAddr)) {
      if (isFlashDomAddr(cartAddr)) {
        srcOffset = cartAddr - PI_DOM2_ADDR2;
        switch (this.hardware.saveType) {
          case 'SRAM':
            src = this.hardware.saveMem;
            break;
          case 'FlashRam':
            src = this.hardware.romD2A2Device.flashDMASource();
            break;
        }
        // TODO: better estimate for this.
        cycles = 0x1000;
      } else {
        n64js.halt(`PI: unknown dom2addr2 address for cart->ram DMA: ${toString32(cartAddr)}`);
      }
    } else {
      n64js.halt(`PI: unknown cart address for cart->ram DMA: ${toString32(cartAddr)}`);
    }

    if (src) {
      this.hardware.ram.copy(dramAddr, src, srcOffset, transferLen);
    }

    // If this is the first DMA write the ram size to 0x800003F0 (cic6105) or 0x80000318 (others)
    this.setMemorySize();

    // Address registers are updated when the transfer completes.
    this.mem.setBits32(PI_STATUS_REG, PI_STATUS_DMA_BUSY);
    this.mem.set32(PI_DRAM_ADDR_REG, (this.mem.getU32(PI_DRAM_ADDR_REG) + transferLen + 7) & ~7);
    this.mem.set32(PI_CART_ADDR_REG, (this.mem.getU32(PI_CART_ADDR_REG) + transferLen + 1) & ~1);

    this.addPIInterrupt(cycles);
  }

  estimateDMACyclesFromLength(length) {
    // TODO: this should be affected by how the PI_BSD registers are set.
    const cycles = length >>> 3;
    if (cycles) {
      return cycles;
    }
    return 16;
  }
  
  removePIInterrupt() {
    n64js.cpu0.removeEvent(kPIInterrupt);
  }

  addPIInterrupt(cycles) {
    const ev = n64js.hardware().timeline.startEvent(`PI DMA`);
    const that = this;
    n64js.cpu0.addEvent(kPIInterrupt, cycles, () => {
      that.dmaComplete();
      if (ev) {
        ev.stop();
      }
    });
  }

  dmaComplete() {
    this.mem.clearBits32(PI_STATUS_REG, PI_STATUS_DMA_BUSY);
    this.mem.setBits32(PI_STATUS_REG, PI_STATUS_INTERRUPT);
    this.hardware.mi_reg.setBits32(mi.MI_INTR_REG, mi.MI_INTR_PI);
    n64js.cpu0.updateCause3();
  }
}
