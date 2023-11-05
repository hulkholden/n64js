import { makeEnum } from "../enum.js";

export var Comamnds = makeEnum({
  Nop: 0,
  FillTriangle: 0x08,
  FillZBufferTriangle: 0x09,
  TextureTriangle: 0x0a,
  TextureZBufferTriangle: 0x0b,
  ShadeTriangle: 0x0c,
  ShadeZBufferTriangle: 0x0d,
  ShadeTextureTriangle: 0x0e,
  ShadeTextureZBufferTriangle: 0x0f,
  TextureRectangle: 0x24,
  TextureRectangleFlip: 0x25,
  SyncLoad: 0x26,
  SyncPipe: 0x27,
  SyncTile: 0x28,
  SyncFull: 0x29,
  SetKeyGB: 0x2a,
  SetKeyR: 0x2b,
  SetConvert: 0x2c,
  SetScissor: 0x2d,
  SetPrimDepth: 0x2e,
  SetOtherModes: 0x2f,
  LoadTLut: 0x30,
  SetTileSize: 0x32,
  LoadBlock: 0x33,
  LoadTile: 0x34,
  SetTile: 0x35,
  FillRectangle: 0x36,
  SetFillColor: 0x37,
  SetFogColor: 0x38,
  SetBlendColor: 0x39,
  SetPrimColor: 0x3a,
  SetEnvColor: 0x3b,
  SetCombine: 0x3c,
  SetTextureImage: 0x3d,
  SetMaskImage: 0x3e,
  SetColorImage: 0x3f,
});


export const CommandLengths = [
  1, 1, 1, 1, 1, 1, 1, 1, 4, 6, 12, 14, 12, 14, 20, 22,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
];

// X is represented in 12.16 format (28 bits).
const X_FRAC_BITS = 16;
const X_SUBPIXELS = 1 << X_FRAC_BITS;

// Y is represented in 12.2 format (14 bits).
const Y_FRAC_BITS = 2;
const Y_SUBPIXELS = 1 << Y_FRAC_BITS;

const RGBA_PRECISION_BITS = 16;

const UV_PRECISION_BITS = 16;

class IVec4 {
  constructor(displayPrecisionBits) {
    this.displayPrecisionBits = displayPrecisionBits;
    this.elems = [0, 0, 0, 0];
  }

  loadHiLo(data, offset) {
    this.elems[0] = makeHi(data, offset, 0, 4);
    this.elems[1] = makeLo(data, offset, 0, 4);
    this.elems[2] = makeHi(data, offset, 1, 5);
    this.elems[3] = makeLo(data, offset, 1, 5);
  }

  toString() {
    const scale = 1 / (1 << this.displayPrecisionBits);
    return `[${this.elems[0] * scale}, ${this.elems[1] * scale}, ${this.elems[2] * scale}, ${this.elems[3] * scale}]`;
  }
}

function makeHi(commands, offset, a, b) {
  return (commands[offset + a] & 0xffff0000) | ((commands[offset + b] >>> 16) & 0xffff);
}

function makeLo(commands, offset, a, b) {
  return (commands[offset + a] << 16) | (commands[offset + b] & 0xffff);
}


export class Triangle {
  constructor() {
    this.type = 0;
    this.tile = 0;

    this.flip = false;

    this.shade = false;
    this.texture = false;
    this.zbuffer = false;

    // Edge coefficients.
    // s12.2
    this.yh = 0;
    this.ym = 0;
    this.yl = 0;

    // s12.16
    this.xh = 0;
    this.xm = 0;
    this.xl = 0;

    // s12.16
    this.dxhdy = 0;
    this.dxmdy = 0;
    this.dxldy = 0;

    // Shade coefficients.
    this.rgba = new IVec4(RGBA_PRECISION_BITS);
    this.drgba_dx = new IVec4(RGBA_PRECISION_BITS);
    this.drgba_de = new IVec4(RGBA_PRECISION_BITS);
    this.drgba_dy = new IVec4(RGBA_PRECISION_BITS);

    // Texture coefficients (+5 bits as texture coords have 5 bits precision too).
    this.stw = new IVec4(UV_PRECISION_BITS + 5);
    this.dstw_dx = new IVec4(UV_PRECISION_BITS + 5);
    this.dstw_de = new IVec4(UV_PRECISION_BITS + 5);
    this.dstw_dy = new IVec4(UV_PRECISION_BITS + 5);
  }

  load(data, offset) {
    const cmdType = (data[0] >> 24) & 63;

    this.type = cmdType;
    this.shade = (cmdType & 4) != 0;
    this.texture = (cmdType & 2) != 0;
    this.zbuffer = (cmdType & 1) != 0;
    
    this.loadEdge(data, offset);
    offset += 8;
  
    if (this.shade) {
      this.loadShade(data, offset);
      offset += 16;
    }
    if (this.texture) {
      this.loadTexture(data, offset);
      offset += 16;
    }
  }

