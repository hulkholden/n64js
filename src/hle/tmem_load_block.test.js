import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as gbi from './gbi.js';
import { GBI2 } from './gbi2.js';
import { RSPState } from './rsp_state.js';

describe('TMEM LoadBlock source coordinates', () => {
  let previousN64js;
  let ram;
  let state;

  beforeEach(() => {
    previousN64js = globalThis.n64js;
    ram = new Int32Array(64 * 1024);
    for (let i = 0; i < ram.length; i++) {
      ram[i] = 0x12340000 + i;
    }
    globalThis.n64js = {
      ...previousN64js,
      hardware: () => ({ cachedMemDevice: { s32: ram, u8: new Uint8Array(ram.buffer) } }),
    };
    state = new RSPState();
    state.reset(new DataView(ram.buffer), 0);
  });

  afterEach(() => {
    globalThis.n64js = previousN64js;
  });

  test('loads successive F-Zero X background strips from whole source rows', () => {
    const tile = state.tiles[7];
    tile.size = gbi.ImageSize.G_IM_SIZ_16b;
    state.textureImage.set(gbi.ImageFormat.G_IM_FMT_RGBA, tile.size, 304, 0);

    // F-Zero X uploads its 304x240 background in 304x3 strips. LoadBlock
    // advances ult by 3 each time, with 912 texels and DXT = ceil(2048/76).
    for (const top of [0, 3, 6, 9, 237]) {
      state.tmem.loadBlock(state.textureImage, tile, 0, top, 911, 27);
      const firstWord = top * 152;
      expect(state.tmem.tmemData32.slice(0, 152)).toEqual(ram.slice(firstWord, firstWord + 152));
      // Odd rows swap the two 32-bit halves of each 64-bit word.
      const oddRow = ram.slice(firstWord + 152, firstWord + 304);
      for (let i = 0; i < oddRow.length; i += 2) {
        [oddRow[i], oddRow[i + 1]] = [oddRow[i + 1], oddRow[i]];
      }
      expect(state.tmem.tmemData32.slice(152, 304)).toEqual(oddRow);
      expect(state.tmem.tmemData32.slice(304, 456)).toEqual(ram.slice(firstWord + 304, firstWord + 456));
    }
  });

  for (const dxt of [0, 1024]) {
    test(`uses integer S and T offsets with DXT ${dxt}`, () => {
      const tile = state.tiles[7];
      tile.size = gbi.ImageSize.G_IM_SIZ_16b;
      tile.tmem = 5;
      state.textureImage.set(gbi.ImageFormat.G_IM_FMT_RGBA, tile.size, 16, 64);

      state.tmem.loadBlock(state.textureImage, tile, 4, 3, 11, dxt);

      // Base 64 + row 3 * 32 bytes + column 4 * 2 bytes = byte 168.
      // The inclusive S range 4..11 transfers 8 texels (16 bytes).
      expect(state.tmem.tmemData32.slice(10, 14)).toEqual(ram.slice(42, 46));
      expect(state.tmem.tmemData32[9]).toBe(0);
      expect(state.tmem.tmemData32[14]).toBe(0);
    });
  }

  test('accepts nonzero offsets through the display-list command without warnings', () => {
    const tile = state.tiles[7];
    tile.size = gbi.ImageSize.G_IM_SIZ_16b;
    state.textureImage.set(gbi.ImageFormat.G_IM_FMT_RGBA, tile.size, 16, 64);
    state.tiles[0].hash = 123;
    const microcode = new GBI2(state, new DataView(ram.buffer));
    const warnings = [];
    microcode.warn = message => warnings.push(message);

    microcode.executeLoadBlock(0xf3004003, 0x0700b000);

    expect(state.tmem.tmemData32.slice(0, 4)).toEqual(ram.slice(42, 46));
    expect(state.tiles[0].hash).toBe(0);
    expect(warnings).toEqual([]);
  });

  test('LoadTile still interprets its coordinates as 10.2 fixed point', () => {
    const tile = state.tiles[7];
    tile.size = gbi.ImageSize.G_IM_SIZ_16b;
    tile.line = 1;
    state.textureImage.set(gbi.ImageFormat.G_IM_FMT_RGBA, tile.size, 16, 64);

    state.tmem.loadTile(state.textureImage, tile, 4 << 2, 3 << 2, 7 << 2, 3 << 2);

    expect(state.tmem.tmemData32.slice(0, 2)).toEqual(ram.slice(42, 44));
    expect(state.tmem.tmemData32[2]).toBe(0);
  });
});
