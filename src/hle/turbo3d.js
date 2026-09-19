import { toString32 } from '../format.js';
import { Matrix4x4 } from '../graphics/Matrix4x4.js';
import { Vector3 } from '../graphics/Vector3.js';
import * as gbi from './gbi.js';
import { ObjectMicrocode } from './object_microcode.js';

const GT_FLAG_NOMTX = 0x01;
const GT_FLAG_NO_XFM = 0x02;
const GT_FLAG_XFM_ONLY = 0x04;

// Turbo3D uses gtGfx objects (four segmented pointers), not GBI opcodes.
// Layouts: SDK PR/gt.h and the gspTurbo3D programming reference.
export class Turbo3D extends ObjectMicrocode {
  constructor(state, ramDV) {
    super(state, ramDV);
    this.transform = Matrix4x4.identity();
  }

  executeDisplayList({ disassembler: dis, bailAfter }) {
    const state = this.state;
    const dv = this.ramDV;
    while (state.pc) {
      const pc = state.pc;
      const global = dv.getUint32(pc);
      const object = dv.getUint32(pc + 4);
      if (dis) {
        dis.begin(global, object, 0);
        dis.text(`gtObject(${toString32(global)}, ${toString32(object)});`);
      }
      if (object === 0) {
        state.pc = 0;
      } else {
        const vertices = dv.getUint32(pc + 8);
        const triangles = dv.getUint32(pc + 12);
        state.pc += 16;
        if (global) this.loadGlobalState(global, dis, 1);
        this.loadObject(object, vertices, triangles, dis);
      }
      if (dis) dis.end();
      // Each object, including its RDP blocks and triangles, is one debug op.
      if (state.postOp(dis ? -1 : bailAfter)) break;
    }
  }

  loadObject(pointer, vertices, triangles, dis) {
    const state = this.state;
    const dv = this.ramDV;
    const address = state.rdpSegmentAddress(pointer);
    const count = dv.getUint8(address + 8);
    const v0 = dv.getUint8(address + 9);
    const triCount = dv.getUint8(address + 10);
    const flags = dv.getUint8(address + 11);
    if (flags & GT_FLAG_XFM_ONLY) {
      // This mode writes transformed vertices to RAM instead of drawing them.
      throw new Error('Turbo3D transform-only objects are not supported');
    }
    if (!(flags & GT_FLAG_NOMTX)) this.transform = this.loadMatrix(address + 24, 64);
    state.geometryModeBits = dv.getUint32(address) | gbi.GeometryModeGBI1.G_SHADE;
    state.updateGeometryModeFromBits(gbi.GeometryModeGBI1);
    state.setTexture(1, 1, 0, dv.getUint32(address + 4) & 7);
    this.executeSetRDPOtherMode(dv.getUint32(address + 16), dv.getUint32(address + 20), dis);
    if (vertices) this.loadObjectVertices(state.rdpSegmentAddress(vertices), v0, count, flags);
    this.processRDP(dv.getUint32(address + 12), dis);
    if (triangles) this.drawObjectTriangles(state.rdpSegmentAddress(triangles), triCount);
  }

  loadObjectVertices(address, v0, count, flags) {
    const state = this.state;
    if (v0 + count > state.projectedVertices.length) {
      throw new Error('Turbo3D vertex range exceeds the 64-entry cache');
    }
    const dv = this.ramDV;
    const xyz = new Vector3();
    const vi = this.renderer.nativeTransform.viTransform;
    for (let i = 0; i < count; i++, address += 16) {
      const vertex = state.projectedVertices[v0 + i];
      vertex.set = true;
      vertex.u = dv.getInt16(address + 8) / 32;
      vertex.v = dv.getInt16(address + 10) / 32;
      vertex.color = dv.getUint32(address + 12, true);
      if (flags & GT_FLAG_NO_XFM) {
        // gtVtxOut: screen x/y in 10.2 and z in 15.16 fixed point.
        vertex.pos.set(dv.getInt16(address) / 4, dv.getInt16(address + 2) / 4,
          dv.getInt32(address + 4) / 65536, 1);
        vi.invTransformInPlace(vertex.pos);
        vertex.clipFlags = 0;
      } else {
        xyz.x = dv.getInt16(address);
        xyz.y = dv.getInt16(address + 2);
        xyz.z = dv.getInt16(address + 4);
        this.projectInPlace(vertex, xyz, this.transform, state.viewport.transform, vi);
        // Turbo3D interpolates texture coordinates without perspective correction.
        vertex.pos.scaleInPlace(1 / vertex.pos.w);
      }
    }
  }

  drawObjectTriangles(address, count) {
    const dv = this.ramDV;
    const verts = this.state.projectedVertices;
    const tb = this.triangleBuffer;
    tb.reset();
    for (let i = 0; i < count; i++, address += 4) {
      const indices = [dv.getUint8(address), dv.getUint8(address + 1), dv.getUint8(address + 2)];
      if (indices.some(index => index >= verts.length)) {
        throw new Error('Turbo3D triangle index exceeds the 64-entry cache');
      }
      const [a, b, c] = indices.map(index => verts[index]);
      tb.pushTri(a, b, c);
      if (!this.state.geometryMode.shadeSmooth) {
        const flag = dv.getUint8(address + 3);
        if (flag > 2) throw new Error('Invalid Turbo3D flat-shading vertex');
        const color = verts[indices[flag]].color;
        tb.colours.fill(color, (tb.numTris - 1) * 3, tb.numTris * 3);
      }
      if (!tb.hasCapacity(1)) {
        this.renderer.flushTris(tb);
        tb.reset();
      }
    }
    this.renderer.flushTris(tb);
  }
}
