import { describe, expect, test } from 'bun:test';
import { GBI0 } from './gbi0.js';
import { GBI1 } from './gbi1.js';
import { GBI2 } from './gbi2.js';
import { NullRenderer } from './null_renderer.js';
import { RSPState } from './rsp_state.js';

function harness(Type) {
  const ram = new DataView(new ArrayBuffer(256));
  const state = new RSPState();
  state.reset(ram, 0);
  const microcode = new Type(state, ram);
  microcode.renderer = new NullRenderer(state);
  const warnings = [];
  microcode.warn = (...args) => warnings.push(args);
  const command = (type, offset) => Type === GBI2
    ? (0xdb000000 | (type << 16) | offset) >>> 0
    : (0xbc000000 | (offset << 8) | type) >>> 0;
  const move = (type, offset, value, dis) => {
    const cmd0 = command(type, offset);
    microcode.getHandler(cmd0 >>> 24)(cmd0, value, dis);
  };
  return { ram, state, microcode, warnings, move };
}

for (const [Type, offsets] of [
  [GBI0, [0x00, 0x20, 0x40, 0x60, 0x80, 0xa0, 0xc0, 0xe0]],
  [GBI1, [0x00, 0x20, 0x40, 0x60, 0x80, 0xa0, 0xc0, 0xe0]],
  [GBI2, [0x00, 0x18, 0x30, 0x48, 0x60, 0x78, 0x90, 0xa8]],
]) {
  describe(`${Type.name} MoveWord LightCol`, () => {
    test('decodes both colour words in every slot without changing directions or other lights', () => {
      const { ram, state, microcode, warnings, move } = harness(Type);
      ram.setUint32(0x80, 0x11223344);
      ram.setInt8(0x88, -64);
      ram.setInt8(0x89, 32);
      ram.setInt8(0x8a, 127);
      for (let slot = 0; slot < 8; slot++) {
        microcode.loadLight(slot, 0x80);
      }
      const directions = state.lights.map(light => light.dir);
      const vectors = directions.map(dir => [...dir.elems]);
      for (const field of [0, 4]) {
        for (let slot = 0; slot < 8; slot++) {
          const before = state.lights.map(light => light.color);
          const value = field === 0 ? 0xf1802400 : 0x185ac3ff;
          move(0x0a, offsets[slot] + field, value);
          expect(state.lights[slot].color.r).toBeCloseTo((value >>> 24) / 255);
          expect(state.lights[slot].color.g).toBeCloseTo(((value >>> 16) & 255) / 255);
          expect(state.lights[slot].color.b).toBeCloseTo(((value >>> 8) & 255) / 255);
          for (let other = 0; other < 8; other++) {
            if (other !== slot) {
              expect(state.lights[other].color).toBe(before[other]);
            }
            expect(state.lights[other].dir).toBe(directions[other]);
            expect([...state.lights[other].dir.elems]).toEqual(vectors[other]);
          }
        }
      }
      expect(state.numLights).toBe(0);
      expect(warnings).toEqual([]);
    });

    test('updates diffuse and ambient lighting on new vertex loads, ignoring colour alpha', () => {
      const { ram, state, microcode, warnings, move } = harness(Type);
      state.geometryMode.lighting = 1;
      ram.setUint32(12, 0x00007f29); // +Z normal, source alpha 41.
      ram.setUint32(0x80, 0x00000000);
      ram.setInt8(0x8a, 127);
      microcode.loadLight(0, 0x80);
      move(0x02, 0, Type === GBI2 ? 24 : 0x80000040);
      microcode.loadVertices(0, 1, 0);
      expect(state.projectedVertices[0].color >>> 0).toBe(0xff000000);
      move(0x0a, offsets[0], 0x80402000);
      move(0x0a, offsets[0] + 4, 0x80402000);
      move(0x0a, offsets[1], 0x102040ff);
      move(0x0a, offsets[1] + 4, 0x102040ff);
      expect(state.projectedVertices[0].color >>> 0).toBe(0xff000000);
      microcode.loadVertices(1, 1, 0);
      expect(state.projectedVertices[1].color >>> 0).toBe(0xff606090);
      ram.setInt8(14, -127);
      microcode.loadVertices(2, 1, 0);
      expect(state.projectedVertices[2].color >>> 0).toBe(0xff402010);
      // Ambient is selected by the current count, even if updated beforehand.
      move(0x0a, offsets[7], 0x20408000);
      move(0x02, 0, Type === GBI2 ? 168 : 0x80000100);
      microcode.loadVertices(3, 1, 0);
      expect(state.projectedVertices[3].color >>> 0).toBe(0xff804020);
      expect(warnings).toEqual([]);
    });

    test('rejects non-colour fields and out-of-range slots without aliasing a light', () => {
      const { state, warnings, move } = harness(Type);
      const before = structuredClone(state.lights);
      for (const offset of [1, 2, 3, 5, 8, offsets[7] + 8, Type === GBI2 ? 0xc0 : 0x100, 0xffff]) {
        move(0x0a, offset, 0xffffffff);
      }
      expect(state.lights).toEqual(before);
      expect(warnings).toHaveLength(8);
    });

    test('keeps the individual colour-word offset in disassembly', () => {
      const { move, warnings } = harness(Type);
      const text = [];
      move(0x0a, offsets[2] + 4, 0x12345678, { text: value => text.push(value) });
      expect(text).toEqual([`gMoveWd(G_MW_LIGHTCOL, 0x00${(offsets[2] + 4).toString(16)}, 0x12345678);`]);
      expect(warnings).toEqual([]);
    });
  });
}

test('Hercules GBI2 command updates light 3, without MoveMem look-at bias', () => {
  const { state, microcode, warnings } = harness(GBI2);
  state.lights[2].color = { r: 1, g: 1, b: 1, a: 1 };
  microcode.executeMoveWord(0xdb0a0030, 0x00000000);
  expect(state.lights[2].color).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  expect(warnings).toEqual([]);
});
