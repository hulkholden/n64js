/*global n64js*/

import { toString8, toString32 } from '../format.js';
import { Matrix4x4 } from '../graphics/Matrix4x4.js';
import { Transform2D } from '../graphics/Transform2D.js';
import { Vector2 } from '../graphics/Vector2.js';
import { Vector3 } from '../graphics/Vector3.js';
import * as logger from '../logger.js';
import { makeColorTextRGBA } from './disassemble.js';
import * as gbi from './gbi.js';
import { VertexStrides } from './microcodes.js';
import * as shaders from './shaders.js';
import { TriangleBuffer } from "./triangle_buffer.js";

// Clip codes.
const X_NEG = 0x01; //left
const Y_NEG = 0x02; //bottom
const Z_NEG = 0x04; //far
const X_POS = 0x08; //right
const Y_POS = 0x10; //top
const Z_POS = 0x20; //near

// Map to keep track of which render targets we've seen.
const kDebugColorImages = true;
let colorImages = new Map();

// Map to keep track of which unimplemented ops we've already warned about.
const loggedUnimplemented = new Map();

export class GBIMicrocode {
  constructor(ucode, state, ramDV) {
    this.state = state;
    this.ramDV = ramDV;
    this.vertexStride = VertexStrides[ucode];

    this.triangleBuffer = new TriangleBuffer(64);

    this.gbiCommonCommands = new Map([
      [0xe4, this.executeTexRect],
      [0xe5, this.executeTexRectFlip],
      [0xe6, this.executeRDPLoadSync],
      [0xe7, this.executeRDPPipeSync],
      [0xe8, this.executeRDPTileSync],
      [0xe9, this.executeRDPFullSync],
      [0xea, this.executeSetKeyGB],
      [0xeb, this.executeSetKeyR],
      [0xec, this.executeSetConvert],
      [0xed, this.executeSetScissor],
      [0xee, this.executeSetPrimDepth],
      [0xef, this.executeSetRDPOtherMode],
      [0xf0, this.executeLoadTLut],
      [0xf2, this.executeSetTileSize],
      [0xf3, this.executeLoadBlock],
      [0xf4, this.executeLoadTile],
      [0xf5, this.executeSetTile],
      [0xf6, this.executeFillRect],
      [0xf7, this.executeSetFillColor],
      [0xf8, this.executeSetFogColor],
      [0xf9, this.executeSetBlendColor],
      [0xfa, this.executeSetPrimColor],
      [0xfb, this.executeSetEnvColor],
      [0xfc, this.executeSetCombine],
      [0xfd, this.executeSetTImg],
      [0xfe, this.executeSetZImg],
      [0xff, this.executeSetCImg],
    ]);
  }

  buildCommandTable() {
    const table = [];
    for (let i = 0; i < 256; ++i) {
      let fn = this.getHandler(i);
      if (!fn) {
        fn = this.executeUnknown;
      }
      table.push(fn.bind(this));
    }
    return table;
  }

  getHandler(command) {
    const fn = this.gbiCommonCommands.get(command);
    if (fn) {
      return fn;
    }
    return null;
  }

  logUnimplemented(name) {
    if (loggedUnimplemented.get(name)) {
      return;
    }
    loggedUnimplemented.set(name, true);
    n64js.warn(`${name} unimplemented`);
  }

  executeUnknown(cmd0, cmd1) {
    this.hleHalt(`Unknown display list op ${toString8(cmd0 >>> 24)}`);
    this.state.pc = 0;
  }

  haltUnimplemented(cmd0, cmd1) {
    this.hleHalt(`Unimplemented display list op ${toString8(cmd0 >>> 24)}`);
  }

  loadMatrix(address) {
    const recip = 1.0 / 65536.0;
    const dv = new DataView(this.ramDV.buffer, address);

    const elements = new Float32Array(16);
    for (let i = 0; i < 4; ++i) {
      elements[4 * 0 + i] = (dv.getInt16(i * 8 + 0) << 16 | dv.getUint16(i * 8 + 0 + 32)) * recip;
      elements[4 * 1 + i] = (dv.getInt16(i * 8 + 2) << 16 | dv.getUint16(i * 8 + 2 + 32)) * recip;
      elements[4 * 2 + i] = (dv.getInt16(i * 8 + 4) << 16 | dv.getUint16(i * 8 + 4 + 32)) * recip;
      elements[4 * 3 + i] = (dv.getInt16(i * 8 + 6) << 16 | dv.getUint16(i * 8 + 6 + 32)) * recip;
    }

    return new Matrix4x4(elements);
  }

