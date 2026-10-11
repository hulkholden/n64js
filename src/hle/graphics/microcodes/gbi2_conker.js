import { toString16, toString32 } from '../../../format.js';
import { Vector3 } from '../../../graphics/Vector3.js';
import { Vector4 } from '../../../graphics/Vector4.js';
import * as gbi from '../gbi.js';
import { GBI2 } from './gbi2.js';

const vertexCount = 32;
const lightStride = 48;
const pointLightingBit = 0x00400000;

// Conker's F3DEX2 dialect. See tools/conker.md for command layouts and sources.
export class GBI2Conker extends GBI2 {
  constructor(state, ramDV) {
    super(state, ramDV);
    this.normalAddress = 0;
    this.advancedLighting = false;
    this.coordMod = new Float64Array(16);
    this.lookAt = [new Vector3(1, 0, 0), new Vector3(0, 1, 0)];
    this.lookAtEnabled = false;
    // Separate from GBI2's eight 24-byte light slots, including ambient.
    this.lights = Array.from({ length: 12 }, () => ({
      color: [0, 0, 0], dir: new Vector3(), pos: new Vector3(), attenuation: 0,
    }));
    const tri4 = this.executeTri4.bind(this);
    for (let op = 0x10; op <= 0x1f; ++op) {
      this.gbi2Commands.set(op, tri4);
    }
  }

  validRange(address, length) {
    if (address < 0 || address + length > this.ramDV.byteLength) {
      this.warn('Conker memory range out of bounds', `${toString32(address)} + ${length}`);
      return false;
    }
    return true;
  }

  executeMatrix(cmd0, cmd1, dis) {
    // Matrix and pop commands retain the F3DEX2 stack/flag encoding.
    if (this.validRange(this.state.rdpSegmentAddress(cmd1), 64)) {
      super.executeMatrix(cmd0, cmd1, dis);
    }
  }

  executeLoadUcode(cmd0, cmd1, dis) {
    // This loads the lighting overlay, retaining the vertex/light/matrix state.
    this.advancedLighting = true;
    if (dis) {
      dis.text(`gsSPConkerLightingOverlay(${toString32(cmd1)});`);
    }
  }

  executeMoveWord(cmd0, cmd1, dis) {
    const type = (cmd0 >>> 16) & 0xff;
    switch (type) {
      case gbi.MoveWord.G_MW_NUMLIGHT:
        if (cmd1 % lightStride || cmd1 / lightStride >= this.lights.length) {
          this.warn('Conker invalid light count', toString32(cmd1));
        } else {
          this.state.numLights = cmd1 / lightStride;
        }
        break;
      case 0x10: // Coordinate modifiers for point-light distances.
        this.moveCoordMod(cmd0 & 0xffff, cmd1);
        break;
      case gbi.G_MW_FORCEMTX:
        // The lighting dialect ignores this; it must not freeze the matrix.
        break;
      case gbi.MoveWord.G_MW_SEGMENT:
        super.executeMoveWord(cmd0, cmd1 & 0x00ffffff, dis);
        return;
      case gbi.MoveWord.G_MW_CLIP:
      case gbi.MoveWord.G_MW_FOG:
      case gbi.MoveWord.G_MW_PERSPNORM:
        super.executeMoveWord(cmd0, cmd1, dis);
        return;
      default:
        this.warn('Conker unknown MoveWord', toString16(type));
        break;
    }
    if (dis) {
      dis.text(`gsSPConkerMoveWord(${toString16(type)}, ${toString16(cmd0 & 0xffff)}, ${toString32(cmd1)});`);
    }
  }

  moveCoordMod(offset, value) {
    // Bit 3 selects the duplicate half of the microcode's vector registers.
    if (offset & 8) {
      return;
    }
    const component = (offset >>> 1) & 3;
    const field = offset & 0x30;
    if (component > 2 || field === 0x30 || (offset & ~0x3f)) {
      this.warn('Conker invalid coordinate modifier', toString16(offset));
      return;
    }
    const base = field >>> 2;
    const values = field === 0x10
      ? [(value >>> 16) / 65536, (value & 0xffff) / 65536]
      : [value >> 16, (value << 16) >> 16];
    for (let i = 0; i < 2; ++i) {
      const index = component + i;
      this.coordMod[base + index] = values[i];
      // Fraction writes commit the integer + fraction scale used by lighting.
      if (field === 0x10) {
        this.coordMod[12 + index] = this.coordMod[index] + values[i];
      }
    }
  }

