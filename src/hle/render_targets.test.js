import { describe, expect, test } from 'bun:test';
import { RenderTargets, writeFramebufferToRAM } from './render_targets.js';
import { ImageFormat, ImageSize } from './gbi.js';

function fakeGL() {
  const gl = {
    FRAMEBUFFER: 'framebuffer', READ_FRAMEBUFFER: 'read', DRAW_FRAMEBUFFER: 'draw',
    reads: [], deleted: [],
    createTexture: () => ({}), createFramebuffer: () => ({}), createRenderbuffer: () => ({}),
    bindTexture() {}, texParameteri() {}, texImage2D() {},
    bindRenderbuffer() {}, renderbufferStorage() {}, framebufferTexture2D() {}, framebufferRenderbuffer() {},
    deleteTexture: t => gl.deleted.push(t), deleteFramebuffer: f => gl.deleted.push(f),
    bindFramebuffer(which, buffer) {
      if (which === 'framebuffer' || which === 'read') gl.read = buffer;
      if (which === 'framebuffer' || which === 'draw') gl.draw = buffer;
    },
    readPixels(x, y, width, height, format, type, pixels) {
      gl.reads.push(gl.read);
      pixels.set(gl.read.pixels.subarray(0, pixels.length));
    },
  };
  return gl;
}

const colorImage = (address, width = 2, size = ImageSize.G_IM_SIZ_16b) => ({
  address, width, size, format: ImageFormat.G_IM_FMT_RGBA,
});

