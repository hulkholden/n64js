import { describe, expect, test } from 'bun:test';
import { executeDisplayList } from './display_list.js';
import { appendLine } from './gbi_l3dex.js';
import { create } from './microcodes.js';
import { NullRenderer } from './null_renderer.js';
import { RSPState } from './rsp_state.js';
import { TriangleBuffer } from './triangle_buffer.js';

function harness(commands, version = 'RSP Gfx ucode L3DEX 1.23', hash = 0x8eb56290) {
  const ram = new DataView(new ArrayBuffer(0x1000));
  const state = new RSPState();
  state.reset(ram, 8);
  commands.concat([[0xb8000000, 0]]).forEach(([a, b], i) => {
    ram.setUint32(8 + i * 8, a);
    ram.setUint32(12 + i * 8, b);
  });
  const microcode = create({ detectVersionString: () => version, computeMicrocodeHash: () => hash }, state, ram);
  microcode.renderer = new NullRenderer(state);
  const draws = [];
  microcode.renderer.flushTris = (tb, options) => {
    draws.push({ positions: [...tb.positions.slice(0, tb.numTris * 12)], tris: tb.numTris, options });
    tb.reset();
  };
  for (let i = 0; i < 8; ++i) {
    const v = state.projectedVertices[i];
    v.set = true;
    v.pos.set(i % 2 ? 0.5 : -0.5, i < 2 ? 0 : 0.5, 0, 1);
  }
  return { state, microcode, draws };
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
  const { Renderer } = await import('./renderer.js');
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
