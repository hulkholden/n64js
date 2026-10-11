import { describe, expect, test } from 'bun:test';
import { Matrix4x4 } from '../../../graphics/Matrix4x4.js';
import { Transform4D } from '../../../graphics/Transform4D.js';
import { executeDisplayList } from '../display_list.js';
import * as gbi from '../gbi.js';
import { create } from '../microcodes.js';
import { NullRenderer } from '../null_renderer.js';
import { RSPState } from '../rsp_state.js';
import { GBI2 } from './gbi2.js';
import { GBI2Conker } from './gbi2_conker.js';

function harness() {
  // Nonzero byteOffset also checks that vertex previews respect the RAM view.
  const ram = new DataView(new ArrayBuffer(0x4100), 0x100, 0x4000);
  const state = new RSPState();
  state.reset(ram, 8);
  const microcode = new GBI2Conker(state, ram);
  microcode.renderer = new NullRenderer(state);
  microcode.renderer.nativeTransform.viTransform = new Transform4D();
  state.viewport.transform = new Transform4D();
  const warnings = [], triangles = [], text = [];
  microcode.warn = (...args) => warnings.push(args);
  microcode.renderer.flushTris = buffer => {
    triangles.push(...buffer.colours.slice(0, buffer.numTris * 3));
    buffer.reset();
  };
  const disassembler = { begin() {}, end() {}, tip() {}, text: s => text.push(s) };
  const write = (address, commands) => commands.forEach(([a, b], i) => {
    ram.setUint32(address + i * 8, a);
    ram.setUint32(address + i * 8 + 4, b);
  });
  const vertex = (address, { xyz = [1, 2, 3], flag = 0, st = [64, -96], rgba = 0xc864327b } = {}) => {
    xyz.forEach((v, i) => ram.setInt16(address + i * 2, v));
    ram.setUint16(address + 6, flag);
    st.forEach((v, i) => ram.setInt16(address + 8 + i * 2, v));
    ram.setUint32(address + 12, rgba);
  };
  const light = (slot, { rgba = 0, dir = [0, 0, 127], pos = [0, 0, 0], attenuation = 0 } = {}) => {
    const address = 0x1000 + slot * 48;
    ram.setUint32(address, rgba);
    dir.forEach((v, i) => ram.setInt8(address + 8 + i, v));
    ram.setUint8(address + 12, attenuation);
    pos.forEach((v, i) => ram.setInt16(address + 32 + i * 2, v));
    microcode.executeMoveMem(0xdc28000a | ((slot + 2) * 48 << 5), address);
  };
  return { ram, state, microcode, warnings, triangles, text, disassembler, write, vertex, light,
    run(commands, options = {}) {
      write(8, commands);
      state.pc = 8;
      executeDisplayList(state, microcode, options);
    },
  };
}

function packTri4(indices) {
  const [a, b, c, d, e, f, g, h, i, j, k, l] = indices;
  return [0x10000000 | (a << 23) | (b << 18) | ((c >>> 2) << 15) | (d << 10) | (e << 5) | f,
    ((c & 3) << 30) | (g << 25) | (h << 20) | (i << 15) | (j << 10) | (k << 5) | l];
}

