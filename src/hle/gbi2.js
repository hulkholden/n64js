import { toHex, toString16, toString32 } from "../format.js";
import * as disassemble from './disassemble.js';
import * as gbi from './gbi.js';
import { GBIMicrocode } from "./gbi_microcode.js";

export class GBI2 extends GBIMicrocode {
  constructor(state, ramDV) {
    super(state, ramDV);
    this.vertexStride = 2;

    this.gbi2Commands = new Map([
      [0x00, this.executeNoop.bind(this)],
      [0x01, this.executeVertex.bind(this)],
      [0x02, this.executeModifyVtx.bind(this)],
      [0x03, this.executeCullDL.bind(this)],
      [0x04, this.executeBranchZ.bind(this)],
      [0x05, this.executeTri1.bind(this)],
      [0x06, this.executeTri2.bind(this)],
      [0x07, this.executeQuad.bind(this)],
      [0x08, this.executeLine3D.bind(this)],
      [0x09, this.executeBgRect1Cyc.bind(this)],
      [0x0a, this.executeBgRectCopy.bind(this)],
      [0x0b, this.executeObjRenderMode.bind(this)],

      // // [0xd3, executeGBI2_Special1.bind(this)],
      // // [0xd4, executeGBI2_Special2.bind(this)],
      // // [0xd5, executeGBI2_Special3.bind(this)],
      [0xd6, this.executeDmaIo.bind(this)],
      [0xd7, this.executeTexture.bind(this)],
      [0xd8, this.executePopMatrix.bind(this)],
      [0xd9, this.executeGeometryMode.bind(this)],
      [0xda, this.executeMatrix.bind(this)],
      [0xdb, this.executeMoveWord.bind(this)],
      [0xdc, this.executeMoveMem.bind(this)],
      [0xdd, this.executeLoadUcode.bind(this)],
      [0xde, this.executeDL.bind(this)],
      [0xdf, this.executeEndDL.bind(this)],

      [0xe0, this.executeSpNoop.bind(this)],
      [0xe1, this.executeRDPHalf1.bind(this)],
      [0xe2, this.executeSetOtherModeL.bind(this)],
      [0xe3, this.executeSetOtherModeH.bind(this)],

      [0xf1, this.executeRDPHalf2.bind(this)],
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
    this.debugController.currentOp += commandsExecuted - 1;
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
    this.debugController.currentOp += commandsExecuted - 1;
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
    this.debugController.currentOp += commandsExecuted - 1;
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
    // FIXME: not sure what bit this is
    //const projection =  ??;
    const projection = 0;

    if (dis) {
      const t = projection ? 'G_MTX_PROJECTION' : 'G_MTX_MODELVIEW';
      dis.text(`gsSPPopMatrix(${t});`);
    }

    const stack = projection ? this.state.projection : this.state.modelview;
    if (stack.length > 0) {
      stack.pop();
    }
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
          const offset = cmd1 & 0xffff;
          if (dis) {
            // This is provided as min/max but we show the derived multiplier and offset.
            text = `gSPFogPosition(${multiplier}, ${offset});`;
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
