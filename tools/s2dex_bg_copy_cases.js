import * as gbi from '../src/hle/gbi.js';

const F = gbi.ImageFormat, S = gbi.ImageSize;
const colors16 = [0xf801, 0x07c1, 0x003f, 0xffff];
const colors = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 255, 255]];

// Shared synthetic inputs for CPU TMEM decode and real WebGL readback. Expected
// pixels come directly from the source image, independently of strip planning.
export function bgCopyCase({
  format = F.G_IM_FMT_RGBA, size = S.G_IM_SIZ_16b, load = 0xfff4,
  imageW = 128, imageH = 80, imageX = 121, imageY = 65,
  frameX = -3, frameY = -2, frameW = 120, frameH = 70, flip = false,
  scissor = { x0: 2, y0: 1, x1: 114, y1: 65 }, palette = 3,
} = {}) {
  const ram = new Uint8Array(0x80000);
  const dv = new DataView(ram.buffer);
  const descriptor = 0x100, image = 0x1000;
  const fields = [imageX * 32, imageW * 4, frameX * 4, frameW * 4,
    imageY * 32, imageH * 4, frameY * 4, frameH * 4];
  fields.forEach((value, i) => dv.setUint16(descriptor + i * 2, value));
  // Both addresses require segment translation; segment 1 starts at 0x80.
  dv.setUint32(descriptor + 16, 0x01000000 + image - 0x80);
  dv.setUint16(descriptor + 20, load);
  dv.setUint8(descriptor + 22, format);
  dv.setUint8(descriptor + 23, size);
  dv.setUint16(descriptor + 24, palette);
  dv.setUint16(descriptor + 26, flip ? 1 : 0);
  const words = Math.floor((load === 0x0033 ? imageW : frameW) * (4 << size) / 64) + (load === 0x0033 ? 0 : 1);
  const rows = Math.floor((format === F.G_IM_FMT_CI ? 256 : 512) / words);
  [words, rows * 4, load === 0x0033 ? words * rows * 4 - 1 : words * 16 - 1,
    load === 0x0033 ? Math.ceil(2048 / words) : rows * 4 - 1,
    imageW * (4 << size) / 32, words * rows * 8].forEach((v, i) => dv.setUint16(descriptor + 28 + i * 2, v));

  function sourcePixel(x, y) {
    const i = ((x % 7) + (y % 5)) & 3;
    if (format === F.G_IM_FMT_RGBA || format === F.G_IM_FMT_CI) {
      return colors[i];
    }
    const v = [0, 85, 170, 255][i];
    if (format === F.G_IM_FMT_I) {
      return [v, v, v, v];
    }
    if (size === S.G_IM_SIZ_4b) {
      const v = [0, 73, 182, 255][i];
      return [v, v, v, 255];
    }
    return [v, v, v, 255];
  }
  for (let y = 0; y < imageH; y++) {
    for (let x = 0; x < imageW; x++) {
      const i = ((x % 7) + (y % 5)) & 3;
      const p = y * imageW + x;
      if (format === F.G_IM_FMT_RGBA) {
        if (size === S.G_IM_SIZ_32b) {
          ram.set(colors[i], image + p * 4);
        } else {
          dv.setUint16(image + p * 2, colors16[i]);
        }
      } else if (format === F.G_IM_FMT_CI) {
        if (size === S.G_IM_SIZ_4b) {
          ram[image + (p >>> 1)] |= i << ((p & 1) ? 0 : 4);
        } else {
          ram[image + p] = i;
        }
      } else if (size === S.G_IM_SIZ_4b) {
        const v = format === F.G_IM_FMT_I ? i * 5 : ([0, 2, 5, 7][i] << 1) | 1;
        ram[image + (p >>> 1)] |= v << ((p & 1) ? 0 : 4);
      } else if (size === S.G_IM_SIZ_8b) {
        ram[image + p] = format === F.G_IM_FMT_I ? i * 85 : (i * 5 << 4) | 15;
      } else {
        dv.setUint16(image + p * 2, (i * 85 << 8) | 255);
      }
    }
  }
  return {
    ram, dv, descriptor, image, scissor, format, size, load, sourcePixel,
    init(state) {
      state.reset(dv, 0);
      state.segments[1] = 0x80;
      Object.assign(state.scissor, scissor);
      state.rdpOtherModeH = gbi.CycleType.G_CYC_COPY | (format === F.G_IM_FMT_CI ? gbi.TextureLUT.G_TT_RGBA16 : 0);
      state.rdpOtherModeL = 0;
      state.tmem.tmemData.fill(0xa5);
      if (format === F.G_IM_FMT_CI) {
        const first = size === S.G_IM_SIZ_4b ? palette * 16 : 0;
        for (let i = 0; i < 4; i++) {
          for (let bank = 0; bank < 4; bank++) {
            const offset = 0x800 + (first + i) * 8 + bank * 2;
            state.tmem.tmemData.set([colors16[i] >>> 8, colors16[i] & 255], offset);
          }
        }
      }
    },
    expected(x, y) {
      if (!imageW || !imageH) {
        return [0, 0, 0, 0];
      }
      const fx = Math.floor(frameX), fy = Math.floor(frameY);
      const fw = Math.floor(frameW), fh = Math.floor(frameH);
      if (x < Math.max(fx, scissor.x0) || x >= Math.min(fx + fw, scissor.x1) ||
          y < Math.max(fy, scissor.y0) || y >= Math.min(fy + fh, scissor.y1)) {
        return [0, 0, 0, 0];
      }
      const s = Math.floor(imageX) + (flip ? fw - 1 - (x - fx) : x - fx);
      const t = Math.floor(imageY) + y - fy;
      const p = ((t * imageW + s) % (imageW * imageH) + imageW * imageH) % (imageW * imageH);
      return sourcePixel(p % imageW, Math.floor(p / imageW));
    },
  };
}

export const bgCopyFormats = [
  ['RGBA16', F.G_IM_FMT_RGBA, S.G_IM_SIZ_16b],
  ['RGBA32', F.G_IM_FMT_RGBA, S.G_IM_SIZ_32b],
  ['CI4', F.G_IM_FMT_CI, S.G_IM_SIZ_4b],
  ['CI8', F.G_IM_FMT_CI, S.G_IM_SIZ_8b],
  ['I4', F.G_IM_FMT_I, S.G_IM_SIZ_4b],
  ['I8', F.G_IM_FMT_I, S.G_IM_SIZ_8b],
  ['IA4', F.G_IM_FMT_IA, S.G_IM_SIZ_4b],
  ['IA8', F.G_IM_FMT_IA, S.G_IM_SIZ_8b],
  ['IA16', F.G_IM_FMT_IA, S.G_IM_SIZ_16b],
];