  previewMatrix(matrix) {
    const m = matrix.elems;
    const a = [m[0], m[1], m[2], m[3]];
    const b = [m[4], m[5], m[6], m[7]];
    const c = [m[8], m[9], m[10], m[11]];
    const d = [m[12], m[13], m[14], m[15]];
    return `<div><table class="matrix-table">
      <tr><td>${a.join('</td><td>')}</td></tr>
      <tr><td>${b.join('</td><td>')}</td></tr>
      <tr><td>${c.join('</td><td>')}</td></tr>
      <tr><td>${d.join('</td><td>')}</td></tr>
    </table></div>`;
  }

  loadViewport(address) {
    const scale = new Vector2(
      this.ramDV.getInt16(address + 0) / 4.0,
      this.ramDV.getInt16(address + 2) / 4.0,
    );
    const trans = new Vector2(
      this.ramDV.getInt16(address + 8) / 4.0,
      this.ramDV.getInt16(address + 10) / 4.0,
    );

    //logger.log(`Viewport: scale=${scale.x},${scale.y} trans=${trans.x},${trans.y}` );
    this.state.viewport.scale = scale;
    this.state.viewport.trans = trans;

    // N64 provides the center point and distance to each edge,
    // but we want the width/height and translate to bottom left.
    const t2d = new Transform2D(scale.scale(2), trans.sub(scale));
    this.renderer.nativeTransform.setN64Viewport(t2d);
  }

  previewViewport(address) {
    let result = '';
    result += `scale = (${this.ramDV.getInt16(address + 0) / 4.0}, ${this.ramDV.getInt16(address + 2) / 4.0}) `;
    result += `trans = (${this.ramDV.getInt16(address + 8) / 4.0}, ${this.ramDV.getInt16(address + 10) / 4.0}) `;
    return result;
  }

  loadLight(lightIdx, address) {
    if (lightIdx >= this.state.lights.length) {
      logger.log(`light index ${lightIdx} out of range`);
      return;
    }
    this.state.lights[lightIdx].color = makeRGBAFromRGBA32(this.ramDV.getUint32(address + 0));
    this.state.lights[lightIdx].dir = Vector3.create([
      this.ramDV.getInt8(address + 8),
      this.ramDV.getInt8(address + 9),
      this.ramDV.getInt8(address + 10)
    ]).normaliseInPlace();
  }

  previewLight(address) {
    let result = '';
    result += `color = ${makeColorTextRGBA(this.ramDV.getUint32(address + 0))} `;
    result += `colorCopy = ${makeColorTextRGBA(this.ramDV.getUint32(address + 4))} `;
    const dir = Vector3.create([
      this.ramDV.getInt8(address + 8),
      this.ramDV.getInt8(address + 9),
      this.ramDV.getInt8(address + 10)
    ]).normaliseInPlace();
    result += `norm = (${dir.x}, ${dir.y}, ${dir.z})`;
    return result;
  }

