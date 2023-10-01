import { toString32 } from "../format.js";
import { Matrix4x4 } from "../graphics/Matrix4x4.js";
import { Vector3 } from "../graphics/Vector3.js";
import { makeColorTextABGR } from "./disassemble.js";
import * as gbi from './gbi.js';
import { GBI0 } from "./gbi0.js";

export class GBI0DKR extends GBI0 {
  constructor(state, ramDV) {
    super(state, ramDV);
    this.vertexStride = 10;

    // DKR maintains an array of worldview-projection matrices, indexed using matrixIndex.
    this.matrixAddress = 0;
    this.matrixIndex = 0;
    this.matrixArray = [
      Matrix4x4.identity(),
      Matrix4x4.identity(),
      Matrix4x4.identity(),
      Matrix4x4.identity(),
    ];

    // Vertices are DMA'ed in from memory rather than being baked into the displaylist.
    // vertexOffset allows vertices to be streamed through a buffer.
    this.vertexAddress = 0;
    this.vertexOffset = 0;

    // Billboard mode projects vertices differently. It uses vertex 0 as the
    // center for the billboard and treats the vertex position as a normal.
    this.billboardMode = false;

    this.dkrCommands = new Map([
      [0x05, this.executeTriDMA.bind(this)],
      [0x07, this.executeDisplayListLen.bind(this)],
      [0xbf, this.executeSetAddresses.bind(this)],
    ]);
  }

  getHandler(command) {
    const fn = this.dkrCommands.get(command);
    if (fn) {
      return fn;
    }
    return super.getHandler(command);
  }

  executeDisplayListLen(cmd0, cmd1, dis) {
    const limit = (cmd0 >>> 16) & 0xff;
    const address = this.state.rdpSegmentAddress(cmd1);
    if (dis) {
      dis.text(`gsSPDisplayListLen(<span class="dl-branch">${toString32(address)}</span>, ${limit});`);
    }
    this.state.pushDisplayList(address, limit);
  }

  executeSetAddresses(cmd0, cmd1, dis) {
    this.matrixAddress = this.state.rdpSegmentAddress(cmd0);
    this.vertexAddress = this.state.rdpSegmentAddress(cmd1);
    this.vertexOffset = 0;
    if (dis) {
      dis.text(`gsSPSetAddress(${toString32(this.matrixAddress)}, ${toString32(this.vertexAddress)};`);
    }
  }

  executeMoveWord(cmd0, cmd1, dis) {
    const type = (cmd0) & 0xff;

    // DKR uses a couple of the MoveWord types in a different way.
    if (type == 0x02) {
      this.billboardMode = (cmd1 & 0x1) != 0;
      if (dis) {
        dis.text(`gSetBillboardMode(${this.billboardMode});`);
      }
    } else if (type == 0x0a) {
      this.matrixIndex = (cmd1 >> 6) & 0x3;
      if (dis) {
        dis.text(`gSetMatrixIndex(${this.matrixIndex});`);
      }
    } else {
      super.executeMoveWord(cmd0, cmd1, dis);
    }
  }

  executeTexture(cmd0, cmd1, dis) {
    // TODO: the only difference between this and the base implementation is that
    // texturing is hard-coded to always be on. Maybe it's just the initial default
    // that's different?
    const xparam = (cmd0 >>> 16) & 0xff;
    const level = (cmd0 >>> 11) & 0x3;
    const tileIdx = (cmd0 >>> 8) & 0x7;
    //const on = (cmd0 >>> 0) & 0xff;
    const on = true;
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
    const address = this.matrixAddress + cmd1;
    const index = (cmd0 >> 22) & 0x3;
    const length = (cmd0) & 0xFFFF;
    const matrix = this.loadMatrix(address, length);

    if (dis) {
      dis.text(`gsSPMatrix(${toString32(address)}, ${index});`);
      dis.tip(this.previewMatrix(matrix));
    }
    this.matrixArray[index] = matrix;
    this.matrixIndex = index;
  }

  executeVertex(cmd0, cmd1, dis) {
    const address = this.vertexAddress + cmd1;
    const numVerts = ((cmd0 >>> 19) & 0x1f) + 1;
    const flag = (cmd0 & 0x00010000);
    const v0Base = (cmd0 >>> 9) & 0x1f;

    // In billboard mode the flag selects between index 0 or index 1. Index 0 is used for the billboard center.
    // In normal operation it seems to select between appending to the vert buffer or starting from 0.
    if (this.billboardMode) {
      this.vertexOffset = flag ? 1 : 0;
    } else if (!flag) {
      this.vertexOffset = 0;
    }
    const v0 = this.vertexOffset + v0Base;

    if (dis) {
      dis.text(`gsSPVertex(${toString32(address)}, ${v0}, ${numVerts});`);
    }

    this.loadVertices(v0, numVerts, address, dis);
    this.vertexOffset += numVerts;
  }

