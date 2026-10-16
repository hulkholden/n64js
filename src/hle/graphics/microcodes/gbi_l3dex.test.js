import { describe, expect, test } from 'bun:test';
import { executeDisplayList } from '../display_list.js';
import { appendLine } from './gbi_l3dex.js';
import { create } from '../microcodes.js';
import { NullRenderer } from '../null_renderer.js';
import { RSPState } from '../rsp_state.js';
import { TriangleBuffer } from '../triangle_buffer.js';

function harness(commands, version = 'RSP Gfx ucode L3DEX 1.23', hash = 0x8eb56290) {
  const ram = new DataView(new ArrayBuffer(0x1000));
  const state = new RSPState();
  state.reset(ram, 8);
  commands.concat([[version.includes('fifo') ? 0xdf000000 : 0xb8000000, 0]]).forEach(([a, b], i) => {
    ram.setUint32(8 + i * 8, a);
    ram.setUint32(12 + i * 8, b);
  });
  const microcode = create({ detectVersionString: () => version, computeMicrocodeHash: () => hash }, state, ram);
  microcode.renderer = new NullRenderer(state);
  const draws = [];
  microcode.renderer.flushTris = (tb, options) => {
    draws.push({ colors: [...tb.colours.slice(0, tb.numTris * 3)], positions: [...tb.positions.slice(0, tb.numTris * 12)], tris: tb.numTris, options });
    tb.reset();
  };
  for (let i = 0; i < 8; ++i) {
    const v = state.projectedVertices[i];
    v.set = true;
    v.pos.set(i % 2 ? 0.5 : -0.5, i < 2 ? 0 : 0.5, 0, 1);
  }
  const warnings = [];
  microcode.warn = message => warnings.push(message);
  return { state, microcode, draws, warnings };
}

describe('L3DEX commands', () => {
  test('captured odd width is not a vertex index, in batches and disassembly', () => {
    for (const disassembler of [null, { begin() {}, end() {}, text() {} }]) {
      const { state, microcode, draws } = harness([[0xb5000000, 0x00000275], [0xb5000000, 0x00000201]]);
      executeDisplayList(state, microcode, { disassembler });
      expect(draws.reduce((n, draw) => n + draw.tris, 0)).toBe(4);
      expect(draws.every(draw => draw.options.lines)).toBe(true);
      // 1.5 + 117/2 = 60 pixels across a 240-pixel framebuffer.
      expect(draws[0].positions[1]).toBeCloseTo(0.25);
      expect(draws[0].positions[5]).toBeCloseTo(-0.25);
      expect(state.currentOp).toBe(3);
    }
  });

  test('signed widths and degenerate lines do not become large positive widths', () => {
    const { state, microcode, draws } = harness([[0xb5000000, 0x000002ff], [0xb5000000, 0x00000280], [0xb5000000, 0x75]]);
    executeDisplayList(state, microcode);
    expect(draws[0].tris).toBe(2);
    expect(draws[0].positions[1]).toBeCloseTo(1 / 240);
  });

  test('TRI1 and TRI2 emit edges and flush before buffer overflow', () => {
    const commands = Array.from({ length: 12 }, () => [0xb1000204, 0x00020406]);
    commands.push([0xbf000000, 0x00000204]);
    const { state, microcode, draws } = harness(commands);
    executeDisplayList(state, microcode);
    expect(draws.reduce((n, draw) => n + draw.tris, 0)).toBe(12 * 12 + 6);
    expect(draws.every(draw => draw.tris <= 64)).toBe(true);
    expect(state.currentOp).toBe(14);
  });

  test('Power League keeps the F3DEX quad interpretation', () => {
    const { state, microcode, draws } = harness([[0xb5000000, 0x06000204]], 'RSP SW Version: 2.0D, 04-01-96', 0x2900a9d4);
    executeDisplayList(state, microcode);
    expect(draws[0].tris).toBe(2);
    expect(draws[0].options).toBeUndefined();
  });
});

