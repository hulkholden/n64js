import { toString32 } from '../format.js';
import * as logger from '../logger.js';
import * as gbi from './gbi.js';
import * as shaders from './shaders.js';
import { TriangleBuffer } from "./triangle_buffer.js";

// TODO: See if we can split this up and move to gbi0.js etc.
export const kUCode_GBI0 = 0;
export const kUCode_GBI1 = 1;
export const kUCode_GBI2 = 2;
export const kUCode_GBI1_SDEX = 3;
export const kUCode_GBI2_SDEX = 4;
export const kUCode_GBI0_WR = 5;
export const kUCode_GBI0_DKR = 6;
export const kUCode_GBI1_LL = 7;
export const kUCode_GBI0_SE = 8;
export const kUCode_GBI0_GE = 9;
export const kUCode_GBI2_CONKER = 10;
export const kUCode_GBI0_PD = 11;

const kDebugColorImages = true;
let colorImages = new Map();

export class GBIMicrocode {
  constructor(state, ramDV, vertexStride) {
    this.state = state;
    this.ramDV = ramDV;
    this.vertexStride = vertexStride;

    this.triangleBuffer = new TriangleBuffer(64);

    this.gbiCommonCommands = new Map([
      // [0xe4, executeTexRect],
      // [0xe5, executeTexRectFlip],
      [0xe6, this.executeRDPLoadSync],
      [0xe7, this.executeRDPPipeSync],
      [0xe8, this.executeRDPTileSync],
      [0xe9, this.executeRDPFullSync],
      [0xea, this.executeSetKeyGB],
      [0xeb, this.executeSetKeyR],
      [0xec, this.executeSetConvert],
      [0xed, this.executeSetScissor],
      [0xee, this.executeSetPrimDepth],
      [0xef, this.executeSetRDPOtherMode],
      // [0xf0, executeLoadTLut],
      [0xf2, this.executeSetTileSize],
      // [0xf3, executeLoadBlock],
      // [0xf4, executeLoadTile],
      [0xf5, this.executeSetTile],
      // [0xf6, executeFillRect],
      [0xf7, this.executeSetFillColor],
      [0xf8, this.executeSetFogColor],
      [0xf9, this.executeSetBlendColor],
      [0xfa, this.executeSetPrimColor],
      [0xfb, this.executeSetEnvColor],
      [0xfc, this.executeSetCombine],
      [0xfd, this.executeSetTImg],
      [0xfe, this.executeSetZImg],
      [0xff, this.executeSetCImg],
    ]);
  }

  getHandler(command) {
    const fn = this.gbiCommonCommands.get(command);
    if (fn) {
      return fn;
    }
    return null;
  }

  executeSpNoop(cmd0, cmd1, dis) {
    if (dis) {
      dis.text('gsSPNoOp();');
    }
  }

  executeRDPLoadSync(cmd0, cmd1, dis) {
    if (dis) {
      dis.text('gsDPLoadSync();');
    }
  }
  
  executeRDPPipeSync(cmd0, cmd1, dis) {
    if (dis) {
      dis.text('gsDPPipeSync();');
    }
  }
  
  executeRDPTileSync(cmd0, cmd1, dis) {
    if (dis) {
      dis.text('gsDPTileSync();');
    }
  }
  
  executeRDPFullSync(cmd0, cmd1, dis) {
    if (dis) {
      dis.text('gsDPFullSync();');
    }
  }
  
  executeSetKeyGB(cmd0, cmd1, dis) {
    if (dis) {
      dis.text('gsDPSetKeyGB(???);');
    }
  }
  
  executeSetKeyR(cmd0, cmd1, dis) {
    if (dis) {
      dis.text('gsDPSetKeyR(???);');
    }
  }
  
  executeSetConvert(cmd0, cmd1, dis) {
    if (dis) {
      dis.text('gsDPSetConvert(???);');
    }
  }
  
