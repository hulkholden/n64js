import { Vector2 } from "./Vector2.js";

export class Transform2D {
  /**
   * @param {Vector2=} opt_scale
   * @param {Vector2=} opt_trans
   */
  constructor(scale, trans) {
    this.scale = scale || new Vector2(1, 1);
    this.trans = trans || new Vector2(0, 0);
  }

  /**
   * Transforms a vector.
   * @param {!Vector2} v The vector to transform.
   * @return {!Vector2} The output vector.
   */
  transform(v) {
    const x = (this.scale.x * v.x) + this.trans.x;
    const y = (this.scale.y * v.y) + this.trans.y;
    return new Vector2(x, y);
  }
}
