import { describe, expect, test } from 'bun:test';
import { executeDisplayList } from './display_list.js';
import { GBI0SE } from './gbi0.js';
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
  for (const push of [true, false]) {
    test(`bounds a two-list ${push ? 'recursive call' : 'branch'} cycle without completing it`, () => {
      const ramDV = new DataView(new ArrayBuffer(0x100));
      const command = push ? 0x06000000 : 0x06010000;
      writeCommands(ramDV, 8, [[command, 0x40], [0xe9000000, 0], [0xb8000000, 0]]);
      writeCommands(ramDV, 0x40, [[command, 8], [0xb8000000, 0]]);
      const state = new RSPState();
      let syncs = 0;
      state.reset(ramDV, 8, () => { syncs++; });
      // bailAfter also makes this regression terminate on the old runner.
      expect(() => executeDisplayList(state, new GBI1(state, ramDV), {
        commandLimit: 16, bailAfter: 20,
      })).toThrow(`HLE display-list command limit (16) exceeded at 0x00000008; stack depth ${push ? 16 : 0}`);
      expect(state.currentOp).toBe(16);
      expect(syncs).toBe(0);
    });
  }

  test('bounds disassembly and allows lists ending exactly at the command limit', () => {
    const ramDV = new DataView(new ArrayBuffer(0x100));
    writeCommands(ramDV, 8, [[0xb4000000, 1], [0xb4000000, 2], [0xb8000000, 0]]);
    const state = new RSPState();
    for (const disassembler of [null, { begin() {}, text() {}, end() {} }]) {
      state.reset(ramDV, 8);
      expect(() => executeDisplayList(state, new GBI1(state, ramDV), {
        commandLimit: 2, disassembler,
      })).toThrow('command limit (2) exceeded at 0x00000018');
      state.reset(ramDV, 8);
      executeDisplayList(state, new GBI1(state, ramDV), { commandLimit: 3, disassembler });
      expect(state.pc).toBe(0);
      expect(state.currentOp).toBe(3);
    }
  });

  test('debugger bailAfter still stops before reaching the command limit', () => {
    const ramDV = new DataView(new ArrayBuffer(0x100));
    writeCommands(ramDV, 8, [[0x06000000, 8]]);
    const state = new RSPState();
    state.reset(ramDV, 8);
    expect(executeDisplayList(state, new GBI1(state, ramDV), {
      commandLimit: 16, bailAfter: 4,
    })).toBeNull();
    expect(state.currentOp).toBe(4);
    expect(state.dlistStack).toHaveLength(5);
  });

  test('counts batched triangles before dispatching more commands', () => {
    const ramDV = new DataView(new ArrayBuffer(0x100));
    writeCommands(ramDV, 8, [
      [0xbf000000, 0x00000204], [0xbf000000, 0x00000204], [0xbf000000, 0x00000204],
      [0xe9000000, 0], [0xb8000000, 0],
    ]);
    const state = new RSPState();
    let syncs = 0;
    state.reset(ramDV, 8, () => { syncs++; });
    const microcode = new GBI1(state, ramDV);
    microcode.renderer = { flushTris() {} };
    expect(() => executeDisplayList(state, microcode, { commandLimit: 2 })).toThrow('command limit (2) exceeded');
    expect(state.currentOp).toBe(3); // Finish the batch, but do not dispatch FullSync.
    expect(syncs).toBe(0);
  });

  test('producer waits receive a fresh command budget on each resume', () => {
    const ramDV = new DataView(new ArrayBuffer(0x100));
    writeCommands(ramDV, 8, [[0x06000000, 0x40], [0xb8000000, 0]]);
    writeCommands(ramDV, 0x40, [[0x06010000, 0x40], [0xb8000000, 0]]);
    const state = new RSPState();
    state.reset(ramDV, 8);
    const resume = executeDisplayList(state, new GBI1(state, ramDV), { commandLimit: 3 });
    for (let i = 0; i < 10; i++) expect(resume()).toBe(resume);
    ramDV.setUint32(0x40, 0); // Producer publishes the child list.
    expect(resume()).toBeNull();
    expect(state.dlistStack).toEqual([]);
    expect(state.pc).toBe(0);
  });

  test('microcode reloads cannot reset the command budget', () => {
    const ramDV = new DataView(new ArrayBuffer(0x100));
    writeCommands(ramDV, 8, [
      [0xb4000000, 0x2000], [0xaf00000f, 0x1000], [0x06010000, 8],
    ]);
    const state = new RSPState();
    state.reset(ramDV, 8);
    let loads = 0;
    expect(() => executeDisplayList(state, new GBI1(state, ramDV), {
      commandLimit: 6, bailAfter: 8,
      loadMicrocode: () => { loads++; return new GBI1(state, ramDV); },
    })).toThrow('command limit (6) exceeded at 0x00000008');
    expect(loads).toBe(2);
  });

  test('signals nested FullSyncs during execution, but not disassembly or replay', () => {
    const ramDV = new DataView(new ArrayBuffer(0x100));
    writeCommands(ramDV, 8, [
      [0xde000000, 0x40],
      [0xdf000000, 0],
    ]);
    writeCommands(ramDV, 0x40, [[0xe9000000, 0], [0xdf000000, 0]]);
    const state = new RSPState();
    let interrupts = 0;
    const onFullSync = () => { interrupts++; };
    state.reset(ramDV, 8, onFullSync);
    executeDisplayList(state, new GBI2(state, ramDV));
    expect(interrupts).toBe(1);

    state.reset(ramDV, 8, onFullSync);
    executeDisplayList(state, new GBI2(state, ramDV), {
      disassembler: { begin() {}, text() {}, end() {} },
    });
    expect(interrupts).toBe(1);

    // Debugger rendering replays reset the state without a guest callback.
    state.reset(ramDV, 8);
    executeDisplayList(state, new GBI2(state, ramDV), { bailAfter: 2 });
    expect(interrupts).toBe(1);
  });

  test('calls and returns from a list relocated by a negative segment base', () => {
    const ramDV = new DataView(new ArrayBuffer(8 * 1024 * 1024));
    writeCommands(ramDV, 8, [
      // Shadows of the Empire uses this relocation and segmented call.
      [0xbc001006, 0xffde1ec0], // Segment 4 = -0x21e140.
      [0x06000000, 0x8440aa58], // Child at 0x001ec918.
      [0xb3000000, 0xcafe],
      [0xb8000000, 0],
    ]);
    writeCommands(ramDV, 0x001ec918, [
      [0xb4000000, 0xbeef],
      [0xb8000000, 0],
    ]);

    for (const disassembler of [null, { begin() {}, text() {}, end() {} }]) {
      const state = new RSPState();
      state.reset(ramDV, 8);
      executeDisplayList(state, new GBI0SE(state, ramDV), { disassembler });
      expect(state.rdpHalf1Cmd1).toBe(0xbeef);
      expect(state.rdpHalf2Cmd1).toBe(0xcafe);
      expect(state.dlistStack).toEqual([]);
      expect(state.currentOp).toBe(6);
      expect(state.pc).toBe(0);
    }
  });

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


