import { describe, expect, test } from 'bun:test';
import { AssertException } from '../../assert.js';
import * as gbi from './gbi.js';
import * as rdp_blend from './rdp_blend_constants.js';
import { Renderer } from './renderer.js';
import { RSPState } from './rsp_state.js';
import { createShaderProgram, getCombinerText, getOrCreateN64Shader } from './shaders.js';

function createMockGL() {
  let programsCreated = 0;
  return {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    ARRAY_BUFFER: 0x8892,
    FLOAT: 0x1406,
    UNSIGNED_BYTE: 0x1401,
    get programsCreated() { return programsCreated; },
    createShader: type => ({ type }),
    shaderSource() {},
    compileShader() {},
    getShaderParameter: () => true,
    getShaderInfoLog: () => '',
    createProgram: () => ({ id: ++programsCreated }),
    attachShader() {},
    detachShader() {},
    deleteShader() {},
    deleteProgram() {},
    linkProgram() {},
    getProgramParameter: () => true,
    getProgramInfoLog: () => '',
    createVertexArray: () => ({}),
    bindVertexArray() {},
    getAttribLocation: () => 0,
    createBuffer: () => ({}),
    enableVertexAttribArray() {},
    bindBuffer() {},
    vertexAttribPointer() {},
    getUniformLocation: (_program, name) => name,
    viewport() {},
  };
}

