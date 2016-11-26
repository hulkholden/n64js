
// TODO(hulkholden): Share this somewhere.
const FPCSR_C = 0x00800000;
const k1Shift32 = 4294967296.0;

export class CPU1 {
  constructor() {
    this.control = new Uint32Array(32);

    this.mem     = new ArrayBuffer(32 * 4);   // 32 32-bit regs
    this.float32 = new Float32Array(this.mem);
    this.float64 = new Float64Array(this.mem);
    this.int32   = new Int32Array(this.mem);
    this.uint32  = new Uint32Array(this.mem);
  }

  reset() {
    for (var i = 0; i < 32; ++i) {
      this.control[i] = 0;
      this.int32[i]   = 0;
    }

    this.control[0] = 0x00000511;
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
  store_64(i, lo, hi) {
    this.int32[i+0] = lo;
    this.int32[i+1] = hi;
  }

  /**
   * @param {number} i The register index.
   * @param {number} value The value to store.
   */
  store_float_as_long(i, value) {
    this.int32[i  ] = value & 0xffffffff;
    this.int32[i+1] = Math.floor(value / k1Shift32);
  }

  /**
   * @param {number} i The register index.
   * @param {number} value The value to store.
   */
  store_f64(i, value) {
    this.float64[i>>1] = value;
  }

  /**
   * @param {number} i The register index.
   * @return {number}
   */
  load_f64(i) {
    return this.float64[i>>1];
  }

  /**
   * @param {number} i The register index.
   * @return {number}
   */
  load_s64_as_double(i) {
    return (this.int32[i+1] * k1Shift32) + this.int32[i];
  }
}
