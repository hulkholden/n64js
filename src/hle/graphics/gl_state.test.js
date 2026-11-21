import { describe, expect, test } from 'bun:test';
import * as gbi from './gbi.js';
import { GLState } from './gl_state.js';
import { ProjectedVertex } from './projected_vertex.js';
import { RenderTargets } from './render_targets.js';
import { Renderer } from './renderer.js';
import { RSPState } from './rsp_state.js';
import { TriangleBuffer } from './triangle_buffer.js';

function createRecordingGL({ inactiveUniforms = new Set() } = {}) {
  const calls = [];
  let nextId = 0;
  const record = (name, ...args) => {
    calls.push([name, ...args]);
  };
  const gl = {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    ARRAY_BUFFER: 0x8892,
    DYNAMIC_DRAW: 0x88e8,
    STATIC_DRAW: 0x88e4,
    FLOAT: 0x1406,
    UNSIGNED_BYTE: 0x1401,
    TRIANGLES: 0x0004,
    TRIANGLE_STRIP: 0x0005,
    TEXTURE0: 0x84c0,
    TEXTURE1: 0x84c1,
    TEXTURE_2D: 0x0de1,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    NEAREST: 0x2600,
    LINEAR: 0x2601,
    CLAMP_TO_EDGE: 0x812f,
    RGBA: 0x1908,
    R8UI: 0x8232,
    RED_INTEGER: 0x8d94,
    FRAMEBUFFER: 0x8d40,
    COLOR_ATTACHMENT0: 0x8ce0,
    DEPTH_ATTACHMENT: 0x8d00,
    RENDERBUFFER: 0x8d41,
    DEPTH_COMPONENT16: 0x81a5,
    SCISSOR_TEST: 0x0c11,
    DEPTH_TEST: 0x0b71,
    CULL_FACE: 0x0b44,
    BLEND: 0x0be2,
    FRONT: 0x0404,
    BACK: 0x0405,
    LEQUAL: 0x0203,
    ALWAYS: 0x0207,
    ZERO: 0,
    SRC_ALPHA: 0x0302,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    CONSTANT_ALPHA: 0x8003,
    ONE_MINUS_CONSTANT_ALPHA: 0x8004,
    FUNC_ADD: 0x8006,
    COLOR_BUFFER_BIT: 0x4000,
    DEPTH_BUFFER_BIT: 0x0100,
    calls,
    clearCalls() { calls.length = 0; },
    callsNamed(name) { return calls.filter(entry => entry[0] === name); },
    createShader: type => ({ id: ++nextId, type }),
    shaderSource() {},
    compileShader() {},
    getShaderParameter: () => true,
    getShaderInfoLog: () => '',
    createProgram: () => ({ id: ++nextId }),
    attachShader() {},
    detachShader() {},
    deleteShader() {},
    deleteProgram() {},
    linkProgram() {},
    getProgramParameter: () => true,
    getProgramInfoLog: () => '',
    getAttribLocation: () => 0,
    getUniformLocation: (_program, name) => (inactiveUniforms.has(name) ? null : name),
    createVertexArray: () => ({ id: ++nextId }),
    createBuffer: () => ({ id: ++nextId }),
    createTexture: () => ({ id: ++nextId }),
    createFramebuffer: () => ({ id: ++nextId }),
    createRenderbuffer: () => ({ id: ++nextId }),
    createSampler: () => ({ id: ++nextId }),
    deleteTexture() {},
    deleteFramebuffer() {},
    deleteRenderbuffer() {},
    samplerParameteri() {},
    bindSampler() {},
    enableVertexAttribArray() {},
    vertexAttribPointer() {},
    bufferData() {},
    bufferSubData() {},
    texParameteri() {},
    texImage2D() {},
    texSubImage2D() {},
    bindFramebuffer() {},
    bindRenderbuffer() {},
    renderbufferStorage() {},
    framebufferTexture2D() {},
    framebufferRenderbuffer() {},
    viewport() {},
    clearColor() {},
    clearDepth() {},
    clear() {},
    useProgram: program => record('useProgram', program),
    bindVertexArray: vao => record('bindVertexArray', vao),
    bindBuffer: (target, buffer) => record('bindBuffer', target, buffer),
    activeTexture: unit => record('activeTexture', unit),
    bindTexture: (target, texture) => record('bindTexture', target, texture),
    enable: cap => record('enable', cap),
    disable: cap => record('disable', cap),
    scissor: (x, y, w, h) => record('scissor', x, y, w, h),
    depthRange: (n, f) => record('depthRange', n, f),
    depthFunc: func => record('depthFunc', func),
    depthMask: flag => record('depthMask', flag),
    cullFace: mode => record('cullFace', mode),
    blendFunc: (s, d) => record('blendFunc', s, d),
    blendFuncSeparate: (sr, dr, sa, da) => record('blendFuncSeparate', sr, dr, sa, da),
    blendEquation: mode => record('blendEquation', mode),
    blendColor: (r, g, b, a) => record('blendColor', r, g, b, a),
    uniform1i: (loc, v) => record('uniform1i', loc, v),
    uniform1f: (loc, v) => record('uniform1f', loc, v),
    uniform2i: (loc, a, b) => record('uniform2i', loc, a, b),
    uniform2f: (loc, a, b) => record('uniform2f', loc, a, b),
    uniform4i: (loc, a, b, c, d) => record('uniform4i', loc, a, b, c, d),
    uniform4f: (loc, a, b, c, d) => record('uniform4f', loc, a, b, c, d),
    uniform4fv: (loc, v) => record('uniform4fv', loc, v),
    drawArrays: (mode, first, count) => record('drawArrays', mode, first, count),
  };
  return gl;
}

