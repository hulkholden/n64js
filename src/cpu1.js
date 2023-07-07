import { toString32 } from "./format.js";
import * as logger from './logger.js';

// TODO(hulkholden): Share this somewhere.
const FPCSR_C = 0x00800000;

export class CPU1 {
  constructor() {
    this.control = new Uint32Array(32);

    this.mem     = new ArrayBuffer(32 * 8);   // 32 64-bit regs
    this.float32 = new Float32Array(this.mem);
    this.float64 = new Float64Array(this.mem);
    this.int32   = new Int32Array(this.mem);
    this.uint32  = new Uint32Array(this.mem);

    this.regIdx32 = new Uint32Array(new ArrayBuffer(32 * 4));
    this.regIdx64 = new Uint32Array(new ArrayBuffer(32 * 4));

    this._fullMode = true;
    this.fullMode = true;
  }

  reset() {
    for (var i = 0; i < 32; ++i) {
      this.control[i] = 0;
      this.int32[i]   = 0;
    }

    this.control[0] = 0x00000511;
    this.fullMode = true;
  }

  /**
   * Set the register mode (full or half width).
   * @param {boolean} value
   */
  set fullMode(value) {
    this._fullMode = value;

    if (this._fullMode) {
      for (let i = 0; i < 32; i++) {
        this.regIdx32[i] = (i * 2) + 0;
        this.regIdx64[i] = i;
      }
    } else {
      for (let i = 0; i < 32; i++) {
        const even = i & ~1;
        this.regIdx32[i] = (even * 2) + (i & 1);
        this.regIdx64[i] = even;
      }
    }
  }

  /**
   * Set the condition control bit.
   * @param {boolean} enable
   */
  setCondition(enable) {
    if (enable) {
      this.control[31] |=  FPCSR_C;
    } else {
      this.control[31] &= ~FPCSR_C;
    }
  }

  /**
   * @param {number} i The register index.
   * @param {number} lo The low 32 bits to store.
   * @param {number} hi The high 32 bits to store.
   */
  store_64_hi_lo(i, lo, hi) {
    const regIdx = this.regIdx64[i];
    this.int32[(regIdx * 2) + 0] = lo;
    this.int32[(regIdx * 2) + 1] = hi;
  }

  /**
   * @param {number} i The register index.
   * @param {number} value The value to store.
   */
  store_i64_number(i, value) {
    const v = BigInt(value);
    this.store_i64_bigint(i, v);
  }

  /**
   * @param {number} i The register index.
   * @param {bigint} value The value to store.
   */
  store_i64_bigint(i, value) {
    const lo = Number(value & 0xffffffffn);
    const hi = Number(value >> 32n);
    this.store_64_hi_lo(i, lo, hi);
  }

  /**
   * @param {number} i The register index.
   * @param {number} value The value to store.
   */
  store_f32(i, value) {
    const regIdx = this.regIdx32[i];
    this.float32[regIdx] = value;
  }

  /**
   * @param {number} i The register index.
   * @param {number} value The value to store.
   */
  store_i32(i, value) {
    const regIdx = this.regIdx32[i];
    this.int32[regIdx] = value | 0;
  }

  /**
   * @param {number} i The register index.
   * @param {number} value The value to store.
   */
  store_f64(i, value) {
    const regIdx = this.regIdx64[i];
    this.float64[regIdx] = value;
  }

  /**
   * @param {number} i The register index.
   * @return {number}
   */
  load_f32(i) {
    const regIdx = this.regIdx32[i];
    return this.float32[regIdx];
  }

  /**
   * @param {number} i The register index.
   * @return {number}
   */
  load_i32(i) {
    const regIdx = this.regIdx32[i];
    return this.int32[regIdx];
  }

  /**
   * @param {number} i The register index.
   * @return {number}
   */
  load_f64(i) {
    const regIdx = this.regIdx64[i];
    return this.float64[regIdx];
  }

  /**
   * @param {number} i The register index.
   * @return {bigint}
   */
  load_i64_bigint(i) {
    const regIdx = this.regIdx64[i];
    const lo = this.int32[(regIdx * 2)];
    const hi = this.int32[(regIdx * 2) + 1];
    return (BigInt(hi) << 32n) + BigInt(lo >>> 0);
  }

  /**
   * @param {number} i The register index.
   * @return {number}
   */
  load_i64_number(i) {
    return Number(this.load_i64_bigint(i));
  }

  dump() {
    let s = 'Regs: ';
    for (let i = 0; i < 4; +i++) {
      s += toString32(this.int32[i]) + ', ';
    }
    logger.log(s);
    logger.log(`float64: [${this.float64[0]}, ${this.float64[1]}, ...]`);
  }
}
