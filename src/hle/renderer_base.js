import { CycleType, DepthSource } from './gbi.js';
import { NativeTransform } from './native_transform.js';

// Shared state and geometry, independent of the drawing implementation.
export class RendererBase {
  constructor(state, onTextureUse = null) {
    this.state = state;
    this.nativeTransform = new NativeTransform();
    this.onTextureUse = onTextureUse;
  }

  // Match the HLE renderer's texture selection, which currently does not check
  // whether the combiner references either texture or implement texture LOD.
  getTextureTileCount() {
    return this.state.getCycleType() === CycleType.G_CYC_2CYCLE ? 2 : 1;
  }

  observeTextureUse(tileIdx) {
    if (!this.onTextureUse) {
      return;
    }
    const count = this.getTextureTileCount();
    for (let slot = 0; slot < count; slot++) {
      const tile = this.state.tiles[(tileIdx + slot) & 7];
      // lookupTexture also skips tiles with no line stride.
      if (tile.line !== 0) {
        this.onTextureUse({ format: tile.format, size: tile.size });
      }
    }
  }

  calculateRectVertices(x0, y0, x1, y1) {
    const depthSourcePrim = (this.state.rdpOtherModeL & DepthSource.G_ZS_PRIM) !== 0;
    const depth = depthSourcePrim ? this.state.primDepth : 0.0;
    return this.nativeTransform.calculateRectVertices(x0, y0, x1, y1, depth);
  }
}
