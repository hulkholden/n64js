import { describe, expect, test } from 'bun:test';
import { Matrix4x4 } from '../graphics/Matrix4x4.js';
import { Transform4D } from '../graphics/Transform4D.js';
import { Vector3 } from '../graphics/Vector3.js';
import * as gbi from './gbi.js';
import { GBI0DKR } from './gbi0_dkr.js';
import { NullRenderer } from './null_renderer.js';
import { RSPState } from './rsp_state.js';
import { TriangleBuffer } from './triangle_buffer.js';

function harness() {
  const ram = new DataView(new ArrayBuffer(256));
  const state = new RSPState();
  state.reset(ram, 0);
  const microcode = new GBI0DKR(state, ram);
  microcode.renderer = new NullRenderer(state);
  microcode.matrixArray[2] = Matrix4x4.identity();
  microcode.matrixArray[2].elems[15] = 4;
  microcode.executeMoveWord(0xbc00000a, 2 << 6);
  microcode.executeSetAddresses(0xbf000000, 64);
  for (let i = 0; i < 4; ++i) {
    ram.setInt16(80 + i * 10 + 4, i);
    ram.setUint32(80 + i * 10 + 6, 0x123456ff);
  }
  return {
    ram, state, microcode,
    load() { microcode.executeVertex(0x04000000 | (3 << 19) | (4 << 9), 16); },
    vertices() { return state.projectedVertices.slice(4, 8); },
  };
}

describe('DKR vertex fog', () => {
  test('DMA vertices use the selected matrix and clip Z/W before viewport mapping', () => {
    const h = harness();
    h.microcode.executeSetGeometryMode(0xb7000000, gbi.GeometryModeGBI1.G_FOG);
    h.microcode.executeMoveWord(0xbc000008, 0x0200ff80); // 512, -128
    h.state.viewport.set(new Vector3(80, -60, 42), new Vector3(120, 90, 17));
    h.load();
    expect(h.vertices().map(v => v.color >>> 24)).toEqual([0, 0, 128, 255]);
    expect(h.vertices().map(v => v.color & 0xffffff)).toEqual(Array(4).fill(0x563412));
    expect(h.state.projectedVertices[0].set).toBe(false);

    h.microcode.executeMoveWord(0xbc000008, 0xfe000180); // -512, 384
    h.load();
    expect(h.vertices().map(v => v.color >>> 24)).toEqual([255, 255, 128, 0]);
  });

  test('fog is cached at load time and disabled fog preserves source alpha', () => {
    const h = harness();
    h.state.geometryMode.fog = 1;
    h.state.fogParameters.set(512, -128);
    h.load();
    h.state.fogParameters.set(0, 255);
    h.state.geometryMode.fog = 0;
    const buffer = new TriangleBuffer(1);
    buffer.pushTri(...h.vertices().slice(1));
    expect([...buffer.colours].map(c => c >>> 24)).toEqual([0, 128, 255]);

    [17, 41, 128, 255].forEach((alpha, i) => h.ram.setUint8(80 + i * 10 + 9, alpha));
    h.load();
    expect(h.vertices().map(v => v.color >>> 24)).toEqual([17, 41, 128, 255]);
    expect(h.vertices().map(v => v.color & 0xffffff)).toEqual(Array(4).fill(0x563412));
  });

  test('billboard fog uses the translated clip position', () => {
    const { ram, state, microcode } = harness();
    microcode.renderer.nativeTransform.viTransform = new Transform4D();
    state.viewport.transform = new Transform4D();
    // Cache the billboard centre at Z=2, W=4.
    ram.setInt16(80 + 4, 2);
    microcode.executeVertex(0x04000000, 16);
    microcode.executeMoveWord(0xbc000002, 1);
    state.geometryMode.fog = 1;
    state.fogParameters.set(512, -128);
    // The local Z=1 becomes Z=3, W=8 after adding the billboard centre.
    microcode.executeVertex(0x04010000, 26);
    expect(state.projectedVertices[1].pos.z).toBe(3);
    expect(state.projectedVertices[1].pos.w).toBe(8);
    expect(state.projectedVertices[1].color >>> 24).toBe(64);
    expect(state.projectedVertices[1].color & 0xffffff).toBe(0x563412);
  });
});