function makeTriangleBuffer() {
  const tb = new TriangleBuffer(2);
  const v = new ProjectedVertex();
  v.pos.elems.set([0, 0, 0, 1]);
  v.color = 0xffffffff;
  v.u = 1;
  v.v = 2;
  tb.pushTri(v, v, v);
  return tb;
}

describe('GLState', () => {
  test('deduplicates redundant state calls and re-emits after reset or invalidation', () => {
    const gl = createRecordingGL();
    const state = new GLState(gl);
    const progA = { id: 1 };
    const vaoA = { id: 2 };
    const bufA = { id: 3 };
    const texA = { id: 4 };

    state.useProgram(progA);
    state.useProgram(progA);
    state.bindVertexArray(vaoA);
    state.bindVertexArray(vaoA);
    state.bindArrayBuffer(bufA);
    state.bindArrayBuffer(bufA);
    state.bindTexture0(texA);
    state.bindTexture0(texA);
    state.setScissor(-1, -1, 10, 20);
    state.setScissor(-1, -1, 10, 20);
    state.setDepthRange(0, 1);
    state.setDepthRange(0, 1);
    state.setDepthTestEnabled(true);
    state.setDepthTestEnabled(true);
    state.setDepthFunc(gl.LEQUAL);
    state.setDepthFunc(gl.LEQUAL);
    state.setDepthMask(true);
    state.setDepthMask(true);
    state.setCullFace(true, gl.BACK);
    state.setCullFace(true, gl.BACK);
    state.setBlendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    state.setBlendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    state.setBlendEquation(gl.FUNC_ADD);
    state.setBlendEquation(gl.FUNC_ADD);
    state.setBlendColorAlpha(0.5);
    state.setBlendColorAlpha(0.5);
    state.setBlendEnabled(true);
    state.setBlendEnabled(true);

    expect(gl.callsNamed('useProgram')).toHaveLength(1);
    expect(gl.callsNamed('bindVertexArray')).toHaveLength(1);
    expect(gl.callsNamed('bindBuffer')).toHaveLength(1);
    expect(gl.callsNamed('activeTexture')).toHaveLength(1);
    expect(gl.callsNamed('bindTexture')).toHaveLength(1);
    expect(gl.callsNamed('scissor')).toEqual([['scissor', -1, -1, 10, 20]]);
    expect(gl.callsNamed('depthRange')).toHaveLength(1);
    expect(gl.callsNamed('depthFunc')).toHaveLength(1);
    expect(gl.callsNamed('depthMask')).toHaveLength(1);
    expect(gl.callsNamed('cullFace')).toHaveLength(1);
    expect(gl.callsNamed('blendFunc')).toHaveLength(1);
    expect(gl.callsNamed('blendEquation')).toHaveLength(1);
    expect(gl.callsNamed('blendColor')).toHaveLength(1);

    // Targeted invalidation only re-emits texture calls.
    gl.clearCalls();
    state.invalidateTexture();
    state.useProgram(progA);
    state.bindTexture0(texA);
    expect(gl.callsNamed('useProgram')).toHaveLength(0);
    expect(gl.callsNamed('activeTexture')).toHaveLength(1);
    expect(gl.callsNamed('bindTexture')).toHaveLength(1);

    // Separate blend factors use blendFuncSeparate and are deduplicated.
    gl.clearCalls();
    state.setBlendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA, gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    state.setBlendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA, gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    expect(gl.callsNamed('blendFuncSeparate')).toHaveLength(1);

    // Reset allows binding null handles explicitly.
    gl.clearCalls();
    state.reset();
    state.bindVertexArray(null);
    state.bindTexture0(null);
    expect(gl.callsNamed('bindVertexArray')).toEqual([['bindVertexArray', null]]);
    expect(gl.callsNamed('bindTexture')).toEqual([['bindTexture', gl.TEXTURE_2D, null]]);
  });
});

