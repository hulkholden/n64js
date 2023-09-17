export class Vector3 {
  /**
   * @param {Float32Array=|number} opt_elems_or_x
   * @param {number=} opt_y
   * @param {number=} opt_z
   */
  constructor(opt_elems_or_x, opt_y, opt_z) {
    if (opt_z !== undefined) {
      this.elems = new Float32Array(3);
      this.elems[0] = opt_elems_or_x;
      this.elems[1] = opt_y;
      this.elems[2] = opt_z;
    } else {
      this.elems = opt_elems_or_x || new Float32Array(3);
    }
  }

  get x() { return this.elems[0]; }
  get y() { return this.elems[1]; }
  get z() { return this.elems[2]; }

  set x(v) { this.elems[0] = v; }
  set y(v) { this.elems[1] = v; }
  set z(v) { this.elems[2] = v; }

  /**
   * Return the dot product.
   * @param {!Vector3} other
   * @return {number}
   */
  dot(other) {
    let t = 0;
    for (let i = 0; i < this.elems.length; ++i)
      t += this.elems[i] * other.elems[i];
    return t;
  }

  /**
   * Return the squared length of the vector.
   * @return {number}
   */
  lengthSqr() {
    return this.dot(this);
  }

  /**
   * Return the length of the vector.
   * @return {number}
   */
  length() {
    return Math.sqrt(this.lengthSqr());
  }

  /**
   * Normalises the vector.
   * @return {!Vector3}
   */
  normaliseInPlace() {
    let len = this.length();
    if (len > 0.0) {
      for (let i = 0; i < this.elems.length; ++i)
        this.elems[i] /= len;
    }
    return this;
  }

  /**
   * Create a vector using the provided array of elements.
   * @param {!Array<number>} elems
   * @return {!Vector3}
   */
  static create(elems) {
    let v = new Vector3();
    v.elems[0] = elems[0];
    v.elems[1] = elems[1];
    v.elems[2] = elems[2];
    return v;
  }
}
