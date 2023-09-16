import { toString32 } from "../format.js";
import { GBIMicrocode } from "./gbi_microcode.js";

export class GBI2 extends GBIMicrocode {
  constructor(state, ramDV, vertexStride) {
    super(state, ramDV, vertexStride);

    this.gbi2Commands = new Map([
      [0x00, this.executeNoop],
      [0x01, this.executeVertex],
      // [0x02, executeGBI2_ModifyVtx],
      // [0x03, executeGBI2_CullDL],
      [0x04, this.executeBranchZ],
      // [0x05, executeGBI2_Tri1],
      // [0x06, executeGBI2_Tri2],
      // [0x07, executeGBI2_Quad],
      [0x08, this.executeLine3D],
      [0x09, this.executeBgRect1Cyc],
      [0x0a, this.executeBgRectCopy],
      [0x0b, this.executeObjRenderMode],
    
      // // [0xd3, executeGBI2_Special1],
      // // [0xd4, executeGBI2_Special2],
      // // [0xd5, executeGBI2_Special3],
      [0xd6, this.executeDmaIo],
      // [0xd7, executeGBI2_Texture],
      // [0xd8, executeGBI2_PopMatrix],
      // [0xd9, executeGBI2_GeometryMode],
      [0xda, this.executeMatrix],
      // [0xdb, executeGBI2_MoveWord],
      // [0xdc, executeGBI2_MoveMem],
      [0xdd, this.executeGLoadUcode],
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

  executeNoop(cmd0, cmd1, dis) {
    if (dis) {
      dis.text('gsDPNoOp();');
    }
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
  
  executeGLoadUcode(cmd0, cmd1, dis) {
    this.logUnimplemented('LoadUcode');

    if (dis) {
      dis.text(`gsSPLoadUCode(/* TODO */);`);
    }
  }
  
  executeBranchZ(cmd0, cmd1, dis) {
    this.logUnimplemented('BranchZ')

    if (dis) {
      dis.text(`gsSPBranchZ(/* TODO */);`);
    }
  }

  executeLine3D(cmd0, cmd1, dis) {
    this.logUnimplemented('Line3D');
  
    if (dis) {
      dis.text(`gsSPLine3D(/* TODO */);`);
    }
  }
  
  executeBgRect1Cyc(cmd0, cmd1, dis) {
    this.logUnimplemented('BgRect1Cyc');
  
    if (dis) {
      dis.text(`gsSPBgRect1Cyc(/* TODO */);`);
    }
  }
  
  executeBgRectCopy(cmd0, cmd1, dis) {
    this.logUnimplemented('BgRectCopy');
  
    if (dis) {
      dis.text(`gsSPBgRectCopy(/* TODO */);`);
    }
  }
  
  executeObjRenderMode(cmd0, cmd1, dis) {
    this.logUnimplemented('ObjRenderMode');
  
    if (dis) {
      dis.text(`gsSPObjRenderMode(/* TODO */);`);
    }
  }
  
  executeDmaIo(cmd0, cmd1, dis) {
    // No-op?
  
    if (dis) {
      dis.text(`DmaIo(/* TODO */);`);
    }
  }
  
}
