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
  }

  getHandler(command) {
    return null;
  }

  executeSpNoop(cmd0, cmd1, dis) {
    if (dis) {
      dis.text('gsSPNoOp();');
    }
  }
}
