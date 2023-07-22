/**
 * MemoryRegion just wraps an ArrayBuffer and provides some useful accessors.
 */
export class MemoryRegion {
  /**
   * @param {!ArrayBuffer} arrayBuffer
   */
  constructor(arrayBuffer) {
    this.arrayBuffer = arrayBuffer;
    this.length = arrayBuffer.byteLength;
    this.u8 = new Uint8Array(arrayBuffer);
    this.s32 = new Int32Array(arrayBuffer);
    this.dataView = new DataView(arrayBuffer);
  }

  clear() {
    for (let i = 0; i < this.u8.length; ++i) {
      this.u8[i] = 0;
    }
  }

  /**
   * Read the value at the specified offset.
   * @param {number} offset
   * @return {number}
   */
  readU32(offset) { return this.dataView.getUint32(offset, false); }

  /**
   * Read the value at the specified offset.
   * @param {number} offset
   * @return {number}
   */
  readU16(offset) { return this.dataView.getUint16(offset, false); }

  /**
   * Read the value at the specified offset.
   * @param {number} offset
   * @return {number}
   */
  readU8(offset) { return this.dataView.getUint8(offset, false); }

  /**
   * Read the value at the specified offset.
   * @param {number} offset
   * @return {number}
   */
  readS32(offset) { return this.dataView.getInt32(offset, false); }

  /**
   * Read the value at the specified offset.
   * @param {number} offset
   * @return {number}
   */
  readS16(offset) { return this.dataView.getInt16(offset, false); }

  /**
   * Read the value at the specified offset.
   * @param {number} offset
   * @return {number}
   */
  readS8(offset) { return this.dataView.getInt8(offset, false); }

  /**
   * Write the value to the specified offset.
   * @param {number} offset
   * @param {number} value
   */
  write32(offset, value) { this.dataView.setUint32(offset, value, false); }

  /**
   * Write the value to the specified offset.
   * @param {number} offset
   * @param {number} value
   */
  write16(offset, value) { this.dataView.setUint16(offset, value, false); }

  /**
   * Write the value to the specified offset.
   * @param {number} offset
   * @param {number} value
   */
  write8(offset, value) { this.dataView.setUint8(offset, value, false); }

  /**
   * Clear the specified bits at the specified offset.
   * @param {number} offset
   * @param {number} bits
   * @return {number}
   */
  clearBits32(offset, bits) {
    const value = this.readU32(offset) & ~bits;
    this.write32(offset, value);
    return value;
  }

  /**
   * Set the specified bits at the specified offset.
   * @param {number} offset
   * @param {number} bits
   * @return {number}
   */
  setBits32(offset, bits) {
    const value = this.readU32(offset) | bits;
    this.write32(offset, value);
    return value;
  }

  /**
   * Get the specified bits at the specified offset.
   * @param {number} offset
   * @param {number} bits
   * @return {number}
   */
  getBits32(offset, bits) {
    return this.readU32(offset) & bits;
  }
}
