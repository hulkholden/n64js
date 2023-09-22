import { Vector4 } from '../graphics/Vector4.js';

export class ProjectedVertex {
  constructor() {
    this.pos = new Vector4();
    this.color = 0;
    this.u = 0;
    this.v = 0;
    this.clipFlags = 0;
    this.set = false;
  }

  calculateLinearUV(norm) {
    this.u = 0.5 * (1.0 + norm.x);
    this.v = 0.5 * (1.0 + norm.y);
  }

  calculateSphericalUV(norm) {
    this.u = Math.acos(norm.x) / Math.PI;
    this.v = Math.acos(norm.y) / Math.PI;
  }
}
