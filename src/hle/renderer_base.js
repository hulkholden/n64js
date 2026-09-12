import { DepthSource } from './gbi.js';
import { NativeTransform } from './native_transform.js';

// Shared state and geometry, independent of the drawing implementation.
export class RendererBase {
  constructor(state) {
    this.state = state;
    this.nativeTransform = new NativeTransform();
  }

  calculateRectVertices(x0, y0, x1, y1) {
    const depthSourcePrim = (this.state.rdpOtherModeL & DepthSource.G_ZS_PRIM) !== 0;
    const depth = depthSourcePrim ? this.state.primDepth : 0.0;
    return this.nativeTransform.calculateRectVertices(x0, y0, x1, y1, depth);
  }
}
