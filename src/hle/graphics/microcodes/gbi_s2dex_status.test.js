import { afterEach, describe, expect, test } from 'bun:test';
import { executeDisplayList } from '../display_list.js';
import { RSPState } from '../rsp_state.js';
import { GBI1SDEX, GBI2SDEX } from './gbi_s2dex.js';

const savedN64js = globalThis.n64js;
afterEach(() => { globalThis.n64js = savedN64js; });

function harness(Type) {
  const ram = new DataView(new ArrayBuffer(0x1000));
  const state = new RSPState();
  state.reset(ram, 8);
  const microcode = new Type(state, ram);
  const warnings = [], draws = [], loads = [];
  microcode.warn = (...args) => warnings.push(args);
  microcode.renderer = { texRect: (...args) => draws.push(args), texRectRot: (...args) => draws.push(args) };
  globalThis.n64js = { hardware: () => ({ cachedMemDevice: { u8: new Uint8Array(ram.buffer) } }) };
  for (const method of ['loadBlock', 'loadTile', 'loadTLUT']) {
    const original = state.tmem[method].bind(state.tmem);
    state.tmem[method] = (...args) => { loads.push(method); return original(...args); };
  }
  const write = (address, commands) => commands.forEach(([a, b], i) => {
    ram.setUint32(address + 8*i, a);
    ram.setUint32(address + 8*i + 4, b);
  });
  const status = (sid, value) => [Type === GBI1SDEX ? 0xbc000008 | (sid << 8) : 0xdb080000 | sid, value];
  const select = (address, sid, flag, mask, branch = false) => [
    [0xe4000000 | (sid << 16) | (address & 0xffff), flag],
    [(Type === GBI1SDEX ? 0xb0000000 : 0x04000000) | (branch ? 0x10000 : 0) | (address >>> 16), mask],
  ];
  const end = [Type === GBI1SDEX ? 0xb8000000 : 0xdf000000, 0];
  return { ram, state, microcode, warnings, draws, loads, write, status, select, end };
}

