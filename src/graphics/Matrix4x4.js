export class Matrix4x4 {
  /**
   * @param {(Float64Array|Float32Array|Array<number>)=} opt_elems
   */
  constructor(opt_elems) {
    // CPU matrices must retain every bit of decoded signed 16.16 values.
    // Promote supplied float32 storage too, so later writes cannot narrow.
    this.elems = opt_elems instanceof Float64Array
      ? opt_elems
      : new Float64Array(opt_elems || 16);
  }

  /**
   * Uses Number arithmetic without implicit float32 rounding. Microcode-specific
   * fixed-point truncation/overflow belongs at the emulation call site, not here.
   * @param {!Matrix4x4} other The matrix to multiply with.
   * @return {!Matrix4x4}
   */
  multiply(other) {
    let a = this.elems;
    let b = other.elems;

    let out = new Float64Array(16);
    for (let r = 0; r < 4; ++r) {
      for (let c = 0; c < 4; ++c) {
        // Accumulate the entire dot product before writing to matrix storage.
        out[r * 4 + c] = (a[r * 4 + 0] * b[0 * 4 + c])
          + (a[r * 4 + 1] * b[1 * 4 + c])
          + (a[r * 4 + 2] * b[2 * 4 + c])
          + (a[r * 4 + 3] * b[3 * 4 + c]);
      }
    }

    return new Matrix4x4(out);
  }

  /**
   * Transforms a normal vector.
   * @param {!Vector3} v3in The vector to transform.
   * @param {!Vector3} v3out The output vector.
   */
  transformNormal(v3in, v3out) {
    let a = this.elems;
    let v = v3in.elems;

    let x = v[0];
    let y = v[1];
    let z = v[2];

    v3out.elems[0] = (a[0] * x) + (a[1] * y) + (a[2] * z);
    v3out.elems[1] = (a[4] * x) + (a[5] * y) + (a[6] * z);
    v3out.elems[2] = (a[8] * x) + (a[9] * y) + (a[10] * z);
  }

  /**
   * Transforms a point vector.
   * @param {!Vector3} v3in The vector to transform.
   * @param {!Vector4} v4out The output vector.
   */
  transformPoint(v3in, v4out) {
    let a = this.elems;
    let v = v3in.elems;

    let x = v[0];
    let y = v[1];
    let z = v[2];

    v4out.elems[0] = (a[0] * x) + (a[1] * y) + (a[2] * z) + a[3];
    v4out.elems[1] = (a[4] * x) + (a[5] * y) + (a[6] * z) + a[7];
    v4out.elems[2] = (a[8] * x) + (a[9] * y) + (a[10] * z) + a[11];
    v4out.elems[3] = (a[12] * x) + (a[13] * y) + (a[14] * z) + a[15];
  }

  /**
   * Makes an identity matrix.
   * @return {!Matrix4x4}
   */
  static identity() {
    let elems = new Float64Array(16);
    elems[0] = 1;
    elems[5] = 1;
    elems[10] = 1;
    elems[15] = 1;
    return new Matrix4x4(elems);
  }

  /**
   * Copies this matrix.
   * @return {!Matrix4x4}
   */
  copy() {
    let elems = new Float64Array(16);
    for (let i = 0; i < 16; i++) {
      elems[i] = this.elems[i];
    }
    return new Matrix4x4(elems);
  }

  /**
   * Make an orthographic projection matrix.
   * @param {number} left
   * @param {number} right
   * @param {number} bottom
   * @param {number} top
   * @param {number} znear
   * @param {number} zfar
   * @return {!Matrix4x4}
   */
  static makeOrtho(left, right, bottom, top, znear, zfar) {
    let tx = - (right + left) / (right - left);
    let ty = - (top + bottom) / (top - bottom);
    let tz = - (zfar + znear) / (zfar - znear);

    let elems = new Float64Array(16);

    elems[0] = 2 / (right - left);
    elems[1] = 0;
    elems[2] = 0;
    elems[3] = 0;

    elems[4] = 0;
    elems[5] = 2 / (top - bottom);
    elems[6] = 0;
    elems[7] = 0;

    elems[8] = 0;
    elems[9] = 0;
    elems[10] = -2 / (zfar - znear);
    elems[11] = 0;

    elems[12] = tx;
    elems[13] = ty;
    elems[14] = tz;
    elems[15] = 1;

    return new Matrix4x4(elems);
  }
}
