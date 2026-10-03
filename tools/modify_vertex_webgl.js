import { executeDisplayList } from '../src/hle/display_list.js';
import { GBI1 } from '../src/hle/gbi1.js';
import { GBI2 } from '../src/hle/gbi2.js';
import { Renderer } from '../src/hle/renderer.js';
import { RSPState } from '../src/hle/rsp_state.js';

// Draw the same cached vertices before and after real ModifyVertex commands.
// Expected RGB values are explicit; partial alpha blends over RGB(16, 32, 48).
export function renderModifyVertexScene(gl) {
  const ram = new DataView(new ArrayBuffer(512));
  const state = new RSPState();
  state.reset(ram, 0);
  const renderer = new Renderer(gl, state, 800, 360);
  renderer.newFrame();
  gl.disable(gl.DITHER);
  gl.disable(gl.SCISSOR_TEST);
  gl.clearColor(16 / 255, 32 / 255, 48 / 255, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  state.geometryMode.shade = state.geometryMode.shadeSmooth = 1;
  state.combine.hi = 0x00ffffff;
  // SHADE in both cycles, including alpha.
  state.combine.lo = (0xfffc7038 | (4 << 15) | (4 << 9) | (4 << 6) | 4) >>> 0;
  state.rdpOtherModeL = 0x00400000; // IN * A_IN + MEM * (1 - A_IN).
  const checks = [];

  for (const [row, Type, opcode, triangle, end] of [
    [0, GBI1, 0xb2, [0xbf000000, 0x00000204], 0xb8000000],
    [1, GBI2, 0x02, [0x05040200, 0], 0xdf000000],
  ]) {
    const microcode = new Type(state, ram);
    microcode.renderer = renderer;
    state.geometryMode.lighting = state.geometryMode.fog = 0;
    for (const [i, x, y] of [[0, -1, -1], [1, 1, -1], [2, 0, 1]]) {
      ram.setInt16(256 + i * 16, x);
      ram.setInt16(258 + i * 16, y);
      ram.setUint32(268 + i * 16, 0x2060e0ff);
    }
    microcode.loadVertices(0, 3, 256);
    // Neither lighting nor fog may reinterpret the post-transform RGBA write.
    state.geometryMode.lighting = state.geometryMode.fog = 1;
    state.fogParameters.set(0, 255);
    const samples = [
      ['original cached color', null, [32, 96, 224, 255]],
      ['RGBA update', 0xff7864ff, [255, 120, 100, 255]],
      ['partial alpha', 0xff786440, [76, 54, 61, 207]],
      ['zero alpha', 0xff786400, [16, 32, 48, 255]],
    ];
    for (const [column, [label, rgba, expected]] of samples.entries()) {
      const commands = [];
      if (rgba !== null) {
        for (let i = 0; i < 3; i++) {
          commands.push([(opcode << 24) | 0x100000 | (i << 1), rgba]);
        }
      }
      commands.push(triangle, [end, 0]);
      commands.forEach(([cmd0, cmd1], i) => {
        ram.setUint32(8 + i * 8, cmd0);
        ram.setUint32(12 + i * 8, cmd1);
      });
      gl.viewport(column * 200 + 10, (1 - row) * 180 + 10, 180, 160);
      state.pc = 8;
      executeDisplayList(state, microcode);
      const actual = new Uint8Array(4);
      gl.readPixels(column * 200 + 100, (1 - row) * 180 + 70, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, actual);
      checks.push({ name: `${Type.name} ${label}`, actual: [...actual], expected });
    }
  }
  const error = gl.getError();
  if (error !== gl.NO_ERROR) {
    throw new Error(`ModifyVertex scene: GL error ${error}`);
  }
  renderer.copyTextureToFrontBuffer(renderer.renderTargets.current.texture);
  return checks;
}

export function runModifyVertexTests(gl) {
  gl.canvas.width = 800;
  gl.canvas.height = 360;
  return renderModifyVertexScene(gl).map(({ name, actual, expected }) => {
    if (actual.some((value, i) => Math.abs(value - expected[i]) > 1)) {
      throw new Error(`${name}: expected ${expected}, got ${actual}`);
    }
    return `PASS ${name}`;
  });
}
