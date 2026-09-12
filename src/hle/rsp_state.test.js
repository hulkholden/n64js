import { describe, expect, test } from 'bun:test';
import { executeDisplayList } from './display_list.js';
import { GBI1 } from './gbi1.js';
import { RSPState } from './rsp_state.js';

function createDisplayList() {
  // A no-op, three triangles that can batch together, and an end command.
  const commands = [
    [0x00000000, 0],
    [0xbf000000, 0x00000204],
    [0xbf000000, 0x00020400],
    [0xbf000000, 0x00040002],
    [0xb8000000, 0],
  ];
  const ramDV = new DataView(new ArrayBuffer(0x100));
  commands.forEach(([cmd0, cmd1], index) => {
    ramDV.setUint32(8 + index * 8, cmd0);
    ramDV.setUint32(12 + index * 8, cmd1);
  });
  const state = new RSPState();
  state.reset(ramDV, 8);
  const microcode = new GBI1(state, ramDV);
  const triangles = [];
  microcode.renderer = { flushTris: buffer => triangles.push(buffer.numTris) };

  return {
    state, ramDV, triangles,
    run(disassembler = null, bailAfter = -1) {
      executeDisplayList(state, microcode, { disassembler, bailAfter });
    },
  };
}

describe('display-list operation progress', () => {
  test('counts batched and individual operations consistently without a debugger', () => {
    const list = createDisplayList();
    for (const disassembler of [null, { begin() {}, text() {}, end() {} }]) {
      list.state.reset(list.ramDV, 8);
      list.triangles.length = 0;
      list.run(disassembler);
      expect(list.state.currentOp).toBe(5);
      expect(list.triangles.reduce((sum, count) => sum + count, 0)).toBe(3);
      expect(list.state.nextCommand()).toBe(false);
    }
  });

  test('stops after the requested operation, including at the end of a triangle batch', () => {
    for (const bailAfter of [0, 3]) {
      const list = createDisplayList();
      list.run(null, bailAfter);
      expect(list.state.currentOp).toBe(bailAfter);
      expect(list.triangles.reduce((sum, count) => sum + count, 0)).toBe(bailAfter === 0 ? 0 : 3);
      expect(list.state.nextCommand()).toBe(true);
      expect(list.state.cmd0 >>> 24).toBe(bailAfter === 0 ? 0xbf : 0xb8);
    }
  });
});
