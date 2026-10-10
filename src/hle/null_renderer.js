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

  // Observe submitted draws, including fill operations optimized into clears.
  // State-setting commands alone do not establish use of a mode.
  observeGraphicsMode() {
    if (this.onGraphicsMode) {
      this.onGraphicsMode({
        // SetOtherMode may retain the command opcode in the upper byte.
        otherModeH: this.state.rdpOtherModeH & 0x00ffffff,
        otherModeL: this.state.rdpOtherModeL >>> 0,
        combineHi: this.state.combine.hi >>> 0,
        combineLo: this.state.combine.lo >>> 0,
      });
    }
  }

  clearDepth() { this.observeGraphicsMode(); }
  clearColor() { this.observeGraphicsMode(); }
  fillRect() { this.observeGraphicsMode(); }
  texRect(tileIdx) { this.observeGraphicsMode(); this.observeTextureUse(tileIdx); }
  texRectRot(tileIdx) { this.observeGraphicsMode(); this.observeTextureUse(tileIdx); }
  lleRect(tileIdx) { this.observeGraphicsMode(); this.observeTextureUse(tileIdx); }

  flushTris(buffer, { lines = false } = {}) {
    if (!buffer.empty()) {
      this.observeGraphicsMode();
    }
    if (!lines && !buffer.empty() && this.state.geometryMode.texture) {
      this.observeTextureUse(this.state.texture.tile);
    }
    buffer.reset();
  }
}
