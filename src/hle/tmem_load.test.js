import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { RSPState } from './rsp_state.js';
import { ImageFormat as Format, ImageSize as Size } from './gbi.js';
import { GBIMicrocode } from './gbi_microcode.js';
import { S2DEXCommon } from './gbi_s2dex.js';

let savedN64js, ram, state, tile, tmem, ti;
beforeEach(() => {
  savedN64js = globalThis.n64js;
  ram = Uint8Array.from({ length: 8192 }, (_, i) => (i + 1) & 255);
  globalThis.n64js = { hardware: () => ({ cachedMemDevice: { u8: ram } }) };
  state = new RSPState();
  state.reset(new DataView(ram.buffer), 0);
  tile = state.tiles[7];
  tmem = state.tmem;
  ti = state.textureImage;
  tmem.tmemData.fill(0xa5);
});
afterEach(() => { globalThis.n64js = savedN64js; });

function configure(format, size, line, base, width, address = 0) {
  tile.set(format, size, line, base, 0, 0, 0, 0, 0, 0, 0);
  ti.set(format, size, width, address);
}

function bytes(offset, length = 8) {
  return Array.from(tmem.tmemData.slice(offset, offset + length));
}

describe('TMEM load commands', () => {
  for (const [command, cmd0, cmd1, bounds] of [
    ['executeLoadBlock', 0xf3fff400, 0x07000600, { uls: 4095, ult: 1024, lrs: 0, lrt: 1536 }],
    ['executeLoadTile', 0xf4008004, 0x07010008, { uls: 8, ult: 4, lrs: 16, lrt: 8 }],
    ['executeLoadTLut', 0xf0008004, 0x07010004, { uls: 8, ult: 4, lrs: 16, lrt: 4 }],
  ]) {
    test(`${command} updates bounds and invalidates hashes even when the load exits early`, () => {
      configure(Format.G_IM_FMT_RGBA, Size.G_IM_SIZ_4b, 1, 0, 16);
      tile.setSize(20, 24, 28, 32);
      for (const tile of state.tiles) tile.hash = 123;
      const microcode = new GBIMicrocode(state, new DataView(ram.buffer));

      microcode[command](cmd0, cmd1);

      expect(tile).toMatchObject(bounds);
      expect(state.tiles.map(tile => tile.hash)).toEqual(Array(8).fill(0));
      expect(tmem.tmemData).toEqual(new Uint8Array(4096).fill(0xa5));
    });
  }

  for (const [name, type, loadRows, expected] of [
    ['LoadBlock', 0x00001033, 1024, [1, 2, 3, 4, 5, 6, 7, 8]],
    ['LoadTile', 0x00fc1034, 4, [1, 2, 3, 4, 5, 6, 7, 8]],
    ['LoadTLUT', 0x00000030, 0, [1, 2, 1, 2, 1, 2, 1, 2]],
  ]) {
    test(`S2DEX ${name} loads using the object texture bounds`, () => {
      tile.setSize(20, 24, 28, 32);
      for (const tile of state.tiles) tile.hash = 123;
      const s2dex = new S2DEXCommon(state, new DataView(ram.buffer), null);
      Object.assign(s2dex.texture, { type, image: 0, tileTMEM: 0, texLoadSize: 3, texLoadRows: loadRows });

      s2dex.loadTexture();

      expect(tile).toMatchObject({ uls: 0, ult: 0, lrs: 12, lrt: loadRows });
      expect(bytes(0)).toEqual(expected);
      expect(state.tiles.map(tile => tile.hash)).toEqual(Array(8).fill(0));
    });
  }
});

