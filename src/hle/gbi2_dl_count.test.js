import { describe, expect, test } from 'bun:test';
import { executeDisplayList } from './display_list.js';
import { GBI2 } from './gbi2.js';
import { GBI2SDEX } from './gbi_s2dex.js';
import { RSPState } from './rsp_state.js';

function harness(Type = GBI2, size = 0x1000) {
  const ram = new DataView(new ArrayBuffer(size));
  const state = new RSPState();
  state.reset(ram, 8);
  const microcode = new Type(state, ram);
  microcode.warn = message => { throw new Error(message); };
  const triangles = [];
  microcode.renderer = { flushTris: buffer => triangles.push(buffer.numTris) };
  return {
    state, triangles,
    write(address, commands) {
      commands.forEach(([a, b], i) => {
        ram.setUint32(address + i * 8, a);
        ram.setUint32(address + i * 8 + 4, b);
      });
    },
    run(disassembler = null) { executeDisplayList(state, microcode, { disassembler }); },
  };
}

describe('GBI2 counted display lists', () => {
  for (const disassembled of [false, true]) {
    const disassembler = disassembled ? { begin() {}, text() {}, end() {}, rgba8888() {} } : null;

    test(`executes the Cruis'n Exotica render setup and returns (disassembled=${disassembled})`, () => {
      const h = harness(GBI2, 0x50000);
      h.write(8, [[0xd500000c, 0x8004fc00], [0xe1000000, 0xbeef], [0xdf000000, 0]]);
      // The twelve commands at the target of the game's first 0xd5 command.
      // There is no EndDL before unrelated data starts at 0x4fc60.
      h.write(0x4fc00, [
        [0xe7000000, 0], [0xd9ffffff, 0x00200004],
        [0xe3000d01, 0], [0xe3000f00, 0x00010000],
        [0xe3001001, 0], [0xe3000c00, 0],
        [0xe3001201, 0x00003000], [0xe3000800, 0],
        [0xf9000000, 0], [0xe2001e01, 1],
        [0xe3001801, 0], [0xe3000a01, 0],
        [0x80059ed0, 0x80059ed8],
      ]);
      h.run(disassembler);
      expect(h.state.geometryModeBits).toBe(0x200004);
      expect(h.state.geometryMode.shadeSmooth).toBe(1);
      expect(h.state.rdpOtherModeH).toBe(0x13000);
      expect(h.state.rdpOtherModeL).toBe(0x500001);
      expect(h.state.rdpHalf1Cmd1).toBe(0xbeef);
      expect(h.state.currentOp).toBe(15);
      expect(h.state.pc).toBe(0);
      expect(h.state.dlistStack).toEqual([]);
    });

    test(`does not batch triangles past the count (disassembled=${disassembled})`, () => {
      const h = harness();
      h.write(8, [[0xd5000002, 0x80], [0xe1000000, 0xbeef], [0xdf000000, 0]]);
      h.write(0x80, [[0x05000204, 0], [0x05000204, 0], [0x05000204, 0], [0xdf000000, 0]]);
      h.run(disassembler);
      expect(h.triangles.reduce((sum, n) => sum + n, 0)).toBe(2);
      expect(h.state.currentOp).toBe(5);
      expect(h.state.rdpHalf1Cmd1).toBe(0xbeef);
      expect(h.state.pc).toBe(0);
    });

    test(`unwinds a parent whose final command calls a counted child (disassembled=${disassembled})`, () => {
      const h = harness();
      h.write(8, [[0xd5000001, 0x80], [0xf1000000, 0xbeef], [0xdf000000, 0]]);
      h.write(0x80, [[0xd5000001, 0x100], [0xff000000, 0]]);
      h.write(0x100, [[0xe1000000, 0xcafe], [0xff000000, 0]]);
      h.run(disassembler);
      expect(h.state.currentOp).toBe(5);
      expect(h.state.rdpHalf1Cmd1).toBe(0xcafe);
      expect(h.state.rdpHalf2Cmd1).toBe(0xbeef);
      expect(h.state.pc).toBe(0);
      expect(h.state.dlistStack).toEqual([]);
    });
  }

  for (const Type of [GBI2, GBI2SDEX]) {
    for (const count of [0, 1, 255]) {
      test(`${Type.name} uses the low byte count ${count} and resolves segmented addresses`, () => {
        const h = harness(Type);
        h.state.segments[3] = 0x100;
        h.write(8, [[0xd5abcd00 | count, 0x03000080], [0xdf000000, 0]]);
        h.write(0x180, [...Array(count).fill([0xe1000000, 0xcafe]), [0xff000000, 0]]);
        h.run();
        expect(h.state.rdpHalf1Cmd1).toBe(count ? 0xcafe : 0);
        expect(h.state.currentOp).toBe(count + 2);
        expect(h.state.pc).toBe(0);
      });
    }
  }

  test('allows an explicit EndDL before the count is exhausted', () => {
    const h = harness();
    h.write(8, [[0xd500000c, 0x80], [0xe1000000, 0xbeef], [0xdf000000, 0]]);
    h.write(0x80, [[0xdf000000, 0], [0xff000000, 0]]);
    h.run();
    expect(h.state.currentOp).toBe(4);
    expect(h.state.rdpHalf1Cmd1).toBe(0xbeef);
    expect(h.state.pc).toBe(0);
  });
});
