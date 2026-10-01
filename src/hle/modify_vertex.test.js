import { describe, expect, test } from 'bun:test';
import { executeDisplayList } from './display_list.js';
import { GBI1 } from './gbi1.js';
import { GBI2 } from './gbi2.js';
import { NullRenderer } from './null_renderer.js';
import { RSPState } from './rsp_state.js';

function harness(Type) {
  const ram = new DataView(new ArrayBuffer(1024));
  const state = new RSPState();
  state.reset(ram, 8);
  state.setTexture(0.5, 0.25, 0, 0);
  const microcode = new Type(state, ram);
  microcode.renderer = new NullRenderer(state);
  const warnings = [];
  microcode.warn = (message, detail) => warnings.push([message, detail]);
  for (let i = 0; i < 8; ++i) {
    ram.setInt16(256 + i * 16 + 8, i * 64);
    ram.setInt16(256 + i * 16 + 10, -i * 128);
    ram.setUint32(256 + i * 16 + 12, 0x12345678);
  }
  microcode.loadVertices(0, 8, 256);
  return { ram, state, microcode, warnings };
}

for (const [Type, opcode, triangle, end] of [
  [GBI1, 0xb2, [0xbf000000, 0x000c0e02], 0xb8000000],
  [GBI2, 0x02, [0x05020e0c, 0], 0xdf000000],
]) {
  describe(`${Type.name} ModifyVertex texture coordinates`, () => {
    test('updates subsequent triangles without rescaling or changing the previous draw', () => {
      for (const disassemble of [false, true]) {
        const { ram, state, microcode, warnings } = harness(Type);
        const commands = [
          triangle,
          // Captured G.A.S.P update to slot 7, with the opcode adapted for GBI2.
          [(opcode << 24) | 0x14000e, 0x0029004d],
          triangle,
          [end, 0],
        ];
        commands.forEach(([cmd0, cmd1], i) => {
          ram.setUint32(8 + i * 8, cmd0);
          ram.setUint32(12 + i * 8, cmd1);
        });
        const draws = [];
        const text = [];
        microcode.renderer.flushTris = buffer => draws.push([...buffer.coords.slice(0, buffer.numTris * 6)]);
        const disassembler = disassemble ? { begin() {}, end() {}, text: s => text.push(s) } : null;
        executeDisplayList(state, microcode, { disassembler });
        expect(draws).toEqual([
          [6, -6, 7, -7, 1, -1],
          [6, -6, 41 / 32, 77 / 32, 1, -1],
        ]);
        if (disassemble) expect(text).toContain('gsSPModifyVertex(7,G_MWO_POINT_ST,0x0029004d);');
        expect(warnings).toEqual([]);
      }
    });

    test('decodes signed fixed-point coordinates independently of current texture scale', () => {
      const { state, microcode, warnings } = harness(Type);
      const vertex = state.projectedVertices[7];
      const position = [...vertex.pos.elems];
      const color = vertex.color;
      const clipFlags = vertex.clipFlags;
      const modify = microcode.getHandler(opcode);
      // Neither matrix/lighting/fog state nor zero texture scales should
      // change a post-transform cache write.
      state.geometryMode.fog = state.geometryMode.lighting = 1;
      state.fogParameters.set(0, 255);
      state.setTexture(0, 0, 0, 0);
      for (const [word, u, v] of [
        [0xffe00050, -1, 2.5],
        [0x7fff8000, 1023.96875, -1024],
        [0x80007fff, -1024, 1023.96875],
      ]) {
        modify((opcode << 24) | 0x14000e, word);
        expect([vertex.u, vertex.v]).toEqual([u, v]);
        expect([...vertex.pos.elems]).toEqual(position);
        expect(vertex.color).toBe(color);
        expect(vertex.clipFlags).toBe(clipFlags);
        expect(vertex.set).toBe(true);
      }
      expect(warnings).toEqual([]);
    });

    test('allows the last cache slot and rejects out-of-range indices', () => {
      const { state, microcode, warnings } = harness(Type);
      const modify = microcode.getHandler(opcode);
      modify((opcode << 24) | 0x14009e, 0x0060ffe0);
      expect(state.projectedVertices[79].u).toBe(3);
      expect(state.projectedVertices[79].v).toBe(-1);
      for (const index of [80, 32767]) {
        modify((opcode << 24) | 0x140000 | (index << 1), 0);
      }
      expect(warnings).toEqual([['crazy vertex index', 80], ['crazy vertex index', 32767]]);
      expect(state.projectedVertices).toHaveLength(80);
      expect(state.projectedVertices[79].u).toBe(3);
    });
  });
}
