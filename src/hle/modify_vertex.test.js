import { describe, expect, test } from 'bun:test';
import { Vector3 } from '../graphics/Vector3.js';
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
  describe(`${Type.name} ModifyVertex`, () => {
    test('RGBA writes affect only subsequent triangles, including disassembled lists', () => {
      for (const disassemble of [false, true]) {
        const { ram, state, microcode, warnings } = harness(Type);
        const commands = [
          triangle,
          [(opcode << 24) | 0x10000e, 0xff7864ff],
          triangle,
          [(opcode << 24) | 0x10000e, 0x12345600],
          triangle,
          [end, 0],
        ];
        commands.forEach(([cmd0, cmd1], i) => {
          ram.setUint32(8 + i * 8, cmd0);
          ram.setUint32(12 + i * 8, cmd1);
        });
        const draws = [];
        const text = [];
        microcode.renderer.flushTris = buffer => draws.push([...buffer.colours.slice(0, buffer.numTris * 3)]);
        const disassembler = disassemble ? { begin() {}, end() {}, text: s => text.push(s) } : null;
        executeDisplayList(state, microcode, { disassembler });
        expect(draws).toEqual([
          [0x78563412, 0x78563412, 0x78563412],
          [0x78563412, 0xff6478ff, 0x78563412],
          [0x78563412, 0x00563412, 0x78563412],
        ]);
        if (disassemble) {
          expect(text).toContain('gsSPModifyVertex(7,G_MWO_POINT_RGBA,0xff7864ff);');
        }
        expect(warnings).toEqual([]);
      }
    });

    test('RGBA replaces cached color and alpha without lighting, fog or other vertex changes', () => {
      const { state, microcode, warnings } = harness(Type);
      const vertex = state.projectedVertices[0];
      vertex.pos.z = 0.25;
      vertex.pos.w = 2;
      vertex.clipFlags = 0x15;
      const unchanged = () => [[...vertex.pos.elems], vertex.u, vertex.v, vertex.clipFlags, vertex.set];
      const before = unchanged();
      const otherColors = state.projectedVertices.slice(1).map(v => v.color);
      state.geometryMode.lighting = state.geometryMode.fog = state.geometryMode.textureGen = 1;
      state.fogParameters.set(0, 255);
      state.viewport.set(new Vector3(80, -60, 42), new Vector3(120, 90, 17));
      const modify = microcode.getHandler(opcode);
      for (const [rgba, abgr] of [
        [0xff7864ff, 0xff6478ff], // Clay Fighter's first observed command, slot 0.
        [0x12345678, 0x78563412],
        [0x89abcdef, 0xefcdab89],
        [0xff000000, 0x000000ff],
        [0x000000ff, 0xff000000],
        [0, 0],
        [0xffffffff, 0xffffffff],
      ]) {
        modify((opcode << 24) | 0x100000, rgba);
        expect(vertex.color >>> 0).toBe(abgr);
        expect(unchanged()).toEqual(before);
        expect(state.projectedVertices.slice(1).map(v => v.color)).toEqual(otherColors);
      }
      // A later vertex load must replace the modified cached color normally.
      state.geometryMode.lighting = state.geometryMode.fog = state.geometryMode.textureGen = 0;
      microcode.loadVertices(0, 1, 256);
      expect(vertex.color).toBe(0x78563412);
      expect(warnings).toEqual([]);
    });

    test('RGBA writes respect cache bounds and preserve the loaded flag', () => {
      const { state, microcode, warnings } = harness(Type);
      const modify = microcode.getHandler(opcode);
      modify((opcode << 24) | 0x10009e, 0x12345678);
      expect(state.projectedVertices[79].color).toBe(0x78563412);
      expect(state.projectedVertices[79].set).toBe(false);
      for (const index of [80, 32767]) {
        modify((opcode << 24) | 0x100000 | (index << 1), 0);
      }
      expect(warnings).toEqual([['crazy vertex index', 80], ['crazy vertex index', 32767]]);
      expect(state.projectedVertices).toHaveLength(80);
      expect(state.projectedVertices[79].color).toBe(0x78563412);
    });

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
        if (disassemble) {
          expect(text).toContain('gsSPModifyVertex(7,G_MWO_POINT_ST,0x0029004d);');
        }
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

    test('decodes signed quarter-pixel screen positions and preserves other cached attributes', () => {
      const { state, microcode, warnings } = harness(Type);
      const vertex = state.projectedVertices[0];
      vertex.clipFlags = 0x15;
      const unchanged = () => [vertex.pos.z, vertex.color, vertex.u, vertex.v, vertex.clipFlags, vertex.set];
      const before = unchanged();
      const otherPositions = state.projectedVertices.slice(1).map(v => [...v.pos.elems]);
      // Screen positions bypass the current viewport, including zero scales.
      state.viewport.set(new Vector3(0, 0, 42), new Vector3(120, 90, 17));
      state.geometryMode.fog = state.geometryMode.lighting = 1;
      state.fogParameters.set(0, 255);
      const modify = microcode.getHandler(opcode);
      for (const [width, height] of [[320, 240], [640, 480], [480, 288]]) {
        microcode.renderer.nativeTransform.initDimensions(width, height);
        for (const w of [1, 2, 149.6165771484375, 0, -2, 1e-40]) {
          vertex.pos.w = w;
          const storedW = vertex.pos.w;
          for (const [word, x, y] of [
            [0, 0, 0], // First observed Turok Rage Wars command.
            [0x028001e0, 160, 120],
            [0xffff0001, -0.25, 0.25],
            [0x0001ffff, 0.25, -0.25],
            [0x80007fff, -8192, 8191.75],
            [0x7fff8000, 8191.75, -8192],
          ]) {
            modify((opcode << 24) | 0x180000, word);
            expect(vertex.pos.x).toBe(Math.fround((x - width / 2) * storedW / (width / 2)));
            expect(vertex.pos.y).toBe(Math.fround((y - height / 2) * storedW / (-height / 2)));
            expect(vertex.pos.w).toBe(storedW);
            expect(unchanged()).toEqual(before);
          }
        }
      }
      expect(state.projectedVertices.slice(1).map(v => [...v.pos.elems])).toEqual(otherPositions);
      expect(warnings).toEqual([]);
    });

    test('screen-position writes affect subsequent triangles, including disassembled lists', () => {
      for (const disassemble of [false, true]) {
        const { ram, state, microcode, warnings } = harness(Type);
        const vertex = state.projectedVertices[7];
        vertex.pos.set(0.25, -0.5, 0.5, 2);
        const commands = [triangle, [(opcode << 24) | 0x18000e, 0x03c000f0], triangle, [end, 0]];
        commands.forEach(([cmd0, cmd1], i) => {
          ram.setUint32(8 + i * 8, cmd0);
          ram.setUint32(12 + i * 8, cmd1);
        });
        const draws = [];
        const text = [];
        microcode.renderer.flushTris = buffer => draws.push([...buffer.positions.slice(4, 8)]);
        const disassembler = disassemble ? { begin() {}, end() {}, text: s => text.push(s) } : null;
        executeDisplayList(state, microcode, { disassembler });
        expect(draws).toEqual([[0.25, -0.5, 0.5, 2], [1, 1, 0.5, 2]]);
        if (disassemble) {
          expect(text).toContain('gsSPModifyVertex(7,G_MWO_POINT_XYSCREEN,0x03c000f0);');
        }
        expect(warnings).toEqual([]);
      }
    });

    test('screen-position writes respect cache bounds and preserve the loaded flag', () => {
      const { state, microcode, warnings } = harness(Type);
      const modify = microcode.getHandler(opcode);
      state.projectedVertices[79].pos.w = 2;
      modify((opcode << 24) | 0x18009e, 0);
      expect([...state.projectedVertices[79].pos.elems]).toEqual([-2, 2, 0, 2]);
      expect(state.projectedVertices[79].set).toBe(false);
      for (const index of [80, 32767]) {
        modify((opcode << 24) | 0x180000 | (index << 1), 0);
      }
      expect(warnings).toEqual([['crazy vertex index', 80], ['crazy vertex index', 32767]]);
      expect(state.projectedVertices).toHaveLength(80);
    });

    test('replaces screen depth without reapplying the viewport or changing other cached attributes', () => {
      const { state, microcode, warnings } = harness(Type);
      const vertex = state.projectedVertices[0];
      vertex.pos.x = -86.68488311767578;
      vertex.pos.y = -124.35770416259766;
      vertex.clipFlags = 0x15;
      const unchanged = () => [vertex.pos.x, vertex.pos.y, vertex.color, vertex.u, vertex.v, vertex.clipFlags, vertex.set];
      const before = unchanged();
      // These draw-time changes must not transform the supplied screen depth
      // again or recompute the vertex's cached fog alpha and clipping flags.
      state.viewport.set(new Vector3(80, -60, 42), new Vector3(120, 90, 17));
      state.geometryMode.fog = 1;
      state.fogParameters.set(0, 255);
      const modify = microcode.getHandler(opcode);
      for (const w of [1, 2, 149.6165771484375, 0, -2, 1e-40]) {
        vertex.pos.w = w;
        const storedW = vertex.pos.w;
        for (const [word, ndcZ] of [
          [0, -511 / 512],
          [0x00018000, -509.5 / 512], // G.A.S.P character-select command.
          [0x01ff0000, 0],
          [0x01ff8000, 1 / 1024],
          [0x03ff0000, 1],
          [0xffff8000, 65024.5 / 512], // Decode the complete unsigned word.
        ]) {
          modify((opcode << 24) | 0x1c0000, word);
          expect(vertex.pos.z).toBe(Math.fround(ndcZ * storedW));
          expect(vertex.pos.w).toBe(storedW);
          expect(unchanged()).toEqual(before);
        }
      }
      expect(warnings).toEqual([]);
    });

    test('screen-depth changes affect subsequent triangles, including disassembled lists', () => {
      for (const disassemble of [false, true]) {
        const { ram, state, microcode, warnings } = harness(Type);
        const vertex = state.projectedVertices[7];
        vertex.pos.x = 0.25;
        vertex.pos.y = -0.5;
        vertex.pos.z = 0.5;
        vertex.pos.w = 2;
        const commands = [triangle, [(opcode << 24) | 0x1c000e, 0x00018000], triangle, [end, 0]];
        commands.forEach(([cmd0, cmd1], i) => {
          ram.setUint32(8 + i * 8, cmd0);
          ram.setUint32(12 + i * 8, cmd1);
        });
        const draws = [];
        const text = [];
        microcode.renderer.flushTris = buffer => draws.push([...buffer.positions.slice(4, 8)]);
        const disassembler = disassemble ? { begin() {}, end() {}, text: s => text.push(s) } : null;
        executeDisplayList(state, microcode, { disassembler });
        expect(draws).toEqual([[0.25, -0.5, 0.5, 2], [0.25, -0.5, -1019 / 512, 2]]);
        if (disassemble) {
          expect(text).toContain('gsSPModifyVertex(7,G_MWO_POINT_ZSCREEN,0x00018000);');
        }
        expect(warnings).toEqual([]);
      }
    });
  });
}
