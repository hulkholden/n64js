import { describe, expect, test } from 'bun:test';
import { convertTexels } from './convert.js';
import { GBIMicrocode } from './gbi_microcode.js';
import { RSPState } from './rsp_state.js';
import { ImageFormat, ImageSize } from './gbi.js';

describe('YUV textures', () => {
  test('decodes signed SetConvert coefficients, including the split K2 field', () => {
    const state = new RSPState();
    const ram = new DataView(new ArrayBuffer(64));
    const ucode = new GBIMicrocode(state, ram);
    const lines = [];
    // The command used by Vigilante 8's intro.
    ucode.executeSetConvert(0xec15fd5d, 0x3b78e42a, { text: line => lines.push(line) });
    expect(Array.from(state.convert)).toEqual([175, -43, -89, 222, 114, 42]);
    expect(lines).toEqual(['gsDPSetConvert(175, -43, -89, 222, 114, 42);']);
    state.reset(ram, 0);
    expect(Array.from(state.convert)).toEqual([175, -43, -89, 222, 114, 42]);
    ucode.executeSetConvert(0xec201000, 0x04020100);
    expect(Array.from(state.convert)).toEqual([-256, -256, 0, -256, -256, -256]);
  });

  test('unpacks UYVY pairs, doubles the line stride, and unswizzles odd rows', () => {
    const src = new Uint8Array(4096);
    const tile = { format: ImageFormat.G_IM_FMT_YUV, size: ImageSize.G_IM_SIZ_16b,
      tmem: 2, line: 1, width: 3, height: 2 };
    src.set([128, 0, 128, 235, 10, 40, 240, 80], 16);
    src.set([20, 50, 230, 90, 30, 60, 220, 100], 32);
    const dst = { width: 4, data: new Uint8Array(32).fill(77) };
    expect(convertTexels(dst, src, tile, 0)).toBe(true);
    expect(Array.from(dst.data)).toEqual([
      128, 128, 0, 255, 128, 128, 235, 255, 10, 240, 40, 255, 77, 77, 77, 77,
      30, 220, 60, 255, 30, 220, 100, 255, 20, 230, 50, 255, 77, 77, 77, 77,
    ]);
  });
});
