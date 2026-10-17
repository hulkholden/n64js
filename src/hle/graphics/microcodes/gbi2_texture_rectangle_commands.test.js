import { describe, expect, test } from 'bun:test';
import { executeDisplayList } from '../display_list.js';
import { GBI2 } from './gbi2.js';
import { RSPState } from '../rsp_state.js';

function harness(commands, disassembler = null) {
  const ramDV = new DataView(new ArrayBuffer(0x200));
  // Call the rectangle list, then execute a parent command before returning.
  const write = (address, list) => list.forEach(([a, b], i) => {
    ramDV.setUint32(address + i * 8, a);
    ramDV.setUint32(address + i * 8 + 4, b);
  });
  write(8, [[0xde000000, 0x80], [0xe1000000, 0xbeef], [0xdf000000, 0]]);
  write(0x80, commands);
  const state = new RSPState();
  state.reset(ramDV, 8);
  const microcode = new GBI2(state, ramDV);
  const draws = [];
  const warnings = [];
  microcode.rdpTexRect = (cmd0, cmd1, cmd2, cmd3, dis, flip) => draws.push([flip, cmd0, cmd1, cmd2, cmd3]);
  microcode.warn = message => warnings.push(message);
  executeDisplayList(state, microcode, { disassembler });
  return { state, draws, warnings };
}

