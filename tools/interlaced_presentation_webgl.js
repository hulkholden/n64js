import { VIRegDevice } from '../src/devices/vi.js';
import { MemoryRegion } from '../src/memory/memory_region.js';
import { Framebuffer16, Framebuffer32 } from '../src/graphics/framebuffer.js';
import { OS_TV_NTSC, OS_TV_PAL } from '../src/system_constants.js';
import { CRTMode, graphicsOptions } from '../src/hle/graphics_options.js';
import { assertFramebufferGrid, createTestTexture, RED, BLUE } from './webgl_test_helpers.js';

// Compare shader field assembly with CPU VI sampling, including different
// origins, dimensions, mappings and borders in the two retained fields.
export function runInterlacedPresentationTests(gl, renderer) {
  const lines = [];
  const canvas = gl.canvas;
  const oldWidth = canvas.width, oldHeight = canvas.height;
  const oldCRT = graphicsOptions.crtMode;
  try {
    graphicsOptions.crtMode = CRTMode.Off;
    for (const tvType of [OS_TV_NTSC, OS_TV_PAL]) {
      for (const bitDepth of [16, 32]) {
        const base = 0xa4400000;
        const ram = new MemoryRegion(new ArrayBuffer(16384));
        const vi = new VIRegDevice({
          rominfo: { tvType }, vi_reg: new MemoryRegion(new ArrayBuffer(0x38)),
          cachedMemDevice: { mem: ram },
        }, base, base + 0x38);
        for (let i = 0; i < ram.u8.length; i++) {
          ram.u8[i] = (i * 37 + (i >> 8)) & 255;
        }
        vi.write32(base, (bitDepth === 16 ? 2 : 3) | 0x40);
        vi.write32(base + 8, 64);
        const FramebufferType = bitDepth === 32 ? Framebuffer32 : Framebuffer16;
        const expected = new FramebufferType(vi.screenWidth, vi.screenHeight);
        const expectedAt = (x, y) => {
          const offset = (expected.height - 1 - y) * expected.width + x;
          if (bitDepth === 32) {
            return [...expected.pixels.subarray(offset * 4, offset * 4 + 3), 255];
          }
          const pixel = expected.pixels[offset];
          return [11, 6, 1].map(shift => Math.round(((pixel >> shift) & 31) * 255 / 31)).concat(255);
        };
        const checkFrame = (frame, label) => {
          for (const scale of [1, 2]) {
            canvas.width = expected.width * scale;
            canvas.height = expected.height * scale;
            renderer.copyPixelsToFrontBuffer(frame);
            lines.push(assertFramebufferGrid(gl, {
              width: canvas.width, height: canvas.height, scale, expectedAt, tolerance: 1,
              label: `${bitDepth}-bit ${expected.height}-line ${label} at ${scale}x`,
            }));
          }
        };
        // First field alone, both fields, repeated parity, and an invalid RAM
        // source: each update replaces only its parity, even as mapping changes.
        for (const [index, field] of [0, 1, 1, 0].entries()) {
          vi.field = field;
          const origin = index === 3 ? 0x00fdaa80 : 0x100 + index * 0x400;
          vi.write32(base + 4, origin);
          const start = vi.hScanMin + index * 2;
          vi.write32(base + 0x24, (start << 16) | (start + 40 + index * 3));
          vi.write32(base + 0x28, ((vi.vScanMin + 2 + index) << 16) | (vi.vScanMin + 18));
          vi.write32(base + 0x30, (0x180 << 16) | [0x200, 0x301, 0x400, 0x200][index]);
          vi.write32(base + 0x34, (0x280 << 16) | [0x400, 0x5ab, 0x800, 0x400][index]);
          const frame = vi.renderBackBuffer();
          const scanout = vi.scanout;
          // New bounds replace the entire field, including borders that moved.
          for (let y = frame.field; y < expected.height; y += 2) {
            const offset = (expected.height - 1 - y) * expected.width * (bitDepth === 32 ? 4 : 1);
            expected.pixels.fill(0, offset, offset + expected.width * (bitDepth === 32 ? 4 : 1));
          }
          expected.readN64Pixels(ram.dataView, origin, scanout.source, scanout.displayRect, vi.field);
          checkFrame(frame, `field ${frame.field}, update ${index}`);
        }
        // Switching through progressive mode must discard both old fields,
        // even when the uploaded source dimensions and format do not change.
        vi.write32(base + 4, 0x100);
        vi.write32(base, bitDepth === 16 ? 2 : 3);
        renderer.copyPixelsToFrontBuffer(vi.renderBackBuffer());
        vi.write32(base, (bitDepth === 16 ? 2 : 3) | 0x40);
        expected.pixels.fill(0);
        let frame = vi.renderBackBuffer();
        expected.readN64Pixels(ram.dataView, vi.dramAddrReg, vi.scanout.source, vi.scanout.displayRect, vi.field);
        checkFrame(frame, 'progressive to interlaced transition');
        const textures = renderer.cpuFramebuffers.filter(Boolean).map(frame => frame.texture);
        renderer.reset();
        if (textures.some(texture => gl.isTexture(texture))) {
          throw new Error('Reset did not release CPU framebuffer textures');
        }
        vi.field ^= 1;
        vi.write32(base + 4, 0x500);
        frame = vi.renderBackBuffer();
        expected.pixels.fill(0);
        expected.readN64Pixels(ram.dataView, vi.dramAddrReg, vi.scanout.source, vi.scanout.displayRect, vi.field);
        checkFrame(frame, 'first field after reset');
      }
    }
    lines.push(...checkCRTFieldFiltering(gl, renderer));
    return lines;
  } finally {
    graphicsOptions.crtMode = oldCRT;
    canvas.width = oldWidth;
    canvas.height = oldHeight;
  }
}

