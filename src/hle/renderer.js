/*global $, n64js*/

import { toString16, toString32 } from "../format.js";
import { Transform2D } from '../graphics/Transform2D.js';
import { Transform4D } from "../graphics/Transform4D.js";
import { Vector2 } from "../graphics/Vector2.js";
import { Vector4 } from "../graphics/Vector4.js";
import * as gbi from './gbi.js';
import * as shaders from './shaders.js';
import { Texture } from './textures.js';
import { VertexArray } from "./vertex_array.js";

const kBlendModeUnknown = 0;
const kBlendModeOpaque = 1;
const kBlendModeAlphaTrans = 2;
const kBlendModeFade = 3;
const kBlendModeFog = 4;

// Map to keep track of which unimplemented blend modes we've already warned about.
const loggedBlendModes = new Map();

export class Renderer {
  constructor(gl, state, width, height) {
    this.gl = gl;
    this.state = state;
    this.nativeTransform = new NativeTransform();

    this.textureCache = new Map();

    this.frameBuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.frameBuffer);
    this.frameBuffer.width = width;
    this.frameBuffer.height = height;

    this.frameBufferTexture2D = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.frameBufferTexture2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // We call texImage2D to initialise frameBufferTexture2D with the correct dimensions when it's used.

    // Create a texture for color data and attach to the framebuffer.
    this.frameBufferTexture3D = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.frameBufferTexture3D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.frameBufferTexture3D, 0);
    gl.bindTexture(gl.TEXTURE_2D, null);

    // Create a render buffer and attach to the framebuffer.
    const renderbuffer = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, renderbuffer);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);

    // Passing null binds the framebuffer to the canvas.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.blitShaderProgram = shaders.createShaderProgram(gl, "blit-shader-vs", "blit-shader-fs");
    this.blitSamplerUniform = gl.getUniformLocation(this.blitShaderProgram, "uSampler");
    this.blitVA = this.initBlitVA(this.blitShaderProgram);

    this.fillShaderProgram = shaders.createShaderProgram(gl, "fill-shader-vs", "fill-shader-fs");
    this.fillFillColorUniform = gl.getUniformLocation(this.fillShaderProgram, "uFillColor");
    this.fillRectVA = this.initFillRectVA(this.fillShaderProgram);
    this.debugClearVA = this.initClearVA(this.fillShaderProgram);

    this.$textureOutput = $('#texture-content');
  }

  reset() {
    this.textureCache.clear();
    this.$textureOutput.html('');
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

  copyBackBufferToFrontBuffer() {
    this.copyTextureToFrontBuffer(this.frameBufferTexture3D);
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
  flushTris(tb) {
    const gl = this.gl;
    if (tb.empty()) {
      return;
    }

    const textureEnabled = this.state.geometryMode.texture;
    const texGenEnabled = this.state.geometryMode.lighting && this.state.geometryMode.textureGen;
    this.setProgramState(tb.positions,
      tb.colours,
      tb.coords,
      textureEnabled,
      texGenEnabled,
      this.state.texture.tile);

    this.initDepth();

    // texture filter

    if (this.state.geometryMode.cullFront || this.state.geometryMode.cullBack) {
      gl.enable(gl.CULL_FACE);
      const mode = (this.state.geometryMode.cullFront) ? gl.FRONT : gl.BACK;
      gl.cullFace(mode);
    } else {
      gl.disable(gl.CULL_FACE);
    }

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

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.fillRectVA.unbind();
  }

  calculateRectVertices(x0, y0, x1, y1) {
    const display0 = this.nativeTransform.convertN64ToDisplay(new Vector2(x0, y0));
    const display1 = this.nativeTransform.convertN64ToDisplay(new Vector2(x1, y1));
    const depthSourcePrim = (this.state.rdpOtherModeL & gbi.DepthSource.G_ZS_PRIM) !== 0;
    const depth = depthSourcePrim ? this.state.primDepth : 0.0;

    return [
      display0.x, display0.y, depth, 1.0,
      display1.x, display0.y, depth, 1.0,
      display0.x, display1.y, depth, 1.0,
      display1.x, display1.y, depth, 1.0
    ];
  }

  lleRect(tileIdx, vertices, uvs, colours) {
    const gl = this.gl;

    // TODO: check scissor

    this.setProgramState(new Float32Array(vertices), new Uint32Array(colours), new Float32Array(uvs),
      true /* textureEnabled */, false /*texGenEnabled*/, tileIdx);

    gl.disable(gl.CULL_FACE);

    const depthSourcePrim = (this.state.rdpOtherModeL & gbi.DepthSource.G_ZS_PRIM) !== 0;
    const depthEnabled = depthSourcePrim ? true : false;
    if (depthEnabled) {
      this.initDepth();
    } else {
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  texRect(tileIdx, x0, y0, x1, y1, s0, t0, s1, t1, flip) {
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
    this.lleRect(tileIdx, vertices, uvs, colours);
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

  setProgramState(positions, colours, coords, textureEnabled, texGenEnabled, tileIdx) {
    const gl = this.gl;

    this.setGLBlendMode();

    const cycleType = this.state.getCycleType();

    // TODO: I think it would make more sense to check if the texture is referenced in the combiner.
    let tile0, tile1;
    let texture0, texture1;
    if (textureEnabled) {
      const tileIdx0 = (tileIdx + 0) & 7;
      const tileIdx1 = (tileIdx + 1) & 7;

      tile0 = this.state.tiles[tileIdx0];
      tile1 = this.state.tiles[tileIdx1];

      texture0 = this.lookupTexture(tileIdx0);
      texture1 = (cycleType == gbi.CycleType.G_CYC_2CYCLE) ? this.lookupTexture(tileIdx1) : null;
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

    const shader = this.getCurrentN64Shader();
    gl.useProgram(shader.program);

    // TODO: just return the shader and do the binding at the call site?
    shader.vertexArray.bind();
    shader.vertexArray.setPosData(positions, gl.DYNAMIC_DRAW);
    shader.vertexArray.setColorData(colours, gl.DYNAMIC_DRAW);
    shader.vertexArray.setUVData(coords, gl.DYNAMIC_DRAW);

    this.bindTexture(0, gl.TEXTURE0, tile0, texture0, texGenEnabled, shader.uSamplerUniform0, shader.uTexScaleUniform0, shader.uTexOffsetUniform0);
    this.bindTexture(1, gl.TEXTURE1, tile1, texture1, texGenEnabled, shader.uSamplerUniform1, shader.uTexScaleUniform1, shader.uTexOffsetUniform1);

    gl.uniform1f(shader.uAlphaThresholdUniform, alphaThreshold);

    gl.uniform4f(shader.uPrimColorUniform,
      ((this.state.primColor >>> 24) & 0xff) / 255.0,
      ((this.state.primColor >>> 16) & 0xff) / 255.0,
      ((this.state.primColor >>> 8) & 0xff) / 255.0,
      ((this.state.primColor >>> 0) & 0xff) / 255.0);
    gl.uniform4f(shader.uEnvColorUniform,
      ((this.state.envColor >>> 24) & 0xff) / 255.0,
      ((this.state.envColor >>> 16) & 0xff) / 255.0,
      ((this.state.envColor >>> 8) & 0xff) / 255.0,
      ((this.state.envColor >>> 0) & 0xff) / 255.0);
  }

  getCurrentN64Shader() {
    const mux0 = this.state.combine.hi;
    const mux1 = this.state.combine.lo;
    const cycleType = this.state.getCycleType();

    const enableAlphaThreshold = (this.state.getAlphaCompareType() & gbi.AlphaCompare.G_AC_THRESHOLD) != 0;
    const enableAlphaCvgKill = this.state.getAntiAliasEnabled() && this.state.getCoverageTimesAlpha();

    return shaders.getOrCreateN64Shader(this.gl, mux0, mux1, cycleType, enableAlphaThreshold || enableAlphaCvgKill);
  }

  /**
   * Looks up the texture defined at the specified tile index.
   * @param {number} tileIdx
   * @return {?Texture}
   */
  lookupTexture(tileIdx) {
    const tile = this.state.tiles[tileIdx];
    // Skip empty tiles - this is primarily for the debug ui.
    if (tile.line === 0) {
      return null;
    }

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
    if (!texture.$canvas[0].getContext) {
      return null;
    }

    this.$textureOutput.append(
      `${cacheID}: ${gbi.ImageFormat.nameOf(tile.format)}, ${gbi.ImageSize.nameOf(tile.size)},${tile.width}x${tile.height}, <br>`);

    const ctx = texture.$canvas[0].getContext('2d');
    const imgData = ctx.createImageData(texture.width, texture.height);

    const handled = this.state.tmem.convertTexels(tile, tlutFormat, imgData);
    if (handled) {
      ctx.putImageData(imgData, 0, 0);

      this.$textureOutput.append(texture.$canvas);
      this.$textureOutput.append('<br>');
    } else {
      const msg = `${gbi.ImageFormat.nameOf(tile.format)}/${gbi.ImageSize.nameOf(tile.size)} is unhandled`;
      this.$textureOutput.append(msg);
      // FIXME: fill with placeholder texture
      this.hleHalt(msg);
    }

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, texture.$canvas[0]);

    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return texture;
  }


  bindTexture(slot, glTextureId, tile, texture, texGenEnabled, sampleUniform, texScaleUniform, texOffsetUniform) {
    const gl = this.gl;

    gl.activeTexture(glTextureId);

    if (!texture) {
      gl.bindTexture(gl.TEXTURE_2D, null);
      return;
    }

    let uvOffsetU = tile.left;
    let uvOffsetV = tile.top;
    let uvScaleU = 1.0 / texture.width;
    let uvScaleV = 1.0 / texture.height;

    // Horrible hack for wetrix. For some reason uvs come out 2x what they should be.
    if (texture.width === 56 && texture.height === 29) {
      uvScaleU *= 0.5;
      uvScaleV *= 0.5;
    }

    // When texture coordinates are generated, they're already correctly
    // scaled. Maybe they should be generated in this coord space?
    if (texGenEnabled) {
      uvScaleU = 1;
      uvScaleV = 1;
      uvOffsetU = 0;
      uvOffsetV = 0;
    }

    uvScaleU *= shiftFactor(tile.shiftS);
    uvScaleV *= shiftFactor(tile.shiftT);

    gl.bindTexture(gl.TEXTURE_2D, texture.texture);
    gl.uniform1i(sampleUniform, slot);

    gl.uniform2f(texScaleUniform, uvScaleU, uvScaleV);
    gl.uniform2f(texOffsetUniform, uvOffsetU, uvOffsetV);

    if (this.state.getTextureFilterType() == gbi.TextureFilter.G_TF_POINT) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_NEAREST);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_NEAREST);
    }

    // When not masking, Clamp S,T is ignored and clamping is implicitly enabled
    const clampS = tile.cmS === gbi.G_TX_CLAMP || (tile.maskS === 0);
    const clampT = tile.cmT === gbi.G_TX_CLAMP || (tile.maskT === 0);
    const mirrorS = tile.cmS === gbi.G_TX_MIRROR;
    const mirrorT = tile.cmT === gbi.G_TX_MIRROR;

    const modeS = clampS ? gl.CLAMP_TO_EDGE : (mirrorS ? gl.MIRRORED_REPEAT : gl.REPEAT);
    const modeT = clampT ? gl.CLAMP_TO_EDGE : (mirrorT ? gl.MIRRORED_REPEAT : gl.REPEAT);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, modeS);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, modeT);
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


class NativeTransform {
  constructor() {
    this.initDimensions(320, 240);
  }

  initDimensions(viWidth, viHeight) {
    this.viWidth = viWidth;
    this.viHeight = viHeight;
    // Convert n64 framebuffer coordinates into normalised device coordinates (-1 to +1).
    this.n64FramebufferToDevice = new Transform2D(new Vector2(2 / viWidth, -2 / viHeight), new Vector2(-1, +1));

    // TODO: confirm these. I'm not sure where the z scale/trans should come from.
    const viX = viWidth / 2;
    const viY = viHeight / 2;
    // Scale by slightly more than the translate.
    // This fixes the menu in StarFox which was rendering these at z=-1.002.
    const zScale = 512;
    const zTrans = 511;

    // Note scale.y is flipped.
    const viScale = new Vector4(viX, -viY, zScale, 1);
    const viTrans = new Vector4(viX, +viY, zTrans, 0);
    this.viTransform = new Transform4D(viScale, viTrans);
  }

  // Used by fillRec/texRect - ignores viewport.
  convertN64ToDisplay(n64Vec2) {
    return this.n64FramebufferToDevice.transform(n64Vec2);
  }
}

function shiftFactor(shift) {
  if (shift <= 10) {
    return 1 / (1 << shift);
  }
  return 1 << (16 - shift);
}

