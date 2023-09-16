import * as gbi from './gbi.js';
import { Matrix4x4 } from "../graphics/Matrix4x4.js";
import { Tile } from "./tile.js";
import { ProjectedVertex } from "./triangle_buffer.js";
import { Vector2 } from "../graphics/Vector2.js";
import { Vector3 } from "../graphics/Vector3.js";
import { TMEM } from './tmem.js';

export class RSPState {
  constructor() {
    this.pc = 0;
    this.dlistStack = [];
    this.segments = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    this.tiles = new Array(8);
    this.lights = new Array(8);
    this.numLights = 0;
    this.geometryModeBits = 0; // raw geometry mode, GBI specific
    this.geometryMode = { // unpacked geometry mode
      zbuffer: 0,
      texture: 0,
      shade: 0,
      shadeSmooth: 0,
      cullFront: 0,
      cullBack: 0,
      fog: 0,
      lighting: 0,
      textureGen: 0,
      textureGenLinear: 0,
      lod: 0
    };
    this.rdpOtherModeL = 0;
    this.rdpOtherModeH = 0;

    this.rdpHalf1 = 0;
    this.rdpHalf2 = 0;

    this.viewport = {
      scale: new Vector2(160.0, 120.0),
      trans: new Vector2(160.0, 120.0),
    };

    // matrix stacks
    this.projection = [];
    this.modelview = [];

    /**
     * @type {!Array<!ProjectedVertex>}
     */
    this.projectedVertices = new Array(64);

    this.scissor = {
      mode: 0,
      x0: 0,
      y0: 0,
      x1: 320,
      y1: 240,
    };

    this.texture = {
      tile: 0,
      level: 0,
      scaleS: 1.0,
      scaleT: 1.0
    };

    this.combine = {
      lo: 0,
      hi: 0
    };

    this.fillColor = 0;
    this.envColor = 0;
    this.primColor = 0;
    this.blendColor = 0;
    this.fogColor = 0;

    this.primDepth = 0.0;

    this.colorImage = {
      format: 0,
      size: 0,
      width: 0,
      address: 0
    };

    this.textureImage = new TextureImage();

    this.depthImage = {
      address: 0
    };

    this.tmem = new TMEM();

    this.screenContext2d = null; // canvas context
  }

  reset(pc) {
    this.rdpOtherModeL = 0x00500001;
    this.rdpOtherModeH = 0x00000000;

    this.projection = [Matrix4x4.identity()];
    this.modelview = [Matrix4x4.identity()];

    this.geometryModeBits = 0;
    this.geometryMode.zbuffer = 0;
    this.geometryMode.texture = 0;
    this.geometryMode.shade = 0;
    this.geometryMode.shadeSmooth = 0;
    this.geometryMode.cullFront = 0;
    this.geometryMode.cullBack = 0;
    this.geometryMode.fog = 0;
    this.geometryMode.lighting = 0;
    this.geometryMode.textureGen = 0;
    this.geometryMode.textureGenLinear = 0;
    this.geometryMode.lod = 0;

    this.pc = pc;
    this.dlistStack = [];
    for (let i = 0; i < this.segments.length; ++i) {
      this.segments[i] = 0;
    }

    for (let i = 0; i < this.tiles.length; ++i) {
      this.tiles[i] = new Tile();
    }

    this.numLights = 0;
    for (let i = 0; i < this.lights.length; ++i) {
      this.lights[i] = { color: { r: 0, g: 0, b: 0, a: 0 }, dir: Vector3.create([1, 0, 0]) };
    }

    for (let i = 0; i < this.projectedVertices.length; ++i) {
      this.projectedVertices[i] = new ProjectedVertex();
    }

    this.viewport = {
      scale: new Vector2(160, 120),
      trans: new Vector2(160, 120),
    };
  }

  rdpSegmentAddress(addr) {
    const segment = (addr >>> 24) & 0xf;
    // TODO: this should probably mask against 0x00ff_ffff (same as SP_DRAM_ADDR_REG)
    // but that can result in out of bounds accesses in some DataViews (e.g. Wetrix)
    // which tries to load from 0x00f000ff. Really we should try to emulate SP DMA more accurately.
    return (this.segments[segment] & 0x007fffff) + (addr & 0x007fffff);
  }
 

  setTexture(s, t, level, tileIdx) {
    this.texture.scaleS = s;
    this.texture.scaleT = t;
    this.texture.level = level;
    this.texture.tile = tileIdx;
  }

  updateGeometryModeFromBits(flags) {
    var gm = this.geometryMode;
    var bits = this.geometryModeBits;

    gm.zbuffer = (bits & flags.G_ZBUFFER) ? 1 : 0;
    gm.texture = (bits & flags.G_TEXTURE_ENABLE) ? 1 : 0;
    gm.shade = (bits & flags.G_SHADE) ? 1 : 0;
    gm.shadeSmooth = (bits & flags.G_SHADING_SMOOTH) ? 1 : 0;
    gm.cullFront = (bits & flags.G_CULL_FRONT) ? 1 : 0;
    gm.cullBack = (bits & flags.G_CULL_BACK) ? 1 : 0;
    gm.fog = (bits & flags.G_FOG) ? 1 : 0;
    gm.lighting = (bits & flags.G_LIGHTING) ? 1 : 0;
    gm.textureGen = (bits & flags.G_TEXTURE_GEN) ? 1 : 0;
    gm.textureGenLinear = (bits & flags.G_TEXTURE_GEN_LINEAR) ? 1 : 0;
    gm.lod = (bits & flags.G_LOD) ? 1 : 0;
  }

  getCycleType() { return this.rdpOtherModeH & gbi.G_CYC_MASK; }
  getTextureFilterType() { return this.rdpOtherModeH & gbi.G_TF_MASK; }
  getTextureLUTType() { return this.rdpOtherModeH & gbi.G_TT_MASK; }
  getAlphaCompareType() { return this.rdpOtherModeL & gbi.G_AC_MASK; }
  // fragment coverage (0) or alpha (1)?
  getCoverageTimesAlpha() { return (this.rdpOtherModeL & gbi.RenderMode.CVG_X_ALPHA) !== 0; }
  // use fragment coverage * fragment alpha
  getAlphaCoverageSelect() { return (this.rdpOtherModeL & gbi.RenderMode.ALPHA_CVG_SEL) !== 0; }
}

class TextureImage {
  constructor() {
    this.format = 0;
    this.size = 0;
    this.width = 0;
    this.address = 0;
  }

  set(format, size, width, address) {
    this.format = format;
    this.size = size;
    this.width = width;
    this.address = address;
  }

  calcAddress(uls, ult, sizeOverride) {
    const size = (sizeOverride === undefined) ? this.size : sizeOverride;
    return this.address + (ult * texelsToBytes(this.width, size)) + texelsToBytes(uls, size);
  }

  texelsToBytes(texels) {
    return texelsToBytes(texels, this.size);
  }

  stride() {
    return this.texelsToBytes(this.width);
  }
}

function texelsToBytes(texels, size) {
  return (texels << size) >>> 1;
}