  loadVertices(v0, n, address, dis) {
    const light = this.state.geometryMode.lighting;
    const texgen = this.state.geometryMode.textureGen;
    const texgenlin = this.state.geometryMode.textureGenLinear;
    const dv = new DataView(this.ramDV.buffer, address);

    if (dis) {
      this.previewVertex(v0, n, dv, dis, light);
    }

    if (v0 + n >= 64) { // FIXME or 80 for later GBI
      this.hleHalt('Too many verts');
      this.state.pc = 0;
      return;
    }

    const mvmtx = this.state.modelview[this.state.modelview.length - 1];
    const pmtx = this.state.projection[this.state.projection.length - 1];

    const wvp = pmtx.multiply(mvmtx);

    // Texture coords are provided in 11.5 fixed point format, so divide by 32 here to normalise
    const scaleS = this.state.texture.scaleS / 32.0;
    const scaleT = this.state.texture.scaleT / 32.0;

    const xyz = new Vector3();
    const normal = new Vector3();
    const transformedNormal = new Vector3();

    for (let i = 0; i < n; ++i) {
      const vtxBase = i * 16;
      const vertex = this.state.projectedVertices[v0 + i];

      vertex.set = true;

      xyz.x = dv.getInt16(vtxBase + 0);
      xyz.y = dv.getInt16(vtxBase + 2);
      xyz.z = dv.getInt16(vtxBase + 4);
      //const w = dv.getInt16(vtxBase + 6);
      const u = dv.getInt16(vtxBase + 8);
      const v = dv.getInt16(vtxBase + 10);

      const projected = vertex.pos;
      wvp.transformPoint(xyz, projected);

      //hleHalt(`${x},${y},${z}-&gt;${projected.x},${projected.y},${projected.z}`);

      // let clipFlags = 0;
      //      if (projected[0] < -projected[3]) clipFlags |= X_POS;
      // else if (projected[0] >  projected[3]) clipFlags |= X_NEG;

      //      if (projected[1] < -projected[3]) clipFlags |= Y_POS;
      // else if (projected[1] >  projected[3]) clipFlags |= Y_NEG;

      //      if (projected[2] < -projected[3]) clipFlags |= Z_POS;
      // else if (projected[2] >  projected[3]) clipFlags |= Z_NEG;
      // this.state.projectedVertices.clipFlags = clipFlags;

      if (light) {
        normal.x = dv.getInt8(vtxBase + 12);
        normal.y = dv.getInt8(vtxBase + 13);
        normal.z = dv.getInt8(vtxBase + 14);

        // calculate transformed normal
        mvmtx.transformNormal(normal, transformedNormal);
        transformedNormal.normaliseInPlace();

        vertex.color = this.calculateLighting(transformedNormal);

        if (texgen) {
          // retransform using wvp
          // wvp.transformNormal(normal, transformedNormal);
          // transformedNormal.normaliseInPlace();

          if (texgenlin) {
            vertex.u = 0.5 * (1.0 + transformedNormal.x);
            vertex.v = 0.5 * (1.0 + transformedNormal.y); // 1-y?
          } else {
            vertex.u = Math.acos(transformedNormal.x) / 3.141;
            vertex.v = Math.acos(transformedNormal.y) / 3.141;
          }
        } else {
          vertex.u = u * scaleS;
          vertex.v = v * scaleT;
        }
      } else {
        vertex.u = u * scaleS;
        vertex.v = v * scaleT;

        const r = dv.getUint8(vtxBase + 12);
        const g = dv.getUint8(vtxBase + 13);
        const b = dv.getUint8(vtxBase + 14);
        const a = dv.getUint8(vtxBase + 15);

        vertex.color = (a << 24) | (b << 16) | (g << 8) | r;
      }

      //const flag = dv.getUint16(vtxBase + 6);
      //const tu = dv.getInt16(vtxBase + 8);
      //const tv = dv.getInt16(vtxBase + 10);
      //const rgba = dv.getInt16(vtxBase + 12);    // nx/ny/nz/a
    }
  }

  calculateLighting(normal) {
    const numLights = this.state.numLights;
    let r = this.state.lights[numLights].color.r;
    let g = this.state.lights[numLights].color.g;
    let b = this.state.lights[numLights].color.b;

    for (let l = 0; l < numLights; ++l) {
      const light = this.state.lights[l];
      const d = normal.dot(light.dir);
      if (d > 0.0) {
        r += light.color.r * d;
        g += light.color.g * d;
        b += light.color.b * d;
      }
    }

    r = Math.min(r, 1.0) * 255.0;
    g = Math.min(g, 1.0) * 255.0;
    b = Math.min(b, 1.0) * 255.0;
    const a = 255;

    return (a << 24) | (b << 16) | (g << 8) | r;
  }