  loadVertices(v0, n, address, dis) {
    if (v0 + n >= this.state.projectedVertices.length) {
      this.warn('Too many verts');
      return;
    }

    const vtxStride = 10;
    const dv = new DataView(this.ramDV.buffer, address);
    let wvp = this.matrixArray[this.matrixIndex];
    const viTransform = this.renderer.nativeTransform.viTransform;
    const vpTransform = this.state.viewport.transform;
    const posTemp = new Vector3();

    if (this.billboardMode) {
      wvp = wvp.copy();
      const centerPos = this.state.projectedVertices[0].pos;
      // TODO: construct a translation matrix and multiply.
      wvp.elems[3] += centerPos.x;
      wvp.elems[7] += centerPos.y;
      wvp.elems[11] += centerPos.z;
      wvp.elems[15] += centerPos.w;
    }
  
    let tip = '';
    if (dis) {
      const cols = ['#', 'x', 'y', 'z', 'rgba'];
      tip += '<table class="vertex-table">';
      tip += `<tr><th>${cols.join('</th><th>')}</th></tr>\n`;
    }

    for (let i = 0, offset = 0; i < n; i++, offset += vtxStride) {
      const vertex = this.state.projectedVertices[v0 + i];

      vertex.set = true;

      posTemp.x = dv.getInt16(offset + 0);
      posTemp.y = dv.getInt16(offset + 2);
      posTemp.z = dv.getInt16(offset + 4);
      // Load as little-endian (ABGR) for convenience.
      vertex.color = dv.getUint32(offset + 6, true);

      // Project.
      this.projectInPlace(vertex, posTemp, wvp, vpTransform, viTransform);

      if (dis) {
        const v = [
          v0 + i,
          posTemp.x, posTemp.y, posTemp.z,
          makeColorTextABGR(dv.getUint32(offset + 6, true)),
        ];
        tip += `<tr><td>${v.join('</td><td>')}</td></tr>\n`;
      }
    }

    if (dis) {
      tip += '</table>';
      dis.tip(tip);
    }
  }

  executeTriDMA(cmd0, cmd1, dis) {
    const count = (cmd0 >>> 4) & 0x1f;
    const address = this.state.rdpSegmentAddress(cmd1);
    const dv = new DataView(this.ramDV.buffer, address);
    const verts = this.state.projectedVertices;
    const tb = this.triangleBuffer;
    tb.reset();

    if (dis) {
      dis.text(`gsSPTriDMA(${toString32(address)}, ${count});`);
    }

    let tip = '';

    if (count > tb.maxTris) {
      this.warn(`Too many triangles for buffer: ${count} > ${tb.maxTris}`);
    }

    const triStride = 16;
    for (let i = 0; i < count && tb.hasCapacity(1); ++i) {
      const triBase = i * triStride;

      const flag = dv.getUint8(triBase + 0);
      const idx0 = dv.getUint8(triBase + 1);
      const idx1 = dv.getUint8(triBase + 2);
      const idx2 = dv.getUint8(triBase + 3);

      const s0 = dv.getInt16(triBase + 4) / 32.0;
      const t0 = dv.getInt16(triBase + 6) / 32.0;
      const s1 = dv.getInt16(triBase + 8) / 32.0;
      const t1 = dv.getInt16(triBase + 10) / 32.0;
      const s2 = dv.getInt16(triBase + 12) / 32.0;
      const t2 = dv.getInt16(triBase + 14) / 32.0;
      tb.pushTriWithUV(verts[idx0], verts[idx1], verts[idx2], s0, t0, s1, t1, s2, t2);

      if (dis) {
        tip += `${i}: ${flag}, v${idx0} (${s0}, ${t0}), v${idx1} (${s1}, ${t1}), v${idx2} (${s2}, ${t2})\n`;
      }

      // TODO:
      // gRenderer.SetCullMode((flag & 0x40) == 0, true);
    }
    this.renderer.flushTris(tb);

    // Reset the vertex offset.
    this.vertexOffset = 0;

    if (dis) {
      dis.tip(tip);
    }
  }
}