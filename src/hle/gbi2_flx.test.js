import { describe, expect, test } from 'bun:test';
import { Matrix4x4 } from '../graphics/Matrix4x4.js';
import { executeDisplayList } from './display_list.js';
import * as gbi from './gbi.js';
import { GBI2FLX } from './gbi2_flx.js';
import { create } from './microcodes.js';
import { NullRenderer } from './null_renderer.js';
import { RSPState } from './rsp_state.js';

function harness() {
  const ram = new DataView(new ArrayBuffer(0x2000));
  const state = new RSPState();
  state.reset(ram, 8);
  const microcode = new GBI2FLX(state, ram);
  microcode.renderer = new NullRenderer(state);
  state.segments[1] = 0x1000;
  for (let i = 0; i < 256; i++) {
    ram.setUint8(0x1000 + i, i);
  }
  ram.setInt16(0x1208, 256); // Alpha light points along +X, signed 8.8.
  state.lights[0].color = { r: 0.2, g: 0.4, b: 0.6 };
  for (let i = 0; i < 4; i++) {
    const address = 0x1400 + i * 16;
    ram.setInt16(address + 8, 64);
    ram.setInt16(address + 10, -96);
    ram.setInt8(address + 12, [-127, -63, 0, 127][i]);
    ram.setUint8(address + 15, 41);
  }
  microcode.executeDmaIo(0xd622c0ff, 0x01000000);
  microcode.executeMoveMem(0xdc08030a, 0x01000200);
  microcode.executeGeometryMode(0xd9000000, 0x00060000);
  return { ram, state, microcode };
}

const alphas = state => state.projectedVertices.slice(0, 4).map(vertex => vertex.color >>> 24);

describe('F3DFLX alpha lighting', () => {
  test('decodes captured commands and caches normal-indexed alpha without changing RGB or UVs', () => {
    for (const disassemble of [false, true]) {
      const { ram, state, microcode } = harness();
      const commands = [
        [0xd9000000, 0x00a60405], // F-Zero X's car geometry mode.
        [0xd622c0ff, 0x01000000],
        [0xdc08030a, 0x01000200],
        [0xd7000002, 0xffffffff],
        [0x01004008, 0x01000400],
        [0x06000204, 0x00020406],
        [0xdf000000, 0],
      ];
      commands.forEach(([cmd0, cmd1], i) => {
        ram.setUint32(8 + i * 8, cmd0);
        ram.setUint32(12 + i * 8, cmd1);
      });
      const colors = [], coords = [], text = [];
      microcode.renderer.flushTris = buffer => {
        colors.push(...buffer.colours.slice(0, buffer.numTris * 3));
        coords.push(...buffer.coords.slice(0, buffer.numTris * 6));
      };
      const disassembler = disassemble ? { begin() {}, end() {}, tip() {}, text: s => text.push(s) } : null;
      executeDisplayList(state, microcode, { disassembler });
      expect(alphas(state)).toEqual([0, 65, 128, 255]);
      expect(colors.map(c => c >>> 24)).toEqual([255, 128, 65, 128, 65, 0]);
      expect(colors.map(c => c & 0xffffff)).toEqual(Array(6).fill(0x996633));
      expect(coords).toEqual(Array(6).fill([2, -3]).flat());
      expect(state.geometryMode.textureGen).toBe(0);
      expect(state.geometryModeBits & gbi.GeometryModeGBI2.G_TEXTURE_GEN).not.toBe(0);
      if (disassemble) {
        expect(text).toContain('gsSPF3DFLXAlphaTable(0x00001000);');
        expect(text).toContain('gsSPF3DFLXAlphaLight(0x00001200);');
      }
    }
  });

  test('uses signed 16-bit light components and the transposed modelview, ignoring translation', () => {
    const { ram, state, microcode } = harness();
    ram.setInt16(0x1208, 0);
    ram.setInt16(0x120a, -512);
    microcode.executeMoveMem(0xdc08030a, 0x01000200);
    state.modelview[0] = new Matrix4x4([
      0, -2, 0, 999,
      2, 0, 0, -123,
      0, 0, 2, 456,
      0, 0, 0, 1,
    ]);
    state.combinedMatrixDirty = true;
    microcode.loadVertices(0, 4, 0x1400);
    expect(alphas(state)).toEqual([255, 191, 128, 0]);
  });

  test('only newly loaded lit vertices use alpha lighting; distance fog still overrides it', () => {
    const { ram, state, microcode } = harness();
    microcode.loadVertices(0, 4, 0x1400);
    const cached = alphas(state);
    for (let i = 0; i < 256; i++) {
      ram.setUint8(0x1600 + i, 23);
    }
    microcode.executeDmaIo(0xd622c0ff, 0x01000600);
    expect(alphas(state)).toEqual(cached);
    microcode.loadVertices(0, 1, 0x1400);
    expect(alphas(state)).toEqual([23, 65, 128, 255]);

    microcode.executeGeometryMode(0xd9000000, 0x00070000);
    state.fogParameters.set(0, 77);
    microcode.loadVertices(0, 4, 0x1400);
    expect(alphas(state)).toEqual([77, 77, 77, 77]);
    microcode.executeGeometryMode(0xd9000000, 0x00040000); // No lighting.
    microcode.loadVertices(0, 4, 0x1400);
    expect(alphas(state)).toEqual([41, 41, 41, 41]);
    microcode.executeGeometryMode(0xd9000000, 0x00020000); // No alpha generation.
    microcode.loadVertices(0, 4, 0x1400);
    expect(alphas(state)).toEqual([255, 255, 255, 255]);
  });

  test('ordinary lights still load through GBI2 and microcode switches restore texture generation', () => {
    const { ram, state, microcode } = harness();
    ram.setUint32(0x1220, 0x123456ff);
    microcode.executeMoveMem(0xdc08060a, 0x01000220);
    expect(state.lights[0].color.r).toBeCloseTo(0x12 / 255);
    for (const [version, texgen] of [
      ['RSP Gfx ucode F3DEX fifo 2.08', 1],
      ['RSP Gfx ucode F3DFLX.Rej fifo 2.03F', 0],
      ['RSP Gfx ucode F3DEX fifo 2.08', 1],
    ]) {
      create({ detectVersionString: () => version, computeMicrocodeHash: () => 0 }, state, ram);
      expect(state.geometryMode.textureGen).toBe(texgen);
    }
  });
});
