import { toString16, toString32 } from "../format";
import * as gbi from './gbi.js';
import { GBI1 } from "./gbi1";
import { GBI2 } from "./gbi2";

// Where do these fit in?
// const ucodeSprite2d = {
//   0xbe: executeSprite2dScaleFlip,
//   0xbd: executeSprite2dDraw
// };

const kRenderNone = 0;
const kRenderFullTransform = 1;
const kRenderPartialTransform = 2;
const kRenderNoRotation = 3;

class ObjScaleBg {
  constructor() {
    this.imageX = 0;
    this.imageW = 0;
    this.frameX = 0;
    this.frameW = 0;

    this.imageY = 0;
    this.imageH = 0;
    this.frameY = 0;
    this.frameH = 0;

    this.imagePtr = 0;
    this.imageLoad = 0;
    this.imageFmt = 0;
    this.imageSiz = 0;
    this.imagePal = 0;
    this.imageFlip = 0;

    this.scaleW = 0;
    this.scaleH = 0;
    this.imageYorig = 0;
  }

  load(dv, offset) {
    this.imageX = dv.getUint16(offset + 0, false) / 32;
    this.imageW = dv.getUint16(offset + 2, false) / 4;
    this.frameX = dv.getInt16(offset + 4, false) / 4;
    this.frameW = dv.getUint16(offset + 6, false) / 4;

    this.imageY = dv.getUint16(offset + 8, false) / 32;
    this.imageH = dv.getUint16(offset + 10, false) / 4;
    this.frameY = dv.getInt16(offset + 12, false) / 4;
    this.frameH = dv.getUint16(offset + 14, false) / 4;

    this.imagePtr = dv.getUint32(offset + 16, false);
    this.imageLoad = dv.getUint16(offset + 20, false);
    this.imageFmt = dv.getUint8(offset + 22, false);
    this.imageSiz = dv.getUint8(offset + 23, false);
    this.imagePal = dv.getUint16(offset + 24, false);
    this.imageFlip = dv.getUint16(offset + 26, false);

    this.scaleW = dv.getUint16(offset + 28, false) / 1024;
    this.scaleH = dv.getUint16(offset + 30, false) / 1024;
    this.imageYorig = dv.getInt32(offset + 32, false) / 32;
    // 4 bytes of padding here.
  }

  toString() {
    return `imageX/Y = (${this.imageX}, ${this.imageY}), imageW/H = (${this.imageW}, ${this.imageH})
frameX/Y = (${this.frameX}, ${this.frameY}), frameW/H = (${this.frameW}, ${this.frameH})
imagePtr = ${toString32(this.imagePtr)}, imageLoad = ${this.imageLoad}
imageFmt = ${gbi.ImageFormat.nameOf(this.imageFmt)}, imageSiz = ${gbi.ImageSize.nameOf(this.imageSiz)}
imagePal = ${this.imagePal}, imageFlip = ${this.imageFlip}
scaleW/H = (${this.scaleW}, ${this.scaleH})`
  }
}

class ObjMatrix {
  constructor() {
    this.a = 1;
    this.b = 0;
    this.c = 0;
    this.d = 1;

    this.x = 0;
    this.y = 0;

    this.sx = 1;
    this.sy = 1;
  }

  loadFullMatrix(dv, offset) {
    this.a = dv.getInt32(offset + 0, false) / 65536;
    this.b = dv.getInt32(offset + 4, false) / 65536;
    this.c = dv.getInt32(offset + 8, false) / 65536;
    this.d = dv.getInt32(offset + 12, false) / 65536;
    this.loadSubMatrix(dv, offset + 16);
  }

  loadSubMatrix(dv, offset) {
    this.x = dv.getInt16(offset + 0, false) / 4;
    this.y = dv.getInt16(offset + 2, false) / 4;

    this.sx = dv.getUint16(offset + 4, false) / 1024;
    this.sy = dv.getUint16(offset + 6, false) / 1024;
  }

  toString() {
    return `rot = (${this.a}, ${this.b}, ${this.c}, ${this.d}), trans = (${this.x}, ${this.y}), scale = (${this.sx}, ${this.sy})`;
  }
}

