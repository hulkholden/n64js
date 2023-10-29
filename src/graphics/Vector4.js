export class Vector4 {
  /**
   * @param {Float32Array=|number} opt_elems_or_x
   * @param {number=} opt_y
   * @param {number=} opt_z
   * @param {number=} opt_w
   */
  constructor(opt_elems_or_x, opt_y, opt_z, opt_w) {
    if (opt_w !== undefined) {
      this.elems = new Float32Array(4);
      this.elems[0] = opt_elems_or_x;
      this.elems[1] = opt_y;
      this.elems[2] = opt_z;
      this.elems[3] = opt_w;
    } else {
      this.elems = opt_elems_or_x || new Float32Array(4);
    }
  }

  get x() { return this.elems[0]; }
  get y() { return this.elems[1]; }
  get z() { return this.elems[2]; }
  get w() { return this.elems[3]; }

  set x(v) { this.elems[0] = v; }
  set y(v) { this.elems[1] = v; }
  set z(v) { this.elems[2] = v; }
  set w(v) { this.elems[3] = v; }

  /**
   * Sets the vector.
   * @param {number} x 
   * @param {number} y 
   * @param {number} z 
   * @param {number} w 
   * @return {!Vector4}
   */
  set(x, y, z, w) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
    return this;
  }

  /**
   * Sets the vector from a Vector3.
   * @param {Vector3} xyz
   * @param {number} w 
   * @return {!Vector4}
   */
  setV3(xyz, w) {
    this.x = xyz.x;
    this.y = xyz.y;
    this.z = xyz.z;
    this.w = w;
    return this;
  }

  /**
   * Return the dot product.
   * @param {!Vector4} other
   * @return {number}
   */
  dot(other) {
    let t = 0;
    for (let i = 0; i < this.elems.length; ++i) {
      t += this.elems[i] * other.elems[i];
    }
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
   * Adds the vector in place.
   * @param {Vector4} v The vector to subtract.
   * @return {!Vector4}
   */
  addInPlace(v) {
    for (let i = 0; i < this.elems.length; ++i) {
      this.elems[i] += v.elems[i];
    }
    return this;
  }

  /**
   * Subtracts the vector in place.
   * @param {Vector4} v The vector to subtract.
   * @return {!Vector4}
   */
  subInPlace(v) {
    for (let i = 0; i < this.elems.length; ++i) {
      this.elems[i] -= v.elems[i];
    }
    return this;
  }

  /**
   * Scales the vector in place by a scalar.
   * @param {number} s The scale factor to apply.
   * @return {!Vector4}
   */
  scaleInPlace(s) {
    for (let i = 0; i < this.elems.length; ++i) {
      this.elems[i] *= s;
    }
    return this;
  }

  /**
   * Scales the vector in place by a vector.
   * @param {Vector3} s The scale factor to apply.
   * @return {!Vector4}
   */
  vecScaleInPlace(s) {
    for (let i = 0; i < this.elems.length; ++i) {
      this.elems[i] *= s.elems[i];
    }
    return this;
  }

  /**
   * Scales the vector in place by 1 / vector.
   * @param {Vector3} s The scale factor to apply.
   * @return {!Vector4}
   */
  invVecScaleInPlace(s) {
    for (let i = 0; i < this.elems.length; ++i){
      this.elems[i] /= s.elems[i];
    }
    return this;
  }

  /**
   * Normalises the vector.
   * @return {!Vector4}
   */
  normaliseInPlace() {
    let len = this.length();
    if (len > 0.0) {
      return this.scaleInPlace(1 / len);
    }
    return this;
  }


  /**
   * Create a vector using the provided array of elements.
   * @param {!Array<number>} elems
   * @return {!Vector4}
   */
  static create(elems) {
    const v = new Vector4();
    v.elems[0] = elems[0];
    v.elems[1] = elems[1];
    v.elems[2] = elems[2];
    v.elems[3] = elems[3];
    return v;
  }
}
