// Bottom-up RGBA pixels ready for a texture upload. Buffer dimensions describe
// storage; the destination rectangle and source sampling are supplied per copy.
class Framebuffer {
  constructor(width = 0, height = 0) {
    this.resize(width, height);
  }

  resize(width, height) {
    if (this.width === width && this.height === height) {
      return;
    }
    this.width = width;
    this.height = height;
    this.pixels = this.allocatePixels(width * height);
  }

  // Source x/y and steps are in pixels (possibly fractional), and pitch is in
  // pixels. Destination x/y are top-down screen coordinates. skipRowParity
  // preserves one interlaced field; null writes every row. N64 fetches wrap at
  // 24 bits and unpopulated RAM reads as black, independently of buffer size.
  readN64Pixels(ramDV, address, source, destination = { x: 0, y: 0, width: this.width, height: this.height }, skipRowParity = null) {
    this.copyPixels(ramDV, address, source, destination, skipRowParity);
    return this.pixels;
  }
}

export class Framebuffer32 extends Framebuffer {
  allocatePixels(count) {
    return new Uint8Array(count * 4);
  }

  copyPixels(ramDV, address, { pitch, x = 0, y = 0, stepX = 1, stepY = 1 }, rect, skipRowParity) {
    const pixels = this.pixels;
    const lastRead = ramDV.byteLength - 4;
    for (let row = 0; row < rect.height; row++) {
      if (((rect.y + row) & 1) === skipRowParity) {
        continue;
      }
      const srcRow = address + Math.floor(y + row * stepY) * pitch * 4;
      let dst = ((this.height - 1 - rect.y - row) * this.width + rect.x) * 4;
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
}

export class Framebuffer16 extends Framebuffer {
  allocatePixels(count) {
    return new Uint16Array(count);
  }

  copyPixels(ramDV, address, { pitch, x = 0, y = 0, stepX = 1, stepY = 1 }, rect, skipRowParity) {
    const pixels = this.pixels;
    const lastRead = ramDV.byteLength - 2;
    for (let row = 0; row < rect.height; row++) {
      if (((rect.y + row) & 1) === skipRowParity) {
        continue;
      }
      const srcRow = address + Math.floor(y + row * stepY) * pitch * 2;
      let dst = (this.height - 1 - rect.y - row) * this.width + rect.x;
      for (let column = 0; column < rect.width; column++, dst++) {
        const src = (srcRow + Math.floor(x + column * stepX) * 2) & 0x00fffffe;
        pixels[dst] = (src <= lastRead ? ramDV.getUint16(src, false) : 0) | 1;
      }
    }
  }
}
