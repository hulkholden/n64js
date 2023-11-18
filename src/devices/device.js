import { toStringN, toString32 } from '../format.js';
import * as logger from '../logger.js';

/**
 * A device represents a region of memory mapped at a certain address.
 */
export class Device {
  /**
   * @param {string} name The name of this device.
   * @param {Hardware} hardware The underlying hardware.
   * @param {MemoryRegion|null} mem The memory region that backs this device.
   * @param {number} rangeStart The start of the address space to use.
   * @param {number} rangeEnd The end of the address space to use.
   */
  constructor(name, hardware, mem, rangeStart, rangeEnd) {
    this.name = name;
    this.hardware = hardware;
    this.mem = mem;
    this.u8 = mem ? mem.u8 : null;  // Cache the underlying Uint8Array.
    this.rangeStart = rangeStart;
    this.rangeEnd = rangeEnd;
    this.quiet = true;
  }

  /**
   * Sets the memory region that backs this device.
   * This is primarily used to attach the data for the ROM.
   * @param {MemoryRegion|null} mem The memory region that backs this device.
   */
  setMem(mem) {
    this.mem = mem;
    this.u8 = mem.u8;
  }

  /**
   * Resets the device.
   */
  reset() {}

  /**
   * Calculate the relative offset of the address for this device.
   * The default implementation calculates the offset from the rangeStart, but
   * other approaches can be used like wrapping at a certain length.
   * @param {number} address
   * @return {number}
   */
  calcEA(address) { return address - this.rangeStart; }

  /**
   * Calculate the relative offset of the address for this device for an internal access.
   * @param {number} address
   * @return {number}
   */
  calcInternalEA(address) { return this.calcEA(address); }

  /**
   * Calculate the relative offset of the address for this device for a read.
   * @param {number} address
   * @return {number}
   */
  calcReadEA(address) { return this.calcEA(address); }

  /**
   * Calculate the relative offset of the address for this device for a write.
   * @param {number} address
   * @return {number}
   */
  calcWriteEA(address) { return this.calcEA(address); }

  /**
   * Reads data at the specified address. For internal use - ignores errors.
   * @param {number} address
   * @return {number}
   */
  readInternal32(address) {
    const ea = this.calcInternalEA(address);
    if (ea + 4 <= this.u8.length) {
      return this.mem.getU32(ea);
    }
    return 0xdddddddd;
  }

  /**
   * Writes data to the specified address. For internal use - ignores errors.
   * @param {number} address
   * @param {number} value
   */
  writeInternal32(address, value) {
    const ea = this.calcInternalEA(address);
    if (ea + 4 <= this.u8.length) {
      this.mem.set32(ea, value);
    }
  }

  /**
   * Logs a read at the specified address.
   * Does nothing for Device - use LoggingDevice to enable output.
   * @param {number} address
   */
  logRead(address) {}

  /**
   * Logs a write to the specified address.
   * Does nothing for Device - use LoggingDevice to enable output.
   * @param {number} address
   * @param {string} value
   * @param {number} bits
   */
  logWrite(address, value, bits) {}

  /**
   * Reads unsigned 64 bit data at the specified address.
   * @param {number} address
   * @return {bigint}
   */
  readU64(address) {
    const ea = this.calcReadEA(address);
    if (ea + 8 > this.u8.length) {
      return 0;
    }
    return this.mem.getU64(ea);
  }

  /**
   * Reads unsigned 32 bit data at the specified address.
   * @param {number} address
   * @return {number}
   */
  readU32(address) {
    const ea = this.calcReadEA(address);
    if (ea + 4 > this.u8.length) {
      return 0;
    }
    return this.mem.getU32(ea);
  }

  /**
   * Reads unsigned 16 bit data at the specified address.
   * @param {number} address
   * @return {number}
   */
  readU16(address) {
    const ea = this.calcReadEA(address);
    if (ea + 2 > this.u8.length) {
      return 0;
    }
    return this.mem.getU16(ea);
  }

  /**
   * Reads unsigned 8 bit data at the specified address.
   * @param {number} address
   * @return {number}
   */
  readU8(address) {
    const ea = this.calcReadEA(address);
    if (ea + 1 > this.u8.length) {
      return 0;
    }
    return this.mem.getU8(ea);
  }

