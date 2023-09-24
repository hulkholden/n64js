import { Vector4 } from "./Vector4.js";

export class Transform4D {
  /**
   * @param {Vector4=} opt_scale
   * @param {Vector4=} opt_trans
   */
  constructor(scale, trans) {
    this.scale = scale || new Vector4(1, 1, 1, 1);
    this.trans = trans || new Vector4(0, 0, 0, 0);
  }

  /**
   * Transforms a vector.
   * @param {!Vector4} v The vector to transform.
   */
  transformInPlace(v) {
    v.vecScaleInPlace(this.scale);
    v.addInPlace(this.trans);
  }

  /**
   * Inverse transforms a vector.
   * @param {!Vector4} v The vector to transform.
   */
  invTransformInPlace(v) {
    v.subInPlace(this.trans);
    v.invVecScaleInPlace(this.scale);
  }
}
