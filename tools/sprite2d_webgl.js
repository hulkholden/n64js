import { executeDisplayList } from '../src/hle/graphics/display_list.js';
import { RDPGraphics } from '../src/hle/graphics/rdp_graphics.js';
import { Sprite2D } from '../src/hle/graphics/microcodes/sprite2d.js';
import { RDPBuffer } from '../src/lle/rdp.js';
import { sprite2DCases, writeSprite2DFixture } from './sprite2d_cases.js';
import { createWebGLHarness } from './webgl_test_helpers.js';

export function runSprite2DTests(gl) {
  const lines = [];
  gl.canvas.width = gl.canvas.height = 64;
  for (const { options, packets } of sprite2DCases) {
    const images = [];
    for (const reference of [false, true]) {
      const h = createWebGLHarness(gl, { width: 64, height: 64, ramBytes: 0x40000, pc: 0x200, Microcode: Sprite2D });
      h.renderer.nativeTransform.initDimensions(64, 64);
      writeSprite2DFixture(h.ram, options);
      const saved = globalThis.n64js;
      try {
        globalThis.n64js = { hardware: () => ({ cachedMemDevice: { u8: h.u8 }, timeline: { addEvent() {} } }) };
        h.resetFrame([0, 0, 0, 0]);
        if (reference) {
          const rdp = new RDPGraphics(h.state, h.ram, h.renderer);
          for (const packet of packets) {
            const dv = new DataView(new ArrayBuffer(packet.length * 4));
            packet.forEach((word, i) => dv.setUint32(i * 4, word));
            rdp.execute(packet[0] >>> 24 & 63, new RDPBuffer(dv, 0, dv.byteLength));
          }
        } else {
          executeDisplayList(h.state, h.microcode);
        }
        const pixels = new Uint8Array(64 * 64 * 4);
        gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        images.push(pixels);
      } finally {
        globalThis.n64js = saved;
        h.renderer.reset();
      }
    }
    const [actual, expected] = images;
    const label = `Sprite2D captured RSP pixels ${JSON.stringify(options)}`;
    if (!expected.some(v => v !== 0) || actual.some((v, i) => v !== expected[i])) {
      throw new Error(`${label}: framebuffer differs or reference is empty`);
    }
    lines.push(label);
  }
  return lines;
}
