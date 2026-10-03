import { describe, expect, test } from 'bun:test';
import { executeDisplayList } from './display_list.js';
import { create } from './microcodes.js';
import { NullRenderer } from './null_renderer.js';
import { RSPState } from './rsp_state.js';
import { ZSortP } from './zsortp.js';

function words(dv, address, values) {
  values.forEach((value, i) => dv.setUint32(address + i * 4, value));
}

function setup() {
  const dv = new DataView(new ArrayBuffer(0x4000));
  const state = new RSPState();
  let syncs = 0;
  state.reset(dv, 0x100, () => syncs++);
  const microcode = create({
    detectVersionString: () => 'RSP Gfx ucode ZSortp 0.33 Yoshitaka Yasumoto Nintendo.',
    computeMicrocodeHash: () => 0xfb605cf2,
  }, state, dv);
  microcode.renderer = new NullRenderer(state);
  const draws = [];
  microcode.renderer.flushTris = tb => {
    draws.push({
      positions: Array.from(tb.positions.slice(0, tb.numTris * 12)),
      colours: Array.from(tb.colours.slice(0, tb.numTris * 3)),
      coords: Array.from(tb.coords.slice(0, tb.numTris * 6)),
      textured: state.geometryMode.texture,
      primColor: state.primColor,
    });
    tb.reset();
  };
  return { dv, state, microcode, draws, syncs: () => syncs };
}

