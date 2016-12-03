import { Vector3 } from './Vector3.js';

export class Vector4 {
  /**
   * @param {Float32Array=} opt_elems
   */
  constructor(opt_elems) {
    this.elems = opt_elems || new Float32Array(4);
  }

  /**
   * Return the dot product.
   * @param {!Vector4} other
   * @return {number}
   */
  dot(other) {
    var t = 0;
    for (var i = 0; i < this.elems.length; ++i)
      t += this.elems[i]*other.elems[i];
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
   * @return {!Vector4}
   */
  normaliseInPlace() {
    var len = this.length();
    if (len > 0.0) {
      for (var i = 0; i < this.elems.length; ++i)
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
    var v = new Vector3();
    v.elems[0] = elems[0];
    v.elems[1] = elems[1];
    v.elems[2] = elems[2];
    v.elems[3] = elems[3];
    return v;
  }
}
