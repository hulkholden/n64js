import * as gbi from './gbi.js';
import * as logger from '../../logger.js';
import { assert } from '../../assert.js';
import vertexSource from './shaders/n64.vert.glsl' with { type: 'text' };
import fragmentSource from './shaders/n64.frag.glsl' with { type: 'text' };
import tmemSource from './shaders/tmem.glsl' with { type: 'text' };

/**
 * Whether to log shaders as they're compiled.
 */
const kLogShaders = false;

/**
 * Per-WebGL-context cache of compiled combiner programs and shared vertex shaders.
 * @type {!WeakMap<!WebGLRenderingContext, {shaderCache: !Map<string, !N64Shader>, vertexShaders: !Map<boolean, !WebGLShader>}>}
 */
const contextCaches = new WeakMap();

/**
 * Returns or creates the shader caches scoped to a WebGL context.
 * @param {!WebGLRenderingContext} gl The rendering context to use.
 * @return {{shaderCache: !Map<string, !N64Shader>, vertexShaders: !Map<boolean, !WebGLShader>}}
 */
function getContextCache(gl) {
  let cache = contextCaches.get(gl);
  if (!cache) {
    cache = {
      shaderCache: new Map(),
      vertexShaders: new Map(),
    };
    contextCaches.set(gl, cache);
  }
  return cache;
}

const rgbParams32 = [
  'combined.rgb', 'tex0.rgb', 'tex1.rgb', 'uPrimColor.rgb', 'shade.rgb', 'uEnvColor.rgb', 'one.rgb',
  'combined.a',   'tex0.a',   'tex1.a',   'uPrimColor.a',   'shade.a',   'uEnvColor.a',
  'lod_frac', 'uPrimLodFrac','uConvertK45.y',
  '?           ', '?           ',
  '?           ', '?           ',
  '?           ', '?           ',
  '?           ', '?           ',
  '?           ', '?           ',
  '?           ', '?           ',
  '?           ', '?           ',
  '?           ', 'zero.rgb'
];

// Tex0 and Tex1 are swapped in the second cycle.
// TODO: is there an easier way to do this without duplicating the table?
const rgbParams32C2 = [
  'combined.rgb', 'tex1.rgb', 'tex0.rgb', 'uPrimColor.rgb', 'shade.rgb', 'uEnvColor.rgb', 'one.rgb',
  'combined.a',   'tex1.a',   'tex0.a',   'uPrimColor.a',   'shade.a',   'uEnvColor.a',
  'lod_frac', 'uPrimLodFrac', 'uConvertK45.y',
  '?           ', '?           ',
  '?           ', '?           ',
  '?           ', '?           ',
  '?           ', '?           ',
  '?           ', '?           ',
  '?           ', '?           ',
  '?           ', '?           ',
  '?           ', 'zero.rgb'
];

const rgbParams16 = [
  'combined.rgb', 'tex0.rgb', 'tex1.rgb', 'uPrimColor.rgb', 'shade.rgb', 'uEnvColor.rgb', 'one.rgb',
  'combined.a',   'tex0.a',   'tex1.a',   'uPrimColor.a',   'shade.a',   'uEnvColor.a',
  'lod_frac', 'uPrimLodFrac', 'zero.rgb'
];

const rgbParams16C2 = [
  'combined.rgb', 'tex1.rgb', 'tex0.rgb', 'uPrimColor.rgb', 'shade.rgb', 'uEnvColor.rgb', 'one.rgb',
  'combined.a',  'tex1.a',   'tex0.a',   'uPrimColor.a',   'shade.a',   'uEnvColor.a',
  'lod_frac', 'uPrimLodFrac', 'zero.rgb'
];

// Subtract input 7 is K4; the add/subtract-A input at that index is noise.
const rgbParamsSubB = [...rgbParams16];
const rgbParamsSubBC2 = [...rgbParams16C2];
rgbParamsSubB[7] = rgbParamsSubBC2[7] = 'vec3(uConvertK45.x)';

