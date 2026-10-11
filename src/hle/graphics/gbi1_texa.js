import { GBI1 } from './gbi1.js';
import * as gbi from './gbi.js';

const G_TEXA_LOADTEX = 0xb5;
const G_TEXA_SETTILESIZE = 0xbe;

// F3DTEX/A replaces Line3D and CullDL with compact texture commands.
// Command expansion: https://github.com/gonetz/GLideN64/blob/master/src/uCodes/F3DTEXA.cpp
export class GBI1TEXA extends GBI1 {
  constructor(state, ramDV) {
    super(state, ramDV);
    this.gbi1Commands.set(G_TEXA_LOADTEX, this.executeLoadTex.bind(this));
    this.gbi1Commands.set(G_TEXA_SETTILESIZE, this.executeSetTexTileSize.bind(this));
  }

  executeLoadTex(cmd0, cmd1, dis) {
    const lrs = (cmd0 >>> 12) & 0xfff;
    const dxt = cmd0 & 0xfff;
    const address = this.state.rdpSegmentAddress(cmd1);
    const format = gbi.ImageFormat.G_IM_FMT_RGBA;
    const size = gbi.ImageSize.G_IM_SIZ_16b;

    this.setTextureImage(format, size, 1, address, dis);
    this.setTile({
      tileIdx: gbi.G_TX_LOADTILE, format, size, line: 0, tmem: 0, palette: 0,
      cmS: gbi.G_TX_WRAP, maskS: 0, shiftS: 0,
      cmT: gbi.G_TX_WRAP, maskT: 0, shiftT: 0,
    }, dis);
    this.loadBlock(gbi.G_TX_LOADTILE, 0, 0, lrs, dxt, dis);
  }

  executeSetTexTileSize(cmd0, cmd1, dis) {
    const line = cmd1 >>> 24;
    const palette = (cmd0 >>> 20) & 0xf;
    const cmT = (cmd0 >>> 18) & 0x3;
    const maskT = (cmd0 >>> 14) & 0xf;
    const shiftT = (cmd0 >>> 10) & 0xf;
    const cmS = (cmd0 >>> 8) & 0x3;
    const maskS = (cmd0 >>> 4) & 0xf;
    const shiftS = cmd0 & 0xf;
    const lrs = (cmd1 >>> 12) & 0xfff;
    const lrt = cmd1 & 0xfff;

    this.setTile({
      tileIdx: gbi.G_TX_RENDERTILE,
      format: gbi.ImageFormat.G_IM_FMT_CI, size: gbi.ImageSize.G_IM_SIZ_4b,
      line, tmem: 0, palette, cmS, maskS, shiftS, cmT, maskT, shiftT,
    }, dis);
    this.setTileSize(gbi.G_TX_RENDERTILE, 0, 0, lrs, lrt, dis);
  }
}
