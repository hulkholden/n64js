import { Device } from './device.js';

export class UncachedDPCHandlerDevice extends Device {
  constructor(name, mem, rangeStart, rangeEnd) { super(name, mem, rangeStart, rangeEnd); }

  write32(address, value) {
    var ea = this.calcEA(address);
    if (ea + 4 > this.u8.length) {
      throw 'Write is out of range';
    }

    switch (ea) {
      case DPC_START_REG:
        if (!this.quiet) { logger.log('DPC start set to: ' + toString32(value)); }
        this.mem.write32(ea, value);
        this.mem.write32(DPC_CURRENT_REG, value);
        break;
      case DPC_END_REG:
        if (!this.quiet) { logger.log('DPC end set to: ' + toString32(value)); }
        this.mem.write32(ea, value);
        //mi_reg.setBits32(MI_INTR_REG, MI_INTR_DP);
        //n64js.cpu0.updateCause3();
        break;
      case DPC_STATUS_REG:
        //if (!this.quiet) { logger.log('DPC status set to: ' + toString32(value) ); }
        dpcUpdateStatus(value);
        break;

      // Read only
      case DPC_CURRENT_REG:
      case DPC_CLOCK_REG:
      case DPC_BUFBUSY_REG:
      case DPC_PIPEBUSY_REG:
      case DPC_TMEM_REG:
        logger.log('Wrote to read only DPC reg');
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
    return this.mem.readS32(ea);
  };

  readU32(address) {
    return this.readS32(address) >>> 0;
  };
}
