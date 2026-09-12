import { DepthSource } from './gbi.js';
import { NativeTransform } from './native_transform.js';

/**
 * Supplies the renderer operations used by microcode handlers without WebGL.
 * Drawing and clears are discarded; no textures or framebuffer are produced.
 * Callers set VI dimensions through nativeTransform.initDimensions().
 */
export class NullRenderer {
  constructor(state) {
    this.state = state;
    this.nativeTransform = new NativeTransform();
  }

  reset() {}
  newFrame() {}
  debugClear() {}

  clearDepth() {}
  clearColor() {}
  fillRect() {}
  texRect() {}
  texRectRot() {}
  lleRect() {}

  flushTris(buffer) {
    buffer.reset();
  }

  calculateRectVertices(x0, y0, x1, y1) {
    const depthSourcePrim = (this.state.rdpOtherModeL & DepthSource.G_ZS_PRIM) !== 0;
    const depth = depthSourcePrim ? this.state.primDepth : 0.0;
    return this.nativeTransform.calculateRectVertices(x0, y0, x1, y1, depth);
  }
}
