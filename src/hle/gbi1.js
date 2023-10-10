import { toHex, toString16, toString32 } from "../format.js";
import * as disassemble from './disassemble.js';
import * as gbi from './gbi.js';
import { GBIMicrocode } from "./gbi_microcode.js";

let executeLine3D_Warned = false;

export class GBI1 extends GBIMicrocode {
  constructor(state, ramDV) {
    super(state, ramDV);
    this.vertexStride = 2;

    this.gbi1Commands = new Map([
      [0x00, this.executeSpNoop.bind(this)],
      [0x01, this.executeMatrix.bind(this)],
      [0x03, this.executeMoveMem.bind(this)],
      [0x04, this.executeVertex.bind(this)],
      [0x06, this.executeDL.bind(this)],
      // DLParser_GBI1_Reserved
      [0x09, this.executeSprite2DBase.bind(this)],

      [0xaf, this.executeLoadUcode.bind(this)],
      [0xb0, this.executeBranchZ.bind(this)],
      [0xb1, this.executeTri2.bind(this)],
      [0xb2, this.executeModifyVertex.bind(this)],
      [0xb3, this.executeRDPHalf2.bind(this)],
      [0xb4, this.executeRDPHalf1.bind(this)],
      [0xb5, this.executeLine3D.bind(this)],
      [0xb6, this.executeClearGeometryMode.bind(this)],
      [0xb7, this.executeSetGeometryMode.bind(this)],
      [0xb8, this.executeEndDL.bind(this)],
      [0xb9, this.executeSetOtherModeL.bind(this)],
      [0xba, this.executeSetOtherModeH.bind(this)],
      [0xbb, this.executeTexture.bind(this)],
      [0xbc, this.executeMoveWord.bind(this)],
      [0xbd, this.executePopMatrix.bind(this)],
      [0xbe, this.executeCullDL.bind(this)],
      [0xbf, this.executeTri1.bind(this)],
      [0xc0, this.executeNoop.bind(this)],
    ]);
  }

