import { toString16, toString32 } from "../format";
import * as gbi from './gbi.js';
import { GBI1 } from "./gbi1";
import { GBI2 } from "./gbi2";

// Where do these fit in?
// const ucodeSprite2d = {
//   0xbe: executeSprite2dScaleFlip,
//   0xbd: executeSprite2dDraw
// };

const kFullTransform = 0;
const kPartialTransform = 1;
const kNoRotation = 2;

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

const G_OBJLT_TXTRBLOCK = 0x00001033;
const G_OBJLT_TXTRTILE = 0x00fc1034;
const G_OBJLT_TLUT = 0x00000030;

class ObjTexture {
  constructor() {
    this.type = 0;
    this.image = 0;
    this.tmem = 0;
    this.tsize = 0;
    this.tline = 0;
    this.twidth = 0
    this.theight = 0;
    this.phead = 0;
    this.pnum = 0;
    this.sid = 0;
    this.flag = 0;
    this.mask = 0;
  }

  load(dv, offset) {
    this.type = dv.getUint32(offset + 0, false);
    this.image = dv.getUint32(offset + 4, false);

    this.tmem = 0;
    this.tsize = 0;
    this.tline = 0;
    this.twidth = 0
    this.theight = 0;
    this.phead = 0;
    this.pnum = 0;

    switch (this.type) {
      case G_OBJLT_TXTRBLOCK:
        this.tmem = dv.getUint16(offset + 8, false);
        this.tsize = dv.getUint16(offset + 10, false);
        this.tline = dv.getUint16(offset + 12, false);
        break;
      case G_OBJLT_TXTRTILE:
        this.tmem = dv.getUint16(offset + 8, false);
        this.twidth = dv.getUint16(offset + 10, false);
        this.theight = dv.getUint16(offset + 12, false);
        break;
      case G_OBJLT_TLUT:
        this.phead = dv.getUint16(offset + 8, false);
        this.pnum = dv.getUint16(offset + 10, false);
        break;
    }

    this.sid = dv.getUint16(offset + 14, false);
    this.flag = dv.getUint32(offset + 16, false);
    this.mask = dv.getUint32(offset + 20, false);
  }

  toString() {
    let text = `type = ${toString32(this.type)}, image = ${toString32(this.image)}\n`;
    switch (this.type) {
      case G_OBJLT_TXTRBLOCK:
        text += `Block: tmem = ${toString16(this.tmem)}, tsize = ${toString16(this.tsize)}, tline = ${toString16(this.tline)}`;
        break;
      case G_OBJLT_TXTRTILE:
        text += `Tile: tmem = ${toString16(this.tmem)}, twidth = ${toString16(this.twidth)}, theight = ${toString16(this.theight)}`;
        break;
      case G_OBJLT_TLUT:
        text += `TLUT: pnum = ${toString16(this.phead)}, pnum = ${toString16(this.pnum)}`;
        break;
      default:
        text += `UNKNOWN`;
    }
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
    const dv = new DataView(this.ramDV.buffer, address);
    this.scaleBg.load(dv, 0);

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
    this.gbi.warnUnimplemented('gSPObjRectangle')
    if (dis) {
      dis.text(`gSPObjRectangle(/* TODO */);`);
    }
  }

  executeObjRectangleR(cmd0, cmd1, dis) {
    this.gbi.warnUnimplemented('gSPObjRectangleR')
    if (dis) {
      dis.text(`gSPObjRectangleR(/* TODO */);`);
    }
  }

  executeObjSprite(cmd0, cmd1, dis) {
    const address = this.state.rdpSegmentAddress(cmd1);
    const dv = new DataView(this.ramDV.buffer, address);
    this.sprite.load(dv);

    if (dis) {
      dis.text(`gSPObjSprite(${toString32(address)});`);
      dis.tip(this.sprite.toString());
    }

    this.renderSprite(kFullTransform);
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
    const dv = new DataView(this.ramDV.buffer, address);
    this.matrix.loadFullMatrix(dv, 0);
    if (dis) {
      dis.tip(this.matrix.toString());
    }
  }

