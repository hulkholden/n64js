import { toHex, toString16, toString32 } from "../format.js";
import * as disassemble from './disassemble.js';
import * as gbi from './gbi.js';
import { GBIMicrocode } from "./gbi_microcode.js";

const G_NOOP = 0x00;
const G_VTX = 0x01;
const G_MODIFYVTX = 0x02;
const G_CULLDL = 0x03;
const G_BRANCH_Z = 0x04;
const G_TRI1 = 0x05;
const G_TRI2 = 0x06;
const G_QUAD = 0x07;
const G_LINE3D = 0x08;
const G_BG_1CYC = 0x09;
const G_BG_COPY = 0x0a;
const G_OBJ_RENDERMODE = 0x0b;
const G_DMA_IO = 0xd6;
const G_TEXTURE = 0xd7;
const G_POPMTX = 0xd8;
const G_GEOMETRYMODE = 0xd9;
const G_MTX = 0xda;
const G_MOVEWORD = 0xdb;
const G_MOVEMEM = 0xdc;
const G_LOAD_UCODE = 0xdd;
const G_DL = 0xde;
const G_ENDDL = 0xdf;
const G_SPNOOP = 0xe0;
const G_RDPHALF_1 = 0xe1;
const G_SETOTHERMODE_L = 0xe2;
const G_SETOTHERMODE_H = 0xe3;
const G_RDPHALF_2 = 0xf1;

export class GBI2 extends GBIMicrocode {
  constructor(state, ramDV) {
    super(state, ramDV);
    this.vertexStride = 2;

    this.gbi2Commands = new Map([
      [G_NOOP, this.executeNoop.bind(this)],
      [G_VTX, this.executeVertex.bind(this)],
      [G_MODIFYVTX, this.executeModifyVtx.bind(this)],
      [G_CULLDL, this.executeCullDL.bind(this)],
      [G_BRANCH_Z, this.executeBranchZ.bind(this)],
      [G_TRI1, this.executeTri1.bind(this)],
      [G_TRI2, this.executeTri2.bind(this)],
      [G_QUAD, this.executeQuad.bind(this)],
      [G_LINE3D, this.executeLine3D.bind(this)],
      [G_BG_1CYC, this.executeBgRect1Cyc.bind(this)],
      [G_BG_COPY, this.executeBgRectCopy.bind(this)],
      [G_OBJ_RENDERMODE, this.executeObjRenderMode.bind(this)],

      // // [0xd3, executeGBI2_Special1.bind(this)],
      // // [0xd4, executeGBI2_Special2.bind(this)],
      // // [0xd5, executeGBI2_Special3.bind(this)],
      [G_DMA_IO, this.executeDmaIo.bind(this)],
      [G_TEXTURE, this.executeTexture.bind(this)],
      [G_POPMTX, this.executePopMatrix.bind(this)],
      [G_GEOMETRYMODE, this.executeGeometryMode.bind(this)],
      [G_MTX, this.executeMatrix.bind(this)],
      [G_MOVEWORD, this.executeMoveWord.bind(this)],
      [G_MOVEMEM, this.executeMoveMem.bind(this)],
      [G_LOAD_UCODE, this.executeLoadUcode.bind(this)],
      [G_DL, this.executeDL.bind(this)],
      [G_ENDDL, this.executeEndDL.bind(this)],

      [G_SPNOOP, this.executeSpNoop.bind(this)],
      [G_RDPHALF_1, this.executeRDPHalf1.bind(this)],
      [G_SETOTHERMODE_L, this.executeSetOtherModeL.bind(this)],
      [G_SETOTHERMODE_H, this.executeSetOtherModeH.bind(this)],

      [G_RDPHALF_2, this.executeRDPHalf2.bind(this)],
    ]);
  }

  getHandler(command) {
    const fn = this.gbi2Commands.get(command);
    if (fn) {
      return fn;
    }
    return super.getHandler(command);
  }

