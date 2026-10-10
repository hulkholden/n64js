/*global n64js*/

import { toString16 } from "../format.js";
import { Vector2 } from "../graphics/Vector2.js";
import * as gbi from './gbi.js';
import * as rdp_blend from './rdp_blend_constants.js';
import { CRTMode, graphicsOptions } from './graphics_options.js';
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

    this.tmemTexture = new TMEMTexture(gl);

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
    this.fillRectVA = this.initFillRectVA(this.fillShaderProgram);
    this.debugClearVA = this.initClearVA(this.fillShaderProgram);
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
    this.resetCPUFramebuffers();
    this.renderTargets.reset();
    this.tmemTexture?.reset();
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
  }

  newFrame() {
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

    if (!lines && (this.state.geometryMode.cullFront || this.state.geometryMode.cullBack)) {
      gl.enable(gl.CULL_FACE);
      const mode = (this.state.geometryMode.cullFront) ? gl.FRONT : gl.BACK;
      gl.cullFace(mode);
    } else {
      gl.disable(gl.CULL_FACE);
    }

    this.markFramebufferDirty(tb.positions, tb.numTris * 3);
    gl.drawArrays(gl.TRIANGLES, 0, tb.numTris * 3);
    //gl.drawArrays(gl.LINE_STRIP, 0, numTris * 3);
    tb.reset();
    gl.bindVertexArray(null);
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

    this.renderTargets.bindCurrent();
    gl.disable(gl.SCISSOR_TEST);
    gl.depthMask(true);
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
    gl.depthMask(true);
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

    gl.useProgram(this.fillShaderProgram);
    this.fillRectVA.bind();
    this.fillRectVA.setPosData(new Float32Array(vertices), gl.DYNAMIC_DRAW);

    // uFillColor
    gl.uniform4f(this.fillFillColorUniform, color.r, color.g, color.b, color.a);

    // Disable culling and depth testing.
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);

    this.renderTargets.markDirty(this.state.scissor, y1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.fillRectVA.unbind();
  }

  lleRect(tileIdx, vertices, uvs, colours, textureRect = null) {
    const gl = this.gl;

    this.setProgramState(new Float32Array(vertices), new Uint32Array(colours), new Float32Array(uvs),
      true /* textureEnabled */, false /*texGenEnabled*/, tileIdx, vertices.length / 4, textureRect);

    gl.disable(gl.CULL_FACE);

    const depthSourcePrim = (this.state.rdpOtherModeL & gbi.DepthSource.G_ZS_PRIM) !== 0;
    const depthEnabled = depthSourcePrim ? true : false;
    if (depthEnabled) {
      this.initDepth();
    } else {
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
    }
    this.markFramebufferDirty(vertices);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
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
    const display0 = this.nativeTransform.convertN64ToDisplay(new Vector2(x0, y0));
    const display1 = this.nativeTransform.convertN64ToDisplay(new Vector2(x1, y1));
    const display2 = this.nativeTransform.convertN64ToDisplay(new Vector2(x2, y2));
    const display3 = this.nativeTransform.convertN64ToDisplay(new Vector2(x3, y3));
    const depthSourcePrim = (this.state.rdpOtherModeL & gbi.DepthSource.G_ZS_PRIM) !== 0;
    const depth = depthSourcePrim ? this.state.primDepth : 0.0;

    const vertices = [
      display0.x, display0.y, depth, 1.0,
      display1.x, display1.y, depth, 1.0,
      display2.x, display2.y, depth, 1.0,
      display3.x, display3.y, depth, 1.0
    ];
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
    const gl = this.gl;
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
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(left, height - bottom, Math.max(0, right - left), Math.max(0, bottom - top));
    // TODO: emulate odd/even scanline selection for interlaced scissor modes.
  }

  initDepth() {
    const gl = this.gl;

    // TODO: decal mode.
    //if (gRDPOtherMode.zmode == ZMODE_DEC) ...

    // Disable depth testing
    const zGeomMode = (this.state.geometryMode.zbuffer) !== 0;
    const zCmpRenderMode = (this.state.rdpOtherModeL & gbi.RenderMode.Z_CMP) !== 0;
    const zUpdRenderMode = (this.state.rdpOtherModeL & gbi.RenderMode.Z_UPD) !== 0;

    if ((zGeomMode && zCmpRenderMode) || zUpdRenderMode) {
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
    } else {
      gl.disable(gl.DEPTH_TEST);
    }

    gl.depthMask(zUpdRenderMode);
  }

  setProgramState(positions, colours, coords, textureEnabled, texGenEnabled, tileIdx, numVertices = positions.length / 4, textureRect = null, noNearClipping = false, { affineUV = false } = {}) {
    const gl = this.gl;

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

    const enableAlphaThreshold = (this.state.getAlphaCompareType() & gbi.AlphaCompare.G_AC_THRESHOLD) != 0;
    const enableAlphaCvgKill = this.state.getAntiAliasEnabled() && this.state.getCoverageTimesAlpha();

    let alphaThreshold = 0;
    if (enableAlphaThreshold) {
      alphaThreshold = ((this.state.blendColor >>> 0) & 0xff) / 255.0;
    } else if (enableAlphaCvgKill) {
      // If CVG_X_ALPHA is set then the coverage value is multiplied by the computed alpha value.
      // If anti-aliasing is enabled (AA_EN) then coverage values of zero will be discarded (won't write).
      // TODO: this is a bit of a hack - as we don't compute coverage values we're just assuming that if
      // the alpha is zero then the coverage will always come out as zero, but this is not accurate.
      alphaThreshold = 0;
    }

    const shader = this.getCurrentN64Shader(noNearClipping);
    gl.useProgram(shader.program);
    gl.uniform1i(shader.uAffineUVUniform, affineUV ? 1 : 0);

    // TODO: just return the shader and do the binding at the call site?
    shader.vertexArray.bind();
    shader.vertexArray.setPosData(positions, gl.DYNAMIC_DRAW, numVertices * 4);
    shader.vertexArray.setColorData(colours, gl.DYNAMIC_DRAW, numVertices);
    shader.vertexArray.setUVData(coords, gl.DYNAMIC_DRAW, numVertices * 2);

    this.tmemTexture.bind(this.state.tmem);
    gl.uniform1i(shader.uTMEMUniform, 0);
    const enabled0 = this.bindTile(tile0, texGenEnabled, shader.textureUniforms[0]);
    const enabled1 = this.bindTile(tile1, texGenEnabled, shader.textureUniforms[1]);
    const copy = this.state.getCycleType() === gbi.CycleType.G_CYC_COPY;
    const filter = copy ? gbi.TextureFilter.G_TF_POINT : this.state.getTextureFilterType();
    gl.uniform1i(shader.uTextureFilterUniform, filter >>> gbi.G_MDSFT_TEXTFILT);
    gl.uniform1i(shader.uTextureRectEnabledUniform, textureRect ? 1 : 0);
    if (textureRect) {
      const { x0, y0, s0, t0, dsdx, dtdy, flip } = textureRect;
      const { viWidth, viHeight } = this.nativeTransform;
      gl.uniform4f(shader.uTextureRectScreenUniform,
        viWidth / this.renderTargets.width, -viHeight / this.renderTargets.height, 0, viHeight);
      // Rectangle interpolation starts on the first native scanline; the
      // copy pipe additionally ignores the fractional X origin.
      gl.uniform4f(shader.uTextureRectOriginUniform, copy ? Math.floor(x0) : x0, Math.floor(y0), s0, t0);
      gl.uniform4f(shader.uTextureRectDerivativesUniform,
        flip ? 0 : dsdx, flip ? dtdy : 0, flip ? dsdx : 0, flip ? 0 : dtdy);
    }

    gl.uniform1f(shader.uAlphaThresholdUniform, alphaThreshold);

    const k = this.state.convert;
    gl.uniform4f(shader.uConvertUniform, (k[0] * 2 + 1) / 256, (k[1] * 2 + 1) / 256,
      (k[2] * 2 + 1) / 256, (k[3] * 2 + 1) / 256);
    gl.uniform2f(shader.uConvertK45Uniform, k[4] / 255, k[5] / 256);
    gl.uniform1i(shader.uTextureConvertUniform, (this.state.rdpOtherModeH & gbi.G_TC_MASK) >>> gbi.G_MDSFT_TEXTCONV);
    gl.uniform2i(shader.uTextureYUVUniform,
      enabled0 && tile0?.format === gbi.ImageFormat.G_IM_FMT_YUV ? 1 : 0,
      enabled1 && tile1?.format === gbi.ImageFormat.G_IM_FMT_YUV ? 1 : 0);

    gl.uniform4f(shader.uPrimColorUniform,
      ((this.state.primColor >>> 24) & 0xff) / 255.0,
      ((this.state.primColor >>> 16) & 0xff) / 255.0,
      ((this.state.primColor >>> 8) & 0xff) / 255.0,
      ((this.state.primColor >>> 0) & 0xff) / 255.0);
    gl.uniform1f(shader.uPrimLodFracUniform, this.state.primLodFrac / 255.0);
    gl.uniform4f(shader.uEnvColorUniform,
      ((this.state.envColor >>> 24) & 0xff) / 255.0,
      ((this.state.envColor >>> 16) & 0xff) / 255.0,
      ((this.state.envColor >>> 8) & 0xff) / 255.0,
      ((this.state.envColor >>> 0) & 0xff) / 255.0);
    gl.uniform4f(shader.uFogColorUniform,
      ((this.state.fogColor >>> 24) & 0xff) / 255.0,
      ((this.state.fogColor >>> 16) & 0xff) / 255.0,
      ((this.state.fogColor >>> 8) & 0xff) / 255.0,
      (this.state.fogColor & 0xff) / 255.0);
  }

  getCurrentN64Shader(noNearClipping = false) {
    const mux0 = this.state.combine.hi;
    const mux1 = this.state.combine.lo;
    const cycleType = this.state.getCycleType();

    const alphaCompare = this.state.getAlphaCompareType();
    const enableAlphaCvgKill = this.state.getAntiAliasEnabled() && this.state.getCoverageTimesAlpha();

    return shaders.getOrCreateN64Shader(this.gl, mux0, mux1, cycleType, alphaCompare, enableAlphaCvgKill,
      noNearClipping, this.state.rdpOtherModeL >>> 16, this.usesConstantFogColor());
  }

  bindTile(tile, texGenEnabled, uniforms) {
    const gl = this.gl;
    const enabled = !!tile && tile.format >= 0;
    gl.uniform1i(uniforms.enabled, enabled ? 1 : 0);
    if (!enabled) {
      return false;
    }
    gl.uniform4i(uniforms.memory, tile.tmem << 3, tile.line << 3, tile.format, tile.size);
    gl.uniform2i(uniforms.palette, tile.palette,
      getTexturePaletteFormat(tile, this.state.getTextureLUTType()) >>> gbi.G_MDSFT_TEXTLUT);

    // Generated coordinates use the HLE tile extent.
    const scaleS = shiftFactor(tile.shiftS) * (texGenEnabled ? tile.width : 1);
    const scaleT = shiftFactor(tile.shiftT) * (texGenEnabled ? tile.height : 1);
    const offsetS = texGenEnabled ? 0 : tile.left;
    const offsetT = texGenEnabled ? 0 : tile.top;
    gl.uniform2f(uniforms.scale, scaleS, scaleT);
    gl.uniform2f(uniforms.offset, offsetS, offsetT);

    // Clamp boundaries retain fractional tile coordinates; clamp texels are integers.
    const clampBoundaryS = tile.right - tile.left;
    const clampBoundaryT = tile.bottom - tile.top;
    const clampTexelS = ((tile.lrs >>> 2) - (tile.uls >>> 2)) & 0x3ff;
    const clampTexelT = ((tile.lrt >>> 2) - (tile.ult >>> 2)) & 0x3ff;
    gl.uniform4f(uniforms.bounds, clampBoundaryS, clampBoundaryT, clampTexelS, clampTexelT);
    gl.uniform2i(uniforms.mask, tile.maskS, tile.maskT);

    // Mask zero implicitly clamps, even when the clamp bit is clear.
    // The copy pipeline applies shifts and masks but bypasses tile clamping.
    const copy = this.state.getCycleType() === gbi.CycleType.G_CYC_COPY;
    const modeS = copy ? tile.cmS & gbi.G_TX_MIRROR : tile.cmS | (tile.maskS === 0 ? gbi.G_TX_CLAMP : 0);
    const modeT = copy ? tile.cmT & gbi.G_TX_MIRROR : tile.cmT | (tile.maskT === 0 ? gbi.G_TX_CLAMP : 0);
    gl.uniform2i(uniforms.mode, modeS, modeT);
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

    // Optionally multiply coverage by combiner alpha.
    const cvgXAlpha = this.state.getCoverageTimesAlpha();
    // Select coverage (possibly multiplied by alpha) instead of combiner alpha.
    const alphaCvgSel = this.state.getAlphaCoverageSelect();

    const cycleType = this.state.getCycleType();
    if (cycleType == gbi.CycleType.G_CYC_FILL || cycleType == gbi.CycleType.G_CYC_COPY) {
      // No blending in copy/fill modes, although they may set up alpha thresholding in the shader.
      gl.disable(gl.BLEND);
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
        gl.disable(gl.BLEND);
        break;
      case kBlendModeAlphaTrans:
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.blendEquation(gl.FUNC_ADD);
        gl.enable(gl.BLEND);
        break;
      case kBlendModeFade:
        gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
        gl.blendEquation(gl.FUNC_ADD);
        gl.enable(gl.BLEND);
        break;
      case kBlendModeConstantFog:
        // RDP forced blending uses A >> 3 and ((255-A) >> 3) + 1,
        // divided by 32. Even A=255 retains 1/32 of the framebuffer.
        // See angrylion-rdp-plus blender.c, blender_equation_cycle0/1.
        // GL rounds the final channel instead of truncating (<= 1 byte).
        gl.blendColor(0, 0, 0, ((this.state.fogColor & 0xff) >>> 3) / 32);
        // Preserve the existing framebuffer-alpha policy independently of RGB.
        gl.blendFuncSeparate(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA, gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.blendEquation(gl.FUNC_ADD);
        gl.enable(gl.BLEND);
        break;
      case kBlendModeUnknown:
        logUnhandled = true;
        gl.disable(gl.BLEND);
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

function shiftFactor(shift) {
  if (shift <= 10) {
    return 1 / (1 << shift);
  }
  return 1 << (16 - shift);
}
