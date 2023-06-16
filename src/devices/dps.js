import { Device } from './device.js';

export class UncachedDPSDevice extends Device {
  constructor(name, mem, rangeStart, rangeEnd) {
    super(name, mem, rangeStart, rangeEnd);
  }

  write32(address, value) {
    const ea = this.calcEA(address);
    if (ea + 4 > this.u8.length) {
      throw 'Write is out of range';
    }
    throw 'DPS writes are unhandled';
    //this.mem.write32(ea, value);
  };

  readS32(address) {
    this.logRead(address);
    const ea = this.calcEA(address);

    if (ea + 4 > this.u8.length) {
      throw 'Read is out of range';
    }
    throw 'DPS reads are unhandled';
    //return this.mem.readS32(ea);
  };

  readU32(address) {
    return this.readS32(address) >>> 0;
  };
}
