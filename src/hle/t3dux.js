import { toString32 } from '../format.js';
import { Matrix4x4 } from '../graphics/Matrix4x4.js';
import { Vector3 } from '../graphics/Vector3.js';
import * as gbi from './gbi.js';
import { ObjectMicrocode } from './object_microcode.js';
import { ProjectedVertex } from './projected_vertex.js';

const RENDER_STATE_TILE_MASK = 0x07;
const RENDER_STATE_LEVEL_MASK = 0x38;
const RENDER_STATE_LEVEL_SHIFT = 3;
const RENDER_STATE_SUPPORTED_MASK = RENDER_STATE_TILE_MASK | RENDER_STATE_LEVEL_MASK;

const GEOM_MODE_GBI1_SHIFT = 8;
const GEOM_MODE_SHADE_SMOOTH = gbi.GeometryModeGBI1.G_SHADING_SMOOTH >>> GEOM_MODE_GBI1_SHIFT;
const GEOM_MODE_CULL_BACK = gbi.GeometryModeGBI1.G_CULL_BACK >>> GEOM_MODE_GBI1_SHIFT;
const GEOM_MODE_SUPPORTED_MASK = GEOM_MODE_SHADE_SMOOTH | GEOM_MODE_CULL_BACK;

const TEX_MODE_ZBUFFER = 0x01;
const TEX_MODE_TEXTURE = 0x02;
const TEX_MODE_SUPPORTED_MASK = TEX_MODE_ZBUFFER | TEX_MODE_TEXTURE;

const MATRIX_FLAG_KEEP_MATRIX = 0x01;
const MATRIX_FLAG_NO_TRANSFORM = 0x02;
const MATRIX_FLAG_TRANSFORM_ONLY = 0x04;
const MATRIX_FLAGS_SUPPORTED_MASK = MATRIX_FLAG_KEEP_MATRIX | MATRIX_FLAG_NO_TRANSFORM;

const PALETTE_TILE_SELECT_MASK = 0x70;
const PALETTE_UPDATE_FLAG = 0x80;
const RDP_TILE_PALETTE_SHIFT = 20;
const RDP_TILE_PALETTE_MASK = 0x0f << RDP_TILE_PALETTE_SHIFT;

const OBJECT_RECORD_BYTES = 24;
const OBJECT_STATE_BYTES = 24;
const MATRIX_BYTES = 64;
const VERTEX_BYTES = 8;
const TRIANGLE_BYTES = 8;
const ATTRIBUTE_BYTES = 4;
const ATTRIBUTE_INDEX_MASK = 0xff;

const DMEM_BYTES = 0x1000;
const VERTEX_DMEM_START = 0x140;
const TRIANGLE_DMEM_START = 0x740;
const VERTEX_CACHE_SIZE = (TRIANGLE_DMEM_START - VERTEX_DMEM_START) / VERTEX_BYTES;
// Vertex offsets/counts and triangle counts pass through signed-byte loads.
const SIGNED_DMA_LIMIT = 0x80;

const SCREEN_XY_SCALE = 4;
const SCREEN_Z_SCALE = 65536;
const SCREEN_Z_MASK = 0x7fffffff;
const TEXCOORD_SCALE = 32;

