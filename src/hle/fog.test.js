import { describe, expect, test } from 'bun:test';
import { Matrix4x4 } from '../graphics/Matrix4x4.js';
import { Vector3 } from '../graphics/Vector3.js';
import { GBI1 } from './gbi1.js';
import { GBI2 } from './gbi2.js';
import { NullRenderer } from './null_renderer.js';
import { RSPState } from './rsp_state.js';
import { TriangleBuffer } from './triangle_buffer.js';

function harness(Type = GBI1) {
  const ram = new DataView(new ArrayBuffer(256));
  const state = new RSPState();
  state.reset(ram, 0);
  const microcode = new Type(state, ram);
  microcode.renderer = new NullRenderer(state);
  state.projection[0] = Matrix4x4.identity();
  state.projection[0].elems[15] = 4;
  for (let i = 0; i < 4; ++i) {
    ram.setInt16(i * 16 + 4, i);
    ram.setUint32(i * 16 + 12, 0x12345629);
  }
  return { ram, state, microcode };
}

const alphas = state => state.projectedVertices.slice(0, 4).map(v => v.color >>> 24);

describe('standard vertex fog', () => {
  for (const [Type, command] of [[GBI1, 0xbc000008], [GBI2, 0xdb080000]]) {
    test(`${Type.name} decodes signed fog factors and disassembles factor units`, () => {
      const { state, microcode } = harness(Type);
      const text = [];
      // Real AeroGauge/Spider-Man and Zelda values, plus a negative multiplier.
      for (const [word, multiplier, offset] of [[0x7d008400, 32000, -31744], [0x476db993, 18285, -18029], [0xfe000180, -512, 384]]) {
        microcode.executeMoveWord(command, word, { text: s => text.push(s) });
        expect(state.fogParameters.multiplier).toBe(multiplier);
        expect(state.fogParameters.offset).toBe(offset);
        expect(text.at(-1)).toBe(`gsSPFogFactor(${multiplier}, ${offset});`);
      }
    });
  }

  test('replaces only alpha, using clip Z/W before the viewport mapping', () => {
    const { state, microcode } = harness();
    state.geometryMode.fog = 1;
    state.fogParameters.set(512, -128);
    state.viewport.set(new Vector3(80, -60, 42), new Vector3(120, 90, 17));
    microcode.loadVertices(0, 4, 0);
    expect(alphas(state)).toEqual([0, 0, 128, 255]);
    expect(state.projectedVertices.slice(0, 4).map(v => v.color & 0xffffff)).toEqual(Array(4).fill(0x563412));

    state.fogParameters.set(-512, 384);
    microcode.loadVertices(0, 4, 0);
    expect(alphas(state)).toEqual([255, 255, 128, 0]);
  });

  test('fog wins over lit alpha without changing lit RGB', () => {
    const { state, microcode } = harness();
    state.geometryMode.lighting = 1;
    state.lights[0].color = { r: 0.2, g: 0.4, b: 0.6 };
    microcode.loadVertices(0, 4, 0);
    const colors = state.projectedVertices.slice(0, 4).map(v => v.color & 0xffffff);
    state.geometryMode.fog = 1;
    state.fogParameters.set(512, -128);
    microcode.loadVertices(0, 4, 0);
    expect(alphas(state)).toEqual([0, 0, 128, 255]);
    expect(state.projectedVertices.slice(0, 4).map(v => v.color & 0xffffff)).toEqual(colors);
  });

  test('cached vertices retain alpha across parameter, colour and enable changes', () => {
    const { state, microcode } = harness();
    state.geometryMode.fog = 1;
    state.fogParameters.set(512, -128);
    microcode.loadVertices(0, 4, 0);
    state.fogParameters.set(0, 255);
    state.fogColor = 0xff000000;
    state.geometryMode.fog = 0;
    const buffer = new TriangleBuffer(1);
    buffer.pushTri(...state.projectedVertices.slice(1, 4));
    expect([...buffer.colours.slice(0, 3)].map(c => c >>> 24)).toEqual([0, 128, 255]);
    microcode.loadVertices(0, 1, 0);
    expect(alphas(state)).toEqual([41, 0, 128, 255]);
    state.geometryMode.fog = 1;
    microcode.loadVertices(0, 1, 0);
    expect(alphas(state)).toEqual([255, 0, 128, 255]);
  });

  test('handles the near/eye planes, tiny W, constant fog and byte truncation', () => {
    const { state } = harness();
    const fog = state.fogParameters;
    fog.set(128, 128);
    expect(fog.calculateAlpha(-4, 1)).toBe(0);
    expect(fog.calculateAlpha(0, 0)).toBe(0);
    expect(fog.calculateAlpha(-2, -1)).toBe(0);
    expect(fog.calculateAlpha(1, 1e-320)).toBe(255);
    expect(fog.calculateAlpha(0.1, 1)).toBe(140);
    fog.set(-128, 128);
    expect(fog.calculateAlpha(-4, 1)).toBe(255);
    fog.set(0, 123);
    for (const [z, w] of [[0, 0], [1, 1e-320], [-1, -1]]) {
      expect(fog.calculateAlpha(z, w)).toBe(123);
    }
  });
});
