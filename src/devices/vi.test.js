import { describe, expect, test } from 'bun:test';
import '../headless/headless_env.js';
import { MemoryRegion } from '../memory/memory_region.js';
import { OS_TV_NTSC, OS_TV_PAL } from '../system_constants.js';

const { VIRegDevice } = await import('./vi.js');
const base = 0xa4400000;

function makeVI(bytes = 8 * 1024 * 1024, tvType = OS_TV_NTSC) {
  const ram = new MemoryRegion(new ArrayBuffer(bytes));
  const hardware = {
    rominfo: { tvType },
    vi_reg: new MemoryRegion(new ArrayBuffer(0x38)),
    cachedMemDevice: { mem: ram },
  };
  const vi = new VIRegDevice(hardware, base, base + 0x38);
  return { vi, ram };
}

// Three pixels across and two rows, after the existing horizontal guard band.
function setSmallFrame(vi, bitDepth, origin) {
  vi.write32(base, bitDepth === 16 ? 2 : 3);
  vi.write32(base + 0x04, origin);
  vi.write32(base + 0x08, 2);
  vi.write32(base + 0x24, (vi.hScanMin << 16) | (vi.hScanMin + 18));
  vi.write32(base + 0x28, (vi.vScanMin << 16) | (vi.vScanMin + 2));
  vi.write32(base + 0x30, 0x400);
  vi.write32(base + 0x34, 0x800);
}

function pixelAt(vi, pixels, bitDepth, x = 0, y = 0) {
  const scanout = vi.scanout;
  const offset = (scanout.displayHeight - 1 - scanout.displayRect.y - y) * scanout.displayWidth + scanout.displayRect.x + x;
  return bitDepth === 16 ? pixels[offset] : Array.from(pixels.subarray(offset * 4, offset * 4 + 4));
}

test('interlaced storage is allocated only when rendering and released on reset', () => {
  const { vi } = makeVI(4096);
  expect(vi.interlacedFramebuffer).toBeNull();
  expect(vi.renderInterlacedBackBuffer()).toBeNull();
  expect(vi.interlacedFramebuffer).toBeNull();
  setSmallFrame(vi, 16, 0x100);
  expect(vi.renderProgressiveBackBuffer()).not.toBeNull();
  expect(vi.interlacedFramebuffer).toBeNull();
  expect(vi.renderInterlacedBackBuffer()).not.toBeNull();
  expect(vi.interlacedFramebuffer).not.toBeNull();
  vi.reset();
  expect(vi.interlacedFramebuffer).toBeNull();
});

test('interlaced scanout retains field history only within the same pixel format', () => {
  const { vi, ram } = makeVI(4096);
  let previousBuffer = null;
  let previousBitDepth = 0;
  for (const bitDepth of [16, 16, 32, 32, 16]) {
    setSmallFrame(vi, bitDepth, 0x100);
    vi.write32(base, (bitDepth === 16 ? 2 : 3) | 0x40);
    const colour = bitDepth === 16 ? 0xf801 : [0x12, 0x34, 0x56, 255];
    for (const sourcePixel of [8, 10]) {
      if (bitDepth === 16) {
        ram.set16(0x100 + sourcePixel * 2, 0xf800);
      } else {
        ram.set32(0x100 + sourcePixel * 4, 0x12345600);
      }
    }
    vi.field = 0;
    const frame = vi.renderInterlacedBackBuffer();
    expect([frame.width, frame.height, frame.bitDepth]).toEqual([640, 480, bitDepth]);
    expect(frame.pixels).toBeInstanceOf(bitDepth === 32 ? Uint8Array : Uint16Array);
    expect(frame.pixels.byteLength).toBe(frame.width * frame.height * bitDepth / 8);
    const retained = bitDepth === previousBitDepth ? colour : (bitDepth === 16 ? 0 : [0, 0, 0, 0]);
    expect(pixelAt(vi, frame.pixels, bitDepth, 0, 0)).toEqual(retained);
    expect(pixelAt(vi, frame.pixels, bitDepth, 0, 1)).toEqual(colour);
    if (bitDepth === previousBitDepth) {
      expect(vi.interlacedFramebuffer).toBe(previousBuffer);
    }
    vi.field = 1;
    expect(pixelAt(vi, vi.renderInterlacedBackBuffer().pixels, bitDepth, 0, 0)).toEqual(colour);
    previousBuffer = vi.interlacedFramebuffer;
    previousBitDepth = bitDepth;
  }
});

