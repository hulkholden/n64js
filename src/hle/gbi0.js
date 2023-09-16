import { toString32 } from "../format.js";
import { GBIMicrocode, kUCode_GBI0_GE, kUCode_GBI0_WR } from "./gbi_microcode.js";

export class GBI0 extends GBIMicrocode {
  constructor(state, ramDV, vertexStride) {
    super(state, ramDV, vertexStride);
  }

  patchTable(tbl, ucode) {
    switch (ucode) {
      case kUCode_GBI0_WR:
        tbl[0x04] = this.executeVertexWR.bind(this);
        break;
      case kUCode_GBI0_GE:
        tbl[0xb1] = this.executeTri4.bind(this);
        tbl[0xb2] = this.executeSpNoop.bind(this); // FIXME
        tbl[0xb4] = this.executeSpNoop.bind(this); // FIXME - DLParser_RDPHalf1_GoldenEye;
        break;
    }  
  }

  executeTri4(cmd0, cmd1, dis) {
    const kCommand = cmd0 >>> 24;
    const stride = this.vertexStride;
    const verts = this.state.projectedVertices;
    const tb = this.triangleBuffer;
    tb.reset();

    let pc = this.state.pc;
    do {
      const idx09 = ((cmd0 >>> 12) & 0xf);
      const idx06 = ((cmd0 >>> 8) & 0xf);
      const idx03 = ((cmd0 >>> 4) & 0xf);
      const idx00 = ((cmd0 >>> 0) & 0xf);
      const idx11 = ((cmd1 >>> 28) & 0xf);
      const idx10 = ((cmd1 >>> 24) & 0xf);
      const idx08 = ((cmd1 >>> 20) & 0xf);
      const idx07 = ((cmd1 >>> 16) & 0xf);
      const idx05 = ((cmd1 >>> 12) & 0xf);
      const idx04 = ((cmd1 >>> 8) & 0xf);
      const idx02 = ((cmd1 >>> 4) & 0xf);
      const idx01 = ((cmd1 >>> 0) & 0xf);

      if (dis) {
        dis.text(`gsSP1Triangle4(${idx00},${idx01},${idx02}, ${idx03},${idx04},${idx05}, ${idx06},${idx07},${idx08}, ${idx09},${idx10},${idx11});`);
      }

      if (idx00 !== idx01) {
        tb.pushTri(verts[idx00], verts[idx01], verts[idx02]);
      }
      if (idx03 !== idx04) {
        tb.pushTri(verts[idx03], verts[idx04], verts[idx05]);
      }
      if (idx06 !== idx07) {
        tb.pushTri(verts[idx06], verts[idx07], verts[idx08]);
      }
      if (idx09 !== idx10) {
        tb.pushTri(verts[idx09], verts[idx10], verts[idx11]);
      }

      cmd0 = this.ramDV.getUint32(pc + 0);
      cmd1 = this.ramDV.getUint32(pc + 4);
      ++this.debugController.currentOp;
      pc += 8;
      // NB: process triangles individually when disassembling
    } while ((cmd0 >>> 24) === kCommand && tb.hasCapacity(4) && !dis);

    this.state.pc = pc - 8;
    --this.debugController.currentOp;

    this.flushTris(tb);
  }

  executeVertexWR(cmd0, cmd1, dis) {
    const n = ((cmd0 >>> 9) & 0x7f);
    const v0 = ((cmd0 >>> 16) & 0xff) / 5;
    //const length = (cmd0 >>> 0) & 0x1ff;
    const address = this.state.rdpSegmentAddress(cmd1);
  
    if (dis) {
      dis.text(`gsSPVertex(${toString32(address)}, ${n}, ${v0});`);
    }
  
    this.executeVertexImpl(v0, n, address, dis);
  }
  
}