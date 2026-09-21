/*global n64js*/

import { toString16, toString32 } from "../format.js";
import { Vector2 } from "../graphics/Vector2.js";
import * as gbi from './gbi.js';
import { RendererBase } from './renderer_base.js';
import { RenderTargets } from './render_targets.js';
import * as shaders from './shaders.js';
import { Texture } from './textures.js';
import { textureDecodeTile } from './texture_sampler.js';
import { VertexArray } from "./vertex_array.js";
import blitVertexSource from './shaders/blit.vert.glsl' with { type: 'text' };
import blitFragmentSource from './shaders/blit.frag.glsl' with { type: 'text' };
import fillVertexSource from './shaders/fill.vert.glsl' with { type: 'text' };
import fillFragmentSource from './shaders/fill.frag.glsl' with { type: 'text' };

const kBlendModeUnknown = 0;
const kBlendModeOpaque = 1;
const kBlendModeAlphaTrans = 2;
const kBlendModeFade = 3;
const kBlendModeFog = 4;

// Map to keep track of which unimplemented blend modes we've already warned about.
const loggedBlendModes = new Map();

export class Renderer extends RendererBase {
  constructor(gl, state, width, height) {
    super(state);
    this.gl = gl;

    this.textureCache = new Map();

    this.renderTargets = new RenderTargets(gl, width, height);

    this.frameBufferTexture2D = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.frameBufferTexture2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // We call texImage2D to initialise frameBufferTexture2D with the correct dimensions when it's used.

    this.blitShaderProgram = shaders.createShaderProgram(gl, blitVertexSource, blitFragmentSource);
    this.blitSamplerUniform = gl.getUniformLocation(this.blitShaderProgram, "uSampler");
    this.blitVA = this.initBlitVA(this.blitShaderProgram);

    this.fillShaderProgram = shaders.createShaderProgram(gl, fillVertexSource, fillFragmentSource);
    this.fillFillColorUniform = gl.getUniformLocation(this.fillShaderProgram, "uFillColor");
    this.fillRectVA = this.initFillRectVA(this.fillShaderProgram);
    this.debugClearVA = this.initClearVA(this.fillShaderProgram);

    this.textureOutput = document.getElementById('texture-content');
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
    this.renderTargets.reset();
    this.textureCache.clear();
    this.textureOutput?.replaceChildren();
  }

  newFrame() {
    const gl = this.gl;
    // Render everything to the back buffer. This prevents horrible flickering
    // if due to webgl clearing our context between updates.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.frameBuffer);
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

  copyTextureToFrontBuffer(texture) {
    const gl = this.gl;
    // Passing null binds the framebuffer to the canvas.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(this.blitShaderProgram);

    const canvas = document.getElementById('display');
    gl.viewport(0, 0, canvas.width, canvas.height);

    this.blitVA.bind();

    // uSampler
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(this.blitSamplerUniform, 0);

    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.blitVA.unbind();
  }

  copyBackBufferToFrontBuffer(address) {
    this.copyTextureToFrontBuffer(this.renderTargets.textureForVI(address));
  }

  copyPixelsToFrontBuffer(pixels, width, height, bitDepth) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.frameBufferTexture2D);

