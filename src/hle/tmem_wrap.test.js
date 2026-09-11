import { describe, expect, test } from 'bun:test';
import * as gbi from './gbi.js';
import { TMEM } from './tmem.js';

describe('TMEM hash wrapping', () => {
  const formats = [
    ['RGBA16', gbi.ImageFormat.G_IM_FMT_RGBA, gbi.ImageSize.G_IM_SIZ_16b, 4096],
    ['RGBA32', gbi.ImageFormat.G_IM_FMT_RGBA, gbi.ImageSize.G_IM_SIZ_32b, 4096],
    ['IA8', gbi.ImageFormat.G_IM_FMT_IA, gbi.ImageSize.G_IM_SIZ_8b, 4096],
    ['CI4', gbi.ImageFormat.G_IM_FMT_CI, gbi.ImageSize.G_IM_SIZ_4b, 2048],
    ['CI8', gbi.ImageFormat.G_IM_FMT_CI, gbi.ImageSize.G_IM_SIZ_8b, 2048],
    ['RGBA4 (CI4 alias)', gbi.ImageFormat.G_IM_FMT_RGBA, gbi.ImageSize.G_IM_SIZ_4b, 2048],
    ['RGBA8 (CI8 alias)', gbi.ImageFormat.G_IM_FMT_RGBA, gbi.ImageSize.G_IM_SIZ_8b, 2048],
  ];

  for (const [name, format, size, boundary] of formats) {
    test(`${name} hashes wrapped texels and detects changes to them`, () => {
      const tmem = new TMEM();
      tmem.tmemData.set(Uint8Array.from({ length: 4096 }, (_, i) => (i * 37 + (i >>> 8) * 13) & 0xff));
      const reference = new TMEM();
      reference.tmemData.set(tmem.tmemData);
      reference.tmemData.set(tmem.tmemData.subarray(boundary - 16, boundary), 0);
      reference.tmemData.set(tmem.tmemData.subarray(0, 48), 16);
      const tile = { format, size, tmem: (boundary - 16) / 8,
        line: 2, height: 2, palette: 0, hash: 0 };

      const before = tmem.calculateCRC(tile);
      expect(before).toBe(reference.calculateCRC({ ...tile, tmem: 0, hash: 0 }));

      tmem.tmemData[0] ^= 1;
      // TMEM loads invalidate the per-tile hash before the renderer looks it up.
      tile.hash = 0;
      expect(tmem.calculateCRC(tile)).not.toBe(before);
    });
  }
});