describe('GBI2 texture rectangle parameter commands', () => {
  for (const disassembled of [false, true]) {
    for (const opcode of [0xe4, 0xe5]) {
      const disassembler = disassembled ? { begin() {}, text() {}, end() {} } : null;
      const cmd0 = ((opcode << 24) | 0x680514) >>> 0;
      const label = `${opcode.toString(16)}, disassembled=${disassembled}`;

      test(`preserves EndDL after an incomplete rectangle (${label})`, () => {
        // Captured at 0x91610 in Triple Play 2000 seed 2, VI 1745.
        const { state, draws, warnings } = harness([
          [cmd0, 0x0067c510], [0xe1000000, 0], [0xdf000000, 0],
          // If EndDL is swallowed this data would decode to vertex slot -16.
          [0x01010100, 0],
        ], disassembler);
        expect(draws).toEqual([]);
        expect(warnings).toEqual(['Incomplete GBI2 texture rectangle: expected RDPHalf2 or RDPHalf1 and RDPHalf2']);
        expect(state.rdpHalf1Cmd1).toBe(0xbeef);
        expect(state.pc).toBe(0);
        expect(state.dlistStack).toEqual([]);
      });

      test(`renders complete parameters and returns to the parent (${label})`, () => {
        const { state, draws, warnings } = harness([
          [cmd0, 0x0067c510], [0xe1000000, 0x00200040],
          [0xf1000000, 0x04000400], [0xdf000000, 0],
        ], disassembler);
        expect(draws).toEqual([[opcode === 0xe5, cmd0, 0x0067c510, 0x00200040, 0x04000400]]);
        expect(warnings).toEqual([]);
        expect(state.rdpHalf1Cmd1).toBe(0xbeef);
        expect(state.pc).toBe(0);
      });

      test(`reuses S/T from a complete rectangle (${label})`, () => {
        const { state, draws, warnings } = harness([
          [cmd0, 0x0067c510], [0xe1000000, 0x00200040], [0xf1000000, 0x04000400],
          [cmd0, 0x0067c510], [0xf1000000, 0x08000200],
          [cmd0, 0x0067c510], [0xf1000000, 0xfc000400], [0xdf000000, 0],
        ], disassembler);
        expect(draws).toEqual([
          [opcode === 0xe5, cmd0, 0x0067c510, 0x00200040, 0x04000400],
          [opcode === 0xe5, cmd0, 0x0067c510, 0x00200040, 0x08000200],
          [opcode === 0xe5, cmd0, 0x0067c510, 0x00200040, 0xfc000400],
        ]);
        expect(warnings).toEqual([]);
        expect(state.rdpHalf1Cmd1).toBe(0xbeef);
        expect(state.pc).toBe(0);
        expect(state.dlistStack).toEqual([]);
      });

      test(`uses a standalone RDPHalf1 before the rectangle (${label})`, () => {
        const { draws, warnings } = harness([
          [0xe1000000, 0x00400080], [cmd0, 0x0067c510],
          [0xf1000000, 0x04000400], [0xdf000000, 0],
        ], disassembler);
        expect(draws).toEqual([[opcode === 0xe5, cmd0, 0x0067c510, 0x00400080, 0x04000400]]);
        expect(warnings).toEqual([]);
      });
    }
  }

  test('renders the All-Star Baseball short rectangle without consuming the next command', () => {
    // All-Star Baseball 2000 (Europe), VI 38, display-list PC 0x135b00.
    const { state, draws, warnings } = harness([
      [0xe428c078, 0x0024c048], [0xf1000000, 0x04000400],
      [0xfd500000, 0x80464e10], [0xdf000000, 0],
    ]);
    expect(draws).toEqual([[false, 0xe428c078, 0x0024c048, 0, 0x04000400]]);
    expect(state.textureImage.address).toBe(0x00464e10);
    expect(warnings).toEqual([]);
  });

  test('keeps the guard for WinBack raw parameters', () => {
    // WinBack USA, seed 2, VI 1380. These are not GBI2 half commands.
    const { draws, warnings, state } = harness([
      [0xe4130130, 0x00030030], [0x00200020, 0x04000400], [0xdf000000, 0],
    ]);
    expect(draws).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(state.rdpHalf1Cmd1).toBe(0xbeef);
    expect(state.pc).toBe(0);
  });

  test('preserves a branch after RDPHalf1 without RDPHalf2', () => {
    const { draws, warnings, state } = harness([
      [0xe428c078, 0x0024c048], [0xe1000000, 0x00200040],
      [0xde010000, 0x98], [0xdf000000, 0],
    ]);
    expect(draws).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(state.rdpHalf1Cmd1).toBe(0xbeef);
    expect(state.pc).toBe(0);
  });

  test('preserves a list return when both parameter commands are absent', () => {
    const { state, draws, warnings } = harness([
      [0xe4680514, 0x0067c510], [0xdf000000, 0],
    ]);
    expect(draws).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(state.rdpHalf1Cmd1).toBe(0xbeef);
    expect(state.pc).toBe(0);
  });

  test('does not read parameter words beyond RAM or a counted list', () => {
    for (const pcEnd of [0, 16]) {
      const ramDV = new DataView(new ArrayBuffer(pcEnd ? 64 : 16));
      ramDV.setUint32(8, 0xe1000000);
      const state = new RSPState();
      state.reset(ramDV, 8);
      state.pcEnd = pcEnd;
      const microcode = new GBI2(state, ramDV);
      microcode.warn = () => {};
      expect(microcode.readTexRectParams()).toBeNull();
      expect(state.pc).toBe(8);
    }
  });

  test('accepts a short rectangle ending exactly at RAM or a counted-list boundary', () => {
    for (const pcEnd of [0, 16]) {
      const ramDV = new DataView(new ArrayBuffer(pcEnd ? 64 : 16));
      ramDV.setUint32(8, 0xf1000000);
      ramDV.setUint32(12, 0x04000400);
      const state = new RSPState();
      state.reset(ramDV, 8);
      state.pcEnd = pcEnd;
      state.rdpHalf1Cmd1 = 0x00200040;
      const microcode = new GBI2(state, ramDV);
      expect(microcode.readTexRectParams()).toEqual([0x00200040, 0x04000400]);
      expect(state.pc).toBe(16);
    }
  });

  test('rejects a truncated RDPHalf2 without reading or advancing', () => {
    for (const [size, pc, pcEnd] of [[12, 8, 0], [16, 8, 8], [16, 0, 0]]) {
      const ramDV = new DataView(new ArrayBuffer(size));
      ramDV.setUint32(pc, 0xf1000000);
      const state = new RSPState();
      state.reset(ramDV, pc);
      state.pcEnd = pcEnd;
      const microcode = new GBI2(state, ramDV);
      const warnings = [];
      microcode.warn = message => warnings.push(message);
      expect(microcode.readTexRectParams()).toBeNull();
      expect(state.pc).toBe(pc);
      expect(warnings).toHaveLength(1);
    }
  });

  test('does not reuse a previous task’s S/T', () => {
    const ramDV = new DataView(new ArrayBuffer(16));
    ramDV.setUint32(8, 0xf1000000);
    ramDV.setUint32(12, 0x04000400);
    const state = new RSPState();
    state.rdpHalf1Cmd1 = 0x00200040;
    state.reset(ramDV, 8);
    const microcode = new GBI2(state, ramDV);
    expect(microcode.readTexRectParams()).toEqual([0, 0x04000400]);
  });
});
