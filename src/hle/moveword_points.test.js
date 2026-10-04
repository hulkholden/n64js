import { expect, test } from 'bun:test';
import { Matrix4x4 } from '../graphics/Matrix4x4.js';
import { Transform4D } from '../graphics/Transform4D.js';
import { Vector4 } from '../graphics/Vector4.js';
import { executeDisplayList } from './display_list.js';
import { GBI0 } from './gbi0.js';
import { GBI1 } from './gbi1.js';
import { GBI2 } from './gbi2.js';
import { NullRenderer } from './null_renderer.js';
import { RSPState } from './rsp_state.js';

function harness(Type) {
  const ram = new DataView(new ArrayBuffer(4096));
  const state = new RSPState();
  state.reset(ram, 8);
  const microcode = new Type(state, ram);
  microcode.renderer = new NullRenderer(state);
  microcode.renderer.nativeTransform.viTransform = new Transform4D();
  state.viewport.transform = new Transform4D();
  const warnings = [];
  microcode.warn = (...args) => warnings.push(args);
  return { ram, state, microcode, warnings };
}

for (const Type of [GBI0, GBI1]) {
  test(`${Type.name} Points decodes 40-byte records and all four fields`, () => {
    const { state, microcode, warnings } = harness(Type);
    const vertex = state.projectedVertices[7];
    vertex.pos.w = 2;
    vertex.set = true;
    microcode.renderer.nativeTransform.viTransform = new Transform4D(new Vector4(160, -120, 10, 1), new Vector4(160, 120, 20, 0));
    const command = offset => 0xbc00000c | ((7 * 40 + offset) << 8);
    const text = [];
    const dis = { text: s => text.push(s) };
    microcode.getHandler(0xbc)(command(0x10), 0xff786440, dis);
    expect(vertex.color).toBe(0x406478ff);
    microcode.executeMoveWord(command(0x14), 0xffc00060, dis);
    expect([vertex.u, vertex.v]).toEqual([-2, 3]);
    microcode.executeMoveWord(command(0x18), 0xff800100, dis); // (-32, 64) screen pixels.
    expect(vertex.pos.x).toBeCloseTo(-2.4, 6);
    expect(vertex.pos.y).toBeCloseTo(14 / 15, 6);
    microcode.executeMoveWord(command(0x1c), 0x001e8000, dis);
    expect(vertex.pos.z).toBeCloseTo(2.1, 6);
    expect(vertex.pos.w).toBe(2);
    expect(vertex.set).toBe(true);
    expect(state.projectedVertices[6].color).toBe(0);
    expect(text[0]).toBe('gsSPModifyVertex(7,G_MWO_POINT_RGBA,0xff786440);');
    expect(warnings).toEqual([]);
  });

  test(`${Type.name} Points rejects invalid fields and indices without aliasing`, () => {
    const { state, microcode, warnings } = harness(Type);
    const last = state.projectedVertices.length - 1;
    microcode.executeMoveWord(0xbc00000c | ((last * 40 + 0x10) << 8), 0x12345678);
    expect(state.projectedVertices[last].color).toBe(0x78563412);
    microcode.executeMoveWord(0xbc00000c | (((last + 1) * 40 + 0x10) << 8), 0);
    microcode.executeMoveWord(0xbc00000c | ((last * 40 + 0x11) << 8), 0);
    expect(state.projectedVertices[last].color).toBe(0x78563412);
    expect(warnings.map(w => w[0])).toEqual(['crazy vertex index', 'modifyVtx']);
  });
}

test('GBI1 Points modifies only subsequent triangle submissions', () => {
  const { ram, state, microcode } = harness(GBI1);
  for (const vertex of state.projectedVertices.slice(0, 3)) {
    vertex.set = true;
    vertex.color = 0xffe06020;
  }
  const tri = [0xbf000000, 0x00000204];
  const commands = [tri, [0xbc00380c, 0xff7864ff], tri, [0xb8000000, 0]];
  commands.forEach(([a, b], i) => {
    ram.setUint32(8 + i * 8, a);
    ram.setUint32(12 + i * 8, b);
  });
  const draws = [];
  microcode.renderer.flushTris = buffer => draws.push([...buffer.colours.slice(0, 3)]);
  executeDisplayList(state, microcode);
  expect(draws).toEqual([[0xffe06020, 0xffe06020, 0xffe06020], [0xffe06020, 0xff6478ff, 0xffe06020]]);
});