// T3DUX records are six words: global, object, vertices, triangles, attributes,
// and the attribute DMEM base. Vertices and triangles are each eight bytes.
// Layout reference: GLideN64 src/uCodes/T3DUX.cpp; cache offsets, signed smooth
// color offsets and palette emission were checked against both RSP binaries.
// The two hashes share the loader, but emit palette changes differently.
export class T3DUX extends ObjectMicrocode {
  constructor(state, ramDV, allowPaletteTileSelect) {
    super(state, ramDV);

    this.allowPaletteTileSelect = allowPaletteTileSelect;
    this.transform = Matrix4x4.identity();

    // Vertex DMEM is 0x140..0x73f. Keep this separate from the GBI caches.
    this.vertices = Array.from({ length: VERTEX_CACHE_SIZE }, () => new ProjectedVertex());
    this.attributes = new DataView(new ArrayBuffer(DMEM_BYTES));
    this.rejected = new Uint8Array(this.vertices.length);
    this.attributeValid = new Uint8Array(DMEM_BYTES / ATTRIBUTE_BYTES);

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

        state.pc += OBJECT_RECORD_BYTES;
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
    this.setTile = [cmd0, cmd1 & ~RDP_TILE_PALETTE_MASK];
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

    if (renderState & ~RENDER_STATE_SUPPORTED_MASK) throw new Error('Unsupported T3DUX render state');
    if ((geomMode & ~GEOM_MODE_SUPPORTED_MASK) || (texMode & ~TEX_MODE_SUPPORTED_MASK)) {
      throw new Error('Unsupported T3DUX geometry mode');
    }
    if (flags & MATRIX_FLAG_TRANSFORM_ONLY) throw new Error('T3DUX transform-only RAM writeback is not supported');
    if (flags & ~MATRIX_FLAGS_SUPPORTED_MASK) throw new Error(`Unsupported T3DUX matrix flags ${flags}`);

    if (!(flags & MATRIX_FLAG_KEEP_MATRIX)) this.transform = this.loadMatrix(address + OBJECT_STATE_BYTES, MATRIX_BYTES);
    if (triCount >= SIGNED_DMA_LIMIT) throw new Error('Unsupported T3DUX triangle DMEM range');
    if (vertices) this.loadVertices(state.rdpSegmentAddress(vertices), v0, count, flags);

    if (attributes) {
      const start = attributeBase + attrStart * ATTRIBUTE_BYTES;
      if ((start & (ATTRIBUTE_BYTES - 1)) || start < VERTEX_DMEM_START ||
        start + attrCount * ATTRIBUTE_BYTES > TRIANGLE_DMEM_START) {
        throw new Error('Unsupported T3DUX attribute DMEM range');
      }

      const source = state.rdpSegmentAddress(attributes);
      for (let i = 0; i < attrCount; i++) {
        this.attributes.setUint32(start + i * ATTRIBUTE_BYTES, dv.getUint32(source + i * ATTRIBUTE_BYTES));
        this.attributeValid[start / ATTRIBUTE_BYTES + i] = 1;

        // Attribute DMA shares the vertex area. Do not reuse a projected
        // vertex after its packed representation has been overwritten.
        this.vertices[Math.floor((start + i * ATTRIBUTE_BYTES - VERTEX_DMEM_START) / VERTEX_BYTES)].set = false;
      }
    }

    this.executeSetRDPOtherMode(dv.getUint32(address + 16), dv.getUint32(address + 20), dis);
    this.processRDP(dv.getUint32(address + 12), dis);

    // geomMode contains the upper GBI1 geometry byte. texMode contains the
    // RDP triangle texture/z bits; lighting and texgen are not performed.
    state.geometryModeBits = (geomMode << GEOM_MODE_GBI1_SHIFT) | gbi.GeometryModeGBI1.G_SHADE;
    state.updateGeometryModeFromBits(gbi.GeometryModeGBI1);
    state.geometryMode.texture = (texMode & TEX_MODE_TEXTURE) !== 0;
    state.geometryMode.zbuffer = (texMode & TEX_MODE_ZBUFFER) !== 0;
    state.setTexture(1, 1, (renderState & RENDER_STATE_LEVEL_MASK) >>> RENDER_STATE_LEVEL_SHIFT,
      renderState & RENDER_STATE_TILE_MASK);

    if (triangles) this.drawTriangles(state.rdpSegmentAddress(triangles), triCount, attributeBase, dis);
  }

  loadVertices(address, v0, count, flags) {
    if (v0 >= SIGNED_DMA_LIMIT || count >= SIGNED_DMA_LIMIT || v0 + count > this.vertices.length) {
      throw new Error('Unsupported T3DUX vertex DMEM range');
    }

    const dv = this.ramDV;
    const xyz = new Vector3();
    const vi = this.renderer.nativeTransform.viTransform;

    for (let i = 0; i < count; i++, address += VERTEX_BYTES) {
      const vertex = this.vertices[v0 + i];
      vertex.set = true;

      const dmemWord = (VERTEX_DMEM_START + (v0 + i) * VERTEX_BYTES) / ATTRIBUTE_BYTES;
      this.attributeValid[dmemWord] = 0;
      this.attributeValid[dmemWord + 1] = 0;
      this.rejected[v0 + i] = 0;

      if (flags & MATRIX_FLAG_NO_TRANSFORM) {
        // Packed output: x/y are 10.2; z is 15.16 with a rejection bit.
        vertex.pos.set(dv.getInt16(address) / SCREEN_XY_SCALE, dv.getInt16(address + 2) / SCREEN_XY_SCALE,
          (dv.getUint32(address + 4) & SCREEN_Z_MASK) / SCREEN_Z_SCALE, 1);
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
    const address = base + index * ATTRIBUTE_BYTES;
    if (address < 0 || address + ATTRIBUTE_BYTES > this.attributes.byteLength ||
      (address & (ATTRIBUTE_BYTES - 1)) || !this.attributeValid[address / ATTRIBUTE_BYTES]) {
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

    for (let i = 0; i < count; i++, address += TRIANGLE_BYTES) {
      const palette = dv.getUint8(address + 7);
      // 26da8a4c emits PipeSync+SetTile when bit 7 is set; dd560323
      // advances its output by palette >> 4 bytes (0 or 8), without PipeSync.
      if (!this.allowPaletteTileSelect && (palette & PALETTE_TILE_SELECT_MASK)) {
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

      if ((palette & PALETTE_UPDATE_FLAG) || (rejected && palette)) {
        if (this.setTile) {
          this.renderer.flushTris(tb);
          tb.reset();
          super.executeSetTile(this.setTile[0], this.setTile[1] | (palette << RDP_TILE_PALETTE_SHIFT), dis);
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
        const index = state.geometryMode.shadeSmooth ? indices[j] + colorIndex : colorIndex & ATTRIBUTE_INDEX_MASK;
        vertices[j].color = attrs.getUint32(this.attributeAddress(attributeBase, index), true);

        if (state.geometryMode.texture) {
          const texAddress = this.attributeAddress(attributeBase, dv.getUint8(address + 4 + j));
          uv.push(attrs.getInt16(texAddress) / TEXCOORD_SCALE, attrs.getInt16(texAddress + 2) / TEXCOORD_SCALE);
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
