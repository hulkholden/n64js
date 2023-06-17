import { Device } from './device.js';
import * as mi from './mi.js';
import * as logger from '../logger.js';
import { toString32 } from '../format.js';

// Audio Interface
const AI_DRAM_ADDR_REG = 0x00;
const AI_LEN_REG = 0x04;
const AI_CONTROL_REG = 0x08;
const AI_STATUS_REG = 0x0C;
const AI_DACRATE_REG = 0x10;
const AI_BITRATE_REG = 0x14;

export class AIRegDevice extends Device {
  constructor(hardware, rangeStart, rangeEnd) {
    super("AIReg", hardware, hardware.ai_reg, rangeStart, rangeEnd);
  }

  write32(address, value) {
    const ea = this.calcEA(address);
    if (ea + 4 > this.u8.length) {
      throw 'Write is out of range';
    }

    switch (ea) {
      case AI_DRAM_ADDR_REG:
      case AI_CONTROL_REG:
      case AI_BITRATE_REG:
        if (!this.quiet) { logger.log(`Wrote to AIReg: ${toString32(value)} -> [${toString32(address)}]`); }
        this.mem.write32(ea, value);
        break;

      case AI_LEN_REG:
        if (!this.quiet) { logger.log(`AI len changed to ${value}`); }
        this.mem.write32(ea, value);
        break;
      case AI_DACRATE_REG:
        if (!this.quiet) { logger.log(`AI dacrate changed to ${value}`); }
        this.mem.write32(ea, value);
        break;

      case AI_STATUS_REG:
        logger.log(`AI interrupt cleared`);
        this.mem.clearBits32(mi.MI_INTR_REG, mi.MI_INTR_AI);
        n64js.cpu0.updateCause3();
        break;

      default:
        logger.log(`Unhandled write to AIReg: ${toString32(value)} -> [${toString32(address)}]`);
        this.mem.write32(ea, value);
        break;
    }
  }
}
