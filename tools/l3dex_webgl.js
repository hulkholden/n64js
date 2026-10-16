import { executeDisplayList } from '../src/hle/graphics/display_list.js';
import { GBI2L3DEX } from '../src/hle/graphics/microcodes/gbi_l3dex.js';
import { CLEAR, RED, BLUE, assertPixels, createWebGLHarness } from './webgl_test_helpers.js';

export function runL3DEXTests(gl) {
  const lines = [];
  for (const scale of [1, 2]) {
    const { ram, state, renderer, microcode, resetFrame } = createWebGLHarness(gl, {
      width: 64 * scale, height: 32 * scale, Microcode: GBI2L3DEX,
    });
    renderer.nativeTransform.initDimensions(64, 32);
    // Output SHADE. Texture and culling bits must not interfere with lines.
    state.combine.hi = 0x00ffffff;
    state.combine.lo = (0xfffc7038 | (4 << 15) | (4 << 9) | (4 << 6) | 4) >>> 0;
    Object.assign(state.geometryMode, { texture: 1, cullFront: 1, cullBack: 1 });
    const [a, b] = state.projectedVertices;
    a.set = b.set = true;
    a.pos.set(-0.75, 0, 0.25, 1);
    b.pos.set(1.5, 0, 1, 2); // Same screen Y with unequal W and depth.
    a.color = 0xff0000ff;
    b.color = 0xffff0000;

    for (const [name, cmd0, color, halfWidth] of [
      ['four native pixels', 0x08000205, RED, 2],
      ['reversed flat endpoint', 0x08020005, BLUE, 2],
      ['odd width', 0x08000201, RED, 1],
      ['zero pixel width', 0x080002fd, CLEAR, 0],
      ['negative width', 0x08000280, CLEAR, 0],
    ]) {
      resetFrame(CLEAR);
      ram.setUint32(8, cmd0);
      ram.setUint32(12, 0xffffffff); // cmd1 must not affect width or endpoints.
      ram.setUint32(16, 0xdf000000);
      ram.setUint32(20, 0);
      state.pc = 8;
      executeDisplayList(state, microcode);
      const label = `L3DEX2 ${name}, render scale ${scale}`;
      for (const x of [12, 32, 52]) {
        const y = 16 * scale;
        assertPixels(gl, { x: x * scale, y, expected: [color], label });
        assertPixels(gl, { x: x * scale, y: y + halfWidth * scale, expected: [CLEAR], label });
        if (halfWidth) {
          assertPixels(gl, { x: x * scale, y: y - halfWidth * scale, expected: [color], label });
        }
      }
      lines.push(`PASS ${label}`);
    }
  }
  return lines;
}
