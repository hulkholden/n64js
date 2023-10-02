import { toString16, toString32 } from "../format";
import * as gbi from './gbi.js';
import { GBI1 } from "./gbi1";
import { GBI2 } from "./gbi2";

// Where do these fit in?
// const ucodeSprite2d = {
//   0xbe: executeSprite2dScaleFlip,
//   0xbd: executeSprite2dDraw
// };
class uObjScaleBg {
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
  }

  executeBg1cyc(cmd0, cmd1, dis) {
    this.gbi.warnUnimplemented('executeBg1cyc')
    if (dis) {
      dis.text(`gSPBgRect1Cyc(/* TODO */);`);
    }
  }

  executeBgCopy(cmd0, cmd1, dis) {
    this.gbi.warnUnimplemented('executeBgCopy')
    if (dis) {
      dis.text(`gSPBgRectCopy(/* TODO */);`);
    }
  }

  executeObjRectangle(cmd0, cmd1, dis) {
    this.gbi.warnUnimplemented('executeObjRectangle')
    if (dis) {
      dis.text(`gSPObjRectangle(/* TODO */);`);
    }
  }

  executeObjRectangleR(cmd0, cmd1, dis) {
    this.gbi.warnUnimplemented('executeObjRectangleR')
    if (dis) {
      dis.text(`gSPObjRectangleR(/* TODO */);`);
    }
  }

  executeObjSprite(cmd0, cmd1, dis) {
    this.gbi.warnUnimplemented('executeObjSprite')
    if (dis) {
      dis.text(`gSPObjSprite(/* TODO */);`);
    }
  }

  executeObjMoveMem(cmd0, cmd1, dis) {
    const address = this.state.rdpSegmentAddress(cmd1);
    const index = cmd0 & 0xffff;

    this.gbi.warnUnimplemented('executeObjMoveMem')

    switch (index) {
      case 0:
        if (dis) {
          dis.text(`gSPObjMatrix(${toString32(address)});`);
        }
        break;
      case 2:
        if (dis) {
          dis.text(`gSPObjSubMatrix(${toString32(address)});`);
        }
        break;
      default:
        if (dis) {
          dis.text(`gSPObjMoveMem(${index}, ${toString32(address)});`);
        }
    }
  }

  executeSelectDL(cmd0, cmd1, dis) {
    this.gbi.warnUnimplemented('executeSelectDL')
    if (dis) {
      dis.text(`gSPSelectDL(/* TODO */);`);
    }
  }

  executeObjRendermode(cmd0, cmd1, dis) {
    this.gbi.warnUnimplemented('executeObjRendermode')
    if (dis) {
      dis.text(`gSPObjRenderMode(/* TODO */);`);
    }
  }

  executeObjLoadTxtr(cmd0, cmd1, dis) {
    this.gbi.warnUnimplemented('executeObjLoadTxtr')
    if (dis) {
      dis.text(`gSPObjLoadTxtr(/* TODO */);`);
    }
  }

  executeObjLdtxSprite(cmd0, cmd1, dis) {
    this.gbi.warnUnimplemented('executeObjLdtxSprite')
    if (dis) {
      dis.text(`gSPObjLoadTxSprite(/* TODO */);`);
    }
  }

  executeObjLdtxRect(cmd0, cmd1, dis) {
    this.gbi.warnUnimplemented('executeObjLdtxRect')
    if (dis) {
      dis.text(`gSPObjLoadTxRect(/* TODO */);`);
    }
  }

  executeObjLdtxRectR(cmd0, cmd1, dis) {
    this.gbi.warnUnimplemented('executeObjLdtxRectR')
    if (dis) {
      dis.text(`gSPObjLoadTxRectR(/* TODO */);`);
    }
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
      [0xc2, this.s2dex.executeObjLdtxSprite.bind(this.s2dex)],
      [0xc3, this.s2dex.executeObjLdtxRect.bind(this.s2dex)],
      [0xc4, this.s2dex.executeObjLdtxRectR.bind(this.s2dex)],

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
      [0x06, this.s2dex.executeObjLdtxSprite.bind(this.s2dex)],
      [0x07, this.s2dex.executeObjLdtxRect.bind(this.s2dex)],
      [0x08, this.s2dex.executeObjLdtxRectR.bind(this.s2dex)],
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
}
