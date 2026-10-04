import { Renderer } from '../src/hle/renderer.js';
import { RSPState } from '../src/hle/rsp_state.js';
import { TriangleBuffer } from '../src/hle/triangle_buffer.js';

export const RED = [255, 0, 0, 255];
export const GREEN = [0, 255, 0, 255];
export const BLUE = [0, 0, 255, 255];
export const WHITE = [255, 255, 255, 255];
export const CLEAR = [0, 0, 0, 0];

export const solid = (color, count = 4) => Array(count).fill(color);

export function createWebGLHarness(gl, {
  width = 1,
  height = 1,
  ram = null,
  ramBytes = 4096,
  pc = 0,
  Microcode = null,
  variant = undefined,
} = {}) {
  let ramDV;
  let u8;
  if (ram instanceof DataView) {
    ramDV = ram;
    u8 = new Uint8Array(ram.buffer, ram.byteOffset, ram.byteLength);
  } else if (ram instanceof Uint8Array) {
    u8 = ram;
    ramDV = new DataView(ram.buffer, ram.byteOffset, ram.byteLength);
  } else if (ram instanceof ArrayBuffer) {
    ramDV = new DataView(ram);
    u8 = new Uint8Array(ram);
  } else {
    const buffer = new ArrayBuffer(ramBytes);
    ramDV = new DataView(buffer);
    u8 = new Uint8Array(buffer);
  }

  const state = new RSPState();
  state.reset(ramDV, pc);

  const renderer = new Renderer(gl, state, width, height);
  let microcode = null;
  if (Microcode) {
    microcode = new Microcode(state, ramDV, variant);
    microcode.renderer = renderer;
  }

  function resetFrame(clearColor = null) {
    renderer.newFrame();
    gl.disable(gl.DITHER);
    gl.disable(gl.SCISSOR_TEST);
    if (clearColor) {
      gl.clearColor(...clearColor.map(v => (v > 1 ? v / 255 : v)));
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
  }

  return { ram: ramDV, u8, state, renderer, microcode, resetFrame };
}

export function withMockMemory(ram, fn) {
  const saved = globalThis.n64js;
  try {
    globalThis.n64js = { hardware: () => ({ cachedMemDevice: { u8: ram } }) };
    return fn();
  } finally {
    globalThis.n64js = saved;
  }
}

export function createTestTexture(gl, width, height, pixels) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE,
    new Uint8Array(pixels.flat()));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  return { width, height, texture };
}

export function assertPixels(gl, {
  x = 0, y = 0, width = 1, height = 1,
  expected, tolerance = 1, label = '',
} = {}) {
  const actual = new Uint8Array(width * height * 4);
  gl.readPixels(x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, actual);
  const error = gl.getError();
  const flatExpected = expected.flat();
  if (error !== gl.NO_ERROR || actual.some((v, i) => Math.abs(v - flatExpected[i]) > tolerance)) {
    throw new Error(`${label}: expected ${flatExpected}, got ${Array.from(actual)} (GL error ${error})`);
  }
  return actual;
}

export function assertFramebufferGrid(gl, {
  width, height, scale = 1, expectedAt, label, tolerance = 0,
}) {
  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const error = gl.getError();
  if (error !== gl.NO_ERROR) {
    throw new Error(`${label}: GL error ${error}`);
  }
  // Compute each source pixel once, reusing it for all upscaled copies. Avoid
  // per-output-pixel typed-array views and callbacks on full VI-sized images.
  const expectedRow = new Array(Math.ceil(width / scale));
  let previousSourceY = -1;
  for (let y = 0; y < height; y++) {
    const sourceY = Math.floor(y / scale);
    if (sourceY !== previousSourceY) {
      for (let x = 0; x < expectedRow.length; x++) {
        expectedRow[x] = expectedAt(x, sourceY);
      }
      previousSourceY = sourceY;
    }
    for (let x = 0; x < width; x++) {
      const expected = expectedRow[Math.floor(x / scale)];
      const offset = ((height - 1 - y) * width + x) * 4;
      for (let channel = 0; channel < 4; channel++) {
        if (Math.abs(pixels[offset + channel] - expected[channel]) > tolerance) {
          const actual = pixels.subarray(offset, offset + 4);
          throw new Error(`${label} at ${x},${y}: expected ${expected}, got ${Array.from(actual)}`);
        }
      }
    }
  }
  return `PASS ${label}`;
}

export function evaluateChecks(checks, tolerance = 1) {
  return checks.map(({ name, actual, expected }) => {
    if (actual.some((value, i) => Math.abs(value - expected[i]) > tolerance)) {
      throw new Error(`${name}: expected ${expected}, got ${actual}`);
    }
    return `PASS ${name}`;
  });
}

export function drawProjectedTriangle(renderer, vertices, drawOptions = undefined) {
  const buffer = new TriangleBuffer(1);
  buffer.pushTri(...vertices.slice(0, 3));
  if (drawOptions !== undefined) {
    renderer.flushTris(buffer, drawOptions);
  } else {
    renderer.flushTris(buffer);
  }
}