  executeMoveMem(cmd0, cmd1, dis) {
    const type = cmd0 & 0xff;
    const address = this.state.rdpSegmentAddress(cmd1);
    const offset = (cmd0 >>> 5) & 0x3fff;
    if (dis) {
      dis.text(`gsSPConkerMoveMem(${toString16(type)}, ${offset}, ${toString32(address)});`);
    }
    switch (type) {
      case 8:
        if (this.validRange(address, 16)) {
          this.loadViewport(address);
        }
        break;
      case 10: {
        const slot = offset / lightStride;
        if (!Number.isInteger(slot) || slot >= this.lights.length + 2) {
          this.warn('Conker invalid light offset', toString16(offset));
          return;
        }
        if (!this.validRange(address, slot < 2 ? 12 : 40)) {
          return;
        }
        const dir = new Vector3(
          this.ramDV.getInt8(address + 8),
          this.ramDV.getInt8(address + 9),
          this.ramDV.getInt8(address + 10),
        ).normaliseInPlace();
        if (slot < 2) {
          this.lookAt[slot] = dir;
          this.lookAtEnabled = slot === 0 || dir.x !== 0 || dir.y !== 0;
        } else {
          const light = this.lights[slot - 2];
          light.dir = dir;
          light.color = [0, 1, 2].map(i => this.ramDV.getUint8(address + i) / 255);
          light.pos.set(this.ramDV.getInt16(address + 32), this.ramDV.getInt16(address + 34), this.ramDV.getInt16(address + 36));
          light.attenuation = this.ramDV.getUint8(address + 12) / 16;
        }
        break;
      }
      case 14:
        // GBI2 uses this selector for ForceMatrix. Conker sets a normal pointer.
        this.normalAddress = address;
        break;
      default:
        this.warn('Conker unknown MoveMem', toString16(type));
        break;
    }
  }

  loadVertices(v0, n, address, dis) {
    if (v0 < 0 || v0 + n > vertexCount) {
      this.warn('Conker vertex range out of bounds', `${v0} + ${n}`);
      return;
    }
    const state = this.state;
    const lit = state.geometryMode.lighting;
    if (!this.validRange(address, n * 16) ||
        (lit && !this.validRange(this.normalAddress + v0 * 2, n * 2))) {
      return;
    }
    if (dis) {
      // RGBA stays RGBA even when lighting is enabled; normals live elsewhere.
      this.previewVertex(v0, n, new DataView(this.ramDV.buffer, this.ramDV.byteOffset + address, n * 16), dis, false);
    }
    const modelview = state.modelview.at(-1);
    const combined = state.getCombinedMatrix();
    const directions = lit ? this.lights.map(l => modelDirection(modelview, l.dir)) : [];
    const lookAt = lit && state.geometryMode.textureGen && this.lookAtEnabled
      ? this.lookAt.map(dir => modelDirection(modelview, dir)) : null;
    const xyz = new Vector3();
    const normal = new Vector3();
    const clipPos = new Vector4();
    const texNormal = new Vector3();
    const fog = state.geometryMode.fog ? state.fogParameters : null;
    for (let i = 0; i < n; ++i) {
      const base = address + i * 16;
      const vertex = state.projectedVertices[v0 + i];
      xyz.set(this.ramDV.getInt16(base), this.ramDV.getInt16(base + 2), this.ramDV.getInt16(base + 4));
      vertex.u = this.ramDV.getInt16(base + 8) * state.texture.scaleS / 32;
      vertex.v = this.ramDV.getInt16(base + 10) * state.texture.scaleT / 32;
      vertex.color = this.ramDV.getUint32(base + 12, true);
      if (lit) {
        const normalBase = this.normalAddress + (v0 + i) * 2;
        normal.set(this.ramDV.getInt8(normalBase) / 127, this.ramDV.getInt8(normalBase + 1) / 127, this.ramDV.getInt8(base + 7) / 127);
        // Negative flags bypass colour lighting, but still permit texgen/fog.
        if (this.ramDV.getInt16(base + 6) >= 0) {
          combined.transformPoint(xyz, clipPos);
          vertex.color = this.lightVertex(vertex.color, normal, clipPos, directions);
        }
        if (state.geometryMode.textureGen) {
          if (lookAt) {
            texNormal.set(normal.dot(lookAt[0]), normal.dot(lookAt[1]), 0);
          } else {
            modelview.transformNormal(normal, texNormal);
            texNormal.normaliseInPlace();
          }
          const x = Math.max(-1, Math.min(1, texNormal.x));
          const y = Math.max(-1, Math.min(1, texNormal.y));
          vertex.u = state.geometryMode.textureGenLinear ? Math.acos(-x) / Math.PI : (x + 1) / 2;
          vertex.v = state.geometryMode.textureGenLinear ? Math.acos(-y) / Math.PI : (y + 1) / 2;
        }
      }
      vertex.set = true;
      this.projectInPlace(vertex, xyz, combined, state.viewport.transform, this.renderer.nativeTransform.viTransform, fog);
    }
  }

