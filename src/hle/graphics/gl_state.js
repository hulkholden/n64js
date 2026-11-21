// Tracks active WebGL context state for Renderer and TMEMTexture so redundant
// per-draw state changes can be skipped. Call reset() or targeted invalidators
// whenever raw WebGL calls mutate state outside this tracker.
export class GLState {
  constructor(gl) {
    this.gl = gl;
    this.reset();
  }

  reset() {
    this.program = undefined;
    this.vao = undefined;
    this.arrayBuffer = undefined;
    this.activeTexture = -1;
    this.texture0 = undefined;

    this.scissorEnabled = -1;
    this.scissorX = NaN;
    this.scissorY = NaN;
    this.scissorW = NaN;
    this.scissorH = NaN;

    this.depthRangeNear = NaN;
    this.depthRangeFar = NaN;
    this.depthTestEnabled = -1;
    this.depthFunc = -1;
    this.depthMask = -1;

    this.cullFaceEnabled = -1;
    this.cullFaceMode = -1;

    this.blendEnabled = -1;
    this.blendSrcRGB = -1;
    this.blendDstRGB = -1;
    this.blendSrcAlpha = -1;
    this.blendDstAlpha = -1;
    this.blendEquation = -1;
    this.blendColorAlpha = NaN;
  }

  invalidateTexture() {
    this.activeTexture = -1;
    this.texture0 = undefined;
  }

  invalidateVertexArray() {
    this.vao = undefined;
    this.arrayBuffer = undefined;
  }

  useProgram(program) {
    if (this.program !== program) {
      this.program = program;
      this.gl.useProgram(program);
    }
  }

  bindVertexArray(vao) {
    if (this.vao !== vao) {
      this.vao = vao;
      this.gl.bindVertexArray(vao);
    }
  }

  bindArrayBuffer(buffer) {
    if (this.arrayBuffer !== buffer) {
      this.arrayBuffer = buffer;
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
    }
  }

  bindTexture0(texture) {
    const gl = this.gl;
    if (this.activeTexture !== gl.TEXTURE0) {
      this.activeTexture = gl.TEXTURE0;
      gl.activeTexture(gl.TEXTURE0);
    }
    if (this.texture0 !== texture) {
      this.texture0 = texture;
      gl.bindTexture(gl.TEXTURE_2D, texture);
    }
  }

  setScissorEnabled(enabled) {
    const state = enabled ? 1 : 0;
    if (this.scissorEnabled !== state) {
      this.scissorEnabled = state;
      if (enabled) {
        this.gl.enable(this.gl.SCISSOR_TEST);
      } else {
        this.gl.disable(this.gl.SCISSOR_TEST);
      }
    }
  }

  setScissor(x, y, w, h) {
    this.setScissorEnabled(true);
    if (this.scissorX !== x || this.scissorY !== y ||
        this.scissorW !== w || this.scissorH !== h) {
      this.scissorX = x;
      this.scissorY = y;
      this.scissorW = w;
      this.scissorH = h;
      this.gl.scissor(x, y, w, h);
    }
  }

  setDepthRange(near, far) {
    if (this.depthRangeNear !== near || this.depthRangeFar !== far) {
      this.depthRangeNear = near;
      this.depthRangeFar = far;
      this.gl.depthRange(near, far);
    }
  }

  setDepthTestEnabled(enabled) {
    const state = enabled ? 1 : 0;
    if (this.depthTestEnabled !== state) {
      this.depthTestEnabled = state;
      if (enabled) {
        this.gl.enable(this.gl.DEPTH_TEST);
      } else {
        this.gl.disable(this.gl.DEPTH_TEST);
      }
    }
  }

  setDepthFunc(func) {
    if (this.depthFunc !== func) {
      this.depthFunc = func;
      this.gl.depthFunc(func);
    }
  }

  setDepthMask(enabled) {
    const state = enabled ? 1 : 0;
    if (this.depthMask !== state) {
      this.depthMask = state;
      this.gl.depthMask(enabled);
    }
  }

  setCullFaceEnabled(enabled) {
    const state = enabled ? 1 : 0;
    if (this.cullFaceEnabled !== state) {
      this.cullFaceEnabled = state;
      if (enabled) {
        this.gl.enable(this.gl.CULL_FACE);
      } else {
        this.gl.disable(this.gl.CULL_FACE);
      }
    }
  }

  setCullFace(enabled, mode) {
    this.setCullFaceEnabled(enabled);
    if (enabled && this.cullFaceMode !== mode) {
      this.cullFaceMode = mode;
      this.gl.cullFace(mode);
    }
  }

  setBlendEnabled(enabled) {
    const state = enabled ? 1 : 0;
    if (this.blendEnabled !== state) {
      this.blendEnabled = state;
      if (enabled) {
        this.gl.enable(this.gl.BLEND);
      } else {
        this.gl.disable(this.gl.BLEND);
      }
    }
  }

  setBlendFunc(srcRGB, dstRGB, srcAlpha = srcRGB, dstAlpha = dstRGB) {
    if (this.blendSrcRGB !== srcRGB || this.blendDstRGB !== dstRGB ||
        this.blendSrcAlpha !== srcAlpha || this.blendDstAlpha !== dstAlpha) {
      this.blendSrcRGB = srcRGB;
      this.blendDstRGB = dstRGB;
      this.blendSrcAlpha = srcAlpha;
      this.blendDstAlpha = dstAlpha;
      if (srcRGB === srcAlpha && dstRGB === dstAlpha) {
        this.gl.blendFunc(srcRGB, dstRGB);
      } else {
        this.gl.blendFuncSeparate(srcRGB, dstRGB, srcAlpha, dstAlpha);
      }
    }
  }

  setBlendEquation(mode) {
    if (this.blendEquation !== mode) {
      this.blendEquation = mode;
      this.gl.blendEquation(mode);
    }
  }

  setBlendColorAlpha(alpha) {
    if (this.blendColorAlpha !== alpha) {
      this.blendColorAlpha = alpha;
      this.gl.blendColor(0, 0, 0, alpha);
    }
  }
}
