import { ImageFormat, ImageSize } from './gbi.js';

// Color images must remain separate when a display list renders an image and
// then samples it through TMEM. All targets use the renderer's existing VI-space
// transform and backing resolution; readback maps those pixels back to RDRAM.
export class RenderTargets {
  constructor(gl, width, height) {
    this.gl = gl;
    this.width = width;
    this.height = height;
    this.targets = new Map();
    this.frozenTargets = null;
    this.frozenCopies = new Set();
    this.depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    this.fallback = this.createTarget();
    this.current = this.fallback;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  createTarget() {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.width, this.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const framebuffer = gl.createFramebuffer();
    framebuffer.width = this.width;
    framebuffer.height = this.height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depth);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return { framebuffer, texture, image: null, height: 0, dirty: false };
  }

  deleteTarget(target) {
    this.preserveForVI(target);
    this.gl.deleteFramebuffer(target.framebuffer);
    this.gl.deleteTexture(target.texture);
  }

  reset() {
    this.setDPFrozen(false);
    for (const target of this.targets.values()) this.deleteTarget(target);
    this.targets.clear();
    this.current = this.fallback;
  }

  setDPFrozen(frozen) {
    if (frozen) {
      if (this.frozenTargets) return;
      // HLE still consumes SP work while DP is frozen. Preserve the images VI
      // could scan out, copying their pixels only if later HLE work writes them.
      this.frozenTargets = new Map([...this.targets.values(), this.fallback].map(target => [target, { ...target }]));
    } else {
      this.frozenTargets = null;
      for (const copy of this.frozenCopies) this.deleteTarget(copy);
      this.frozenCopies.clear();
    }
  }

  // Frozen VI snapshots initially share the live targets' textures. Before a
  // target is drawn into or deleted, copy its pixels once and redirect only
  // the snapshot to that copy. VI can keep displaying the pre-freeze image
  // while HLE renders ahead; unfreezing releases the copy and exposes live pixels.
  preserveForVI(target) {
    const snapshot = this.frozenTargets?.get(target);
    if (!snapshot || snapshot.texture !== target.texture) return;

    const gl = this.gl;
    const read = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
    const draw = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
    const scissor = gl.isEnabled(gl.SCISSOR_TEST);

    const copy = this.createTarget();
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target.framebuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, copy.framebuffer);

    // A previous primitive's scissor must not crop the preserved image.
    gl.disable(gl.SCISSOR_TEST);
    gl.blitFramebuffer(0, 0, this.width, this.height, 0, 0, this.width, this.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);

