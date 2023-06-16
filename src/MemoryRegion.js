/**
 * MemoryRegion just wraps an ArrayBuffer and provides some useful accessors.
 */
export class MemoryRegion {
  /**
   * @param {!ArrayBuffer} arrayBuffer
   */
  constructor(arrayBuffer) {
    this.arrayBuffer = arrayBuffer;
    this.length      = arrayBuffer.byteLength;
    this.u8          = new Uint8Array(arrayBuffer);
    this.s32         = new Int32Array(arrayBuffer);
  }

  clear() {
    var i;
    for (i = 0; i < this.u8.length; ++i) {
      this.u8[i] = 0;
    }
  }

  /**
   * Read the value at the specified offset.
   * @param {number} offset
   * @return {number}
   */
  readU32(offset) {
    return ((this.u8[offset] << 24) | (this.u8[offset+1] << 16) | (this.u8[offset+2] << 8) | this.u8[offset+3])>>>0;
  }

  /**
   * Read the value at the specified offset.
   * @param {number} offset
   * @return {number}
   */
  readU16(offset) {
    return (this.u8[offset] <<  8) | (this.u8[offset+1]      );
  }

  /**
   * Read the value at the specified offset.
   * @param {number} offset
   * @return {number}
   */
  readU8(offset) {
    return this.u8[offset];
  }

  /**
   * Read the value at the specified offset.
   * @param {number} offset
   * @return {number}
   */
  readS32(offset) {
    return ((this.u8[offset] << 24) | (this.u8[offset+1] << 16) | (this.u8[offset+2] << 8) | this.u8[offset+3]) | 0;
  }

  /**
   * Read the value at the specified offset.
   * @param {number} offset
   * @return {number}
   */
  readS16(offset) {
    return  ((this.u8[offset] << 24) | (this.u8[offset+1] << 16) ) >> 16;
  }

  /**
   * Read the value at the specified offset.
   * @param {number} offset
   * @return {number}
   */
  readS8(offset) {
    return  ((this.u8[offset] << 24) ) >> 24;
  }

  /**
   * Write the value to the specified offset.
   * @param {number} offset
   * @param {number} value
   */
  write32(offset, value) {
    this.u8[offset  ] = value >> 24;
    this.u8[offset+1] = value >> 16;
    this.u8[offset+2] = value >>  8;
    this.u8[offset+3] = value;
  }

  /**
   * Write the value to the specified offset.
   * @param {number} offset
   * @param {number} value
   */
  write16(offset, value) {
    this.u8[offset  ] = value >> 8;
    this.u8[offset+1] = value;
  }

  /**
   * Write the value to the specified offset.
   * @param {number} offset
   * @param {number} value
   */
  write8(offset, value) {
    this.u8[offset] = value;
  }

  /**
   * Clear the specified bits at the specified offset.
   * @param {number} offset
   * @param {number} bits
   * @return {number}
   */
  clearBits32(offset, bits) {
    var value = this.readU32(offset) & ~bits;
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
    var value = this.readU32(offset) | bits;
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
