import * as gbi from '../src/hle/gbi.js';
import { bgCopyCase, bgCopyFormats } from './s2dex_bg_copy_cases.js';

export function bg1cycCase(options = {}) {
  const config = {
    imageW: 128, imageH: 80, imageX: 121.25, imageY: 65,
    frameX: -3.25, frameY: -2, frameW: 120, frameH: 70,
    scaleW: 0.5, scaleH: 0.5, imageYorig: 65,
    filter: gbi.TextureFilter.G_TF_POINT, flip: false,
    scissor: { x0: 2, y0: 1, x1: 114, y1: 65 }, ...options,
  };
  const fixture = bgCopyCase(config);
  const { dv, descriptor, sourcePixel } = fixture;
  if (options.descriptorImageW) {
    dv.setUint16(descriptor + 2, options.descriptorImageW * 4);
  }
  dv.setUint16(descriptor + 28, config.scaleW * 1024);
  dv.setUint16(descriptor + 30, config.scaleH * 1024);
  dv.setInt32(descriptor + 32, config.imageYorig * 32);
  function texel(s, t) {
    const address = ((t * config.imageW + s) % (config.imageW * config.imageH) + config.imageW * config.imageH) % (config.imageW * config.imageH);
    return sourcePixel(address % config.imageW, Math.floor(address / config.imageW));
  }
  return {
    ...fixture, config,
    init(state) {
      fixture.init(state);
      state.rdpOtherModeH = config.filter | (fixture.format === gbi.ImageFormat.G_IM_FMT_CI ? gbi.TextureLUT.G_TT_RGBA16 : 0);
      // Modulate texture with the rectangle's white vertex colour.
      state.combine.hi = 0x00121824;
      state.combine.lo = 0xff33ffff;
    },
    expected(x, y) {
      const { imageW, imageH, imageX, imageY, frameX, frameY, frameW, frameH, scaleW, scaleH, scissor, flip, filter } = config;
      if (!imageW || !imageH || !scaleW || !scaleH) {
        return [0, 0, 0, 0];
      }
      const width = Math.min(frameW, Math.floor((config.descriptorImageW ?? imageW) / scaleW - 0.25));
      const height = Math.min(frameH, Math.floor(imageH / scaleH - 0.25));
      const left = frameX + (flip ? frameW - width : 0);
      if (x < Math.max(left, scissor.x0) || x >= Math.min(left + width, scissor.x1) ||
          y < Math.max(frameY, scissor.y0) || y >= Math.min(frameY + height, scissor.y1)) {
        return [0, 0, 0, 0];
      }
      // These cases use scales aligned with their strip heights, so direct
      // source sampling is an independent oracle for the transferred tiles.
      const s = imageX + (flip ? (frameX + frameW - x) * scaleW - 1 : (x - frameX) * scaleW);
      const t = imageY + (y - frameY) * scaleH;
      const u = Math.floor(s), v = Math.floor(t);
      if (filter === gbi.TextureFilter.G_TF_POINT) {
        return texel(u, v);
      }
      const a = Math.floor((s - u) * 32) / 32, b = Math.floor((t - v) * 32) / 32;
      const c00 = texel(u, v), c10 = texel(u + 1, v), c01 = texel(u, v + 1), c11 = texel(u + 1, v + 1);
      return c00.map((c, i) => Math.floor((a + b < 1
        ? c + (c10[i] - c) * a + (c01[i] - c) * b
        : c11[i] + (c01[i] - c11[i]) * (1 - a) + (c10[i] - c11[i]) * (1 - b)) + 0.5));
    },
  };
}

export const bg1cycCases = [];
for (const [name, format, size] of bgCopyFormats) {
  for (const filter of [gbi.TextureFilter.G_TF_POINT, gbi.TextureFilter.G_TF_BILERP]) {
    for (const flip of [false, true]) {
      bg1cycCases.push([`${name}, filter=${filter}, flip=${flip}`, { format, size, filter, flip }]);
    }
  }
}
for (const [name, options] of [
  ['reduction', { imageW: 120, scaleW: 2, scaleH: 2, imageY: 64, imageYorig: 64 }],
  ['reduction flipped', { imageW: 120, scaleW: 2, scaleH: 2, imageY: 64, imageYorig: 64, flip: true }],
  ['1:1', { scaleW: 1, scaleH: 1 }],
  ['wide image', { imageW: 1024, frameW: 590, imageX: 900, scaleW: 2, scissor: { x0: 0, y0: 0, x1: 590, y1: 65 } }],
  ['Photopie CI8 row stride', { format: gbi.ImageFormat.G_IM_FMT_CI, size: gbi.ImageSize.G_IM_SIZ_8b, imageW: 256, descriptorImageW: 257, imageH: 28, frameW: 256, frameH: 27, frameX: 0, frameY: 0, imageX: 0, imageY: 0, imageYorig: 0, scaleW: 1, scaleH: 1, scissor: { x0: 0, y0: 0, x1: 256, y1: 27 } }],
  ['tiny image enlarged', { imageW: 4, imageH: 1, imageX: 0, imageY: 0, imageYorig: 0, frameX: 0, frameY: 0, scaleW: 1 / 256, scaleH: 1 / 512 }],
]) {
  bg1cycCases.push([name, options]);
}
