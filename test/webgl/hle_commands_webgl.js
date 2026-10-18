import { executeDisplayList } from '../../src/hle/graphics/display_list.js';
import { GBI1 } from '../../src/hle/graphics/microcodes/gbi1.js';
import { GBI2 } from '../../src/hle/graphics/microcodes/gbi2.js';
import { GBI1SDEX, GBI2SDEX } from '../../src/hle/graphics/microcodes/gbi_s2dex.js';
import { drawS2DEXObject, s2dexObjectCases } from './s2dex_object_cases.js';
import { assertPixels, createWebGLHarness, withMockMemory } from './webgl_test_helpers.js';

function commands(ram, address, words) {
  words.forEach(([a, b], i) => {
    ram.setUint32(address + i * 8, a);
    ram.setUint32(address + i * 8 + 4, b);
  });
}

function pixels(gl, width, height) {
  const result = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, result);
  if (gl.getError() !== gl.NO_ERROR) {
    throw new Error('HLE command framebuffer read failed');
  }
  return result;
}

function objectHarness(gl, Type) {
  gl.canvas.width = gl.canvas.height = 64;
  const h = createWebGLHarness(gl, { width: 64, height: 64, Microcode: Type });
  h.renderer.nativeTransform.initDimensions(64, 64);
  Object.assign(h.state.scissor, { x0: 0, y0: 0, x1: 64, y1: 64 });
  h.state.combine.hi = 0x00ffffff;
  h.state.combine.lo = 0xfffcf279; // TEXEL0, including alpha, in both cycles.
  // Four asymmetric quadrants, stored in physical RGBA16 TMEM order.
  const colors = [0xf801, 0x07c1, 0x003f, 0xffff];
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 8; x++) {
      const address = (y * 16 + x * 2) ^ ((y & 1) * 4);
      const color = colors[(y >= 2 ? 2 : 0) + (x >= 4 ? 1 : 0)];
      h.state.tmem.tmemData[address] = color >>> 8;
      h.state.tmem.tmemData[address + 1] = color & 255;
    }
  }
  return h;
}