  executeSetScissor(cmd0, cmd1, dis) {
    const x0 = ((cmd0 >>> 12) & 0xfff) / 4.0;
    const y0 = ((cmd0 >>> 0) & 0xfff) / 4.0;
    const x1 = ((cmd1 >>> 12) & 0xfff) / 4.0;
    const y1 = ((cmd1 >>> 0) & 0xfff) / 4.0;
    const mode = (cmd1 >>> 24) & 0x2;

    if (dis) {
      dis.text(`gsDPSetScissor(${gbi.ScissorMode.nameOf(mode)}, ${x0}, ${y0}, ${x1}, ${y1});`);
    }

    this.state.scissor.x0 = x0;
    this.state.scissor.y0 = y0;
    this.state.scissor.x1 = x1;
    this.state.scissor.y1 = y1;
    this.state.scissor.mode = mode;

    // FIXME: actually set this
  }

  executeSetRDPOtherMode(cmd0, cmd1, dis) {
    if (dis) {
      dis.text(`gsDPSetOtherMode(${toString32(cmd0)}, ${toString32(cmd1)}); // TODO: fix formatting`);
    }

    this.state.rdpOtherModeH = cmd0;
    this.state.rdpOtherModeL = cmd1;
  }

  executeSetTile(cmd0, cmd1, dis) {
    const format = (cmd0 >>> 21) & 0x7;
    const size = (cmd0 >>> 19) & 0x3;
    //const pad0 = (cmd0 >>> 18) & 0x1;
    const line = (cmd0 >>> 9) & 0x1ff;
    const tmem = (cmd0 >>> 0) & 0x1ff;
  
    //const pad1 = (cmd1 >>> 27) & 0x1f;
    const tileIdx = (cmd1 >>> 24) & 0x7;
    const palette = (cmd1 >>> 20) & 0xf;
  
    const cmT = (cmd1 >>> 18) & 0x3;
    const maskT = (cmd1 >>> 14) & 0xf;
    const shiftT = (cmd1 >>> 10) & 0xf;
  
    const cmS = (cmd1 >>> 8) & 0x3;
    const maskS = (cmd1 >>> 4) & 0xf;
    const shiftS = (cmd1 >>> 0) & 0xf;
  
    const tile = this.state.tiles[tileIdx];
    tile.set(format, size, line, tmem, palette, cmS, maskS, shiftS, cmT, maskT, shiftT);
  
    if (dis) {
      const fmtText = gbi.ImageFormat.nameOf(format);
      const sizeText = gbi.ImageSize.nameOf(size);
      const tileText = gbi.getTileText(tileIdx);
      const cmsText = gbi.getClampMirrorWrapText(cmS);
      const cmtText = gbi.getClampMirrorWrapText(cmT);
  
      dis.text(`gsDPSetTile(${fmtText}, ${sizeText}, ${line}, ${tmem}, ${tileText}, ${palette}, ${cmtText}, ${maskT}, ${shiftT}, ${cmsText}, ${maskS}, ${shiftS});`);
    }
  }
  
  executeSetTileSize(cmd0, cmd1, dis) {
    const uls = (cmd0 >>> 12) & 0xfff;
    const ult = (cmd0 >>> 0) & 0xfff;
    const tileIdx = (cmd1 >>> 24) & 0x7;
    const lrs = (cmd1 >>> 12) & 0xfff;
    const lrt = (cmd1 >>> 0) & 0xfff;
  
    const tile = this.state.tiles[tileIdx];
    tile.setSize(uls, ult, lrs, lrt);
  
    if (dis) {
      const tt = gbi.getTileText(tileIdx);
      dis.text(`gsDPSetTileSize(${tt}, ${tile.left}, ${tile.top}, ${tile.right}, ${tile.bottom});`);
      dis.tip(`size (${tile.width} x ${tile.height}), unmasked (${tile.unmaskedWidth} x ${tile.unmaskedHeight})`);
    }
  }

  executeSetFillColor(cmd0, cmd1, dis) {
    if (dis) {
      // Can be 16 or 32 bit
      dis.text(`gsDPSetFillColor(${dis.rgba8888(cmd1)}); // hi as 5551 = ${dis.rgba5551(cmd1 >>> 16)}, lo as 5551 = ${dis.rgba5551(cmd1 & 0xffff)} `);
    }
    this.state.fillColor = cmd1;
  }