const rgbParams8 = [
  'combined.rgb', 'tex0.rgb', 'tex1.rgb', 'uPrimColor.rgb', 'shade.rgb', 'uEnvColor.rgb',
  'one.rgb', 'zero.rgb'
];

const rgbParams8C2 = [
  'combined.rgb', 'tex1.rgb', 'tex0.rgb', 'uPrimColor.rgb', 'shade.rgb', 'uEnvColor.rgb',
  'one.rgb', 'zero.rgb'
];

const alphaParams8 = [
  'combined.a', 'tex0.a', 'tex1.a', 'uPrimColor.a', 'shade.a', 'uEnvColor.a',
  'one.a', 'zero.a'
];

const alphaParams8C2 = [
  'combined.a', 'tex1.a', 'tex0.a', 'uPrimColor.a', 'shade.a', 'uEnvColor.a',
  'one.a', 'zero.a'
];

// Alpha C selects LOD fractions where A/B/D select combined alpha and one.
const alphaMulParams8 = [
  'lod_frac', 'tex0.a', 'tex1.a', 'uPrimColor.a', 'shade.a', 'uEnvColor.a',
  'uPrimLodFrac', 'zero.a'
];

const alphaMulParams8C2 = [
  'lod_frac', 'tex1.a', 'tex0.a', 'uPrimColor.a', 'shade.a', 'uEnvColor.a',
  'uPrimLodFrac', 'zero.a'
];

const kMulInputRGB = [
  'Combined    ', 'Texel0      ',
  'Texel1      ', 'Primitive   ',
  'Shade       ', 'Env         ',
  'KeyScale    ', 'CombinedAlph',
  'Texel0_Alpha', 'Texel1_Alpha',
  'Prim_Alpha  ', 'Shade_Alpha ',
  'Env_Alpha   ', 'LOD_Frac    ',
  'PrimLODFrac ', 'K5          ',
  '0           ', '0           ',
  '0           ', '0           ',
  '0           ', '0           ',
  '0           ', '0           ',
  '0           ', '0           ',
  '0           ', '0           ',
  '0           ', '0           ',
  '0           ', '0           '
];

const kSubAInputRGB = [
  'Combined    ', 'Texel0      ',
  'Texel1      ', 'Primitive   ',
  'Shade       ', 'Env         ',
  '1           ', 'Noise       ',
  '0           ', '0           ',
  '0           ', '0           ',
  '0           ', '0           ',
  '0           ', '0           '
];

const kSubBInputRGB = [
  'Combined    ', 'Texel0      ',
  'Texel1      ', 'Primitive   ',
  'Shade       ', 'Env         ',
  'KeyCenter   ', 'K4          ',
  '0           ', '0           ',
  '0           ', '0           ',
  '0           ', '0           ',
  '0           ', '0           '
];

const kAddInputRGB = [
  'Combined    ', 'Texel0      ',
  'Texel1      ', 'Primitive   ',
  'Shade       ', 'Env         ',
  '1           ', '0           '
];

const kSubInputA = [
  'Combined    ', 'Texel0      ',
  'Texel1      ', 'Primitive   ',
  'Shade       ', 'Env         ',
  '1           ', '0           '
];

const kMulInputA = [
  'LOD_Frac    ', 'Texel0      ',
  'Texel1      ', 'Primitive   ',
  'Shade       ', 'Env         ',
  'PrimLODFrac ', '0           '
];

const kAddInputA = [
  'Combined    ', 'Texel0      ',
  'Texel1      ', 'Primitive   ',
  'Shade       ', 'Env         ',
  '1           ', '0           '
];

/**
 * Creates a shader program from vertex and fragment shader sources.
 * @param {!WebGLRenderingContext} gl The rendering context to use.
 * @param {string} vertexSource The vertex shader source.
 * @param {string} fragmentSource The fragment shader source.
 * @return {!WebGLProgram}
 */
