import * as gbi from '../src/hle/gbi.js';
import { RDPBuffer } from '../src/lle/rdp.js';
import { RDPGraphics } from '../src/hle/rdp_graphics.js';
import { trianglePacket } from './rdp_packet_fixtures.js';
import {
  BLUE,
  createWebGLHarness,
  GREEN,
  RED,
  WHITE,
  assertPixels,
} from './webgl_test_helpers.js';

export function runRDPTests(gl) {
  const lines = [];
  const { ram, state, renderer, resetFrame } = createWebGLHarness(gl, {
    width: 8,
    height: 8,
    ramBytes: 4096,
  });
  renderer.nativeTransform.initDimensions(8, 8);
  const processor = new RDPGraphics(state, ram, renderer);
  const execute = words => {
    const dv = new DataView(new ArrayBuffer(words.length * 4));
    words.forEach((word, i) => dv.setUint32(i * 4, word));
    processor.execute(words[0] >>> 24 & 63, new RDPBuffer(dv, 0, dv.byteLength));
  };
  state.scissor = { x0: 0, y0: 0, x1: 8, y1: 8, mode: 0 };
  state.rdpOtherModeL = 0;
  state.combine.hi = 0x00ffffff;
  state.combine.lo = 0xfffc7038 | (4 << 15) | (4 << 9) | (4 << 6) | 4; // SHADE

  for (const perspective of [true, false, true]) {
    resetFrame([0, 1, 0, 1]);
    state.rdpOtherModeH = perspective ? gbi.G_TP_MASK : 0;
    execute(trianglePacket());
    const expected = Array.from({ length: 7 }, (_, x) => [8 + 16 * x, 0, 0, 255]).flat();
    assertPixels(gl, {
      x: 0,
      y: 7,
      width: 7,
      height: 1,
      expected,
      label: `RDP shade perspective=${perspective}`,
    });
    lines.push(`PASS raw RDP shade stays affine with texture perspective=${perspective}`);
  }

  // Exercise the raw four-word rectangle layout and the real texture sampler.
  state.rdpOtherModeH = 0;
  state.combine.lo = 0xfffc7038 | (1 << 15) | (1 << 9) | (1 << 6) | 1; // TEXEL0
  const tile = state.tiles[0];
  tile.set(gbi.ImageFormat.G_IM_FMT_RGBA, gbi.ImageSize.G_IM_SIZ_16b, 1, 0, 0, 2, 0, 0, 2, 0, 0);
  tile.setSize(0, 0, 4, 4);
  state.tmem.tmemData.set([0xf8, 1, 7, 0xc1]); // Red, green
  state.tmem.tmemData.set([0, 0x3f, 0xff, 0xff], 12); // Blue, white (odd-row swap)
  for (const flipped of [false, true]) {
    renderer.newFrame();
    execute([(flipped ? 0xe5000000 : 0xe4000000) | (8 << 12) | 8, 0, 0, 0x04000400]);
    const expected = (flipped ? [GREEN, WHITE, RED, BLUE] : [BLUE, WHITE, RED, GREEN]).flat();
    assertPixels(gl, {
      x: 0,
      y: 6,
      width: 2,
      height: 2,
      expected,
      tolerance: 0,
      label: `Raw RDP rectangle flip=${flipped}`,
    });
    lines.push(`PASS raw RDP texture rectangle flip=${flipped} samples the expected texels`);
  }
  // STW coefficients specify S/W and 1/W, not pre-divided texture UVs.
  const texels = [0xf801, 0x07c1, 0x003f, 0xffff, 0xffc1, 0xf83f, 0x07ff, 1];
  const colors = [RED, GREEN, BLUE, WHITE,
    [255, 255, 0, 255], [255, 0, 255, 255], [0, 255, 255, 255], [0, 0, 0, 255]];
  tile.set(gbi.ImageFormat.G_IM_FMT_RGBA, gbi.ImageSize.G_IM_SIZ_16b, 2, 0, 0, 2, 0, 0, 2, 0, 0);
  tile.setSize(0, 0, 28, 0);
  state.tmem.tmemData.set(texels.flatMap(value => [value >>> 8, value & 255]));
  for (const perspective of [false, true]) {
    renderer.newFrame();
    state.rdpOtherModeH = perspective ? gbi.G_TP_MASK : 0;
    execute(trianglePacket());
    const expected = Array.from({ length: 7 }, (_, i) => {
      const x = i + 0.5;
      return colors[Math.floor(perspective ? 8 * x / (16 - x) : x / 4)];
    }).flat();
    assertPixels(gl, {
      x: 0,
      y: 7,
      width: 7,
      height: 1,
      expected,
      label: `Raw RDP STW perspective=${perspective}`,
    });
    lines.push(`PASS raw RDP triangle STW interpolation perspective=${perspective}`);
  }
  renderer.reset();
  return lines;
}