test('resumes a CPU-patched self-branch with nested state and the replacement microcode', () => {
  const ramDV = new DataView(new ArrayBuffer(0x100));
  writeCommands(ramDV, 8, [
    [0xb4000000, 0x2000],
    [0xaf00000f, 0x1000], // Switch from GBI1 to GBI2.
    [0xde000000, 0x40],
    [0xf1000000, 0xcafe],
    [0xdf000000, 0],
  ]);
  writeCommands(ramDV, 0x40, [
    [0xe1000000, 0xbeef],
    [0xde010000, 0x48], // CPU producer's wait marker.
    [0xdf000000, 0],
  ]);
  const state = new RSPState();
  state.reset(ramDV, 8);
  let loads = 0;
  const resume = executeDisplayList(state, new GBI1(state, ramDV), {
    loadMicrocode: () => { loads++; return new GBI2(state, ramDV); },
  });
  expect(typeof resume).toBe('function');
  expect(state.pc).toBe(0x48);
  expect(state.dlistStack).toHaveLength(1);
  expect(state.rdpHalf1Cmd1).toBe(0xbeef);
  expect(resume()).toBe(resume); // Still waiting; no false completion.
  ramDV.setUint32(0x48, 0); // CPU replaces the branch with a no-op.
  expect(resume()).toBeNull();
  expect(loads).toBe(1);
  expect(state.rdpHalf2Cmd1).toBe(0xcafe);
  expect(state.dlistStack).toEqual([]);
  expect(state.pc).toBe(0);
});

test('disassembly stops at a self-branch without hanging or reading unfinished commands', () => {
  const ramDV = new DataView(new ArrayBuffer(32));
  writeCommands(ramDV, 8, [[0xde010000, 8], [0xe1000000, 0xbeef]]);
  const state = new RSPState();
  state.reset(ramDV, 8);
  const seen = [];
  executeDisplayList(state, new GBI2(state, ramDV), {
    disassembler: { begin: cmd => seen.push(cmd), text() {}, end() {} },
  });
  expect(seen).toEqual([0xde010000]);
  expect(state.rdpHalf1Cmd1).toBe(0);
});
