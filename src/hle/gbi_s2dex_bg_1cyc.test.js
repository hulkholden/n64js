import { convertTexels } from './debug_texture.js';
import { afterEach, describe, expect, test } from 'bun:test';
import { GBI1SDEX, GBI2SDEX } from './gbi_s2dex.js';
import { RSPState } from './rsp_state.js';
import { bg1cycCase, bg1cycCases } from '../../tools/s2dex_bg_1cyc_cases.js';
import * as gbi from './gbi.js';

const savedN64js = globalThis.n64js;
afterEach(() => { globalThis.n64js = savedN64js; });

function render(options, Microcode = GBI2SDEX, checkPixels = true) {
  const fixture = bg1cycCase(options);
  const state = new RSPState();
  fixture.init(state);
  globalThis.n64js = { hardware: () => ({ cachedMemDevice: { u8: fixture.ram } }) };
  const microcode = new Microcode(state, fixture.dv);
  const warnings = [], draws = [], syncs = [], loads = [];
  const load = state.tmem.loadBackground.bind(state.tmem);
  state.tmem.loadBackground = (...args) => { loads.push(args.slice(2)); return load(...args); };
  microcode.warn = message => warnings.push(message);
  const pixels = new Uint8Array(600 * 100 * 4);
  const palette = state.tmem.tmemData.slice(0x800);
  microcode.renderer = {
    syncFramebufferToRAM: (...args) => syncs.push(args),
    texRect(index, x0, y0, x1, y1, s0, t0, s1, t1) {
      const tile = state.tiles[index];
      draws.push({ x0, y0, x1, y1, s0, t0, s1, t1, width: tile.width, height: tile.height });
      expect(tile.line * 8 * tile.height).toBeLessThanOrEqual(
        fixture.format === gbi.ImageFormat.G_IM_FMT_CI || fixture.size === gbi.ImageSize.G_IM_SIZ_32b ? 2048 : 4096);
      const decoded = new Uint8Array(tile.width * tile.height * 4);
      expect(convertTexels(decoded, tile.width, state.tmem.tmemData, tile, state.getTextureLUTType())).toBe(true);
      function texel(s, t) {
        expect(s).toBeGreaterThanOrEqual(0);
        expect(t).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThan(tile.width);
        expect(t).toBeLessThan(tile.height);
        const offset = (t * tile.width + s) * 4;
        return decoded.subarray(offset, offset + 4);
      }
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const s = s0 + (x - x0) * (s1 - s0) / (x1 - x0);
          const t = t0 + (y - y0) * (t1 - t0) / (y1 - y0);
          const u = Math.floor(s), v = Math.floor(t);
          let color = texel(u, v);
          if (fixture.config.filter !== gbi.TextureFilter.G_TF_POINT) {
            const a = Math.floor((s - u) * 32) / 32, b = Math.floor((t - v) * 32) / 32;
            const c10 = texel(u + 1, v), c01 = texel(u, v + 1);
            if (a + b < 1) {
              color = color.map((c, i) => Math.floor(c + (c10[i] - c) * a + (c01[i] - c) * b + 0.5));
            } else {
              color = texel(u + 1, v + 1).map((c, i) => Math.floor(c + (c01[i] - c) * (1 - a) + (c10[i] - c) * (1 - b) + 0.5));
            }
          }
          pixels.set(color, (y * 600 + x) * 4);
        }
      }
    },
  };
  const text = [], tips = [];
  const opcode = Microcode === GBI1SDEX ? 0x01 : 0x09;
  microcode.getHandler(opcode)(opcode << 24, 0x01000080, { text: t => text.push(t), tip: t => tips.push(t) });
  expect(warnings).toEqual([]);
  if (checkPixels) {
    for (let y = 0; y < 100; y++) {
      for (let x = 0; x < 600; x++) {
        const actual = pixels.subarray((y * 600 + x) * 4, (y * 600 + x + 1) * 4);
        const expected = fixture.expected(x, y);
        if (actual.some((v, i) => v !== expected[i])) {
          throw new Error(`pixel ${x},${y}: expected ${expected}, got ${Array.from(actual)}`);
        }
      }
    }
  }
  if (fixture.format === gbi.ImageFormat.G_IM_FMT_CI) {
    expect(state.tmem.tmemData.slice(0x800)).toEqual(palette);
  }
  return { fixture, draws, syncs, loads, microcode, text, tips, pixels };
}

describe('S2DEX 1-cycle backgrounds', () => {
  for (const [name, options] of bg1cycCases) {
    test(`${name}: scaled, clipped, wrapped TMEM pixels`, () => {
      const { draws, syncs, fixture } = render(options);
      expect(draws.length).toBeGreaterThan(0);
      expect(syncs).toEqual([[fixture.image, fixture.dv]]);
    });
  }
  test('GBI1 dispatch and disassembly', () => {
    const { text, tips } = render({}, GBI1SDEX);
    expect(text).toEqual(['gSPBgRect1Cyc(0x00000100);']);
    expect(tips[0]).toContain('scaleW/H = (0.5, 0.5), imageYorig = 65');
  });
  // Recorded from libultra guS2DEmuBgRect1Cyc (us2dex_emu.c), including
  // fractional strip heights, imageYorig rounding and the bottom-to-top wrap.
  for (const [imageYorig, expected] of [
    [3.25, [[0, 10, 16, 0.5], [10, 29, 32, 0], [29, 48, 61, 0], [48, 53, 10, 0]]],
    [-3.75, [[0, 6, 15, 0.5], [6, 25, 25, 0], [25, 44, 54, 0], [44, 53, 3, 0]]],
  ]) {
    test(`reference strip phase for imageYorig=${imageYorig}`, () => {
      const { draws, loads } = render({ imageX: 0, imageY: 17, imageYorig,
        frameX: 0, frameY: 0, frameH: 65, scaleH: 1.5,
        filter: gbi.TextureFilter.G_TF_BILERP, scissor: { x0: 0, y0: 0, x1: 120, y1: 65 } }, GBI2SDEX, false);
      expect(draws.map((d, i) => [d.y0, d.y1, (loads[i][1] + 80) % 80, d.t0])).toEqual(expected);
    });
    test(`scissoring preserves strip phase for imageYorig=${imageYorig}`, () => {
      const options = { imageX: 0, imageY: 17, imageYorig,
        frameX: 0, frameY: 0, frameH: 65, scaleH: 1.5, filter: gbi.TextureFilter.G_TF_BILERP };
      const full = render({ ...options, scissor: { x0: 0, y0: 0, x1: 120, y1: 65 } }, GBI2SDEX, false);
      const clipped = render({ ...options, scissor: { x0: 30, y0: 7, x1: 100, y1: 50 } }, GBI2SDEX, false);
      for (let y = 7; y < 50; y++) {
        expect(clipped.pixels.slice((y * 600 + 30) * 4, (y * 600 + 100) * 4))
          .toEqual(full.pixels.slice((y * 600 + 30) * 4, (y * 600 + 100) * 4));
      }
    });
  }
  test('imageLoad is ignored by 1-cycle backgrounds', () => { render({ load: 0 }); });
  for (const options of [{ imageW: 0 }, { imageH: 0 }, { frameW: 0 }, { frameH: 0 }, { scaleW: 0 }, { scaleH: 0 }, { frameX: 400 }, { frameY: 300 }]) {
    test(`empty background skips transfers: ${JSON.stringify(options)}`, () => {
      const { draws, syncs } = render(options);
      expect(draws).toEqual([]);
      expect(syncs).toEqual([]);
    });
  }
});
