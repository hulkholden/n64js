export class TriangleBuffer {
  /**
   * @param {number} maxTris
   */
  constructor(maxTris) {
    this.numTris = 0;
    this.maxTris = maxTris;
    this.positions = new Float32Array(maxTris*3*4);
    this.colours = new  Uint32Array(maxTris*3*1);
    this.coords = new Float32Array(maxTris*3*2);
  }

  /**
   * Reset the buffer.
   */
  reset() {
    this.numTris = 0;
  }

  /**
   * Returns whether the buffer is empty.
   * @returns {boolean}
   */
  empty() {
    return this.numTris == 0;
  }

  /**
   * Returns whether the buffer has space for N more triangles.
   * @param {number} num 
   * @returns {boolean}
   */
  hasCapacity(num) {
    return this.numTris + num < this.maxTris;
  }

  /**
   * Add a triangle.
   * @param {!ProjectedVertex} v0
   * @param {!ProjectedVertex} v1
   * @param {!ProjectedVertex} v2
   * @param {number} idx
   */
  pushTri(v0, v1, v2) {
    return this.pushTriWithUV(v0, v1, v2, v0.u, v0.v, v1.u, v1.v, v2.u, v2.v);
  }

  pushTriWithUV(v0, v1, v2, s0, t0, s1, t1, s2, t2) {
    if (this.numTris >= this.maxTris) {
      return false;
    }

    const vp0 = v0.pos;
    const vp1 = v1.pos;
    const vp2 = v2.pos;

    let posIdx = this.numTris * 3 * 4;
    this.positions[posIdx++] = vp0.x;
    this.positions[posIdx++] = vp0.y;
    this.positions[posIdx++] = vp0.z;
    this.positions[posIdx++] = vp0.w;
    this.positions[posIdx++] = vp1.x;
    this.positions[posIdx++] = vp1.y;
    this.positions[posIdx++] = vp1.z;
    this.positions[posIdx++] = vp1.w;
    this.positions[posIdx++] = vp2.x;
    this.positions[posIdx++] = vp2.y;
    this.positions[posIdx++] = vp2.z;
    this.positions[posIdx++] = vp2.w;

    let colIdx = this.numTris * 3 * 1;
    this.colours[colIdx++] = v0.color;
    this.colours[colIdx++] = v1.color;
    this.colours[colIdx++] = v2.color;

    let uvIdx = this.numTris * 3 * 2;
    this.coords[uvIdx++] = s0;
    this.coords[uvIdx++] = t0;
    this.coords[uvIdx++] = s1;
    this.coords[uvIdx++] = t1;
    this.coords[uvIdx++] = s2;
    this.coords[uvIdx++] = t2;

    this.numTris++;
    return true;
  }
}
