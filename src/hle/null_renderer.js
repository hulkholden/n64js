import { RendererBase } from './renderer_base.js';

/**
 * Supplies the renderer operations used by microcode handlers without WebGL.
 * Drawing and clears are discarded; no textures or framebuffer are produced.
 * Callers set VI dimensions through nativeTransform.initDimensions().
 */
export class NullRenderer extends RendererBase {
  reset() {}
  newFrame() {}
  debugClear() {}

  clearDepth() {}
  clearColor() {}
  fillRect() {}
  texRect(tileIdx) { this.observeTextureUse(tileIdx); }
  texRectRot(tileIdx) { this.observeTextureUse(tileIdx); }
  lleRect(tileIdx) { this.observeTextureUse(tileIdx); }

  flushTris(buffer) {
    if (!buffer.empty() && this.state.geometryMode.texture) {
      this.observeTextureUse(this.state.texture.tile);
    }
    buffer.reset();
  }
}