const vertex = (x, y, z, w, color = 0xffffffff) => ({ pos: { x, y, z, w }, color, u: 0, v: 0 });
test('line expansion preserves perspective width, endpoint depth and flat color without changing the cache', () => {
  const tb = new TriangleBuffer(2);
  const a = vertex(-0.5, 0, 0.25, 1);
  const b = vertex(1, 0, 1, 2);
  appendLine(tb, a, b, 4, 320, 240, 0xff123456);
  expect(tb.numTris).toBe(2);
  expect(tb.positions[1]).toBeCloseTo(4 / 240);
  expect(tb.positions[9] / tb.positions[11]).toBeCloseTo(4 / 240);
  expect(tb.positions[2]).toBe(0.25);
  expect(tb.positions[10]).toBe(1);
  expect([...tb.colours]).toEqual(Array(6).fill(0xff123456));
  expect(a.pos.y).toBe(0);
  expect(b.pos.y).toBe(0);
});

test('clips near-plane crossings and rejects lines behind the camera', () => {
  const tb = new TriangleBuffer(4);
  appendLine(tb, vertex(-0.5, 0, -2, 1), vertex(0.5, 0, 0, 1), 2, 320, 240);
  expect(tb.numTris).toBe(2);
  expect(tb.positions[0]).toBe(0);
  expect(tb.positions[2]).toBe(-1);
  appendLine(tb, vertex(0, 0, 0, -1), vertex(1, 0, 0, -1), 2, 320, 240);
  expect(tb.numTris).toBe(2);
  expect([...tb.positions].every(Number.isFinite)).toBe(true);
});

test('line draws disable texture and face culling without affecting the next triangle draw', async () => {
  const { Renderer } = await import('../renderer.js');
  const state = new RSPState();
  Object.assign(state.geometryMode, { texture: 1, lighting: 1, textureGen: 1, cullBack: 1 });
  const culling = [], programs = [], draws = [];
  const renderer = Object.create(Renderer.prototype);
  Object.assign(renderer, {
    state,
    gl: {
      CULL_FACE: 'cull', BACK: 'back', TRIANGLES: 'triangles',
      enable: mode => culling.push(['enable', mode]),
      disable: mode => culling.push(['disable', mode]),
      cullFace() {}, bindVertexArray() {},
      drawArrays: (...args) => draws.push(args),
    },
    setProgramState: (...args) => programs.push(args.slice(3, 5)),
    initDepth() {}, markFramebufferDirty() {},
  });
  const tb = new TriangleBuffer(2);
  const a = vertex(-0.5, 0, 0, 1), b = vertex(0.5, 0, 0, 1);
  appendLine(tb, a, b, 2, 320, 240);
  renderer.flushTris(tb, { lines: true });
  tb.pushTri(a, b, vertex(0, 1, 0, 1));
  renderer.flushTris(tb);
  expect(programs).toEqual([[false, false], [1, 1]]);
  expect(culling).toEqual([['disable', 'cull'], ['enable', 'cull']]);
  expect(draws).toEqual([['triangles', 0, 6], ['triangles', 0, 3]]);
  expect(state.geometryMode.texture).toBe(1);
});

const l3dex2 = 'RSP Gfx ucode L3DEX       fifo 2.04  Yoshitaka Yasumoto 1998 Nintendo.';

