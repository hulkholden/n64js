export class Texture {
  constructor(gl, left, top, width, height) {
    this.left = left;
    this.top = top;
    this.width = width;
    this.height = height;

    var nativeWidth = nextPow2(width);
    var nativeHeight = nextPow2(height);

    this.nativeWidth = nativeWidth;
    this.nativeHeight = nativeHeight;

    // Create a canvas element to poke data into.
    this.$canvas = $('<canvas width="' + nativeWidth +
                     '" height="' + nativeHeight + '" />',
                     { 'width': nativeWidth, 'height': nativeHeight });
    this.texture = gl.createTexture();
  }

  /**
   * Creates a canvas with a scaled copy of the texture.
   * @param {number} scale
   * @return {!jQuery}
   */
  createScaledCanvas(scale) {
    var w = this.width * scale;
    var h = this.height * scale;
    var $canvas = $('<canvas width="' + w +
                    '" height="' + h +
                    '" style="background-color: black" />',
                    { 'width': w, 'height': h });
    var srcCtx = this.$canvas[0].getContext('2d');
    var dstCtx = $canvas[0].getContext('2d');

    var srcImgData = srcCtx.getImageData(0, 0, this.width, this.height);
    var dstImgData = dstCtx.createImageData(w, h);

    var src = srcImgData.data;
    var dst = dstImgData.data;
    var srcRowStride = srcImgData.width * 4;
    var dstRowStride = dstImgData.width * 4;

    for (let y = 0; y < h; ++y) {
      var srcOffset = srcRowStride * Math.floor(y / scale);
      var dstOffset = dstRowStride * y;

      for (let x = 0; x < w; ++x) {
        var o = srcOffset + Math.floor(x / scale) * 4;
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

export function clampTexture(imgData, width, height) {
  let dst = imgData.data;
  // Might not be the same as width, due to power of 2.
  let dstRowStride = imgData.width * 4;

  let y = 0;
  if (width < imgData.width) {
    let dstRowOffset = 0;
    for (; y < height; ++y) {
      let dstOffset = dstRowOffset + ((width - 1) * 4);

      let r = dst[dstOffset + 0];
      let g = dst[dstOffset + 1];
      let b = dst[dstOffset + 2];
      let a = dst[dstOffset + 3];

      dstOffset += 4;

      for (let x = width; x < imgData.width; ++x) {
        dst[dstOffset + 0] = r;
        dst[dstOffset + 1] = g;
        dst[dstOffset + 2] = b;
        dst[dstOffset + 3] = a;
        dstOffset += 4;
      }
      dstRowOffset += dstRowStride;
    }
  }

  if (height < imgData.height) {
    // Repeat the final line
    let dstRowOffset = dstRowStride * height;
    let lastRowOffset = dstRowOffset - dstRowStride;

    for (; y < imgData.height; ++y) {
      for (let i = 0; i < dstRowStride; ++i) {
        dst[dstRowOffset + i] = dst[lastRowOffset + i];
      }
      dstRowOffset += dstRowStride;
    }
  }
}

function nextPow2(x) {
  var y = 1;
  while (y < x) {
    y *= 2;
  }

  return y;
}
