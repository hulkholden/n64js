/*global n64js*/

import { toString16 } from "../../format.js";
import { Vector2 } from "../../graphics/Vector2.js";
import * as gbi from './gbi.js';
import * as rdp_blend from './rdp_blend_constants.js';
import { CRTMode, graphicsOptions } from './graphics_options.js';
import { GLState } from './gl_state.js';
import { RendererBase } from './renderer_base.js';
import { RenderTargets } from './render_targets.js';
import * as shaders from './shaders.js';
import { TMEMTexture } from './tmem_texture.js';
import { getTexturePaletteFormat } from './texture_format.js';
import { VertexArray } from "./vertex_array.js";
import blitVertexSource from './shaders/blit.vert.glsl' with { type: 'text' };
import blitFragmentSource from './shaders/blit.frag.glsl' with { type: 'text' };
import simpleCRTSource from './shaders/crt_simple.glsl' with { type: 'text' };
import mattiasCRTSource from './shaders/crt_mattias.glsl' with { type: 'text' };
import fillVertexSource from './shaders/fill.vert.glsl' with { type: 'text' };
import fillFragmentSource from './shaders/fill.frag.glsl' with { type: 'text' };

const kBlendModeUnknown = 0;
const kBlendModeOpaque = 1;
const kBlendModeAlphaTrans = 2;
const kBlendModeFade = 3;
const kBlendModeConstantFog = 4;

// Map to keep track of which unimplemented blend modes we've already warned about.
const loggedBlendModes = new Map();

