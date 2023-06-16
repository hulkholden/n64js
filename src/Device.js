import * as format from './format.js';
import * as logger from './logger.js';

/**
 * A device represents a region of memory mapped at a certain address.
 */
export class Device {
  /**
   * @param {string} name The name of this device.
   * @param {MemoryRegion|null} mem The memory region that backs this device.
   * @param {number} rangeStart The start of the address space to use.
   * @param {number} rangeEnd The end of the address space to use.
   */
  constructor(name, mem, rangeStart, rangeEnd) {
    this.name       = name;
    this.mem        = mem;
    this.u8         = mem ? mem.u8 : null;  // Cache the underlying Uint8Array.
    this.rangeStart = rangeStart;
    this.rangeEnd   = rangeEnd;
    this.quiet      = false;
  }

  /**
   * Sets the memory region that backs this device.
   * This is primarily used to attach the data for the ROM.
   * @param {MemoryRegion|null} mem The memory region that backs this device.
   */
  setMem(mem) {
    this.mem = mem;
    this.u8  = mem.u8;
  }

  /**
   * Calculate the relative offset of the address for this device.
   * @param {number} address
   * @return {number}
   */
  calcEA(address) {
    return address - this.rangeStart;
  }

  /**
   * Reads data at the specified address. For internal use - ignores errors.
   * @param {number} address
   * @return {number}
   */
  readInternal32(address) {
    var ea = this.calcEA(address);

    // We need to make sure this doesn't throw, so do a bounds check
    if (ea+4 <= this.u8.length) {
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
    var ea = this.calcEA(address);

    // We need to make sure this doesn't throw, so do a bounds check
    if (ea+4 <= this.u8.length) {
      this.mem.write32(ea, value);
    }
  }

  /**
   * Logs a read at the specified address.
   * @param {number} address
   */
  logRead(address) {
    if (!this.quiet) {
      logger.log('Reading from ' + this.name + ': ' + format.toString32(address) );
    }
  }

  /**
   * Logs a write to the specified address.
   * @param {number} address
   */
  logWrite(address, value_str) {
    if (!this.quiet) {
      logger.log('Writing to ' + this.name + ': ' + value_str + ' -> [' + format.toString32(address) + ']' );
    }
  }

  /**
   * Reads unsigned 32 bit data at the specified address.
   * @param {number} address
   * @return {number}
   */
  readU32(address) {
    this.logRead(address);
    var ea = this.calcEA(address);
    return this.mem.readU32(ea);
  }

  /**
   * Reads unsigned 16 bit data at the specified address.
   * @param {number} address
   * @return {number}
   */
  readU16(address) {
    this.logRead(address);
    var ea = this.calcEA(address);
    return this.mem.readU16(ea);
  }

  /**
   * Reads unsigned 8 bit data at the specified address.
   * @param {number} address
   * @return {number}
   */
  readU8(address) {
    this.logRead(address);
    var ea = this.calcEA(address);
    return this.mem.readU8(ea);
  }

  /**
   * Reads signed 32 bit data at the specified address.
   * @param {number} address
   * @return {number}
   */
  readS32(address) {
    this.logRead(address);
    var ea = this.calcEA(address);
    return this.mem.readS32(ea);
  }

  /**
   * Reads signed 16 bit data at the specified address.
   * @param {number} address
   * @return {number}
   */
  readS16(address) {
    this.logRead(address);
    var ea = this.calcEA(address);
    return this.mem.readS16(ea);
  }

  /**
   * Reads signed 8 bit data at the specified address.
   * @param {number} address
   * @return {number}
   */
  readS8(address) {
    this.logRead(address);
    var ea = this.calcEA(address);
    return this.mem.readS8(ea);
  }

  /**
   * Writes 32 bit data to the specified address.
   * @param {number} address
   * @param {number} value
   */
  write32(address, value) {
    this.logWrite(address, format.toString32(value));
    var ea = this.calcEA(address);
    this.mem.write32(ea, value);
  }

  /**
   * Writes 16 bit data to the specified address.
   * @param {number} address
   * @param {number} value
   */
  write16(address, value) {
    this.logWrite(address, format.toString16(value));
    var ea = this.calcEA(address);
    this.mem.write16(ea, value);
  }

  /**
   * Writes 8 bit data to the specified address.
   * @param {number} address
   * @param {number} value
   */
  write8(address, value) {
    this.logWrite(address, format.toString8(value));
    var ea = this.calcEA(address);
    this.mem.write8(ea, value);
  }
}