describe('ZSortp', () => {
  test('uses its own dispatcher and GBI1 field encodings in both task and RDP lists', () => {
    const { dv, state, microcode, syncs } = setup();
    expect(microcode).toBeInstanceOf(ZSortP);
    words(dv, 0x100, [
      0xdb000806, 0x80001000, // Segment 2, not GBI2's MoveWord encoding.
      0xde000000, 0x02000200, // Call child.
      0x81000000, 0x02000300,
      0xdf000000, 0,
      0xfa000000, 0xdeadbeef, // Canary after task end.
    ]);
    words(dv, 0x1200, [0xe3000802, 0x100, 0xdf000000, 0]);
    words(dv, 0x1300, [
      0xe2000002, 1, 0xe3000c02, 0x2000,
      0xfa000000, 0x12345678, 0xe9000000, 0,
      0xdf000000, 0,
      0xfa000000, 0xdeadbeef, // RDP ENDDL returns to the task, not the DL stack.
    ]);
    executeDisplayList(state, microcode);
    expect(state.rdpOtherModeH).toBe(0x2100);
    expect(state.rdpOtherModeL & 3).toBe(1);
    expect(state.primColor).toBe(0x12345678);
    expect(syncs()).toBe(1);
    expect(state.currentOp).toBe(6);
    expect(state.pc).toBe(0);
    expect(state.dlistStack).toEqual([]);
    expect(() => microcode.executeMoveWord(0xdb00000e, 0xffff)).not.toThrow();
  });

  test.each([false, true])('walks both sorted object chains, caches RDP pointers and draws all object types (disassembly=%s)', disassemble => {
    const { dv, state, microcode, draws, syncs } = setup();
    words(dv, 0x100, [0x80000400, 0x80000704, 0xdf000000, 0]);
    // A null object changes state without drawing; links retain the type bits.
    words(dv, 0x400, [0x80000501, 0x900, 0x920, 0x940]);
    words(dv, 0x500, [0x80000603, 0x900]);
    words(dv, 0x600, [0x80000000, 0x900]);
    words(dv, 0x700, [0x80000802, 0x900, 0x920, 0x940]);
    words(dv, 0x800, [0x80000000, 0x900, 0x920, 0x940]);
    words(dv, 0x900, [0xfa000000, 0x12345678, 0xdf000000, 0]);
    words(dv, 0x920, [0xe9000000, 0, 0xdf000000, 0]);
    words(dv, 0x940, [0xef080000, 0, 0xdf000000, 0]); // Perspective on.
    for (const [base, count, textured] of [[0x508, 3, false], [0x608, 4, false], [0x710, 4, true], [0x810, 3, true]]) {
      [[0, 0], [1280, 0], [0, 960], [1280, 960]].slice(0, count).forEach(([x, y], i) => {
        const address = base + i * (textured ? 16 : 8);
        words(dv, address, [(x << 16) | y, 0x123456ff]);
        if (textured) words(dv, address + 8, [0xffe00040, 0x04000000]);
      });
    }
    let rows = 0;
    const disassembler = disassemble ? {
      begin() { rows++; }, text() {}, tip() {}, end() {}, rgba8888: String,
    } : null;
    executeDisplayList(state, microcode, { disassembler });
    const triangle = [-1, 1, 0, 1, 1, 1, 0, 1, -1, -1, 0, 1];
    const quad = [...triangle, -1, -1, 0, 1, 1, 1, 0, 1, 1, -1, 0, 1];
    expect(draws.map(draw => draw.positions)).toEqual([triangle, quad, quad, triangle]);
    expect(draws.map(draw => draw.textured)).toEqual([0, 0, 1, 1]);
    expect(draws.every(draw => draw.colours.every(color => color === 0xff563412))).toBe(true);
    expect(draws.every(draw => draw.primColor === 0x12345678)).toBe(true);
    expect(draws[2].coords).toEqual([-1, 2, -1, 2, -1, 2, -1, 2, -1, 2, -1, 2]);
    expect(syncs()).toBe(disassemble ? 0 : 1); // Shared blocks execute once; debugger replay has no interrupts.
    if (disassemble) expect(rows).toBe(2);
    // The RDP pointer cache lasts for one ZObject command, not the whole task.
    microcode.executeObjects(0x80000400, 0x80000000);
    expect(syncs()).toBe(disassemble ? 1 : 2);
  });

  test('decodes signed screen coordinates and reciprocal W for perspective textures', () => {
    const { dv, state, microcode, draws } = setup();
    state.rdpOtherModeH = 0x80000;
    for (let i = 0; i < 3; i++) {
      words(dv, 0x400 + i * 16, [0xfffcfffc, 0xffffffff, 0xffe0ffc0, 0x02000000]);
    }
    microcode.drawObject(0x400, 3, true);
    const w = 63 / 31;
    expect(draws[0].positions[0]).toBeCloseTo((-1 / 160 - 1) * w);
    expect(draws[0].positions[1]).toBeCloseTo((1 + 1 / 120) * w);
    expect(draws[0].positions[3]).toBeCloseTo(w);
    expect(draws[0].coords.slice(0, 2)).toEqual([-1, -2]);
    state.rdpOtherModeH = 0;
    microcode.drawObject(0x400, 3, true);
    expect(draws[1].positions[3]).toBe(1);
    // Renderer.flushTris applies the nonperspective half-scale once.
    expect(draws[1].coords.slice(0, 2)).toEqual([-1, -2]);
  });

  test.each([0xe4, 0xe5])('consumes the two RDPHalf words after rectangle opcode %x', opcode => {
    const { dv, state, microcode } = setup();
    words(dv, 0x100, [0x81000000, 0x400, 0xdf000000, 0]);
    words(dv, 0x400, [
      (opcode << 24) | 0x040020, 0x03000000,
      0xb4000000, 0x00200040, 0xb3000000, 0x04000400,
      0xfa000000, 0xaabbccdd, 0xdf000000, 0,
    ]);
    const rects = [];
    microcode.renderer.texRect = (...args) => rects.push(args);
    executeDisplayList(state, microcode);
    expect(rects).toEqual([opcode === 0xe4
      ? [3, 0, 0, 16, 8, 1, 2, 17, 10, false]
      : [3, 0, 0, 16, 8, 1, 2, 9, 18, true]]);
    expect(state.primColor).toBe(0xaabbccdd);
  });

  test('rejects unimplemented computation/signal commands and bounds cyclic object chains', () => {
    const { dv, microcode } = setup();
    for (const opcode of [0xd0, 0xd1, 0xd2, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xdc]) {
      expect(() => microcode.buildCommandTable()[opcode](opcode << 24, 0)).toThrow('Unsupported ZSortp command');
    }
    words(dv, 0x400, [0x80000400, 0, 0, 0]);
    expect(() => microcode.executeObjects(0x80000400, 0x80000000)).toThrow('ZSortp object list limit');
    expect(() => microcode.executeObjects(0x80000405, 0x80000000)).toThrow('Invalid ZSortp object type');
    words(dv, 0x400, [0x81000000, 0x400]);
    expect(() => microcode.processRDP(0x400)).toThrow('Unsupported ZSortp command');
  });
});