export function createShaderProgram(gl, vertexSource, fragmentSource) {
  const vertexShader = compileShader(gl, vertexSource, gl.VERTEX_SHADER);
  const fragmentShader = compileShader(gl, fragmentSource, gl.FRAGMENT_SHADER);
  return linkShaderProgram(gl, vertexShader, fragmentShader);
}

/**
 * Compiles a WebGL shader without querying COMPILE_STATUS.
 * Compilation status is only inspected if program linking fails.
 * @param {!WebGLRenderingContext} gl The rendering context to use.
 * @param {string} source The shader source.
 * @param {number} type gl.FRAGMENT_SHADER or gl.VERTEX_SHADER.
 * @return {?WebGLShader}
 */
function compileShader(gl, source, type) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return shader;
}

/**
 * Formats compiler and linker diagnostics after LINK_STATUS fails.
 * @param {!WebGLRenderingContext} gl The rendering context to use.
 * @param {?WebGLProgram} program The failed shader program.
 * @param {?WebGLShader} vertexShader The attached vertex shader.
 * @param {?WebGLShader} fragmentShader The attached fragment shader.
 * @return {string}
 */
function formatShaderProgramError(gl, program, vertexShader, fragmentShader) {
  const details = [];
  if (vertexShader && !gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
    const log = (gl.getShaderInfoLog(vertexShader) ?? '').trim();
    details.push(log ? `vertex shader: ${log}` : 'vertex shader failed to compile');
  }
  if (fragmentShader && !gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
    const log = (gl.getShaderInfoLog(fragmentShader) ?? '').trim();
    details.push(log ? `fragment shader: ${log}` : 'fragment shader failed to compile');
  }
  const programLog = (program ? (gl.getProgramInfoLog(program) ?? '') : '').trim();
  if (programLog) {
    details.push(`program link: ${programLog}`);
  }
  if (details.length === 0) {
    return 'Unable to initialize the shader program.';
  }
  return `Unable to initialize the shader program:\n${details.join('\n')}`;
}

/**
 * Attaches and links shaders into a WebGL program, deferring COMPILE_STATUS
 * queries until LINK_STATUS fails, and releases one-off shader handles.
 * @param {!WebGLRenderingContext} gl The rendering context to use.
 * @param {?WebGLShader} vertexShader The compiled vertex shader.
 * @param {?WebGLShader} fragmentShader The compiled fragment shader.
 * @param {{retainVertexShader?: boolean, retainVertexShaderOnFailure?: boolean}=} options
 * @return {!WebGLProgram}
 */
function linkShaderProgram(gl, vertexShader, fragmentShader, { retainVertexShader = false, retainVertexShaderOnFailure = false } = {}) {
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const errorMessage = formatShaderProgramError(gl, program, vertexShader, fragmentShader);
    if (!retainVertexShaderOnFailure && vertexShader) {
      gl.deleteShader(vertexShader);
    }
    if (fragmentShader) {
      gl.deleteShader(fragmentShader);
    }
    if (program) {
      gl.deleteProgram(program);
    }
    assert(false, errorMessage);
  }

  if (!retainVertexShader) {
    gl.detachShader(program, vertexShader);
    gl.deleteShader(vertexShader);
  }
  gl.detachShader(program, fragmentShader);
  gl.deleteShader(fragmentShader);
  return program;
}