for (const Type of [GBI1SDEX, GBI2SDEX]) {
  describe(`${Type.name} status commands`, () => {
    for (const branch of [false, true]) {
      test(`SelectDL ${branch ? 'branches' : 'calls'} only on mismatches and updates masked status`, () => {
        const h = harness(Type);
        h.state.segments[2] = 0x100;
        h.write(8, [h.status(4, 0x80000001),
          ...h.select(0x02000080, 4, 0x80000000, 0x80000000, branch), // equal: skip
          ...h.select(0x02000080, 4, 0x40000000, 0xc0000000, branch),
          [0xfb000000, 0x12345678], h.end]);
        h.write(0x180, [[0xfa000000, 0xfeedface], h.end]);
        executeDisplayList(h.state, h.microcode, { commandLimit: 20 });
        expect(h.state.s2dexStatus[1]).toBe(0x40000001);
        expect(h.state.primColor).toBe(0xfeedface);
        expect(h.state.envColor).toBe(branch ? 0 : 0x12345678);
        expect(h.state.pc).toBe(0);
        expect(h.state.dlistStack).toEqual([]);
        expect(h.warnings).toEqual([]);
      });
    }

    test('disassembly follows the same decisions and shows decoded arguments', () => {
      const h = harness(Type);
      const texts = [];
      h.write(8, [...h.select(0x80, 12, 0x80000000, 0xffffffff), h.end]);
      h.write(0x80, [h.end]);
      executeDisplayList(h.state, h.microcode, { disassembler: {
        begin() {}, end() {}, text: s => texts.push(s),
      } });
      expect(texts).toContain('gSPSelectDL(0x00000080, 12, 0x80000000, 0xffffffff);');
      expect(h.state.s2dexStatus[3]).toBe(0x80000000);
    });

    test('invalid status IDs and incomplete pairs leave status and list control unchanged', () => {
      const h = harness(Type);
      const tail = h.select(0x80, 0, 1, 1)[1];
      h.write(8, [tail, h.status(1, 1), h.status(16, 1),
        ...h.select(0x80, 16, 1, 1),
        h.select(0x80, 0, 1, 1)[0], [0xfa000000, 123], tail, h.end]);
      executeDisplayList(h.state, h.microcode, { commandLimit: 20 });
      expect([...h.state.s2dexStatus]).toEqual([0, 0, 0, 0]);
      expect(h.state.primColor).toBe(123);
      expect(h.draws).toEqual([]);
      expect(h.warnings.length).toBeGreaterThanOrEqual(5);
    });

    test('flag bits outside the mask force selection and recursive calls remain bounded', () => {
      const h = harness(Type);
      h.write(8, [...h.select(8, 0, 2, 1), h.end]);
      expect(() => executeDisplayList(h.state, h.microcode, { commandLimit: 20 })).toThrow('command limit');
      expect(h.state.s2dexStatus[0]).toBe(0);
    });

    test('status and render mode survive an in-list microcode replacement and reset with the task', () => {
      const h = harness(Type);
      h.microcode.executeMoveWord(...h.status(8, 0xcafe));
      h.microcode.s2dex.executeObjRendermode(0, 0x18);
      const next = new Type(h.state, h.ram);
      expect(next.s2dex.statusMatches(8, 0xcafe, 0xffffffff)).toBe(true);
      expect(h.state.s2dexRenderMode).toBe(0x18);
      h.microcode.s2dex.saveRDPHalf0(0xe4000080, 1);
      h.state.reset(h.ram, 8);
      expect(h.state.s2dexSelectDL).toBeNull();
      expect([...h.state.s2dexStatus]).toEqual([0, 0, 0, 0]);
      expect(h.state.s2dexRenderMode).toBe(0);
    });

    for (const [type, method] of [[0x1033, 'loadBlock'], [0xfc1034, 'loadTile'], [0x30, 'loadTLUT']]) {
      test(`${method} skips identical status, reloads on mismatch, and shares SetStatus`, () => {
        const h = harness(Type);
        const tex = h.microcode.s2dex.texture;
        Object.assign(tex, {type, image: 0x200, sid: 8, flag: 0x80000001, mask: 0xffffffff,
          tileTMEM: type === 0x30 ? 0x100 : 0, texLoadSize: 0, texLoadRows: 0});
        h.ram.setUint16(0x200, 0x1234);
        h.microcode.s2dex.loadTexture();
        const tmem = h.state.tmem.tmemData.slice();
        h.ram.setUint16(0x200, 0xabcd);
        h.microcode.s2dex.loadTexture();
        expect(h.loads).toEqual([method]);
        expect(h.state.tmem.tmemData).toEqual(tmem);
        h.microcode.executeMoveWord(...h.status(8, 0));
        h.microcode.s2dex.loadTexture();
        expect(h.loads).toEqual([method, method]);
        expect(h.state.tmem.tmemData).not.toEqual(tmem);
        expect(h.state.s2dexStatus[2]).toBe(0x80000001);
        expect(h.warnings).toEqual([]);
      });
    }

    test('zero descriptors are skipped; invalid IDs/types do not mutate RDP state or mark status loaded', () => {
      const h = harness(Type);
      h.state.textureImage.address = 0xdead;
      h.microcode.s2dex.loadTexture();
      expect(h.warnings).toEqual([]);
      Object.assign(h.microcode.s2dex.texture, {type: 0, flag: 1, mask: 1});
      h.microcode.s2dex.loadTexture();
      Object.assign(h.microcode.s2dex.texture, {type: 0x1033, sid: 3});
      h.microcode.s2dex.loadTexture();
      expect(h.loads).toEqual([]);
      expect([...h.state.s2dexStatus]).toEqual([0, 0, 0, 0]);
      expect(h.state.textureImage.address).toBe(0xdead);
      expect(h.warnings).toHaveLength(2);
    });

    test('compound texture+sprite command still draws when the load is skipped', () => {
      const h = harness(Type);
      h.ram.setUint16(0x100 + 24 + 2, 1024);
      h.ram.setUint16(0x100 + 24 + 4, 8 * 32);
      h.ram.setUint16(0x100 + 24 + 10, 1024);
      h.ram.setUint16(0x100 + 24 + 12, 8 * 32);
      const opcode = Type === GBI1SDEX ? 0xc3 : 0x07;
      h.microcode.getHandler(opcode)(opcode << 24, 0x100);
      expect(h.loads).toEqual([]);
      expect(h.draws).toHaveLength(1);
      expect(h.warnings).toEqual([]);
    });

    test('HALF_0 still draws ordinary texture rectangles and does not consume an EndDL as SelectDL data', () => {
      const h = harness(Type);
      const half1 = Type === GBI1SDEX ? 0xb4000000 : 0xe1000000;
      const half2 = Type === GBI1SDEX ? 0xb3000000 : 0xf1000000;
      h.write(8, [[0xe4004004, 0], [half1, 0], [half2, 0x04000400], h.end]);
      executeDisplayList(h.state, h.microcode, { commandLimit: 20 });
      expect(h.draws).toHaveLength(1);
      expect(h.state.pc).toBe(0);
      h.state.reset(h.ram, 8);
      h.write(8, [[0xe4000000, 0], h.end]);
      executeDisplayList(h.state, h.microcode, { commandLimit: 20 });
      expect(h.draws).toHaveLength(1);
      expect(h.state.pc).toBe(0);
    });
  });
}