test('progressive scanout switches pixel formats and reuses buffers within a format', () => {
  const { vi, ram } = makeVI(4096);
  let previousBuffer = null;
  let previousBitDepth = 0;
  for (const bitDepth of [16, 16, 32, 32, 16]) {
    setSmallFrame(vi, bitDepth, 0x100);
    if (bitDepth === 16) {
      ram.set16(0x110, 0xf800);
    } else {
      ram.set32(0x120, 0x12345600);
    }
    const frame = vi.renderProgressiveBackBuffer();
    expect(frame.bitDepth).toBe(bitDepth);
    expect(frame.pixels).toBeInstanceOf(bitDepth === 32 ? Uint8Array : Uint16Array);
    expect(frame.pixels.byteLength).toBe(frame.width * frame.height * bitDepth / 8);
    const offset = (frame.height - 1) * frame.width + 8;
    const actual = bitDepth === 16 ? frame.pixels[offset] : Array.from(frame.pixels.subarray(offset * 4, offset * 4 + 4));
    expect(actual).toEqual(bitDepth === 16 ? 0xf801 : [0x12, 0x34, 0x56, 255]);
    if (bitDepth === previousBitDepth) {
      expect(vi.progressiveFramebuffer).toBe(previousBuffer);
    }
    previousBuffer = vi.progressiveFramebuffer;
    previousBitDepth = bitDepth;
  }
});