class ObjSprite {
  constructor() {
    this.objX = 0;
    this.scaleW = 0;
    this.imageW = 0;

    this.objY = 0;
    this.scaleH = 0;
    this.imageH = 0;

    this.imageStride = 0;
    this.imageAdrs = 0;
    this.imageFmt = 0;
    this.imageSiz = 0;
    this.imagePal = 0;
    this.imageFlags = 0;
  }

  load(dv, offset) {
    this.objX = dv.getInt16(offset + 0, false) / 4;
    this.scaleW = dv.getUint16(offset + 2, false) / 1024;
    this.imageW = dv.getUint16(offset + 4, false) / 32;
    // 2 bytes of padding
    this.objY = dv.getInt16(offset + 8, false) / 4;
    this.scaleH = dv.getUint16(offset + 10, false) / 1024;
    this.imageH = dv.getUint16(offset + 12, false) / 32;
    // 2 bytes of padding
    this.imageStride = dv.getUint16(offset + 16, false);
    this.imageAdrs = dv.getUint16(offset + 18, false);
    this.imageFmt = dv.getUint8(offset + 20, false);
    this.imageSiz = dv.getUint8(offset + 21, false);
    this.imagePal = dv.getUint8(offset + 22, false);
    this.imageFlags = dv.getUint8(offset + 23, false);
  }

  get objW() { return this.imageW / this.scaleW; }
  get objH() { return this.imageH / this.scaleH; }

  toString() {
    return `pos = (${this.objX}, ${this.objY}), scale = (${this.scaleW}, ${this.scaleH}), image = (${this.imageW}, ${this.imageH})
stride = ${this.imageStride}, address = ${toString16(this.imageAdrs)}, format = ${gbi.ImageFormat.nameOf(this.imageFmt)}, size = ${gbi.ImageSize.nameOf(this.imageSiz)}
paletteIdx = ${this.imagePal}, flags = ${this.imageFlags}`
  }
}

// TODO: move to rdp_constants.js.
export const FillTriangle = 0x08;
export const FillZBufferTriangle = 0x09;
export const TextureTriangle = 0x0a;
export const TextureZBufferTriangle = 0x0b;
export const ShadeTriangle = 0x0c;
export const ShadeZBufferTriangle = 0x0d;
export const ShadeTextureTriangle = 0x0e;
export const ShadeTextureZBufferTriangle = 0x0f;
export const TextureRectangle = 0x24;
export const TextureRectangleFlip = 0x25;
export const SyncLoad = 0x26;
export const SyncPipe = 0x27;
export const SyncTile = 0x28;
export const SyncFull = 0x29;
export const SetKeyGB = 0x2a;
export const SetKeyR = 0x2b;
export const SetConvert = 0x2c;
export const SetScissor = 0x2d;
export const SetPrimDepth = 0x2e;
export const SetOtherModes = 0x2f;
export const LoadTLUT = 0x30;
export const SetTileSize = 0x32;
export const LoadBlock = 0x33;
export const LoadTile = 0x34;
export const SetTile = 0x35;
export const FillRectangle = 0x36;
export const SetFillColor = 0x37;
export const SetFogColor = 0x38;
export const SetBlendColor = 0x39;
export const SetPrimColor = 0x3a;
export const SetEnvColor = 0x3b;
export const SetCombine = 0x3c;
export const SetTextureImage = 0x3d;
export const SetMaskImage = 0x3e;
export const SetColorImage = 0x3f;

class ObjTexture {
  constructor() {
    this.type = 0;
    this.image = 0;

    this.tileTMEM = 0;
    this.texLoadSize = 0;
    this.texLoadRows = 0;

    this.sid = 0;
    this.flag = 0;
    this.mask = 0;
  }

  load(dv, offset) {
    this.type = dv.getUint32(offset + 0, false);
    this.image = dv.getUint32(offset + 4, false);

    // Value assigned to Tile tmem parameter.
    this.tileTMEM = dv.getUint16(offset + 8, false);
    // Value assigned to TextureImage width and lrs argument of load commands.
    this.texLoadSize = dv.getUint16(offset + 10, false);
    // Value assigned to lrt argument of loads commands.
    this.texLoadRows = dv.getUint16(offset + 12, false);

    this.sid = dv.getUint16(offset + 14, false);
    this.flag = dv.getUint32(offset + 16, false);
    this.mask = dv.getUint32(offset + 20, false);
  }