describe('L3DEX2 commands', () => {
  test('decodes the captured NASCAR packet from cmd0 and leaves subsequent state commands intact', () => {
    for (const debug of [false, true]) {
      const text = [];
      const disassembler = debug ? { begin() {}, end() {}, text: value => text.push(value), rgba8888: value => String(value) } : null;
      const { state, microcode, draws, warnings } = harness([
        [0x08000200, 0], // NASCAR 2000: vertices 0 and 1, default width.
        [0x08000201, 0xffffffff], // cmd1 is unused, including its high byte.
        [0xfa000000, 0x12345678], // SetPrimColor must not be consumed by batching.
        [0x080002ff, 0], // signed -1 => one pixel.
      ], l3dex2);
      executeDisplayList(state, microcode, { disassembler });
      const positions = draws.flatMap(draw => draw.positions);
      expect(positions[1]).toBeCloseTo(1.5 / 240);
      expect(positions[25]).toBeCloseTo(2 / 240);
      expect(positions[49]).toBeCloseTo(1 / 240);
      expect(draws.reduce((n, draw) => n + draw.tris, 0)).toBe(6);
      expect(draws.every(draw => draw.options.lines)).toBe(true);
      expect(state.primColor).toBe(0x12345678);
      expect(state.currentOp).toBe(5);
      expect(state.pc).toBe(0);
      expect(warnings).toEqual([]);
      if (debug) {
        expect(text).toContain('gsSPLineW3D(0, 1, -1, 0);');
      }
    }
  });

  test('retains seven-bit indices, endpoint order and flat/smooth colors', () => {
    for (const smooth of [false, true]) {
      const { state, microcode, draws } = harness([[0x083e0401, 0]], l3dex2);
      const last = state.projectedVertices[31];
      last.set = true;
      last.pos.set(-0.5, 0.5, 0, 1);
      last.color = 0xff0000ff;
      state.projectedVertices[2].pos.set(0.5, 0.5, 0, 1);
      state.projectedVertices[2].color = 0xffff0000;
      state.geometryMode.shadeSmooth = smooth;
      executeDisplayList(state, microcode);
      expect(draws[0].positions[0]).toBe(-0.5);
      expect(draws[0].positions[8]).toBe(0.5);
      expect(draws[0].colors).toEqual(smooth
        ? [0xff0000ff, 0xff0000ff, 0xffff0000, 0xffff0000, 0xff0000ff, 0xffff0000]
        : Array(6).fill(0xff0000ff));
    }
  });

  test('skips nonpositive widths and validates unloaded/out-of-range endpoints', () => {
    const { state, microcode, draws, warnings } = harness([
      [0x080002fd, 0], [0x08000280, 0], // zero and negative pixel widths
      [0x08fefe00, 0], // repeated invalid indices are degenerate
      [0x08001000, 0], // vertex 8 is not loaded
      [0x08fe0000, 0], // vertex 127 is outside the cache
      [0x0800027f, 0], // largest positive width: 65 pixels
    ], l3dex2);
    executeDisplayList(state, microcode);
    expect(draws.reduce((n, draw) => n + draw.tris, 0)).toBe(2);
    expect(draws[0].positions[1]).toBeCloseTo(65 / 240);
    expect(warnings).toEqual(Array(2).fill('L3DEX line references an unloaded vertex'));
    expect(state.currentOp).toBe(7);
  });

  test('TRI1/TRI2 emit wireframe edges with signed widths and each triangle’s flat color', () => {
    const { state, microcode, draws } = harness([
      [0x05000204, 0x01000000],
      [0x06000204, 0xff020604],
      [0x07000204, 0x00020604], // QUAD is not a filled primitive in L3DEX2.
    ], l3dex2);
    state.projectedVertices[0].color = 0xff0000ff;
    state.projectedVertices[1].color = 0xffff0000;
    executeDisplayList(state, microcode);
    expect(draws.map(draw => draw.tris)).toEqual([6, 12]);
    expect(draws[0].positions[1]).toBeCloseTo(2 / 240);
    expect(draws[1].positions[1]).toBeCloseTo(1 / 240);
    expect(draws[1].colors.slice(0, 18)).toEqual(Array(18).fill(0xff0000ff));
    expect(draws[1].colors.slice(18)).toEqual(Array(18).fill(0xffff0000));
    expect(state.currentOp).toBe(4);
  });

  test('batches within capacity and respects debugger bailAfter', () => {
    const commands = Array.from({ length: 70 }, () => [0x08000200, 0]);
    const { state, microcode, draws } = harness(commands, l3dex2);
    executeDisplayList(state, microcode, { bailAfter: 34 });
    expect(draws.map(draw => draw.tris)).toEqual([64, 6]);
    expect(state.currentOp).toBe(34);
    expect(state.pc).toBe(8 + 35 * 8);
    executeDisplayList(state, microcode);
    expect(draws.reduce((n, draw) => n + draw.tris, 0)).toBe(140);
  });

  test('degenerate batches still yield to the display-list command limit', () => {
    const { state, microcode } = harness(Array.from({ length: 100 }, () => [0x08000000, 0]), l3dex2);
    expect(() => executeDisplayList(state, microcode, { commandLimit: 1 })).toThrow('command limit');
    expect(state.currentOp).toBe(32);
  });

  test('ordinary F3DEX2 retains filled TRI1/TRI2/QUAD dispatch', () => {
    const { state, microcode, draws } = harness([
      [0x05000204, 0], [0x06000204, 0x00020604], [0x07000204, 0x00020604],
    ], 'RSP Gfx ucode F3DEX fifo 2.04');
    executeDisplayList(state, microcode);
    expect(draws.map(draw => draw.tris)).toEqual([1, 2, 2]);
    expect(draws.every(draw => draw.options === undefined)).toBe(true);
  });
});