  /**
   * Writes 64 bit data using a mask to the specified address.
   * @param {number} address Address to write to - will be 64 bit aligned.
   * @param {bigint} value Value to write.
   * @param {bigint} mask Bits to overwrite.
   */
  write64masked(address, value, mask) {
    const ea = this.calcWriteEA(address) & ~7;
    if (ea + 8 > this.u8.length) {
      return;
    }
    this.mem.set64masked(ea, value, mask);
  }

  /**
   * Writes 32 bit data using a mask to the specified address.
   * @param {number} address Address to write to - will be 32 bit aligned.
   * @param {number} value Value to write.
   * @param {number} mask Bits to overwrite.
   */
  write32masked(address, value, mask) {
    const ea = this.calcWriteEA(address) & ~3;
    if (ea + 4 > this.u8.length) {
      return;
    }
    this.mem.set32masked(ea, value, mask);
  }

  /**
   * Writes 64 bit data to the specified address.
   * @param {number} address
   * @param {bigint} value
   */
  write64(address, value) {
    const ea = this.calcWriteEA(address);
    if (ea + 8 > this.u8.length) {
      return;
    }
    this.mem.set64(ea, value);
  }

  /**
   * Writes 32 bit data to the specified address.
   * @param {number} address
   * @param {number} value
   */
  write32(address, value) {
    const ea = this.calcWriteEA(address);
    if (ea + 4 > this.u8.length) {
      return;
    }
    this.mem.set32(ea, value);
  }

  /**
   * Writes 16 bit data to the specified address.
   * @param {number} address
   * @param {number} value
   */
  write16(address, value) {
    const ea = this.calcWriteEA(address);
    if (ea + 2 > this.u8.length) {
      return;
    }
    this.mem.set16(ea, value);
  }

  /**
   * Writes 8 bit data to the specified address.
   * @param {number} address
   * @param {number} value
   */
  write8(address, value) {
    const ea = this.calcWriteEA(address);
    if (ea + 1 > this.u8.length) {
      return;
    }
    this.mem.set8(ea, value);
  }
}

/**
 * A device that logs.
 */
export class LoggingDevice extends Device {
  /**
   * @param {string} name The name of this device.
   * @param {Hardware} hardware The underlying hardware.
   * @param {MemoryRegion|null} mem The memory region that backs this device.
   * @param {number} rangeStart The start of the address space to use.
   * @param {number} rangeEnd The end of the address space to use.
   */
  constructor(name, hardware, mem, rangeStart, rangeEnd) {
    super(name, hardware, mem, rangeStart, rangeEnd);
    this.quiet = false;
  }

  /**
   * Logs a read at the specified address.
   * @param {number} address
   */
  logRead(address) {
    logger.log(`Reading from ${this.name}: ${toString32(address)}`);
  }

  /**
   * Logs a write to the specified address.
   * @param {number} address
   * @param {string} value
   */
  logWrite(address, value, bits) {
    logger.log(`Writing to ${this.name}: ${toStringN(value, bits)} -> [${toString32(address)}]`);
  }

  readU64(address) {
    this.logRead(address);
    return super.readU64(address);
  }

  readU32(address) {
    this.logRead(address);
    return super.readU32(address);
  }

  readU16(address) {
    this.logRead(address);
    return super.readU16(address);
  }

  readU8(address) {
    this.logRead(address);
    return super.readU8(address);
  }

  write64masked(address, value, mask) {
    this.logWrite(address, value, 64);
    super.write64masked(address, value, mask);
  }

  write32masked(address, value, mask) {
    this.logWrite(address, value, 32);
    super.write32masked(address, value, mask);
  }

  write64(address, value) {
    this.logWrite(address, value, 64);
    super.write64(address, value);
  }

  write32(address, value) {
    this.logWrite(address, value, 32);
    super.write32(address, value);
  }

  write16(address, value) {
    this.logWrite(address, value, 16);
    super.write16(address, value);
  }

  write8(address, value) {
    this.logWrite(address, value, 8);
    super.write8(address, value);
  }
}