describe('Conker command decoding', () => {
  test('factory selects the dialect and ordinary GBI2 retains its selectors', () => {
    const h = harness();
    const task = { detectVersionString: () => '', computeMicrocodeHash: () => 0x60256efc };
    // Identification is independently covered by microcode_identifier.test.js.
    // Use its known Conker code hash rather than relying on a version string.
    expect(create(task, h.state, h.ram)).toBeInstanceOf(GBI2Conker);
    const generic = new GBI2(h.state, h.ram);
    generic.executeMoveWord(0xdb020000, 48);
    expect(h.state.numLights).toBe(2);
    h.microcode.executeMoveWord(0xdb020000, 48);
    expect(h.state.numLights).toBe(1);
    expect(generic.getHandler(0x10)).toBeNull();
  });

  for (const debug of [false, true]) {
    test(`decodes all sixteen TRI4 opcodes and the split index (disassembly=${debug})`, () => {
      const h = harness();
      h.state.projectedVertices.forEach((v, i) => { v.color = i; });
      const expected = [], commands = [];
      for (let first = 0; first < 32; ++first) {
        const indices = [first, (first + 1) % 32, (first + 17) % 32, 31, 0, 16, 23, 14, 5, 7, 18, 29];
        commands.push(packTri4(indices));
        expected.push(...indices);
      }
      commands.push([0xe1000000, 0x12345678], [0xdf000000, 0]);
      h.run(commands, { disassembler: debug ? h.disassembler : null });
      expect(h.triangles).toEqual(expected);
      expect(h.state.rdpHalf1Cmd1).toBe(0x12345678);
      expect(h.state.currentOp).toBe(34);
      expect(h.state.pc).toBe(0);
      expect(h.warnings).toEqual([]);
      if (debug) {
        expect(h.text.filter(t => t.startsWith('gsSPConker4Triangles'))).toHaveLength(32);
      }
    });
  }

  test('bounds degenerate batches and stops at debugger/count boundaries', () => {
    const h = harness();
    const empty = packTri4(Array(12).fill(0));
    h.write(8, [...Array(100).fill(empty), [0xdf000000, 0]]);
    h.state.nextCommand();
    h.microcode.executeTri4(...empty);
    expect(h.state.pc).toBe(8 + 16 * 8);
    expect(h.state.currentOp).toBe(15);
    expect(h.triangles).toEqual([]);

    h.state.currentOp = 0;
    h.run([...Array(4).fill(empty), [0xe1000000, 0xdead], [0xdf000000, 0]], { bailAfter: 1 });
    expect(h.state.currentOp).toBe(1);
    expect(h.state.pc).toBe(24);
    expect(h.state.rdpHalf1Cmd1).toBe(0);

    h.state.currentOp = 0;
    h.state.pcEnd = 8 + 2 * 8;
    h.run([empty, empty, [0xe1000000, 0xdead]]);
    expect(h.state.currentOp).toBe(2);
    expect(h.state.pc).toBe(0);
    expect(h.state.rdpHalf1Cmd1).toBe(0);
  });

  test('flushes full TRI4 buffers and returns from a counted child without consuming its tail', () => {
    const h = harness();
    h.state.projectedVertices.forEach((v, i) => { v.color = i; });
    const indices = [31, 17, 4, 9, 10, 11, 5, 2, 7, 12, 13, 14];
    const triangle = packTri4(indices);
    h.write(0x800, [...Array(19).fill(triangle), [0xe1000000, 0xdead]]);
    h.run([[0xd5000012, 0x800], [0xe1000000, 0xbeef], [0xdf000000, 0]]);
    expect(h.triangles).toEqual(Array(18).fill(indices).flat());
    expect(h.state.currentOp).toBe(21);
    expect(h.state.rdpHalf1Cmd1).toBe(0xbeef);
    expect(h.state.dlistStack).toEqual([]);
  });

  test('retains matrix, normals, modifiers and lights across the lighting overlay', () => {
    const h = harness();
    h.state.segments[1] = 0x800;
    const matrix = [2, 0, 0, 5, 0, 3, 0, -7, 0, 0, 4, 9, 0, 0, 0, 1];
    matrix.forEach((v, i) => {
      h.ram.setInt16(0x800 + (i % 4) * 8 + (i >>> 2) * 2, v);
    });
    h.vertex(0xc00);
    h.light(0, { rgba: 0xffffffff });
    let loads = 0;
    h.run([
      [0xda380002, 0x01000000], // Modelview LOAD + PUSH.
      [0xdc30000e, 0x01000200], // Normal pointer, never a force matrix.
      [0xdb100000, 0x00010002], [0xdb100010, 0x80004000],
      [0xdd000fff, 0x1234],
      [0x01001002, 0xc00], [0xdf000000, 0],
    ], { loadMicrocode: () => { loads++; throw new Error('must retain Conker'); } });
    expect(loads).toBe(0);
    expect(h.microcode.advancedLighting).toBe(true);
    expect(h.microcode.normalAddress).toBe(0xa00);
    expect(h.microcode.coordMod[12]).toBe(1.5);
    expect(h.microcode.lights[0].color).toEqual([1, 1, 1]);
    expect(h.state.modelview).toHaveLength(2);
    expect([...h.state.getCombinedMatrix().elems]).toEqual(matrix);
    expect([...h.state.projectedVertices[0].pos.elems]).toEqual([7, -1, 21, 1]);
    h.microcode.executeMoveWord(0xdb0c0000, 1);
    h.microcode.executePopMatrix(0xd8380002, 64);
    expect([...h.state.getCombinedMatrix().elems]).toEqual([...Matrix4x4.identity().elems]);
    expect(h.warnings).toEqual([]);
  });

  test('decodes signed coordinate modifiers, fraction commits, duplicate writes and shared words', () => {
    const h = harness();
    h.microcode.executeMoveWord(0xdb100000, 0xfffe0003);
    h.microcode.executeMoveWord(0xdb100010, 0x8000ffff);
    h.microcode.executeMoveWord(0xdb100004, 0x0004fffb);
    h.microcode.executeMoveWord(0xdb100014, 0x40000001);
    h.microcode.executeMoveWord(0xdb100020, 0xfff60014);
    h.microcode.executeMoveWord(0xdb100024, 0x001effd8);
    expect([...h.microcode.coordMod.slice(8)]).toEqual([-10, 20, 30, -40, -1.5, 3 + 65535 / 65536, 4.25, -5 + 1 / 65536]);
    const before = [...h.microcode.coordMod];
    h.microcode.executeMoveWord(0xdb100018, 0);
    expect([...h.microcode.coordMod]).toEqual(before);
    h.microcode.executeMoveWord(0xdb06000c, 0x80123456);
    h.microcode.executeMoveWord(0xdb080000, 0xfffe0003);
    expect(h.state.segments[3]).toBe(0x123456);
    expect(h.state.fogParameters.multiplier).toBe(-2);
    expect(h.state.fogParameters.offset).toBe(3);
    expect(h.warnings).toEqual([]);
  });
});

