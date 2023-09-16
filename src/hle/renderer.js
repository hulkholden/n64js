import { Vector2 } from "../graphics/Vector2.js";
import * as gbi from './gbi.js';
import * as shaders from './shaders.js';

export class Renderer {
  constructor(gl, state, nativeTransform) {
    this.gl = gl;
    this.state = state;
    this.nativeTransform = nativeTransform;

    this.fillShaderProgram = shaders.createShaderProgram(gl, "fill-shader-vs", "fill-shader-fs");
    this.fillVertexPositionAttribute = gl.getAttribLocation(this.fillShaderProgram, "aVertexPosition");
    this.fillFillColorUniform = gl.getUniformLocation(this.fillShaderProgram, "uFillColor");
    this.fillVerticesBuffer = gl.createBuffer();
  }

  fillRect(x0, y0, x1, y1, color) {
    const gl = this.gl;

    this.setGLBlendMode();

    const display0 = this.nativeTransform.convertN64ToDisplay(new Vector2(x0, y0));
    const display1 = this.nativeTransform.convertN64ToDisplay(new Vector2(x1, y1));

    const vertices = [
      display1.x, display1.y, 0.0, 1.0,
      display0.x, display1.y, 0.0, 1.0,
      display1.x, display0.y, 0.0, 1.0,
      display0.x, display0.y, 0.0, 1.0,
    ];

    gl.useProgram(this.fillShaderProgram);

    // aVertexPosition
    gl.enableVertexAttribArray(this.fillVertexPositionAttribute);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fillVerticesBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    gl.vertexAttribPointer(this.fillVertexPositionAttribute, 4, gl.FLOAT, false, 0, 0);

    // uFillColor
    gl.uniform4f(this.fillFillColorUniform, color.r, color.g, color.b, color.a);

    // Disable culling and depth testing.
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  texRect(tileIdx, x0, y0, x1, y1, s0, t0, s1, t1, flip) {
    const gl = this.gl;

    // TODO: check scissor

    const display0 = this.nativeTransform.convertN64ToDisplay(new Vector2(x0, y0));
    const display1 = this.nativeTransform.convertN64ToDisplay(new Vector2(x1, y1));
    const depthSourcePrim = (this.state.rdpOtherModeL & gbi.DepthSource.G_ZS_PRIM) !== 0;
    const depth = depthSourcePrim ? this.state.primDepth : 0.0;

    const vertices = [
      display0.x, display0.y, depth, 1.0,
      display1.x, display0.y, depth, 1.0,
      display0.x, display1.y, depth, 1.0,
      display1.x, display1.y, depth, 1.0
    ];

    let uvs;

    if (flip) {
      uvs = [
        s0, t0,
        s0, t1,
        s1, t0,
        s1, t1,
      ];
    } else {
      uvs = [
        s0, t0,
        s1, t0,
        s0, t1,
        s1, t1,
      ];
    }

    const colours = [0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff];

    this.setProgramState(new Float32Array(vertices), new Uint32Array(colours), new Float32Array(uvs),
      true /* textureEnabled */, false /*texGenEnabled*/, tileIdx);

    gl.disable(gl.CULL_FACE);

    const depthEnabled = depthSourcePrim ? true : false;
    if (depthEnabled) {
      this.initDepth();
    } else {
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

}