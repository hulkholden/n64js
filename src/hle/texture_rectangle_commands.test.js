import { describe, expect, test } from 'bun:test';
import { executeDisplayList } from './display_list.js';
import { GBI2 } from './gbi2.js';
import { RSPState } from './rsp_state.js';

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
  microcode.rdpTexRect = (...args) => draws.push(['normal', ...args.slice(0, 4)]);
  microcode.rdpTexRectFlip = (...args) => draws.push(['flip', ...args.slice(0, 4)]);
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
        expect(warnings).toEqual(['Incomplete GBI2 texture rectangle: expected RDPHalf1 and RDPHalf2']);
        expect(state.rdpHalf1Cmd1).toBe(0xbeef);
        expect(state.pc).toBe(0);
        expect(state.dlistStack).toEqual([]);
      });

      test(`renders complete parameters and returns to the parent (${label})`, () => {
        const { state, draws, warnings } = harness([
          [cmd0, 0x0067c510], [0xe1000000, 0x00200040],
          [0xf1000000, 0x04000400], [0xdf000000, 0],
        ], disassembler);
        expect(draws).toEqual([[opcode === 0xe4 ? 'normal' : 'flip', cmd0, 0x0067c510, 0x00200040, 0x04000400]]);
        expect(warnings).toEqual([]);
        expect(state.rdpHalf1Cmd1).toBe(0xbeef);
        expect(state.pc).toBe(0);
      });
    }
  }

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
});