describe('Conker vertices and lighting', () => {
  test('loads split signed normals at nonzero cache indices, modulates RGB and retains alpha/ST', () => {
    const h = harness();
    h.light(0, { rgba: 0xffffffff, dir: [0, 127, 0] });
    h.light(1, { rgba: 0x000000ff });
    h.microcode.executeMoveWord(0xdb020000, 48);
    h.microcode.executeLoadUcode(0xdd000fff, 0);
    h.microcode.executeMoveMem(0xdc30000e, 0xa00);
    h.microcode.executeGeometryMode(0xd9000000, 0x20000);
    h.state.modelview[0] = new Matrix4x4([0, -2, 0, 10, 2, 0, 0, 20, 0, 0, 2, 30, 0, 0, 0, 1]);
    h.vertex(0xc00, { flag: 0x40 });
    h.vertex(0xc10, { flag: 0xff });
    h.ram.setInt8(0xa0a, 64); // cache slot 5, not source vertex zero.
    h.ram.setInt8(0xa0c, -127);
    h.microcode.executeVertex(0x0100200e, 0xc00, h.disassembler);
    const [a, b] = h.state.projectedVertices.slice(5, 7);
    expect([...a.pos.elems]).toEqual([6, 22, 36, 1]);
    expect(a.clipFlags).toBe(gbi.X_NEG | gbi.Y_NEG | gbi.Z_NEG);
    expect([a.u, a.v]).toEqual([2, -3]);
    expect(a.color >>> 0).toBe(0x7b193264);
    expect(b.color >>> 0).toBe(0x7b000000);
    expect(h.state.projectedVertices[0].set).toBe(false);
    expect(h.warnings).toEqual([]);
  });

  test('uses normal Z from flag, lighting bypass, saturation and post-lighting fog', () => {
    const h = harness();
    h.light(0, { rgba: 0xffffffff });
    h.light(1, { rgba: 0x808080ff });
    h.microcode.executeMoveWord(0xdb020000, 48);
    h.microcode.executeLoadUcode(0xdd000fff, 0);
    h.microcode.executeGeometryMode(0xd9000000, 0x20000);
    h.vertex(0xc00, { flag: 127 });
    h.vertex(0xc10, { flag: 0x0080 });
    h.vertex(0xc20, { flag: 0x8000 });
    h.microcode.executeVertex(0x01003006, 0xc00);
    const colors = () => h.state.projectedVertices.slice(0, 3).map(v => v.color >>> 0);
    expect(colors()).toEqual([0x7b3264c8, 0x7b193264, 0x7b3264c8]);
    h.microcode.executeGeometryMode(0xd9000000, 0x30000);
    h.state.fogParameters.set(0, 77);
    h.microcode.executeVertex(0x01001002, 0xc00);
    expect(colors()).toEqual([0x4d3264c8, 0x7b193264, 0x7b3264c8]);
  });

  test('applies point attenuation to modified clip coordinates, and gates directional terms on the overlay', () => {
    const h = harness();
    h.light(0, { rgba: 0xff0000ff, dir: [0, 0, -127], attenuation: 16, pos: [256, 0, 0] });
    h.light(1, { rgba: 0x00ff00ff }); // final directional light
    h.light(2, { rgba: 0x0000ffff }); // ambient
    h.microcode.executeMoveWord(0xdb020000, 96);
    h.microcode.executeMoveWord(0xdb100000, 0x00010001);
    h.microcode.executeMoveWord(0xdb100010, 0);
    h.microcode.executeMoveWord(0xdb100004, 0x00010001);
    h.microcode.executeMoveWord(0xdb100014, 0);
    h.microcode.executeMoveWord(0xdb100020, 0xfff60000); // -10 cancels clip translation.
    h.state.modelview[0].elems[3] = 10;
    h.state.viewport.transform.scale.x = 123; // Must not affect point distances.
    h.vertex(0xc00, { xyz: [0, 0, 0], flag: 127, rgba: 0xc8c8c855 });
    h.microcode.executeGeometryMode(0xd9000000, 0x20000);
    const color = () => {
      h.microcode.executeVertex(0x01001002, 0xc00);
      return h.state.projectedVertices[0].color >>> 0;
    };
    expect(color()).toBe(0x55c80064); // half red point + blue ambient
    h.microcode.executeLoadUcode(0xdd000fff, 0);
    expect(color()).toBe(0x55c8c864); // green directional enabled
    h.microcode.executeGeometryMode(0xd9000000, 0x420000);
    expect(color()).toBe(0x55c8c800); // point normal faces away
    h.light(0, { rgba: 0xff0000ff, attenuation: 0, pos: [0, 0, 0] });
    expect(color()).toBe(0x55c8c800); // zero coefficient / distance never makes NaN
  });

  test('loads 48-byte look-at slots and generates clamped UVs for both texgen modes', () => {
    const h = harness();
    h.ram.setInt8(0x808, 127);
    h.ram.setInt8(0x829, -127);
    h.microcode.executeMoveMem(0xdc08000a, 0x800);
    h.microcode.executeMoveMem(0xdc08060a, 0x820);
    h.microcode.executeMoveMem(0xdc30000e, 0xa00);
    h.ram.setInt8(0xa00, -128);
    h.ram.setInt8(0xa01, -127);
    h.vertex(0xc00, { flag: 0x8000 });
    for (const bits of [0x60000, 0xe0000]) {
      h.microcode.executeGeometryMode(0xd9000000, bits);
      h.microcode.executeVertex(0x01001002, 0xc00);
      const v = h.state.projectedVertices[0];
      expect([v.u, v.v]).toEqual([0, 1]);
      expect(v.color >>> 0).toBe(0x7b3264c8);
    }
    h.ram.setInt8(0x829, 0);
    h.microcode.executeMoveMem(0xdc08060a, 0x820);
    expect(h.microcode.lookAtEnabled).toBe(false);
    expect(h.warnings).toEqual([]);
  });

  test('rejects malformed cache, RAM, light and modifier ranges without partial vertex writes', () => {
    const h = harness();
    h.microcode.executeVertex(0x01002002, 0x800, h.disassembler); // negative v0
    h.microcode.executeVertex(0x01001042, 0x800, h.disassembler); // slot 32
    h.microcode.executeVertex(0x01002004, 0x3ff0, h.disassembler);
    h.microcode.executeGeometryMode(0xd9000000, 0x20000);
    h.microcode.executeMoveMem(0xdc30000e, 0x3fff);
    h.microcode.executeVertex(0x01001002, 0x800, h.disassembler);
    expect(h.state.projectedVertices.some(v => v.set)).toBe(false);
    h.microcode.executeMoveMem(0xdc28000a | (14 * 48 << 5), 0x800);
    h.microcode.executeMoveMem(0xdc08010a, 0x800); // misaligned slot
    h.microcode.executeMoveMem(0xdc280c0a, 0x3fe0); // truncated light
    h.microcode.executeMoveMem(0xdc080008, 0x3ff8); // truncated viewport
    h.microcode.executeMatrix(0xda380003, 0x3fe0);
    h.microcode.executeMoveWord(0xdb020000, 12 * 48);
    h.microcode.executeMoveWord(0xdb020000, 49);
    h.microcode.executeMoveWord(0xdb100016, 0); // pair crosses the modifier bank
    h.microcode.pushTriangle(0, 1, 32);
    expect(h.warnings).toHaveLength(13);
    expect(h.state.numLights).toBe(0);
    expect(h.triangles).toEqual([]);
  });

  test('accepts the last vertex and ambient light slots, and ignores normals for unlit vertices', () => {
    const h = harness();
    h.vertex(0x3ff0);
    h.microcode.executeMoveMem(0xdc30000e, 0xffffffff);
    h.microcode.executeVertex(0x01001040, 0x3ff0, h.disassembler);
    expect(h.state.projectedVertices[31].color >>> 0).toBe(0x7b3264c8);
    h.light(11, { rgba: 0xffffffff });
    h.microcode.executeMoveWord(0xdb020000, 11 * 48);
    h.microcode.executeMoveMem(0xdc30000e, 0);
    h.microcode.executeGeometryMode(0xd9000000, 0x20000);
    h.microcode.executeVertex(0x01001040, 0x3ff0);
    expect(h.state.projectedVertices[31].color >>> 0).toBe(0x7b3264c8);
    expect(h.warnings).toEqual([]);
  });
});
