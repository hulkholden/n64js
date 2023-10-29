/*global $*/

export class Texture {
  constructor(gl, width, height) {
    this.width = width;
    this.height = height;

    // Create a canvas element to poke data into.
    this.$canvas = $(`<canvas width="${width}" height="${height}" />`,
                     { 'width': width, 'height': height });
    this.texture = gl.createTexture();
  }

  /**
   * Creates a canvas with a scaled copy of the texture.
   * @param {number} scale
   * @return {!jQuery}
   */
  createScaledCanvas(scale) {
    const w = this.width * scale;
    const h = this.height * scale;
    const $canvas = $('<canvas width="' + w +
                    '" height="' + h +
                    '" style="background-color: black" />',
                    { 'width': w, 'height': h });
    const srcCtx = this.$canvas[0].getContext('2d');
    const dstCtx = $canvas[0].getContext('2d');

    const srcImgData = srcCtx.getImageData(0, 0, this.width, this.height);
    const dstImgData = dstCtx.createImageData(w, h);

    const src = srcImgData.data;
    const dst = dstImgData.data;
    const srcRowStride = srcImgData.width * 4;
    const dstRowStride = dstImgData.width * 4;

    for (let y = 0; y < h; ++y) {
      const srcOffset = srcRowStride * Math.floor(y / scale);
      let dstOffset = dstRowStride * y;

      for (let x = 0; x < w; ++x) {
        const o = srcOffset + Math.floor(x / scale) * 4;
        dst[dstOffset + 0] = src[o + 0];
        dst[dstOffset + 1] = src[o + 1];
        dst[dstOffset + 2] = src[o + 2];
        dst[dstOffset + 3] = src[o + 3];
        dstOffset += 4;
      }
    }

    dstCtx.putImageData(dstImgData, 0, 0);
    return $canvas;
  }
}
