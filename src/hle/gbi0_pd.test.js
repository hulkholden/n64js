import { describe, expect, test } from 'bun:test';
import { Vector3 } from '../graphics/Vector3.js';
import * as gbi from './gbi.js';
import { GBI0PD } from './gbi0.js';
import { NullRenderer } from './null_renderer.js';
import { RSPState } from './rsp_state.js';
import { TriangleBuffer } from './triangle_buffer.js';

function harness() {
  const ram = new DataView(new ArrayBuffer(512));
  const state = new RSPState();
  state.reset(ram, 0);
  const microcode = new GBI0PD(state, ram);
  microcode.renderer = new NullRenderer(state);
  state.projection[0].elems[15] = 4;
  state.segments[1] = 64;
  microcode.executeSetVertexColorIndex(0x07000000, 0x010000c0);
  for (let i = 0; i < 4; ++i) {
    const address = 80 + i * 12;
    ram.setInt16(address + 4, i);
    ram.setUint8(address + 7, 4 + i * 4);
    ram.setInt16(address + 8, 32);
    ram.setInt16(address + 10, -64);
    ram.setUint32(260 + i * 4, 0x123456ff);
  }
  return {
    ram, state, microcode,
    load() { microcode.executeVertex(0x04340000, 0x01000010); },
    vertices() { return state.projectedVertices.slice(4, 8); },
  };
}

describe('Perfect Dark vertex fog', () => {
  test('indexed colours receive fog from clip Z/W before viewport mapping', () => {
    const h = harness();
    h.microcode.executeSetGeometryMode(0xb7000000, gbi.GeometryModeGBI1.G_FOG);
    h.microcode.executeMoveWord(0xbc000008, 0x0200ff80); // 512, -128
    h.state.viewport.set(new Vector3(80, -60, 42), new Vector3(120, 90, 17));
    h.load();
    expect(h.vertices().map(v => v.color >>> 24)).toEqual([0, 0, 128, 255]);
    expect(h.vertices().map(v => v.color & 0xffffff)).toEqual(Array(4).fill(0x563412));
    expect(h.vertices().map(v => [v.u, v.v])).toEqual(Array(4).fill([1, -2]));
    expect(h.state.projectedVertices[0].set).toBe(false);

    h.microcode.executeMoveWord(0xbc000008, 0xfe000180); // -512, 384
    h.load();
    expect(h.vertices().map(v => v.color >>> 24)).toEqual([255, 255, 128, 0]);
  });

  test('fog replaces lit alpha while preserving lighting and generated texture coordinates', () => {
    const h = harness();
    h.state.geometryMode.lighting = 1;
    h.state.geometryMode.textureGen = 1;
    h.state.lights[0].color = { r: 0.5, g: 0.25, b: 1 };
    for (let i = 0; i < 4; ++i) h.ram.setUint32(260 + i * 4, 0x00007f35);
    h.load();
    const uv = h.vertices().map(v => [v.u, v.v]);
    expect(h.vertices().map(v => v.color & 0xffffff)).toEqual(Array(4).fill(0xff3f7f));

    h.state.geometryMode.fog = 1;
    h.state.fogParameters.set(512, -128);
    h.load();
    expect(h.vertices().map(v => v.color >>> 24)).toEqual([0, 0, 128, 255]);
    expect(h.vertices().map(v => v.color & 0xffffff)).toEqual(Array(4).fill(0xff3f7f));
    expect(h.vertices().map(v => [v.u, v.v])).toEqual(uv);
  });

  test('cached fog survives state changes and disabled fog preserves indexed RGBA', () => {
    const h = harness();
    h.state.geometryMode.fog = 1;
    h.state.fogParameters.set(512, -128);
    h.load();
    h.state.fogParameters.set(0, 255);
    h.state.geometryMode.fog = 0;
    const buffer = new TriangleBuffer(1);
    buffer.pushTri(...h.vertices().slice(1));
    expect([...buffer.colours].map(c => c >>> 24)).toEqual([0, 128, 255]);

    [17, 41, 128, 255].forEach((alpha, i) => h.ram.setUint8(263 + i * 4, alpha));
    h.load();
    expect(h.vertices().map(v => v.color >>> 24)).toEqual([17, 41, 128, 255]);
    expect(h.vertices().map(v => v.color & 0xffffff)).toEqual(Array(4).fill(0x563412));
  });

  test('lighting takes source alpha from the high byte of the packed ABGR colour', () => {
    const h = harness();
    h.state.geometryMode.lighting = 1;
    [17, 41, 128, 255].forEach((alpha, i) => h.ram.setUint8(263 + i * 4, alpha));
    h.load();
    expect(h.vertices().map(v => v.color >>> 24)).toEqual([17, 41, 128, 255]);
  });
});