  toString() {
    let text = `type = ${toString32(this.type)}, image = ${toString32(this.image)}\n`;
    text += `tmem = ${toString16(this.tileTMEM)}, size (qwords) = ${toString16(this.texLoadSize)}, rows (texels) = ${this.texLoadRows}`;
    return text;
  }
}

export class S2DEXCommon {
  constructor(state, ramDV, gbi) {
    this.state = state;
    this.ramDV = ramDV;
    this.gbi = gbi;

    // Helper instances to avoid reallocation when rendering.
    this.scaleBg = new ObjScaleBg();
    this.matrix = new ObjMatrix();
    this.sprite = new ObjSprite();
    this.texture = new ObjTexture();
  }

  executeBg1cyc(cmd0, cmd1, dis) {
    const address = this.state.rdpSegmentAddress(cmd1);
    this.scaleBg.load(this.ramDV, address);

    this.gbi.warnUnimplemented('gSPBgRect1Cyc')
    if (dis) {
      dis.text(`gSPBgRect1Cyc(${toString32(address)});`);
      dis.tip(this.scaleBg.toString());
    }
  }

  executeBgCopy(cmd0, cmd1, dis) {
    this.gbi.warnUnimplemented('gSPBgRectCopy')
    if (dis) {
      dis.text(`gSPBgRectCopy(/* TODO */);`);
    }
  }

  executeObjRectangle(cmd0, cmd1, dis) {
    this.execLoadTxRenderObj('gSPObjRectangle', false, kRenderNoRotation, cmd1, dis);
  }

  executeObjRectangleR(cmd0, cmd1, dis) {
    this.execLoadTxRenderObj('gSPObjRectangleR', false, kRenderPartialTransform, cmd1, dis);
  }

  executeObjSprite(cmd0, cmd1, dis) {
    this.execLoadTxRenderObj('gSPObjSprite', false, kRenderFullTransform, cmd1, dis);
  }

  executeObjLoadTxRect(cmd0, cmd1, dis) {
    this.execLoadTxRenderObj('gSPObjLoadTxRect', true, kRenderNoRotation, cmd1, dis);
  }

  executeObjLoadTxRectR(cmd0, cmd1, dis) {
    this.execLoadTxRenderObj('gSPObjLoadTxRectR', true, kRenderPartialTransform, cmd1, dis);
  }

  executeObjLoadTxSprite(cmd0, cmd1, dis) {
    this.execLoadTxRenderObj('gSPObjLoadTxSprite', true, kRenderFullTransform, cmd1, dis);
  }

  executeObjLoadTxtr(cmd0, cmd1, dis) {
    this.execLoadTxRenderObj('gSPObjLoadTxtr', true, kRenderNone, cmd1, dis);
  }

  execLoadTxRenderObj(method, loadTex, renderMode, cmd1, dis) {
    const address = this.state.rdpSegmentAddress(cmd1);
    let offset = address;

    if (loadTex) {
      this.texture.load(this.ramDV, offset);
      this.loadTexture();
      offset += 24;
    }

    if (renderMode != kRenderNone) {
      this.sprite.load(this.ramDV, offset);
      this.renderSprite(renderMode);
      offset += 24;
    }

    let tip = '';
    if (dis) {
      dis.text(`${method}(${toString32(address)});`);
      if (loadTex) { tip += this.texture.toString() + '\n'; }
      if (renderMode != kRenderNone) { tip += this.sprite.toString() + '\n'; }
      dis.tip(tip);
    }
  }

  executeObjMoveMem(cmd0, cmd1, dis) {
    const address = this.state.rdpSegmentAddress(cmd1);
    const index = cmd0 & 0xffff;

    switch (index) {
      case 0:
        if (dis) {
          dis.text(`gSPObjMatrix(${toString32(address)});`);
        }
        this.setObjMatrix(address, dis);
        break;
      case 2:
        if (dis) {
          dis.text(`gSPObjSubMatrix(${toString32(address)});`);
        }
        this.setObjSubMatrix(address, dis);
        break;
      default:
        if (dis) {
          dis.text(`gSPObjMoveMem(${index}, ${toString32(address)});`);
        }
    }
  }

  setObjMatrix(address, dis) {
    this.matrix.loadFullMatrix(this.ramDV, address);
    if (dis) {
      dis.tip(this.matrix.toString());
    }
  }

