import { expect, test } from 'bun:test';
import { executeDisplayList } from './display_list.js';
import { GBI0, GBI0Early } from './gbi0.js';
import { create } from './microcodes.js';
import { identifyMicrocode, MicrocodeId } from './microcode_identifier.js';
import { RSPState } from './rsp_state.js';

function harness(hash = 0x1935c6ae) {
  const ram = new DataView(new ArrayBuffer(4096));
  const state = new RSPState();
  state.reset(ram, 0x100);
  const microcode = create({ detectVersionString: () => '', computeMicrocodeHash: () => hash }, state, ram);
  const warnings = [];
  microcode.warn = (...args) => warnings.push(args);
  return { ram, state, microcode, warnings };
}

test('identifies the versionless Saikyou microcode without changing other GBI0 tasks', () => {
  expect(identifyMicrocode('', 0x1935c6ae)).toMatchObject({
    id: MicrocodeId.GBI0_EARLY, family: 'GBI0', variant: 'EARLY', detection: 'hash',
  });
  expect(harness().microcode).toBeInstanceOf(GBI0Early);
  const { state, microcode } = harness(0);
  expect(microcode.constructor).toBe(GBI0);
  microcode.executeMoveWord(0xbc000406, 0x200);
  expect(state.segments[1]).toBe(0x200);
});

test('early segment setup branches to the intended list and returns to FullSync', () => {
  const { ram, state, microcode, warnings } = harness();
  const commands = [
    [0xbc000400, 0],           // segment 0, first command in the actual ROM
    [0xbc000404, 0x80000200],  // segment 1 (ROM later uses 0x001e0e98)
    [0x06000000, 0x01000020],
    [0xe9000000, 0],
    [0xb8000000, 0],
  ];
  commands.forEach(([cmd0, cmd1], i) => {
    ram.setUint32(0x100 + i * 8, cmd0);
    ram.setUint32(0x104 + i * 8, cmd1);
  });
  // The incorrect zero segment would reach this invalid CPU instruction.
  ram.setUint32(0x20, 0x93280000);
  ram.setUint32(0x24, 0x5500fffb);
  ram.setUint32(0x220, 0xb8000000);
  const visited = [];
  const next = state.nextCommand.bind(state);
  state.nextCommand = () => {
    const result = next();
    if (result) {
      visited.push(state.pc - 8);
    }
    return result;
  };
  let fullSyncs = 0;
  state.onFullSync = () => fullSyncs++;
  expect(executeDisplayList(state, microcode, { commandLimit: 10 })).toBeNull();
  expect(visited).toEqual([0x100, 0x108, 0x110, 0x220, 0x118, 0x120]);
  expect(fullSyncs).toBe(1);
  expect(state.dlistStack).toEqual([]);
  expect(warnings).toEqual([]);
});

test('early MoveWord decodes light count, clip, fog and both light colour words', () => {
  const { state, microcode, warnings } = harness();
  microcode.executeMoveWord(0xbc000000, 0x80000040);
  expect(state.numLights).toBe(1);
  microcode.executeMoveWord(0xbc000204, 0x00010000);
  microcode.executeMoveWord(0xbc000600, 0xfff00020);
  expect(state.fogParameters.multiplier).toBe(-16);
  expect(state.fogParameters.offset).toBe(32);
  for (const offset of [0x20, 0x24]) {
    microcode.executeMoveWord(0xbc000800 | offset, 0x804020ff);
    expect(state.lights[1].color.r).toBeCloseTo(128 / 255);
    expect(state.lights[1].color.g).toBeCloseTo(64 / 255);
    expect(state.lights[1].color.b).toBeCloseTo(32 / 255);
  }
  expect(warnings).toEqual([]);
});

test('unknown early MoveWord indices do not alias a later command', () => {
  const { state, microcode, warnings } = harness();
  for (const index of [1, 3, 10, 0xff]) {
    microcode.executeMoveWord(0xbc000000 | (index << 8) | 4, 0x200);
  }
  expect(state.segments).toEqual(Array(16).fill(0));
  expect(warnings).toHaveLength(4);
});
