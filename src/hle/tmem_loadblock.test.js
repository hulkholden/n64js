import { afterEach, expect, test } from 'bun:test';
import { RSPState } from './rsp_state.js';
import { GBIMicrocode } from './gbi_microcode.js';
import { ImageFormat, ImageSize } from './gbi.js';

const savedN64js = globalThis.n64js;
afterEach(() => { globalThis.n64js = savedN64js; });

test('LoadBlock uses integer S/T offsets and an inclusive texel count', () => {
  const ram = new Uint8Array(8192);
  const dv = new DataView(ram.buffer);
  globalThis.n64js = { hardware: () => ({ cachedMemDevice: { s32: new Int32Array(ram.buffer), u8: ram } }) };
  const state = new RSPState();
  state.reset(dv, 0);
  state.textureImage.set(ImageFormat.G_IM_FMT_YUV, ImageSize.G_IM_SIZ_16b, 1024, 0);
  state.tiles[7].size = ImageSize.G_IM_SIZ_16b;
  // A later 16x16 macroblock in the Vigilante 8 intro: S=256, T=1.
  ram.set([1, 2, 3, 4, 5, 6, 7, 8], 2560);
  ram.set([9, 10, 11, 12, 13, 14, 15, 16], 2592);
  const microcode = new GBIMicrocode(state, dv);
  microcode.executeLoadBlock(0xf3100001, 0x071ff200);
  expect(Array.from(state.tmem.tmemData.slice(0, 8))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  expect(Array.from(state.tmem.tmemData.slice(32, 40))).toEqual([13, 14, 15, 16, 9, 10, 11, 12]);
  expect(state.tmem.tmemData[512]).toBe(0);
});
