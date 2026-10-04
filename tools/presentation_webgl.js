import { VIRegDevice } from '../src/devices/vi.js';
import { MemoryRegion } from '../src/memory/memory_region.js';
import { OS_TV_NTSC } from '../src/system_constants.js';
import { CRTMode, graphicsOptions } from '../src/hle/graphics_options.js';
import { ImageFormat, ImageSize } from '../src/hle/gbi.js';
import { assertPixels, createWebGLHarness, RED, BLUE } from './webgl_test_helpers.js';

export function runPresentationTests(gl) {
  const canvas = gl.canvas;
  const oldWidth = canvas.width, oldHeight = canvas.height;
  const oldCRT = graphicsOptions.crtMode;
  const lines = [];
  const { renderer } = createWebGLHarness(gl, { width: 2, height: 2 });
  const targets = renderer.renderTargets;
  try {
    graphicsOptions.crtMode = CRTMode.Off;
    canvas.width = 640;
    canvas.height = 480;
    const base = 0xa4400000;
    const ram = new MemoryRegion(new ArrayBuffer(8 * 1024 * 1024));
    const vi = new VIRegDevice({
      rominfo: { tvType: OS_TV_NTSC },
      vi_reg: new MemoryRegion(new ArrayBuffer(0x38)),
      cachedMemDevice: { mem: ram },
    }, base, base + 0x38);
    for (let i = 0; i < ram.u8.length; i++) {
      ram.u8[i] = (i * 37) & 255;
    }
    vi.write32(base + 4, 0x100);
    vi.write32(base + 8, 640);
    vi.write32(base + 0x24, (vi.hScanMin << 16) | (vi.hScanMin + 40));
    vi.write32(base + 0x28, ((vi.vScanMin + 2) << 16) | (vi.vScanMin + 18));
    for (const bitDepth of [16, 32]) {
      vi.write32(base, bitDepth === 16 ? 2 : 3);
      for (const [screenWidth, xScale, yScale] of [[40, 0x200, 0x400], [40, 0x400, 0x800], [40, 0x301, 0x5ab], [640, 0x200, 0x400], [640, 0x301, 0x5ab], [640, 0xfff, 0xfff]]) {
        vi.write32(base + 0x24, (vi.hScanMin << 16) | (vi.hScanMin + screenWidth));
        // Clear the old expanded buffer so borders from the previous mode do not linger.
        vi.interlacedFramebuffer16.pixels.fill(0);
        vi.interlacedFramebuffer32.pixels.fill(0);
        vi.write32(base + 0x30, xScale | (0x180 << 16));
        vi.write32(base + 0x34, yScale | (0x280 << 16));
        const expanded = vi.renderInterlacedBackBuffer();
        renderer.copyPixelsToFrontBuffer(expanded);
        const expected = new Uint8Array(640 * 480 * 4);
        gl.readPixels(0, 0, 640, 480, gl.RGBA, gl.UNSIGNED_BYTE, expected);
        const frame = vi.renderProgressiveBackBuffer();
        renderer.copyPixelsToFrontBuffer(frame);
        const actual = new Uint8Array(expected.length);
        gl.readPixels(0, 0, 640, 480, gl.RGBA, gl.UNSIGNED_BYTE, actual);
        const mismatch = actual.findIndex((v, i) => v !== expected[i]);
        if (mismatch !== -1 || gl.getError() !== gl.NO_ERROR) {
          throw new Error(`Native ${bitDepth}-bit VI ${xScale}/${yScale}: byte ${mismatch}: ${actual[mismatch]} != ${expected[mismatch]}`);
        }
        lines.push(`PASS native ${bitDepth}-bit VI ${xScale}/${yScale} matches expanded scanout`);
        for (const crt of [CRTMode.Simple, CRTMode.Mattias]) {
          graphicsOptions.crtMode = crt;
          renderer.copyPixelsToFrontBuffer(frame);
          if (gl.getError() !== gl.NO_ERROR) {
            throw new Error(`Native VI CRT mode ${crt} failed`);
          }
        }
        graphicsOptions.crtMode = CRTMode.Off;
      }
    }
    targets.bindColorImage({ address: 0, width: 2, size: ImageSize.G_IM_SIZ_16b, format: ImageFormat.G_IM_FMT_RGBA }, 2, 2);
    gl.clearColor(1, 0, 0, 1);
    gl.depthMask(true);
    gl.clearDepth(0.25);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    targets.markDirty({ y1: 2 });
    targets.setDPFrozen(true);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, 0, 1, 1);
    targets.resize(4, 4);
    if (!gl.isEnabled(gl.SCISSOR_TEST) || gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('Resize did not restore scissor or produce a complete framebuffer');
    }
    gl.disable(gl.SCISSOR_TEST);
    assertPixels(gl, { x: 3, y: 3, expected: RED, label: 'resize preserves pixels outside scissor' });
    gl.clearColor(0, 0, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    renderer.copyBackBufferToFrontBuffer(0);
    assertPixels(gl, { expected: RED, label: 'frozen VI preserves native pixels across resize' });
    targets.setDPFrozen(false);
    renderer.copyBackBufferToFrontBuffer(0);
    assertPixels(gl, { expected: BLUE, label: 'unfreeze displays resized image and resets CPU VI mapping' });
    targets.resize(2, 2);
    assertPixels(gl, { expected: BLUE, label: 'return to native resolution preserves pixels' });
    lines.push('PASS GPU resize, frozen VI snapshots, scissor restoration and CPU/GPU presentation switching');
    return lines;
  } finally {
    graphicsOptions.crtMode = oldCRT;
    canvas.width = oldWidth;
    canvas.height = oldHeight;
    targets.reset();
    targets.deleteTarget(targets.fallback);
    gl.deleteRenderbuffer(targets.depth);
  }
}