  previewVertex(v0, n, dv, dis, light) {
    const cols = ['#', 'x', 'y', 'z', '?', 'u', 'v', light ? 'norm' : 'rgba'];

    let tip = '';
    tip += '<table class="vertex-table">';
    tip += `<tr><th>${cols.join('</th><th>')}</th></tr>\n`;

    for (let i = 0; i < n; ++i) {
      const base = i * 16;
      const normOrCol = light ? `${dv.getInt8(base + 12)},${dv.getInt8(base + 13)},${dv.getInt8(base + 14)}` : makeColorTextRGBA(dv.getUint32(base + 12));

      const v = [
        v0 + i,
        dv.getInt16(base + 0), // x
        dv.getInt16(base + 2), // y
        dv.getInt16(base + 4), // z
        dv.getInt16(base + 6), // ?
        dv.getInt16(base + 8), // u
        dv.getInt16(base + 10), // v
        normOrCol, // norm or rgba
      ];

      tip += `<tr><td>${v.join('</td><td>')}</td></tr>\n`;
    }
    tip += '</table>';
    dis.tip(tip);
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

  executeRDPLoadSync(cmd0, cmd1, dis) {
    if (dis) {
      dis.text('gsDPLoadSync();');
    }
  }

  executeRDPPipeSync(cmd0, cmd1, dis) {
    if (dis) {
      dis.text('gsDPPipeSync();');
    }
  }

  executeRDPTileSync(cmd0, cmd1, dis) {
    if (dis) {
      dis.text('gsDPTileSync();');
    }
  }

  executeRDPFullSync(cmd0, cmd1, dis) {
    if (dis) {
      dis.text('gsDPFullSync();');
    }
  }

  executeSetKeyGB(cmd0, cmd1, dis) {
    if (dis) {
      dis.text('gsDPSetKeyGB(???);');
    }
  }

  executeSetKeyR(cmd0, cmd1, dis) {
    if (dis) {
      dis.text('gsDPSetKeyR(???);');
    }
  }

  executeSetConvert(cmd0, cmd1, dis) {
    if (dis) {
      dis.text('gsDPSetConvert(???);');
    }
  }

  executeSetScissor(cmd0, cmd1, dis) {
    const x0 = ((cmd0 >>> 12) & 0xfff) / 4.0;
    const y0 = ((cmd0 >>> 0) & 0xfff) / 4.0;
    const x1 = ((cmd1 >>> 12) & 0xfff) / 4.0;
    const y1 = ((cmd1 >>> 0) & 0xfff) / 4.0;
    const mode = (cmd1 >>> 24) & 0x2;

    if (dis) {
      dis.text(`gsDPSetScissor(${gbi.ScissorMode.nameOf(mode)}, ${x0}, ${y0}, ${x1}, ${y1});`);
    }

    this.state.scissor.x0 = x0;
    this.state.scissor.y0 = y0;
    this.state.scissor.x1 = x1;
    this.state.scissor.y1 = y1;
    this.state.scissor.mode = mode;

    // FIXME: actually set this
  }

  executeSetRDPOtherMode(cmd0, cmd1, dis) {
    if (dis) {
      dis.text(`gsDPSetOtherMode(${toString32(cmd0)}, ${toString32(cmd1)}); // TODO: fix formatting`);
    }

    this.state.rdpOtherModeH = cmd0;
    this.state.rdpOtherModeL = cmd1;
  }

  executeSetTile(cmd0, cmd1, dis) {
    const format = (cmd0 >>> 21) & 0x7;
    const size = (cmd0 >>> 19) & 0x3;
    //const pad0 = (cmd0 >>> 18) & 0x1;
    const line = (cmd0 >>> 9) & 0x1ff;
    const tmem = (cmd0 >>> 0) & 0x1ff;

    //const pad1 = (cmd1 >>> 27) & 0x1f;
    const tileIdx = (cmd1 >>> 24) & 0x7;
    const palette = (cmd1 >>> 20) & 0xf;

    const cmT = (cmd1 >>> 18) & 0x3;
    const maskT = (cmd1 >>> 14) & 0xf;
    const shiftT = (cmd1 >>> 10) & 0xf;

    const cmS = (cmd1 >>> 8) & 0x3;
    const maskS = (cmd1 >>> 4) & 0xf;
    const shiftS = (cmd1 >>> 0) & 0xf;

    const tile = this.state.tiles[tileIdx];
    tile.set(format, size, line, tmem, palette, cmS, maskS, shiftS, cmT, maskT, shiftT);

    if (dis) {
      const fmtText = gbi.ImageFormat.nameOf(format);
      const sizeText = gbi.ImageSize.nameOf(size);
      const tileText = gbi.getTileText(tileIdx);
      const cmsText = gbi.getClampMirrorWrapText(cmS);
      const cmtText = gbi.getClampMirrorWrapText(cmT);

      dis.text(`gsDPSetTile(${fmtText}, ${sizeText}, ${line}, ${tmem}, ${tileText}, ${palette}, ${cmtText}, ${maskT}, ${shiftT}, ${cmsText}, ${maskS}, ${shiftS});`);
    }
  }

  executeSetTileSize(cmd0, cmd1, dis) {
    const uls = (cmd0 >>> 12) & 0xfff;
    const ult = (cmd0 >>> 0) & 0xfff;
    const tileIdx = (cmd1 >>> 24) & 0x7;
    const lrs = (cmd1 >>> 12) & 0xfff;
    const lrt = (cmd1 >>> 0) & 0xfff;

    const tile = this.state.tiles[tileIdx];
    tile.setSize(uls, ult, lrs, lrt);

    if (dis) {
      const tt = gbi.getTileText(tileIdx);
      dis.text(`gsDPSetTileSize(${tt}, ${tile.left}, ${tile.top}, ${tile.right}, ${tile.bottom});`);
      dis.tip(`size (${tile.width} x ${tile.height}), unmasked (${tile.unmaskedWidth} x ${tile.unmaskedHeight})`);
    }
  }

  executeSetFillColor(cmd0, cmd1, dis) {
    if (dis) {
      // Can be 16 or 32 bit
      dis.text(`gsDPSetFillColor(${dis.rgba8888(cmd1)}); // hi as 5551 = ${dis.rgba5551(cmd1 >>> 16)}, lo as 5551 = ${dis.rgba5551(cmd1 & 0xffff)} `);
    }
    this.state.fillColor = cmd1;
  }

  executeSetFogColor(cmd0, cmd1, dis) {
    if (dis) {
      dis.text(`gsDPSetFogColor(${dis.rgba8888(cmd1)});`);
    }
    this.state.fogColor = cmd1;
  }

  executeSetBlendColor(cmd0, cmd1, dis) {
    if (dis) {
      dis.text(`gsDPSetBlendColor(${dis.rgba8888(cmd1)});`);
    }
    this.state.blendColor = cmd1;
  }

  executeSetPrimColor(cmd0, cmd1, dis) {
    if (dis) {
      const m = (cmd0 >>> 8) & 0xff;
      const l = (cmd0 >>> 0) & 0xff;
      dis.text(`gsDPSetPrimColor(${m}, ${l}, ${dis.rgba8888(cmd1)});`);
    }
    // minlevel, primlevel ignored!
    this.state.primColor = cmd1;
  }

  executeSetPrimDepth(cmd0, cmd1, dis) {
    const z = (cmd1 >>> 16) & 0xffff;
    const dz = (cmd1) & 0xffff;
    if (dis) {
      dis.text(`gsDPSetPrimDepth(${z},${dz});`);
    }

    // FIXME
  }

  executeSetEnvColor(cmd0, cmd1, dis) {
    if (dis) {
      dis.text(`gsDPSetEnvColor(${dis.rgba8888(cmd1)});`);
    }
    this.state.envColor = cmd1;
  }

  executeSetCombine(cmd0, cmd1, dis) {
    if (dis) {
      const mux0 = cmd0 & 0x00ffffff;
      const mux1 = cmd1;
      const decoded = shaders.getCombinerText(mux0, mux1);

      dis.text(`gsDPSetCombine(${toString32(mux0)}, ${toString32(mux1)});\n${decoded}`);
    }

    this.state.combine.hi = cmd0 & 0x00ffffff;
    this.state.combine.lo = cmd1;
  }

  executeSetTImg(cmd0, cmd1, dis) {
    const format = (cmd0 >>> 21) & 0x7;
    const size = (cmd0 >>> 19) & 0x3;
    const width = ((cmd0 >>> 0) & 0xfff) + 1;
    const address = this.state.rdpSegmentAddress(cmd1);

    if (dis) {
      dis.text(`gsDPSetTextureImage(${gbi.ImageFormat.nameOf(format)}, ${gbi.ImageSize.nameOf(size)}, ${width}, ${toString32(address)});`);
    }

    this.state.textureImage.set(format, size, width, address)
  }

  executeSetZImg(cmd0, cmd1, dis) {
    const address = this.state.rdpSegmentAddress(cmd1);

    if (dis) {
      dis.text(`gsDPSetDepthImage(${toString32(address)});`);
    }

    this.state.depthImage.address = address;
  }

  executeSetCImg(cmd0, cmd1, dis) {
    const format = (cmd0 >>> 21) & 0x7;
    const size = (cmd0 >>> 19) & 0x3;
    const width = ((cmd0 >>> 0) & 0xfff) + 1;
    const address = this.state.rdpSegmentAddress(cmd1);

    if (dis) {
      dis.text(`gsDPSetColorImage(${gbi.ImageFormat.nameOf(format)}, ${gbi.ImageSize.nameOf(size)}, ${width}, ${toString32(address)});`);
    }

    this.state.colorImage = {
      format: format,
      size: size,
      width: width,
      address: address
    };

    // TODO: Banjo Tooie and Pokemon Stadium render to multiple buffers in each display list.
    // Need to set these up as separate framebuffers somehow
    if (kDebugColorImages && !colorImages.get(address)) {
      logger.log(`Setting colorImage to ${toString32(address)}, ${width}, size ${gbi.ImageSize.nameOf(size)}, format ${gbi.ImageFormat.nameOf(format)}`);
      colorImages.set(address, true);
    }
  }

  executeLoadBlock(cmd0, cmd1, dis) {
    const tileIdx = (cmd1 >>> 24) & 0x7;
    const lrs = (cmd1 >>> 12) & 0xfff;
    const dxt = (cmd1 >>> 0) & 0xfff;
    const uls = (cmd0 >>> 12) & 0xfff;
    const ult = (cmd0 >>> 0) & 0xfff;

    // Docs reckon these are ignored for all loadBlocks
    if (uls !== 0) { this.hleHalt('Unexpected non-zero uls in load block'); }
    if (ult !== 0) { this.hleHalt('Unexpected non-zero ult in load block'); }

    const tile = this.state.tiles[tileIdx];
    const tileX0 = uls >>> 2;
    const tileY0 = ult >>> 2;

    const ramAddress = this.state.textureImage.calcAddress(tileX0, tileY0);
    const bytes = this.state.textureImage.texelsToBytes(lrs + 1);
    const qwords = (bytes + 7) >>> 3;

    if (dis) {
      const tt = gbi.getTileText(tileIdx);
      dis.text(`gsDPLoadBlock(${tt}, ${uls}, ${ult}, ${lrs}, ${dxt});`);
      dis.tip(`bytes ${bytes}, qwords ${qwords}`);
    }

    this.state.tmem.loadBlock(tile, ramAddress, dxt, qwords);
    this.state.invalidateTileHashes();
  }

  executeLoadTile(cmd0, cmd1, dis) {
    const tileIdx = (cmd1 >>> 24) & 0x7;
    const lrs = (cmd1 >>> 12) & 0xfff;
    const lrt = (cmd1 >>> 0) & 0xfff;
    const uls = (cmd0 >>> 12) & 0xfff;
    const ult = (cmd0 >>> 0) & 0xfff;

    const tile = this.state.tiles[tileIdx];
    const tileX1 = lrs >>> 2;
    const tileY1 = lrt >>> 2;
    const tileX0 = uls >>> 2;
    const tileY0 = ult >>> 2;

    const h = (tileY1 + 1) - tileY0;
    const w = (tileX1 + 1) - tileX0;

    const ramAddress = this.state.textureImage.calcAddress(tileX0, tileY0);
    const ramStride = this.state.textureImage.stride();
    const rowBytes = this.state.textureImage.texelsToBytes(w);

    // loadTile pads rows to 8 bytes.
    const tmemStride = (this.state.textureImage.size == gbi.ImageSize.G_IM_SIZ_32b) ? tile.line << 4 : tile.line << 3;

    // TODO: Limit the load to fetchedQWords?
    // TODO: should be limited to 2048 texels, not 512 qwords.
    // const bytes = h * rowBytes;
    // const reqQWords = (bytes + 7) >>> 3;
    // const fetchedQWords = (reqQWords > 512) ? 512 : reqQWords;

    if (dis) {
      const tt = gbi.getTileText(tileIdx);
      dis.text(`gsDPLoadTile(${tt}, ${uls / 4}, ${ult / 4}, ${lrs / 4}, ${lrt / 4});`);
      dis.tip(`size = (${w} x ${h}), rowBytes ${rowBytes}, ramStride ${ramStride}, tmemStride ${tmemStride}`);
    }

    this.state.tmem.loadTile(tile, ramAddress, h, ramStride, rowBytes, tmemStride);
    this.state.invalidateTileHashes();
  }

  executeLoadTLut(cmd0, cmd1, dis) {
    const tileIdx = (cmd1 >>> 24) & 0x7;
    const count = (cmd1 >>> 14) & 0x3ff;

    // NB, in Daedalus, we interpret this similarly to a loadtile command,
    // but in other places it's defined as a simple count parameter.
    const uls = (cmd0 >>> 12) & 0xfff;
    const ult = (cmd0 >>> 0) & 0xfff;
    const lrs = (cmd1 >>> 12) & 0xfff;
    const lrt = (cmd1 >>> 0) & 0xfff;

    if (dis) {
      const tt = gbi.getTileText(tileIdx);
      dis.text(`gsDPLoadTLUTCmd(${tt}, ${count}); //${uls}, ${ult}, ${lrs}, ${lrt}`);
    }

    // Tlut fmt is sometimes wrong (in 007) and is set after tlut load, but
    // before tile load. Format is always 16bpp - RGBA16 or IA16:
    const ramAddress = this.state.textureImage.calcAddress(uls >>> 2, ult >>> 2, gbi.ImageSize.G_IM_SIZ_16b);

    const tile = this.state.tiles[tileIdx];
    const texels = ((lrs - uls) >>> 2) + 1;

    this.state.tmem.loadTLUT(tile, ramAddress, texels);
    this.state.invalidateTileHashes();
  }

  executeFillRect(cmd0, cmd1, dis) {
    // NB: fraction is ignored
    const x0 = ((cmd1 >>> 12) & 0xfff) >>> 2;
    const y0 = ((cmd1 >>> 0) & 0xfff) >>> 2;
    let x1 = ((cmd0 >>> 12) & 0xfff) >>> 2;
    let y1 = ((cmd0 >>> 0) & 0xfff) >>> 2;

    const gl = this.gl;

    if (dis) {
      dis.text(`gsDPFillRectangle(${x0}, ${y0}, ${x1}, ${y1});`);
    }

    if (this.state.depthImage.address == this.state.colorImage.address) {
      // TODO: should use depth source.
      // const depthSourcePrim = (this.state.rdpOtherModeL & gbi.DepthSource.G_ZS_PRIM) !== 0;
      // const depth = depthSourcePrim ? this.state.primDepth : 0.0;
      gl.clearDepth(1.0);
      gl.depthMask(true);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      return;
    }

    const cycleType = this.state.getCycleType();
    let color = { r: 0, g: 0, b: 0, a: 0 };

    if (cycleType === gbi.CycleType.G_CYC_FILL) {
      x1 += 1;
      y1 += 1;

      if (this.state.colorImage.size === gbi.ImageSize.G_IM_SIZ_16b) {
        color = makeRGBAFromRGBA16(this.state.fillColor & 0xffff);
      } else {
        color = makeRGBAFromRGBA32(this.state.fillColor);
      }

      // Clear whole screen in one?
      const w = x1 - x0;
      const h = y1 - y0;
      if (w === this.renderer.nativeTransform.viWidth && h === this.renderer.nativeTransform.viHeight) {
        gl.clearColor(color.r, color.g, color.b, color.a);
        gl.clear(gl.COLOR_BUFFER_BIT);
        return;
      }
    } else if (cycleType === gbi.CycleType.G_CYC_COPY) {
      x1 += 1;
      y1 += 1;
    }

    // TODO: Apply scissor.

    this.renderer.fillRect(x0, y0, x1, y1, color);
  }

  executeTexRect(cmd0, cmd1, dis) {
    // The following 2 commands contain additional info
    // TODO: check op code matches what we expect?
    const cmd2 = this.ramDV.getUint32(this.state.pc + 4);
    const cmd3 = this.ramDV.getUint32(this.state.pc + 12);
    this.state.pc += 16;

    let xh = ((cmd0 >>> 12) & 0xfff) / 4.0;
    let yh = ((cmd0 >>> 0) & 0xfff) / 4.0;
    const tileIdx = (cmd1 >>> 24) & 0x7;
    const xl = ((cmd1 >>> 12) & 0xfff) / 4.0;
    const yl = ((cmd1 >>> 0) & 0xfff) / 4.0;
    let s0 = ((cmd2 >>> 16) & 0xffff) / 32.0;
    let t0 = ((cmd2 >>> 0) & 0xffff) / 32.0;
    // NB - signed value
    let dsdx = ((cmd3 | 0) >> 16) / 1024.0;
    const dtdy = ((cmd3 << 16) >> 16) / 1024.0;

    const cycleType = this.state.getCycleType();

    // In copy mode 4 pixels are copied at once.
    if (cycleType === gbi.CycleType.G_CYC_COPY) {
      dsdx *= 0.25;
    }

    // In Fill/Copy mode the coordinates are inclusive (i.e. add 1.0f to the w/h)
    if (cycleType === gbi.CycleType.G_CYC_COPY ||
      cycleType === gbi.CycleType.G_CYC_FILL) {
      xh += 1.0;
      yh += 1.0;
    }

    // If the texture coords are inverted, start from the end of the texel (?).
    // Fixes California Speed.
    if (dsdx < 0) { s0++; }
    if (dtdy < 0) { t0++; }

    const s1 = s0 + dsdx * (xh - xl);
    const t1 = t0 + dtdy * (yh - yl);

    if (dis) {
      const tt = gbi.getTileText(tileIdx);
      dis.text(`gsSPTextureRectangle(${xl},${yl},${xh},${yh},${tt},${s0},${t0},${dsdx},${dtdy});`);
      dis.tip(`cmd2 = ${toString32(cmd2)}, cmd3 = ${toString32(cmd3)}`)
      dis.tip(`st0 = (${s0}, ${t0}) st1 = (${s1}, ${t1})`)
    }

    this.renderer.texRect(tileIdx, xl, yl, xh, yh, s0, t0, s1, t1, false);
  }

  executeTexRectFlip(cmd0, cmd1, dis) {
    // The following 2 commands contain additional info
    // TODO: check op code matches what we expect?
    const cmd2 = this.ramDV.getUint32(this.state.pc + 4);
    const cmd3 = this.ramDV.getUint32(this.state.pc + 12);
    this.state.pc += 16;

    let xh = ((cmd0 >>> 12) & 0xfff) / 4.0;
    let yh = ((cmd0 >>> 0) & 0xfff) / 4.0;
    const tileIdx = (cmd1 >>> 24) & 0x7;
    const xl = ((cmd1 >>> 12) & 0xfff) / 4.0;
    const yl = ((cmd1 >>> 0) & 0xfff) / 4.0;
    let s0 = ((cmd2 >>> 16) & 0xffff) / 32.0;
    let t0 = ((cmd2 >>> 0) & 0xffff) / 32.0;
    // NB - signed value
    let dsdx = ((cmd3 | 0) >> 16) / 1024.0;
    const dtdy = ((cmd3 << 16) >> 16) / 1024.0;

    const cycleType = this.state.getCycleType();

    // In copy mode 4 pixels are copied at once.
    if (cycleType === gbi.CycleType.G_CYC_COPY) {
      dsdx *= 0.25;
    }

    // In Fill/Copy mode the coordinates are inclusive (i.e. add 1.0f to the w/h)
    if (cycleType === gbi.CycleType.G_CYC_COPY ||
      cycleType === gbi.CycleType.G_CYC_FILL) {
      xh += 1.0;
      yh += 1.0;
    }

    // If the texture coords are inverted, start from the end of the texel (?).
    if (dsdx < 0) { s0++; }
    if (dtdy < 0) { t0++; }

    // NB x/y are flipped
    const s1 = s0 + dsdx * (yh - yl);
    const t1 = t0 + dtdy * (xh - xl);

    if (dis) {
      const tt = gbi.getTileText(tileIdx);
      dis.text(`gsSPTextureRectangleFlip(${xl},${yl},${xh},${yh},${tt},${s0},${t0},${dsdx},${dtdy});`);
      dis.tip(`cmd2 = ${toString32(cmd2)}, cmd3 = ${toString32(cmd3)}`)
      dis.tip(`st0 = (${s0}, ${t0}) st1 = (${s1}, ${t1})`)
    }

    this.renderer.texRect(tileIdx, xl, yl, xh, yh, s0, t0, s1, t1, true);
  }

  executeCullDL(cmd0, cmd1, dis) {
    this.logUnimplemented('CullDisplayList')
    if (dis) {
      dis.text(`gSPCullDisplayList(/* TODO */); // TODO: implement`);
    }
  }

  calcTextureScale(v) {
    if (v === 0 || v === 0xffff) {
      return 1.0;
    }
    return v / 65536.0;
  }
}

function makeRGBAFromRGBA16(col) {
  return {
    'r': ((col >>> 11) & 0x1f) / 31.0,
    'g': ((col >>> 6) & 0x1f) / 31.0,
    'b': ((col >>> 1) & 0x1f) / 31.0,
    'a': ((col >>> 0) & 0x1) / 1.0,
  };
}

function makeRGBAFromRGBA32(col) {
  return {
    'r': ((col >>> 24) & 0xff) / 255.0,
    'g': ((col >>> 16) & 0xff) / 255.0,
    'b': ((col >>> 8) & 0xff) / 255.0,
    'a': ((col >>> 0) & 0xff) / 255.0,
  };
}
