import { toString32 } from '../format.js';
import { Vector3 } from '../graphics/Vector3.js';
import * as gbi from './gbi.js';
import { GBI2 } from './gbi2.js';

// F3DFLX replaces texture generation with a normal-indexed alpha lookup.
// F-Zero X uses that alpha to blend car reflections with the RDP fog colour.
// Reference: https://github.com/gonetz/GLideN64/blob/master/src/uCodes/F3DFLX2.cpp
// and gSPProcessVertex in https://github.com/gonetz/GLideN64/blob/master/src/gSP.cpp.
export class GBI2FLX extends GBI2 {
  constructor(state, ramDV) {
    super(state, ramDV);
    // Retain the raw bit for alpha lighting, but neither generate UVs nor
    // ask the renderer to rescale the supplied texture coordinates.
    this.geometryModeFlags = { ...gbi.GeometryModeGBI2, G_TEXTURE_GEN: 0 };
    this.alphaLight = new Vector3();
    this.alphaTableAddress = 0;
  }

  executeDmaIo(cmd0, cmd1, dis) {
    this.alphaTableAddress = this.state.rdpSegmentAddress(cmd1);
    if (dis) {
      dis.text(`gsSPF3DFLXAlphaTable(${toString32(this.alphaTableAddress)});`);
    }
  }

  executeMoveMem(cmd0, cmd1, dis) {
    const offset = ((cmd0 >>> 8) & 0xff) << 3;
    const type = cmd0 & 0xfe;
    if (type !== gbi.MoveMemGBI2.G_GBI2_MV_LIGHT || offset !== gbi.MoveMemGBI2.G_GBI2_MVO_LOOKATY) {
      super.executeMoveMem(cmd0, cmd1, dis);
      return;
    }
    const address = this.state.rdpSegmentAddress(cmd1);
    // Unlike ordinary signed-byte light directions, these are signed 8.8.
    this.alphaLight.set(
      this.ramDV.getInt16(address + 8) / 256,
      this.ramDV.getInt16(address + 10) / 256,
      this.ramDV.getInt16(address + 12) / 256,
    ).normaliseInPlace();
    if (dis) {
      dis.text(`gsSPF3DFLXAlphaLight(${toString32(address)});`);
    }
  }

  loadVertices(v0, n, address, dis) {
    super.loadVertices(v0, n, address, dis);
    const state = this.state;
    if (v0 + n > state.projectedVertices.length || !state.geometryMode.lighting ||
        !(state.geometryModeBits & gbi.GeometryModeGBI2.G_TEXTURE_GEN) || state.geometryMode.fog) {
      return;
    }

    // Transform the light into model space (transpose the modelview 3x3),
    // then normalize it before taking the dot product with the vertex normal.
    const m = state.modelview.at(-1).elems;
    const light = this.alphaLight;
    const direction = new Vector3(
      m[0] * light.x + m[4] * light.y + m[8] * light.z,
      m[1] * light.x + m[5] * light.y + m[9] * light.z,
      m[2] * light.x + m[6] * light.y + m[10] * light.z,
    ).normaliseInPlace();
    for (let i = 0; i < n; ++i) {
      const normal = address + i * 16 + 12;
      const dot = direction.x * this.ramDV.getInt8(normal) +
        direction.y * this.ramDV.getInt8(normal + 1) +
        direction.z * this.ramDV.getInt8(normal + 2);
      const index = Math.max(0, Math.min(255, 128 + Math.trunc(dot * 128 / 127)));
      const alpha = this.ramDV.getUint8(this.alphaTableAddress + index);
      const vertex = state.projectedVertices[v0 + i];
      vertex.color = (vertex.color & 0xffffff) | (alpha << 24);
    }
  }
}
