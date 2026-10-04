import { GBI2SDEX } from '../src/hle/gbi_s2dex.js';
import { bg1cycCase, bg1cycCases } from './s2dex_bg_1cyc_cases.js';
import { assertFramebufferGrid, createWebGLHarness, withMockMemory } from './webgl_test_helpers.js';

export function runBg1cycTests(gl) {
  const lines = [];
  for (const [name, options] of bg1cycCases) {
    for (const scale of [1, 2]) {
      // Also test an upscale: native sampling must be independent of the
      // framebuffer resolution, including reversed texture derivatives.
      const width = 600 * scale, height = 80 * scale;
      gl.canvas.width = width;
      gl.canvas.height = height;
      const fixture = bg1cycCase(options);
      withMockMemory(fixture.ram, () => {
        const { state, renderer, microcode, resetFrame } = createWebGLHarness(gl, {
          width, height, ram: fixture.dv, Microcode: GBI2SDEX,
        });
        fixture.init(state);
        renderer.nativeTransform.initDimensions(600, 80);
        resetFrame([0, 0, 0, 0]);
        microcode.s2dex.executeBg1cyc(0x09000000, 0x01000080);
        lines.push(assertFramebufferGrid(gl, {
          width, height, scale,
          expectedAt: (x, y) => fixture.expected(x, y),
          label: `S2DEX 1-cycle ${name}, ${scale}x`,
        }));
        renderer.reset();
      });
    }
  }
  return lines;
}