  loadEdge(data, offset) {
    this.tile = (data[offset + 0] >> 16) & 7;

    // Whether the triangle is left (0) or right (1) major.
    this.flip = (data[offset + 0] & 0x80_0000) != 0;

    // signed 14 bit.
    this.yl = signExtend14(data[offset + 0] >> 0);
    this.ym = signExtend14(data[offset + 1] >> 16);
    this.yh = signExtend14(data[offset + 1] >> 0);

    // signed 28 bit 
    this.xl = signExtend28(data[offset + 2]);
    this.xh = signExtend28(data[offset + 4]);
    this.xm = signExtend28(data[offset + 6]);

    // signed 28 bit 
    this.dxldy = signExtend28(data[offset + 3]);
    this.dxhdy = signExtend28(data[offset + 5]);
    this.dxmdy = signExtend28(data[offset + 7]);
  }

  loadShade(data, offset) {
    this.rgba.loadHiLo(data, offset + 0);
    this.drgba_dx.loadHiLo(data, offset + 2);
    this.drgba_de.loadHiLo(data, offset + 8);
    this.drgba_dy.loadHiLo(data, offset + 10);
  }

  loadTexture(data, offset) {
    this.stw.loadHiLo(data, offset + 0);
    this.dstw_dx.loadHiLo(data, offset + 2);
    this.dstw_de.loadHiLo(data, offset + 8);
    this.dstw_dy.loadHiLo(data, offset + 10);
  }

  interpolateX(y) {
    let yhBase = this.yh & ~(Y_SUBPIXELS - 1);
    let ymBase = this.ym;

    let x1 = this.xh + (y - yhBase) * this.dxhdy;
    let x0;
    if (y < this.ym) {
      x0 = this.xm + (y - yhBase) * this.dxmdy;
    } else {
      x0 = this.xl + (y - ymBase) * this.dxldy;
    }

    const xleft = this.flip ? x1 : x0;
    const xright = this.flip ? x0 : x1;
    return [xleft >> X_FRAC_BITS, xright >> X_FRAC_BITS];
  }

  interpolate(x, y, base, dpde, dpdx) {
    const yhBase = this.yh & ~(Y_SUBPIXELS - 1);
    const dy = (y - yhBase) / Y_SUBPIXELS;

    const xh = this.xh + (dy * this.dxhdy);
    const xBase = xh >> X_FRAC_BITS;
    const dx = x - xBase;

    const out = new IVec4(base.precisionBits);
    for (let i = 0; i < 4; i++) {
      out.elems[i] = base.elems[i] + (dpde.elems[i] * dy) + ((dpdx.elems[i] & ~0x1f) * dx);
    }
    return out;
  }

  interpolateShade(x, y) {
    return this.interpolate(x, y, this.rgba, this.drgba_de, this.drgba_dx);
  }

  interpolateTexture(x, y) {
    const stw = this.interpolate(x, y, this.stw, this.dstw_de, this.dstw_dx);

    // TODO: Perspective divide
    // const w = stw.elems[2] / (1 << UV_PRECISION_BITS);
    // stw.elems[0] = stw.elems[0] / w;
    // stw.elems[1] = stw.elems[1] / w;
    return stw;
  }

  calculateRectUVs() {
    const y0 = this.yh;
    const y1 = this.ym;

    const yhSpan = this.interpolateX(this.yh);
    const ymSpan = this.interpolateX(this.ym);
    const x0 = Math.min(yhSpan[0], ymSpan[0]);
    const x1 = Math.max(yhSpan[1], ymSpan[1]);
  
    const uv00 = this.interpolateTexture(x0, y0);
    const uv10 = this.interpolateTexture(x1, y0);
    const uv01 = this.interpolateTexture(x0, y1);
    const uv11 = this.interpolateTexture(x1, y1);
    const uvScale = 1 / (1 << 16) / 32;
    // s0,t0 -> s1,t0 -> s0,t1 -> s1,t1
    return [
      uv00.elems[0] * uvScale, uv00.elems[1] * uvScale,
      uv10.elems[0] * uvScale, uv10.elems[1] * uvScale,
      uv01.elems[0] * uvScale, uv01.elems[1] * uvScale,
      uv11.elems[0] * uvScale, uv11.elems[1] * uvScale,
    ]; 
  }

  toString() {
    const xscale = 1 / X_SUBPIXELS;
    const yscale = 1 / Y_SUBPIXELS;

    let t = `${Comamnds.nameOf(this.type)}`;
    t += `\nEdge:
  tile ${this.tile}
  yl ${this.yl * yscale}, ym ${this.ym * yscale}, yh ${this.yh * yscale}
  xl ${this.xl * xscale}, xm ${this.xm * xscale}, xh ${this.xh * xscale}
  dxldy ${this.dxldy * xscale}, dxmdy ${this.dxmdy * xscale}, dxhdy ${this.dxhdy * xscale}
`;
    if (this.shade) {
      t += `\nShade:
  rgba ${this.rgba.toString()}
  drgba_dx ${this.drgba_dx.toString()}
  drgba_de ${this.drgba_de.toString()}
  drgba_dy ${this.drgba_dy.toString()}
`;
    }

    if (this.texture) {
      t += `Texture:
  stw ${this.stw.toString()}
  dstw_dx ${this.dstw_dx.toString()}
  dstw_de ${this.dstw_de.toString()}
  dstw_dy ${this.dstw_dy.toString()}
`;
    }
    return t;
  }
}

function signExtend14(x) {
  return (x << 18) >> 18;
}

function signExtend28(x) {
  return (x << 4) >> 4;
}
