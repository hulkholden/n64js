import { toString32 } from "../format.js";
import { Vector3 } from "../graphics/Vector3.js";
import * as rdp from "../lle/rdp.js";
import * as rdpdis from "./disassemble_rdp.js";
import { GBI1 } from "./gbi1.js";

// GBI0 is very similar to GBI1 with a few small differences,
// so we extend that instead of GBIMicrocode.
export class GBI0 extends GBI1 {
  constructor(state, ramDV) {
    super(state, ramDV);
    this.vertexStride = 10;

    this.rdpCommandBuffer = new ArrayBuffer(0, { maxByteLength: 16 * 1024 });
    this.rdpCommandDV = new DataView(this.rdpCommandBuffer);
    this.rdpTriangle = new rdp.Triangle();

    this.gbi0Commands = new Map([
      [0xb0, this.executeUnknown.bind(this)],      // Defined as executeBranchZ for GBI1.
      [0xb1, this.executeTri4.bind(this)],         // Defined as executeTri2 for GBI1.
      [0xb2, this.executeRDPHalf_Cont.bind(this)], // Defined as executeModifyVertex for GBI1.
    ]);
  }

  getHandler(command) {
    const fn = this.gbi0Commands.get(command);
    if (fn) {
      return fn;
    }
    return super.getHandler(command);
  }

  executeCullDL(cmd0, cmd1, dis) {
    // This differs from GBI1 and GBI2.
    const begin = ((cmd0 & 0x00ffffff) / 40) & 0xf;
    const end = (cmd1 / 40) & 0xf;

    const result = this.testClipFlags(begin, end);

    if (dis) {
      dis.text(`gSPCullDisplayList(${begin}, ${end}); // ${result ? 'continue' : 'end'}`);
    }

    if (!result) {
      this.state.endDisplayList();
    }
  }

  executeVertex(cmd0, cmd1, dis) {
    const n = ((cmd0 >>> 20) & 0xf) + 1;
    const v0 = (cmd0 >>> 16) & 0xf;
    //const length = (cmd0 >>>  0) & 0xffff;
    const address = this.state.rdpSegmentAddress(cmd1);

    if (dis) {
      dis.text(`gsSPVertex(${toString32(address)}, ${v0}, ${n});`);
    }

    this.loadVertices(v0, n, address, dis);
  }

  executeRDPHalf_Cont(cmd0, cmd1, dis) {
    this.warnUnimplemented('RDPHalf_Cont');
    if (dis) {
      dis.text(`gsDPHalf_Cont(/* TODO */);`);
    }
  }

  pushRDPCommandU32(value) {
    const bufLen = this.rdpCommandBuffer.byteLength;
    this.rdpCommandBuffer.resize(bufLen + 4);
    this.rdpCommandDV.setUint32(bufLen, value, false);
  }

  // "RDP Command" insturctions are shared between Goldeneye and Perfect Dark.
  // These are RDP commands for drawing triangles, baked into the display list.
  // They seem to alternate in pairs of 0xb4 and 0xb2, and end in 0xb3.
  // The cmd1 parts of the commands form an RDP command stream.
  executeRDPCommandHalf1(cmd0, cmd1, dis) {
    if (dis) {
      dis.text(`gsSPRDPCommandHalf1(${toString32(cmd1)});`);
    }
    this.pushRDPCommandU32(cmd1);
  }

  executeRDPCommandHalf2(cmd0, cmd1, dis) {
    if (dis) {
      dis.text(`gsSPRDPCommandHalf2(${toString32(cmd1)});`);
    }
    this.pushRDPCommandU32(cmd1);
  }

  executeRDPCommandHalf22Final(cmd0, cmd1, dis) {
    this.warnUnimplemented('executeRDPCommandHalf22Final')
    if (dis) {
      dis.text(`gsSPRDPCommandHalf2Final(${toString32(cmd1)});`);
    }

    this.pushRDPCommandU32(cmd1);
    const rdpBuf = new rdp.RDPBuffer(this.rdpCommandDV, 0, this.rdpCommandDV.byteLength);
    this.rdpTriangle.load(rdpBuf);

    // TODO: this hackily assumes GE is always rendering a screen space rectangle
    // but ideally this should be generalised.
    const tri = this.rdpTriangle;
    const tileIdx = tri.tile;
    const y0 = tri.yh;
    const y1 = tri.ym;

    const yhSpan = tri.interpolateX(tri.yh);
    const ymSpan = tri.interpolateX(tri.ym);
    const x0 = Math.min(yhSpan[0], ymSpan[0]);
    const x1 = Math.max(yhSpan[1], ymSpan[1]);
  
    const vertices = this.renderer.calculateRectVertices(x0, y0 / 4, x1, y1 / 4);
    const uvs = tri.calculateRectUVs();
    const colours = [0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff];
    this.renderer.lleRect(tileIdx, vertices, uvs, colours);

    if (dis) {
      let t = `lleRect(${tileIdx}, [${vertices}], [${uvs}], [${colours}])`;
      const dasm = rdpdis.disassembleCommand(rdpBuf);
      if (dasm) {
        t += dasm.disassembly;
      }
      dis.tip(t);
    }

    this.rdpCommandBuffer.resize(0);
  }

