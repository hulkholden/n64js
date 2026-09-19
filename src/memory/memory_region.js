/**
 * MemoryRegion just wraps an ArrayBuffer and provides some useful accessors.
 */
export class MemoryRegion {
  /**
   * @param {!ArrayBuffer} arrayBuffer
   * @param {number} offset is the byte offset into arrayBuffer (defaults to zero).
   * @param {number} length is the length of the region (defaults to arrayBuffer.byteLength - offset).
   */
  constructor(arrayBuffer, offset, length) {
    if (offset === undefined) {
      offset = 0;
    }
    if (length === undefined) {
      length = arrayBuffer.byteLength - offset;
    }

    this.arrayBuffer = arrayBuffer;
    this.offset = offset;
    this.length = length;
    this.u8 = new Uint8Array(arrayBuffer, offset, length);
    this.dataView = new DataView(arrayBuffer, offset, length);
  }

  clear() {
    for (let i = 0; i < this.u8.length; ++i) {
      this.u8[i] = 0;
    }
  }

  set(offset, length, value) {
    for (let i = 0; i < length; ++i) {
      this.u8[offset + i] = value;
    }
  }

  /**
   * Returns a new MemoryRegion with the provided offset and length.
   * @param {number} offset 
   * @param {number} length 
   * @returns {DataView}
   */
  subRegion(offset, length) {
    if (offset + length > this.length) {
      throw `end is out of bounds`;
    }
    return new MemoryRegion(this.arrayBuffer, this.offset + offset, length);
  }

  /**
   * Returns an Int32Array view of this MemoryRegion.
   * @returns {Int32Array}
   */
  s32Array() {
    return new Int32Array(this.arrayBuffer, this.offset, this.length / 4);
  }

  /**
   * Copies memory.
   * @param {number} dstOff  Offset to start copying to.
   * @param {MemoryRegion} src Source to copy from.
   * @param {number} srcOff Offset within src to start copying from.
   * @param {number} length Number of bytes to copy.
   */
  copy(dstOff, src, srcOff, length) {
    if ((dstOff + length) > this.u8.length) {
      throw `overflow dst`;
    }
    if ((srcOff + length) > src.u8.length) {
      throw `overflow src`;
    }
    for (let i = 0; i < length; ++i) {
      this.u8[dstOff + i] = src.u8[srcOff + i];
    }
  }

  /**
   * Gets the value at the specified offset.
   * @param {number} offset
   * @return {bigint}
   */
  getU64(offset) { return this.dataView.getBigUint64(offset, false); }

  /**
   * Gets the value at the specified offset.
   * @param {number} offset
   * @return {number}
   */
  getU32(offset) { return this.dataView.getUint32(offset, false); }

  /**
   * Gets the value at the specified offset.
   * @param {number} offset
   * @return {number}
   */
  getU16(offset) { return this.dataView.getUint16(offset, false); }

  /**
   * Gets the value at the specified offset.
   * @param {number} offset
   * @return {number}
   */
  getU8(offset) { return this.dataView.getUint8(offset, false); }

  /**
   * Gets the value at the specified offset.
   * @param {number} offset
   * @return {bigint}
   */
  getS64(offset) { return this.dataView.getBigInt64(offset, false); }

  /**
   * Gets the value at the specified offset.
   * @param {number} offset
   * @return {number}
   */
  getS32(offset) { return this.dataView.getInt32(offset, false); }

  /**
   * Gets the value at the specified offset.
   * @param {number} offset
   * @return {number}
   */
  getS16(offset) { return this.dataView.getInt16(offset, false); }

  /**
   * Gets the value at the specified offset.
   * @param {number} offset
   * @return {number}
   */
  getS8(offset) { return this.dataView.getInt8(offset, false); }

  /**
   * Sets the value at the specified offset, using the provided masking.
   * @param {number} offset
   * @param {bigint} value
   * @param {bigint} mask
   */
  set64masked(offset, value, mask) {
    const orig = this.getU64(offset, false);
    const result = (orig & ~mask) | (value & mask);
    this.set64(offset, result, false);
  }

  /**
   * Sets the value at the specified offset, using the provided masking.
   * @param {number} offset
   * @param {number} value
   * @param {number} mask
   */
  set32masked(offset, value, mask) {
    const orig = this.getU32(offset, false);
    const result = (orig & ~mask) | (value & mask);
    this.set32(offset, result);
  }

  /**
   * Sets the value at the specified offset.
   * @param {number} offset
   * @param {bigint} value
   */
  set64(offset, value) { this.dataView.setBigUint64(offset, value, false); }

  /**
   * Sets the value at the specified offset.
   * @param {number} offset
   * @param {number} value
   */
  set32(offset, value) { this.dataView.setUint32(offset, value, false); }

  /**
   * Sets the value at the specified offset.
   * @param {number} offset
   * @param {number} value
   */
  set16(offset, value) { this.dataView.setUint16(offset, value, false); }

  /**
   * Sets the value at the specified offset.
   * @param {number} offset
   * @param {number} value
   */
  set8(offset, value) { this.dataView.setUint8(offset, value, false); }

  /**
   * Clear the specified bits at the specified offset.
   * @param {number} offset
   * @param {number} bits
   * @return {number}
   */
  clearBits32(offset, bits) {
    const value = this.getU32(offset) & ~bits;
    this.set32(offset, value);
    return value;
  }

  /**
   * Set the specified bits at the specified offset.
   * @param {number} offset
   * @param {number} bits
   * @return {number}
   */
  setBits32(offset, bits) {
    const value = this.getU32(offset) | bits;
    this.set32(offset, value);
    return value;
  }

  /**
   * Get the specified bits at the specified offset.
   * @param {number} offset
   * @param {number} bits
   * @return {number}
   */
  getBits32(offset, bits) {
    return this.getU32(offset) & bits;
  }
}
