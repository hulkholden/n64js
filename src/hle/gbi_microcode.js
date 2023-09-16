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
      [0xf7, this.executeSetFillColor],
      [0xf8, this.executeSetFogColor],
      [0xf9, this.executeSetBlendColor],
      [0xfa, this.executeSetPrimColor],
      [0xfb, this.executeSetEnvColor],
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

  executeSetEnvColor(cmd0, cmd1, dis) {
    if (dis) {
      dis.text(`gsDPSetEnvColor(${dis.rgba8888(cmd1)});`);
    }
    this.state.envColor = cmd1;
  }

}
