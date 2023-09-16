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

export class GBIMicrocode {
  constructor(state, ramDV, vertexStride) {
    this.state = state;
    this.ramDV = ramDV;
    this.vertexStride = vertexStride;

    this.triangleBuffer = new TriangleBuffer(64);

    this.gbiCommonCommands = new Map([
      // [0xe4, executeTexRect],
      // [0xe5, executeTexRectFlip],
      // [0xe6, executeRDPLoadSync],
      // [0xe7, executeRDPPipeSync],
      // [0xe8, executeRDPTileSync],
      // [0xe9, executeRDPFullSync],
      // [0xea, executeSetKeyGB],
      // [0xeb, executeSetKeyR],
      // [0xec, executeSetConvert],
      // [0xed, executeSetScissor],
      // [0xee, executeSetPrimDepth],
      // [0xef, executeSetRDPOtherMode],
      // [0xf0, executeLoadTLut],
      // [0xf2, executeSetTileSize],
      // [0xf3, executeLoadBlock],
      // [0xf4, executeLoadTile],
      // [0xf5, executeSetTile],
      // [0xf6, executeFillRect],
      // [0xf7, executeSetFillColor],
      // [0xf8, executeSetFogColor],
      // [0xf9, executeSetBlendColor],
      // [0xfa, executeSetPrimColor],
      // [0xfb, executeSetEnvColor],
      // [0xfc, executeSetCombine],
      // [0xfd, executeSetTImg],
      // [0xfe, executeSetZImg],
      // [0xff, executeSetCImg],
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
}
