import { GBIMicrocode } from "./gbi_microcode.js";

export class GBI2 extends GBIMicrocode {
  constructor(state, ramDV, vertexStride) {
    super(state, ramDV, vertexStride);

    this.gbi2Commands = new Map([
      // [0x00, executeGBI2_Noop],
      // [0x01, executeGBI2_Vertex],
      // [0x02, executeGBI2_ModifyVtx],
      // [0x03, executeGBI2_CullDL],
      // [0x04, executeGBI2_BranchZ],
      // [0x05, executeGBI2_Tri1],
      // [0x06, executeGBI2_Tri2],
      // [0x07, executeGBI2_Quad],
      // [0x08, executeGBI2_Line3D],
      // [0x09, executeGBI2_BgRect1Cyc],
      // [0x0a, executeGBI2_BgRectCopy],
      // [0x0b, executeGBI2_ObjRenderMode],
    
      // // [0xd3, executeGBI2_Special1],
      // // [0xd4, executeGBI2_Special2],
      // // [0xd5, executeGBI2_Special3],
      // [0xd6, executeGBI2_DmaIo],
      // [0xd7, executeGBI2_Texture],
      // [0xd8, executeGBI2_PopMatrix],
      // [0xd9, executeGBI2_GeometryMode],
      // [0xda, executeGBI2_Matrix],
      // [0xdb, executeGBI2_MoveWord],
      // [0xdc, executeGBI2_MoveMem],
      // [0xdd, executeGBI2_LoadUcode],
      // [0xde, executeGBI2_DL],
      // [0xdf, executeGBI2_EndDL],
    
      // [0xe0, executeGBI2_SpNoop],
      // [0xe1, executeGBI2_RDPHalf_1],
      // [0xe2, executeGBI2_SetOtherModeL],
      // [0xe3, executeGBI2_SetOtherModeH],
    
      // [0xf1, executeGBI2_RDPHalf_2],
    ]);
  }

  getHandler(command) {
    const fn = this.gbi2Commands.get(command);
    if (fn) {
      return fn;
    }
    return super.getHandler(command);
  }
}