describe('rendered color images', () => {
  test('preserves separate targets, writes a sampled image once, and restores the drawing target', () => {
    const gl = fakeGL();
    const targets = new RenderTargets(gl, 2, 2);
    targets.bindColorImage(colorImage(0), 2, 2);
    const main = targets.current;
    targets.markDirty({ y1: 2 });
    targets.bindColorImage(colorImage(16), 2, 2);
    const offscreen = targets.current;
    expect(offscreen.framebuffer).not.toBe(main.framebuffer);
    // Bottom row: blue, white. Top row: red, green.
    offscreen.framebuffer.pixels = new Uint8Array([
      0, 0, 255, 255, 255, 255, 255, 255,
      255, 0, 0, 255, 0, 255, 0, 255,
    ]);
    targets.markDirty({ y1: 2 });
    targets.bindColorImage(colorImage(0), 2, 2);
    expect(targets.current).toBe(main);
    const ram = new DataView(new ArrayBuffer(32));
    targets.syncToRAM(18, ram);
    expect([16, 18, 20, 22].map(a => ram.getUint16(a))).toEqual([0xf801, 0x07c1, 0x003f, 0xffff]);
    expect(ram.getUint32(0)).toBe(0);
    expect(gl.draw).toBe(main.framebuffer);
    expect(gl.read).toBe(main.framebuffer);
    targets.syncToRAM(16, ram);
    expect(gl.reads).toEqual([offscreen.framebuffer]);
    expect(targets.textureForVI(2)).toBe(main.texture);
    // A later draw must invalidate the readback, even when reusing the target.
    targets.bindColorImage(colorImage(16), 2, 2);
    targets.markDirty({ y1: 2 });
    targets.syncToRAM(16, ram);
    expect(gl.reads).toHaveLength(2);
  });

  test('a newer framebuffer wins when a resolution change reuses an older image range', () => {
    const gl = fakeGL();
    const targets = new RenderTargets(gl, 4, 4);
    targets.bindColorImage(colorImage(0, 4), 4, 4);
    const old = targets.current;
    targets.markDirty({ y1: 4 });
    targets.bindColorImage(colorImage(16), 4, 4);
    const recent = targets.current;
    recent.framebuffer.pixels = new Uint8Array(16).fill(255);
    targets.markDirty({ y1: 2 });
    expect(targets.textureForVI(18)).toBe(recent.texture);
    targets.syncToRAM(18, new DataView(new ArrayBuffer(32)));
    expect(gl.reads).toEqual([recent.framebuffer]);
    expect(old.dirty).toBe(true);
    targets.syncToRAM(18, new DataView(new ArrayBuffer(32)));
    expect(gl.reads).toHaveLength(1);
  });

  test('a small copied strip does not overwrite the adjacent texture under a larger scissor', () => {
    const gl = fakeGL();
    const targets = new RenderTargets(gl, 640, 480);
    const image = colorImage(0x332cc0, 320);
    targets.bindColorImage(image, 640, 480);
    targets.current.framebuffer.pixels = new Uint8Array(320 * 40 * 4).fill(255);
    targets.markDirty({ y1: 480 }, 40);
    expect(targets.current.height).toBe(40);
    expect(targets.findTarget(0x33ae80)).toBeNull();
    const ram = new DataView(new ArrayBuffer(4 * 1024 * 1024));
    ram.setUint32(0x33ae80, 0x12345678);
    targets.syncToRAM(0x33ae80, ram);
    expect(gl.reads).toHaveLength(0);
    targets.syncToRAM(image.address, ram);
    expect(ram.getUint16(image.address + 320 * 40 * 2 - 2)).toBe(0xffff);
    expect(ram.getUint16(image.address + 320 * 40 * 2)).toBe(0);
    expect(ram.getUint32(0x33ae80)).toBe(0x12345678);
  });

  test('non-finite draw bounds cannot poison VI selection or framebuffer readback', () => {
    for (const maxY of [NaN, Infinity, -Infinity]) {
      const gl = fakeGL();
      const targets = new RenderTargets(gl, 4, 4);
      targets.bindColorImage(colorImage(64, 4), 4, 4);
      const displayed = targets.current;
      displayed.framebuffer.pixels = new Uint8Array(4 * 4 * 4).fill(255);
      targets.markDirty({ y1: 3 }, 1);
      targets.markDirty({ y1: 3 }, maxY);
      // A later valid draw must leave the target usable, including after a
      // switch to another framebuffer as in Mario's triple-buffer rotation.
      targets.markDirty({ y1: 3 }, 2);
      expect(displayed.height).toBe(3);
      targets.bindColorImage(colorImage(0, 4), 4, 4);
      targets.markDirty({ y1: 4 });
      expect(targets.textureForVI(72)).toBe(displayed.texture);
      const ram = new DataView(new ArrayBuffer(128));
      ram.setUint32(88, 0x12345678);
      targets.syncToRAM(72, ram);
      expect(gl.reads).toEqual([displayed.framebuffer]);
      expect(ram.getUint16(64)).toBe(0xffff);
      expect(ram.getUint16(86)).toBe(0xffff);
      expect(ram.getUint32(88)).toBe(0x12345678);
      expect(displayed.dirty).toBe(false);
      targets.bindColorImage(colorImage(64, 4), 4, 4);
      targets.markDirty({ y1: 480 }, maxY);
      expect(displayed.height).toBe(4);
    }
  });

  test('recreates images when their dimensions change, bounds the cache, and resets it', () => {
    const gl = fakeGL();
    const targets = new RenderTargets(gl, 2, 2);
    targets.bindColorImage(colorImage(0), 2, 2);
    const old = targets.current;
    targets.bindColorImage(colorImage(0, 1), 2, 2);
    expect(targets.current).not.toBe(old);
    expect(gl.deleted).toContain(old.texture);
    for (let i = 1; i <= 9; i++) targets.bindColorImage(colorImage(i * 16), 2, 2);
    expect(targets.targets.size).toBe(8);
    expect(targets.targets.has(0)).toBe(false);
    targets.reset();
    expect(targets.targets.size).toBe(0);
    expect(targets.current).toBe(targets.fallback);
  });

  test('maps scaled RGBA32 pixels to big-endian RDRAM with source pitch and bounds', () => {
    const pixels = new Uint8Array(4 * 4 * 4);
    pixels.set([1, 2, 3, 4], (2 * 4 + 1) * 4);
    pixels.set([5, 6, 7, 8], (2 * 4 + 3) * 4);
    pixels.set([9, 10, 11, 12], (0 * 4 + 1) * 4);
    pixels.set([13, 14, 15, 16], (0 * 4 + 3) * 4);
    const ram = new DataView(new ArrayBuffer(28));
    writeFramebufferToRAM(ram, colorImage(8, 3, ImageSize.G_IM_SIZ_32b), 2, 2, pixels, 4, 4, 2, 2);
    expect([8, 12, 16, 20, 24].map(a => ram.getUint32(a))).toEqual([
      0x01020304, 0x05060708, 0, 0x090a0b0c, 0x0d0e0f10,
    ]);
    expect(() => writeFramebufferToRAM(ram, colorImage(26), 2, 2, pixels, 4, 4, 2, 2)).not.toThrow();
  });
});