function writeMatrix(ram, address, elements) {
  elements.forEach((value, i) => {
    const offset = (i % 4) * 8 + (i >> 2) * 2;
    const fixed = value * 65536;
    ram.setInt16(address + offset, fixed >> 16);
    ram.setUint16(address + 32 + offset, fixed & 0xffff);
  });
}

test('WCW GBI2 ForceMatrix pair replaces the combined transform, preserves stacks and cached vertices', () => {
  const { ram, state, microcode, warnings } = harness(GBI2);
  const forced = [2, 0, 0, -3.5, 0, 3, 0, 1.25, 0, 0, 4, 0, 0, 0, 0, 1];
  writeMatrix(ram, 0x400, forced);
  ram.setInt16(0x600, 1);
  ram.setInt16(0x602, 2);
  ram.setInt16(0x604, 3);
  ram.setUint32(0x60c, 0xffffffff);
  state.segments[1] = 0x400;
  microcode.loadVertices(0, 1, 0x600);
  const cached = [...state.projectedVertices[0].pos.elems];
  const text = [];
  microcode.executeMoveMem(0xdc38000e, 0x01000000, { text: s => text.push(s), tip() {} });
  microcode.executeMoveWord(0xdb0c0000, 0x00010000, { text: s => text.push(s) });
  microcode.loadVertices(1, 1, 0x600);
  expect([...state.projectedVertices[1].pos.elems]).toEqual([-1.5, 7.25, 12, 1]);
  expect([...state.projectedVertices[0].pos.elems]).toEqual(cached);
  expect([...state.modelview[0].elems]).toEqual([...Matrix4x4.identity().elems]);
  expect([...state.projection[0].elems]).toEqual([...Matrix4x4.identity().elems]);
  expect(text).toContain('gMoveWd(G_MW_FORCEMTX, 0x0000, 0x00010000);');
  expect(warnings).toEqual([]);
  microcode.executeMoveWord(0xdb0c0000, 0);
  microcode.loadVertices(2, 1, 0x600);
  expect([...state.projectedVertices[2].pos.elems]).toEqual([1, 2, 3, 1]);
});

test('matrix load, multiply, pop and task reset invalidate a forced combined matrix', () => {
  for (const Type of [GBI1, GBI2]) {
    for (const action of ['load', 'multiply', 'pop', 'reset']) {
      const { ram, state, microcode } = harness(Type);
      writeMatrix(ram, 0x400, [...Matrix4x4.identity().elems]);
      state.combinedMatrix = new Matrix4x4(new Array(16).fill(2));
      state.modelview.push(Matrix4x4.identity());
      if (action === 'reset') {
        state.reset(ram, 8);
      } else if (action === 'pop') {
        microcode.executePopMatrix(0, Type === GBI2 ? 64 : 0);
      } else {
        microcode.executeMatrix(Type === GBI2 ? (action === 'load' ? 0xda380003 : 0xda380001) : (action === 'load' ? 0x01020040 : 0x01000040), 0x400);
      }
      expect(state.combinedMatrix).toBeNull();
    }
  }
});

test('GBI2 ForceMatrix flag never interprets its offset as a vertex update', () => {
  const { state, microcode, warnings } = harness(GBI2);
  const before = state.projectedVertices.map(v => v.color);
  microcode.executeMoveWord(0xdb0c0010, 0xff7864ff);
  expect(state.projectedVertices.map(v => v.color)).toEqual(before);
  expect(warnings[0][0]).toBe('MoveWord ForceMatrix invalid offset');
  microcode.executeMoveWord(0xdb0c0000, 0x10000);
  expect([...state.combinedMatrix.elems]).toEqual([...Matrix4x4.identity().elems]);
});

test('GBI2 ForceMatrix disassembly reads exactly the encoded 64 bytes', () => {
  const { ram, microcode } = harness(GBI2);
  const address = ram.byteLength - 64;
  writeMatrix(ram, address, [...Matrix4x4.identity().elems]);
  expect(() => microcode.executeMoveMem(0xdc38000e, address, { text() {}, tip() {} })).not.toThrow();
});