for (const bitDepth of [16, 32]) {
  test(`${bitDepth}-bit PAL scanout reaches the bottom of the 576-line display`, () => {
    const { vi, ram } = makeVI(4096, OS_TV_PAL);
    expect([vi.scanout.displayWidth, vi.scanout.displayHeight]).toEqual([640, 576]);
    expect([vi.scanout.displayRect.width, vi.scanout.displayRect.height]).toEqual([640, 576]);
    setSmallFrame(vi, bitDepth, 0x100);
    vi.write32(base + 0x28, ((vi.vScanMin + 574) << 16) | vi.vScanMax);
    const address = 0x100 + 8 * bitDepth / 8;
    if (bitDepth === 16) {
      ram.set16(address, 0xf800);
    } else {
      ram.set32(address, 0xff000000);
    }
    const frame = vi.renderInterlacedBackBuffer();
    expect([frame.width, frame.height, frame.bitDepth]).toEqual([640, 576, bitDepth]);
    const pixels = frame.pixels;
    // The first active row is display row 574, i.e. row 1 in a bottom-up texture.
    const offset = 640 + 8;
    const actual = bitDepth === 16 ? pixels[offset] : Array.from(pixels.subarray(offset * 4, offset * 4 + 4));
    expect(actual).toEqual(bitDepth === 16 ? 0xf801 : [255, 0, 0, 255]);
    const bounds = vi.renderProgressiveBackBuffer().presentation.bounds;
    expect(bounds.slice(0, 3)).toEqual([8 / 640, 0, 11 / 640]);
    expect(bounds[3]).toBeCloseTo(2 / 576, 12);
  });

  describe(`${bitDepth}-bit VI framebuffer bounds`, () => {
    const bytesPerPixel = bitDepth / 8;
    const black = bitDepth === 16 ? 1 : [0, 0, 0, 255];
    const colour = bitDepth === 16 ? 0xf801 : [0x12, 0x34, 0x56, 255];
    const writePixel = (ram, address) => {
      if (bitDepth === 16) {
        ram.set16(address, 0xf800);
      } else {
        ram.set32(address, 0x12345678);
      }
    };

    for (const size of [4, 8]) {
      test(`preserves valid pixels and blacks out reads past ${size} MiB`, () => {
        const { vi, ram } = makeVI(size * 1024 * 1024);
        const end = ram.u8.length;
        setSmallFrame(vi, bitDepth, end - 10 * bytesPerPixel);
        writePixel(ram, end - 2 * bytesPerPixel);
        writePixel(ram, end - bytesPerPixel);
        // A missing RAM bank must not alias the first bank.
        writePixel(ram, 0);
        const pixels = vi.renderInterlacedBackBuffer().pixels;
        expect(pixelAt(vi, pixels, bitDepth, 0)).toEqual(colour);
        expect(pixelAt(vi, pixels, bitDepth, 1)).toEqual(colour);
        expect(pixelAt(vi, pixels, bitDepth, 2)).toEqual(black);
        expect(pixelAt(vi, pixels, bitDepth, 0, 1)).toEqual(black);
      });
    }

    test('replaces old pixels with black for an entirely unpopulated source', () => {
      const { vi, ram } = makeVI();
      setSmallFrame(vi, bitDepth, 0x1000);
      writePixel(ram, 0x1000 + 8 * bytesPerPixel);
      expect(pixelAt(vi, vi.renderInterlacedBackBuffer().pixels, bitDepth)).toEqual(colour);
      vi.write32(base + 4, 0x00fdaa80);
      expect(pixelAt(vi, vi.renderInterlacedBackBuffer().pixels, bitDepth)).toEqual(black);
      vi.write32(base + 4, 0x1000);
      expect(pixelAt(vi, vi.renderInterlacedBackBuffer().pixels, bitDepth)).toEqual(colour);
    });

    test('wraps pixel fetches at 16 MiB, including a fetch at address zero', () => {
      const { vi, ram } = makeVI();
      setSmallFrame(vi, bitDepth, 0x1000000 - 10 * bytesPerPixel);
      writePixel(ram, 0);
      const pixels = vi.renderInterlacedBackBuffer().pixels;
      expect(pixelAt(vi, pixels, bitDepth, 0)).toEqual(black);
      expect(pixelAt(vi, pixels, bitDepth, 1)).toEqual(black);
      expect(pixelAt(vi, pixels, bitDepth, 2)).toEqual(colour);
    });

    test('ignores high origin bits and aligns fetches to the pixel size', () => {
      const { vi, ram } = makeVI();
      setSmallFrame(vi, bitDepth, 0xab001000 | (bytesPerPixel - 1));
      writePixel(ram, 0x1000 + 8 * bytesPerPixel);
      expect(pixelAt(vi, vi.renderInterlacedBackBuffer().pixels, bitDepth)).toEqual(colour);
    });

    test('checks the DataView length, including an incomplete final pixel', () => {
      const { vi } = makeVI();
      // The underlying buffer is larger than the installed memory view.
      const buffer = new ArrayBuffer(128);
      const view = new DataView(buffer, 16, 10 * bytesPerPixel - 1);
      new Uint8Array(buffer).fill(0xff);
      vi.hardware.cachedMemDevice.mem.dataView = view;
      setSmallFrame(vi, bitDepth, bytesPerPixel);
      expect(pixelAt(vi, vi.renderInterlacedBackBuffer().pixels, bitDepth)).toEqual(black);
    });

    test('uses the 12-bit pitch with scaled and offset source coordinates', () => {
      const { vi, ram } = makeVI();
      setSmallFrame(vi, bitDepth, 0x1000);
      vi.write32(base + 0x08, 0xfffff002);
      vi.write32(base + 0x30, (0x400 << 16) | 0x800);
      vi.write32(base + 0x34, (0x800 << 16) | 0x800);
      // First source coordinate is (8*2 + 1, 1), pitch 2 pixels.
      writePixel(ram, 0x1000 + (17 + 2) * bytesPerPixel);
      expect(pixelAt(vi, vi.renderInterlacedBackBuffer().pixels, bitDepth)).toEqual(colour);
      expect(vi.scanout.source.pitch).toBe(2);
      vi.write32(base + 0x08, 0xffffffff);
      vi.write32(base + 0x30, 0x0fff0fff);
      vi.write32(base + 0x34, 0x0fff0fff);
      vi.write32(base + 0x04, 0x007ffffe);
      expect(() => vi.renderInterlacedBackBuffer()).not.toThrow();
    });

    test('only updates the active interlaced field for invalid reads', () => {
      const { vi } = makeVI();
      setSmallFrame(vi, bitDepth, 0x00fdaa80);
      vi.write32(base, (bitDepth === 16 ? 2 : 3) | 0x40);
      vi.renderInterlacedBackBuffer().pixels.fill(bitDepth === 16 ? 0xffff : 0xff);
      vi.field = 0;
      const pixels = vi.renderInterlacedBackBuffer().pixels;
      expect(pixelAt(vi, pixels, bitDepth, 0, 0)).toEqual(bitDepth === 16 ? 0xffff : [255, 255, 255, 255]);
      expect(pixelAt(vi, pixels, bitDepth, 0, 1)).toEqual(black);
      vi.field = 1;
      expect(pixelAt(vi, vi.renderInterlacedBackBuffer().pixels, bitDepth, 0, 0)).toEqual(black);
    });
  });
}