  lightVertex(color, normal, clipPos, directions) {
    const count = this.state.numLights;
    const rgb = this.lights[count].color.slice();
    const modifier = this.coordMod;
    const x = (clipPos.x + modifier[8]) * modifier[12];
    const y = (clipPos.y + modifier[9]) * modifier[13];
    const z = (clipPos.z + modifier[10]) * modifier[14];
    for (let i = 0; i < count; ++i) {
      const light = this.lights[i];
      let intensity;
      if (i === count - 1) {
        // The final non-ambient slot is directional, used only by the overlay.
        intensity = this.advancedLighting ? Math.max(0, Math.min(1, normal.dot(directions[i]))) : 0;
      } else {
        const distanceSquared = (x - light.pos.x) ** 2 + (y - light.pos.y) ** 2 + (z - light.pos.z) ** 2;
        intensity = light.attenuation > 0 ? Math.min(1, light.attenuation * 32768 / distanceSquared) : 0;
        if (this.advancedLighting && (this.state.geometryModeBits & pointLightingBit)) {
          intensity *= Math.max(0, Math.min(1, normal.dot(directions[i])));
        }
      }
      for (let c = 0; c < 3; ++c) {
        rgb[c] += light.color[c] * intensity;
      }
    }
    const channels = rgb.map((intensity, c) => Math.trunc(((color >>> (8 * c)) & 0xff) * Math.min(1, intensity)));
    return (color & 0xff000000) | channels[0] | (channels[1] << 8) | (channels[2] << 16);
  }

  executeTri4(cmd0, cmd1, dis) {
    const tb = this.triangleBuffer;
    tb.reset();
    // Bound commands even when every triangle is degenerate. executeBatch also
    // respects counted lists and debugger bail points; an opcode change flushes.
    const commands = this.state.executeBatch(dis ? 1 : tb.maxTris / 4, (a, b) => {
      const indices = [
        (a >>> 23) & 31, (a >>> 18) & 31, ((a >>> 13) & 28) | (b >>> 30),
        (a >>> 10) & 31, (a >>> 5) & 31, a & 31,
        (b >>> 25) & 31, (b >>> 20) & 31, (b >>> 15) & 31,
        (b >>> 10) & 31, (b >>> 5) & 31, b & 31,
      ];
      if (dis) {
        dis.text(`gsSPConker4Triangles(${indices.join(', ')});`);
      }
      for (let i = 0; i < indices.length; i += 3) {
        this.pushTriangle(indices[i], indices[i + 1], indices[i + 2]);
      }
      return tb.hasCapacity(4);
    });
    this.state.currentOp += commands - 1;
    this.renderer.flushTris(tb);
  }

  pushTriangle(a, b, c) {
    if (a >= vertexCount || b >= vertexCount || c >= vertexCount) {
      this.warn('Conker triangle index out of bounds', `${a}, ${b}, ${c}`);
      return;
    }
    super.pushTriangle(a, b, c);
  }
}

// Light and look-at directions use the transposed modelview, without translation.
function modelDirection(matrix, dir) {
  const m = matrix.elems;
  return new Vector3(
    m[0] * dir.x + m[4] * dir.y + m[8] * dir.z,
    m[1] * dir.x + m[5] * dir.y + m[9] * dir.z,
    m[2] * dir.x + m[6] * dir.y + m[10] * dir.z,
  ).normaliseInPlace();
}
