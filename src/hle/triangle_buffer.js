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
    if (this.numTris >= this.maxTris) {
      return false;
    }

    var vtx_pos_idx = this.numTris * 3*4;
    var vtx_col_idx = this.numTris * 3*1;
    var vtx_uv_idx  = this.numTris * 3*2;

    var vp0 = v0.pos;
    var vp1 = v1.pos;
    var vp2 = v2.pos;

    this.positions[vtx_pos_idx+ 0] = vp0.x;
    this.positions[vtx_pos_idx+ 1] = vp0.y;
    this.positions[vtx_pos_idx+ 2] = vp0.z;
    this.positions[vtx_pos_idx+ 3] = vp0.w;
    this.positions[vtx_pos_idx+ 4] = vp1.x;
    this.positions[vtx_pos_idx+ 5] = vp1.y;
    this.positions[vtx_pos_idx+ 6] = vp1.z;
    this.positions[vtx_pos_idx+ 7] = vp1.w;
    this.positions[vtx_pos_idx+ 8] = vp2.x;
    this.positions[vtx_pos_idx+ 9] = vp2.y;
    this.positions[vtx_pos_idx+10] = vp2.z;
    this.positions[vtx_pos_idx+11] = vp2.w;

    this.colours[vtx_col_idx + 0] = v0.color;
    this.colours[vtx_col_idx + 1] = v1.color;
    this.colours[vtx_col_idx + 2] = v2.color;

    this.coords[vtx_uv_idx+ 0] = v0.u;
    this.coords[vtx_uv_idx+ 1] = v0.v;
    this.coords[vtx_uv_idx+ 2] = v1.u;
    this.coords[vtx_uv_idx+ 3] = v1.v;
    this.coords[vtx_uv_idx+ 4] = v2.u;
    this.coords[vtx_uv_idx+ 5] = v2.v;

    this.numTris++;
    return true;
  }

  // TODO: dedupe with the above.
  pushTriWithUV(v0, v1, v2, s0, t0, s1, t1, s2, t2) {
    if (this.numTris >= this.maxTris) {
      return false;
    }

    var vtx_pos_idx = this.numTris * 3 * 4;
    var vtx_col_idx = this.numTris * 3 * 1;
    var vtx_uv_idx = this.numTris * 3 * 2;

    var vp0 = v0.pos;
    var vp1 = v1.pos;
    var vp2 = v2.pos;

    this.positions[vtx_pos_idx + 0] = vp0.x;
    this.positions[vtx_pos_idx + 1] = vp0.y;
    this.positions[vtx_pos_idx + 2] = vp0.z;
    this.positions[vtx_pos_idx + 3] = vp0.w;
    this.positions[vtx_pos_idx + 4] = vp1.x;
    this.positions[vtx_pos_idx + 5] = vp1.y;
    this.positions[vtx_pos_idx + 6] = vp1.z;
    this.positions[vtx_pos_idx + 7] = vp1.w;
    this.positions[vtx_pos_idx + 8] = vp2.x;
    this.positions[vtx_pos_idx + 9] = vp2.y;
    this.positions[vtx_pos_idx + 10] = vp2.z;
    this.positions[vtx_pos_idx + 11] = vp2.w;

    this.colours[vtx_col_idx + 0] = v0.color;
    this.colours[vtx_col_idx + 1] = v1.color;
    this.colours[vtx_col_idx + 2] = v2.color;

    this.coords[vtx_uv_idx + 0] = s0;
    this.coords[vtx_uv_idx + 1] = t0;
    this.coords[vtx_uv_idx + 2] = s1;
    this.coords[vtx_uv_idx + 3] = t1;
    this.coords[vtx_uv_idx + 4] = s2;
    this.coords[vtx_uv_idx + 5] = t2;

    this.numTris++;
    return true;
  }
}
