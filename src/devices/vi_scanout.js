// VI geometry and sampling, independent of pixel storage or conversion.
export class VIScanout {
  constructor(displayWidth, displayHeight) {
    this.displayWidth = displayWidth;
    this.displayHeight = displayHeight;
    this.displayRect = { x: 0, y: 0, width: displayWidth, height: displayHeight };
    // Source coordinates and steps are measured in framebuffer pixels. VI's
    // binary fractions are exactly representable, so flooring matches fetches.
    this.source = { pitch: 0, x: 0, y: 0, stepX: 0, stepY: 0 };
    // HLE's VI-space extent retains the existing high-resolution height heuristic.
    // It is distinct from the texture extent needed for CPU scanout below.
    this.renderWidth = 0;
    this.renderHeight = 0;
  }

  get visible() {
    return this.displayRect.width > 0 && this.displayRect.height > 0 && this.source.stepX > 0 && this.source.stepY > 0;
  }

  get nativeWidth() {
    return Math.ceil(this.source.x + this.displayRect.width * this.source.stepX);
  }

  get nativeHeight() {
    return Math.ceil(this.source.y + this.displayRect.height * this.source.stepY);
  }

  nativePresentation() {
    const { displayWidth, displayHeight, displayRect: rect, source } = this;
    const width = this.nativeWidth, height = this.nativeHeight;
    // Map output pixel centres to VI fetch positions. Textures are bottom-up.
    const xOffset = source.x - (rect.x + 0.5) * source.stepX;
    const yOffset = source.y - (rect.y + 0.5) * source.stepY;
    return {
      sourceHeight: displayHeight * source.stepY,
      uvTransform: [displayWidth * source.stepX / width, displayHeight * source.stepY / height,
        xOffset / width, 1 - (displayHeight * source.stepY + yOffset) / height],
      bounds: [rect.x / displayWidth, 1 - (rect.y + rect.height) / displayHeight,
        (rect.x + rect.width) / displayWidth, 1 - rect.y / displayHeight],
    };
  }
}
