import { GBI1 } from '../src/hle/gbi1.js';
import { GBI2 } from '../src/hle/gbi2.js';
import {
  createWebGLHarness,
  drawProjectedTriangle,
  evaluateChecks,
} from './webgl_test_helpers.js';

// Render the same command sequence through both families. The first triangle
// was loaded before the updates; the others use new diffuse/ambient colours.
export function renderLightColorScene(gl) {
  const { ram, state, renderer, resetFrame } = createWebGLHarness(gl, {
    width: 800,
    height: 360,
    ramBytes: 256,
  });
  resetFrame([0.035, 0.05, 0.08, 1]);
  state.geometryMode.lighting = 1;
  state.geometryMode.shade = 1;
  state.geometryMode.shadeSmooth = 1;
  // SHADE in both cycles, including alpha.
  state.combine.hi = 0x00ffffff;
  state.combine.lo = (0xfffc7038 | (4 << 15) | (4 << 9) | (4 << 6) | 4) >>> 0;
  const checks = [];

  for (const [row, Type, stride] of [[0, GBI1, 32], [1, GBI2, 24]]) {
    const microcode = new Type(state, ram);
    microcode.renderer = renderer;
    for (let slot = 0; slot < 8; slot++) {
      microcode.loadLight(slot, 0xe0); // Clear all slots between families.
    }
    const move = (type, offset, value) => microcode.executeMoveWord(
      Type === GBI1 ? (0xbc000000 | (offset << 8) | type) >>> 0 : (0xdb000000 | (type << 16) | offset) >>> 0,
      value);
    const color = (slot, value) => {
      move(0x0a, slot * stride, value);
      move(0x0a, slot * stride + 4, value);
    };
    const load = () => microcode.loadVertices(0, 3, 0);
    const draw = (column, label, expected) => {
      gl.viewport(column * 200 + 10, (1 - row) * 180 + 10, 180, 160);
      drawProjectedTriangle(renderer, state.projectedVertices);
      const actual = new Uint8Array(4);
      gl.readPixels(column * 200 + 100, (1 - row) * 180 + 70, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, actual);
      checks.push({ name: `${Type.name} ${label}`, actual: [...actual], expected });
    };
    for (const [i, x, y] of [[0, -1, -1], [1, 1, -1], [2, 0, 1]]) {
      ram.setInt16(i * 16, x);
      ram.setInt16(i * 16 + 2, y);
      ram.setUint32(i * 16 + 12, 0x00007f29);
    }
    // Load a red +Z directional light and a dark ambient light from RAM.
    ram.setUint32(0x80, 0xc0201000);
    ram.setUint32(0x84, 0xc0201000);
    ram.setInt8(0x8a, 127);
    ram.setUint32(0x90, 0x10101000);
    microcode.loadLight(0, 0x80);
    microcode.loadLight(1, 0x90);
    move(0x02, 0, Type === GBI1 ? 0x80000040 : 24);
    load();
    color(0, 0x10b03000);
    draw(0, 'cached vertices retain red', [208, 48, 32, 255]);
    load();
    draw(1, 'diffuse update reaches new vertices', [32, 192, 64, 255]);
    color(1, 0x20306000);
    load();
    draw(2, 'ambient update adds RGB', [48, 224, 144, 255]);
    // Slot 8 becomes ambient with seven directional lights. Disable their
    // contribution using -Z normals, and update only the duplicate colour word.
    move(0x02, 0, Type === GBI1 ? 0x80000100 : 168);
    move(0x0a, 7 * stride + 4, 0x4080d000);
    for (let i = 0; i < 3; i++) {
      ram.setInt8(i * 16 + 14, -127);
    }
    load();
    draw(3, 'last ambient slot and duplicate word', [64, 128, 208, 255]);
  }
  const error = gl.getError();
  if (error !== gl.NO_ERROR) {
    throw new Error(`LightCol scene: GL error ${error}`);
  }
  renderer.copyTextureToFrontBuffer(renderer.renderTargets.current.texture);
  return checks;
}

export function runLightColorTests(gl) {
  gl.canvas.width = 800;
  gl.canvas.height = 360;
  return evaluateChecks(renderLightColorScene(gl));
}