  setObjSubMatrix(address, dis) {
    const dv = new DataView(this.ramDV.buffer, address);
    this.matrix.loadSubMatrix(dv, 0);

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

  executeObjLoadTxtr(cmd0, cmd1, dis) {
    const address = this.state.rdpSegmentAddress(cmd1);
    const dv = new DataView(this.ramDV.buffer, address);
    this.texture.load(dv, 0);

    if (dis) {
      dis.text(`gSPObjLoadTxtr(${toString32(address)});`);
      dis.tip(`${this.texture.toString()}`);
    }

    this.loadTexture();
  }

  executeObjLoadTxSprite(cmd0, cmd1, dis) {
    const address = this.state.rdpSegmentAddress(cmd1);
    const dv = new DataView(this.ramDV.buffer, address);
    this.texture.load(dv, 0);
    this.sprite.load(dv, 24);

    if (dis) {
      dis.text(`gSPObjLoadTxSprite(${toString32(address)});`);
      dis.tip(`${this.texture.toString()}\n${this.sprite.toString()}`);
    }

    this.loadTexture();
    this.renderSprite(kFullTransform);
  }

  executeObjLoadTxRect(cmd0, cmd1, dis) {
    this.gbi.warnUnimplemented('gSPObjLoadTxRect')
    if (dis) {
      dis.text(`gSPObjLoadTxRect(/* TODO */);`);
    }
  }

  executeObjLoadTxRectR(cmd0, cmd1, dis) {
    const address = this.state.rdpSegmentAddress(cmd1);
    const dv = new DataView(this.ramDV.buffer, address);
    this.texture.load(dv, 0);
    this.sprite.load(dv, 24);

    if (dis) {
      dis.text(`gSPObjLoadTxRectR(${toString32(address)});`);
      dis.tip(`${this.texture.toString()}\n${this.sprite.toString()}`);
    }
    this.loadTexture();
    this.renderSprite(kPartialTransform);
  }

  executeTriRSP(cmd0, cmd1, dis) {
    this.gbi.warnUnimplemented('executeTriRSP')
    if (dis) {
      dis.text(`executeTriRSP(); // ignored`);
    }

    // Is this ever called during HLE?
  }

  executeRDPHalf0(cmd0, cmd1, dis) {
    this.gbi.warnUnimplemented('executeRDPHalf0')
    if (dis) {
      dis.text(`gsImmp1(G_RDPHALF_0, ${toString32(cmd1)});`);
    }
  }

  loadTexture() {
    const tileIdx = this.state.texture.tile;
    const lTile = this.state.tiles[gbi.G_TX_LOADTILE];
    const rTile = this.state.tiles[tileIdx];
    const spr = this.sprite;
    const tex = this.texture;

    // TODO: check sid, flag and mask to figure out if the texture is already loaded.

    if (spr.imageAdrs != 0) {
      // TODO: imageAdrs is the position in TMEM. Added to tex.tmem after loading?
      this.gbi.warnUnimplemented('non-zero spr.imageAdrs');
    }
    const ramAddress = this.state.rdpSegmentAddress(tex.image);

    // TODO: Is it ok to use this or should we maintain our own TextureImage?
    this.state.textureImage.set(spr.imageFmt, spr.imageSiz, spr.imageW, ramAddress);

    // FIXME - is this necessary? It it always RGBA16?
    this.state.rdpOtherModeH &= ~gbi.G_TT_MASK;
    this.state.rdpOtherModeH |= gbi.TextureLUT.G_TT_RGBA16;

    switch (tex.type) {
      case G_OBJLT_TXTRBLOCK:
        {
          const line = this.state.textureImage.texelsToBytes(spr.imageW) >>> 3;
          // Load the texture.
          lTile.set(spr.imageFmt, spr.imageSiz, line, tex.tmem, spr.imagePal, 0, 0, 0, 0, 0, 0);
          lTile.setSize(0, 0, ((spr.imageW - 1) * 4) >> 0, ((spr.imageH - 1) * 4) >> 0);
          this.state.tmem.loadBlock(lTile, ramAddress, tex.tline, tex.tsize + 1);

          // Set up the rendertile.
          rTile.set(spr.imageFmt, spr.imageSiz, line, tex.tmem, spr.imagePal, 0, 0, 0, 0, 0, 0);
          rTile.setSize(0, 0, ((spr.imageW - 1) * 4) >> 0, ((spr.imageH - 1) * 4) >> 0);
        }
        break;
      case G_OBJLT_TXTRTILE:
        {
          this.gbi.warnUnimplemented('load tile');
          const line = 8; // FIXME

          // Load the texture.
          lTile.set(spr.imageFmt, spr.imageSiz, line, tex.tmem, spr.imagePal, 0, 0, 0, 0, 0, 0);
          lTile.setSize(0, 0, tex.twidth, tex.theight);
          const ramStride = this.state.textureImage.stride();
          const rowBytes = this.state.textureImage.texelsToBytes(tex.twidth);
          const tmemStride = (this.state.textureImage.size == gbi.ImageSize.G_IM_SIZ_32b) ? lTile.line << 4 : lTile.line << 3;
          this.state.tmem.loadTile(lTile, ramAddress, spr.imageH, ramStride, rowBytes, tmemStride);

          // Set up the rendertile.
          rTile.set(spr.imageFmt, spr.imageSiz, line, tex.tmem, spr.imagePal, 0, 0, 0, 0, 0, 0);
          rTile.setSize(0, 0, tex.twidth, tex.theight);
        }
        break;
      case G_OBJLT_TLUT:
        {
          // Load the tlut.
          const line = 0;
          // TODO: is the image format correct?
          lTile.set(spr.imageFmt, spr.imageSiz, line, tex.phead, 0, 0, 0, 0, 0, 0, 0);
          // TODO: set tile size so LRT comes out as the count. 
          // lTile.setSize(0, 0, ((spr.imageW - 1) * 4) >> 0, ((spr.imageH - 1) * 4) >> 0);
          this.state.tmem.loadTLUT(lTile, ramAddress, tex.pnum + 1);
        }
        break;
      default:
        this.gbi.warnUnimplemented(`load texture type ${tex.type}`);
        break;
    }
    this.state.invalidateTileHashes();
  }

  renderSprite(rotType) {
    const tileIdx = this.state.texture.tile;
    const m = this.matrix;
    const objX0 = this.sprite.objX;
    const objY0 = this.sprite.objY;
    const objX1 = this.sprite.objW + objX0;
    const objY1 = this.sprite.objH + objY0;
  
    // Used by Worms
    const swapX = this.sprite.imageFlags & 0x01;  // G_OBJ_FLAG_FLIPS
    const swapY = this.sprite.imageFlags & 0x10;  // G_OBJ_FLAG_FLIPT
    if (swapX || swapY) {
      this.gbi.warnUnimplemented("swapX/Y");
    }
    const s0 = 0;
    const t0 = 0;
    const s1 = this.sprite.imageW;
    const t1 = this.sprite.imageH;

    if (rotType == kFullTransform) {
      const x0 = m.x + (m.a * objX0) + (m.b * objY0);
      const y0 = m.y + (m.c * objX0) + (m.d * objY0);
      const x1 = m.x + (m.a * objX1) + (m.b * objY0);
      const y1 = m.y + (m.c * objX1) + (m.d * objY0);
      const x2 = m.x + (m.a * objX0) + (m.b * objY1);
      const y2 = m.y + (m.c * objX0) + (m.d * objY1);
      const x3 = m.x + (m.a * objX1) + (m.b * objY1);
      const y3 = m.y + (m.c * objX1) + (m.d * objY1);
      this.gbi.renderer.texRectRot(tileIdx, x0, y0, x1, y1, x2, y2, x3, y3, s0, t0, s1, t1);
    } else if (rotType == kPartialTransform) {
      // TODO: is x1/y1 decremented by 1?
      const x0 = m.x + (objX0 / m.sx);
      const y0 = m.y + (objY0 / m.sy);
      const x1 = m.x + (objX1 / m.sx);
      const y1 = m.y + (objY1 / m.sy);
      this.gbi.renderer.texRect(tileIdx, x0, y0, x1, y1, s0, t0, s1, t1, false);
    } else if (rotType == kNoRotation) {
      // TODO: verify.
      this.gbi.warnUnimplemented('no rotation is untested');
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

      [0xe4, this.s2dex.executeRDPHalf0.bind(this.s2dex)],
    ]);
  }

  getHandler(command) {
    const fn = this.sdexCommands.get(command);
    if (fn) {
      return fn;
    }
    return super.getHandler(command);
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