  executeSetFogColor(cmd0, cmd1, dis) {
    if (dis) {
      dis.text(`gsDPSetFogColor(${dis.rgba8888(cmd1)});`);
    }
    this.state.fogColor = cmd1;
  }

  executeSetBlendColor(cmd0, cmd1, dis) {
    if (dis) {
      dis.text(`gsDPSetBlendColor(${dis.rgba8888(cmd1)});`);
    }
    this.state.blendColor = cmd1;
  }

  executeSetPrimColor(cmd0, cmd1, dis) {
    if (dis) {
      const m = (cmd0 >>> 8) & 0xff;
      const l = (cmd0 >>> 0) & 0xff;
      dis.text(`gsDPSetPrimColor(${m}, ${l}, ${dis.rgba8888(cmd1)});`);
    }
    // minlevel, primlevel ignored!
    this.state.primColor = cmd1;
  }

  executeSetPrimDepth(cmd0, cmd1, dis) {
    const z = (cmd1 >>> 16) & 0xffff;
    const dz = (cmd1) & 0xffff;
    if (dis) {
      dis.text(`gsDPSetPrimDepth(${z},${dz});`);
    }

    // FIXME
  }

  executeSetEnvColor(cmd0, cmd1, dis) {
    if (dis) {
      dis.text(`gsDPSetEnvColor(${dis.rgba8888(cmd1)});`);
    }
    this.state.envColor = cmd1;
  }

  executeSetCombine(cmd0, cmd1, dis) {
    if (dis) {
      const mux0 = cmd0 & 0x00ffffff;
      const mux1 = cmd1;
      const decoded = shaders.getCombinerText(mux0, mux1);
  
      dis.text(`gsDPSetCombine(${toString32(mux0)}, ${toString32(mux1)});\n${decoded}`);
    }
  
    this.state.combine.hi = cmd0 & 0x00ffffff;
    this.state.combine.lo = cmd1;
  }
  
  executeSetTImg(cmd0, cmd1, dis) {
    const format = (cmd0 >>> 21) & 0x7;
    const size = (cmd0 >>> 19) & 0x3;
    const width = ((cmd0 >>> 0) & 0xfff) + 1;
    const address = this.state.rdpSegmentAddress(cmd1);
  
    if (dis) {
      dis.text(`gsDPSetTextureImage(${gbi.ImageFormat.nameOf(format)}, ${gbi.ImageSize.nameOf(size)}, ${width}, ${toString32(address)});`);
    }
  
    this.state.textureImage.set(format, size, width, address)
  }
  
  executeSetZImg(cmd0, cmd1, dis) {
    const address = this.state.rdpSegmentAddress(cmd1);
  
    if (dis) {
      dis.text(`gsDPSetDepthImage(${toString32(address)});`);
    }
  
    this.state.depthImage.address = address;
  }
  
  executeSetCImg(cmd0, cmd1, dis) {
    const format = (cmd0 >>> 21) & 0x7;
    const size = (cmd0 >>> 19) & 0x3;
    const width = ((cmd0 >>> 0) & 0xfff) + 1;
    const address = this.state.rdpSegmentAddress(cmd1);
  
    if (dis) {
      dis.text(`gsDPSetColorImage(${gbi.ImageFormat.nameOf(format)}, ${gbi.ImageSize.nameOf(size)}, ${width}, ${toString32(address)});`);
    }
  
    this.state.colorImage = {
      format: format,
      size: size,
      width: width,
      address: address
    };
  
    // TODO: Banjo Tooie and Pokemon Stadium render to multiple buffers in each display list.
    // Need to set these up as separate framebuffers somehow
    if (kDebugColorImages && !colorImages.get(address)) {
      logger.log(`Setting colorImage to ${toString32(address)}, ${width}, size ${gbi.ImageSize.nameOf(size)}, format ${gbi.ImageFormat.nameOf(format)}`);
      colorImages.set(address, true);
    }
  }
  
}