function checkCRTFieldFiltering(gl, renderer) {
  const lines = [];
  const height = 480;
  const woven = createTestTexture(gl, 1, height, Array.from({ length: height }, (_, y) => ((height - 1 - y) & 1) ? BLUE : RED));
  const presentation = { viWidth: 640, viHeight: height, sourceHeight: height, uvTransform: [0, 0, 0.5, 0.5], bounds: [0, 0, 1, 1] };
  const frame = { width: 1, height: 1, bitDepth: 32, presentation };
  try {
    // Both textures have one source row; their temporal values remain distinct.
    renderer.copyPixelsToFrontBuffer({ ...frame, field: 0, pixels: new Uint8Array(RED) });
    renderer.copyPixelsToFrontBuffer({ ...frame, field: 1, pixels: new Uint8Array(BLUE) });
    for (const scale of [1, 1.5, 2]) {
      gl.canvas.width = 640 * scale;
      gl.canvas.height = height * scale;
      for (const mode of [CRTMode.Off, CRTMode.Simple, CRTMode.Mattias]) {
        graphicsOptions.crtMode = mode;
        // A woven reference tests selection after CRT curvature and each colour
        // tap, plus interpolation across the boundary between unlike fields.
        renderer.copyTextureToFrontBuffer(woven.texture, 0.5, { sourceHeight: height });
        const expected = new Uint8Array(48 * 48 * 4);
        const x = gl.canvas.width / 2 - 24, y = gl.canvas.height / 2 - 24;
        gl.readPixels(x, y, 48, 48, gl.RGBA, gl.UNSIGNED_BYTE, expected);
        if (mode === CRTMode.Off) {
          // At fractional scales some centres land exactly between VI rows.
          // Specify the tie explicitly instead of relying on host texture
          // filtering precision to choose one of the two temporal values.
          for (let row = 0; row < 48; row++) {
            const viRow = height - 1 - Math.floor((y + row + 0.5) / scale + 0.0001);
            for (let column = 0; column < 48; column++) {
              expected.set((viRow & 1) ? BLUE : RED, (row * 48 + column) * 4);
            }
          }
        }
        renderer.copyPixelsToFrontBuffer({ ...frame, field: 1, pixels: new Uint8Array(BLUE) }, 0.5);
        const actual = new Uint8Array(expected.length);
        gl.readPixels(x, y, 48, 48, gl.RGBA, gl.UNSIGNED_BYTE, actual);
        const mismatch = actual.findIndex((v, i) => Math.abs(v - expected[i]) > 2);
        if (mismatch !== -1 || gl.getError() !== gl.NO_ERROR) {
          throw new Error(`CRT ${mode} field filtering at ${scale}x: byte ${mismatch}: ${actual[mismatch]} != ${expected[mismatch]}`);
        }
        lines.push(`PASS CRT ${mode} field filtering at ${scale}x matches woven reference`);
      }
    }
  } finally {
    gl.deleteTexture(woven.texture);
  }
  return lines;
}