  executeTri4(cmd0, cmd1, dis) {
    const verts = this.state.projectedVertices;
    const tb = this.triangleBuffer;
    tb.reset();

    // Process triangles individually when disassembling
    let limit = dis ? 1 : 0;
    let commandsExecuted = this.state.executeBatch(limit, (cmd0, cmd1) => {
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
      return tb.hasCapacity(4);
    });
    this.debugController.currentOp += commandsExecuted - 1;
    this.renderer.flushTris(tb);
  }
}
export class GBI0GE extends GBI0 {
  constructor(state, ramDV) {
    super(state, ramDV);
    this.vertexStride = 10;

    this.geCommands = new Map([

      [0xb2, this.executeRDPCommandHalf2.bind(this)],
      [0xb3, this.executeRDPCommandHalf22Final.bind(this)],
      [0xb4, this.executeRDPCommandHalf1.bind(this)],
    ]);
  }

  getHandler(command) {
    const fn = this.geCommands.get(command);
    if (fn) {
      return fn;
    }
    return super.getHandler(command);
  }
}

export class GBI0PD extends GBI0 {
  constructor(state, ramDV) {
    super(state, ramDV);
    this.vertexStride = 10;
    this.auxAddress = 0;

    this.pdCommands = new Map([
      // 0x04 - executeVertex is different from GBI0, but handled by overriding loadVertices.
      [0x07, this.executeSetVertexColorIndex.bind(this)],

      [0xb2, this.executeRDPCommandHalf2.bind(this)],
      [0xb3, this.executeRDPCommandHalf22Final.bind(this)],
      [0xb4, this.executeRDPCommandHalf1.bind(this)],
    ]);
  }

  getHandler(command) {
    const fn = this.pdCommands.get(command);
    if (fn) {
      return fn;
    }
    return super.getHandler(command);
  }

  executeSetVertexColorIndex(cmd0, cmd1, dis) {
    const address = this.state.rdpSegmentAddress(cmd1);
    if (dis) {
      dis.text(`gsSPSetVertexColorIndex(${toString32(address)});`);
    }
    this.auxAddress = address;
  }

  // Perfect Dark loads in a different format - this is called from executeVertex.
  loadVertices(v0, n, address, dis) {
    const light = this.state.geometryMode.lighting;
    const texgen = this.state.geometryMode.textureGen;
    const texgenlin = this.state.geometryMode.textureGenLinear;
    const dv = new DataView(this.ramDV.buffer, address);

    // Additional address for normal and color data.
    const auxDV = new DataView(this.ramDV.buffer, this.auxAddress);

    if (dis) {
      this.previewVertex(v0, n, dv, dis, light);
    }

    if (v0 + n >= this.state.projectedVertices.length) {
      this.warn('Too many verts');
      return;
    }

    const vtxStride = 12;

    const mvmtx = this.state.modelview[this.state.modelview.length - 1];
    const pmtx = this.state.projection[this.state.projection.length - 1];

    const wvp = pmtx.multiply(mvmtx);

    // Texture coords are provided in 11.5 fixed point format, so divide by 32 here to normalise
    const scaleS = this.state.texture.scaleS / 32.0;
    const scaleT = this.state.texture.scaleT / 32.0;

    const xyz = new Vector3();
    const normal = new Vector3();
    const transformedNormal = new Vector3();

    const viTransform = this.renderer.nativeTransform.viTransform;
    const vpTransform = this.state.viewport.transform;

    for (let i = 0; i < n; ++i) {
      const vtxBase = i * vtxStride;
      const vertex = this.state.projectedVertices[v0 + i];

      vertex.set = true;

      xyz.x = dv.getInt16(vtxBase + 0);
      xyz.y = dv.getInt16(vtxBase + 2);
      xyz.z = dv.getInt16(vtxBase + 4);
      // const pad = dv.getUint8(vtxBase + 6);
      const cIdx = dv.getUint8(vtxBase + 7);
      vertex.u = dv.getInt16(vtxBase + 8) * scaleS;
      vertex.v = dv.getInt16(vtxBase + 10) * scaleT;
      // Load as little-endian (ABGR) for convenience.
      vertex.color = auxDV.getUint32(cIdx + 0, true);

      // Project.
      this.projectInPlace(vertex, xyz, wvp, vpTransform, viTransform);

      if (light) {
        const alpha = vertex.color & 0xff;
        this.unpackNormal(normal, vertex.color);
        mvmtx.transformNormal(normal, transformedNormal);
        transformedNormal.normaliseInPlace();

        vertex.color = this.calculateLighting(transformedNormal, alpha);
        if (texgenlin) {
          vertex.calculateLinearUV(transformedNormal);
        } else if (texgen) {
          vertex.calculateSphericalUV(transformedNormal);
        }
      }
    }
  }
}

export class GBI0WR extends GBI0 {
  constructor(state, ramDV) {
    super(state, ramDV);
    this.vertexStride = 5;
  }

  executeVertex(cmd0, cmd1, dis) {
    const n = ((cmd0 >>> 9) & 0x7f);
    const v0 = ((cmd0 >>> 16) & 0xff) / 5;
    const address = this.state.rdpSegmentAddress(cmd1);

    if (dis) {
      dis.text(`gsSPVertex(${toString32(address)}, ${v0}, ${n});`);
    }

    this.loadVertices(v0, n, address, dis);
  }
}

export class GBI0SE extends GBI0 {
  constructor(state, ramDV) {
    super(state, ramDV);
    this.vertexStride = 5;
  }

  executeVertex(cmd0, cmd1, dis) {
    const n = (((cmd0 >>> 4) & 0xfff) / 33) + 1;
    const v0 = 0;
    const address = this.state.rdpSegmentAddress(cmd1);

    if (dis) {
      dis.text(`gsSPVertex(${toString32(address)}, ${v0}, ${n});`);
    }

    this.loadVertices(v0, n, address, dis);
  }
}
