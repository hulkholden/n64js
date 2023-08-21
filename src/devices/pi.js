import { Device } from './device.js';
import * as si from './si.js';
import * as mi from './mi.js';
import * as logger from '../logger.js';
import { toString8, toString32 } from '../format.js';

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
export const PI_DOM2_ADDR2_END = 0x0800ffff;
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

// TODO: dedupe.
function memoryCopy(dst, dstOff, src, srcOff, len) {
  for (let i = 0; i < len; ++i) {
    dst.u8[dstOff + i] = src.u8[srcOff + i];
  }
}

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

  readS32(address) {
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

    return v;
  }

  readU32(address) {
    return this.readS32(address) >>> 0;
  }

  write32(address, value) {
    const ea = this.calcWriteEA(address);
    if (ea + 4 > this.u8.length) {
      throw 'Write is out of range';
    }
    if (!this.quiet) { logger.log(`Writing to PIReg: ${toString32(value)} -> [${toString32(address)}]`); }

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
        }
        if (value & PI_STATUS_CLR_INTR) {
          if (!this.quiet) { logger.log('PI interrupt cleared'); }
          this.mem.clearBits32(PI_STATUS_REG, PI_STATUS_INTERRUPT);
          this.hardware.mi_reg.clearBits32(mi.MI_INTR_REG, mi.MI_INTR_PI);
          n64js.cpu0.updateCause3();
        }
        break;
      default:
        logger.log(`Unhandled write to PIReg: ${toString32(value)} -> [${toString32(address)}]`);
        this.mem.set32(ea, value);
        break;
    }
  }

  copyFromRDRAM() {
    const dramAddr = this.mem.getU32(PI_DRAM_ADDR_REG) & 0x00fffffe;
    const cartAddr = this.mem.getU32(PI_CART_ADDR_REG) & 0xfffffffe;
    let transferLen = (this.mem.getU32(PI_RD_LEN_REG) & 0x00ffffff) + 1;

    let dst;
    let dstOffset = 0;

    // Short transfers are handled differently (see https://n64brew.dev/wiki/Peripheral_Interface)
    if (transferLen >= 0x7f && (transferLen & 1)) {
      transferLen++;
    }

    if (isDom2Addr2(cartAddr)) {
      if (isFlashDomAddr(cartAddr)) {
        switch (this.hardware.saveType) {
          case 'SRAM':
            dst = this.hardware.sram;
            dstOffset = cartAddr - PI_DOM2_ADDR2;
            break;
        }
      } else {
        n64js.halt(`PI: unknown dom2addr2 address: ${toString32(cartAddr)}`);
      }
    } else {
      n64js.halt(`PI: unknown cart address: ${toString32(cartAddr)}`);
    }

    if (dst) {
      memoryCopy(dst, dstOffset, this.hardware.ram, dramAddr, transferLen);
      // TODO: mark save as dirty.
    }

    // TODO: Update address registers?

    this.mem.clearBits32(PI_STATUS_REG, PI_STATUS_DMA_BUSY);
    this.mem.setBits32(PI_STATUS_REG, PI_STATUS_INTERRUPT);
    this.hardware.mi_reg.setBits32(mi.MI_INTR_REG, mi.MI_INTR_PI);
    n64js.cpu0.updateCause3();
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
        switch (this.hardware.saveType) {
          case 'SRAM':
            src = this.hardware.sram;
            srcOffset = cartAddr - PI_DOM2_ADDR2;
            break;
        }
      } else {
        n64js.halt(`PI: unknown dom2addr2 address: ${toString32(cartAddr)}`);
      }
    } else {
      n64js.halt(`PI: unknown cart address: ${toString32(cartAddr)}`);
    }

    if (src) {
      memoryCopy(this.hardware.ram, dramAddr, src, srcOffset, transferLen);
    }

    // If this is the first DMA write the ram size to 0x800003F0 (cic6105) or 0x80000318 (others)
    this.setMemorySize();

    // Address registers are updated when the transfer completes.
    this.mem.set32(PI_DRAM_ADDR_REG, (this.mem.getU32(PI_DRAM_ADDR_REG) + transferLen + 7) & ~7);
    this.mem.set32(PI_CART_ADDR_REG, (this.mem.getU32(PI_CART_ADDR_REG) + transferLen + 1) & ~1);

    // TODO: figure out how many cycles the transfer should take, and schedule an interrupt.
    this.mem.clearBits32(PI_STATUS_REG, PI_STATUS_DMA_BUSY);
    this.mem.setBits32(PI_STATUS_REG, PI_STATUS_INTERRUPT);
    this.hardware.mi_reg.setBits32(mi.MI_INTR_REG, mi.MI_INTR_PI);
    n64js.cpu0.updateCause3();
  }
}
export class PIRamDevice extends Device {
  constructor(hardware, rangeStart, rangeEnd) {
    super("PIRAM", hardware, hardware.pi_mem, rangeStart, rangeEnd);
  }

