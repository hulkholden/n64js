import { toString32 } from "./format.js";
import * as logger from './logger.js';

const FPCSR_RM_RN = 0x00000000;
const FPCSR_RM_RZ = 0x00000001;
const FPCSR_RM_RP = 0x00000002;
const FPCSR_RM_RM = 0x00000003;
const FPCSR_FI = 0x00000004;  // Flag, Inexact
const FPCSR_FU = 0x00000008;  // Flag, Underflow
const FPCSR_FO = 0x00000010;  // Flag, Overflow
const FPCSR_FZ = 0x00000020;  // Flag, Division by Zero
const FPCSR_FV = 0x00000040;  // Flag, Invalid
const FPCSR_EI = 0x00000080;  // Enable, Inexact
const FPCSR_EU = 0x00000100;  // Enable, Underflow
const FPCSR_EO = 0x00000200;  // Enable, Overflow
const FPCSR_EZ = 0x00000400;  // Enable, Division by Zero
const FPCSR_EV = 0x00000800;  // Enable, Invalid
const FPCSR_CI = 0x00001000;  // Cause, Inexact
const FPCSR_CU = 0x00002000;  // Cause, Underflow
const FPCSR_CO = 0x00004000;  // Cause, Overflow
const FPCSR_CZ = 0x00008000;  // Cause, Division by Zero
const FPCSR_CV = 0x00010000;  // Cause, Invalid
const FPCSR_CE = 0x00020000;  // Cause, Unimplemented
const FPCSR_C = 0x00800000;
const FPCSR_FS = 0x01000000;

const f32ExponentBits = 0x7f800000;
const f32ManissaBits = 0x007fffff;
const f32QuietBit = (1 << 22);

const f64ExponentBits = 0x7ff0000000000000n;
const f64ManissaBits = 0x000fffffffffffffn;
const f64QuietBit = (1n << 51n);

const floatTypeNormal = 0;
const floatTypeInfinity = 1;
const floatTypeQNaN = 2;
const floatTypeSNaN = 3;

function classifyFloat32Bits(bits) {
  if ((bits & f32ExponentBits) != f32ExponentBits) {
    return floatTypeNormal;
  }
  if ((bits & f32ManissaBits) == 0) {
    return floatTypeInfinity;
  }
  return bits & f32QuietBit ? floatTypeQNaN : floatTypeSNaN;
}

function classifyFloat64Bits(bits) {
  if ((bits & f64ExponentBits) != f64ExponentBits) {
    return floatTypeNormal;
  }
  if ((bits & f64ManissaBits) == 0) {
    return floatTypeInfinity;
  }
  return bits & f64QuietBit ? floatTypeQNaN : floatTypeSNaN;
}

function floatTypeNaN(t) {
  return t == floatTypeQNaN || t == floatTypeSNaN;
}


export class CPU1 {
  constructor(cpu0) {
    this.cpu0 = cpu0;
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

  handleFloatCompareSingle(op, s, t) {
    const fsi = this.load_i32(s);
    const fti = this.load_i32(t);

    const fsType = classifyFloat32Bits(fsi);
    const ftType = classifyFloat32Bits(fti);

    let c = false;
    if (floatTypeNaN(fsType) || floatTypeNaN(ftType)) {
      if ((op & 0x8) || fsType == floatTypeQNaN || ftType == floatTypeQNaN) {
        if (this.setInvalidOperation()) {
          this.cpu0.raiseFPE();
          return;
        }
      }
      if (op & 0x1) c = true;
    } else {
      const fs = this.load_f32(s);
      const ft = this.load_f32(t);

      if (op & 0x4) c |= fs < ft;
      if (op & 0x2) c |= fs == ft;
    }
    this.setCondition(c);
  }

  handleFloatCompareDouble(op, s, t) {
    const fsi = this.load_i64_bigint(s);
    const fti = this.load_i64_bigint(t);

    const fsType = classifyFloat64Bits(fsi);
    const ftType = classifyFloat64Bits(fti);

    let c = false;
    if (floatTypeNaN(fsType) || floatTypeNaN(ftType)) {
      if ((op & 0x8) || fsType == floatTypeQNaN || ftType == floatTypeQNaN) {
        if (this.setInvalidOperation()) {
          this.cpu0.raiseFPE();
          return;
        }
      }
      if (op & 0x1) c = true;
    } else {
      const fs = this.load_f64(s);
      const ft = this.load_f64(t);

      if (op & 0x4) c |= fs < ft;
      if (op & 0x2) c |= fs == ft;
    }
    this.setCondition(c);
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

  setInvalidOperation() {
    //const bits = this.control[31];
    if (this.control[31] & FPCSR_EV) {
      this.control[31] |= FPCSR_CV;
      return true;
    } else {
      this.control[31] |= FPCSR_FV | FPCSR_CV;
    }
    return false;
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
