import { expect, test } from 'bun:test';
import { Matrix4x4 } from '../../../graphics/Matrix4x4.js';
import { NullRenderer } from '../null_renderer.js';
import { RSPState } from '../rsp_state.js';
import { GBI0 } from './gbi0.js';
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
  const insert = (offset, value) => microcode.executeMoveWord(
    Type === GBI2 ? 0xdb000000 | offset : 0xbc000000 | (offset << 8), value);
  return { ram, state, microcode, warnings, insert };
}

for (const Type of [GBI0, GBI1, GBI2]) {
  test(`${Type.name} inserts all integer/fraction pairs in N64 matrix order`, () => {
    const { state, insert, warnings } = harness(Type);
    state.getCombinedMatrix();
    const modelview = [...state.modelview[0].elems];
    const projection = [...state.projection[0].elems];
    for (let offset = 0; offset < 32; offset += 4) {
      insert(offset, 0xffff0002); // -1 + fraction, 2 + fraction.
      insert(offset + 32, 0x80000001);
    }
    expect([...state.getCombinedMatrix().elems]).toEqual([
      -0.5, -0.5, -0.5, -0.5,
      2 + 1/65536, 2 + 1/65536, 2 + 1/65536, 2 + 1/65536,
      -0.5, -0.5, -0.5, -0.5,
      2 + 1/65536, 2 + 1/65536, 2 + 1/65536, 2 + 1/65536,
    ]);
    expect([...state.modelview[0].elems]).toEqual(modelview);
    expect([...state.projection[0].elems]).toEqual(projection);
    expect(warnings).toEqual([]);
  });

  test(`${Type.name} preserves the other halfword and ignores invalid offsets`, () => {
    const { state, insert, warnings } = harness(Type);
    const matrix = state.getCombinedMatrix();
    matrix.elems[3] = -2.25;
    matrix.elems[7] = 32767 + 65535/65536;
    insert(0x38, 0x40008000);
    expect(matrix.elems[3]).toBe(-2.75);
    expect(matrix.elems[7]).toBe(32767.5);
    insert(0x18, 0x8000ffff);
    expect(matrix.elems[3]).toBe(-32767.75);
    expect(matrix.elems[7]).toBe(-0.5);
    const before = [...matrix.elems];
    for (const offset of [1, 2, 0x3e, 0x40, 0xffff]) {
      insert(offset, 0);
    }
    expect([...matrix.elems]).toEqual(before);
    expect(warnings).toHaveLength(5);
  });
}

test('GBI1 materializes the stack product, affects future vertices, and loses inserts on matrix change', () => {
  const { ram, state, microcode, insert } = harness(GBI1);
  state.modelview[0].elems[0] = 2;
  state.projection[0].elems[0] = 3;
  ram.setInt16(0x100, 1);
  microcode.loadVertices(0, 1, 0x100);
  const before = [...state.projectedVertices[0].pos.elems];
  state.combinedMatrixDirty = true;
  insert(0x20, 0x80000000); // X scale 6.5, retain current integer halves.
  expect(state.getCombinedMatrix().elems[0]).toBe(6.5);
  microcode.loadVertices(1, 1, 0x100);
  expect(state.projectedVertices[1].pos.x).not.toBe(state.projectedVertices[0].pos.x);
  expect([...state.projectedVertices[0].pos.elems]).toEqual(before);
  state.modelview.push(Matrix4x4.identity());
  microcode.executePopMatrix(0, 0);
  expect(state.getCombinedMatrix().elems[0]).toBe(6);
  state.reset(ram, 8);
  expect(state.getCombinedMatrix().elems[0]).toBe(1);
});

test('GBI2 raw insertion preserves the valid flag and does not trigger lazy multiplication', () => {
  const { state, microcode, insert } = harness(GBI2);
  state.modelview[0].elems[0] = 3;
  insert(0, 0x00020000);
  expect(state.combinedMatrix.elems[0]).toBe(2);
  expect(state.combinedMatrixDirty).toBe(true);
  expect(state.getCombinedMatrix().elems[0]).toBe(3);
  state.combinedMatrixDirty = true;
  insert(0, 0x00040000);
  microcode.executeMoveWord(0xdb0c0000, 0x00010000);
  expect(state.getCombinedMatrix().elems[0]).toBe(4);
});
