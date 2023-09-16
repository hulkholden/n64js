import { toString32 } from "../format.js";
import * as gbi from './gbi.js';
import { GBIMicrocode } from "./gbi_microcode.js";

let executeLine3D_Warned = false;

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
      [0xb1, this.executeTri2],
      // [0xb2, executeGBI1_ModifyVtx],
      // [0xb3, executeGBI1_RDPHalf_2],
      // [0xb4, executeGBI1_RDPHalf_1],
      [0xb5, this.executeLine3D],
      // [0xb6, executeGBI1_ClrGeometryMode],
      // [0xb7, executeGBI1_SetGeometryMode],
      // [0xb8, executeGBI1_EndDL],
      // [0xb9, executeGBI1_SetOtherModeL],
      // [0xba, executeGBI1_SetOtherModeH],
      // [0xbb, executeGBI1_Texture],
      // [0xbc, executeGBI1_MoveWord],
      // [0xbd, executeGBI1_PopMatrix],
      // [0xbe, executeGBI1_CullDL],
      [0xbf, this.executeTri1],
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
  
  executeSprite2DBase(cmd0, cmd1, dis) {
    this.logUnimplemented('Sprite2DBase');

    if (dis) {
      dis.text(`gsSPSprite2DBase(/* TODO */);`);
    }
  }

  executeTri1(cmd0, cmd1, dis) {
    const kCommand = cmd0 >>> 24;
    const stride = this.vertexStride;
    const verts = this.state.projectedVertices;
    const tb = this.triangleBuffer;
    tb.reset();
  
    let pc = this.state.pc;
    do {
      const flag = (cmd1 >>> 24) & 0xff;
      const idx0 = ((cmd1 >>> 16) & 0xff) / stride;
      const idx1 = ((cmd1 >>> 8) & 0xff) / stride;
      const idx2 = ((cmd1 >>> 0) & 0xff) / stride;
  
      if (dis) {
        dis.text(`gsSP1Triangle(${idx0}, ${idx1}, ${idx2}, ${flag});`);
      }
  
      tb.pushTri(verts[idx0], verts[idx1], verts[idx2]);
  
      cmd0 = this.ramDV.getUint32(pc + 0);
      cmd1 = this.ramDV.getUint32(pc + 4);
      ++this.debugController.currentOp;
      pc += 8;
  
      // NB: process triangles individually when disassembling
    } while ((cmd0 >>> 24) === kCommand && tb.hasCapacity(1) && !dis);
  
    this.state.pc = pc - 8;
    --this.debugController.currentOp;
  
    this.flushTris(tb);
  }
  
  executeTri2(cmd0, cmd1, dis) {
    const kCommand = cmd0 >>> 24;
    const stride = this.vertexStride;
    const verts = this.state.projectedVertices;
    const tb = this.triangleBuffer;
    tb.reset();
  
    let pc = this.state.pc;
    do {
      const idx0 = ((cmd0 >>> 16) & 0xff) / stride;
      const idx1 = ((cmd0 >>> 8) & 0xff) / stride;
      const idx2 = ((cmd0 >>> 0) & 0xff) / stride;
      const idx3 = ((cmd1 >>> 16) & 0xff) / stride;
      const idx4 = ((cmd1 >>> 8) & 0xff) / stride;
      const idx5 = ((cmd1 >>> 0) & 0xff) / stride;
  
      if (dis) {
        dis.text(`gsSP1Triangle2(${idx0},${idx1},${idx2}, ${idx3},${idx4},${idx5});`);
      }
  
      tb.pushTri(verts[idx0], verts[idx1], verts[idx2]);
      tb.pushTri(verts[idx3], verts[idx4], verts[idx5]);
  
      cmd0 = this.ramDV.getUint32(pc + 0);
      cmd1 = this.ramDV.getUint32(pc + 4);
      ++this.debugController.currentOp;
      pc += 8;
      // NB: process triangles individually when disassembling
    } while ((cmd0 >>> 24) === kCommand && tb.hasCapacity(2) && !dis);
  
    this.state.pc = pc - 8;
    --this.debugController.currentOp;
  
    this.flushTris(tb);
  }
    
  executeLine3D(cmd0, cmd1, dis) {
    const kCommand = cmd0 >>> 24;
    const stride = this.vertexStride;
    const verts = this.state.projectedVertices;
    const tb = this.triangleBuffer;
    tb.reset();
  
    let pc = this.state.pc;
    do {
      const idx3 = ((cmd1 >>> 24) & 0xff) / stride;
      const idx0 = ((cmd1 >>> 16) & 0xff) / stride;
      const idx1 = ((cmd1 >>> 8) & 0xff) / stride;
      const idx2 = ((cmd1 >>> 0) & 0xff) / stride;
  
      if (dis) {
        dis.text(`gsSPLine3D(${idx0}, ${idx1}, ${idx2}, ${idx3});`);
      }
  
      // Tamagotchi World 64 seems to trigger this. 
      if (idx0 < verts.length && idx1 < verts.length && idx2 < verts.length) {
        tb.pushTri(verts[idx0], verts[idx1], verts[idx2]);
      } else if (!executeLine3D_Warned) {
        console.log(`verts out of bounds, ignoring: ${idx0}, ${idx1}, ${idx2} vs ${verts.length}, stride ${stride}`);
        executeLine3D_Warned = true;
      }
      if (idx2 < verts.length && idx3 < verts.length && idx0 < verts.length) {
        tb.pushTri(verts[idx2], verts[idx3], verts[idx0]);
      } else if (!executeLine3D_Warned) {
        console.log(`verts out of bounds, ignoring: ${idx2}, ${idx3}, ${idx0} vs ${verts.length}, stride ${stride}`);
        executeLine3D_Warned = true;
      }
  
      cmd0 = this.ramDV.getUint32(pc + 0);
      cmd1 = this.ramDV.getUint32(pc + 4);
      ++this.debugController.currentOp;
      pc += 8;
      // NB: process triangles individually when disassembling
    } while ((cmd0 >>> 24) === kCommand && tb.hasCapacity(2) && !dis);
  
    this.state.pc = pc - 8;
    --this.debugController.currentOp;
  
    this.flushTris(tb);
  }
}