  executeDL(cmd0, cmd1, dis) {
    const param = (cmd0 >>> 16) & 0xff;
    const address = this.state.rdpSegmentAddress(cmd1);

    if (dis) {
      const fn = (param === gbi.G_DL_PUSH) ? 'gsSPDisplayList' : 'gsSPBranchList';
      dis.text(`${fn}(<span class="dl-branch">${toString32(address)}</span>);`);
    }

    if (param === gbi.G_DL_PUSH) {
      this.state.pushDisplayList(address);
    } else {
      this.state.branchDisplayList(address);
    }
  }

  executeEndDL(cmd0, cmd1, dis) {
    if (dis) {
      dis.text('gsSPEndDisplayList();');
    }
    this.state.endDisplayList();
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

  executeMatrix(cmd0, cmd1, dis) {
    const address = this.state.rdpSegmentAddress(cmd1);
    const push = ((cmd0) & 0x1) === 0;
    const replace = (cmd0 >>> 1) & 0x1;
    const projection = (cmd0 >>> 2) & 0x1;

    let matrix = this.loadMatrix(address, 64);

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

    // The projection matrix has only one entry; PUSH only applies to modelview.
    if (push && !projection) {
      stack.push(matrix);
    } else {
      stack[stack.length - 1] = matrix;
    }
  }

  readTexRectParams(dis) {
    const state = this.state;
    const pc = state.pc;
    // Triple Play 2000 can end a list between RDPHalf1 and RDPHalf2.
    // Do not consume EndDL (or a branch) as rectangle data and run off the list.
    const end = state.pcEnd || this.ramDV.byteLength;
    if (!pc || pc + 16 > end || pc + 16 > this.ramDV.byteLength ||
        (this.ramDV.getUint32(pc) >>> 24) !== G_RDPHALF_1 ||
        (this.ramDV.getUint32(pc + 8) >>> 24) !== G_RDPHALF_2) {
      const message = 'Incomplete GBI2 texture rectangle: expected RDPHalf1 and RDPHalf2';
      this.warn(message);
      if (dis) dis.text(message);
      return null;
    }
    return super.readTexRectParams();
  }

  executeVertex(cmd0, cmd1, dis) {
    const vend = ((cmd0) & 0xff) >> 1;
    const n = (cmd0 >>> 12) & 0xff;
    const v0 = vend - n;
    const address = this.state.rdpSegmentAddress(cmd1);

    if (dis) {
      dis.text(`gsSPVertex(${toString32(address)}, ${v0}, ${n});`);
    }

    this.loadVertices(v0, n, address, dis);
  }

  executeBranchZ(cmd0, cmd1, dis) {
    this.warnUnimplemented('BranchZ')

    if (dis) {
      dis.text(`gsSPBranchZ(/* TODO */);`);
    }
  }

  executeLine3D(cmd0, cmd1, dis) {
    this.warnUnimplemented('Line3D');

    if (dis) {
      dis.text(`gsSPLine3D(/* TODO */);`);
    }
  }

  executeBgRect1Cyc(cmd0, cmd1, dis) {
    this.warnUnimplemented('BgRect1Cyc');

    if (dis) {
      dis.text(`gsSPBgRect1Cyc(/* TODO */);`);
    }
  }

  executeBgRectCopy(cmd0, cmd1, dis) {
    this.warnUnimplemented('BgRectCopy');

    if (dis) {
      dis.text(`gsSPBgRectCopy(/* TODO */);`);
    }
  }

  executeObjRenderMode(cmd0, cmd1, dis) {
    this.warnUnimplemented('ObjRenderMode');

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
    const verts = this.state.projectedVertices;
    const tb = this.triangleBuffer;
    tb.reset();

    // Process triangles individually when disassembling
    let limit = dis ? 1 : 0;
    let commandsExecuted = this.state.executeBatch(limit, (cmd0, cmd1) => {
      const idx0 = (cmd0 >>> 1) & 0x7f;
      const idx1 = (cmd0 >>> 9) & 0x7f;
      const idx2 = (cmd0 >>> 17) & 0x7f;
      const flag = (cmd1 >>> 24) & 0xff;

      if (dis) {
        dis.text(`gsSP1Triangle(${idx0},${idx1},${idx2}, ${flag});`);
      }

      tb.pushTri(verts[idx0], verts[idx1], verts[idx2]);
      return tb.hasCapacity(1);
    });
    this.state.currentOp += commandsExecuted - 1;
    this.renderer.flushTris(tb);
  }

  executeTri2(cmd0, cmd1, dis) {
    const verts = this.state.projectedVertices;
    const tb = this.triangleBuffer;
    tb.reset();

    // Process triangles individually when disassembling
    let limit = dis ? 1 : 0;
    let commandsExecuted = this.state.executeBatch(limit, (cmd0, cmd1) => {
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
      return tb.hasCapacity(2);
    });
    this.state.currentOp += commandsExecuted - 1;
    this.renderer.flushTris(tb);
  }

  // TODO: this is effectively the same as executeTri2, just different disassembly.
  executeQuad(cmd0, cmd1, dis) {
    const verts = this.state.projectedVertices;
    const tb = this.triangleBuffer;
    tb.reset();

    // Process triangles individually when disassembling
    let limit = dis ? 1 : 0;
    let commandsExecuted = this.state.executeBatch(limit, (cmd0, cmd1) => {
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
      return tb.hasCapacity(2);
    });
    this.state.currentOp += commandsExecuted - 1;
    this.renderer.flushTris(tb);
  }

  executeModifyVtx(cmd0, cmd1, dis) {
    const vtx = (cmd0 >>> 1) & 0x7fff;
    const offset = (cmd0 >>> 16) & 0xff;
    const value = cmd1;

    if (dis) {
      dis.text(`gsSPModifyVertex(${vtx},${gbi.ModifyVtx.nameOf(offset)},${toString32(value)});`);
    }

    // Cures crash after swinging in Mario Golf
    if (vtx >= this.state.projectedVertices.length) {
      this.warn('crazy vertex index', vtx);
      return;
    }

    const vertex = this.state.projectedVertices[vtx];

    switch (offset) {
      case gbi.ModifyVtx.G_MWO_POINT_RGBA:
        this.warnUnimplemented('modifyVtx RGBA');
        break;

      case gbi.ModifyVtx.G_MWO_POINT_ST:
        {
          // u/v are signed
          const u = (value >> 16);
          const v = ((value & 0xffff) << 16) >> 16;
          vertex.set = true;
          vertex.u = u * this.state.texture.scaleS / 32.0;
          vertex.v = v * this.state.texture.scaleT / 32.0;
        }
        break;

      case gbi.ModifyVtx.G_MWO_POINT_XYSCREEN:
        this.warnUnimplemented('modifyVtx XYSCREEN');
        break;

      case gbi.ModifyVtx.G_MWO_POINT_ZSCREEN:
        this.warnUnimplemented('modifyVtx ZSCREEN');
        break;

      default:
        this.warnUnimplemented('modifyVtx');
        break;
    }
  }

  executeTexture(cmd0, cmd1, dis) {
    const xparam = (cmd0 >>> 16) & 0xff;
    const level = (cmd0 >>> 11) & 0x3;
    const tileIdx = (cmd0 >>> 8) & 0x7;
    const on = (cmd0 >>> 1) & 0x01; // NB: uses bit 1
    const s = this.calcTextureScale(((cmd1 >>> 16) & 0xffff));
    const t = this.calcTextureScale(((cmd1 >>> 0) & 0xffff));

    if (dis) {
      const sText = s.toString();
      const tText = t.toString();
      const tt = gbi.getTileText(tileIdx);

      if (xparam !== 0) {
        dis.text(`gsSPTextureL(${sText}, ${tText}, ${level}, ${xparam}, ${tt}, ${on});`);
      } else {
        dis.text(`gsSPTexture(${sText}, ${tText}, ${level}, ${tt}, ${on});`);
      }
    }

    this.state.setTexture(s, t, level, tileIdx);
    if (on) {
      this.state.geometryModeBits |= gbi.GeometryModeGBI2.G_TEXTURE_ENABLE;
    } else {
      this.state.geometryModeBits &= ~gbi.GeometryModeGBI2.G_TEXTURE_ENABLE;
    }
    this.state.updateGeometryModeFromBits(gbi.GeometryModeGBI2);
  }

  executeGeometryMode(cmd0, cmd1, dis) {
    const arg0 = cmd0 & 0x00ffffff;
    const arg1 = cmd1;

    if (dis) {
      const clr = gbi.getGeometryModeFlagsText(gbi.GeometryModeGBI2, ~arg0)
      const set = gbi.getGeometryModeFlagsText(gbi.GeometryModeGBI2, arg1);
      dis.text(`gsSPGeometryMode(~(${clr}),${set});`);
    }

    // Texture enablement is controlled via gsSPTexture, so ignore this.
    this.state.geometryModeBits &= (arg0 | gbi.GeometryModeGBI2.G_TEXTURE_ENABLE);
    this.state.geometryModeBits |= (arg1 & ~gbi.GeometryModeGBI2.G_TEXTURE_ENABLE);

    this.state.updateGeometryModeFromBits(gbi.GeometryModeGBI2);
  }

  executePopMatrix(cmd0, cmd1, dis) {
    // F3DEX2 encodes a byte count, with no projection/modelview selector.
    const count = cmd1 >>> 6;

    if (dis) {
      dis.text(`gsSPPopMatrixN(G_MTX_MODELVIEW, ${count});`);
    }

    // Clamp to the base matrix, as the microcode clamps its saved-stack pointer.
    // Keeping that matrix preserves the transform, including for excess pops.
    const stack = this.state.modelview;
    stack.length = Math.max(1, stack.length - count);
  }

  executeMoveWord(cmd0, cmd1, dis) {
    const type = (cmd0 >>> 16) & 0xff;
    const offset = (cmd0) & 0xffff;
    const value = cmd1;

    let text = '';

    switch (type) {
      case gbi.MoveWord.G_MW_MATRIX:
        this.warnUnimplemented('MoveWord Matrix');
        break;
      case gbi.MoveWord.G_MW_NUMLIGHT:
        {
          let numLights = Math.floor(value / 24);
          if (dis) {
            text = `gsSPNumLights(${gbi.NumLights.nameOf(numLights)});`;
          }
          this.state.numLights = numLights;
        }
        break;
      case gbi.MoveWord.G_MW_CLIP:
        if (dis) {
          text = `gSPClipRatio(${gbi.MoveWordClip.nameOf(offset)}, ${gbi.FrustRatio.nameOf(value)});`;
        }
        // Ignored - we just let the GPU handle clipping/scissoring.
        break;
      case gbi.MoveWord.G_MW_SEGMENT:
        {
          const segment = (offset >>> 2) & 0xf;
          if (dis) {
            text = `gsSPSegment(${gbi.Segments.nameOf(segment)}, ${toString32(value)});`;
          }
          this.state.segments[segment] = value;
        }
        break;
      case gbi.MoveWord.G_MW_FOG:
        {
          const multiplier = cmd1 >> 16;
          const offset = (cmd1 << 16) >> 16;
          if (dis) {
            // This is provided as min/max but we show the derived multiplier and offset.
            text = `gsSPFogFactor(${multiplier}, ${offset});`;
          }
          this.state.fogParameters.set(multiplier, offset);
        }
        break;
      case gbi.MoveWord.G_MW_LIGHTCOL:
        this.warnUnimplemented('MoveWord LightCol');
        break;
      case gbi.MoveWord.G_MW_POINTS:
        this.warnUnimplemented('MoveWord Points');
        break;
      case gbi.MoveWord.G_MW_PERSPNORM:
        if (dis) {
          text = `gSPPerspNormalize(${value});`;
        }
        // Ignored - this is to improve precision for integer divides but we're using floats.
        break;
      default:
        this.warnUnimplemented('MoveWord Unknown');
        break;
    }

    if (dis) {
      if (!text) {
        text = `gMoveWd(${gbi.MoveWord.nameOf(type)}, ${toString16(offset)}, ${toString32(value)});`;
      }
      dis.text(text);
    }
  }

  executeMoveMem(cmd0, cmd1, dis) {
    const address = this.state.rdpSegmentAddress(cmd1);
    const length = ((cmd0 >>> 16) & 0xff) << 1;
    const offset = ((cmd0 >>> 8) & 0xff) << 3;
    const type = cmd0 & 0xfe;

    let text;
    if (dis) {
      text = `gsDma1p(G_MOVEMEM, ${toString32(address)}, ${length}, ${offset}, ${gbi.MoveMemGBI2.nameOf(type)});`;
    }

    switch (type) {
      case gbi.MoveMemGBI2.G_GBI2_MV_VIEWPORT:
        if (dis) { text = `gsSPViewport(${toString32(address)});`; }
        this.loadViewport(address);
        break;
      case gbi.MoveMemGBI2.G_GBI2_MV_LIGHT:
        {
          if (offset == gbi.MoveMemGBI2.G_GBI2_MVO_LOOKATX) {
            if (dis) { text = `gSPLookAtX(${toString32(address)});`; }
            // TODO
          } else if (offset == gbi.MoveMemGBI2.G_GBI2_MVO_LOOKATY) {
            if (dis) { text = `gSPLookAtY(${toString32(address)});`; }
            // TODO
          } else if (offset >= gbi.MoveMemGBI2.G_GBI2_MVO_L0 && offset <= gbi.MoveMemGBI2.G_GBI2_MVO_L7) {
            let lightIdx = ((offset - gbi.MoveMemGBI2.G_GBI2_MVO_L0) / 24) >>> 0;
            if (dis) { text = `gsSPLight(${toString32(address)}, ${lightIdx})`; }
            this.loadLight(lightIdx, address);
            if (length != 16) {
              console.log(`unexpected gsSPLight length ${length}. Is this setting multiple lights?`);
            }
          } else {
            if (dis) { text += ` // (unknown offset ${toString16(offset)})`; }
          }
        }
        break;
      case gbi.MoveMemGBI2.G_GBI2_MV_POINT:
        this.warnUnimplemented('MoveMem G_GBI2_MV_POINT');
        break;
      case gbi.MoveMemGBI2.G_GBI2_MV_MATRIX:
        this.warnUnimplemented('MoveMem G_GBI2_MV_MATRIX');
        break;

      default:
        this.warnUnimplemented(`MoveMem ${type.toString(16)}`);
    }

    if (dis) {
      dis.text(text);
      this.previewMoveMem(type, length, address, dis);
    }
  }

  previewMoveMem(type, length, address, dis) {
    let tip = '';
    for (let i = 0; i < length; i += 4) {
      tip += toHex(this.ramDV.getUint32(address + i), 32) + ' ';
    }
    tip += '<br>';

    switch (type) {
      case gbi.MoveMemGBI2.G_GBI2_MV_VIEWPORT:
        tip += this.previewViewport(address);
        break;
      case gbi.MoveMemGBI2.G_GBI2_MV_LIGHT:
        tip += this.previewLight(address);
        break;
    }

    dis.tip(tip);
  }
}

export class GBI2Conker extends GBI2 {
  constructor(state, ramDV) {
    super(state, ramDV);
    this.vertexStride = 2;
  }

  // TODO: executeVertex, executeTri4, executeMoveWord, executeMoveMem.
}
