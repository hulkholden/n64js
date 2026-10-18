import { describe, expect, test } from 'bun:test';
import '../../../headless/headless_env.js';
import { sprite2DCases, writeSprite2DFixture } from '../../../../test/webgl/sprite2d_cases.js';
import { RDPBuffer } from '../../../lle/rdp.js';
import { executeDisplayList } from '../display_list.js';
import { identifyMicrocode, MicrocodeId } from '../microcode_identifier.js';
import { create } from '../microcodes.js';
import { NullRenderer } from '../null_renderer.js';
import { RDPGraphics } from '../rdp_graphics.js';
import { RSPState } from '../rsp_state.js';
import { GBI0 } from './gbi0.js';
import { Sprite2D } from './sprite2d.js';

function harness(options = {}) {
  const ram = new DataView(new ArrayBuffer(0x40000));
  writeSprite2DFixture(ram, options);
  const state = new RSPState();
  state.reset(ram, 0x200);
  const microcode = new Sprite2D(state, ram);
  const renderer = new NullRenderer(state);
  microcode.renderer = renderer;
  const draws = [], warnings = [];
  microcode.warn = (...args) => warnings.push(args);
  renderer.texRect = (...rect) => draws.push({
    rect, tile: { ...state.tiles[0] }, tmem: new Uint8Array(state.tmem.tmemData),
    otherModeH: state.rdpOtherModeH & 0xffffff, otherModeL: state.rdpOtherModeL >>> 0,
  });
  return { ram, state, microcode, renderer, draws, warnings };
}

function withRAM(ram, fn) {
  const saved = globalThis.n64js;
  try {
    globalThis.n64js = { hardware: () => ({ cachedMemDevice: { u8: new Uint8Array(ram.buffer) }, timeline: { addEvent() {} } }) };
    fn();
  } finally {
    globalThis.n64js = saved;
  }
}

describe('Sprite2D dispatch', () => {
  test('identifies XBUS and FIFO code prefixes despite trailing data and the shared Fast3D version', () => {
    const version = 'RSP SW Version: 2.0H, 02-12-97';
    for (const prefix of [0xaed514f8, 0x6abfc6f8, 0xac7799c3, 0x25a1cbc3]) {
      for (const hash of [0xcfca6039, 0x3794043d, 0x63376c7b, 0xad2dc4e7, 0]) {
        expect(identifyMicrocode(version, hash, prefix)).toMatchObject({
          id: MicrocodeId.SPRITE2D, family: 'Sprite2D', detection: 'hash',
        });
        const { state, ram } = harness();
        expect(create({ detectVersionString: () => version, computeMicrocodeHash: n => n ? prefix : hash }, state, ram))
          .toBeInstanceOf(Sprite2D);
      }
    }
    for (const prefix of [null, 0x08abaaa9, 0xac7799c2, 0x25a1cbc2]) {
      expect(identifyMicrocode(version, 0, prefix)).toMatchObject({ id: MicrocodeId.GBI0, detection: 'fallback' });
    }
    // The same opcodes still cull and pop matrices in Fast3D.
    const { state, ram } = harness();
    const fast = new GBI0(state, ram);
    let culls = 0;
    fast.testClipFlags = () => { culls++; return true; };
    fast.getHandler(0xbe)(0xbe000000, 40);
    expect(culls).toBe(1);
  });

  test('processes Base, ScaleFlip and repeated Draw independently, including disassembly', () => {
    const h = harness();
    h.ram.setUint32(0x250, 0xbd000000);
    h.ram.setUint32(0x254, 0x00800080);
    h.ram.setUint32(0x258, 0xb8000000);
    const text = [];
    withRAM(h.ram, () => executeDisplayList(h.state, h.microcode, {
      disassembler: { begin() {}, end() {}, tip() {}, text: t => text.push(t) },
    }));
    expect(h.draws).toHaveLength(2);
    expect(text.filter(t => t.startsWith('gsSPSprite2D'))).toHaveLength(4);
    expect(h.state.currentOp).toBe(12);
    expect(h.state.pc).toBe(0);
    expect(h.warnings).toEqual([]);
  });

  test('invalid descriptors, image ranges and scales do not read past RAM or swallow the next command', () => {
    for (const mutate of [
      h => h.ram.setUint32(0x23c, h.ram.byteLength - 8),
      h => h.ram.setUint32(0x100, h.ram.byteLength - 8),
      h => h.ram.setUint32(0x244, 0),
      h => h.ram.setUint16(0x10a, 0xffff),
      h => {
        h.ram.setUint8(0x10e, 2);
        h.ram.setUint32(0x104, h.ram.byteLength - 8);
      },
    ]) {
      const h = harness();
      mutate(h);
      let syncs = 0;
      h.state.onFullSync = () => syncs++;
      withRAM(h.ram, () => executeDisplayList(h.state, h.microcode));
      expect(h.draws).toHaveLength(0);
      expect(h.warnings.length).toBeGreaterThan(0);
      expect(syncs).toBe(1);
      expect(h.state.pc).toBe(0);
    }
  });
});

describe('Sprite2D RSP output fixtures', () => {
  for (const { options, packets } of sprite2DCases) {
    test(JSON.stringify(options), () => {
      const actual = harness(options), expected = harness(options);
      withRAM(actual.ram, () => executeDisplayList(actual.state, actual.microcode));
      withRAM(expected.ram, () => {
        const rdp = new RDPGraphics(expected.state, expected.ram, expected.renderer);
        for (const packet of packets) {
          const dv = new DataView(new ArrayBuffer(packet.length * 4));
          packet.forEach((word, i) => dv.setUint32(i * 4, word));
          rdp.execute(packet[0] >>> 24 & 63, new RDPBuffer(dv, 0, dv.byteLength));
        }
      });
      expect(actual.warnings).toEqual([]);
      expect(actual.draws.length).toBeGreaterThan(0);
      expect(actual.draws).toEqual(expected.draws);
    });
  }
});
