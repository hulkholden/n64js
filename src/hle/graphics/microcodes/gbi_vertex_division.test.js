import { describe, expect, test } from 'bun:test';
import { executeDisplayList } from '../display_list.js';
import { NullRenderer } from '../null_renderer.js';
import { RSPState } from '../rsp_state.js';
import { GBI0, GBI0SE, GBI0WR } from './gbi0.js';
import { GBI1 } from './gbi1.js';

function harness(MicrocodeClass) {
  const ramDV = new DataView(new ArrayBuffer(0x2000));
  const state = new RSPState();
  state.reset(ramDV, 8);
  const microcode = new MicrocodeClass(state, ramDV);
  microcode.renderer = new NullRenderer(state);
  const warnings = [];
  microcode.warn = message => warnings.push(message);
  for (let i = 0; i < 80; ++i) {
    ramDV.setInt16(0x1000 + i * 16 + 8, i * 32);
    ramDV.setInt16(0x1000 + i * 16 + 10, -i * 32);
  }
  return { ramDV, state, microcode, warnings };
}

function writeCommands(ramDV, commands) {
  commands.forEach(([cmd0, cmd1], i) => {
    ramDV.setUint32(8 + i * 8, cmd0);
    ramDV.setUint32(12 + i * 8, cmd1);
  });
}

describe('GBI integer division for vertex counts and indices', () => {
  test('GBI0SE.executeVertex truncates vertex count division', () => {
    const { ramDV, state, microcode, warnings } = harness(GBI0SE);
    const lines = [];
    const disassembler = {
      begin() {},
      text(line) { lines.push(line); },
      tip() {},
      end() {},
    };
    writeCommands(ramDV, [
      [(0x04 << 24) | ((33 * 3 + 1) << 4), 0x1000],
      [0xb8000000, 0],
    ]);

    executeDisplayList(state, microcode, { disassembler });

    expect(warnings).toEqual([]);
    expect(lines).toEqual(['gsSPVertex(0x00001000, 0, 4);', 'gsSPEndDisplayList();']);
    expect(state.projectedVertices.slice(0, 4).every(vertex => vertex.set)).toBe(true);
    expect(state.projectedVertices[4].set).toBe(false);

    const boundary = harness(GBI0SE);
    writeCommands(boundary.ramDV, [
      [(0x04 << 24) | ((33 * 79 + 1) << 4), 0x1000],
      [0xb8000000, 0],
    ]);
    executeDisplayList(boundary.state, boundary.microcode);
    expect(boundary.warnings).toEqual([]);
    expect(boundary.state.projectedVertices[79].set).toBe(true);
  });

  test('GBI1.executeLine3D via GBI0 truncates unaligned byte indices', () => {
    const { ramDV, state, microcode, warnings } = harness(GBI0);
    const coords = [];
    microcode.renderer.flushTris = tb => {
      coords.push(...tb.coords.slice(0, tb.numTris * 6));
      tb.reset();
    };
    writeCommands(ramDV, [
      [0x04300000, 0x1000], // Load 4 vertices into slots 0..3.
      [0xb5000000, 0x010a141e],
      [0xb8000000, 0],
    ]);

    executeDisplayList(state, microcode);

    expect(warnings).toEqual([]);
    expect(coords).toEqual([1, -1, 2, -2, 3, -3, 3, -3, 0, 0, 1, -1]);
  });

  test('GBI0WR.executeVertex truncates unaligned v0 slot offset', () => {
    const { ramDV, state, microcode, warnings } = harness(GBI0WR);
    writeCommands(ramDV, [
      [(0x04 << 24) | (6 << 16) | (1 << 9), 0x1000],
      [0xb8000000, 0],
    ]);

    executeDisplayList(state, microcode);

    expect(warnings).toEqual([]);
    expect(state.projectedVertices[1].set).toBe(true);
  });

  test('GBI1.executeVertex, executeTri1, and executeTri2 truncate odd byte offsets', () => {
    const { ramDV, state, microcode, warnings } = harness(GBI1);
    const coords = [];
    microcode.renderer.flushTris = tb => {
      coords.push(...tb.coords.slice(0, tb.numTris * 6));
      tb.reset();
    };
    writeCommands(ramDV, [
      [(0x04 << 24) | (3 << 16) | (1 << 10), 0x1000], // v0 = floor(3 / 2) = 1, n = 1
      [(0x04 << 24) | (4 << 10), 0x1000],             // slots 0..3
      [0xbf000000, 0x00000205],                       // Tri1(0, 1, 2)
      [0xb1000205, 0x00020407],                       // Tri2(0, 1, 2, 1, 2, 3)
      [0xb8000000, 0],
    ]);

    executeDisplayList(state, microcode);

    expect(warnings).toEqual([]);
    expect(state.projectedVertices[1].set).toBe(true);
    expect(coords).toEqual([
      0, 0, 1, -1, 2, -2,
      0, 0, 1, -1, 2, -2,
      1, -1, 2, -2, 3, -3,
    ]);
  });
});
