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
      return this.mem.readU32(ea);
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
      this.mem.write32(ea, value);
    }
  }

  /**
   * Logs a read at the specified address.
   * @param {number} address
   */
  logRead(address) {
    if (!this.quiet) {
      logger.log(`Reading from ${this.name}: ${toString32(address)}`);
    }
  }

  /**
   * Logs a write to the specified address.
   * @param {number} address
   * @param {string} value
   */
  logWrite(address, value, bits) {
    if (!this.quiet) {
      logger.log(`Writing to ${this.name}: ${toStringN(value, bits)} -> [${toString32(address)}]`);
    }
  }

  /**
   * Reads unsigned 64 bit data at the specified address.
   * @param {number} address
   * @return {bigint}
   */
  readU64(address) {
    this.logRead(address);
    const ea = this.calcReadEA(address);
    return this.mem.readU64(ea);
  }

  /**
   * Reads unsigned 32 bit data at the specified address.
   * @param {number} address
   * @return {number}
   */
  readU32(address) {
    this.logRead(address);
    const ea = this.calcReadEA(address);
    return this.mem.readU32(ea);
  }

  /**
   * Reads unsigned 16 bit data at the specified address.
   * @param {number} address
   * @return {number}
   */
  readU16(address) {
    this.logRead(address);
    const ea = this.calcReadEA(address);
    return this.mem.readU16(ea);
  }

  /**
   * Reads unsigned 8 bit data at the specified address.
   * @param {number} address
   * @return {number}
   */
  readU8(address) {
    this.logRead(address);
    const ea = this.calcReadEA(address);
    return this.mem.readU8(ea);
  }

  /**
   * Reads signed 32 bit data at the specified address.
   * @param {number} address
   * @return {number}
   */
  readS32(address) {
    this.logRead(address);
    const ea = this.calcReadEA(address);
    return this.mem.readS32(ea);
  }

  /**
   * Reads signed 16 bit data at the specified address.
   * @param {number} address
   * @return {number}
   */
  readS16(address) {
    this.logRead(address);
    const ea = this.calcReadEA(address);
    return this.mem.readS16(ea);
  }

  /**
   * Reads signed 8 bit data at the specified address.
   * @param {number} address
   * @return {number}
   */
  readS8(address) {
    this.logRead(address);
    const ea = this.calcReadEA(address);
    return this.mem.readS8(ea);
  }

  /**
   * Writes 64 bit data using a mask to the specified address.
   * @param {number} address Address to write to - will be 64 bit aligned.
   * @param {bigint} value Value to write.
   * @param {bigint} mask Bits to overwrite.
   */
  write64masked(address, value, mask) {
    this.logWrite(address, value, 64);
    const ea = this.calcWriteEA(address) & ~7;
    this.mem.write64masked(ea, value, mask);
  }

  /**
   * Writes 32 bit data using a mask to the specified address.
   * @param {number} address Address to write to - will be 32 bit aligned.
   * @param {number} value Value to write.
   * @param {number} mask Bits to overwrite.
   */
  write32masked(address, value, mask) {
    this.logWrite(address, value, 32);
    const ea = this.calcWriteEA(address) & ~3;
    this.mem.write32masked(ea, value, mask);
  }

  /**
   * Writes 64 bit data to the specified address.
   * @param {number} address
   * @param {bigint} value
   */
  write64(address, value) {
    this.logWrite(address, value, 64);
    const ea = this.calcWriteEA(address);
    this.mem.write64(ea, value);
  }

  /**
   * Writes 32 bit data to the specified address.
   * @param {number} address
   * @param {number} value
   */
  write32(address, value) {
    this.logWrite(address, value, 32);
    const ea = this.calcWriteEA(address);
    this.mem.write32(ea, value);
  }

  /**
   * Writes 16 bit data to the specified address.
   * @param {number} address
   * @param {number} value
   */
  write16(address, value) {
    this.logWrite(address, value, 16);
    const ea = this.calcWriteEA(address);
    this.mem.write16(ea, value);
  }

  /**
   * Writes 8 bit data to the specified address.
   * @param {number} address
   * @param {number} value
   */
  write8(address, value) {
    this.logWrite(address, value, 8);
    const ea = this.calcWriteEA(address);
    this.mem.write8(ea, value);
  }
}
