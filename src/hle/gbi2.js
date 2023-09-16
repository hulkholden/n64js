import { toString32 } from "../format.js";
import { GBIMicrocode } from "./gbi_microcode.js";

export class GBI2 extends GBIMicrocode {
  constructor(state, ramDV, vertexStride) {
    super(state, ramDV, vertexStride);

    this.gbi2Commands = new Map([
      // [0x00, executeGBI2_Noop],
      [0x01, this.executeVertex],
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
      [0xda, this.executeMatrix],
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

  executeMatrix(cmd0, cmd1, dis) {
    const address = this.state.rdpSegmentAddress(cmd1);
    const push = ((cmd0) & 0x1) === 0;
    const replace = (cmd0 >>> 1) & 0x1;
    const projection = (cmd0 >>> 2) & 0x1;
  
    let matrix = this.loadMatrix(address);
  
    if (dis) {
      let t = '';
      t += projection ? 'G_MTX_PROJECTION' : 'G_MTX_MODELVIEW';
      t += replace ? '|G_MTX_LOAD' : '|G_MTX_MUL';
      t += push ? '|G_MTX_PUSH' : ''; //'|G_MTX_NOPUSH';
  
      dis.text(`gsSPMatrix(${toString32(address)}, ${t});`);
      dis.tip(this.previewMatrix(matrix));
    }
  
    const stack = projection ? this.state.projection : this.state.modelview;
  
    if (!replace) {
      matrix = stack[stack.length - 1].multiply(matrix);
    }
  
    if (push) {
      stack.push(matrix);
    } else {
      stack[stack.length - 1] = matrix;
    }
  }

  executeVertex(cmd0, cmd1, dis) {
    const vend = ((cmd0) & 0xff) >> 1;
    const n = (cmd0 >>> 12) & 0xff;
    const v0 = vend - n;
    const address = this.state.rdpSegmentAddress(cmd1);
  
    if (dis) {
      dis.text(`gsSPVertex(${toString32(address)}, ${n}, ${v0});`);
    }
  
    this.executeVertexImpl(v0, n, address, dis);
  }
  
}