export function runHLECommandTests(gl) {
  const lines = [];
  for (const Type of [GBI1SDEX, GBI2SDEX]) {
    const h = objectHarness(gl, Type);
    for (const { options, rect } of s2dexObjectCases) {
      h.resetFrame([0, 0, 0, 0]);
      drawS2DEXObject(h, options);
      const actual = pixels(gl, 64, 64);
      // Render independently captured RSP output with the same texture and
      // RDP modes. This checks every covered pixel, including fractional edges.
      h.resetFrame([0, 0, 0, 0]);
      const [x0, y0, x1, y1, s0, t0, ds, dt] = rect;
      h.renderer.texRect(0, x0, y0, x1, y1, s0, t0,
        s0 + (x1 - x0) * ds, t0 + (y1 - y0) * dt, false);
      const expected = pixels(gl, 64, 64);
      const label = `${Type.name} RSP rectangle ${JSON.stringify(options)}`;
      if (!actual.some(v => v !== 0) || actual.some((v, i) => v !== expected[i])) {
        throw new Error(`${label}: framebuffer differs from captured RDP rectangle`);
      }
      lines.push(label);
    }
    const colors = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 255, 255]];
    for (const flags of [0, 1, 16, 17]) {
      h.resetFrame([0, 0, 0, 0]);
      drawS2DEXObject(h, { flags, rot: true, matrix: { a: 0, b: -1, c: 1, d: 0, x: 32 } });
      // Interior texels of the four quadrants after a 90-degree rotation.
      for (const [x, y, quadrant] of [[11, 11, 0], [11, 15, 1], [9, 11, 2], [9, 15, 3]]) {
        assertPixels(gl, { x, y: 63 - y, expected: colors[quadrant ^ ((flags & 1) ? 1 : 0) ^ ((flags & 16) ? 2 : 0)],
          label: `${Type.name} rotated sprite flags=${flags}` });
      }
      lines.push(`${Type.name} rotated sprite flags=${flags}`);
    }
    // A repeated status must retain blue TMEM even after RAM becomes red;
    // SetStatus invalidation must make the next load visible.
    withMockMemory(h.u8, () => {
      const { ram, microcode } = h;
      ram.setUint32(0x200, 0x00fc1034);
      ram.setUint32(0x204, 0x300);
      ram.setUint16(0x20a, 7);
      ram.setUint16(0x20c, 12);
      ram.setUint32(0x210, 1);
      ram.setUint32(0x214, 1);
      for (let step = 0; step < 3; step++) {
        for (let i = 0; i < 32; i++) {
          ram.setUint16(0x300 + i * 2, step === 0 ? 0x003f : 0xf801);
        }
        if (step === 2) {
          microcode.executeMoveWord(Type === GBI1SDEX ? 0xbc000008 : 0xdb080000, 0);
        }
        h.resetFrame([0, 0, 0, 0]);
        microcode.s2dex.executeObjLoadTxtr(0, 0x200);
        drawS2DEXObject(h);
        assertPixels(gl, { x: 12, y: 42, expected: step === 2 ? [255, 0, 0, 255] : [0, 0, 255, 255],
          label: `${Type.name} texture status step=${step}` });
        lines.push(`${Type.name} texture status step=${step}`);
      }
    });
    h.renderer.reset();
  }

  for (const Type of [GBI1, GBI2, GBI1SDEX, GBI2SDEX]) {
    const first = Type === GBI1 || Type === GBI1SDEX;
    const select = Type === GBI1SDEX || Type === GBI2SDEX;
    const end = first ? 0xb8000000 : 0xdf000000;
    const h = createWebGLHarness(gl, { width: 64, height: 64, Microcode: Type });
    const { ram, state, microcode, renderer } = h;
    renderer.nativeTransform.initDimensions(64, 64);
    Object.assign(state.scissor, { x0: 0, y0: 0, x1: 64, y1: 64 });
    state.colorImage.address = 0x800;
    state.colorImage.size = 3;
    state.rdpOtherModeH = 0x300000; // Fill cycle.
    ram.setInt16(0x100, 0);
    state.viewport.transform.trans.z = 511;
    microcode.loadVertices(0, 1, 0x100);
    const depth = 511 * 65536; // Viewport at clip Z=0, W=1.
    const fill = [[0xf6100100, 0], [end, 0]];
    for (const delta of [-1, 0, 1]) {
      h.resetFrame([0, 0, 0, 0]);
      const branch = select ? [
        [first ? 0xbc000008 : 0xdb080000, 0], // SetStatus(0, 0).
        [0xe4000080, delta + 1], [first ? 0xb0010000 : 0x04010000, 0xffffffff],
      ] : [[first ? 0xb4000000 : 0xe1000000, 0x80],
        [first ? 0xb0000000 : 0x04000000, depth + delta]];
      commands(ram, 8, [...branch, [0xf7000000, 0xff0000ff], ...fill]);
      commands(ram, 0x80, [[0xf7000000, 0x00ff00ff], ...fill]);
      state.pc = 8;
      executeDisplayList(state, microcode);
      const taken = select ? delta !== -1 : delta > 0 || (first && delta === 0);
      const label = `${Type.name} rendered ${select ? 'SelectDL' : 'depth branch'} delta=${delta}`;
      assertPixels(gl, { x: 32, y: 32, expected: taken ? [0, 255, 0, 255] : [255, 0, 0, 255],
        label });
      lines.push(label);
    }
    renderer.reset();
  }
  for (const Type of [GBI1, GBI2]) {
    const first = Type === GBI1;
    gl.canvas.width = 180;
    gl.canvas.height = 160;
    const h = createWebGLHarness(gl, { width: 180, height: 160, Microcode: Type });
    const { ram, state, microcode } = h;
    state.geometryMode.shade = state.geometryMode.shadeSmooth = 1;
    state.combine.hi = 0x00ffffff;
    state.combine.lo = (0xfffc7038 | (4 << 15) | (4 << 9) | (4 << 6) | 4) >>> 0;
    state.rdpOtherModeL = 0x00400000;
    for (const [i, x, y] of [[0, -1, -1], [1, 1, -1], [2, 0, 1]]) {
      ram.setInt16(256 + i * 16, x);
      ram.setInt16(258 + i * 16, y);
      ram.setUint32(268 + i * 16, 0x2060e0ff);
    }
    for (let step = 0; step < 3; step++) {
      h.resetFrame([16, 32, 48, 255]);
      const words = step === 1 ? [
        [first ? 0xbc000000 : 0xdb000000, 0], // Replace integer X scale.
        [first ? 0xbc002000 : 0xdb000020, 0x40000000], // Insert fractional 1/4.
      ] : [];
      if (step === 2) {
        state.combinedMatrixDirty = true;
      }
      words.push([first ? 0x04000c00 : 0x01003006, 256],
        first ? [0xbf000000, 0x00000204] : [0x05040200, 0],
        [first ? 0xb8000000 : 0xdf000000, 0]);
      commands(ram, 8, words);
      state.pc = 8;
      executeDisplayList(state, microcode);
      assertPixels(gl, { x: 90, y: 35, expected: [32, 96, 224, 255], label: `${Type.name} matrix center` });
      assertPixels(gl, { x: 130, y: 35, expected: step === 1 ? [16, 32, 48, 255] : [32, 96, 224, 255],
        label: `${Type.name} matrix insert step=${step}` });
      lines.push(`${Type.name} matrix insert step=${step}`);
    }
    h.renderer.reset();
  }
  return lines;
}
