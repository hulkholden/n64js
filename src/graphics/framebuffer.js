// Bottom-up RGBA pixels ready for a texture upload. Buffer dimensions describe
// storage; the destination rectangle and source sampling are supplied per copy.
export class Framebuffer {
  constructor(width = 0, height = 0, bitDepth = 16) {
    this.resize(width, height, bitDepth);
  }

  resize(width, height, bitDepth) {
    if (this.width === width && this.height === height && this.bitDepth === bitDepth) {
      return;
    }
    this.width = width;
    this.height = height;
    this.bitDepth = bitDepth;
    this.pixels = bitDepth === 32 ? new Uint8Array(width * height * 4) : new Uint16Array(width * height);
  }

  // Source x/y and steps are in pixels (possibly fractional), and pitch is in
  // pixels. Destination x/y are top-down screen coordinates. skipRowParity
  // preserves one interlaced field; null writes every row. N64 fetches wrap at
  // 24 bits and unpopulated RAM reads as black, independently of buffer size.
  readN64Pixels(ramDV, address, source, destination = { x: 0, y: 0, width: this.width, height: this.height }, skipRowParity = null) {
    if (this.bitDepth === 32) {
      readRGBA32(ramDV, address, source, this, destination, skipRowParity);
    } else {
      readRGBA16(ramDV, address, source, this, destination, skipRowParity);
    }
    return this.pixels;
  }
}

function readRGBA32(ramDV, address, { pitch, x = 0, y = 0, stepX = 1, stepY = 1 }, output, rect, skipRowParity) {
  const pixels = output.pixels;
  const lastRead = ramDV.byteLength - 4;
  for (let row = 0; row < rect.height; row++) {
    if (((rect.y + row) & 1) === skipRowParity) {
      continue;
    }
    const srcRow = address + Math.floor(y + row * stepY) * pitch * 4;
    let dst = ((output.height - 1 - rect.y - row) * output.width + rect.x) * 4;
    for (let column = 0; column < rect.width; column++, dst += 4) {
      const src = (srcRow + Math.floor(x + column * stepX) * 4) & 0x00fffffc;
      const pixel = src <= lastRead ? ramDV.getUint32(src, false) : 0;
      pixels[dst] = pixel >>> 24;
      pixels[dst + 1] = pixel >>> 16;
      pixels[dst + 2] = pixel >>> 8;
      pixels[dst + 3] = 255;
    }
  }
}

function readRGBA16(ramDV, address, { pitch, x = 0, y = 0, stepX = 1, stepY = 1 }, output, rect, skipRowParity) {
  const pixels = output.pixels;
  const lastRead = ramDV.byteLength - 2;
  for (let row = 0; row < rect.height; row++) {
    if (((rect.y + row) & 1) === skipRowParity) {
      continue;
    }
    const srcRow = address + Math.floor(y + row * stepY) * pitch * 2;
    let dst = (output.height - 1 - rect.y - row) * output.width + rect.x;
    for (let column = 0; column < rect.width; column++, dst++) {
      const src = (srcRow + Math.floor(x + column * stepX) * 2) & 0x00fffffe;
      pixels[dst] = (src <= lastRead ? ramDV.getUint16(src, false) : 0) | 1;
    }
  }
}
