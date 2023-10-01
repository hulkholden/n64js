import { toString32 } from "../format";
import { GBI1 } from "./gbi1";
import { GBI2 } from "./gbi2";

// Where do these fit in?
// const ucodeSprite2d = {
//   0xbe: executeSprite2dScaleFlip,
//   0xbd: executeSprite2dDraw
// };

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
