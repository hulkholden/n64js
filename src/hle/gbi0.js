import { toString32 } from "../format.js";
import { GBI1 } from "./gbi1.js";

// GBI0 is very similar to GBI1 with a few small differences, so we extend that instead of GBIMicrocode.
export class GBI0 extends GBI1 {
  constructor(ucode, state, ramDV) {
    super(ucode, state, ramDV);
    this.vertexStride = 10;

    this.gbi0Commands = new Map([
      // TODO: check if we need to handle these differently.
      // [0xb0, executeGBI1_BranchZ], // GBI1 only?
      // [0xb1, executeGBI1_Tri2], // GBI1 only?
      [0xb2, this.executeRDPHalf_Cont],
    ]);
  }

  getHandler(command) {
    const fn = this.gbi0Commands.get(command);
    if (fn) {
      return fn;
    }
    return super.getHandler(command);
  }

  executeVertex(cmd0, cmd1, dis) {
    const n = ((cmd0 >>> 20) & 0xf) + 1;
    const v0 = (cmd0 >>> 16) & 0xf;
    //const length = (cmd0 >>>  0) & 0xffff;
    const address = this.state.rdpSegmentAddress(cmd1);

    if (dis) {
      dis.text(`gsSPVertex(${toString32(address)}, ${n}, ${v0});`);
    }

    this.loadVertices(v0, n, address, dis);
  }

  executeRDPHalf_Cont(cmd0, cmd1, dis) {
    this.logUnimplemented('RDPHalf_Cont');
    if (dis) {
      dis.text(`gsDPHalf_Cont(/* TODO */);`);
    }
  }
}

export class GBI0DKR extends GBI0 {
  constructor(ucode, state, ramDV) {
    super(ucode, state, ramDV);
    this.vertexStride = 10;
  }
}

export class GBI0SE extends GBI0 {
  constructor(ucode, state, ramDV) {
    super(ucode, state, ramDV);
    this.vertexStride = 5;
  }
}

export class GBI0PD extends GBI0 {
  constructor(ucode, state, ramDV) {
    super(ucode, state, ramDV);
    this.vertexStride = 10;
  }
}

export class GBI0GE extends GBI0 {
  constructor(ucode, state, ramDV) {
    super(ucode, state, ramDV);
    this.vertexStride = 10;
  }

  getHandler(command, ucode) {
    switch (command) {
      case 0xb1: return this.executeTri4GE;
      case 0xb2: return this.executeSpNoop; // FIXME
      case 0xb3: return this.executeSpNoop; // FIXME - DLParser_RDPHalf1_GoldenEye;
    }
    return super.getHandler(command, ucode);
  }

  executeTri4GE(cmd0, cmd1, dis) {
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

    this.renderer.flushTris(tb);
  }
}

export class GBI0WR extends GBI0 {
  constructor(ucode, state, ramDV) {
    super(ucode, state, ramDV);
    this.vertexStride = 5;
  }

  executeVertex(cmd0, cmd1, dis) {
    const n = ((cmd0 >>> 9) & 0x7f);
    const v0 = ((cmd0 >>> 16) & 0xff) / 5;
    //const length = (cmd0 >>> 0) & 0x1ff;
    const address = this.state.rdpSegmentAddress(cmd1);

    if (dis) {
      dis.text(`gsSPVertex(${toString32(address)}, ${n}, ${v0});`);
    }

    this.loadVertices(v0, n, address, dis);
  }
}