describe('Renderer state and uniform deduplication', () => {
  test('eliminates redundant GL state and uniform calls on repeated identical draws', () => {
    const gl = createRecordingGL({ inactiveUniforms: new Set(['uAlphaThreshold', 'uConvertK45', 'uFogColor']) });
    const state = new RSPState();
    state.reset(new DataView(new ArrayBuffer(4096)), 0);
    state.rdpOtherModeH = gbi.CycleType.G_CYC_1CYCLE | gbi.TextureFilter.G_TF_BILERP;
    state.rdpOtherModeL = gbi.RenderMode.Z_CMP | gbi.RenderMode.Z_UPD;
    state.geometryMode.texture = 1;
    state.geometryMode.zbuffer = 1;
    state.geometryMode.cullBack = 1;
    state.combine.hi = 0x00112233;
    state.combine.lo = 0x44556677;
    state.primColor = 0x11223344;
    state.envColor = 0x55667788;
    state.tiles[0].set(0, 2, 4, 0, 0, 0, 4, 0, 0, 4, 0);
    state.tiles[0].setSize(0, 0, 60, 60);

    const renderer = new Renderer(gl, state, 320, 240);
    renderer.newFrame();
    gl.clearCalls();

    // First draw sets up program, VAO, texture, fixed-function state, and active uniforms.
    renderer.flushTris(makeTriangleBuffer());
    expect(gl.callsNamed('useProgram')).toHaveLength(1);
    expect(gl.callsNamed('bindVertexArray')).toHaveLength(1);
    expect(gl.callsNamed('bindBuffer')).toHaveLength(1);
    expect(gl.callsNamed('uniform1i').some(c => c[1] === 'uTMEM' && c[2] === 0)).toBe(true);
    // Inactive (null) uniform locations are never uploaded.
    expect(gl.calls.some(c => c[1] === null)).toBe(false);

    // Second identical draw should issue only drawArrays (zero redundant state/uniform calls).
    gl.clearCalls();
    renderer.flushTris(makeTriangleBuffer());
    expect(gl.calls).toEqual([['drawArrays', gl.TRIANGLES, 0, 3]]);

    // Mutating only primColor uploads only uPrimColor + drawArrays.
    gl.clearCalls();
    state.primColor = 0xaabbccdd;
    renderer.flushTris(makeTriangleBuffer());
    expect(gl.calls).toEqual([
      ['uniform4f', 'uPrimColor', 0xaa / 255, 0xbb / 255, 0xcc / 255, 0xdd / 255],
      ['drawArrays', gl.TRIANGLES, 0, 3],
    ]);

    // Mutating a tile field directly uploads only the affected tile uniform.
    gl.clearCalls();
    state.tiles[0].maskS = 5;
    renderer.flushTris(makeTriangleBuffer());
    expect(gl.calls).toEqual([
      ['uniform2i', 'uTile0.mask', 5, 4],
      ['drawArrays', gl.TRIANGLES, 0, 3],
    ]);
  });

  test('preserves per-shader uniform caches across program switches and re-syncs after hazards', () => {
    const gl = createRecordingGL();
    const state = new RSPState();
    state.reset(new DataView(new ArrayBuffer(4096)), 0);
    state.rdpOtherModeH = gbi.CycleType.G_CYC_1CYCLE;
    state.rdpOtherModeL = gbi.RenderMode.Z_CMP | gbi.RenderMode.Z_UPD;
    state.geometryMode.texture = 1;
    state.geometryMode.zbuffer = 1;
    state.geometryMode.cullBack = 1;
    state.tiles[0].set(0, 2, 4, 0, 0, 0, 4, 0, 0, 4, 0);
    state.tiles[0].setSize(0, 0, 60, 60);

    const renderer = new Renderer(gl, state, 320, 240);
    renderer.newFrame();

    // Draw with shader A, then shader B, then return to shader A with unchanged state.
    state.combine.hi = 0x00112233;
    renderer.flushTris(makeTriangleBuffer());
    state.combine.hi = 0x00abcdef;
    renderer.flushTris(makeTriangleBuffer());
    gl.clearCalls();
    state.combine.hi = 0x00112233;
    renderer.flushTris(makeTriangleBuffer());
    expect(gl.callsNamed('useProgram')).toHaveLength(1);
    expect(gl.calls.filter(c => c[0].startsWith('uniform'))).toHaveLength(0);

    // RenderTargets.createTarget unbinds TEXTURE_2D; next draw must rebind TMEMTexture.
    gl.clearCalls();
    renderer.renderTargets.createTarget();
    renderer.flushTris(makeTriangleBuffer());
    expect(gl.callsNamed('bindTexture').at(-1)).toEqual(['bindTexture', gl.TEXTURE_2D, renderer.tmemTexture.texture]);

    // Replacing renderTargets attaches the hook and invalidates GL state.
    gl.clearCalls();
    renderer.renderTargets = new RenderTargets(gl, 320, 240);
    renderer.flushTris(makeTriangleBuffer());
    expect(gl.callsNamed('useProgram')).toHaveLength(1);
    expect(gl.callsNamed('bindVertexArray')).toHaveLength(1);
    expect(gl.callsNamed('bindTexture').at(-1)).toEqual(['bindTexture', gl.TEXTURE_2D, renderer.tmemTexture.texture]);

    // fillRect mutates program, VAO, array buffer, cull, depth; next flushTris restores them.
    gl.clearCalls();
    renderer.fillRect(0, 0, 10, 10, { r: 1, g: 0, b: 0, a: 1 });
    gl.clearCalls();
    renderer.flushTris(makeTriangleBuffer());
    expect(gl.callsNamed('useProgram')).toHaveLength(1);
    expect(gl.callsNamed('bindVertexArray')).toHaveLength(1);
    expect(gl.callsNamed('bindBuffer')).toHaveLength(1);
    expect(gl.callsNamed('enable')).toEqual([['enable', gl.DEPTH_TEST], ['enable', gl.CULL_FACE]]);
    expect(gl.callsNamed('depthMask')).toEqual([['depthMask', true]]);

    // debugClear disables SCISSOR_TEST; next draw re-enables it.
    renderer.debugClear();
    gl.clearCalls();
    renderer.flushTris(makeTriangleBuffer());
    expect(gl.callsNamed('enable')).toEqual([['enable', gl.SCISSOR_TEST]]);
  });
});
