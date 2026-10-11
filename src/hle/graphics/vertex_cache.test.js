import { describe, expect, test } from 'bun:test';
import { executeDisplayList } from './display_list.js';
import { GBI1 } from './gbi1.js';
import { NullRenderer } from './null_renderer.js';
import { RSPState } from './rsp_state.js';

function harness() {
  const ramDV = new DataView(new ArrayBuffer(0x2000));
  const state = new RSPState();
  state.reset(ramDV, 8);
  const microcode = new GBI1(state, ramDV);
  microcode.renderer = new NullRenderer(state);
  const warnings = [];
  microcode.warn = message => warnings.push(message);
  // Distinct UVs make stale or skipped vertex loads observable in the draw.
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

describe('F3DLP.Rej vertex cache', () => {
  test('loads and draws Quake II triangles across slot 64, batched and disassembled', () => {
    for (const disassembler of [null, { begin() {}, text() {}, tip() {}, end() {} }]) {
      const { ramDV, state, microcode, warnings } = harness();
      writeCommands(ramDV, [
        // Captured Quake II vertex commands; source addresses rebased to fixture data.
        [0x040081ff, 0x1000], // slots 0..31
        [0x044081ff, 0x1200], // slots 32..63
        [0x0480103f, 0x1400], // slots 64..67
        [0xb17a7e7c, 0x007c7e80], // (61,63,62), (62,63,64)
        [0xb1808284, 0x00808486], // (64,65,66), (64,66,67)
        [0xb8000000, 0],
      ]);
      const coords = [];
      microcode.renderer.flushTris = buffer => {
        coords.push(...buffer.coords.slice(0, buffer.numTris * 6));
      };
      executeDisplayList(state, microcode, { disassembler });
      expect(warnings).toEqual([]);
      expect(state.projectedVertices.slice(0, 68).every(vertex => vertex.set)).toBe(true);
      const indices = [61, 63, 62, 62, 63, 64, 64, 65, 66, 64, 66, 67];
      expect(coords).toEqual(indices.flatMap(index => [index, -index]));
      expect(state.currentOp).toBe(6);
    }
  });

  test('accepts a load ending at slot 79 and rejects one beyond the cache', () => {
    const { state, microcode, warnings } = harness();
    microcode.loadVertices(48, 32, 0x1000);
    expect(warnings).toEqual([]);
    expect(state.projectedVertices[79].set).toBe(true);
    expect(state.projectedVertices[79].u).toBe(31);
    microcode.loadVertices(79, 2, 0x1000);
    expect(warnings).toEqual(['Too many verts']);
    expect(state.projectedVertices[79].u).toBe(31);
    expect(state.projectedVertices).toHaveLength(80);
  });

  test('resets high cache entries between tasks', () => {
    const { ramDV, state, microcode } = harness();
    microcode.loadVertices(64, 16, 0x1000);
    expect(state.projectedVertices[79].set).toBe(true);
    state.reset(ramDV, 8);
    expect(state.projectedVertices).toHaveLength(80);
    expect(state.projectedVertices.every(vertex => !vertex.set)).toBe(true);
    expect(state.projectedVertices[79].u).toBe(0);
  });
});
