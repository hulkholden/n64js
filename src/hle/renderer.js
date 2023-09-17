/*global $, n64js*/

import { toString16, toString32 } from "../format.js";
import { Transform2D } from '../graphics/Transform2D.js';
import { Vector2 } from "../graphics/Vector2.js";
import * as gbi from './gbi.js';
import * as shaders from './shaders.js';
import { Texture, clampTexture } from './textures.js';

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
    this.blitVertexPositionAttribute = gl.getAttribLocation(this.blitShaderProgram, "aVertexPosition");
    this.blitTexCoordAttribute = gl.getAttribLocation(this.blitShaderProgram, "aTextureCoord");
    this.blitSamplerUniform = gl.getUniformLocation(this.blitShaderProgram, "uSampler");

    this.fillShaderProgram = shaders.createShaderProgram(gl, "fill-shader-vs", "fill-shader-fs");
    this.fillVertexPositionAttribute = gl.getAttribLocation(this.fillShaderProgram, "aVertexPosition");
    this.fillFillColorUniform = gl.getUniformLocation(this.fillShaderProgram, "uFillColor");
    this.fillVerticesBuffer = gl.createBuffer();

    this.n64PositionsBuffer = gl.createBuffer();
    this.n64ColorsBuffer = gl.createBuffer();
    this.n64UVBuffer = gl.createBuffer();

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

  copyTextureToFrontBuffer(texture) {
    const gl = this.gl;
    // Passing null binds the framebuffer to the canvas.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const vertices = [
      -1.0, -1.0, 0.0, 1.0,
      1.0, -1.0, 0.0, 1.0,
      -1.0, 1.0, 0.0, 1.0,
      1.0, 1.0, 0.0, 1.0
    ];

    const uvs = [
      0.0, 0.0,
      1.0, 0.0,
      0.0, 1.0,
      1.0, 1.0
    ];

    gl.useProgram(this.blitShaderProgram);

    const canvas = document.getElementById('display');
    gl.viewport(0, 0, canvas.width, canvas.height);

    // aVertexPosition
    gl.enableVertexAttribArray(this.blitVertexPositionAttribute);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.n64PositionsBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    gl.vertexAttribPointer(this.blitVertexPositionAttribute, 4, gl.FLOAT, false, 0, 0);

    // aTextureCoord
    gl.enableVertexAttribArray(this.blitTexCoordAttribute);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.n64UVBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvs), gl.STATIC_DRAW);
    gl.vertexAttribPointer(this.blitTexCoordAttribute, 2, gl.FLOAT, false, 0, 0);

    // uSampler
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(this.blitSamplerUniform, 0);

    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
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
    let enableAlphaThreshold = false;
    let alphaThreshold = -1.0;

    if ((this.state.getAlphaCompareType() === gbi.AlphaCompare.G_AC_THRESHOLD)) {
      // TODO: it's unclear if this depends on CVG_X_ALPHA and ALPHA_CVG_SEL.
      alphaThreshold = ((this.state.blendColor >>> 0) & 0xff) / 255.0;
      enableAlphaThreshold = true;
    }

    const shader = this.getCurrentN64Shader(cycleType, enableAlphaThreshold);
    gl.useProgram(shader.program);

    // aVertexPosition
    gl.enableVertexAttribArray(shader.vertexPositionAttribute);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.n64PositionsBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    gl.vertexAttribPointer(shader.vertexPositionAttribute, 4, gl.FLOAT, false, 0, 0);

    // aVertexColor
    gl.enableVertexAttribArray(shader.vertexColorAttribute);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.n64ColorsBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, colours, gl.STATIC_DRAW);
    gl.vertexAttribPointer(shader.vertexColorAttribute, 4, gl.UNSIGNED_BYTE, true, 0, 0);

    // aTextureCoord
    gl.enableVertexAttribArray(shader.texCoordAttribute);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.n64UVBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, coords, gl.STATIC_DRAW);
    gl.vertexAttribPointer(shader.texCoordAttribute, 2, gl.FLOAT, false, 0, 0);

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

  getCurrentN64Shader(cycleType, enableAlphaThreshold) {
    const mux0 = this.state.combine.hi;
    const mux1 = this.state.combine.lo;

    return shaders.getOrCreateN64Shader(this.gl, mux0, mux1, cycleType, enableAlphaThreshold);
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

    const texture = new Texture(gl, tile.width, tile.height);
    if (!texture.$canvas[0].getContext) {
      return null;
    }

    this.$textureOutput.append(
      `${cacheID}: ${gbi.ImageFormat.nameOf(tile.format)}, ${gbi.ImageSize.nameOf(tile.size)},${tile.width}x${tile.height}, <br>`);

    const ctx = texture.$canvas[0].getContext('2d');
    const imgData = ctx.createImageData(texture.nativeWidth, texture.nativeHeight);

    const handled = this.state.tmem.convertTexels(tile, tlutFormat, imgData);
    if (handled) {
      clampTexture(imgData, tile.width, tile.height);

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
    let uvScaleU = 1.0 / texture.nativeWidth;
    let uvScaleV = 1.0 / texture.nativeHeight;

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
    // Displaylist-defined viewport - defaults to the entire screen.
    this.n64ViewportTransform = new Transform2D(new Vector2(viWidth, viHeight), new Vector2(0, 0));
  }

  setN64Viewport(t2d) {
    // TODO: is this affected by VI sx0/sy0 etc?
    this.n64ViewportTransform = t2d;
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