  setObjSubMatrix(address, dis) {
    this.matrix.loadSubMatrix(this.ramDV, address);
    if (dis) {
      dis.tip(this.matrix.toString());
    }
  }

  executeSelectDL(cmd0, cmd1, dis) {
    this.gbi.warnUnimplemented('gSPSelectDL')
    if (dis) {
      dis.text(`gSPSelectDL(/* TODO */);`);
    }
  }

  executeObjRendermode(cmd0, cmd1, dis) {
    if (dis) {
      dis.text(`gSPObjRenderMode(/* ignored */);`);
    }
  }

  executeTriRSP(cmd0, cmd1, dis) {
    this.gbi.warnUnimplemented('executeTriRSP')
    if (dis) {
      dis.text(`executeTriRSP(); // ignored`);
    }

    // Is this ever called during HLE?
  }

  loadTexture() {
    // S2DEX "load texture" issues the following RDP commands:
    // SetTextureImage, SetTile, [SyncLoad], [LoadBlock, LoadTile, LoadTLUT]
    const tex = this.texture;
    const tile = this.state.tiles[gbi.G_TX_LOADTILE];

    // TODO: check sid, flag and mask to figure out if the texture is already loaded.

    const ramAddress = this.state.rdpSegmentAddress(tex.image);

    // SetTextureImage - textures are always loaded as RGBA/16.
    const ti = this.state.textureImage;
    ti.set(gbi.ImageFormat.G_IM_FMT_RGBA, gbi.ImageSize.G_IM_SIZ_16b, tex.texLoadSize + 1, ramAddress);

    // SetTile - some of the parameters are embedded in the "type" field.
    const fmtSiz = (tex.type >>> 8) & 0xff;
    const fmt = (fmtSiz >>> 5) & 0x7;   // RGBA
    const siz = (fmtSiz >>> 3) & 0x3;   // 16 for loadBlock/loadTile or 4 for TLUT
    // The mask is either 0xfc (for LoadTile) or 0x00 (LoadBlock and LoadTLUT).
    const lineMask = ((tex.type << 8) >> 24);
    const line = ((tex.texLoadSize + 1) & lineMask) >>> 2;

    const palIdx = 0;
    tile.set(fmt, siz, line, tex.tileTMEM, palIdx, 0, 0, 0, 0, 0, 0);

    // texLoadSize is stored as qwords, so the *4 converts qwords into 16bpp texels
    // (there are 4 per qword), which ti.size is configured with.
    const texelsShift = 2;
    const loadSize = tex.texLoadSize << texelsShift;

    const command = (tex.type >>> 0) & 0xff;
    switch (command) {
      case LoadBlock:
        this.state.tmem.loadBlock(ti, tile, 0, 0, loadSize, tex.texLoadRows);
        break;
      case LoadTile:
        this.state.tmem.loadTile(ti, tile, 0, 0, loadSize, tex.texLoadRows);
        break;
      case LoadTLUT:
        this.state.tmem.loadTLUT(ti, tile, 0, 0, loadSize, tex.texLoadRows);
        break;
      default:
        this.gbi.warnUnimplemented(`load texture type ${tex.type}`);
        break;
    }
    this.state.invalidateTileHashes();
  }