describe('combiner descriptions', () => {
  test('describes the distinct alpha multiplier and subtract input muxes', () => {
    // Ocarina of Time's NTSC name-entry keyboard combiner.
    const keyboard = getCombinerText(0x00ffadff, 0xfffd9238);
    expect(keyboard).toContain('A0 = (Texel1       - Texel0      ) * PrimLODFrac  + Texel0');
    expect(getCombinerText(0x00ffa1ff, 0xfffd9238)).toContain('* LOD_Frac');
    expect(getCombinerText(0x00ffedff, 0xfffd9238)).toContain('A0 = (1            - Texel0');
  });

  test('separates mux0 and mux1 in the shader cache key and normalizes signed values', () => {
    const gl = createMockGL();
    // Without a separator between mux0 and mux1, both pairs format to hex "123456789abcde".
    const shaderA = getOrCreateN64Shader(gl, 0x00123456, 0x789abcde, gbi.CycleType.G_CYC_1CYCLE, 0, false);
    const shaderB = getOrCreateN64Shader(gl, 0x01234567, 0x089abcde, gbi.CycleType.G_CYC_1CYCLE, 0, false);
    expect(shaderA).not.toBe(shaderB);
    expect(shaderA.shaderSource).toContain('(tex0.rgb - vec3(uConvertK45.x))');
    expect(shaderB.shaderSource).toContain('(tex1.rgb - combined.rgb)');

    const countBefore = gl.programsCreated;
    const unsignedShader = getOrCreateN64Shader(gl, 0x80123456, 0xfffd9238, gbi.CycleType.G_CYC_1CYCLE, 0, false);
    const signedShader = getOrCreateN64Shader(gl, 0x80123456 | 0, 0xfffd9238 | 0, gbi.CycleType.G_CYC_1CYCLE, 0, false);
    expect(signedShader).toBe(unsignedShader);
    expect(gl.programsCreated).toBe(countBefore + 1);
  });

  test('Renderer.getCurrentN64Shader caches the active shader and invalidates on state or frame changes', () => {
    const gl = createMockGL();
    const state = new RSPState();
    state.combine.hi = 0x00112233;
    state.combine.lo = 0x44556677;
    state.rdpOtherModeH = gbi.CycleType.G_CYC_1CYCLE;
    state.rdpOtherModeL = 0;

    const renderer = Object.assign(Object.create(Renderer.prototype), {
      gl,
      state,
      cpuFramebuffers: [null, null],
      renderTargets: {
        current: { framebuffer: { width: 320, height: 240 } },
        reset() {},
        beginFrame() {},
        bindCurrent() {},
      },
      tmemTexture: { reset() {} },
    });

    const initialShader = renderer.getCurrentN64Shader(false);
    expect(renderer.currentShader.shader).toBe(initialShader);

    // Replace currentShader.shader with a sentinel to verify the fast path
    // returns it directly without querying shaderCache when inputs are unchanged.
    const sentinel = { sentinel: true };
    renderer.currentShader.shader = sentinel;
    expect(renderer.getCurrentN64Shader(false)).toBe(sentinel);

    // Changing noNearClipping invalidates the per-renderer cached shader.
    const noNearShader = renderer.getCurrentN64Shader(true);
    expect(noNearShader).not.toBe(sentinel);
    expect(noNearShader).not.toBe(initialShader);

    // Changing combiner muxes invalidates the cached shader.
    renderer.currentShader.shader = sentinel;
    state.combine.hi = 0x00223344;
    expect(renderer.getCurrentN64Shader(true)).not.toBe(sentinel);

    renderer.currentShader.shader = sentinel;
    state.combine.lo = 0x55667788;
    expect(renderer.getCurrentN64Shader(true)).not.toBe(sentinel);

    // Changing cycleType in rdpOtherModeH invalidates the cached shader.
    renderer.currentShader.shader = sentinel;
    state.rdpOtherModeH = gbi.CycleType.G_CYC_2CYCLE;
    expect(renderer.getCurrentN64Shader(true)).not.toBe(sentinel);

    // Changing rdpOtherModeL (e.g. constant fog blend mode) invalidates the cached shader.
    renderer.currentShader.shader = sentinel;
    state.rdpOtherModeL = (rdp_blend.kFogColorWithFramebuffer << gbi.G_MDSFT_BLENDER) | gbi.RenderMode.FORCE_BL;
    const constantFogShader = renderer.getCurrentN64Shader(true);
    expect(constantFogShader).not.toBe(sentinel);
    expect(constantFogShader.shaderSource).toContain('col.rgb = uFogColor.rgb;');

    // newFrame() and reset() clear the cached shader reference on Renderer.
    renderer.currentShader.shader = sentinel;
    renderer.newFrame();
    expect(renderer.currentShader.shader).toBeNull();
    expect(renderer.getCurrentN64Shader(true)).toBe(constantFogShader);

    renderer.currentShader.shader = sentinel;
    renderer.reset();
    expect(renderer.currentShader.shader).toBeNull();
    expect(renderer.getCurrentN64Shader(true)).toBe(constantFogShader);
  });

  test('Renderer.setProgramState shares one VAO across shaders and uploads interleaved vertex data in a single bufferSubData call', () => {
    const calls = {
      createVertexArray: 0,
      createBuffer: 0,
      bindVertexArray: [],
      bindBuffer: 0,
      bufferData: [],
      bufferSubData: [],
      enableVertexAttribArray: [],
      vertexAttribPointer: [],
    };
    const baseGL = createMockGL();
    const gl = {
      ...baseGL,
      DYNAMIC_DRAW: 0x88e8,
      createVertexArray: () => ({ id: ++calls.createVertexArray }),
      bindVertexArray: vao => { calls.bindVertexArray.push(vao); },
      createBuffer: () => ({ id: ++calls.createBuffer }),
      bindBuffer: () => { calls.bindBuffer++; },
      bufferData: (_target, sizeOrData, usage) => { calls.bufferData.push({ sizeOrData, usage }); },
      bufferSubData: (_target, dstByteOffset, srcData, srcOffset, length) => {
        calls.bufferSubData.push({
          dstByteOffset,
          words: Array.from(new Uint32Array(srcData.buffer, srcOffset * 4, length)),
          floats: Array.from(srcData.subarray(srcOffset, srcOffset + length)),
        });
      },
      enableVertexAttribArray: loc => { calls.enableVertexAttribArray.push(loc); },
      vertexAttribPointer: (loc, size, type, normalized, stride, offset) => {
        calls.vertexAttribPointer.push({ loc, size, type, normalized, stride, offset });
      },
      useProgram() {},
      uniform1i() {},
      uniform1f() {},
      uniform2f() {},
      uniform2i() {},
      uniform4f() {},
      uniform4i() {},
    };

    const state = new RSPState();
    state.combine.hi = 0x00112233;
    state.combine.lo = 0x44556677;
    state.rdpOtherModeH = gbi.CycleType.G_CYC_1CYCLE;
    state.rdpOtherModeL = 0;

    const renderer = Object.assign(Object.create(Renderer.prototype), {
      gl,
      state,
      nativeTransform: { viWidth: 320, viHeight: 240 },
      renderTargets: { width: 320, height: 240, current: { framebuffer: { width: 320, height: 240 } } },
      tmemTexture: { bind() {} },
      applyScissor() {},
      setGLBlendMode() {},
      observeTextureUse() {},
    });
    renderer.n64VA = renderer.initN64VA();

    // VAO and interleaved attribute pointers are configured once at initialization.
    expect(calls.createVertexArray).toBe(1);
    expect(calls.createBuffer).toBe(1);
    expect(calls.bufferData).toEqual([{ sizeOrData: 64 * 3 * 28, usage: gl.DYNAMIC_DRAW }]);
    expect(calls.enableVertexAttribArray).toEqual([0, 1, 2]);
    expect(calls.vertexAttribPointer).toEqual([
      { loc: 0, size: 4, type: gl.FLOAT, normalized: false, stride: 28, offset: 0 },
      { loc: 1, size: 4, type: gl.UNSIGNED_BYTE, normalized: true, stride: 28, offset: 16 },
      { loc: 2, size: 2, type: gl.FLOAT, normalized: false, stride: 28, offset: 20 },
    ]);

    calls.bindVertexArray.length = 0;
    calls.bindBuffer = 0;
    calls.bufferData.length = 0;
    calls.enableVertexAttribArray.length = 0;
    calls.vertexAttribPointer.length = 0;

    const positions = new Float32Array([
      -1, 2, 0.5, 1,
      3, -4, 0.25, 2,
      0, 0, 0, 0, // trailing capacity beyond numVertices must not be uploaded
    ]);
    const colours = new Uint32Array([0x11223344, 0xaabbccdd, 0xffffffff]);
    const coords = new Float32Array([10.5, 20.25, -3.5, 4.75, 99, 99]);

    renderer.setProgramState(positions, colours, coords, false, false, 0, 2);

    // Changing combiner muxes compiles a new N64Shader without creating another VAO.
    state.combine.hi = 0x00556677;
    renderer.setProgramState(positions, colours, coords, false, false, 0, 2);

    expect(calls.createVertexArray).toBe(1);
    expect(calls.createBuffer).toBe(1);
    expect(calls.bufferData).toEqual([]);
    expect(calls.enableVertexAttribArray).toEqual([]);
    expect(calls.vertexAttribPointer).toEqual([]);
    expect(calls.bindBuffer).toBe(2);
    expect(calls.bufferSubData).toHaveLength(2);

    const upload = calls.bufferSubData[0];
    expect(upload.dstByteOffset).toBe(0);
    expect(upload.floats).toHaveLength(14);
    expect(upload.floats.slice(0, 4)).toEqual([-1, 2, 0.5, 1]);
    expect(upload.words[4]).toBe(0x11223344);
    expect(upload.floats.slice(5, 7)).toEqual([10.5, 20.25]);
    expect(upload.floats.slice(7, 11)).toEqual([3, -4, 0.25, 2]);
    expect(upload.words[11]).toBe(0xaabbccdd);
    expect(upload.floats.slice(12, 14)).toEqual([-3.5, 4.75]);
  });
});

