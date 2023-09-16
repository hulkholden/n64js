import { toString32 } from "../format.js";
import * as disassemble from './disassemble.js';
import * as gbi from './gbi.js';
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
      [0x05, this.executeTri1],
      [0x06, this.executeTri2],
      [0x07, this.executeQuad],
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
      [0xdd, this.executeLoadUcode],
      [0xde, this.executeDL],
      [0xdf, this.executeEndDL],
    
      [0xe0, this.executeSpNoop],
      [0xe1, this.executeRDPHalf1],
      [0xe2, this.executeSetOtherModeL],
      [0xe3, this.executeSetOtherModeH],
    
      [0xf1, this.executeRDPHalf2],
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

  executeSpNoop(cmd0, cmd1, dis) {
    if (dis) {
      dis.text('gsSPNoOp();');
    }
  }
    
  executeDL(cmd0, cmd1, dis) {
    const param = (cmd0 >>> 16) & 0xff;
    const address = this.state.rdpSegmentAddress(cmd1);
  
    if (dis) {
      const fn = (param === gbi.G_DL_PUSH) ? 'gsSPDisplayList' : 'gsSPBranchList';
      dis.text(`${fn}(<span class="dl-branch">${toString32(address)}</span>);`);
    }
  
    if (param === gbi.G_DL_PUSH) {
      this.state.dlistStack.push({ pc: this.state.pc });
    }
    this.state.pc = address;
  }
  
  executeEndDL(cmd0, cmd1, dis) {
    if (dis) {
      dis.text('gsSPEndDisplayList();');
    }
  
    if (this.state.dlistStack.length > 0) {
      this.state.pc = this.state.dlistStack.pop().pc;
    } else {
      this.state.pc = 0;
    }
  }
  
  executeSetOtherModeL(cmd0, cmd1, dis) {
    const shift = (cmd0 >>> 8) & 0xff;
    const len = (cmd0 >>> 0) & 0xff;
    const data = cmd1;
    const mask = (0x80000000 >> len) >>> shift;
    if (dis) {
      disassemble.SetOtherModeL(dis, mask, data);
    }
    this.state.rdpOtherModeL = (this.state.rdpOtherModeL & ~mask) | data;
  }
  
  executeSetOtherModeH(cmd0, cmd1, dis) {
    const shift = (cmd0 >>> 8) & 0xff;
    const len = (cmd0 >>> 0) & 0xff;
    const data = cmd1;
    const mask = (0x80000000 >> len) >>> shift;
    if (dis) {
      disassemble.SetOtherModeH(dis, mask, len, shift, data);
    }
    this.state.rdpOtherModeH = (this.state.rdpOtherModeH & ~mask) | data;
  }
  
  executeRDPHalf1(cmd0, cmd1, dis) {
    if (dis) {
      dis.text(`gsImmp1(G_RDPHALF_1, ${toString32(cmd1)});`);
    }
    this.state.rdpHalf1 = cmd1;
  }
  
  executeRDPHalf2(cmd0, cmd1, dis) {
    if (dis) {
      dis.text(`gsImmp1(G_RDPHALF_2, ${toString32(cmd1)});`);
    }
    this.state.rdpHalf2 = cmd1;
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
  
  executeLoadUcode(cmd0, cmd1, dis) {
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
  
  executeTri1(cmd0, cmd1, dis) {
    const kTriCommand = cmd0 >>> 24;
    const verts = this.state.projectedVertices;
    const tb = this.triangleBuffer;
    tb.reset();
  
    let pc = this.state.pc;
    do {
      const idx0 = (cmd0 >>> 1) & 0x7f;
      const idx1 = (cmd0 >>> 9) & 0x7f;
      const idx2 = (cmd0 >>> 17) & 0x7f;
      const flag = (cmd1 >>> 24) & 0xff;
  
      if (dis) {
        dis.text(`gsSP1Triangle(${idx0},${idx1},${idx2}, ${flag});`);
      }
  
      tb.pushTri(verts[idx0], verts[idx1], verts[idx2]);
  
      cmd0 = this.ramDV.getUint32(pc + 0);
      cmd1 = this.ramDV.getUint32(pc + 4);
      ++this.debugController.currentOp;
      pc += 8;
  
      // NB: process triangles individually when disassembling
    } while ((cmd0 >>> 24) === kTriCommand && tb.hasCapacity(1) && !dis);
  
    this.state.pc = pc - 8;
    --this.debugController.currentOp;
  
    this.flushTris(tb);
  }
  
  executeTri2(cmd0, cmd1, dis) {
    const kTriCommand = cmd0 >>> 24;
    const verts = this.state.projectedVertices;
    const tb = this.triangleBuffer;
    tb.reset();
  
    let pc = this.state.pc;
    do {
      const idx00 = (cmd1 >>> 1) & 0x7f;
      const idx01 = (cmd1 >>> 9) & 0x7f;
      const idx02 = (cmd1 >>> 17) & 0x7f;
      const idx10 = (cmd0 >>> 1) & 0x7f;
      const idx11 = (cmd0 >>> 9) & 0x7f;
      const idx12 = (cmd0 >>> 17) & 0x7f;
  
      if (dis) {
        dis.text(`gsSP2Triangles(${idx00},${idx01},${idx02}, ${idx10},${idx11},${idx12});`);
      }
  
      tb.pushTri(verts[idx00], verts[idx01], verts[idx02]);
      tb.pushTri(verts[idx10], verts[idx11], verts[idx12]);
  
      cmd0 = this.ramDV.getUint32(pc + 0);
      cmd1 = this.ramDV.getUint32(pc + 4);
      ++this.debugController.currentOp;
      pc += 8;
      // NB: process triangles individually when disassembling
    } while ((cmd0 >>> 24) === kTriCommand && tb.hasCapacity(2) && !dis);
  
    this.state.pc = pc - 8;
    --this.debugController.currentOp;
  
    this.flushTris(tb);
  }
  
  // TODO: this is effectively the same as executeTri2, just different disassembly.
  executeQuad(cmd0, cmd1, dis) {
    const kTriCommand = cmd0 >>> 24;
    const verts = this.state.projectedVertices;
    const tb = this.triangleBuffer;
    tb.reset();
  
    let pc = this.state.pc;
    do {
      const idx00 = (cmd1 >>> 1) & 0x7f;
      const idx01 = (cmd1 >>> 9) & 0x7f;
      const idx02 = (cmd1 >>> 17) & 0x7f;
      const idx10 = (cmd0 >>> 1) & 0x7f;
      const idx11 = (cmd0 >>> 9) & 0x7f;
      const idx12 = (cmd0 >>> 17) & 0x7f;
  
      if (dis) {
        dis.text(`gSP1Quadrangle(${idx00},${idx01},${idx02}, ${idx10},${idx11},${idx12});`);
      }
  
      tb.pushTri(verts[idx00], verts[idx01], verts[idx02]);
      tb.pushTri(verts[idx10], verts[idx11], verts[idx12]);
  
      cmd0 = this.ramDV.getUint32(pc + 0);
      cmd1 = this.ramDV.getUint32(pc + 4);
      ++this.debugController.currentOp;
      pc += 8;
      // NB: process triangles individually when disassembling
    } while ((cmd0 >>> 24) === kTriCommand && tb.hasCapacity(2) && !dis);
  
    this.state.pc = pc - 8;
    --this.debugController.currentOp;
  
    this.flushTris(tb);
  }
  
}