  getHandler(command) {
    const fn = this.gbi1Commands.get(command);
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

  executeBranchZ(cmd0, cmd1, dis) {
    const address = this.state.rdpSegmentAddress(this.state.rdpHalf1Cmd1);

    // Examples: AeroGauge.
    this.warnUnimplemented('BranchLessZ')
    if (dis) {
      dis.text(`gsSPBranchLessZ(/* TODO */);`);
    }

    // FIXME
    // Just branch all the time for now
    //if (vtxDepth(cmd.vtx) <= cmd.branchzvalue)
    this.state.branchDisplayList(address);
  }

  executeClearGeometryMode(cmd0, cmd1, dis) {
    if (dis) {
      dis.text(`gsSPClearGeometryMode(${gbi.getGeometryModeFlagsText(gbi.GeometryModeGBI1, cmd1)});`);
    }
    this.state.geometryModeBits &= ~cmd1;
    this.state.updateGeometryModeFromBits(gbi.GeometryModeGBI1);
  }

  executeSetGeometryMode(cmd0, cmd1, dis) {
    if (dis) {
      dis.text(`gsSPSetGeometryMode(${gbi.getGeometryModeFlagsText(gbi.GeometryModeGBI1, cmd1)});`);
    }
    this.state.geometryModeBits |= cmd1;
    this.state.updateGeometryModeFromBits(gbi.GeometryModeGBI1);
  }

  executeSetOtherModeL(cmd0, cmd1, dis) {
    const shift = (cmd0 >>> 8) & 0xff;
    const len = (cmd0 >>> 0) & 0xff;
    const data = cmd1;
    const mask = (((1 << len) - 1) << shift) >>> 0;
    if (dis) {
      disassemble.SetOtherModeL(dis, mask, data);
    }
    this.state.rdpOtherModeL = (this.state.rdpOtherModeL & ~mask) | data;
  }

  executeSetOtherModeH(cmd0, cmd1, dis) {
    const shift = (cmd0 >>> 8) & 0xff;
    const len = (cmd0 >>> 0) & 0xff;
    const data = cmd1;
    const mask = (((1 << len) - 1) << shift) >>> 0;
    if (dis) {
      disassemble.SetOtherModeH(dis, mask, len, shift, data);
    }
    this.state.rdpOtherModeH = (this.state.rdpOtherModeH & ~mask) | data;
  }

  executeTexture(cmd0, cmd1, dis) {
    const xparam = (cmd0 >>> 16) & 0xff;
    const level = (cmd0 >>> 11) & 0x3;
    const tileIdx = (cmd0 >>> 8) & 0x7;
    const on = (cmd0 >>> 0) & 0xff;
    const s = this.calcTextureScale(((cmd1 >>> 16) & 0xffff));
    const t = this.calcTextureScale(((cmd1 >>> 0) & 0xffff));

    if (dis) {
      const sText = s.toString();
      const tText = t.toString();
      const tileText = gbi.getTileText(tileIdx);
      const onText = on ? 'G_ON' : 'G_OFF';

      if (xparam !== 0) {
        dis.text(`gsSPTextureL(${sText}, ${tText}, ${level}, ${xparam}, ${tileText}, ${onText});`);
      } else {
        dis.text(`gsSPTexture(${sText}, ${tText}, ${level}, ${tileText}, ${onText});`);
      }
    }

    this.state.setTexture(s, t, level, tileIdx);
    if (on) {
      this.state.geometryModeBits |= gbi.GeometryModeGBI1.G_TEXTURE_ENABLE;
    } else {
      this.state.geometryModeBits &= ~gbi.GeometryModeGBI1.G_TEXTURE_ENABLE;
    }
    this.state.updateGeometryModeFromBits(gbi.GeometryModeGBI1);
  }

  executeMatrix(cmd0, cmd1, dis) {
    const flags = (cmd0 >>> 16) & 0xff;
    const length = (cmd0 >>> 0) & 0xffff;
    const address = this.state.rdpSegmentAddress(cmd1);

    let matrix = this.loadMatrix(address, length);

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

  executePopMatrix(cmd0, cmd1, dis) {
    const flags = (cmd1 >>> 0) & 0xff;

    if (dis) {
      let t = '';
      t += (flags & gbi.G_MTX_PROJECTION) ? 'G_MTX_PROJECTION' : 'G_MTX_MODELVIEW';
      dis.text(`gsSPPopMatrix(${t});`);
    }

    // FIXME: pop is always modelview?
    if (this.state.modelview.length > 0) {
      this.state.modelview.pop();
    }
  }

  executeVertex(cmd0, cmd1, dis) {
    const v0 = ((cmd0 >>> 16) & 0xff) / this.vertexStride;
    const n = ((cmd0 >>> 10) & 0x3f);
    //const length = (cmd0 >>>  0) & 0x3ff;
    const address = this.state.rdpSegmentAddress(cmd1);

    if (dis) {
      dis.text(`gsSPVertex(${toString32(address)}, ${v0}, ${n});`);
    }

    this.loadVertices(v0, n, address, dis);
  }

  executeModifyVertex(cmd0, cmd1, dis) {
    this.warnUnimplemented('ModifyVertex');
    if (dis) {
      dis.text('gsSPModifyVertex(???);');
    }
  }

  executeSprite2DBase(cmd0, cmd1, dis) {
    this.warnUnimplemented('Sprite2DBase');
    if (dis) {
      dis.text(`gsSPSprite2DBase(/* TODO */);`);
    }
  }

  executeMoveMem(cmd0, cmd1, dis) {
    const type = (cmd0 >>> 16) & 0xff;
    const length = (cmd0 >>> 0) & 0xffff;
    const address = this.state.rdpSegmentAddress(cmd1);

    if (dis) {
      const addressStr = toString32(address);

      const typeStr = gbi.MoveMemGBI1.nameOf(type);
      let text = `gsDma1p(G_MOVEMEM, ${addressStr}, ${length}, ${typeStr});`;

      switch (type) {
        case gbi.MoveMemGBI1.G_MV_VIEWPORT:
          if (length === 16) {
            text = `gsSPViewport(${addressStr});`;
          }
          break;
      }

      dis.text(text);
      this.previewMoveMem(type, length, address, dis);
    }

    switch (type) {
      case gbi.MoveMemGBI1.G_MV_VIEWPORT:
        this.loadViewport(address);
        break;

      case gbi.MoveMemGBI1.G_MV_L0:
      case gbi.MoveMemGBI1.G_MV_L1:
      case gbi.MoveMemGBI1.G_MV_L2:
      case gbi.MoveMemGBI1.G_MV_L3:
      case gbi.MoveMemGBI1.G_MV_L4:
      case gbi.MoveMemGBI1.G_MV_L5:
      case gbi.MoveMemGBI1.G_MV_L6:
      case gbi.MoveMemGBI1.G_MV_L7:
        {
          const lightIdx = (type - gbi.MoveMemGBI1.G_MV_L0) / 2;
          this.loadLight(lightIdx, address);
        }
        break;
    }
  }

  previewMoveMem(type, length, address, dis) {
    let tip = '';

    for (let i = 0; i < length; ++i) {
      tip += toHex(this.ramDV.getUint8(address + i), 8) + ' ';
    }
    tip += '<br>';

    switch (type) {
      case gbi.MoveMemGBI1.G_MV_VIEWPORT:
        tip += this.previewViewport(address);
        break;

      case gbi.MoveMemGBI1.G_MV_L0:
      case gbi.MoveMemGBI1.G_MV_L1:
      case gbi.MoveMemGBI1.G_MV_L2:
      case gbi.MoveMemGBI1.G_MV_L3:
      case gbi.MoveMemGBI1.G_MV_L4:
      case gbi.MoveMemGBI1.G_MV_L5:
      case gbi.MoveMemGBI1.G_MV_L6:
      case gbi.MoveMemGBI1.G_MV_L7:
        tip += this.previewLight(address);
        break;
    }

    dis.tip(tip);
  }

  executeMoveWord(cmd0, cmd1, dis) {
    const type = (cmd0) & 0xff;
    const offset = (cmd0 >>> 8) & 0xffff;
    const value = cmd1;

    let text = '';

    switch (type) {
      case gbi.MoveWord.G_MW_MATRIX:
        this.warnUnimplemented('MoveWord Matrix');
        break;
      case gbi.MoveWord.G_MW_NUMLIGHT:
        {
          let numLights = ((value - 0x80000000) >>> 5) - 1;
          if (dis) {
            if (offset === gbi.G_MWO_NUMLIGHT) {
              text = `gsSPNumLights(${gbi.NumLights.nameOf(numLights)});`;
            }
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

  executeTri1(cmd0, cmd1, dis) {
    const stride = this.vertexStride;
    const verts = this.state.projectedVertices;
    const tb = this.triangleBuffer;
    tb.reset();

    // Process triangles individually when disassembling
    let limit = dis ? 1 : 0;
    let commandsExecuted = this.state.executeBatch(limit, (cmd0, cmd1) => {
      const flag = (cmd1 >>> 24) & 0xff;
      const idx0 = ((cmd1 >>> 16) & 0xff) / stride;
      const idx1 = ((cmd1 >>> 8) & 0xff) / stride;
      const idx2 = ((cmd1 >>> 0) & 0xff) / stride;

      if (dis) {
        dis.text(`gsSP1Triangle(${idx0}, ${idx1}, ${idx2}, ${flag});`);
      }

      tb.pushTri(verts[idx0], verts[idx1], verts[idx2]);
      return tb.hasCapacity(1);
    });

    this.debugController.currentOp += commandsExecuted - 1;
    this.renderer.flushTris(tb);
  }

  executeTri2(cmd0, cmd1, dis) {
    const stride = this.vertexStride;
    const verts = this.state.projectedVertices;
    const tb = this.triangleBuffer;
    tb.reset();

    // Process triangles individually when disassembling
    let limit = dis ? 1 : 0;
    let commandsExecuted = this.state.executeBatch(limit, (cmd0, cmd1) => {
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
      return tb.hasCapacity(2);
    });
    this.debugController.currentOp += commandsExecuted - 1;
    this.renderer.flushTris(tb);
  }

  executeLine3D(cmd0, cmd1, dis) {
    const stride = this.vertexStride;
    const verts = this.state.projectedVertices;
    const tb = this.triangleBuffer;
    tb.reset();

    // Process triangles individually when disassembling
    let limit = dis ? 1 : 0;
    let commandsExecuted = this.state.executeBatch(limit, (cmd0, cmd1) => {
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
      return tb.hasCapacity(2);
    });
    this.debugController.currentOp += commandsExecuted - 1;
    this.renderer.flushTris(tb);
  }
}

export class GBI1LL extends GBI1 {
  constructor(state, ramDV) {
    super(state, ramDV);
    this.vertexStride = 2;
  }
}

