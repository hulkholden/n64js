import { convertTexels } from './debug_texture.js';
import { afterEach, describe, expect, test } from 'bun:test';
import { GBI1SDEX, GBI2SDEX } from './gbi_s2dex.js';
import { RSPState } from './rsp_state.js';
import { bgCopyCase, bgCopyFormats } from '../../tools/s2dex_bg_copy_cases.js';
import * as gbi from './gbi.js';

const savedN64js = globalThis.n64js;
afterEach(() => { globalThis.n64js = savedN64js; });

function render(options, Microcode = GBI2SDEX, dis = null) {
  const fixture = bgCopyCase(options);
  const { ram, dv } = fixture;
  globalThis.n64js = { hardware: () => ({ cachedMemDevice: { u8: ram } }) };
  const state = new RSPState();
  fixture.init(state);
  const palette = state.tmem.tmemData.slice(0x800);
  const microcode = new Microcode(state, dv);
  const warnings = [], draws = [], syncs = [], loads = [];
  microcode.warn = (...args) => warnings.push(args);
  for (const method of ['loadTile', 'loadBlock']) {
    const original = state.tmem[method].bind(state.tmem);
    state.tmem[method] = (...args) => { loads.push(method); return original(...args); };
  }
  const pixels = new Uint8Array(600 * 100 * 4);
  microcode.renderer = {
    syncFramebufferToRAM: (...args) => syncs.push(args),
    texRect(index, x0, y0, x1, y1, s0, t0, s1, t1) {
      draws.push([x0, y0, x1, y1]);
      const tile = state.tiles[index];
      const decoded = new Uint8Array(tile.width * tile.height * 4);
      expect(convertTexels(decoded, tile.width, state.tmem.tmemData, tile, state.getTextureLUTType())).toBe(true);
      // Poison hashes after each draw: every later load must invalidate them.
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const s = s0 + (x - x0) * (s1 - s0) / (x1 - x0);
          const t = t0 + (y - y0) * (t1 - t0) / (y1 - y0);
          const offset = (t * tile.width + s) * 4;
          pixels.set(decoded.subarray(offset, offset + 4), (y * 600 + x) * 4);
        }
      }
    },
  };
  const opcode = Microcode === GBI1SDEX ? 0x02 : 0x0a;
  microcode.getHandler(opcode)(opcode << 24, 0x01000080, dis);
  expect(warnings).toEqual([]);
  for (let y = 0; y < 100; y++) {
    for (let x = 0; x < 600; x++) {
      const actual = pixels.subarray((y * 600 + x) * 4, (y * 600 + x + 1) * 4);
      const expected = fixture.expected(x, y);
      if (actual.some((v, i) => v !== expected[i])) {
        throw new Error(`pixel ${x},${y}: expected ${expected}, got ${Array.from(actual)}`);
      }
    }
  }
  if (fixture.format === gbi.ImageFormat.G_IM_FMT_CI) {
    expect(state.tmem.tmemData.slice(0x800)).toEqual(palette);
  }
  return { draws, syncs, loads, microcode, fixture };
}

describe('S2DEX copy backgrounds', () => {
  for (const [name, format, size] of bgCopyFormats) {
    for (const load of [0xfff4, 0x0033]) {
      for (const flip of [false, true]) {
        test(`${name}, load=${load.toString(16)}, flip=${flip}: clips, wraps and decodes multiple TMEM strips`, () => {
          const { draws, loads, syncs, fixture } = render({ format, size, load, flip });
          expect(draws.length).toBeGreaterThan(2);
          expect(new Set(loads)).toEqual(new Set([load === 0x0033 ? 'loadBlock' : 'loadTile']));
          expect(syncs).toEqual([[fixture.image, fixture.dv]]);
        });
      }
    }
  }

  test('GBI1 dispatch and disassembly decode the copy descriptor without changing the rendered effect', () => {
    const text = [], tips = [];
    const { microcode } = render({}, GBI1SDEX, { text: t => text.push(t), tip: t => tips.push(t) });
    expect(text).toEqual(['gSPBgRectCopy(0x00000100);']);
    expect(tips[0]).toContain('imageW/H = (128, 80)');
    expect(microcode.s2dex.bg).toMatchObject({ imageX: 121, imageY: 65, frameX: -3, frameY: -2, imageLoad: 0xfff4 });
    expect(microcode.s2dex.bg.tmemW).toBe(31);
  });

  test('LoadBlock retains odd-row parity for a rounded DXT', () => {
    render({ imageW: 304, frameW: 300, imageX: 290, load: 0x0033 });
  });

  test('an unsupported LoadBlock stride uses equivalent tile transfers', () => {
    const { loads } = render({ imageW: 320, frameW: 300, imageX: 290, load: 0x0033 });
    expect(new Set(loads)).toEqual(new Set(['loadTile']));
  });

  test('a wide image is split horizontally as well as vertically', () => {
    render({ imageW: 1024, frameW: 590, imageX: 19, frameX: 0,
      scissor: { x0: 0, y0: 0, x1: 590, y1: 65 } });
  });

  test('copy coordinates discard unsupported subpixels', () => {
    render({ imageX: 121.75, imageY: 77.5, frameX: -2.25, frameY: -1.25 });
  });

  for (const options of [{ imageW: 0 }, { imageH: 0 }, { frameW: 0 }, { frameH: 0 }, { frameX: 400 }, { frameY: 300 }]) {
    test(`empty or clipped background does no transfer: ${JSON.stringify(options)}`, () => {
      const { draws, loads, syncs } = render(options);
      expect(draws).toEqual([]);
      expect(loads).toEqual([]);
      expect(syncs).toEqual([]);
    });
  }

  test('malformed format, size and load fields cannot enter the transfer loop', () => {
    const fixture = bgCopyCase();
    const state = new RSPState();
    fixture.init(state);
    const microcode = new GBI2SDEX(state, fixture.dv);
    const warnings = [];
    microcode.warn = message => warnings.push(message);
    microcode.renderer = { texRect() { throw new Error('Unexpected draw'); } };
    for (const [offset, value] of [[22, 255], [23, 255], [20, 1]]) {
      const previous = fixture.dv.getUint8(fixture.descriptor + offset);
      fixture.dv.setUint8(fixture.descriptor + offset, value);
      microcode.s2dex.executeBgCopy(0x0a000000, 0x01000080);
      fixture.dv.setUint8(fixture.descriptor + offset, previous);
    }
    expect(warnings).toEqual(Array(3).fill('gSPBgRectCopy: invalid background format, size or load type'));
  });
});