for (const [region, tvType, vStart, height, yScale] of [['USA', OS_TV_NTSC, 37, 474, 0x400], ['Australia', OS_TV_PAL, 55, 530, 0x37d]]) {
  test(`MLB ${region} startup VI state cannot throw outside RDRAM`, () => {
    const { vi } = makeVI(8 * 1024 * 1024, tvType);
    vi.write32(base, 0x311e);
    vi.write32(base + 0x04, 0x00fdaa80);
    vi.write32(base + 0x08, 320);
    vi.write32(base + 0x24, (vi.hScanMin << 16) | vi.hScanMax);
    vi.write32(base + 0x28, (vStart << 16) | (vStart + height));
    vi.write32(base + 0x30, 0x200);
    vi.write32(base + 0x34, yScale);
    const pixels = vi.renderInterlacedBackBuffer().pixels;
    expect(pixelAt(vi, pixels, 16)).toBe(1);
    expect(pixelAt(vi, pixels, 16, vi.scanout.displayRect.width - 1, 400)).toBe(1);
  });
}

for (const bitDepth of [16, 32]) {
  test(`native ${bitDepth}-bit progressive scanout preserves VI fetches, borders and subpixel offsets`, () => {
    const { vi, ram } = makeVI(4096);
    for (let i = 0; i < ram.u8.length; i++) {
      ram.u8[i] = (i * 37) & 255;
    }
    setSmallFrame(vi, bitDepth, 0x100);
    for (const [xScale, yScale] of [[0x200, 0x400], [0x400, 0x800], [0x301, 0x5ab]]) {
      vi.write32(base + 0x30, xScale | (0x180 << 16));
      vi.write32(base + 0x34, yScale | (0x280 << 16));
      // Test valid RAM, a partially populated source, and 24-bit wrapping.
      for (const origin of [0x100, 4096 - 8 * bitDepth / 8, 0x1000000 - 8 * bitDepth / 8]) {
        vi.write32(base + 4, origin);
        const frame = vi.renderProgressiveBackBuffer();
        const expanded = vi.renderInterlacedBackBuffer().pixels;
        const scanout = vi.scanout;
        expect(frame.width).toBeLessThan(32);
        expect(frame.height).toBeLessThan(8);
        for (let y = 0; y < scanout.displayRect.height; y++) {
          for (let x = 0; x < scanout.displayRect.width; x++) {
            const u = (scanout.displayRect.x + x + 0.5) / scanout.displayWidth;
            const v = 1 - (scanout.displayRect.y + y + 0.5) / scanout.displayHeight;
            const sx = Math.floor((u * frame.presentation.uvTransform[0] + frame.presentation.uvTransform[2]) * frame.width + 0.0001);
            const sy = frame.height - 1 - Math.floor((1 - (v * frame.presentation.uvTransform[1] + frame.presentation.uvTransform[3])) * frame.height + 0.0001);
            const offset = sy * frame.width + sx;
            const actual = bitDepth === 16 ? frame.pixels[offset] : Array.from(frame.pixels.subarray(offset * 4, offset * 4 + 4));
            expect(actual).toEqual(pixelAt(vi, expanded, bitDepth, x, y));
          }
        }
        expect(frame.presentation.bounds[0]).toBe(scanout.displayRect.x / scanout.displayWidth);
        expect(frame.presentation.bounds[3]).toBe(1 - scanout.displayRect.y / scanout.displayHeight);
      }
    }
    vi.write32(base + 0x30, 0);
    expect(vi.renderProgressiveBackBuffer()).toBeNull();
  });
}
