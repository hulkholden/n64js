import { GBI2SDEX } from '../src/hle/gbi_s2dex.js';
import { bgCopyCase, bgCopyFormats } from './s2dex_bg_copy_cases.js';
import { assertFramebufferGrid, createWebGLHarness, withMockMemory } from './webgl_test_helpers.js';

export function runBgCopyTests(gl) {
  const lines = [];
  for (const [name, format, size] of bgCopyFormats) {
    for (const load of [0xfff4, 0x0033]) {
      for (const flip of [false, true]) {
        // Also test an upscale: native sampling must be independent of the
        // framebuffer resolution, including reversed texture derivatives.
        const scale = flip ? 2 : 1;
        const width = 128 * scale, height = 80 * scale;
        gl.canvas.width = width;
        gl.canvas.height = height;
        const fixture = bgCopyCase({ format, size, load, flip });
        withMockMemory(fixture.ram, () => {
          const { state, renderer, microcode, resetFrame } = createWebGLHarness(gl, {
            width, height, ram: fixture.dv, Microcode: GBI2SDEX,
          });
          fixture.init(state);
          renderer.nativeTransform.initDimensions(128, 80);
          resetFrame([0, 0, 0, 0]);
          microcode.s2dex.executeBgCopy(0x0a000000, 0x01000080);
          lines.push(assertFramebufferGrid(gl, {
            width, height, scale,
            expectedAt: (x, y) => fixture.expected(x, y),
            label: `S2DEX ${name}, load=${load.toString(16)}, flip=${flip}, ${scale}x`,
          }));
          renderer.reset();
        });
      }
    }
  }
  return lines;
}
