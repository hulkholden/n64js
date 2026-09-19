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
  const dims = vi.dims;
  const offset = (dims.screenHeight - 1 - dims.dy0 - y) * dims.screenWidth + dims.dx0 + x;
  return bitDepth === 16 ? pixels[offset] : Array.from(pixels.subarray(offset * 4, offset * 4 + 4));
}

for (const bitDepth of [16, 32]) {
  describe(`${bitDepth}-bit VI framebuffer bounds`, () => {
    const bytesPerPixel = bitDepth / 8;
    const black = bitDepth === 16 ? 1 : [0, 0, 0, 255];
    const colour = bitDepth === 16 ? 0xf801 : [0x12, 0x34, 0x56, 255];
    const writePixel = (ram, address) => {
      if (bitDepth === 16) ram.set16(address, 0xf800);
      else ram.set32(address, 0x12345678);
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
        const pixels = vi.renderBackBuffer();
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
      expect(pixelAt(vi, vi.renderBackBuffer(), bitDepth)).toEqual(colour);
      vi.write32(base + 4, 0x00fdaa80);
      expect(pixelAt(vi, vi.renderBackBuffer(), bitDepth)).toEqual(black);
      vi.write32(base + 4, 0x1000);
      expect(pixelAt(vi, vi.renderBackBuffer(), bitDepth)).toEqual(colour);
    });

    test('wraps pixel fetches at 16 MiB, including a fetch at address zero', () => {
      const { vi, ram } = makeVI();
      setSmallFrame(vi, bitDepth, 0x1000000 - 10 * bytesPerPixel);
      writePixel(ram, 0);
      const pixels = vi.renderBackBuffer();
      expect(pixelAt(vi, pixels, bitDepth, 0)).toEqual(black);
      expect(pixelAt(vi, pixels, bitDepth, 1)).toEqual(black);
      expect(pixelAt(vi, pixels, bitDepth, 2)).toEqual(colour);
    });

    test('ignores high origin bits and aligns fetches to the pixel size', () => {
      const { vi, ram } = makeVI();
      setSmallFrame(vi, bitDepth, 0xab001000 | (bytesPerPixel - 1));
      writePixel(ram, 0x1000 + 8 * bytesPerPixel);
      expect(pixelAt(vi, vi.renderBackBuffer(), bitDepth)).toEqual(colour);
    });

    test('checks the DataView length, including an incomplete final pixel', () => {
      const { vi } = makeVI();
      // The underlying buffer is larger than the installed memory view.
      const buffer = new ArrayBuffer(128);
      const view = new DataView(buffer, 16, 10 * bytesPerPixel - 1);
      new Uint8Array(buffer).fill(0xff);
      vi.hardware.cachedMemDevice.mem.dataView = view;
      setSmallFrame(vi, bitDepth, bytesPerPixel);
      expect(pixelAt(vi, vi.renderBackBuffer(), bitDepth)).toEqual(black);
    });

    test('uses the 12-bit pitch with scaled and offset source coordinates', () => {
      const { vi, ram } = makeVI();
      setSmallFrame(vi, bitDepth, 0x1000);
      vi.write32(base + 0x08, 0xfffff002);
      vi.write32(base + 0x30, (0x400 << 16) | 0x800);
      vi.write32(base + 0x34, (0x800 << 16) | 0x800);
      // First source coordinate is (8*2 + 1, 1), pitch 2 pixels.
      writePixel(ram, 0x1000 + (17 + 2) * bytesPerPixel);
      expect(pixelAt(vi, vi.renderBackBuffer(), bitDepth)).toEqual(colour);
      expect(vi.dims.srcPitch).toBe(2);
      vi.write32(base + 0x08, 0xffffffff);
      vi.write32(base + 0x30, 0x0fff0fff);
      vi.write32(base + 0x34, 0x0fff0fff);
      vi.write32(base + 0x04, 0x007ffffe);
      expect(() => vi.renderBackBuffer()).not.toThrow();
    });

    test('only updates the active interlaced field for invalid reads', () => {
      const { vi } = makeVI();
      setSmallFrame(vi, bitDepth, 0x00fdaa80);
      vi.write32(base, (bitDepth === 16 ? 2 : 3) | 0x40);
      vi.dims.pixels16bpp.fill(0xffff);
      vi.dims.pixels32bpp.fill(0xff);
      vi.field = 0;
      const pixels = vi.renderBackBuffer();
      expect(pixelAt(vi, pixels, bitDepth, 0, 0)).toEqual(bitDepth === 16 ? 0xffff : [255, 255, 255, 255]);
      expect(pixelAt(vi, pixels, bitDepth, 0, 1)).toEqual(black);
      vi.field = 1;
      expect(pixelAt(vi, vi.renderBackBuffer(), bitDepth, 0, 0)).toEqual(black);
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
    const pixels = vi.renderBackBuffer();
    expect(pixelAt(vi, pixels, 16)).toBe(1);
    expect(pixelAt(vi, pixels, 16, vi.dims.dstWidth - 1, 400)).toBe(1);
  });
}
