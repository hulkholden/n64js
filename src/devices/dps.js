import { Device } from './device.js';

// DP Span
const DPS_TBIST_REG = 0x00;
const DPS_TEST_MODE_REG = 0x04;
const DPS_BUFTEST_ADDR_REG = 0x08;
const DPS_BUFTEST_DATA_REG = 0x0C;

const DPS_TBIST_CHECK = 0x01;
const DPS_TBIST_GO = 0x02;
const DPS_TBIST_CLEAR = 0x04;

const DPS_TBIST_DONE = 0x004;
const DPS_TBIST_FAILED = 0x7F8;

export class DPSDevice extends Device {
  constructor(hardware, rangeStart, rangeEnd) {
    super("DPS", hardware, hardware.dps_mem, rangeStart, rangeEnd);
  }

  write32(address, value) {
    const ea = this.calcWriteEA(address);
    if (ea + 4 > this.u8.length) {
      throw 'Write is out of range';
    }
    throw 'DPS writes are unhandled';
    //this.mem.set32(ea, value);
  }

  readU32(address) {
    this.logRead(address);
    const ea = this.calcReadEA(address);

    if (ea + 4 > this.u8.length) {
      throw 'Read is out of range';
    }
    throw 'DPS reads are unhandled';
    //return this.mem.getU32(ea);
  }
}
