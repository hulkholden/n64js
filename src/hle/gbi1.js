import { toString32 } from "../format.js";
import * as gbi from './gbi.js';
import { GBIMicrocode } from "./gbi_microcode.js";

export class GBI1 extends GBIMicrocode {
  constructor(state, ramDV, vertexStride) {
    super(state, ramDV, vertexStride);

    this.gbi1Commands = new Map([
      [0x00, this.executeSpNoop],
      [0x01, this.executeMatrix],
      // [0x03, executeGBI1_MoveMem],
      [0x04, this.executeVertex],
      // [0x06, executeGBI1_DL],
      [0x09, this.executeSprite2DBase],
    
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

  executeMatrix(cmd0, cmd1, dis) {
    const flags = (cmd0 >>> 16) & 0xff;
    const length = (cmd0 >>> 0) & 0xffff;
    const address = this.state.rdpSegmentAddress(cmd1);
  
    let matrix = this.loadMatrix(address);
  
    if (dis) {
      let t = '';
      t += (flags & gbi.G_MTX_PROJECTION) ? 'G_MTX_PROJECTION' : 'G_MTX_MODELVIEW';
      t += (flags & gbi.G_MTX_LOAD) ? '|G_MTX_LOAD' : '|G_MTX_MUL';
      t += (flags & gbi.G_MTX_PUSH) ? '|G_MTX_PUSH' : ''; //'|G_MTX_NOPUSH';
  
      dis.text(`gsSPMatrix(${toString32(address)}, ${t});`);
      dis.tip(this.previewMatrix(matrix));
    }
  
    const stack = (flags & gbi.G_MTX_PROJECTION) ? this.state.projection : this.state.modelview;
  
    if ((flags & gbi.G_MTX_LOAD) == 0) {
      matrix = stack[stack.length - 1].multiply(matrix);
    }
  
    if (flags & gbi.G_MTX_PUSH) {
      stack.push(matrix);
    } else {
      stack[stack.length - 1] = matrix;
    }
  }

  executeVertex(cmd0, cmd1, dis) {
    const v0 = ((cmd0 >>> 16) & 0xff) / this.vertexStride;
    const n = ((cmd0 >>> 10) & 0x3f);
    //const length = (cmd0 >>>  0) & 0x3ff;
    const address = this.state.rdpSegmentAddress(cmd1);
  
    if (dis) {
      dis.text(`gsSPVertex(${toString32(address)}, ${n}, ${v0});`);
    }
  
    this.executeVertexImpl(v0, n, address, dis);
  }
  
  executeSprite2DBase(cmd0, cmd1) {
    this.logUnimplemented('Sprite2DBase');
  }

}