function createTrackedMockGL({
  linkStatus = () => true,
  compileStatus = () => true,
  shaderInfoLog = () => '',
  programInfoLog = () => '',
} = {}) {
  const baseGL = createMockGL();
  let shaderId = 0;
  let programId = 0;
  const calls = [];
  const createdShaders = [];
  const detachedShaders = [];
  const deletedShaders = [];
  const deletedPrograms = [];
  const shaderParameterQueries = [];
  const shaderInfoLogQueries = [];
  const programParameterQueries = [];

  const gl = {
    ...baseGL,
    createShader(type) {
      const shader = { id: ++shaderId, type };
      createdShaders.push(shader);
      calls.push({ op: 'createShader', shader });
      return shader;
    },
    shaderSource(shader, source) {
      calls.push({ op: 'shaderSource', shader, source });
    },
    compileShader(shader) {
      calls.push({ op: 'compileShader', shader });
    },
    getShaderParameter(shader, pname) {
      shaderParameterQueries.push({ shader, pname });
      calls.push({ op: 'getShaderParameter', shader, pname });
      if (pname === baseGL.COMPILE_STATUS) {
        return compileStatus(shader);
      }
      return true;
    },
    getShaderInfoLog(shader) {
      shaderInfoLogQueries.push(shader);
      calls.push({ op: 'getShaderInfoLog', shader });
      return shaderInfoLog(shader);
    },
    createProgram() {
      const program = { id: ++programId };
      calls.push({ op: 'createProgram', program });
      return program;
    },
    attachShader(program, shader) {
      calls.push({ op: 'attachShader', program, shader });
    },
    detachShader(program, shader) {
      detachedShaders.push({ program, shader });
      calls.push({ op: 'detachShader', program, shader });
    },
    deleteShader(shader) {
      deletedShaders.push(shader);
      calls.push({ op: 'deleteShader', shader });
    },
    deleteProgram(program) {
      deletedPrograms.push(program);
      calls.push({ op: 'deleteProgram', program });
    },
    linkProgram(program) {
      calls.push({ op: 'linkProgram', program });
    },
    getProgramParameter(program, pname) {
      programParameterQueries.push({ program, pname });
      calls.push({ op: 'getProgramParameter', program, pname });
      if (pname === baseGL.LINK_STATUS) {
        return linkStatus(program);
      }
      return true;
    },
    getProgramInfoLog(program) {
      calls.push({ op: 'getProgramInfoLog', program });
      return programInfoLog(program);
    },
  };

  return {
    gl,
    calls,
    createdShaders,
    detachedShaders,
    deletedShaders,
    deletedPrograms,
    shaderParameterQueries,
    shaderInfoLogQueries,
    programParameterQueries,
  };
}

