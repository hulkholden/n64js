import { decodeTile } from './debug_texture.js';
import { describe, expect, test } from 'bun:test';
import * as gbi from './gbi.js';
import { TMEM } from './tmem.js';

describe('TMEM reference decoding across bank boundaries', () => {
  const formats = [
    ['YUV16', gbi.ImageFormat.G_IM_FMT_YUV, gbi.ImageSize.G_IM_SIZ_16b, 2048],
    ['RGBA16', gbi.ImageFormat.G_IM_FMT_RGBA, gbi.ImageSize.G_IM_SIZ_16b, 4096],
    ['RGBA32', gbi.ImageFormat.G_IM_FMT_RGBA, gbi.ImageSize.G_IM_SIZ_32b, 2048],
    ['IA8', gbi.ImageFormat.G_IM_FMT_IA, gbi.ImageSize.G_IM_SIZ_8b, 4096],
    ['CI4', gbi.ImageFormat.G_IM_FMT_CI, gbi.ImageSize.G_IM_SIZ_4b, 2048],
    ['CI8', gbi.ImageFormat.G_IM_FMT_CI, gbi.ImageSize.G_IM_SIZ_8b, 2048],
    ['RGBA4 without TLUT', gbi.ImageFormat.G_IM_FMT_RGBA, gbi.ImageSize.G_IM_SIZ_4b, 4096],
    ['RGBA8 without TLUT', gbi.ImageFormat.G_IM_FMT_RGBA, gbi.ImageSize.G_IM_SIZ_8b, 4096],
    ['RGBA4 with TLUT', gbi.ImageFormat.G_IM_FMT_RGBA, gbi.ImageSize.G_IM_SIZ_4b, 2048, gbi.TextureLUT.G_TT_RGBA16],
    ['RGBA8 with TLUT', gbi.ImageFormat.G_IM_FMT_RGBA, gbi.ImageSize.G_IM_SIZ_8b, 2048, gbi.TextureLUT.G_TT_RGBA16],
  ];

  for (const [name, format, size, boundary, tlut = gbi.TextureLUT.G_TT_NONE] of formats) {
    test(`${name} decodes wrapped texels and hashes changes to physical memory`, () => {
      const tmem = new TMEM();
      tmem.tmemData.set(Uint8Array.from({ length: 4096 }, (_, i) => (i * 37 + (i >>> 8) * 13) & 0xff));
      const reference = new TMEM();
      reference.tmemData.set(tmem.tmemData);
      reference.tmemData.set(tmem.tmemData.subarray(boundary - 16, boundary), 0);
      reference.tmemData.set(tmem.tmemData.subarray(0, 48), 16);
      if (name === 'YUV16' || name === 'RGBA32') {
        reference.tmemData.set(tmem.tmemData.subarray(4096 - 16, 4096), 2048);
        reference.tmemData.set(tmem.tmemData.subarray(2048, 2048 + 48), 2048 + 16);
      }
      const tile = { format, size, tmem: (boundary - 16) / 8,
        line: 2, width: size < 2 ? 32 >> size : name === 'YUV16' ? 16 : 8, height: 2, palette: 0 };

      const before = tmem.hashContents();
      const referenceTile = { ...tile, tmem: 0 };
      expect(decodeTile(tmem, tile, tlut).pixels).toEqual(decodeTile(reference, referenceTile, tlut).pixels);

      tmem.tmemData[0] ^= 1;
      expect(tmem.hashContents()).not.toBe(before);
    });
  }
});