export class Renderer extends RendererBase {
  constructor(gl, state, initialWidth, initialHeight) {
    super(state);
    this.gl = gl;
    this.glState = new GLState(gl);

    this.tmemTexture = new TMEMTexture(gl, 4096, this.glState);

    this._renderTargets = null;
    this.renderTargets = new RenderTargets(gl, initialWidth, initialHeight);

    // Allocate textures only when CPU video is presented. Progressive video
    // uses slot 0; interlaced video retains each field and its own VI mapping.
    this.cpuFramebuffers = [null, null];
    this.cpuFramebufferBitDepth = 0;
    this.cpuFramebufferInterlaced = false;

    this.blitShaderProgram = shaders.createShaderProgram(gl, blitVertexSource, blitFragmentSource + simpleCRTSource + mattiasCRTSource);
    this.blitSamplerUniform = gl.getUniformLocation(this.blitShaderProgram, "uSampler0");
    this.blitFieldSamplerUniform = gl.getUniformLocation(this.blitShaderProgram, "uSampler1");
    this.blitInterlacedUniform = gl.getUniformLocation(this.blitShaderProgram, "uInterlaced");
    this.blitVIResolutionUniform = gl.getUniformLocation(this.blitShaderProgram, "uVIResolution");
    this.blitCRTUniform = gl.getUniformLocation(this.blitShaderProgram, "uCRTMode");
    this.blitCurvatureUniform = gl.getUniformLocation(this.blitShaderProgram, "uCRTCurvature");
    this.blitTimeUniform = gl.getUniformLocation(this.blitShaderProgram, "uCRTTime");
    this.blitOutputResolutionUniform = gl.getUniformLocation(this.blitShaderProgram, "uOutputResolution");
    this.blitSourceHeightUniform = gl.getUniformLocation(this.blitShaderProgram, "uSourceHeight");
    this.blitSourceUVUniform = gl.getUniformLocation(this.blitShaderProgram, "uSourceUV[0]");
    this.blitSourceBoundsUniform = gl.getUniformLocation(this.blitShaderProgram, "uSourceBounds[0]");
    this.blitSourceVIUniform = gl.getUniformLocation(this.blitShaderProgram, "uSourceVI");
    this.blitVA = this.initBlitVA(this.blitShaderProgram);

    // Smooth only the CRT presentation, without changing the framebuffer textures.
    this.crtSampler = gl.createSampler();
    gl.samplerParameteri(this.crtSampler, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.samplerParameteri(this.crtSampler, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.samplerParameteri(this.crtSampler, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.samplerParameteri(this.crtSampler, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.fillShaderProgram = shaders.createShaderProgram(gl, fillVertexSource, fillFragmentSource);
    this.fillFillColorUniform = gl.getUniformLocation(this.fillShaderProgram, "uFillColor");
    this.fillColorR = NaN;
    this.fillColorG = NaN;
    this.fillColorB = NaN;
    this.fillColorA = NaN;
    this.fillRectVA = this.initFillRectVA(this.fillShaderProgram);
    this.debugClearVA = this.initClearVA(this.fillShaderProgram);
    this.n64VA = this.initN64VA();

    this.currentShader = new CurrentShader();
    this.glState.reset();
  }

  get renderTargets() { return this._renderTargets; }

  set renderTargets(targets) {
    if (this._renderTargets) {
      this._renderTargets.onTextureBindingChange = null;
    }
    this._renderTargets = targets;
    if (targets) {
      targets.onTextureBindingChange = () => this.glState?.invalidateTexture();
    }
    this.glState?.reset();
  }

  initN64VA() {
    const va = new VertexArray(this.gl);
    va.initInterleavedN64Attrs();
    this.glState?.invalidateVertexArray();
    return va;
  }

  get frameBuffer() { return this.renderTargets.current.framebuffer; }

  setColorImage(image) {
    this.renderTargets.bindColorImage(image, this.nativeTransform.viWidth, this.nativeTransform.viHeight);
  }

  syncFramebufferToRAM(address, ramDV) {
    this.renderTargets.syncToRAM(address, ramDV);
  }

  markFramebufferDirty(positions, numVertices = positions.length / 4) {
    let maxY = 0;
    for (let i = 0; i < numVertices; i++) {
      const w = positions[i * 4 + 3];
      // Primitives crossing the near plane can extend beyond their projected
      // vertices. In that case use the scissor limit conservatively.
      if (w <= 0) {
        maxY = this.state.scissor.y1;
        break;
      }
      const y = (1 - positions[i * 4 + 1] / w) * this.nativeTransform.viHeight / 2;
      maxY = Math.max(maxY, y);
    }
    this.renderTargets.markDirty(this.state.scissor, maxY);
  }

  reset() {
    this.currentShader?.reset();
    this.resetCPUFramebuffers();
    this.renderTargets.reset();
    this.tmemTexture?.reset();
    this.glState?.reset();
  }

  resetCPUFramebuffers() {
    for (const frame of this.cpuFramebuffers) {
      if (frame) {
        this.gl.deleteTexture(frame.texture);
      }
    }
    this.cpuFramebuffers = [null, null];
    this.cpuFramebufferBitDepth = 0;
    this.cpuFramebufferInterlaced = false;
    this.glState?.invalidateTexture();
  }

  newFrame() {
    this.currentShader?.reset();
    this.glState?.reset();
    const gl = this.gl;
    this.renderTargets.beginFrame(this.state.ramDV);
    // Render everything to the back buffer. This prevents horrible flickering
    // if due to webgl clearing our context between updates.
    this.renderTargets.bindCurrent();
    // Set the viewport to match the framebuffer dimensions.
    gl.viewport(0, 0, this.frameBuffer.width, this.frameBuffer.height);
  }

  initBlitVA(program) {
    const gl = this.gl;
    const va = new VertexArray(gl);

    const positions = [
      -1, -1, 0, 1,
      1, -1, 0, 1,
      -1, 1, 0, 1,
      1, 1, 0, 1,
    ];
    va.initPosAttr(program, "aPosition");
    va.setPosData(new Float32Array(positions), gl.STATIC_DRAW);

    const uvs = [
      0, 0,
      1, 0,
      0, 1,
      1, 1,
    ];
    va.initUVsAttr(program, "aUV");
    va.setUVData(new Float32Array(uvs), gl.STATIC_DRAW);

    return va;
  }

  copyTextureToFrontBuffer(texture, timeSeconds = 0, presentation = null, fields = null) {
    const gl = this.gl;
    // Passing null binds the framebuffer to the canvas.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(this.blitShaderProgram);

    const canvas = document.getElementById('display');
    gl.viewport(0, 0, canvas.width, canvas.height);

    this.blitVA.bind();

    // Both HLE and CPU framebuffers use this presentation pass.
    const first = fields ? fields[0]?.presentation : presentation;
    const second = fields?.[1]?.presentation;
    const sampler = graphicsOptions.crtMode === CRTMode.Off ? null : this.crtSampler;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fields?.[0]?.texture ?? texture);
    gl.bindSampler(0, sampler);
    gl.activeTexture(gl.TEXTURE1);
    // Both samplers must be complete, even before the second field arrives.
    // Empty bounds below make a missing field black.
    gl.bindTexture(gl.TEXTURE_2D, fields?.[1]?.texture ?? texture);
    gl.bindSampler(1, sampler);
    gl.uniform1i(this.blitSamplerUniform, 0);
    gl.uniform1i(this.blitFieldSamplerUniform, 1);
    gl.uniform1i(this.blitInterlacedUniform, fields ? 1 : 0);
    gl.uniform2f(this.blitVIResolutionUniform, presentation?.viWidth ?? 1, presentation?.viHeight ?? 1);
    gl.uniform1i(this.blitCRTUniform, graphicsOptions.crtMode);
    gl.uniform1f(this.blitCurvatureUniform, graphicsOptions.crtCurvature);
    gl.uniform1f(this.blitTimeUniform, timeSeconds);
    gl.uniform2f(this.blitOutputResolutionUniform, canvas.width, canvas.height);
    gl.uniform1f(this.blitSourceHeightUniform, presentation?.sourceHeight ?? this.nativeTransform.viHeight);
    gl.uniform4fv(this.blitSourceUVUniform, [
      ...(first?.uvTransform ?? [1, 1, 0, 0]), ...(second?.uvTransform ?? [1, 1, 0, 0]),
    ]);
    gl.uniform4fv(this.blitSourceBoundsUniform, [
      ...(first?.bounds ?? (fields ? [0, 0, 0, 0] : [0, 0, 1, 1])), ...(second?.bounds ?? [0, 0, 0, 0]),
    ]);
    gl.uniform1i(this.blitSourceVIUniform, presentation?.uvTransform ? 1 : 0);

    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.depthMask(false);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.blitVA.unbind();
    gl.bindSampler(0, null);
    gl.bindSampler(1, null);
    gl.activeTexture(gl.TEXTURE0);
    this.glState?.reset();
  }

  copyBackBufferToFrontBuffer(address, timeSeconds = 0) {
    // CPU field history must not survive a switch to HLE presentation.
    if (this.cpuFramebufferBitDepth) {
      this.resetCPUFramebuffers();
    }
    const target = this.renderTargets.targetForVI(address);
    this.copyTextureToFrontBuffer(target.texture, timeSeconds, { sourceHeight: target.nativeHeight });
  }

  copyPixelsToFrontBuffer({ pixels, width, height, bitDepth, presentation, field = null }, timeSeconds = 0) {
    const gl = this.gl;
    const interlaced = field !== null;
    if (this.cpuFramebufferBitDepth !== bitDepth || this.cpuFramebufferInterlaced !== interlaced) {
      this.resetCPUFramebuffers();
      this.cpuFramebufferBitDepth = bitDepth;
      this.cpuFramebufferInterlaced = interlaced;
    }
    gl.activeTexture(gl.TEXTURE0);
    const index = field ?? 0;
    let frame = this.cpuFramebuffers[index];
    if (!frame) {
      frame = { texture: gl.createTexture(), presentation: null };
      this.cpuFramebuffers[index] = frame;
      gl.bindTexture(gl.TEXTURE_2D, frame.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, frame.texture);
    }
    frame.presentation = presentation;
    // Native 16-bit images may have an odd row width.
    const unpackAlignment = gl.getParameter(gl.UNPACK_ALIGNMENT);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    if (bitDepth == 32) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    } else if (bitDepth == 16) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_SHORT_5_5_5_1, pixels);
    } else {
      // Invalid mode.
    }

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, unpackAlignment);
    this.copyTextureToFrontBuffer(frame.texture, timeSeconds, presentation, interlaced ? this.cpuFramebuffers : null);
  }

  /**
   * Flushes the contents of a TriangleBuffer.
   * @param {TriangleBuffer} tb 
   * @returns 
   */
  flushTris(tb, { lines = false, affineUV = false } = {}) {
    const gl = this.gl;
    if (tb.empty()) {
      return;
    }

    const textureEnabled = !lines && this.state.geometryMode.texture;
    const texGenEnabled = !lines && this.state.geometryMode.lighting && this.state.geometryMode.textureGen;

    // RSP triangle S/T has half the scale when the RDP perspective divide is
    // disabled (e.g. Wetrix's menu icons). Apply this at draw time, since the
    // mode can change after loading vertices. Only change the flushed buffer;
    // cached vertices and the RDP/S2DEX rectangle paths keep their coordinates.
    // See VertexShaderTexturedTriangle in GLideN64's
    // src/Graphics/OpenGLContext/GLSL/glsl_CombinerProgramBuilderAccurate.cpp.
    if (textureEnabled && (this.state.rdpOtherModeH & gbi.G_TP_MASK) === 0) {
      for (let i = 0; i < tb.numTris * 6; i++) {
        tb.coords[i] *= 0.5;
      }
    }

    this.setProgramState(tb.positions,
      tb.colours,
      tb.coords,
      textureEnabled,
      texGenEnabled,
      this.state.texture.tile,
      tb.numTris * 3, null, this.state.noNearClipping, { affineUV });

    this.initDepth();

    // texture filter

    const glState = getGLState(this);
    if (!lines && (this.state.geometryMode.cullFront || this.state.geometryMode.cullBack)) {
      const mode = (this.state.geometryMode.cullFront) ? gl.FRONT : gl.BACK;
      glState.setCullFace(true, mode);
    } else {
      glState.setCullFaceEnabled(false);
    }

    this.markFramebufferDirty(tb.positions, tb.numTris * 3);
    gl.drawArrays(gl.TRIANGLES, 0, tb.numTris * 3);
    //gl.drawArrays(gl.LINE_STRIP, 0, numTris * 3);
    tb.reset();
  }

  initClearVA(program) {
    const gl = this.gl;
    const va = new VertexArray(gl);

    const positions = [
      +1, +1, 0, 1,
      -1, +1, 0, 1,
      +1, -1, 0, 1,
      -1, -1, 0, 1,
    ];
    va.initPosAttr(program, "aPosition");
    va.setPosData(new Float32Array(positions), gl.STATIC_DRAW);
    return va;
  }

  debugClear() {
    const gl = this.gl;
    const glState = getGLState(this);

    this.renderTargets.bindCurrent();
    glState.setScissorEnabled(false);
    glState.setDepthMask(true);
    gl.clearColor(0, 0, 0, 1);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }

  initFillRectVA(program) {
    const gl = this.gl;
    const va = new VertexArray(gl);
    va.initPosAttr(program, "aPosition");
    va.setPosData(new Float32Array(4 * 4), gl.DYNAMIC_DRAW);
    return va;
  }

  clearDepth(depth) {
    const gl = this.gl;
    this.applyScissor();
    gl.clearDepth(depth);
    getGLState(this).setDepthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
  }

  clearColor(color) {
    const gl = this.gl;
    this.applyScissor();
    gl.clearColor(color.r, color.g, color.b, color.a);
    this.renderTargets.markDirty(this.state.scissor);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  fillRect(x0, y0, x1, y1, color) {
    const gl = this.gl;
    const glState = getGLState(this);

    this.applyScissor();
    this.setGLBlendMode();

    const display0 = this.nativeTransform.convertN64ToDisplay(new Vector2(x0, y0));
    const display1 = this.nativeTransform.convertN64ToDisplay(new Vector2(x1, y1));

    const vertices = [
      display1.x, display1.y, 0.0, 1.0,
      display0.x, display1.y, 0.0, 1.0,
      display1.x, display0.y, 0.0, 1.0,
      display0.x, display0.y, 0.0, 1.0,
    ];

    glState.useProgram(this.fillShaderProgram);
    glState.bindVertexArray(this.fillRectVA.vao);
    glState.bindArrayBuffer(this.fillRectVA.posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);

    // uFillColor
    if (this.fillColorR !== color.r || this.fillColorG !== color.g ||
        this.fillColorB !== color.b || this.fillColorA !== color.a) {
      this.fillColorR = color.r;
      this.fillColorG = color.g;
      this.fillColorB = color.b;
      this.fillColorA = color.a;
      gl.uniform4f(this.fillFillColorUniform, color.r, color.g, color.b, color.a);
    }

    // Disable culling and depth testing.
    glState.setCullFaceEnabled(false);
    glState.setDepthTestEnabled(false);
    glState.setDepthMask(false);

    this.renderTargets.markDirty(this.state.scissor, y1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  lleRect(tileIdx, vertices, uvs, colours, textureRect = null) {
    const gl = this.gl;
    const glState = getGLState(this);

    this.setProgramState(new Float32Array(vertices), new Uint32Array(colours), new Float32Array(uvs),
      true /* textureEnabled */, false /*texGenEnabled*/, tileIdx, vertices.length / 4, textureRect);

    glState.setCullFaceEnabled(false);

    const depthSourcePrim = (this.state.rdpOtherModeL & gbi.DepthSource.G_ZS_PRIM) !== 0;
    if (depthSourcePrim) {
      this.initDepth();
    } else {
      glState.setDepthTestEnabled(false);
      glState.setDepthMask(false);
    }
    this.markFramebufferDirty(vertices);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  texRect(tileIdx, x0, y0, x1, y1, s0, t0, s1, t1, flip) {
    if (x1 === x0 || y1 === y0) {
      return;
    }
    const cycle = this.state.getCycleType();
    // Without AA, the RDP accepts only the coverage sample at the native
    // pixel's upper-left corner. WebGL's pixel-centre coverage can otherwise
    // draw before a fractional rectangle origin and sample a neighbouring
    // atlas glyph (THPS3). Snap coverage, but keep the original S/T origin
    // and derivatives below. Copy/fill use a different coverage rule.
    // See parallel-rdp/shaders/shading.h (coverage & 1) and coverage.h.
    const pointCoverage = !this.state.getAntiAliasEnabled() &&
      (cycle === gbi.CycleType.G_CYC_1CYCLE || cycle === gbi.CycleType.G_CYC_2CYCLE);
    const vertices = pointCoverage
      ? this.calculateRectVertices(Math.ceil(x0), Math.ceil(y0), Math.ceil(x1), Math.ceil(y1))
      : this.calculateRectVertices(x0, y0, x1, y1);
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
    const dsdx = (s1 - s0) / (flip ? y1 - y0 : x1 - x0);
    const dtdy = (t1 - t0) / (flip ? x1 - x0 : y1 - y0);
    this.lleRect(tileIdx, vertices, uvs, colours, { x0, y0, s0, t0, dsdx, dtdy, flip });
  }

  texRectRot(tileIdx, x0, y0, x1, y1, x2, y2, x3, y3, s0, t0, s1, t1) {
    const vertices = this.nativeTransform.calculateRectVerticesRot(x0, y0, x1, y1, x2, y2, x3, y3, 0);
    const uvs = [
      s0, t0,
      s1, t0,
      s0, t1,
      s1, t1,
    ];
    const colours = [0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff];
    this.lleRect(tileIdx, vertices, uvs, colours);
  }

  applyScissor() {
    const { width, height } = this.frameBuffer;
    const { viWidth, viHeight } = this.nativeTransform;
    const { x0, y0, x1, y1 } = this.state.scissor;
    // Use the same VI-space scaling as the vertices, then flip the top-down
    // N64 bounds to WebGL's bottom-left origin. Quantize edges independently
    // so adjacent boxes stay adjacent at noninteger rendering scales.
    const left = Math.round(x0 * width / viWidth);
    const right = Math.round(x1 * width / viWidth);
    const top = Math.round(y0 * height / viHeight);
    const bottom = Math.round(y1 * height / viHeight);
    getGLState(this).setScissor(left, height - bottom, Math.max(0, right - left), Math.max(0, bottom - top));
    // TODO: emulate odd/even scanline selection for interlaced scissor modes.
  }

  initDepth() {
    const gl = this.gl;
    const glState = getGLState(this);

    // TODO: decal mode.
    //if (gRDPOtherMode.zmode == ZMODE_DEC) ...

    const depthSourcePrim = (this.state.rdpOtherModeL & gbi.DepthSource.G_ZS_PRIM) !== 0;
    // A constant window-depth range replaces interpolated Z without changing
    // RSP clipping. XG2 uses this to put its sky behind the track. Divide by
    // 2^15, matching the RDP triangle path's 15.16 fixed-point depth scale.
    const depth = this.state.primDepth / 0x8000;
    glState.setDepthRange(depthSourcePrim ? depth : 0, depthSourcePrim ? depth : 1);

    const zGeomMode = Boolean(this.state.geometryMode.zbuffer);
    const zCmpRenderMode = (this.state.rdpOtherModeL & gbi.RenderMode.Z_CMP) !== 0;
    const zUpdRenderMode = (this.state.rdpOtherModeL & gbi.RenderMode.Z_UPD) !== 0;
    const compare = (zGeomMode || depthSourcePrim) && zCmpRenderMode;

    if (compare || zUpdRenderMode) {
      glState.setDepthTestEnabled(true);
      glState.setDepthFunc(compare ? gl.LEQUAL : gl.ALWAYS);
    } else {
      glState.setDepthTestEnabled(false);
    }

    glState.setDepthMask(zUpdRenderMode);
  }

  setProgramState(positions, colours, coords, textureEnabled, texGenEnabled, tileIdx, numVertices = positions.length / 4, textureRect = null, noNearClipping = false, { affineUV = false } = {}) {
    const gl = this.gl;
    const glState = getGLState(this);

    this.applyScissor();
    this.setGLBlendMode();

    // TODO: I think it would make more sense to check if the texture is referenced in the combiner.
    let tile0, tile1;
    if (textureEnabled) {
      this.observeTextureUse(tileIdx);
      const tileIdx0 = (tileIdx + 0) & 7;
      // With LOD enabled and max level zero, both cycles use the base tile
      // (except in detail mode). Chopper Attack relies on this and leaves the
      // next tile unconfigured. General, per-pixel LOD selection is still TODO.
      // See compute_lod_2cycle in
      // https://github.com/Themaister/parallel-rdp/blob/master/parallel-rdp/shaders/texture.h
      const singleLevelLOD = (this.state.rdpOtherModeH & gbi.G_TL_MASK) !== 0 &&
        this.state.texture.level === 0 && (this.state.rdpOtherModeH & gbi.TextureDetail.G_TD_DETAIL) === 0;
      const tileIdx1 = (tileIdx + (singleLevelLOD ? 0 : 1)) & 7;

      tile0 = this.state.tiles[tileIdx0];
      tile1 = this.getTextureTileCount() === 2 ? this.state.tiles[tileIdx1] : null;
    }

    const shader = this.getCurrentN64Shader(noNearClipping);
    glState.useProgram(shader.program);

    const affineUVInt = affineUV ? 1 : 0;
    if (shader.uAffineUVUniform !== null && shader.affineUV !== affineUVInt) {
      shader.affineUV = affineUVInt;
      gl.uniform1i(shader.uAffineUVUniform, affineUVInt);
    }

    if (!this.n64VA) {
      this.n64VA = this.initN64VA();
    }
    glState.bindVertexArray(this.n64VA.vao);
    glState.bindArrayBuffer(this.n64VA.interleavedBuffer);
    this.n64VA.setInterleavedData(positions, colours, coords, numVertices, false);

    this.tmemTexture.bind(this.state.tmem);
    if (!shader.tmemInitialized) {
      if (shader.uTMEMUniform !== null) {
        gl.uniform1i(shader.uTMEMUniform, 0);
      }
      shader.tmemInitialized = true;
    }
    const enabled0 = this.bindTile(tile0, texGenEnabled, shader.textureUniforms[0]);
    const enabled1 = this.bindTile(tile1, texGenEnabled, shader.textureUniforms[1]);
    const copy = this.state.getCycleType() === gbi.CycleType.G_CYC_COPY;
    if (shader.uTextureFilterUniform !== null) {
      const filter = copy ? gbi.TextureFilter.G_TF_POINT : this.state.getTextureFilterType();
      const filterValue = filter >>> gbi.G_MDSFT_TEXTFILT;
      if (shader.textureFilter !== filterValue) {
        shader.textureFilter = filterValue;
        gl.uniform1i(shader.uTextureFilterUniform, filterValue);
      }
    }
    const textureRectInt = textureRect ? 1 : 0;
    if (shader.uTextureRectEnabledUniform !== null && shader.textureRectEnabled !== textureRectInt) {
      shader.textureRectEnabled = textureRectInt;
      gl.uniform1i(shader.uTextureRectEnabledUniform, textureRectInt);
    }
    if (textureRect) {
      const { x0, y0, s0, t0, dsdx, dtdy, flip } = textureRect;
      const { viWidth, viHeight } = this.nativeTransform;
      if (shader.uTextureRectScreenUniform !== null) {
        const sx = viWidth / this.renderTargets.width;
        const sy = -viHeight / this.renderTargets.height;
        if (shader.rectScreenX !== sx || shader.rectScreenY !== sy || shader.rectScreenW !== viHeight) {
          shader.rectScreenX = sx;
          shader.rectScreenY = sy;
          shader.rectScreenW = viHeight;
          gl.uniform4f(shader.uTextureRectScreenUniform, sx, sy, 0, viHeight);
        }
      }
      if (shader.uTextureRectOriginUniform !== null) {
        // Rectangle interpolation starts on the first native scanline; the
        // copy pipe additionally ignores the fractional X origin.
        const ox = copy ? Math.floor(x0) : x0;
        const oy = Math.floor(y0);
        if (shader.rectOriginX !== ox || shader.rectOriginY !== oy ||
            shader.rectOriginS !== s0 || shader.rectOriginT !== t0) {
          shader.rectOriginX = ox;
          shader.rectOriginY = oy;
          shader.rectOriginS = s0;
          shader.rectOriginT = t0;
          gl.uniform4f(shader.uTextureRectOriginUniform, ox, oy, s0, t0);
        }
      }
      if (shader.uTextureRectDerivativesUniform !== null) {
        const d0 = flip ? 0 : dsdx;
        const d1 = flip ? dtdy : 0;
        const d2 = flip ? dsdx : 0;
        const d3 = flip ? 0 : dtdy;
        if (shader.rectDeriv0 !== d0 || shader.rectDeriv1 !== d1 ||
            shader.rectDeriv2 !== d2 || shader.rectDeriv3 !== d3) {
          shader.rectDeriv0 = d0;
          shader.rectDeriv1 = d1;
          shader.rectDeriv2 = d2;
          shader.rectDeriv3 = d3;
          gl.uniform4f(shader.uTextureRectDerivativesUniform, d0, d1, d2, d3);
        }
      }
    }

    if (shader.uAlphaThresholdUniform !== null) {
      const enableAlphaThreshold = (this.state.getAlphaCompareType() & gbi.AlphaCompare.G_AC_THRESHOLD) !== 0;
      // If CVG_X_ALPHA is set with AA_EN (and without threshold compare), the
      // shader discards alpha <= 0 directly rather than reading uAlphaThreshold.
      const alphaThreshold = enableAlphaThreshold ? ((this.state.blendColor >>> 0) & 0xff) / 255.0 : 0;
      if (shader.alphaThreshold !== alphaThreshold) {
        shader.alphaThreshold = alphaThreshold;
        gl.uniform1f(shader.uAlphaThresholdUniform, alphaThreshold);
      }
    }

    const k = this.state.convert;
    if (shader.uConvertUniform !== null) {
      const k0 = k[0];
      const k1 = k[1];
      const k2 = k[2];
      const k3 = k[3];
      if (shader.convert0 !== k0 || shader.convert1 !== k1 ||
          shader.convert2 !== k2 || shader.convert3 !== k3) {
        shader.convert0 = k0;
        shader.convert1 = k1;
        shader.convert2 = k2;
        shader.convert3 = k3;
        gl.uniform4f(shader.uConvertUniform, (k0 * 2 + 1) / 256, (k1 * 2 + 1) / 256,
          (k2 * 2 + 1) / 256, (k3 * 2 + 1) / 256);
      }
    }
    if (shader.uConvertK45Uniform !== null) {
      const k4 = k[4];
      const k5 = k[5];
      if (shader.convert4 !== k4 || shader.convert5 !== k5) {
        shader.convert4 = k4;
        shader.convert5 = k5;
        gl.uniform2f(shader.uConvertK45Uniform, k4 / 255, k5 / 256);
      }
    }
    if (shader.uTextureConvertUniform !== null) {
      const texConv = (this.state.rdpOtherModeH & gbi.G_TC_MASK) >>> gbi.G_MDSFT_TEXTCONV;
      if (shader.textureConvert !== texConv) {
        shader.textureConvert = texConv;
        gl.uniform1i(shader.uTextureConvertUniform, texConv);
      }
    }
    if (shader.uTextureYUVUniform !== null) {
      const yuv0 = enabled0 && tile0?.format === gbi.ImageFormat.G_IM_FMT_YUV ? 1 : 0;
      const yuv1 = enabled1 && tile1?.format === gbi.ImageFormat.G_IM_FMT_YUV ? 1 : 0;
      const yuvMask = yuv0 | (yuv1 << 1);
      if (shader.textureYUV !== yuvMask) {
        shader.textureYUV = yuvMask;
        gl.uniform2i(shader.uTextureYUVUniform, yuv0, yuv1);
      }
    }

    if (shader.uPrimColorUniform !== null) {
      const primColor = this.state.primColor >>> 0;
      if (shader.primColor !== primColor) {
        shader.primColor = primColor;
        gl.uniform4f(shader.uPrimColorUniform,
          ((primColor >>> 24) & 0xff) / 255.0,
          ((primColor >>> 16) & 0xff) / 255.0,
          ((primColor >>> 8) & 0xff) / 255.0,
          (primColor & 0xff) / 255.0);
      }
    }
    if (shader.uPrimLodFracUniform !== null) {
      const primLodFrac = this.state.primLodFrac;
      if (shader.primLodFrac !== primLodFrac) {
        shader.primLodFrac = primLodFrac;
        gl.uniform1f(shader.uPrimLodFracUniform, primLodFrac / 255.0);
      }
    }
    if (shader.uEnvColorUniform !== null) {
      const envColor = this.state.envColor >>> 0;
      if (shader.envColor !== envColor) {
        shader.envColor = envColor;
        gl.uniform4f(shader.uEnvColorUniform,
          ((envColor >>> 24) & 0xff) / 255.0,
          ((envColor >>> 16) & 0xff) / 255.0,
          ((envColor >>> 8) & 0xff) / 255.0,
          (envColor & 0xff) / 255.0);
      }
    }
    if (shader.uFogColorUniform !== null) {
      const fogColor = this.state.fogColor >>> 0;
      if (shader.fogColor !== fogColor) {
        shader.fogColor = fogColor;
        gl.uniform4f(shader.uFogColorUniform,
          ((fogColor >>> 24) & 0xff) / 255.0,
          ((fogColor >>> 16) & 0xff) / 255.0,
          ((fogColor >>> 8) & 0xff) / 255.0,
          (fogColor & 0xff) / 255.0);
      }
    }
  }

  getCurrentN64Shader(noNearClipping = false) {
    this.currentShader ??= new CurrentShader();
    return this.currentShader.getOrCreate(
      this.gl,
      this.state,
      Boolean(noNearClipping),
      this.usesConstantFogColor(),
    );
  }

  bindTile(tile, texGenEnabled, uniforms) {
    const gl = this.gl;
    const enabled = !!tile && tile.format >= 0;
    if (uniforms.enabled === null) {
      return enabled;
    }
    const enabledInt = enabled ? 1 : 0;
    if (uniforms.cachedEnabled !== enabledInt) {
      uniforms.cachedEnabled = enabledInt;
      gl.uniform1i(uniforms.enabled, enabledInt);
    }
    if (!enabled) {
      return false;
    }
    const tmem = tile.tmem << 3;
    const line = tile.line << 3;
    const format = tile.format;
    const size = tile.size;
    if (uniforms.memory !== null && (
      uniforms.cachedTmem !== tmem ||
      uniforms.cachedLine !== line ||
      uniforms.cachedFormat !== format ||
      uniforms.cachedSize !== size)) {
      uniforms.cachedTmem = tmem;
      uniforms.cachedLine = line;
      uniforms.cachedFormat = format;
      uniforms.cachedSize = size;
      gl.uniform4i(uniforms.memory, tmem, line, format, size);
    }

    const palette = tile.palette;
    const tlut = getTexturePaletteFormat(tile, this.state.getTextureLUTType()) >>> gbi.G_MDSFT_TEXTLUT;
    if (uniforms.palette !== null && (
      uniforms.cachedPalette !== palette ||
      uniforms.cachedTlut !== tlut)) {
      uniforms.cachedPalette = palette;
      uniforms.cachedTlut = tlut;
      gl.uniform2i(uniforms.palette, palette, tlut);
    }

    // Generated coordinates use the HLE tile extent.
    const scaleS = shiftFactor(tile.shiftS) * (texGenEnabled ? tile.width : 1);
    const scaleT = shiftFactor(tile.shiftT) * (texGenEnabled ? tile.height : 1);
    if (uniforms.scale !== null && (
      uniforms.cachedScaleS !== scaleS ||
      uniforms.cachedScaleT !== scaleT)) {
      uniforms.cachedScaleS = scaleS;
      uniforms.cachedScaleT = scaleT;
      gl.uniform2f(uniforms.scale, scaleS, scaleT);
    }

    const offsetS = texGenEnabled ? 0 : tile.left;
    const offsetT = texGenEnabled ? 0 : tile.top;
    if (uniforms.offset !== null && (
      uniforms.cachedOffsetS !== offsetS ||
      uniforms.cachedOffsetT !== offsetT)) {
      uniforms.cachedOffsetS = offsetS;
      uniforms.cachedOffsetT = offsetT;
      gl.uniform2f(uniforms.offset, offsetS, offsetT);
    }

    // Clamp boundaries retain fractional tile coordinates; clamp texels are integers.
    const clampBoundaryS = tile.right - tile.left;
    const clampBoundaryT = tile.bottom - tile.top;
    const clampTexelS = ((tile.lrs >>> 2) - (tile.uls >>> 2)) & 0x3ff;
    const clampTexelT = ((tile.lrt >>> 2) - (tile.ult >>> 2)) & 0x3ff;
    if (uniforms.bounds !== null && (
      uniforms.cachedBounds0 !== clampBoundaryS ||
      uniforms.cachedBounds1 !== clampBoundaryT ||
      uniforms.cachedBounds2 !== clampTexelS ||
      uniforms.cachedBounds3 !== clampTexelT)) {
      uniforms.cachedBounds0 = clampBoundaryS;
      uniforms.cachedBounds1 = clampBoundaryT;
      uniforms.cachedBounds2 = clampTexelS;
      uniforms.cachedBounds3 = clampTexelT;
      gl.uniform4f(uniforms.bounds, clampBoundaryS, clampBoundaryT, clampTexelS, clampTexelT);
    }

    const maskS = tile.maskS;
    const maskT = tile.maskT;
    if (uniforms.mask !== null && (
      uniforms.cachedMaskS !== maskS ||
      uniforms.cachedMaskT !== maskT)) {
      uniforms.cachedMaskS = maskS;
      uniforms.cachedMaskT = maskT;
      gl.uniform2i(uniforms.mask, maskS, maskT);
    }

    // Mask zero implicitly clamps, even when the clamp bit is clear.
    // The copy pipeline applies shifts and masks but bypasses tile clamping.
    const copy = this.state.getCycleType() === gbi.CycleType.G_CYC_COPY;
    const modeS = copy ? tile.cmS & gbi.G_TX_MIRROR : tile.cmS | (maskS === 0 ? gbi.G_TX_CLAMP : 0);
    const modeT = copy ? tile.cmT & gbi.G_TX_MIRROR : tile.cmT | (maskT === 0 ? gbi.G_TX_CLAMP : 0);
    if (uniforms.mode !== null && (
      uniforms.cachedModeS !== modeS ||
      uniforms.cachedModeT !== modeT)) {
      uniforms.cachedModeS = modeS;
      uniforms.cachedModeT = modeT;
      gl.uniform2i(uniforms.mode, modeS, modeT);
    }
    return true;
  }

  usesConstantFogColor() {
    return this.getConstantFogBlendMode() === rdp_blend.kFogColorWithFramebuffer;
  }

  // Limit constant-register framebuffer blending to forced, non-coverage draws.
  // Keep this decision shared by shader RGB selection and fixed-function blending.
  getConstantFogBlendMode() {
    const cycle = this.state.getCycleType();
    if (cycle !== gbi.CycleType.G_CYC_1CYCLE && cycle !== gbi.CycleType.G_CYC_2CYCLE) {
      return 0;
    }
    const otherMode = this.state.rdpOtherModeL;
    const coverageFlags = gbi.RenderMode.AA_EN | gbi.RenderMode.CLR_ON_CVG |
      gbi.RenderMode.CVG_X_ALPHA | gbi.RenderMode.ALPHA_CVG_SEL;
    if (!(otherMode & gbi.RenderMode.FORCE_BL) || (otherMode & coverageFlags)) {
      return 0;
    }
    const blender = otherMode >>> gbi.G_MDSFT_BLENDER;
    const mode = (cycle === gbi.CycleType.G_CYC_2CYCLE ? blender : blender >>> 2) & 0x3333;
    return mode === rdp_blend.kIncomingColorWithFogAlpha || mode === rdp_blend.kFogColorWithFramebuffer ? mode : 0;
  }

  setGLBlendMode() {
    const gl = this.gl;
    const glState = getGLState(this);

    // Optionally multiply coverage by combiner alpha.
    const cvgXAlpha = this.state.getCoverageTimesAlpha();
    // Select coverage (possibly multiplied by alpha) instead of combiner alpha.
    const alphaCvgSel = this.state.getAlphaCoverageSelect();

    const cycleType = this.state.getCycleType();
    if (cycleType == gbi.CycleType.G_CYC_FILL || cycleType == gbi.CycleType.G_CYC_COPY) {
      // No blending in copy/fill modes, although they may set up alpha thresholding in the shader.
      glState.setBlendEnabled(false);
      return;
    }

    const blendMode = this.state.rdpOtherModeL >> gbi.G_MDSFT_BLENDER;
    const activeBlendMode = (cycleType === gbi.CycleType.G_CYC_2CYCLE ? blendMode : (blendMode >>> 2)) & 0x3333;

    let mode = kBlendModeUnknown;
    switch (activeBlendMode) {
      case rdp_blend.kIncomingColorWithItself:
      case rdp_blend.kIncomingColorPassThrough:
      case rdp_blend.kFogColorWithShadeAlpha:
      case rdp_blend.kIncomingColorWithShadeAlpha:
        // Shade-alpha fog mixes with the incoming colour in the shader;
        // neither input is the framebuffer, so no GL blend is needed.
        mode = kBlendModeOpaque;
        break;

      case rdp_blend.kIncomingColorWithSourceAlpha:
      case rdp_blend.kIncomingColorWithMemoryAlpha:
        // These modes either do a weighted sum of coverage (or coverage and alpha) or a plain alpha blend
        // If alphaCvgSel is 0, or if we're multiplying by fragment alpha, then we have alpha to blend with.
        if (!alphaCvgSel || cvgXAlpha) {
          mode = kBlendModeAlphaTrans;
        } else {
          // Coverage-only opaque surfaces (e.g. Tetrisphere's 0x0011).
          // HLE does not track RDP subpixel coverage, so assume full coverage
          // and overwrite the destination, regardless of combiner alpha.
          mode = kBlendModeOpaque;
        }
        break;

      case rdp_blend.kIncomingColorWithFogAlpha:
      case rdp_blend.kFogColorWithFramebuffer:
        mode = this.getConstantFogBlendMode() ? kBlendModeConstantFog : kBlendModeOpaque;
        break;

      case rdp_blend.kZeroIncomingWithFramebuffer:
      case rdp_blend.kZeroFramebufferWithFramebuffer:
        mode = kBlendModeFade;
        break;
    }

    let logUnhandled = false;
    switch (mode) {
      case kBlendModeOpaque:
        glState.setBlendEnabled(false);
        break;
      case kBlendModeAlphaTrans:
        glState.setBlendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        glState.setBlendEquation(gl.FUNC_ADD);
        glState.setBlendEnabled(true);
        break;
      case kBlendModeFade:
        glState.setBlendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
        glState.setBlendEquation(gl.FUNC_ADD);
        glState.setBlendEnabled(true);
        break;
      case kBlendModeConstantFog:
        // RDP forced blending uses A >> 3 and ((255-A) >> 3) + 1,
        // divided by 32. Even A=255 retains 1/32 of the framebuffer.
        // See angrylion-rdp-plus blender.c, blender_equation_cycle0/1.
        // GL rounds the final channel instead of truncating (<= 1 byte).
        glState.setBlendColorAlpha(((this.state.fogColor & 0xff) >>> 3) / 32);
        // Preserve the existing framebuffer-alpha policy independently of RGB.
        glState.setBlendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA, gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        glState.setBlendEquation(gl.FUNC_ADD);
        glState.setBlendEnabled(true);
        break;
      case kBlendModeUnknown:
        logUnhandled = true;
        glState.setBlendEnabled(false);
        break;
    }

    if (logUnhandled) {
      this.logUnhandledBlendMode(activeBlendMode, alphaCvgSel, cvgXAlpha);
    }
  }

  logUnhandledBlendMode(activeBlendMode, alphaCvgSel, cvgXAlpha) {
    if (loggedBlendModes.get(activeBlendMode)) {
      return;
    }
    loggedBlendModes.set(activeBlendMode, true);
    n64js.warn(`Unhandled blend mode: ${toString16(activeBlendMode)} = ${gbi.blendOpText(activeBlendMode)}, alphaCvgSel ${alphaCvgSel}, cvgXAlpha ${cvgXAlpha}`);
  }
}

class CurrentShader {
  constructor() {
    this.reset();
  }

  reset() {
    this.shader = null;
    this.mux0 = 0;
    this.mux1 = 0;
    this.cycleType = 0;
    this.rdpOtherModeL = 0;
    this.rdpOtherModeH = 0;
    this.alphaCompare = 0;
    this.enableAlphaCvgKill = false;
    this.noNearClipping = false;
    this.constantFogColor = false;
  }

  getOrCreate(gl, state, noNearClipping, constantFogColor) {
    const mux0 = state.combine.hi >>> 0;
    const mux1 = state.combine.lo >>> 0;
    const cycleType = state.getCycleType();
    const rdpOtherModeL = state.rdpOtherModeL >>> 0;
    const rdpOtherModeH = state.rdpOtherModeH >>> 0;
    const alphaCompare = state.getAlphaCompareType();
    const enableAlphaCvgKill = state.getAntiAliasEnabled() && state.getCoverageTimesAlpha();

    if (this.shader &&
      this.mux0 === mux0 &&
      this.mux1 === mux1 &&
      this.cycleType === cycleType &&
      this.rdpOtherModeL === rdpOtherModeL &&
      this.rdpOtherModeH === rdpOtherModeH &&
      this.alphaCompare === alphaCompare &&
      this.enableAlphaCvgKill === enableAlphaCvgKill &&
      this.noNearClipping === noNearClipping &&
      this.constantFogColor === constantFogColor) {
      return this.shader;
    }

    const shader = shaders.getOrCreateN64Shader(gl, mux0, mux1, cycleType, alphaCompare, enableAlphaCvgKill,
      noNearClipping, rdpOtherModeL >>> 16, constantFogColor);
    this.shader = shader;
    this.mux0 = mux0;
    this.mux1 = mux1;
    this.cycleType = cycleType;
    this.rdpOtherModeL = rdpOtherModeL;
    this.rdpOtherModeH = rdpOtherModeH;
    this.alphaCompare = alphaCompare;
    this.enableAlphaCvgKill = enableAlphaCvgKill;
    this.noNearClipping = noNearClipping;
    this.constantFogColor = constantFogColor;
    return shader;
  }
}

function getGLState(renderer) {
  return renderer.glState ?? (renderer.glState = new GLState(renderer.gl));
}

function shiftFactor(shift) {
  if (shift <= 10) {
    return 1 / (1 << shift);
  }
  return 1 << (16 - shift);
}
