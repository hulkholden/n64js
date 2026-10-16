import { describe, expect, test } from 'bun:test';
import { Matrix4x4 } from '../../../graphics/Matrix4x4.js';
import { Vector3 } from '../../../graphics/Vector3.js';
import { executeDisplayList } from '../display_list.js';
import { NullRenderer } from '../null_renderer.js';
import { RSPState } from '../rsp_state.js';
import { GBI1 } from './gbi1.js';
import { GBI2 } from './gbi2.js';

function harness(Type) {
  const ram = new DataView(new ArrayBuffer(4096));
  const state = new RSPState();
  state.reset(ram, 8);
  const microcode = new Type(state, ram);
  microcode.renderer = new NullRenderer(state);
  const warnings = [];
  microcode.warn = (...args) => warnings.push(args);
  const write = (address, commands) => commands.forEach(([a, b], i) => {
    ram.setUint32(address + 8 * i, a);
    ram.setUint32(address + 8 * i + 4, b);
  });
  return { state, microcode, warnings, write };
}

for (const Type of [GBI1, GBI2]) {
  const branch = Type === GBI1 ? 0xb0000000 : 0x04000000;
  const half = Type === GBI1 ? 0xb4000000 : 0xe1000000;
  const end = Type === GBI1 ? 0xb8000000 : 0xdf000000;
  const call = Type === GBI1 ? 0x06000000 : 0xde000000;
  describe(`${Type.name} depth branches`, () => {
    for (const delta of [-1, 0, 1]) {
      test(`depth threshold ${delta}: branches without pushing and returns to caller`, () => {
        const { state, microcode, warnings, write } = harness(Type);
        const v = state.projectedVertices[7];
        v.set = true;
        microcode.modifyVertex(7, 0x1c, 0x03a50001);
        state.segments[3] = 0x100;
        write(8, [[call, 0x40], [0xfa000000, 0x12345678], [end, 0]]);
        write(0x40, [[half, 0x03000080], [branch | (7 * 5 << 12) | 14, 0x03a50001 + delta],
          [0xfb000000, 0x11111111], [end, 0]]);
        write(0x180, [[0xfb000000, 0x22222222], [end, 0]]);
        executeDisplayList(state, microcode, { commandLimit: 20 });
        const taken = delta > 0 || (delta === 0 && Type === GBI1);
        expect(state.envColor).toBe(taken ? 0x22222222 : 0x11111111);
        expect(state.primColor).toBe(0x12345678);
        expect(state.dlistStack).toEqual([]);
        expect(state.pc).toBe(0);
        expect(warnings).toEqual([]);
      });
    }

    test('uses cached viewport depth, including W division and ZSCREEN updates', () => {
      const { state, microcode } = harness(Type);
      const vertex = state.projectedVertices[0];
      vertex.set = true;
      const matrix = Matrix4x4.identity();
      matrix.elems[15] = 2;
      state.viewport.transform.scale.z = 100;
      state.viewport.transform.trans.z = 200;
      microcode.projectInPlace(vertex, new Vector3(0, 0, 1), matrix,
        state.viewport.transform, microcode.renderer.nativeTransform.viTransform);
      expect(vertex.screenZ).toBe(250 * 65536);
      state.viewport.transform.scale.z = 999;
      state.rdpHalf1Cmd1 = 0x200;
      microcode.executeBranchZ(branch, 249 * 65536);
      expect(state.pc).toBe(8);
      microcode.executeBranchZ(branch, 251 * 65536);
      expect(state.pc).toBe(0x200);
      microcode.modifyVertex(0, 0x1c, 0x01000001);
      expect(vertex.screenZ).toBe(0x01000001);
      state.pc = 8;
      microcode.executeBranchZ(branch, 0x01000001);
      expect(state.pc).toBe(Type === GBI1 ? 0x200 : 8);
    });

    test('rejects unset, out-of-range and unaligned indices without branching', () => {
      const { state, microcode, warnings } = harness(Type);
      state.rdpHalf1Cmd1 = 0x200;
      for (const offset of [0, 1, 160, 4095]) {
        microcode.executeBranchZ(branch | offset, 0x7fffffff);
      }
      expect(state.pc).toBe(8);
      expect(warnings).toHaveLength(4);
    });

    test('disassembles the target and retains the command budget for cyclic branches', () => {
      const { state, microcode, write } = harness(Type);
      state.projectedVertices[0].set = true;
      const texts = [];
      write(8, [[half, 0x40], [branch, 65536], [end, 0]]);
      write(0x40, [[half, 8], [branch, 65536]]);
      expect(() => executeDisplayList(state, microcode, { commandLimit: 8,
        disassembler: { begin() {}, end() {}, text: s => texts.push(s) } })).toThrow('command limit');
      expect(texts).toContain('gsSPBranchLessZraw(0x00000040, 0, 0x00010000);');
    });
  });
}

test('F3DZEX branches on signed integer clip W rather than screen Z', () => {
  const { state, microcode } = harness(GBI2);
  microcode.version = 'RSP Gfx ucode F3DZEX.NoN fifo 2.06H';
  state.rdpHalf1Cmd1 = 0x100;
  const vertex = state.projectedVertices[3];
  vertex.set = true;
  vertex.screenZ = 1000 * 65536;
  vertex.pos.w = 4.5;
  microcode.executeBranchZ(0x04000006, 4);
  expect(state.pc).toBe(8);
  microcode.executeBranchZ(0x04000006, 5);
  expect(state.pc).toBe(0x100);
  state.pc = 8;
  vertex.pos.w = -1.5; // The signed integer halfword is -2, not -1.
  microcode.executeBranchZ(0x04000006, -1);
  expect(state.pc).toBe(0x100);
});