describe('physical TMEM loading', () => {
  test('RGBA32 splits RG/BA, wraps each half, and swizzles odd rows', () => {
    configure(Format.G_IM_FMT_RGBA, Size.G_IM_SIZ_32b, 1, 255, 4);
    tile.setSize(0, 0, 12, 4);
    tmem.loadTile(ti, tile);
    expect(bytes(0x7f8)).toEqual([1, 2, 5, 6, 9, 10, 13, 14]);
    expect(bytes(0xff8)).toEqual([3, 4, 7, 8, 11, 12, 15, 16]);
    expect(bytes(0)).toEqual([25, 26, 29, 30, 17, 18, 21, 22]);
    expect(bytes(0x800)).toEqual([27, 28, 31, 32, 19, 20, 23, 24]);
    expect(bytes(8)).toEqual(Array(8).fill(0xa5));

    const decoded = new Uint8Array(32);
    expect(tmem.convertTexels(decoded, 4, tile, 0)).toBe(true);
    expect(decoded).toEqual(ram.slice(0, 32));
  });

  test('YUV16 stores UV below Y with the physical tile stride', () => {
    configure(Format.G_IM_FMT_YUV, Size.G_IM_SIZ_16b, 1, 255, 8);
    tile.setSize(0, 0, 28, 4);
    tmem.loadTile(ti, tile);
    expect(bytes(0x7f8)).toEqual([1, 3, 5, 7, 9, 11, 13, 15]);
    expect(bytes(0xff8)).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
    expect(bytes(0)).toEqual([25, 27, 29, 31, 17, 19, 21, 23]);
    expect(bytes(0x800)).toEqual([26, 28, 30, 32, 18, 20, 22, 24]);

    const decoded = new Uint8Array(64);
    tmem.convertTexels(decoded, 8, tile, 0);
    expect(Array.from(decoded.slice(0, 12))).toEqual([1, 3, 2, 255, 1, 3, 4, 255, 5, 7, 6, 255]);
    expect(Array.from(decoded.slice(32, 44))).toEqual([17, 19, 18, 255, 17, 19, 20, 255, 21, 23, 22, 255]);
  });

  test('a 16-bit load can overwrite RG without overwriting BA', () => {
    configure(Format.G_IM_FMT_RGBA, Size.G_IM_SIZ_32b, 1, 0, 4);
    tile.setSize(0, 0, 12, 0);
    tmem.loadTile(ti, tile);
    const renderTile = state.tiles[0];
    renderTile.set(Format.G_IM_FMT_RGBA, Size.G_IM_SIZ_32b, 1, 0, 0, 0, 0, 0, 0, 0, 0);
    renderTile.setSize(0, 0, 12, 0);
    const before = tmem.calculateCRC(renderTile);

    configure(Format.G_IM_FMT_RGBA, Size.G_IM_SIZ_16b, 1, 0, 4, 32);
    tile.setSize(0, 0, 0, 0);
    tmem.loadTile(ti, tile);
    const decoded = new Uint8Array(16);
    tmem.convertTexels(decoded, 4, renderTile, 0);
    expect(Array.from(decoded)).toEqual([33, 34, 3, 4, 35, 36, 7, 8, 37, 38, 11, 12, 39, 40, 15, 16]);
    state.invalidateTileHashes();
    expect(tmem.calculateCRC(renderTile)).not.toBe(before);
  });

  test('LoadTile reads whole qwords at unaligned source addresses and preserves stride padding', () => {
    configure(Format.G_IM_FMT_I, Size.G_IM_SIZ_8b, 2, 511, 13, 3);
    tile.setSize(8, 0, 16, 4);
    tmem.loadTile(ti, tile);
    expect(bytes(0xff8)).toEqual([6, 7, 8, 9, 10, 11, 12, 13]);
    expect(bytes(0)).toEqual(Array(8).fill(0xa5));
    expect(bytes(8)).toEqual([23, 24, 25, 26, 19, 20, 21, 22]);
    expect(bytes(16)).toEqual(Array(8).fill(0xa5));
  });

  test('zero line stride lets later rows overwrite the same physical memory', () => {
    configure(Format.G_IM_FMT_RGBA, Size.G_IM_SIZ_16b, 0, 0, 4);
    tile.setSize(0, 0, 12, 4);
    tmem.loadTile(ti, tile);
    expect(bytes(0)).toEqual([13, 14, 15, 16, 9, 10, 11, 12]);
    expect(bytes(8)).toEqual(Array(8).fill(0xa5));
  });

  test('LoadBlock retains fractional DXT carry and uses its integer part in the destination stride', () => {
    configure(Format.G_IM_FMT_RGBA, Size.G_IM_SIZ_16b, 1, 0, 4);
    tile.setSize(0, 0, 31, 1536);
    tmem.loadBlock(ti, tile);
    // At DXT=0.75, T is 0,0,1,2,3,3,4,5. The load tile's line adds T
    // words to the otherwise linear destination; it does not reset S.
    for (const [source, destination, odd] of [
      [0, 0, false], [1, 1, false], [2, 3, true], [3, 5, false],
      [4, 7, true], [5, 8, true], [6, 10, false], [7, 12, true],
    ]) {
      const start = source * 8 + 1;
      const expected = odd ? [4, 5, 6, 7, 0, 1, 2, 3] : [0, 1, 2, 3, 4, 5, 6, 7];
      expect(bytes(destination * 8)).toEqual(expected.map(value => start + value));
    }
    expect(bytes(16)).toEqual(Array(8).fill(0xa5));
  });

  test('LoadBlock preserves an unaligned source pointer and wraps destination writes', () => {
    configure(Format.G_IM_FMT_I, Size.G_IM_SIZ_8b, 0, 511, 32, 1);
    tile.setSize(0, 0, 15, 2048);
    tmem.loadBlock(ti, tile);
    expect(bytes(0xff8)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(bytes(0)).toEqual([14, 15, 16, 17, 10, 11, 12, 13]);
  });

  test('LoadBlock sign-extends source S, masks source T, and wraps the inclusive count', () => {
    configure(Format.G_IM_FMT_RGBA, Size.G_IM_SIZ_16b, 0, 0, 16, 64);
    tile.setSize(4095, 1024, 0, 0);
    tmem.loadBlock(ti, tile);
    // S=-1, T=0, two texels rounded to one complete qword from byte 62.
    expect(bytes(0)).toEqual([63, 64, 65, 66, 67, 68, 69, 70]);
    expect(bytes(8)).toEqual(Array(8).fill(0xa5));
  });

  test('a single row starting at subpixel 3 retains the edge walker\'s empty-span behavior', () => {
    configure(Format.G_IM_FMT_I, Size.G_IM_SIZ_8b, 1, 0, 16);
    tile.setSize(0, 3, 60, 3);
    tmem.loadTile(ti, tile);
    // The empty edge walk leaves the rightmost X at zero: one texel at S=0.
    expect(bytes(0)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(bytes(8)).toEqual(Array(8).fill(0xa5));
  });

  test('long empty spans wrap signed load coordinates before 8-bit bank addressing', () => {
    configure(Format.G_IM_FMT_I, Size.G_IM_SIZ_8b, 1, 0, 16);
    for (let i = 0; i < ram.length; i++) ram[i] = (i * 37 + (i >>> 8) * 13) & 255;
    tile.setSize(8, 3, 60, 3);
    tmem.loadTile(ti, tile);
    // S=2 with rightmost X=0 gives a 4095-texel span. Signed S wraps at
    // 1024/3072 texels; its last two passes overwrite only these two regions.
    expect(bytes(0)).toEqual(Array.from(ram.slice(2050, 2058)));
    expect(bytes(0xc00)).toEqual(Array.from(ram.slice(3074, 3082)));
    expect(bytes(0xff8)).toEqual(Array.from(ram.slice(4090, 4098)));
    expect(tmem.tmemData.slice(0x400, 0xc00)).toEqual(new Uint8Array(2048).fill(0xa5));
  });

  test('source size controls fetch advancement while load tile size controls destination spacing', () => {
    configure(Format.G_IM_FMT_RGBA, Size.G_IM_SIZ_32b, 0, 0, 8);
    ti.size = Size.G_IM_SIZ_16b;
    tile.setSize(0, 0, 7, 0);
    tmem.loadBlock(ti, tile);
    expect(bytes(0, 12)).toEqual([1, 2, 5, 6, 0xa5, 0xa5, 0xa5, 0xa5, 9, 10, 13, 14]);
    expect(bytes(0x800, 12)).toEqual([3, 4, 7, 8, 0xa5, 0xa5, 0xa5, 0xa5, 11, 12, 15, 16]);
  });

  test('TLUT replicates entries into all four banks and wraps through TMEM', () => {
    configure(Format.G_IM_FMT_RGBA, Size.G_IM_SIZ_4b, 0, 511, 4);
    ti.size = Size.G_IM_SIZ_16b;
    tile.setSize(0, 0, 4, 0);
    tmem.loadTLUT(ti, tile);
    expect(bytes(0xff8)).toEqual([1, 2, 1, 2, 1, 2, 1, 2]);
    expect(bytes(0)).toEqual([3, 4, 3, 4, 3, 4, 3, 4]);
    expect(bytes(8)).toEqual(Array(8).fill(0xa5));
  });

  test('an odd TLUT source address fetches distinct values for the four banks', () => {
    configure(Format.G_IM_FMT_RGBA, Size.G_IM_SIZ_4b, 0, 256, 4, 1);
    ti.size = Size.G_IM_SIZ_16b;
    tile.setSize(0, 0, 4, 0);
    tmem.loadTLUT(ti, tile);
    expect(bytes(0x800)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(bytes(0x808)).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
  });

  test('unsupported 4-bit source and multi-row TLUT loads preserve TMEM', () => {
    configure(Format.G_IM_FMT_RGBA, Size.G_IM_SIZ_4b, 1, 0, 16);
    tile.setSize(0, 0, 60, 4);
    tmem.loadTile(ti, tile);
    tile.setSize(0, 0, 31, 1024);
    tmem.loadBlock(ti, tile);
    tile.setSize(0, 0, 60, 0);
    tmem.loadTLUT(ti, tile);
    ti.size = Size.G_IM_SIZ_16b;
    tile.setSize(0, 0, 60, 4);
    tmem.loadTLUT(ti, tile);
    expect(tmem.tmemData).toEqual(new Uint8Array(4096).fill(0xa5));
  });
});

for (const [name, format, size, width] of [
  ['RGBA32', Format.G_IM_FMT_RGBA, Size.G_IM_SIZ_32b, 4],
  ['YUV16', Format.G_IM_FMT_YUV, Size.G_IM_SIZ_16b, 8],
]) {
  test(`${name} cache hash includes both wrapped halves, including texels beyond the line stride`, () => {
    configure(format, size, 1, 255, width);
    tile.setSize(0, 0, (width * 2 - 1) * 4, 4);
    const before = tmem.calculateCRC(tile);
    const pixels = new Uint8Array(tile.width * tile.height * 4);
    tmem.convertTexels(pixels, tile.width, tile, 0);
    // All these bytes are sampled, including the expanded second row.
    for (const address of [0x7f8, 0xff8, 0, 0x800, 12, 0x80c]) {
      tmem.tmemData[address] ^= 1;
      tile.hash = 0;
      const changed = new Uint8Array(pixels.length);
      tmem.convertTexels(changed, tile.width, tile, 0);
      expect(changed).not.toEqual(pixels);
      expect(tmem.calculateCRC(tile)).not.toBe(before);
      tmem.tmemData[address] ^= 1;
    }
  });
}
