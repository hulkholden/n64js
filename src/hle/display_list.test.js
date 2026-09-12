import { describe, expect, test } from 'bun:test';
import { executeDisplayList } from './display_list.js';
import { GBI1 } from './gbi1.js';
import { GBI2 } from './gbi2.js';
import { RSPState } from './rsp_state.js';

function writeCommands(ramDV, address, commands) {
  commands.forEach(([cmd0, cmd1], index) => {
    ramDV.setUint32(address + index * 8, cmd0);
    ramDV.setUint32(address + index * 8 + 4, cmd1);
  });
}

describe('display-list execution', () => {
  test('returns from nested lists and disassembles commands at their correct stack depth', () => {
    const ramDV = new DataView(new ArrayBuffer(0x100));
    writeCommands(ramDV, 8, [
      [0x06000000, 0x40], // Call the child list.
      [0xb3000000, 0xcafe], // Set RDPHalf2 after returning.
      [0xb8000000, 0],
    ]);
    writeCommands(ramDV, 0x40, [
      [0xb4000000, 0xbeef], // Set RDPHalf1 in the child.
      [0xb8000000, 0],
    ]);

    const seen = [];
    let currentCommand;
    const disassembler = {
      begin(cmd0, cmd1, depth) { currentCommand = { depth, text: [] }; },
      text(line) { currentCommand.text.push(line); },
      end() { seen.push(currentCommand); currentCommand = null; },
    };
    for (const dis of [null, disassembler]) {
      const state = new RSPState();
      state.reset(ramDV, 8);
      executeDisplayList(state, new GBI1(state, ramDV), { disassembler: dis });
      expect(state.rdpHalf1Cmd1).toBe(0xbeef);
      expect(state.rdpHalf2Cmd1).toBe(0xcafe);
      expect(state.currentOp).toBe(5);
      expect(state.nextCommand()).toBe(false);
    }
    expect(seen.map(command => command.depth)).toEqual([0, 1, 1, 0, 0]);
    expect(seen.every(command => command.text.length > 0)).toBe(true);
  });

  test('uses each replacement microcode for subsequent commands across repeated loads', () => {
    const ramDV = new DataView(new ArrayBuffer(0x100));
    writeCommands(ramDV, 8, [
      [0xb4000000, 0x2000], // GBI1: data pointer for the first load.
      [0xaf00000f, 0x1000], // Switch to GBI2, with 16 bytes of data.
      [0x05000204, 0], // GBI2 triangle.
      [0xe1000000, 0x4000], // GBI2: data pointer for the second load.
      [0xdd00001f, 0x3000], // Switch back to GBI1, with 32 bytes of data.
      [0xbf000000, 0x00000204], // GBI1 triangle.
      [0xb8000000, 0],
    ]);
    const state = new RSPState();
    state.reset(ramDV, 8);
    let triangles = 0;
    const renderer = { flushTris: buffer => { triangles += buffer.numTris; } };
    const initialMicrocode = new GBI1(state, ramDV);
    initialMicrocode.renderer = renderer;
    const loads = [];
    executeDisplayList(state, initialMicrocode, {
      loadMicrocode: (codeAddr, codeSize, codeDataAddr, codeDataSize) => {
        loads.push([codeAddr, codeSize, codeDataAddr, codeDataSize]);
        const Handler = codeAddr === 0x1000 ? GBI2 : GBI1;
        const microcode = new Handler(state, ramDV);
        microcode.renderer = renderer;
        return microcode;
      },
    });
    expect(loads).toEqual([
      [0x1000, 0x1000, 0x2000, 16],
      [0x3000, 0x1000, 0x4000, 32],
    ]);
    expect(triangles).toBe(2);
    expect(state.currentOp).toBe(7);
    expect(state.nextCommand()).toBe(false);
  });
});