class N64Shader {
  /**
   * Constructs an N64Shader.
   * @param {!WebGLRenderingContext} gl The rendering context to use.
   * @param {!WebGLProgram} program The program to use.
   * @param {string} source The fragment shader source (for debugging).
   */
  constructor(gl, program, shaderSource) {
    this.program = program;
    this.shaderSource = shaderSource;

    this.uTextureFilterUniform   = gl.getUniformLocation(program, "uTextureFilter");
    this.uTextureRectEnabledUniform = gl.getUniformLocation(program, "uTextureRectEnabled");
    this.uTextureRectScreenUniform = gl.getUniformLocation(program, "uTextureRectScreen");
    this.uTextureRectOriginUniform = gl.getUniformLocation(program, "uTextureRectOrigin");
    this.uTextureRectDerivativesUniform = gl.getUniformLocation(program, "uTextureRectDerivatives");
    this.uTMEMUniform = gl.getUniformLocation(program, "uTMEM");
    this.textureUniforms = [0, 1].map(slot => ({
      scale: gl.getUniformLocation(program, `uTexScale${slot}`),
      offset: gl.getUniformLocation(program, `uTexOffset${slot}`),
      bounds: gl.getUniformLocation(program, `uTile${slot}.bounds`),
      mask: gl.getUniformLocation(program, `uTile${slot}.mask`),
      mode: gl.getUniformLocation(program, `uTile${slot}.mode`),
      enabled: gl.getUniformLocation(program, `uTile${slot}.enabled`),
      memory: gl.getUniformLocation(program, `uTile${slot}.memory`),
      palette: gl.getUniformLocation(program, `uTile${slot}.palette`),
      cachedEnabled: -1,
      cachedTmem: -1,
      cachedLine: -1,
      cachedFormat: -1,
      cachedSize: -1,
      cachedPalette: -1,
      cachedTlut: -1,
      cachedScaleS: NaN,
      cachedScaleT: NaN,
      cachedOffsetS: NaN,
      cachedOffsetT: NaN,
      cachedBounds0: NaN,
      cachedBounds1: NaN,
      cachedBounds2: NaN,
      cachedBounds3: NaN,
      cachedMaskS: -1,
      cachedMaskT: -1,
      cachedModeS: -1,
      cachedModeT: -1,
    }));

    this.uPrimColorUniform       = gl.getUniformLocation(program, "uPrimColor");
    this.uPrimLodFracUniform     = gl.getUniformLocation(program, "uPrimLodFrac");
    this.uEnvColorUniform        = gl.getUniformLocation(program, "uEnvColor");
    this.uFogColorUniform        = gl.getUniformLocation(program, "uFogColor");
    this.uConvertUniform         = gl.getUniformLocation(program, "uConvert");
    this.uConvertK45Uniform      = gl.getUniformLocation(program, "uConvertK45");
    this.uTextureConvertUniform  = gl.getUniformLocation(program, "uTextureConvert");
    this.uTextureYUVUniform      = gl.getUniformLocation(program, "uTextureYUV");
    this.uAlphaThresholdUniform  = gl.getUniformLocation(program, "uAlphaThreshold");
    this.uAffineUVUniform        = gl.getUniformLocation(program, "uAffineUV");

    // Last-uploaded uniform values for this WebGLProgram.
    this.tmemInitialized = false;
    this.affineUV = -1;
    this.textureFilter = -1;
    this.textureRectEnabled = -1;
    this.rectScreenX = NaN;
    this.rectScreenY = NaN;
    this.rectScreenW = NaN;
    this.rectOriginX = NaN;
    this.rectOriginY = NaN;
    this.rectOriginS = NaN;
    this.rectOriginT = NaN;
    this.rectDeriv0 = NaN;
    this.rectDeriv1 = NaN;
    this.rectDeriv2 = NaN;
    this.rectDeriv3 = NaN;
    this.alphaThreshold = NaN;
    this.convert0 = NaN;
    this.convert1 = NaN;
    this.convert2 = NaN;
    this.convert3 = NaN;
    this.convert4 = NaN;
    this.convert5 = NaN;
    this.textureConvert = -1;
    this.textureYUV = -1;
    this.primColor = -1;
    this.primLodFrac = NaN;
    this.envColor = -1;
    this.fogColor = -1;
  }
}

