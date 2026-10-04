import { renderModifyVertexScene } from './modify_vertex_webgl.js';
import { executeDisplayList } from '../src/hle/display_list.js';
import { GBI2 } from '../src/hle/gbi2.js';
import { createWebGLHarness, evaluateChecks } from './webgl_test_helpers.js';

// A real display list uses WCW's ForceMatrix pair, then explicitly invalidates it.
export function renderForceMatrixScene(gl) {
  const { ram, state, renderer, microcode, resetFrame } = createWebGLHarness(gl, {
    width: 600,
    height: 180,
    ramBytes: 1024,
    pc: 8,
    Microcode: GBI2,
  });
  resetFrame([16, 32, 48, 255]);
  state.geometryMode.shade = state.geometryMode.shadeSmooth = 1;
  state.combine.hi = 0x00ffffff;
  state.combine.lo = (0xfffc7038 | (4 << 15) | (4 << 9) | (4 << 6) | 4) >>> 0;
  state.rdpOtherModeL = 0x00400000;
  for (const [i, x, y] of [[0, -1, -1], [1, 1, -1], [2, 0, 1]]) {
    ram.setInt16(256 + i * 16, x);
    ram.setInt16(258 + i * 16, y);
    ram.setUint32(268 + i * 16, 0x2060e0ff);
  }
  // Scale X to 1/4. The source vertex at X=1 moves inside X=0.25.
  [0.25, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1].forEach((value, i) => {
    const offset = (i % 4) * 8 + (i >> 2) * 2;
    ram.setInt16(512 + offset, (value * 65536) >> 16);
    ram.setUint16(544 + offset, (value * 65536) & 0xffff);
  });
  const checks = [];
  for (let column = 0; column < 3; column++) {
    const commands = column === 1 ? [[0xdc38000e, 512], [0xdb0c0000, 0x10000]]
      : column === 2 ? [[0xdb0c0000, 0]] : [];
    commands.push([0x01003006, 256], [0x05040200, 0], [0xdf000000, 0]);
    commands.forEach(([a, b], i) => {
      ram.setUint32(8 + i * 8, a);
      ram.setUint32(12 + i * 8, b);
    });
    gl.viewport(column * 200 + 10, 10, 180, 160);
    state.pc = 8;
    executeDisplayList(state, microcode);
    // Center always remains blue. X~0.5 is blue only before/after forcing.
    for (const [x, expected] of [[100, [32, 96, 224, 255]], [145, column === 1 ? [16, 32, 48, 255] : [32, 96, 224, 255]]]) {
      const actual = new Uint8Array(4);
      gl.readPixels(column * 200 + x, 45, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, actual);
      checks.push({ name: `GBI2 ${['stack transform', 'forced transform', 'invalidated transform'][column]} x=${x}`, actual: [...actual], expected });
    }
  }
  renderer.copyTextureToFrontBuffer(renderer.renderTargets.current.texture);
  const error = gl.getError();
  if (error !== gl.NO_ERROR) {
    throw new Error(`ForceMatrix GL error ${error}`);
  }
  return checks;
}

export function runMoveWordPointsTests(gl, pointsCanvas) {
  const checks = renderModifyVertexScene(gl, true);
  pointsCanvas.getContext('2d').drawImage(gl.canvas, 0, 0);
  gl.canvas.width = 600;
  gl.canvas.height = 180;
  checks.push(...renderForceMatrixScene(gl));
  return evaluateChecks(checks);
}
