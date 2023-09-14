import { Matrix4x4 } from "../graphics/Matrix4x4.js";
import { Tile } from "../graphics/Tile.js";
import { ProjectedVertex } from "../graphics/TriangleBuffer.js";
import { Vector2 } from "../graphics/Vector2.js";
import { Vector3 } from "../graphics/Vector3.js";

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

    this.textureImage = {
      format: 0,
      size: 0,
      width: 0,
      address: 0
    };

    this.depthImage = {
      address: 0
    };

    const tmemBuffer = new ArrayBuffer(4096);
    this.tmemData32 = new Int32Array(tmemBuffer);
    this.tmemData = new Uint8Array(tmemBuffer);

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
}