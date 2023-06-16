import { Vector4 } from './Vector4.js';

export class ProjectedVertex {
  constructor() {
    this.pos   = new Vector4();
    this.color = 0;
    this.u     = 0;
    this.v     = 0;
    this.set   = false;
  }
}

export class TriangleBuffer {
  /**
   * @param {number} maxTris
   */
  constructor(maxTris) {
    this.positions = new Float32Array(maxTris*3*4);
    this.colours = new  Uint32Array(maxTris*3*1);
    this.coords = new Float32Array(maxTris*3*2);
  }

  /**
   * Add a triangle.
   * @param {!ProjectedVertex} v0
   * @param {!ProjectedVertex} v1
   * @param {!ProjectedVertex} v2
   * @param {number} idx
   */
  pushTri(v0, v1, v2, idx) {
    var vtx_pos_idx = idx * 3*4;
    var vtx_col_idx = idx * 3*1;
    var vtx_uv_idx  = idx * 3*2;

    var vp0 = v0.pos.elems;
    var vp1 = v1.pos.elems;
    var vp2 = v2.pos.elems;

    this.positions[vtx_pos_idx+ 0] = vp0[0];
    this.positions[vtx_pos_idx+ 1] = vp0[1];
    this.positions[vtx_pos_idx+ 2] = vp0[2];
    this.positions[vtx_pos_idx+ 3] = vp0[3];
    this.positions[vtx_pos_idx+ 4] = vp1[0];
    this.positions[vtx_pos_idx+ 5] = vp1[1];
    this.positions[vtx_pos_idx+ 6] = vp1[2];
    this.positions[vtx_pos_idx+ 7] = vp1[3];
    this.positions[vtx_pos_idx+ 8] = vp2[0];
    this.positions[vtx_pos_idx+ 9] = vp2[1];
    this.positions[vtx_pos_idx+10] = vp2[2];
    this.positions[vtx_pos_idx+11] = vp2[3];

    this.colours[vtx_col_idx + 0] = v0.color;
    this.colours[vtx_col_idx + 1] = v1.color;
    this.colours[vtx_col_idx + 2] = v2.color;

    this.coords[vtx_uv_idx+ 0] = v0.u;
    this.coords[vtx_uv_idx+ 1] = v0.v;
    this.coords[vtx_uv_idx+ 2] = v1.u;
    this.coords[vtx_uv_idx+ 3] = v1.v;
    this.coords[vtx_uv_idx+ 4] = v2.u;
    this.coords[vtx_uv_idx+ 5] = v2.v;
  }
}
