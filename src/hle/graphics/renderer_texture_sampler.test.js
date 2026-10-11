import { expect, test } from 'bun:test';
import * as gbi from './gbi.js';
import { ProjectedVertex } from './projected_vertex.js';
import { Renderer } from './renderer.js';
import { RSPState } from './rsp_state.js';
import { Tile } from './tile.js';
import { TriangleBuffer } from './triangle_buffer.js';

function fixture() {
  const values = new Map();
  const record = (name, ...args) => values.set(name, args);
  const gl = {
    uniform1i: record, uniform2i: record, uniform2f: record, uniform4f: record, uniform4i: record,
    TEXTURE0: 0, TEXTURE_2D: 'texture2D',
  };
  const state = new RSPState();
  const renderer = Object.assign(Object.create(Renderer.prototype), { gl, state });
  const tile = new Tile();
  tile.set(0, 2, 0, 7, 0, 0, 0, 0, 0, 0, 0);
  tile.setSize(5, 10, 33, 38);
  tile.shiftS = 2;
  tile.shiftT = 12;
  tile.maskS = 2;
  tile.cmS = gbi.G_TX_MIRROR | gbi.G_TX_CLAMP;
  const uniforms = [0, 1].map(i => ({
    memory: `memory${i}`, palette: `palette${i}`, scale: `scale${i}`, offset: `offset${i}`,
    bounds: `bounds${i}`, mask: `mask${i}`, mode: `mode${i}`, enabled: `enabled${i}`,
  }));
  const bind = (slot = 0, descriptor = tile, texgen = false) =>
    renderer.bindTile(descriptor, texgen, uniforms[slot]);
  return { values, state, bind };
}

test('shader sampler receives shifts, fractional origins, masks and independent clamp extents', () => {
  const { values, bind } = fixture();
  bind();
  expect(values.get('scale0')).toEqual([0.25, 16]);
  expect(values.get('offset0')).toEqual([1.25, 2.5]);
  expect(values.get('bounds0')).toEqual([7, 7, 7, 7]);
  expect(values.get('mask0')).toEqual([2, 0]);
  expect(values.get('mode0')).toEqual([3, 2]);
  expect(values.get('memory0')).toEqual([56, 0, 0, 2]);
  expect(values.get('enabled0')).toEqual([1]);
});

test('generated coordinates are converted from normalized UVs back to texels', () => {
  const { values, bind } = fixture();
  bind(1, undefined, true);
  expect(values.get('scale1')).toEqual([1, 128]);
  expect(values.get('offset1')).toEqual([0, 0]);
});

test('copy sampling bypasses clamping but preserves mirroring and masking', () => {
  const { values, state, bind } = fixture();
  state.rdpOtherModeH = gbi.CycleType.G_CYC_COPY;
  bind();
  expect(values.get('mode0')).toEqual([1, 0]);
  expect(values.get('mask0')).toEqual([2, 0]);
});

test('an absent second tile cannot reuse the previous draw or tile zero', () => {
  const { values, bind } = fixture();
  bind(1);
  expect(values.get('enabled1')).toEqual([1]);
  bind(1, null);
  expect(values.get('enabled1')).toEqual([0]);
});

test('triangle perspective mode is applied at draw time without rescaling cached vertices', () => {
  const state = new RSPState();
  state.geometryMode.texture = 1;
  const gl = { disable() {}, depthMask() {}, drawArrays() {}, bindVertexArray() {} };
  let drawnCoords;
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    gl, state, initDepth() {}, markFramebufferDirty() {},
    setProgramState(positions, colors, coords, enabled, texgen, tile, count) {
      drawnCoords = Array.from(coords.slice(0, count * 2));
    },
  });
  const vertex = new ProjectedVertex();
  // Wetrix's icon vertices span twice the 56x29 texture dimensions.
  vertex.u = 112;
  vertex.v = 58;
  const buffer = new TriangleBuffer(2);
  for (const perspective of [true, false, false, true]) {
    buffer.pushTri(vertex, vertex, vertex);
    state.rdpOtherModeH = perspective ? gbi.TexturePerspective.G_TP_PERSP : gbi.TexturePerspective.G_TP_NONE;
    renderer.flushTris(buffer);
    const uv = perspective ? [112, 58] : [56, 29];
    expect(drawnCoords).toEqual([...uv, ...uv, ...uv]);
    expect([vertex.u, vertex.v]).toEqual([112, 58]);
    expect(buffer.empty()).toBe(true);
  }
});
