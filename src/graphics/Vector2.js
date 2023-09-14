export class Vector2 {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }

  /**
   * Return the dot product.
   * @param {!Vector2} other
   * @return {number}
   */
  dot(other) {
    return (this.x * other.x) + (this.y * other.y);
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
    * Adds the provided vector and returns the result.
    * @param {Vector2} other 
    * @returns {Vector2}
    */
  add(other) {
    return new Vector2(this.x + other.x, this.y + other.y);
  }

  /**
    * Subtracts the provided vector and returns the result.
    * @param {Vector2} other 
    * @returns {Vector2}
    */
  sub(other) {
    return new Vector2(this.x - other.x, this.y - other.y);
  }

  /**
    * Scales the vector by the provided value and returns the result.
    * @param {number} s 
    * @returns {Vector2}
    */
  scale(s) {
    return new Vector2(this.x * s, this.y * s);
  }

  /**
   * Normalises the vector.
   * @return {!Vector2}
   */
  normaliseInPlace() {
    const len = this.length();
    if (len > 0.0) {
      this.x /= len;
      this.y /= len;
    }
    return this;
  }
}