/**
 * Gets or creates a shader given the N64 state.
 * @param {!WebGLRenderingContext} gl The webgl context.
 * @param {number} mux0
 * @param {number} mux1
 * @param {number} cycleType A CycleType value.
 * @param {number} alphaCompare An AlphaCompare value.
 * @param {boolean} enableAlphaCvgKill Whether to approximate zero coverage by discarding zero alpha.
 * @param {boolean} noNearClipping Whether to clamp depth instead of clipping the near plane.
 * @param {number} blender The upper 16 bits of other mode L.
 * @param {boolean} constantFogColor Select fog RGB for a supported constant framebuffer blend.
 * @return {!N64Shader}
 */
export function getOrCreateN64Shader(gl, mux0, mux1, cycleType, alphaCompare, enableAlphaCvgKill, noNearClipping = false, blender = 0, constantFogColor = false) {
  // Check if this shader already exists. Copy/Fill are fixed-function so ignore mux for these.
  let stateText = (cycleType < gbi.CycleType.G_CYC_COPY) ? `${mux0 >>> 0}_${mux1 >>> 0}_${cycleType}` : cycleType.toString();
  const enableAlphaThreshold = (alphaCompare & gbi.AlphaCompare.G_AC_THRESHOLD) !== 0;
  if (enableAlphaThreshold) {
    stateText += `_alphaCompare${alphaCompare}`;
  }
  if (enableAlphaCvgKill) {
    stateText += `_alphaCvgKill`;
  }
  if (noNearClipping) {
    stateText += `_noNearClipping`;
  }
  // Shade-alpha fog can select FOG/IN or IN/FOG (ZSortp's soccer games).
  // This is an RDP draw-time choice, independent of the current RSP G_FOG bit.
  // Two bits per cycle: 1 = FOG * A + IN * (1-A), 2 = IN * A + FOG * (1-A).
  let fogBlendModes = 0;
  if (cycleType === gbi.CycleType.G_CYC_1CYCLE || cycleType === gbi.CycleType.G_CYC_2CYCLE) {
    const cycles = cycleType === gbi.CycleType.G_CYC_2CYCLE ? 2 : 1;
    for (let i = 0; i < cycles; i++) {
      const mode = (blender >>> (i === 0 ? 2 : 0)) & 0x3333;
      if (mode === 0x3200) {
        fogBlendModes |= 1 << (i * 2);
      }
      if (mode === 0x0230) {
        fogBlendModes |= 2 << (i * 2);
      }
    }
  }
  if (fogBlendModes) {
    stateText += `_fogShadeAlpha${fogBlendModes}`;
  }
  if (constantFogColor) {
    stateText += '_constantFogColor';
  }

  const { shaderCache, vertexShaders } = getContextCache(gl);
  let shader = shaderCache.get(stateText);
  if (shader) {
    return shader;
  }

  const configureClipping = source => source.replace('__NEAR_CLIPPING__', noNearClipping ? '0' : '1');
  let vertexShader = vertexShaders.get(noNearClipping);
  const createdVertexShader = !vertexShader;
  if (createdVertexShader) {
    vertexShader = compileShader(gl, configureClipping(vertexSource), gl.VERTEX_SHADER);
  }

  let aRGB0 = (mux0 >>> 20) & 0x0F;
  let bRGB0 = (mux1 >>> 28) & 0x0F;
  let cRGB0 = (mux0 >>> 15) & 0x1F;
  let dRGB0 = (mux1 >>> 15) & 0x07;

  let aA0   = (mux0 >>> 12) & 0x07;
  let bA0   = (mux1 >>> 12) & 0x07;
  let cA0   = (mux0 >>>  9) & 0x07;
  let dA0   = (mux1 >>>  9) & 0x07;

  let aRGB1 = (mux0 >>>  5) & 0x0F;
  let bRGB1 = (mux1 >>> 24) & 0x0F;
  let cRGB1 = (mux0 >>>  0) & 0x1F;
  let dRGB1 = (mux1 >>>  6) & 0x07;

  let aA1   = (mux1 >>> 21) & 0x07;
  let bA1   = (mux1 >>>  3) & 0x07;
  let cA1   = (mux1 >>> 18) & 0x07;
  let dA1   = (mux1 >>>  0) & 0x07;

  // Generate the instructions for this mode.
  let body;
  if (cycleType === gbi.CycleType.G_CYC_FILL) {
    body = '  col = shade;\n';
  } else if (cycleType === gbi.CycleType.G_CYC_COPY) {
    body = '  col = tex0;\n';
  } else if (cycleType === gbi.CycleType.G_CYC_1CYCLE) {
    body= '';
    body += '  col.rgb = (' + rgbParams16 [aRGB0] + ' - ' + rgbParamsSubB [bRGB0] + ') * ' + rgbParams32 [cRGB0] + ' + ' + rgbParams8  [dRGB0] + ';\n';
    body += '  col.a = ('   + alphaParams8[  aA0] + ' - ' + alphaParams8[  bA0] + ') * ' + alphaMulParams8[  cA0] + ' + ' + alphaParams8[  dA0] + ';\n';
  } else {
    body= '';
    body += '  col.rgb = (' + rgbParams16 [aRGB0] + ' - ' + rgbParamsSubB [bRGB0] + ') * ' + rgbParams32 [cRGB0] + ' + ' + rgbParams8  [dRGB0] + ';\n';
    body += '  col.a = ('   + alphaParams8[  aA0] + ' - ' + alphaParams8[  bA0] + ') * ' + alphaMulParams8[  cA0] + ' + ' + alphaParams8[  dA0] + ';\n';
    body += '  combined = vec4(col.rgb, col.a);\n';
    body += '  col.rgb = (' + rgbParams16C2 [aRGB1] + ' - ' + rgbParamsSubBC2 [bRGB1] + ') * ' + rgbParams32C2 [cRGB1] + ' + ' + rgbParams8C2  [dRGB1] + ';\n';
    body += '  col.a = ('   + alphaParams8C2[  aA1] + ' - ' + alphaParams8C2[  bA1] + ') * ' + alphaMulParams8C2[  cA1] + ' + ' + alphaParams8C2[  dA1] + ';\n';
  }

  if (enableAlphaThreshold) {
    // The RDP accepts alpha equal to the blend threshold. See alpha_compare:
    // https://github.com/ata4/angrylion-rdp-plus/blob/master/src/core/n64video/rdp/blender.c
    // Dither is still unimplemented; retain its existing threshold fallback.
    const comparison = alphaCompare === gbi.AlphaCompare.G_AC_THRESHOLD ? '<' : '<=';
    body += `  if(col.a ${comparison} uAlphaThreshold) discard;\n`;
  }
  if (enableAlphaCvgKill) {
    // Preserve the renderer's coverage approximation, which must reject zero
    // even though threshold alpha comparison accepts equality.
    body += '  if(col.a <= 0.0) discard;\n';
  }

  for (let i = 0; i < 2; ++i) {
    // The blender sees the clamped combiner RGB. Preserve combiner alpha for
    // the final framebuffer blend and alpha test; fog comes from shade alpha.
    const mode = (fogBlendModes >>> (i * 2)) & 3;
    if (mode === 1) {
      body += '  col.rgb = mix(clamp(col.rgb, 0.0, 1.0), uFogColor.rgb, shade.a);\n';
    }
    if (mode === 2) {
      body += '  col.rgb = mix(uFogColor.rgb, clamp(col.rgb, 0.0, 1.0), shade.a);\n';
    }
  }

  if (constantFogColor) {
    // Alpha testing above and framebuffer alpha still use combiner alpha.
    body += '  col.rgb = uFogColor.rgb;\n';
  }

  const combinerSource = `
vec4 combineColor(vec4 shade, vec4 tex0, vec4 tex1) {
  vec4 col;
  vec4 combined = vec4(0,0,0,1);
${body}  return col;
}
`;
  const shaderSource = configureClipping(fragmentSource)
    .replace('__TMEM_SAMPLER__', tmemSource) + combinerSource;

  if (kLogShaders) {
    let decoded = '\n';
    decoded += '\tRGB0 = (' + kSubAInputRGB[aRGB0] + ' - ' + kSubBInputRGB[bRGB0] + ') * ' + kMulInputRGB[cRGB0] + ' + ' + kAddInputRGB[dRGB0] + '\n';
    decoded += '\t  A0 = (' + kSubInputA   [  aA0] + ' - ' + kSubInputA   [  bA0] + ') * ' + kMulInputA  [  cA0] + ' + ' + kAddInputA  [  dA0] + '\n';
    decoded += '\tRGB1 = (' + kSubAInputRGB[aRGB1] + ' - ' + kSubBInputRGB[bRGB1] + ') * ' + kMulInputRGB[cRGB1] + ' + ' + kAddInputRGB[dRGB1] + '\n';
    decoded += '\t  A1 = (' + kSubInputA   [  aA1] + ' - ' + kSubInputA   [  bA1] + ') * ' + kMulInputA  [  cA1] + ' + ' + kAddInputA  [  dA1] + '\n';

    let m = shaderSource.split('\n').join('<br>');
    logger.log('Compiled ' + decoded + '\nto\n' + m);
  }

  const fragmentShader = compileShader(gl, shaderSource, gl.FRAGMENT_SHADER);
  const glProgram = linkShaderProgram(gl, vertexShader, fragmentShader, {
    retainVertexShader: true,
    retainVertexShaderOnFailure: !createdVertexShader,
  });
  if (createdVertexShader) {
    vertexShaders.set(noNearClipping, vertexShader);
  }

  shader = new N64Shader(gl, glProgram, shaderSource);
  shaderCache.set(stateText, shader);
  return shader;
}