describe('shader compilation and linking', () => {
  test('createShaderProgram defers COMPILE_STATUS queries when LINK_STATUS succeeds and deletes one-off shaders', () => {
    const tracker = createTrackedMockGL();
    const { gl } = tracker;

    const program = createShaderProgram(gl, 'vert source', 'frag source');
    expect(program).toEqual({ id: 1 });
    expect(tracker.shaderParameterQueries).toEqual([]);
    expect(tracker.programParameterQueries).toEqual([{ program, pname: gl.LINK_STATUS }]);
    expect(tracker.deletedPrograms).toEqual([]);

    const [vertexShader, fragmentShader] = tracker.createdShaders;
    expect(vertexShader.type).toBe(gl.VERTEX_SHADER);
    expect(fragmentShader.type).toBe(gl.FRAGMENT_SHADER);
    expect(tracker.detachedShaders).toEqual([
      { program, shader: vertexShader },
      { program, shader: fragmentShader },
    ]);
    expect(tracker.deletedShaders).toEqual([vertexShader, fragmentShader]);

    const opOrder = tracker.calls.map(call => call.op);
    const linkIndex = opOrder.indexOf('linkProgram');
    const linkStatusIndex = opOrder.indexOf('getProgramParameter');
    expect(opOrder.filter(op => op === 'compileShader')).toHaveLength(2);
    expect(opOrder.filter(op => op === 'attachShader')).toHaveLength(2);
    expect(linkIndex).toBeGreaterThan(opOrder.lastIndexOf('attachShader'));
    expect(linkStatusIndex).toBe(linkIndex + 1);
  });

  test('getOrCreateN64Shader skips COMPILE_STATUS when linking succeeds, deletes fragment shaders, and retains shared vertex shaders', () => {
    const tracker = createTrackedMockGL();
    const { gl } = tracker;

    getOrCreateN64Shader(gl, 0x00123456, 0x789abcde, gbi.CycleType.G_CYC_1CYCLE, 0, false, false);
    getOrCreateN64Shader(gl, 0x01234567, 0x089abcde, gbi.CycleType.G_CYC_1CYCLE, 0, false, false);
    getOrCreateN64Shader(gl, 0x00123456, 0x789abcde, gbi.CycleType.G_CYC_1CYCLE, 0, false, true);

    expect(tracker.shaderParameterQueries).toEqual([]);
    expect(tracker.programParameterQueries).toHaveLength(3);
    expect(tracker.deletedPrograms).toEqual([]);

    const vertexShaders = tracker.createdShaders.filter(s => s.type === gl.VERTEX_SHADER);
    const fragmentShaders = tracker.createdShaders.filter(s => s.type === gl.FRAGMENT_SHADER);
    expect(vertexShaders).toHaveLength(2);
    expect(fragmentShaders).toHaveLength(3);

    expect(tracker.detachedShaders.map(entry => entry.shader)).toEqual(fragmentShaders);
    expect(tracker.deletedShaders).toEqual(fragmentShaders);
    for (const vertexShader of vertexShaders) {
      expect(tracker.deletedShaders).not.toContain(vertexShader);
    }
  });

  test('createShaderProgram reports vertex, fragment, and program logs on LINK_STATUS failure and cleans up', () => {
    // Vertex shader compilation failure.
    const vertexTracker = createTrackedMockGL({
      linkStatus: () => false,
      compileStatus: shader => shader.type !== 0x8b31,
      shaderInfoLog: shader => (shader.type === 0x8b31 ? 'ERROR: vertex syntax error' : ''),
      programInfoLog: () => 'missing vertex shader object',
    });
    let caughtError = null;
    try {
      createShaderProgram(vertexTracker.gl, 'bad vert', 'good frag');
    } catch (error) {
      caughtError = error;
    }
    expect(caughtError).toBeInstanceOf(AssertException);
    expect(caughtError.message).toContain('ERROR: vertex syntax error');
    expect(caughtError.message).toContain('missing vertex shader object');
    expect(vertexTracker.deletedShaders).toEqual(vertexTracker.createdShaders);
    expect(vertexTracker.deletedPrograms).toEqual([{ id: 1 }]);

    // Fragment shader compilation failure.
    const fragmentTracker = createTrackedMockGL({
      linkStatus: () => false,
      compileStatus: shader => shader.type !== 0x8b30,
      shaderInfoLog: shader => (shader.type === 0x8b30 ? 'ERROR: fragment undeclared identifier' : ''),
    });
    caughtError = null;
    try {
      createShaderProgram(fragmentTracker.gl, 'good vert', 'bad frag');
    } catch (error) {
      caughtError = error;
    }
    expect(caughtError).toBeInstanceOf(AssertException);
    expect(caughtError.message).toContain('ERROR: fragment undeclared identifier');
    expect(fragmentTracker.deletedShaders).toEqual(fragmentTracker.createdShaders);
    expect(fragmentTracker.deletedPrograms).toEqual([{ id: 1 }]);

    // Link-only failure (both shaders compiled cleanly).
    const linkTracker = createTrackedMockGL({
      linkStatus: () => false,
      compileStatus: () => true,
      programInfoLog: () => 'varying mismatch between vertex and fragment',
    });
    caughtError = null;
    try {
      createShaderProgram(linkTracker.gl, 'vert', 'frag');
    } catch (error) {
      caughtError = error;
    }
    expect(caughtError).toBeInstanceOf(AssertException);
    expect(caughtError.message).toContain('varying mismatch between vertex and fragment');
    expect(linkTracker.shaderInfoLogQueries).toEqual([]);
    expect(linkTracker.deletedShaders).toEqual(linkTracker.createdShaders);
    expect(linkTracker.deletedPrograms).toEqual([{ id: 1 }]);
  });

  test('getOrCreateN64Shader deletes failed initial vertexShader without caching it, and preserves cached vertexShader when a later fragment fails', () => {
    // 1. Initial vertex shader fails to compile: do not cache it; retry should recompile vertex shader and succeed.
    let failInitialVertex = true;
    const retryTracker = createTrackedMockGL({
      linkStatus: () => !failInitialVertex,
      compileStatus: shader => !(failInitialVertex && shader.type === 0x8b31),
      shaderInfoLog: shader => (failInitialVertex && shader.type === 0x8b31 ? 'vertex compile boom' : ''),
    });

    let caughtError = null;
    try {
      getOrCreateN64Shader(retryTracker.gl, 0x00123456, 0x789abcde, gbi.CycleType.G_CYC_1CYCLE, 0, false, false);
    } catch (error) {
      caughtError = error;
    }
    expect(caughtError).toBeInstanceOf(AssertException);
    expect(caughtError.message).toContain('vertex compile boom');
    expect(retryTracker.deletedShaders).toEqual(retryTracker.createdShaders);
    expect(retryTracker.deletedPrograms).toEqual([{ id: 1 }]);

    failInitialVertex = false;
    const recovered = getOrCreateN64Shader(retryTracker.gl, 0x00123456, 0x789abcde, gbi.CycleType.G_CYC_1CYCLE, 0, false, false);
    expect(recovered.program).toEqual({ id: 2 });
    const compiledVertexShaders = retryTracker.createdShaders.filter(s => s.type === retryTracker.gl.VERTEX_SHADER);
    expect(compiledVertexShaders).toHaveLength(2);
    expect(retryTracker.deletedShaders).not.toContain(compiledVertexShaders[1]);

    // 2. Subsequent fragment shader fails after vertexShader is cached: preserve cached vertexShader.
    let failNextFragment = false;
    const tracker = createTrackedMockGL({
      linkStatus: () => !failNextFragment,
      compileStatus: shader => !(failNextFragment && shader.type === 0x8b30),
      shaderInfoLog: shader => (failNextFragment && shader.type === 0x8b30 ? 'fragment combiner error' : ''),
      programInfoLog: () => (failNextFragment ? 'linker aborted due to fragment error' : ''),
    });

    getOrCreateN64Shader(tracker.gl, 0x00123456, 0x789abcde, gbi.CycleType.G_CYC_1CYCLE, 0, false, false);
    const [cachedVertexShader] = tracker.createdShaders.filter(s => s.type === tracker.gl.VERTEX_SHADER);

    failNextFragment = true;
    caughtError = null;
    try {
      getOrCreateN64Shader(tracker.gl, 0x01234567, 0x089abcde, gbi.CycleType.G_CYC_1CYCLE, 0, false, false);
    } catch (error) {
      caughtError = error;
    }
    expect(caughtError).toBeInstanceOf(AssertException);
    expect(caughtError.message).toContain('fragment combiner error');
    expect(caughtError.message).toContain('linker aborted due to fragment error');

    const fragmentShaders = tracker.createdShaders.filter(s => s.type === tracker.gl.FRAGMENT_SHADER);
    expect(fragmentShaders).toHaveLength(2);
    expect(tracker.deletedShaders).toEqual(fragmentShaders);
    expect(tracker.deletedShaders).not.toContain(cachedVertexShader);
    expect(tracker.deletedPrograms).toEqual([{ id: 2 }]);
  });
});