  renderSprite(rotType) {
    const spr = this.sprite;
    const m = this.matrix;

    // In theory this should toggle between 0 and 2 for each call.
    const tileIdx = 0;
    const objX0 = spr.objX;
    const objY0 = spr.objY;
    const objX1 = spr.objW + objX0;
    const objY1 = spr.objH + objY0;

    const rTile = this.state.tiles[tileIdx];
    rTile.set(spr.imageFmt, spr.imageSiz, spr.imageStride, spr.imageAdrs, spr.imagePal, gbi.G_TX_CLAMP, 0, 0, gbi.G_TX_CLAMP, 0, 0);
    rTile.setSize(0, 0, (spr.imageW - 1) << 2, (spr.imageH - 1) << 2);

    // Used by Worms
    const swapX = spr.imageFlags & 0x01;  // G_OBJ_FLAG_FLIPS
    const swapY = spr.imageFlags & 0x10;  // G_OBJ_FLAG_FLIPT
    if (swapX || swapY) {
      this.gbi.warnUnimplemented("swapX/Y");
    }
    const s0 = 0;
    const t0 = 0;
    const s1 = spr.imageW;
    const t1 = spr.imageH;

    if (rotType == kRenderFullTransform) {
      const x0 = m.x + (m.a * objX0) + (m.b * objY0);
      const y0 = m.y + (m.c * objX0) + (m.d * objY0);
      const x1 = m.x + (m.a * objX1) + (m.b * objY0);
      const y1 = m.y + (m.c * objX1) + (m.d * objY0);
      const x2 = m.x + (m.a * objX0) + (m.b * objY1);
      const y2 = m.y + (m.c * objX0) + (m.d * objY1);
      const x3 = m.x + (m.a * objX1) + (m.b * objY1);
      const y3 = m.y + (m.c * objX1) + (m.d * objY1);
      this.gbi.renderer.texRectRot(tileIdx, x0, y0, x1, y1, x2, y2, x3, y3, s0, t0, s1, t1);
    } else if (rotType == kRenderPartialTransform) {
      // TODO: is x1/y1 decremented by 1?
      const x0 = m.x + (objX0 / m.sx);
      const y0 = m.y + (objY0 / m.sy);
      const x1 = m.x + (objX1 / m.sx);
      const y1 = m.y + (objY1 / m.sy);
      this.gbi.renderer.texRect(tileIdx, x0, y0, x1, y1, s0, t0, s1, t1, false);
    } else if (rotType == kRenderNoRotation) {
      // TODO: is x1/y1 decremented by 1?
      const x0 = objX0;
      const x1 = objX1;
      const y0 = objY0;
      const y1 = objY1;
      this.gbi.renderer.texRect(tileIdx, x0, y0, x1, y1, s0, t0, s1, t1, false);
    }
  }
}

export class GBI1SDEX extends GBI1 {
  constructor(state, ramDV) {
    super(state, ramDV);
    this.vertexStride = 2;

    this.s2dex = new S2DEXCommon(state, ramDV, this);

    this.sdexCommands = new Map([
      [0x01, this.s2dex.executeBg1cyc.bind(this.s2dex)],
      [0x02, this.s2dex.executeBgCopy.bind(this.s2dex)],
      [0x03, this.s2dex.executeObjRectangle.bind(this.s2dex)],
      [0x04, this.s2dex.executeObjSprite.bind(this.s2dex)],
      [0x05, this.s2dex.executeObjMoveMem.bind(this.s2dex)],

      // This is set in base - why?
      //  [0x09, this.executeSprite2DBase],

      [0xb0, this.s2dex.executeSelectDL.bind(this.s2dex)],
      [0xb1, this.s2dex.executeObjRendermode.bind(this.s2dex)],
      [0xb2, this.s2dex.executeObjRectangleR.bind(this.s2dex)],
      [0xc1, this.s2dex.executeObjLoadTxtr.bind(this.s2dex)],
      [0xc2, this.s2dex.executeObjLoadTxSprite.bind(this.s2dex)],
      [0xc3, this.s2dex.executeObjLoadTxRect.bind(this.s2dex)],
      [0xc4, this.s2dex.executeObjLoadTxRectR.bind(this.s2dex)],

      [0xc8, this.s2dex.executeTriRSP.bind(this.s2dex)],
      [0xc9, this.s2dex.executeTriRSP.bind(this.s2dex)],
      [0xca, this.s2dex.executeTriRSP.bind(this.s2dex)],
      [0xcb, this.s2dex.executeTriRSP.bind(this.s2dex)],
      [0xcc, this.s2dex.executeTriRSP.bind(this.s2dex)],
      [0xcd, this.s2dex.executeTriRSP.bind(this.s2dex)],
      [0xce, this.s2dex.executeTriRSP.bind(this.s2dex)],
      [0xcf, this.s2dex.executeTriRSP.bind(this.s2dex)],

      // This variant of the microcode implements texrect slightly differently.
      // 0xe4 replaces base executeTexRect but 0xb3 triggers it.
      // TODO: I think this is essentially the same as the base microcode, so
      // we should unify the behaviours. For Yoshi the difference seems to be
      // that it's used to render to a temp surface (the background?) which is
      // then used in executeBg1cyc/Copy.
      // e404008000000040 gsImmp1(G_RDPHALF_0, 0x00000040);
      // b400000000000000 gsImmp1(G_RDPHALF_1, 0x00000000);
      // b300000004000400 gsImmp1(G_RDPHALF_2, 0x04000400);
      [0xe4, this.executeRDPHalf0.bind(this.s2dex)],
    ]);
  }