/**
 * Returns text that describes the specified combiner mode.
 * @param {number} mux0
 * @param {number} mux1
 * @return {string}
 */
export function getCombinerText(mux0, mux1) {
  let aRGB0 = (mux0 >>> 20) & 0x0F;
  let bRGB0 = (mux1 >>> 28) & 0x0F;
  let cRGB0 = (mux0 >>> 15) & 0x1F;
  let dRGB0 = (mux1 >>> 15) & 0x07;

  let aA0   = (mux0 >>> 12) & 0x07;
  let bA0   = (mux1 >>> 12) & 0x07;
  let cA0   = (mux0 >>>  9) & 0x07;
  let dA0   = (mux1 >>>  9) & 0x07;

  let aRGB1 = (mux0 >>>  5) & 0x0F;
  let bRGB1 = (mux1 >>> 24) & 0x0F;
  let cRGB1 = (mux0 >>>  0) & 0x1F;
  let dRGB1 = (mux1 >>>  6) & 0x07;

  let aA1   = (mux1 >>> 21) & 0x07;
  let bA1   = (mux1 >>>  3) & 0x07;
  let cA1   = (mux1 >>> 18) & 0x07;
  let dA1   = (mux1 >>>  0) & 0x07;

  let decoded = '';

  decoded += 'RGB0 = (' + kSubAInputRGB[aRGB0] + ' - ' + kSubBInputRGB[bRGB0] + ') * ' + kMulInputRGB[cRGB0] + ' + ' + kAddInputRGB[dRGB0] + '\n';
  decoded += '  A0 = (' + kSubInputA   [  aA0] + ' - ' + kSubInputA   [  bA0] + ') * ' + kMulInputA  [  cA0] + ' + ' + kAddInputA  [  dA0] + '\n';
  decoded += 'RGB1 = (' + kSubAInputRGB[aRGB1] + ' - ' + kSubBInputRGB[bRGB1] + ') * ' + kMulInputRGB[cRGB1] + ' + ' + kAddInputRGB[dRGB1] + '\n';
  decoded += '  A1 = (' + kSubInputA   [  aA1] + ' - ' + kSubInputA   [  bA1] + ') * ' + kMulInputA  [  cA1] + ' + ' + kAddInputA  [  dA1] + '\n';

  return decoded;
}
