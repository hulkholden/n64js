import { GBI2SDEX } from '../src/hle/gbi_s2dex.js';
import { Renderer } from '../src/hle/renderer.js';
import { RSPState } from '../src/hle/rsp_state.js';
import { bgCopyCase, bgCopyFormats } from './s2dex_bg_copy_cases.js';

export function runBgCopyTests(gl) {
  const lines = [];
  const savedN64js = globalThis.n64js;
  try {
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
          globalThis.n64js = { hardware: () => ({ cachedMemDevice: { u8: fixture.ram } }) };
          const state = new RSPState();
          fixture.init(state);
          const renderer = new Renderer(gl, state, width, height);
          renderer.nativeTransform.initDimensions(128, 80);
          renderer.newFrame();
          gl.disable(gl.SCISSOR_TEST);
          gl.disable(gl.DITHER);
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
          const microcode = new GBI2SDEX(state, fixture.dv);
          microcode.renderer = renderer;
          microcode.s2dex.executeBgCopy(0x0a000000, 0x01000080);
          const pixels = new Uint8Array(width * height * 4);
          gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          const label = `S2DEX ${name}, load=${load.toString(16)}, flip=${flip}, ${scale}x`;
          const error = gl.getError();
          if (error !== gl.NO_ERROR) {
            throw new Error(`${label}: GL error ${error}`);
          }
          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              const expected = fixture.expected(Math.floor(x / scale), Math.floor(y / scale));
              const offset = ((height - 1 - y) * width + x) * 4;
              const actual = pixels.subarray(offset, offset + 4);
              if (actual.some((v, i) => v !== expected[i])) {
                throw new Error(`${label} at ${x},${y}: expected ${expected}, got ${Array.from(actual)}`);
              }
            }
          }
          renderer.reset();
          lines.push(`PASS ${label}`);
        }
      }
    }
  } finally {
    globalThis.n64js = savedN64js;
  }
  return lines;
}