  getHandler(command) {
    const fn = this.sdexCommands.get(command);
    if (fn) {
      return fn;
    }
    return super.getHandler(command);
  }

  executeRDPHalf0(cmd0, cmd1, dis) {
    if (dis) {
      dis.text(`gsImmp1(G_RDPHALF_0, ${toString32(cmd0)}, ${toString32(cmd1)});`);
    }
    this.state.rdpHalf0Cmd0 = cmd0;
    this.state.rdpHalf0Cmd1 = cmd1;
  }

  // 0xb3 - replaced base executeRDPHalf2 which 
  executeRDPHalf2(cmd0, cmd1, dis) {
    if (dis) {
      dis.text(`gsImmp1(G_RDPHALF_2, ${toString32(cmd1)});`);
    }
    this.rdpTexRect(this.state.rdpHalf0Cmd0, this.state.rdpHalf0Cmd1, this.state.rdpHalf1Cmd1, cmd1, dis);
  }
}

export class GBI2SDEX extends GBI2 {
  constructor(state, ramDV) {
    super(state, ramDV);
    this.vertexStride = 2;

    this.s2dex = new S2DEXCommon(state, ramDV, this);

    this.sdexCommands = new Map([
      [0x01, this.s2dex.executeObjRectangle.bind(this.s2dex)],
      [0x02, this.s2dex.executeObjSprite.bind(this.s2dex)],
      [0x04, this.s2dex.executeSelectDL.bind(this.s2dex)],
      [0x05, this.s2dex.executeObjLoadTxtr.bind(this.s2dex)],
      [0x06, this.s2dex.executeObjLoadTxSprite.bind(this.s2dex)],
      [0x07, this.s2dex.executeObjLoadTxRect.bind(this.s2dex)],
      [0x08, this.s2dex.executeObjLoadTxRectR.bind(this.s2dex)],
      [0x09, this.s2dex.executeBg1cyc.bind(this.s2dex)],
      [0x0a, this.s2dex.executeBgCopy.bind(this.s2dex)],
      [0x0b, this.s2dex.executeObjRendermode.bind(this.s2dex)],

      [0xc8, this.s2dex.executeTriRSP.bind(this.s2dex)],
      [0xc9, this.s2dex.executeTriRSP.bind(this.s2dex)],
      [0xca, this.s2dex.executeTriRSP.bind(this.s2dex)],
      [0xcb, this.s2dex.executeTriRSP.bind(this.s2dex)],
      [0xcc, this.s2dex.executeTriRSP.bind(this.s2dex)],
      [0xcd, this.s2dex.executeTriRSP.bind(this.s2dex)],
      [0xce, this.s2dex.executeTriRSP.bind(this.s2dex)],
      [0xcf, this.s2dex.executeTriRSP.bind(this.s2dex)],

      [0xd5, this.executeDLCount.bind(this)],
      [0xda, this.s2dex.executeObjRectangleR.bind(this.s2dex)],
    ]);
  }

  getHandler(command) {
    const fn = this.sdexCommands.get(command);
    if (fn) {
      return fn;
    }
    return super.getHandler(command);
  }

  executeDLCount(cmd0, cmd1, dis) {
    this.warnUnimplemented('executeDL_Count')
    if (dis) {
      dis.text(`executeDL_Count(/* TODO */);`);
    }
  }

  executeMoveMem(cmd0, cmd1, dis) {
    const type = cmd0 & 0xfe;
    if (type == 0) {
      const address = this.state.rdpSegmentAddress(cmd1);
      if (dis) {
        dis.text(`gSPObjMatrix(${toString32(address)});`);
      }
      this.s2dex.setObjMatrix(address, dis);
      return;
    } else if (type == 2) {
      const address = this.state.rdpSegmentAddress(cmd1);
      if (dis) {
        dis.text(`gSPObjSubMatrix(${toString32(address)});`);
      }
      this.s2dex.setObjSubMatrix(address, dis);
      return;
    }
    super.executeMoveMem(cmd0, cmd1, dis);
  }
}
