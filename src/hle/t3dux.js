import { toString32 } from '../format.js';
import { Matrix4x4 } from '../graphics/Matrix4x4.js';
import { Vector3 } from '../graphics/Vector3.js';
import * as gbi from './gbi.js';
import { ObjectMicrocode } from './object_microcode.js';
import { ProjectedVertex } from './projected_vertex.js';

// T3DUX records are six words: global, object, vertices, triangles, attributes,
// and the attribute DMEM base. Vertices and triangles are each eight bytes.
// Layout reference: GLideN64 src/uCodes/T3DUX.cpp; cache offsets, signed smooth
// color offsets and palette emission were checked against both RSP binaries.
// The two hashes share the loader, but emit palette changes differently.
export class T3DUX extends ObjectMicrocode {
  constructor(state, ramDV, braveSpirits) {
    super(state, ramDV);
    this.braveSpirits = braveSpirits;
    this.transform = Matrix4x4.identity();
    // Vertex DMEM is 0x140..0x73f. Keep this separate from the GBI caches.
    this.vertices = Array.from({ length: 192 }, () => new ProjectedVertex());
    this.attributes = new DataView(new ArrayBuffer(0x1000));
    this.rejected = new Uint8Array(this.vertices.length);
    this.attributeValid = new Uint8Array(0x400);
    this.setTile = null;
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
        dis.text(`t3duxObject(${toString32(global)}, ${toString32(object)});`);
      }
      if (!object) {
        state.pc = 0;
      } else {
        const vertices = dv.getUint32(pc + 8);
        const triangles = dv.getUint32(pc + 12);
        const attributes = dv.getUint32(pc + 16);
        const attributeBase = dv.getUint32(pc + 20);
        state.pc += 24;
        if (global) this.loadGlobalState(global, dis);
        this.loadObject(object, vertices, triangles, attributes, attributeBase, dis);
      }
      if (dis) dis.end();
      if (state.postOp(dis ? -1 : bailAfter)) break;
    }
  }

  isRDPEnd(cmd0) {
    // Both RSP variants test the first word, not the sum of the pair.
    return cmd0 === 0;
  }

  executeSetTile(cmd0, cmd1, dis) {
    super.executeSetTile(cmd0, cmd1, dis);
    this.setTile = [cmd0, cmd1 & 0xff0fffff];
  }

  loadObject(pointer, vertices, triangles, attributes, attributeBase, dis) {
    const state = this.state;
    const dv = this.ramDV;
    const address = state.rdpSegmentAddress(pointer);
    const renderState = dv.getUint32(address);
    const geomMode = dv.getUint8(address + 4);
    const texMode = dv.getUint8(address + 5);
    const count = dv.getUint8(address + 6);
    const v0 = dv.getUint8(address + 7);
    const triCount = dv.getUint8(address + 8);
    const flags = dv.getUint8(address + 9);
    const attrCount = dv.getUint8(address + 10);
    const attrStart = dv.getUint8(address + 11);
    if (renderState & ~0x3f) throw new Error('Unsupported T3DUX render state');
    if ((geomMode & ~0x22) || (texMode & ~3)) throw new Error('Unsupported T3DUX geometry mode');
    if (flags & 4) throw new Error('T3DUX transform-only RAM writeback is not supported');
    if (flags & ~3) throw new Error(`Unsupported T3DUX matrix flags ${flags}`);
    if (!(flags & 1)) this.transform = this.loadMatrix(address + 24, 64);
    if (triCount >= 128) throw new Error('Unsupported T3DUX triangle DMEM range');
    if (vertices) this.loadVertices(state.rdpSegmentAddress(vertices), v0, count, flags);
    if (attributes) {
      const start = attributeBase + attrStart * 4;
      if ((start & 3) || start < 0x140 || start + attrCount * 4 > 0x740) {
        throw new Error('Unsupported T3DUX attribute DMEM range');
      }
      const source = state.rdpSegmentAddress(attributes);
      for (let i = 0; i < attrCount; i++) {
        this.attributes.setUint32(start + i * 4, dv.getUint32(source + i * 4));
        this.attributeValid[start / 4 + i] = 1;
        // Attribute DMA shares the vertex area. Do not reuse a projected
        // vertex after its packed representation has been overwritten.
        this.vertices[Math.floor((start + i * 4 - 0x140) / 8)].set = false;
      }
    }
    this.executeSetRDPOtherMode(dv.getUint32(address + 16), dv.getUint32(address + 20), dis);
    this.processRDP(dv.getUint32(address + 12), dis);
    // geomMode contains the upper GBI1 geometry byte. texMode contains the
    // RDP triangle texture/z bits (2/1); lighting and texgen are not performed.
    state.geometryModeBits = (geomMode << 8) | gbi.GeometryModeGBI1.G_SHADE;
    state.updateGeometryModeFromBits(gbi.GeometryModeGBI1);
    state.geometryMode.texture = (texMode & 2) !== 0;
    state.geometryMode.zbuffer = (texMode & 1) !== 0;
    state.setTexture(1, 1, (renderState >>> 3) & 7, renderState & 7);
    if (triangles) this.drawTriangles(state.rdpSegmentAddress(triangles), triCount, attributeBase, dis);
  }

  loadVertices(address, v0, count, flags) {
    if (v0 >= 128 || count >= 128 || v0 + count > this.vertices.length) throw new Error('Unsupported T3DUX vertex DMEM range');
    const dv = this.ramDV;
    const xyz = new Vector3();
    const vi = this.renderer.nativeTransform.viTransform;
    for (let i = 0; i < count; i++, address += 8) {
      const vertex = this.vertices[v0 + i];
      vertex.set = true;
      const dmemWord = (0x140 + (v0 + i) * 8) / 4;
      this.attributeValid[dmemWord] = 0;
      this.attributeValid[dmemWord + 1] = 0;
      this.rejected[v0 + i] = 0;
      if (flags & 2) {
        // Packed output: x/y are 10.2; z is 15.16 with a rejection bit.
        vertex.pos.set(dv.getInt16(address) / 4, dv.getInt16(address + 2) / 4,
          (dv.getUint32(address + 4) & 0x7fffffff) / 65536, 1);
        vi.invTransformInPlace(vertex.pos);
        vertex.clipFlags = 0;
        this.rejected[v0 + i] = dv.getInt32(address + 4) < 0 ? 1 : 0;
      } else {
        xyz.x = dv.getInt16(address);
        xyz.y = dv.getInt16(address + 2);
        xyz.z = dv.getInt16(address + 4);
        this.projectInPlace(vertex, xyz, this.transform, this.state.viewport.transform, vi);
        // This microcode emits affine texture coordinates, like Turbo3D.
        vertex.pos.scaleInPlace(1 / vertex.pos.w);
      }
    }
  }

  attributeAddress(base, index) {
    const address = base + index * 4;
    if (address < 0 || address + 4 > this.attributes.byteLength || (address & 3) || !this.attributeValid[address / 4]) {
      throw new Error('T3DUX triangle references an unloaded attribute');
    }
    return address;
  }

  drawTriangles(address, count, attributeBase, dis) {
    const dv = this.ramDV;
    const attrs = this.attributes;
    const state = this.state;
    const tb = this.triangleBuffer;
    tb.reset();
    for (let i = 0; i < count; i++, address += 8) {
      const palette = dv.getUint8(address + 7);
      // 26da8a4c emits PipeSync+SetTile when bit 7 is set; dd560323
      // advances its output by palette >> 4 bytes (0 or 8), without PipeSync.
      if (this.braveSpirits && (palette & 0x70)) {
        throw new Error('Unsupported T3DUX Brave Spirits palette command length');
      }
      const indices = [dv.getUint8(address), dv.getUint8(address + 1), dv.getUint8(address + 2)];
      const vertices = indices.map(index => this.vertices[index]);
      if (vertices.some(vertex => !vertex?.set)) throw new Error('T3DUX triangle references an unloaded vertex');
      // Rejected packed vertices still allow palette commands to take effect.
      const [a, b, c] = vertices.map(vertex => vertex.pos);
      const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      const rejected = indices.some(index => this.rejected[index]) || area === 0 ||
        (state.geometryMode.cullBack && area < 0);
      if ((palette & 0x80) || (rejected && palette)) {
        if (this.setTile) {
          this.renderer.flushTris(tb);
          tb.reset();
          super.executeSetTile(this.setTile[0], this.setTile[1] | (palette << 20), dis);
        } else if (state.geometryMode.texture) {
          throw new Error('T3DUX textured palette change without SetTile');
        }
        // Untextured objects also carry this flag. Before the first SetTile,
        // the RSP's zero-initialized template emits an RDP no-op, not a tile.
      }
      if (rejected) continue;
      const colorIndex = dv.getInt8(address + 3);
      const uv = [];
      for (let j = 0; j < 3; j++) {
        const index = state.geometryMode.shadeSmooth ? indices[j] + colorIndex : colorIndex & 255;
        vertices[j].color = attrs.getUint32(this.attributeAddress(attributeBase, index), true);
        if (state.geometryMode.texture) {
          const texAddress = this.attributeAddress(attributeBase, dv.getUint8(address + 4 + j));
          uv.push(attrs.getInt16(texAddress) / 32, attrs.getInt16(texAddress + 2) / 32);
        } else {
          uv.push(0, 0);
        }
      }
      tb.pushTriWithUV(...vertices, ...uv);
      if (!tb.hasCapacity(1)) {
        this.renderer.flushTris(tb);
        tb.reset();
      }
    }
    this.renderer.flushTris(tb);
  }
}
