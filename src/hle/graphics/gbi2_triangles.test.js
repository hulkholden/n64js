import { describe, expect, test } from 'bun:test';
import { executeDisplayList } from './display_list.js';
import { GBI2 } from './gbi2.js';
import { NullRenderer } from './null_renderer.js';
import { RSPState } from './rsp_state.js';

function harness(commands) {
  const ramDV = new DataView(new ArrayBuffer(0x4000));
  commands.forEach(([cmd0, cmd1], i) => {
    ramDV.setUint32(8 + i * 8, cmd0);
    ramDV.setUint32(12 + i * 8, cmd1);
  });
  const state = new RSPState();
  let syncs = 0;
  state.reset(ramDV, 8, () => { syncs++; });
  const microcode = new GBI2(state, ramDV);
  microcode.renderer = new NullRenderer(state);
  const coords = [];
  const batchSizes = [];
  microcode.renderer.flushTris = buffer => {
    batchSizes.push(buffer.numTris);
    coords.push(...buffer.coords.slice(0, buffer.numTris * 6));
    buffer.reset();
  };
  const warnings = [];
  microcode.warn = message => warnings.push(message);
  for (let i = 0; i < state.projectedVertices.length; ++i) {
    state.projectedVertices[i].u = i;
    state.projectedVertices[i].v = -i || 0;
    // Also prepare vertex input for the captured load command.
    ramDV.setInt16(0x2000 + i * 16 + 8, i * 32);
    ramDV.setInt16(0x2000 + i * 16 + 10, -i * 32);
  }
  return { ramDV, state, microcode, coords, batchSizes, warnings, syncs: () => syncs };
}

function triangle(opcode, indices) {
  return (opcode << 24) | (indices[2] << 17) | (indices[1] << 9) | (indices[0] << 1);
}

function expectedCoords(indices) {
  return indices.flatMap(index => [index, -index || 0]);
}

const end = [0xdf000000, 0];
const sync = [0xe9000000, 0];

describe('GBI2 degenerate triangles', () => {
  for (const disassemble of [false, true]) {
    test(`executes Pro Yakyuu King 2's ROM sub-list ${disassemble ? 'with disassembly' : 'batched'}`, () => {
      const h = harness([
        // ROM 0x4074c0, reached at RDRAM 0x319b60. Only the vertex address is rebased.
        [0x0100600c, 0x2000],
        [0x06fefefe, 0x00fefefe],
        [0x06080002, 0x00020a08],
        end,
      ]);
      const text = [];
      const disassembler = disassemble ? {
        begin() {}, text(line) { text.push(line); }, tip() {}, end() {},
      } : null;
      executeDisplayList(h.state, h.microcode, { disassembler });
      expect(h.coords).toEqual(expectedCoords([4, 5, 1, 1, 0, 4]));
      expect(h.warnings).toEqual([]);
      expect(h.state.projectedVertices.slice(0, 6).every(vertex => vertex.set)).toBe(true);
      expect(h.state.currentOp).toBe(4);
      expect(h.state.pc).toBe(0);
      if (disassemble) {
        expect(text).toContain('gsSP2Triangles(127,127,127, 127,127,127);');
      }
    });
  }

  for (const opcode of [5, 6, 7]) {
    test(`opcode ${opcode} rejects every repeated-index pair and preserves adjacent triangles`, () => {
      const degenerates = [[127, 127, 127], [127, 127, 1], [1, 127, 127], [127, 1, 127], [0, 0, 1]];
      const valid = [0, 1, 2];
      const commands = degenerates.flatMap(indices => opcode === 5 ? [
        [triangle(opcode, indices), 0], [triangle(opcode, valid), 0],
      ] : [
        [triangle(opcode, indices), triangle(0, valid)],
        [triangle(opcode, valid), triangle(0, indices)],
      ]);
      const h = harness([...commands, sync, end]);
      executeDisplayList(h.state, h.microcode);
      const copies = degenerates.length * (opcode === 5 ? 1 : 2);
      expect(h.coords).toEqual(Array.from({ length: copies }, () => expectedCoords(valid)).flat());
      expect(h.state.currentOp).toBe(commands.length + 2);
      expect(h.syncs()).toBe(1);
      expect(h.warnings).toEqual([]);
    });

    test(`opcode ${opcode} keeps batches of discarded triangles bounded`, () => {
      const command = [triangle(opcode, [127, 127, 127]), triangle(0, [127, 127, 127])];
      const h = harness([...Array.from({ length: 128 }, () => command), sync, end]);
      const limit = opcode === 5 ? 64 : 32;
      expect(() => executeDisplayList(h.state, h.microcode, { commandLimit: limit })).toThrow('command limit');
      expect(h.state.currentOp).toBe(limit);
      expect(h.batchSizes).toEqual([0]);
      expect(h.syncs()).toBe(0);
    });

    test(`opcode ${opcode} does not discard distinct invalid indices`, () => {
      const h = harness([[triangle(opcode, [125, 126, 127]), triangle(0, [0, 1, 2])], end]);
      expect(() => executeDisplayList(h.state, h.microcode)).toThrow(TypeError);
    });
  }
});