  readS32(address) {
    const ea = this.calcReadEA(address);
    if (ea + 4 > this.u8.length) {
      throw 'Read is out of range';
    }
    const v = this.mem.getS32(ea);
    if (ea < 0x7c0) {
      logger.log(`Reading from PIF rom (${toString32(address)}). Got ${toString32(v)}`);
    } else {
      const ramOffset = ea - 0x7c0;
      switch (ramOffset) {
        case 0x24: logger.log(`Reading CIC values: ${toString32(v)}`); break;
        case 0x3c: logger.log(`Reading Control byte: ${toString32(v)}`); break;
        default: logger.log(`Reading from PI ram [${toString32(address)}]. Got ${toString32(v)}`); break;
      }
    }
    return v;
  }

  readU32(address) {
    return this.readS32(address) >>> 0;
  }

  readS8(address) {
    const ea = this.calcReadEA(address);
    const v = this.mem.getU8(ea);
    if (ea < 0x7c0) {
      logger.log(`Reading from PIF rom (${toString32(address)}). Got ${toString8(v)}`);
    } else {
      const ramOffset = ea - 0x7c0;
      switch (ramOffset) {
        case 0x24: logger.log(`Reading CIC values: ${toString8(v)}`); break;
        case 0x3c: logger.log(`Reading Control byte: ${toString8(v)}`); break;
        default: logger.log(`Reading from PI ram [${toString32(address)}]. Got ${toString8(v)}`); break;
      }
    }
    return v;
  }

  readU8(address) {
    return this.readS8(address) >>> 0;
  }

  write32(address, value) {
    const ea = this.calcWriteEA(address);
    if (ea < 0x7c0) {
      logger.log('Attempting to write to PIF ROM');
      return;
    }

    this.mem.set32(ea, value);
    const ramOffset = ea - 0x7c0;
    switch (ramOffset) {
      case 0x24: logger.log(`Writing CIC values: ${toString32(value)}`); break;
      case 0x3c: logger.log(`Writing Control byte: ${toString32(value)}`); this.updateControl(); break;
      default: logger.log(`Writing directly to PI ram [${toString32(address)}] <-- ${toString32(value)}`); break;
    }
  }

  write16(address, value) {
    const ea = this.calcWriteEA(address);
    if (ea < 0x7c0) {
      logger.log('Attempting to write to PIF ROM');
      return;
    }
    // SH is broken - it writes a 32-bit value.
    // It also uses 32 bits from the source register (i.e. value is not masked to 16 bits).
    const aligned = ea & ~3;
    const shift = 8 * (2 - (ea & 2));
    this.mem.set32(aligned, value << shift);
  }

  write8(address, value) {
    const ea = this.calcWriteEA(address);
    if (ea < 0x7c0) {
      logger.log('Attempting to write to PIF ROM');
      return;
    }
    // SB is broken - it writes a 32-bit value.
    // It also uses 32 bits from the source register (i.e. value is not masked to 8 bits).
    const aligned = ea & ~3;
    const shift = 8 * (3 - (ea & 3));
    this.mem.set32(aligned, value << shift);
  }

  updateControl() {
    const piRom = new Uint8Array(this.mem.arrayBuffer, 0x000, 0x7c0);
    const piRam = new Uint8Array(this.mem.arrayBuffer, 0x7c0, 0x040);
    const command = piRam[0x3f];

    switch (command) {
      case 0x01:
        logger.log('PI: execute block');
        break;
      case 0x08:
        logger.log('PI: interrupt control');
        piRam[0x3f] = 0x00;
        this.hardware.si_reg.setBits32(si.SI_STATUS_REG, si.SI_STATUS_INTERRUPT);
        this.hardware.mi_reg.setBits32(mi.MI_INTR_REG, mi.MI_INTR_SI);
        n64js.cpu0.updateCause3();
        break;
      case 0x10:
        logger.log('PI: clear rom');
        for (let i = 0; i < piRom.length; ++i) {
          piRom[i] = 0;
        }
        break;
      case 0x30:
        logger.log('PI: set 0x80 control ');
        piRam[0x3f] = 0x80;
        break;
      case 0xc0:
        logger.log('PI: clear ram');
        for (let i = 0; i < piRam.length; ++i) {
          piRam[i] = 0;
        }
        break;
      default:
        n64js.halt(`Unknown PI control value: ${toString8(command)}`);
        break;
    }
  }
}

