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

  test('combines UV/Y banks with an eight-byte line stride and odd-row swizzling', () => {
    const src = new Uint8Array(4096);
    const tile = { format: ImageFormat.G_IM_FMT_YUV, size: ImageSize.G_IM_SIZ_16b,
      tmem: 2, line: 1, width: 3, height: 2 };
    src.set([128, 128, 10, 240], 16);
    src.set([0, 235, 40, 80], 0x810);
    src.set([30, 220, 20, 230], 28); // Odd row at 24, XOR 4.
    src.set([60, 100, 50, 90], 0x81c);
    const dst = new Uint8Array(32).fill(77);
    expect(convertTexels(dst, 4, src, tile, 0)).toBe(true);
    expect(Array.from(dst)).toEqual([
      128, 128, 0, 255, 128, 128, 235, 255, 10, 240, 40, 255, 77, 77, 77, 77,
      30, 220, 60, 255, 30, 220, 100, 255, 20, 230, 50, 255, 77, 77, 77, 77,
    ]);
  });
});
