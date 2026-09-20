import { afterEach, expect, test } from 'bun:test';
import { executeDisplayList } from './display_list.js';
import { GBI1TEXA } from './gbi1_texa.js';
import { create } from './microcodes.js';
import { identifyMicrocode, MicrocodeId } from './microcode_identifier.js';
import { RSPState } from './rsp_state.js';

const version = 'RSP Gfx ucode F3DTEX/A      1.23 Yoshitaka Yasumoto Nintendo.';
const savedN64js = globalThis.n64js;
afterEach(() => { globalThis.n64js = savedN64js; });

test('classifies F3DTEX/A and constructs its texture-command handler', () => {
  const ramDV = new DataView(new ArrayBuffer(0x100));
  const state = new RSPState();
  expect(identifyMicrocode(version, 0)).toMatchObject({
    id: MicrocodeId.GBI1_TEXA, family: 'GBI1', variant: 'F3DTEX/A', detection: 'string',
  });
  expect(create({ detectVersionString: () => version, computeMicrocodeHash: () => 0 }, state, ramDV))
    .toBeInstanceOf(GBI1TEXA);
});

test('Tamagotchi texture commands load TMEM and set the render tile without drawing or culling', () => {
  for (const disassemble of [false, true]) {
    const ram = new Uint8Array(0x400000);
    const ramDV = new DataView(ram.buffer);
    globalThis.n64js = { hardware: () => ({ cachedMemDevice: { s32: new Int32Array(ram.buffer), u8: ram } }) };
    const state = new RSPState();
    state.reset(ramDV, 8);
    const microcode = new GBI1TEXA(state, ramDV);
    // Captured crashing command, followed by a second load to exercise adjacent
    // opcodes. These are texture pointers, not packed vertex indices.
    const commands = [
      [0xb50ff400, 0x80259b70], // 256 RGBA16 texels, dxt=1024 (two qwords/row)
      [0xb5003400, 0x8025a000], // overwrite only the first qword
      [0xbe5a4963, 0x0407c03c], // CI4, line=4, palette=5, bounds 32x16
      [0xb4000000, 0x12345678], // must execute after the former CullDL opcode
      [0xb8000000, 0],
    ];
    commands.forEach(([cmd0, cmd1], i) => {
      ramDV.setUint32(8 + i * 8, cmd0);
      ramDV.setUint32(12 + i * 8, cmd1);
    });
    for (let i = 0; i < 512; ++i) ram[0x259b70 + i] = (i + 1) & 0xff;
    ram.fill(0xa5, 0x25a000, 0x25a008);
    state.tiles[0].hash = 123;
    const text = [];
    const disassembler = disassemble ? { begin() {}, end() {}, tip() {}, text: value => text.push(value) } : null;
    executeDisplayList(state, microcode, { disassembler });
    expect(state.textureImage).toMatchObject({ format: 0, size: 2, width: 1, address: 0x25a000 });
    expect(state.tiles[7]).toMatchObject({ format: 0, size: 2, line: 0, tmem: 0 });
    expect(Array.from(state.tmem.tmemData.slice(0, 8))).toEqual(Array(8).fill(0xa5));
    expect(Array.from(state.tmem.tmemData.slice(8, 16))).toEqual([9, 10, 11, 12, 13, 14, 15, 16]);
    // LoadBlock swaps the two halves of qwords on odd rows.
    expect(Array.from(state.tmem.tmemData.slice(16, 24))).toEqual([21, 22, 23, 24, 17, 18, 19, 20]);
    expect(state.tmem.tmemData[511]).toBe(252);
    expect(state.tmem.tmemData[512]).toBe(0);
    expect(state.tiles[0]).toMatchObject({ format: 2, size: 0, line: 4, tmem: 0, palette: 5,
      cmT: 2, maskT: 9, shiftT: 2, cmS: 1, maskS: 6, shiftS: 3,
      uls: 0, ult: 0, lrs: 124, lrt: 60, hash: 0 });
    expect(state.rdpHalf1Cmd1).toBe(0x12345678);
    expect(state.currentOp).toBe(commands.length);
    expect(state.projectedVertices.every(vertex => !vertex.set)).toBe(true);
    if (disassemble) {
      expect(text.some(value => value.includes('gsDPLoadBlock'))).toBe(true);
      expect(text.some(value => value.includes('gsDPSetTileSize'))).toBe(true);
      expect(text.some(value => /Line3D|CullDisplayList/.test(value))).toBe(false);
    }
  }
});