    if (bitDepth == 32) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    } else if (bitDepth == 16) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_SHORT_5_5_5_1, pixels);
    } else {
      // Invalid mode.
    }

    this.copyTextureToFrontBuffer(this.frameBufferTexture2D);
  }

  /**
   * Flushes the contents of a TriangleBuffer.
   * @param {TriangleBuffer} tb 
   * @returns 
   */
  flushTris(tb, { lines = false } = {}) {
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
      tb.numTris * 3, null, this.state.noNearClipping);

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

    gl.useProgram(this.fillShaderProgram);
    this.debugClearVA.bind();

    // uFillColor
    gl.uniform4f(this.fillFillColorUniform, 1, 0, 1, 1);

    // Disable blending, culling and depth testing.
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.debugClearVA.unbind();
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
    gl.clearDepth(depth);
    gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
  }

  clearColor(color) {
    const gl = this.gl;
    gl.clearColor(color.r, color.g, color.b, color.a);
    this.renderTargets.markDirty(this.state.scissor);
    gl.clear(gl.COLOR_BUFFER_BIT);
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

    // TODO: check scissor

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
    if (x1 === x0 || y1 === y0) return;
    const vertices = this.calculateRectVertices(x0, y0, x1, y1);
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

  setProgramState(positions, colours, coords, textureEnabled, texGenEnabled, tileIdx, numVertices = positions.length / 4, textureRect = null, noNearClipping = false) {
    const gl = this.gl;

    this.setGLBlendMode();

    // TODO: I think it would make more sense to check if the texture is referenced in the combiner.
    let tile0, tile1;
    let texture0, texture1;
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
      tile1 = this.state.tiles[tileIdx1];

      texture0 = this.lookupTexture(tileIdx0);
      texture1 = this.getTextureTileCount() === 2 ? (tileIdx1 === tileIdx0 ? texture0 : this.lookupTexture(tileIdx1)) : null;
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

    // TODO: just return the shader and do the binding at the call site?
    shader.vertexArray.bind();
    shader.vertexArray.setPosData(positions, gl.DYNAMIC_DRAW, numVertices * 4);
    shader.vertexArray.setColorData(colours, gl.DYNAMIC_DRAW, numVertices);
    shader.vertexArray.setUVData(coords, gl.DYNAMIC_DRAW, numVertices * 2);

    this.bindTexture(0, tile0, texture0, texGenEnabled, shader.textureUniforms[0]);
    this.bindTexture(1, tile1, texture1, texGenEnabled, shader.textureUniforms[1]);
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
      texture0 && tile0?.format === gbi.ImageFormat.G_IM_FMT_YUV ? 1 : 0,
      texture1 && tile1?.format === gbi.ImageFormat.G_IM_FMT_YUV ? 1 : 0);

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
  }

  getCurrentN64Shader(noNearClipping = false) {
    const mux0 = this.state.combine.hi;
    const mux1 = this.state.combine.lo;
    const cycleType = this.state.getCycleType();

    const enableAlphaThreshold = (this.state.getAlphaCompareType() & gbi.AlphaCompare.G_AC_THRESHOLD) != 0;
    const enableAlphaCvgKill = this.state.getAntiAliasEnabled() && this.state.getCoverageTimesAlpha();

    return shaders.getOrCreateN64Shader(this.gl, mux0, mux1, cycleType, enableAlphaThreshold || enableAlphaCvgKill, noNearClipping);
  }

  /**
   * Looks up the texture defined at the specified tile index.
   * @param {number} tileIdx
   * @return {?Texture}
   */
  lookupTexture(tileIdx) {
    let tile = this.state.tiles[tileIdx];
    // Skip empty tiles - this is primarily for the debug ui.
    if (tile.line === 0) {
      return null;
    }
    tile = textureDecodeTile(tile, this.state.getCycleType() === gbi.CycleType.G_CYC_COPY);

    // FIXME: we can cache this if tile/tmem state hasn't changed since the last draw call.
    const hash = this.state.tmem.calculateCRC(tile);

    // Check if the texture is already cached.
    // The cacheID should include all the state that can affect how the texture is constructed.
    const cacheID = `${toString32(hash)}_${tile.format}_${tile.size}_${tile.width}_${tile.height}_${tile.palette}`;
    if (this.textureCache.has(cacheID)) {
      return this.textureCache.get(cacheID);
    }
    const texture = this.decodeTexture(tile, this.state.getTextureLUTType(), cacheID);
    this.textureCache.set(cacheID, texture);
    return texture;
  }

  /**
   * Decodes the texture defined by the specified tile.
   * @param {!Tile} tile
   * @param {number} tlutFormat
   * @return {?Texture}
   */
  decodeTexture(tile, tlutFormat, cacheID) {
    const gl = this.gl;

    if (tile.width == 0 || tile.height == 0) {
      return null;
    }

    const texture = new Texture(gl, tile.width, tile.height);
    if (!texture.canvas.getContext) {
      return null;
    }

    this.textureOutput?.append(
      `${cacheID}: ${gbi.ImageFormat.nameOf(tile.format)}, ${gbi.ImageSize.nameOf(tile.size)},${tile.width}x${tile.height}, `, document.createElement('br'));

    const ctx = texture.canvas.getContext('2d');
    const imgData = ctx.createImageData(texture.width, texture.height);

    const handled = this.state.tmem.convertTexels(tile, tlutFormat, imgData);
    if (handled) {
      ctx.putImageData(imgData, 0, 0);

      this.textureOutput?.append(texture.canvas, document.createElement('br'));
    } else {
      const msg = `${gbi.ImageFormat.nameOf(tile.format)}/${gbi.ImageSize.nameOf(tile.size)} is unhandled`;
      this.textureOutput?.append(msg);
      // FIXME: fill with placeholder texture
      this.hleHalt(msg);
    }

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, texture.canvas);

    // texelFetch only reads level zero; no host mipmaps are needed.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return texture;
  }


  bindTexture(slot, tile, texture, texGenEnabled, uniforms) {
    const gl = this.gl;

    gl.activeTexture(gl.TEXTURE0 + slot);
    gl.uniform1i(uniforms.sampler, slot);
    gl.uniform1i(uniforms.enabled, texture ? 1 : 0);
    gl.bindTexture(gl.TEXTURE_2D, texture ? texture.texture : null);

    if (!texture) return;

    // Generated coordinates use the HLE tile extent, independently of any
    // extra texels decoded to cover the full wrap region.
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
  }

  setGLBlendMode() {
    const gl = this.gl;

    // fragment coverage (0) or alpha (1)?
    const cvgXAlpha = this.state.getCoverageTimesAlpha();
    // use fragment coverage * fragment alpha
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
      case 0x0000: // G_BL_CLR_IN, G_BL_A_IN, G_BL_CLR_IN, G_BL_1MA
      case 0x0302: // G_BL_CLR_IN, G_BL_0, G_BL_CLR_IN, G_BL_1
        mode = kBlendModeOpaque;
        break;
      // case 0x0321 = G_BL_CLR_IN, G_BL_0, G_BL_CLR_BL, G_BL_A_MEM - blend*alpha.

      case 0x0010: // G_BL_CLR_IN, G_BL_A_IN, G_BL_CLR_MEM, G_BL_1MA
      case 0x0011: // G_BL_CLR_IN, G_BL_A_IN, G_BL_CLR_MEM, G_BL_A_MEM
        // These modes either do a weighted sum of coverage (or coverage and alpha) or a plain alpha blend
        // If alphaCvgSel is 0, or if we're multiplying by fragment alpha, then we have alpha to blend with.
        if (!alphaCvgSel || cvgXAlpha) {
          mode = kBlendModeAlphaTrans;
        }
        break;

      case 0x0110: // G_BL_CLR_IN, G_BL_A_FOG, G_BL_CLR_MEM, G_BL_1MA, alphaCvgSel:false cvgXAlpha:false
        // FIXME: this needs to blend the input colour with the fog alpha, but we don't compute this yet.
        mode = kBlendModeOpaque;
        break;

      case 0x0310: // G_BL_CLR_IN, G_BL_0, G_BL_CLR_MEM, G_BL_1MA, alphaCvgSel:false cvgXAlpha:false
      case 0x1310: // G_BL_CLR_MEM, G_BL_0, G_BL_CLR_MEM, G_BL_1MA
        mode = kBlendModeFade;
        break;

      case 0x3110: // G_BL_CLR_FOG, G_BL_A_FOG, G_BL_CLR_MEM, G_BL_1MA
        mode = kBlendModeFog;
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
      case kBlendModeFog:
        // TODO: figure out how to emulate this.
        // For now just render as opaque.
        logUnhandled = true;
        gl.disable(gl.BLEND);
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
