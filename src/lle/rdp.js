import { makeEnum } from "../enum.js";

export var Commands = makeEnum({
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

export class RDPBuffer {
  constructor(dv, curAddr, endAddr, addrMask) {
    addrMask = addrMask || 0xffff_ffff;

    this.dv = dv;
    this.curAddr = curAddr;
    this.endAddr = endAddr;
    this.addrMask = addrMask;
  }

  clone() {
    return new RDPBuffer(this.dv, this.curAddr, this.endAddr, this.addrMask);
  }

  getU32(offset) {
    return this.dv.getUint32((this.curAddr + offset) & this.addrMask, false);
  }

  getU64(offset) {
    return this.dv.getBigUint64((this.curAddr + offset) & this.addrMask, false);
  }

  advance(offset) {
    this.curAddr += offset;
  }

  bytesRemaining() {
    // FIXME: this needs to handle wrapping around DMEM.
    return this.endAddr - this.curAddr;
  }

  empty() {
    // FIXME: this needs to handle wrapping around DMEM.
    return this.curAddr >= this.endAddr;
  }
}

class IVec4 {
  constructor(displayPrecisionBits) {
    this.displayPrecisionBits = displayPrecisionBits;
    this.elems = [0, 0, 0, 0];
  }

  loadHiLo(dv, offset) {
    this.elems[0] = makeHi(dv, offset + 0, offset + 16);
    this.elems[1] = makeLo(dv, offset + 0, offset + 16);
    this.elems[2] = makeHi(dv, offset + 4, offset + 20);
    this.elems[3] = makeLo(dv, offset + 4, offset + 20);
  }

  toString() {
    const scale = 1 / (1 << this.displayPrecisionBits);
    return `[${this.elems[0] * scale}, ${this.elems[1] * scale}, ${this.elems[2] * scale}, ${this.elems[3] * scale}]`;
  }
}

function makeHi(buf, a, b) {
  return (buf.getU32(a) & 0xffff0000) | ((buf.getU32(b) >>> 16) & 0xffff);
}

function makeLo(buf, a, b) {
  return (buf.getU32(a) << 16) | (buf.getU32(b) & 0xffff);
}

export class Triangle {
  constructor() {
    this.type = 0;
    this.tile = 0;

    this.rightMajor = false;

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

  load(buf) {
    const cmdType = (buf.getU32(0) >> 24) & 63;

    this.type = cmdType;
    this.shade = (cmdType & 4) != 0;
    this.texture = (cmdType & 2) != 0;
    this.zbuffer = (cmdType & 1) != 0;

    this.loadEdge(buf);
    buf.advance(32);

    if (this.shade) {
      this.loadShade(buf);
      buf.advance(64);
    }
    if (this.texture) {
      this.loadTexture(buf);
      buf.advance(64);
    }
  }

  loadEdge(buf) {
    this.tile = (buf.getU32(0) >> 16) & 7;

    // Whether the triangle is left (0) or right (1) major.
    this.rightMajor = (buf.getU32(0) & 0x80_0000) != 0;

    // signed 14 bit.
    this.yl = signExtend14(buf.getU32(0) >> 0);
    this.ym = signExtend14(buf.getU32(4) >> 16);
    this.yh = signExtend14(buf.getU32(4) >> 0);

    // signed 28 bit 
    this.xl = signExtend28(buf.getU32(8));
    this.xh = signExtend28(buf.getU32(16));
    this.xm = signExtend28(buf.getU32(24));

    // signed 28 bit 
    this.dxldy = signExtend28(buf.getU32(12));
    this.dxhdy = signExtend28(buf.getU32(20));
    this.dxmdy = signExtend28(buf.getU32(28));
  }

  loadShade(buf) {
    this.rgba.loadHiLo(buf, 0);
    this.drgba_dx.loadHiLo(buf, 8);
    this.drgba_de.loadHiLo(buf, 32);
    this.drgba_dy.loadHiLo(buf, 40);
  }

  loadTexture(buf) {
    this.stw.loadHiLo(buf, 0);
    this.dstw_dx.loadHiLo(buf, 8);
    this.dstw_de.loadHiLo(buf, 32);
    this.dstw_dy.loadHiLo(buf, 40);
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

    const xleft = this.rightMajor ? x1 : x0;
    const xright = this.rightMajor ? x0 : x1;
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

    let t = '';
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

export class RDP {
  constructor(hardware) {
    this.hardware = hardware;
    this.commandTable = this.makeCommandTable();
  }

  makeCommandTable() {
    let tbl = [];
    for (let i = 0; i < 64; i++) {
      tbl.push(this.executeUnknown.bind(this));
    }

    tbl[Commands.Nop] = this.executeNop.bind(this);
    tbl[Commands.FillTriangle] = this.executeTriangle.bind(this);
    tbl[Commands.FillZBufferTriangle] = this.executeTriangle.bind(this);
    tbl[Commands.TextureTriangle] = this.executeTriangle.bind(this);
    tbl[Commands.TextureZBufferTriangle] = this.executeTriangle.bind(this);
    tbl[Commands.ShadeTriangle] = this.executeTriangle.bind(this);
    tbl[Commands.ShadeZBufferTriangle] = this.executeTriangle.bind(this);
    tbl[Commands.ShadeTextureTriangle] = this.executeTriangle.bind(this);
    tbl[Commands.ShadeTextureZBufferTriangle] = this.executeTriangle.bind(this);
    tbl[Commands.TextureRectangle] = this.executeUnhandled.bind(this);
    tbl[Commands.TextureRectangleFlip] = this.executeUnhandled.bind(this);
    tbl[Commands.SyncLoad] = this.executeSyncLoad.bind(this);
    tbl[Commands.SyncPipe] = this.executeSyncPipe.bind(this);
    tbl[Commands.SyncTile] = this.executeSyncTile.bind(this);
    tbl[Commands.SyncFull] = this.executeSyncFull.bind(this);
    tbl[Commands.SetKeyGB] = this.executeSetKeyGB.bind(this);
    tbl[Commands.SetKeyR] = this.executeSetKeyR.bind(this);
    tbl[Commands.SetConvert] = this.executeSetConvert.bind(this);
    tbl[Commands.SetScissor] = this.executeSetScissor.bind(this);
    tbl[Commands.SetPrimDepth] = this.executeSetPrimDepth.bind(this);
    tbl[Commands.SetOtherModes] = this.executeSetOtherModes.bind(this);
    tbl[Commands.LoadTLut] = this.executeLoadTLut.bind(this);
    tbl[Commands.SetTileSize] = this.executeSetTileSize.bind(this);
    tbl[Commands.LoadBlock] = this.executeLoadBlock.bind(this);
    tbl[Commands.LoadTile] = this.executeLoadTile.bind(this);
    tbl[Commands.SetTile] = this.executeSetTile.bind(this);
    tbl[Commands.FillRectangle] = this.executeFillRectangle.bind(this);
    tbl[Commands.SetFillColor] = this.executeSetFillColor.bind(this);
    tbl[Commands.SetFogColor] = this.executeSetFogColor.bind(this);
    tbl[Commands.SetBlendColor] = this.executeSetBlendColor.bind(this);
    tbl[Commands.SetPrimColor] = this.executeSetPrimColor.bind(this);
    tbl[Commands.SetEnvColor] = this.executeSetEnvColor.bind(this);
    tbl[Commands.SetCombine] = this.executeSetCombine.bind(this);
    tbl[Commands.SetTextureImage] = this.executeSetTextureImage.bind(this);
    tbl[Commands.SetMaskImage] = this.executeSetMaskImage.bind(this);
    tbl[Commands.SetColorImage] = this.executeSetColorImage.bind(this);

    return tbl;
  }

  run(buf) {
    while (!buf.empty()) {
      const cmd = buf.getU32(0);
      const cmdType = (cmd >> 24) & 63;
      const cmdLen = CommandLengths[cmdType] * 8;
      const nextAddr = buf.curAddr + cmdLen;
      this.commandTable[cmdType](cmdType, buf);
      buf.curAddr = nextAddr;
    }
  }

  executeNop(cmdType, buf) {
  }

  executeUnknown(cmdType, buf) {
    console.log(`Unknown RDP command: ${Commands.nameOf(cmdType)}`);
  }

  executeUnhandled(cmdType, buf) {
    console.log(`Unhandled RDP command: ${Commands.nameOf(cmdType)}`);
  }

  executeTriangle(cmdType, buf) {
    this.executeUnhandled(cmdType, buf);
  }

  executeSyncLoad(cmdType, buf) {
    this.executeUnhandled(cmdType, buf);
  }

  executeSyncPipe(cmdType, buf) {
    this.executeUnhandled(cmdType, buf);
  }

  executeSyncTile(cmdType, buf) {
    this.executeUnhandled(cmdType, buf);
  }

  executeSyncFull(cmdType, buf) {
    this.hardware.dpcDevice.syncFull();
  }

  executeSetKeyGB(cmdType, buf) {
    this.executeUnhandled(cmdType, buf);
  }

  executeSetKeyR(cmdType, buf) {
    this.executeUnhandled(cmdType, buf);
  }

  executeSetConvert(cmdType, buf) {
    this.executeUnhandled(cmdType, buf);
  }

  executeSetScissor(cmdType, buf) {
    this.executeUnhandled(cmdType, buf);
  }

  executeSetPrimDepth(cmdType, buf) {
    this.executeUnhandled(cmdType, buf);
  }

  executeSetOtherModes(cmdType, buf) {
    this.executeUnhandled(cmdType, buf);
  }

  executeLoadTLut(cmdType, buf) {
    this.executeUnhandled(cmdType, buf);
  }

  executeSetTileSize(cmdType, buf) {
    this.executeUnhandled(cmdType, buf);
  }

  executeLoadBlock(cmdType, buf) {
    this.executeUnhandled(cmdType, buf);
  }

  executeLoadTile(cmdType, buf) {
    this.executeUnhandled(cmdType, buf);
  }

  executeSetTile(cmdType, buf) {
    this.executeUnhandled(cmdType, buf);
  }

  executeFillRectangle(cmdType, buf) {
    this.executeUnhandled(cmdType, buf);
  }

  executeSetFillColor(cmdType, buf) {
    this.executeUnhandled(cmdType, buf);
  }

  executeSetFogColor(cmdType, buf) {
    this.executeUnhandled(cmdType, buf);
  }

  executeSetBlendColor(cmdType, buf) {
    this.executeUnhandled(cmdType, buf);
  }

  executeSetPrimColor(cmdType, buf) {
    this.executeUnhandled(cmdType, buf);
  }

  executeSetEnvColor(cmdType, buf) {
    this.executeUnhandled(cmdType, buf);
  }

  executeSetCombine(cmdType, buf) {
    this.executeUnhandled(cmdType, buf);
  }

  executeSetTextureImage(cmdType, buf) {
    this.executeUnhandled(cmdType, buf);
  }

  executeSetMaskImage(cmdType, buf) {
    this.executeUnhandled(cmdType, buf);
  }

  executeSetColorImage(cmdType, buf) {
    this.executeUnhandled(cmdType, buf);
  }
}
