/*global n64js*/

import { Device } from './device.js';
import * as si from './si.js';
import * as mi from './mi.js';
import * as logger from '../logger.js';
import { toString8, toString32 } from '../format.js';

export class PIFMemDevice extends Device {
  constructor(hardware, rangeStart, rangeEnd) {
    super("PIFMEM", hardware, hardware.pif_mem, rangeStart, rangeEnd);
  }

  readU32(address) {
    const ea = this.calcReadEA(address);
    if (ea + 4 > this.u8.length) {
      throw 'Read is out of range';
    }
    const v = this.mem.getU32(ea);
    if (ea < 0x7c0) {
      logger.log(`Reading from PIF rom (${toString32(address)}). Got ${toString32(v)}`);
    } else {
      const ramOffset = ea - 0x7c0;
      switch (ramOffset) {
        case 0x24: logger.log(`Reading PIF CIC values: ${toString32(v)}`); break;
        case 0x3c: logger.log(`Reading PIF Control byte: ${toString32(v)}`); break;
        default: logger.log(`Reading from PIF ram [${toString32(address)}]. Got ${toString32(v)}`); break;
      }
      n64js.joybus().cpuRead(ramOffset);
    }
    return v;
  }

  readU8(address) {
    const ea = this.calcReadEA(address);
    const v = this.mem.getU8(ea);
    if (ea < 0x7c0) {
      logger.log(`Reading from PIF rom (${toString32(address)}). Got ${toString8(v)}`);
    } else {
      const ramOffset = ea - 0x7c0;
      switch (ramOffset) {
        case 0x24: logger.log(`Reading PIF CIC values: ${toString8(v)}`); break;
        case 0x3c: logger.log(`Reading PIF Control byte: ${toString8(v)}`); break;
        default: logger.log(`Reading from PIF ram [${toString32(address)}]. Got ${toString8(v)}`); break;
      }
      n64js.joybus().cpuRead(ramOffset);
    }
    return v;
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
      case 0x24: logger.log(`Writing PIF CIC values: ${toString32(value)}`); break;
      case 0x3c: logger.log(`Writing PIF Control byte: ${toString32(value)}`); this.updateControl(); break;
      default: logger.log(`Writing directly to PIF ram [${toString32(address)}] <-- ${toString32(value)}`); break;
    }

    n64js.joybus().cpuWrite(ramOffset);
  }

  write16(address, value) {
    const ea = this.calcWriteEA(address);
    if (ea < 0x7c0) {
      logger.log('Attempting to write to PIF ROM');
      return;
    }

    // FIXME: this should handle writes to the control register too.

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

    // FIXME: this should handle writes to the control register too.

    // SB is broken - it writes a 32-bit value.
    // It also uses 32 bits from the source register (i.e. value is not masked to 8 bits).
    const aligned = ea & ~3;
    const shift = 8 * (3 - (ea & 3));
    this.mem.set32(aligned, value << shift);
  }

  updateControl() {
    const piRom = this.mem.subRegion(0x000, 0x7c0);
    const piRam = this.mem.subRegion(0x7c0, 0x040);
    const command = piRam.getU8(0x3f);

    switch (command) {
      case 0x01:
        logger.log('PIF: execute block');
        break;
      case 0x08:
        logger.log('PIF: interrupt control');
        piRam.set8(0x3f, 0x00);
        this.hardware.si_reg.setBits32(si.SI_STATUS_REG, si.SI_STATUS_INTERRUPT);
        this.hardware.mi_reg.setBits32(mi.MI_INTR_REG, mi.MI_INTR_SI);
        n64js.cpu0.updateCause3();
        break;
      case 0x10:
        logger.log('PIF: clear rom');
        piRom.clear();
        break;
      case 0x30:
        logger.log('PIF: set 0x80 control ');
        piRam.set8(0x3f, 0x80);
        break;
      case 0xc0:
        logger.log('PIF: clear ram');
        piRam.clear();
        break;
      default:
        n64js.halt(`Unknown PIF control value: ${toString8(command)}`);
        break;
    }
  }
}
