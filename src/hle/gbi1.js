import { GBIMicrocode } from "./gbi_microcode.js";

export class GBI1 extends GBIMicrocode {
  constructor(state, ramDV, vertexStride) {
    super(state, ramDV, vertexStride);

    this.gbi1Commands = new Map([
      [0x00, this.executeSpNoop],
      // [0x01, executeGBI1_Matrix],
      // [0x03, executeGBI1_MoveMem],
      // [0x04, executeGBI1_Vertex],
      // [0x06, executeGBI1_DL],
      // [0x09, executeGBI1_Sprite2DBase],
    
      // [0xb0, executeGBI1_BranchZ],
      // [0xb1, executeGBI1_Tri2],
      // [0xb2, executeGBI1_ModifyVtx],
      // [0xb3, executeGBI1_RDPHalf_2],
      // [0xb4, executeGBI1_RDPHalf_1],
      // [0xb5, executeGBI1_Line3D],
      // [0xb6, executeGBI1_ClrGeometryMode],
      // [0xb7, executeGBI1_SetGeometryMode],
      // [0xb8, executeGBI1_EndDL],
      // [0xb9, executeGBI1_SetOtherModeL],
      // [0xba, executeGBI1_SetOtherModeH],
      // [0xbb, executeGBI1_Texture],
      // [0xbc, executeGBI1_MoveWord],
      // [0xbd, executeGBI1_PopMatrix],
      // [0xbe, executeGBI1_CullDL],
      // [0xbf, executeGBI1_Tri1],
      // [0xc0, executeGBI1_Noop],
    ]);
  }

  getHandler(command) {
    const fn = this.gbi1Commands.get(command);
    if (fn) {
      return fn;
    }
    return super.getHandler(command);
  }

}