    if (scissor) gl.enable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, read);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, draw);

    snapshot.texture = copy.texture;
    snapshot.framebuffer = copy.framebuffer;
    this.frozenCopies.add(copy);
  }

  bindCurrent() {
    this.preserveForVI(this.current);
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.current.framebuffer);
  }

  bindColorImage(image, nativeWidth, nativeHeight) {
    if (image.format !== ImageFormat.G_IM_FMT_RGBA ||
      (image.size !== ImageSize.G_IM_SIZ_16b && image.size !== ImageSize.G_IM_SIZ_32b) ||
      nativeWidth <= 0 || nativeHeight <= 0) {
      this.current = this.fallback;
    } else {
      const key = image.address;
      let target = this.targets.get(key);
      if (target && (target.image.width !== image.width || target.image.size !== image.size ||
        target.nativeWidth !== nativeWidth || target.nativeHeight !== nativeHeight)) {
        this.deleteTarget(target);
        this.targets.delete(key);
        target = null;
      }
      if (!target) {
        target = this.createTarget();
        target.image = { ...image };
        target.nativeWidth = nativeWidth;
        target.nativeHeight = nativeHeight;
      }
      // Bound GPU memory even when games recycle RDRAM for many color images.
      this.targets.delete(key);
      this.targets.set(key, target);
      while (this.targets.size > 8) {
        const oldest = this.targets.keys().next().value;
        this.deleteTarget(this.targets.get(oldest));
        this.targets.delete(oldest);
      }
      this.current = target;
    }
    this.bindCurrent();
  }

  markDirty(scissor, maxY = scissor.y1) {
    const target = this.current;
    if (!target.image) return;
    // Scissor is only a limit, not the allocation height. Vigilante 8 copies a
    // 320x40 strip with a 640x480 scissor still active; reading back 480 rows
    // would overwrite the unrelated textures immediately after that strip.
    // Unknown projected bounds must not permanently poison the target height
    // with NaN, making both VI lookup and texture readback miss this image.
    // Conservatively cover the scissor, still capped by the native height.
    if (!Number.isFinite(maxY)) maxY = scissor.y1;
    target.height = Math.max(target.height, Math.min(Math.ceil(maxY), Math.ceil(scissor.y1), target.nativeHeight));
    target.dirty = true;
  }

  contains(target, address) {
    if (!target.image) return false;
    const bytesPerPixel = target.image.size === ImageSize.G_IM_SIZ_32b ? 4 : 2;
    return address >= target.image.address && address < target.image.address + target.image.width * target.height * bytesPerPixel;
  }

  findTarget(address, candidates = this.targets.values()) {
    // RDRAM is reused when the video mode changes. Prefer the most recently
    // selected image when an old, larger framebuffer overlaps a newer one.
    const targets = Array.from(candidates);
    for (let i = targets.length - 1; i >= 0; i--) {
      if (this.contains(targets[i], address)) return targets[i];
    }
    return null;
  }

  textureForVI(address) {
    if (this.frozenTargets) {
      return (this.findTarget(address, this.frozenTargets.values()) ??
        this.frozenTargets.get(this.current) ?? this.frozenTargets.get(this.fallback)).texture;
    }
    return (this.findTarget(address) ?? this.current).texture;
  }

  syncToRAM(address, ramDV) {
    const gl = this.gl;
    const target = this.findTarget(address);
    if (!target?.dirty) return;
    const width = Math.min(target.image.width, target.nativeWidth);
    const height = target.height;
    const scaleX = this.width / target.nativeWidth;
    const scaleY = this.height / target.nativeHeight;
    const readWidth = Math.min(this.width, Math.ceil(width * scaleX));
    const readHeight = Math.min(this.height, Math.ceil(height * scaleY));
    const pixels = new Uint8Array(readWidth * readHeight * 4);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target.framebuffer);
    try {
      gl.readPixels(0, this.height - readHeight, readWidth, readHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      writeFramebufferToRAM(ramDV, target.image, width, height, pixels, readWidth, readHeight, scaleX, scaleY);
      target.dirty = false;
    } finally {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.current.framebuffer);
    }
  }
}

// Sample pixel centers and flip WebGL's bottom-up rows into N64's top-down order.
function readbackRow(y, readHeight, scaleY) {
  return readHeight - 1 - Math.min(readHeight - 1, Math.floor((y + 0.5) * scaleY));
}

// Return the byte offset of the nearest RGBA8 source pixel in this row.
function readbackPixelOffset(x, row, readWidth, scaleX) {
  const column = Math.min(readWidth - 1, Math.floor((x + 0.5) * scaleX));
  return (row * readWidth + column) * 4;
}

// WebGL readback is bottom-up RGBA8; N64 color images are top-down, big-endian.
export function writeFramebufferToRAM(ramDV, image, width, height, pixels, readWidth, readHeight, scaleX, scaleY) {
  // Select the format once so the pixel loops use fixed strides and writes.
  if (image.size === ImageSize.G_IM_SIZ_32b) {
    for (let y = 0; y < height; y++) {
      const row = readbackRow(y, readHeight, scaleY);
      for (let x = 0; x < width; x++) {
        const src = readbackPixelOffset(x, row, readWidth, scaleX);
        const dst = image.address + (y * image.width + x) * 4;
        if (dst < 0 || dst + 4 > ramDV.byteLength) continue;
        const r = pixels[src], g = pixels[src + 1], b = pixels[src + 2], a = pixels[src + 3];
        ramDV.setUint32(dst, (r << 24) | (g << 16) | (b << 8) | a);
      }
    }
  } else {
    for (let y = 0; y < height; y++) {
      const row = readbackRow(y, readHeight, scaleY);
      for (let x = 0; x < width; x++) {
        const src = readbackPixelOffset(x, row, readWidth, scaleX);
        const dst = image.address + (y * image.width + x) * 2;
        if (dst < 0 || dst + 2 > ramDV.byteLength) continue;
        const r = pixels[src], g = pixels[src + 1], b = pixels[src + 2], a = pixels[src + 3];
        ramDV.setUint16(dst, ((r >>> 3) << 11) | ((g >>> 3) << 6) | ((b >>> 3) << 1) | (a >>> 7));
      }
    }
  }
}
