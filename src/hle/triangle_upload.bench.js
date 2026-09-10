// Serve the repository root, then open /benchmarks/triangle_upload.html.
// Optional query parameters: iterations=2048, samples=9, save=1.
import { ProjectedVertex } from './projected_vertex.js';
import { Renderer } from './renderer.js';
import { TriangleBuffer } from './triangle_buffer.js';
import { VertexArray } from './vertex_array.js';

const canvas = document.querySelector('#canvas');
const status = document.querySelector('#status');
const button = document.querySelector('#run');
const params = new URLSearchParams(location.search);
const iterations = Number(params.get('iterations') || 2048);
const samples = Number(params.get('samples') || 9);
const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
if (!gl) throw new Error('WebGL2 is unavailable');
const debug = gl.getExtension('WEBGL_debug_renderer_info');
const environment = {
  userAgent: navigator.userAgent,
  renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
  vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
  contextAttributes: gl.getContextAttributes(),
  iterations, samples,
};
document.querySelector('#environment').textContent = JSON.stringify(environment, null, 2);

function compile(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
  return shader;
}
const program = gl.createProgram();
gl.attachShader(program, compile(gl.VERTEX_SHADER, `#version 300 es
in vec4 aPosition;
in vec4 aColor;
in vec2 aUV;
out vec4 color;
out vec2 uv;
void main() { gl_Position = aPosition; color = aColor; uv = aUV; }`));
gl.attachShader(program, compile(gl.FRAGMENT_SHADER, `#version 300 es
precision highp float;
in vec4 color;
in vec2 uv;
out vec4 result;
void main() { result = vec4(color.rgb * (0.5 + 0.5 * uv.x), 1.0); }`));
gl.linkProgram(program);
if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
gl.useProgram(program);
gl.viewport(0, 0, canvas.width, canvas.height);
gl.disable(gl.DITHER);

const tb = new TriangleBuffer(64);
for (let i = 0; i < 64; ++i) {
  const x = (i % 8) / 4 - 1;
  const y = Math.floor(i / 8) / 4 - 1;
  const vertices = [[x, y], [x + 0.23, y], [x, y + 0.23]].map(([px, py], j) => {
    const v = new ProjectedVertex();
    v.pos.set(px, py, 0, 1);
    v.color = (0xff000000 | ((i * 37 & 255) << 16) | ((i * 67 & 255) << 8) | 127) >>> 0;
    v.u = j * 0.5;
    v.v = 1 - j * 0.5;
    return v;
  });
  tb.pushTri(...vertices);
}

const variants = ['full', 'subarray', 'range', 'subdata'];
function makeUploader(variant) {
  const va = new VertexArray(gl);
  va.initPosAttr(program, 'aPosition');
  va.initColorAttr(program, 'aColor');
  va.initUVsAttr(program, 'aUV');
  const buffers = [va.posBuffer, va.colBuffer, va.uvBuffer];
  const arrays = [tb.positions, tb.colours, tb.coords];
  if (variant === 'subdata') {
    for (let i = 0; i < 3; ++i) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers[i]);
      gl.bufferData(gl.ARRAY_BUFFER, arrays[i].byteLength, gl.DYNAMIC_DRAW);
    }
  }
  // Use separate functions so the timed loop has no per-upload variant switch.
  const upload = {
    full: (buffer, data) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    },
    subarray: (buffer, data, length) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, length), gl.DYNAMIC_DRAW);
    },
    range: (buffer, data, length) => va.setData(buffer, data, gl.DYNAMIC_DRAW, length),
    subdata: (buffer, data, length) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, length);
    },
  }[variant];
  return {
    va, buffers, arrays,
    upload(numTris) {
      upload(va.posBuffer, tb.positions, numTris * 12);
      upload(va.colBuffer, tb.colours, numTris * 3);
      upload(va.uvBuffer, tb.coords, numTris * 6);
    },
  };
}
const uploaders = Object.fromEntries(variants.map(variant => [variant, makeUploader(variant)]));
const cases = [1, 2, 4, 8, 16, 32, 64].map(n => ({ name: String(n), counts: [n] }));
cases.push({ name: 'mixed', counts: [1, 2, 4, 8, 16, 32, 64, 2, 1, 4, 2, 8, 1, 16, 2, 4] });

function assertGL() {
  const error = gl.getError();
  if (error !== gl.NO_ERROR) throw new Error(`WebGL error: 0x${error.toString(16)}`);
}
function pixels() {
  const data = new Uint8Array(canvas.width * canvas.height * 4);
  gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
  return data;
}
function verify() {
  let checks = 0;
  for (const count of [64, 1, 32, 2, 8, 4, 16, 64]) {
    let expected;
    for (const variant of variants) {
      const uploader = uploaders[variant];
      uploader.va.bind();
      uploader.upload(count);
      for (const [i, stride] of [12, 3, 6].entries()) {
        gl.bindBuffer(gl.ARRAY_BUFFER, uploader.buffers[i]);
        const expectedBytes = (variant === 'full' || variant === 'subdata' ? 64 : count) * stride * 4;
        if (gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE) !== expectedBytes) throw new Error(`${variant}: wrong buffer size`);
        const source = uploader.arrays[i];
        const uploaded = new source.constructor(count * stride);
        gl.getBufferSubData(gl.ARRAY_BUFFER, 0, uploaded);
        if (!uploaded.every((v, j) => v === source[j])) throw new Error(`${variant}: uploaded data differs`);
      }
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, count * 3);
      const actual = pixels();
      if (!actual.some(v => v !== 0)) throw new Error(`${variant}: no triangles were rendered`);
      if (expected && !actual.every((v, i) => v === expected[i])) throw new Error(`${variant}: rendered pixels differ at ${count} triangles`);
      expected ??= actual;
      assertGL();
      checks++;
    }
  }
  // Exercise the actual flush -> program state -> attribute setter path. Only
  // unrelated shader selection, texture binding, and depth/blend setup are stubbed.
  const renderer = Object.create(Renderer.prototype);
  renderer.gl = gl;
  renderer.state = {
    geometryMode: {}, texture: { tile: 0 }, primColor: 0, envColor: 0,
    getCycleType: () => 0, getAlphaCompareType: () => 0,
    getAntiAliasEnabled: () => false, getCoverageTimesAlpha: () => false,
  };
  renderer.setGLBlendMode = () => {};
  renderer.initDepth = () => {};
  renderer.bindTexture = () => {};
  renderer.getCurrentN64Shader = () => ({ program, vertexArray: uploaders.range.va,
    uAlphaThresholdUniform: null, uPrimColorUniform: null, uEnvColorUniform: null });
  for (const count of [64, 1, 16, 2]) {
    uploaders.full.va.bind();
    uploaders.full.upload(count);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, count * 3);
    const expected = pixels();
    tb.numTris = count;
    gl.clear(gl.COLOR_BUFFER_BIT);
    renderer.flushTris(tb);
    if (!tb.empty()) throw new Error('Renderer did not reset the triangle buffer');
    if (!pixels().every((v, i) => v === expected[i])) throw new Error('Renderer flush output differs');
    for (const [i, stride] of [12, 3, 6].entries()) {
      gl.bindBuffer(gl.ARRAY_BUFFER, uploaders.range.buffers[i]);
      if (gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE) !== count * stride * 4) throw new Error('Renderer uploaded the wrong prefix');
    }
    renderer.flushTris(tb); // Empty buffers must still be skipped.
    assertGL();
  }
  renderer.setProgramState(tb.positions.subarray(0, 16), tb.colours.subarray(0, 4), tb.coords.subarray(0, 8), false, false, 0);
  for (const [i, bytes] of [64, 16, 32].entries()) {
    gl.bindBuffer(gl.ARRAY_BUFFER, uploaders.range.buffers[i]);
    if (gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE) !== bytes) throw new Error('Rectangle vertex count changed');
  }
  // Rectangles and static geometry still use the default full-array upload.
  const { va, buffers } = uploaders.range;
  va.setPosData(tb.positions.subarray(0, 16), gl.DYNAMIC_DRAW);
  va.setColorData(tb.colours.subarray(0, 4), gl.DYNAMIC_DRAW);
  va.setUVData(tb.coords.subarray(0, 8), gl.DYNAMIC_DRAW);
  for (const [i, bytes] of [64, 16, 32].entries()) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers[i]);
    if (gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE) !== bytes) throw new Error('Default full-array upload changed');
  }
  assertGL();
  return { checks, rendererFlush: 'pass', rectangleDefaults: 'pass', defaultUploads: 'pass',
    status: 'All buffer sizes, uploaded contents, and rendered pixels match expectations' };
}

// Message tasks avoid the nested setTimeout 4 ms clamp in fence polling.
const channel = new MessageChannel();
let resume;
channel.port1.onmessage = () => resume();
const pause = () => new Promise(resolve => {
  resume = resolve;
  channel.port2.postMessage(null);
});
async function drain() {
  const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  gl.flush();
  for (;;) {
    const result = gl.clientWaitSync(fence, 0, 0);
    if (result === gl.ALREADY_SIGNALED || result === gl.CONDITION_SATISFIED) break;
    if (result === gl.WAIT_FAILED || gl.isContextLost()) throw new Error('GPU fence failed');
    await pause();
  }
  gl.deleteSync(fence);
}
async function measure(variant, counts, draw, count = iterations) {
  const uploader = uploaders[variant];
  uploader.va.bind();
  await drain();
  const start = performance.now();
  for (let i = 0; i < count; ++i) {
    const triangles = counts[i % counts.length];
    // Change input between flushes, as the emulator does when reusing its arrays.
    tb.coords[0] = (i & 255) / 255;
    uploader.upload(triangles);
    if (draw) gl.drawArrays(gl.TRIANGLES, 0, triangles * 3);
  }
  const submitted = performance.now();
  await drain();
  const completed = performance.now();
  assertGL();
  return { submitUs: (submitted - start) * 1000 / count, completeUs: (completed - start) * 1000 / count };
}
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length & 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function stats(values) {
  const centre = median(values);
  return { median: centre, mad: median(values.map(v => Math.abs(v - centre))), min: Math.min(...values), max: Math.max(...values) };
}
function render(rows) {
  const table = document.createElement('table');
  table.innerHTML = '<tr><th>Mode / triangles</th><th>Variant</th><th>Bytes / flush</th><th>Submit µs</th><th>Complete µs</th><th>Complete vs full</th></tr>';
  for (const row of rows) {
    const baseline = rows.find(r => r.mode === row.mode && r.case === row.case && r.variant === 'full');
    const tr = table.insertRow();
    const values = [`${row.mode} / ${row.case}`, row.variant, row.bytesPerFlush.toFixed(0), row.submit.median.toFixed(2), row.complete.median.toFixed(2), `${(100 * (1 - row.complete.median / baseline.complete.median)).toFixed(1)}%`];
    for (const value of values) tr.insertCell().textContent = value;
  }
  document.querySelector('#summary').replaceChildren(table);
}
button.addEventListener('click', async () => {
  button.disabled = true;
  try {
    if (!Number.isSafeInteger(iterations) || iterations < 1 || !Number.isSafeInteger(samples) || samples < 1) throw new Error('Invalid benchmark parameters');
    const started = new Date().toISOString();
    const verification = verify();
    const rows = [];
    for (const draw of [false, true]) {
      for (const scenario of cases) {
        status.textContent = `Running ${draw ? 'upload + draw' : 'upload only'} / ${scenario.name} triangles`;
        const collected = Object.fromEntries(variants.map(v => [v, []]));
        for (const variant of variants) await measure(variant, scenario.counts, draw, 512);
        // Rotate and reverse variant order to distribute warmup and thermal drift.
        for (let round = 0; round < samples; ++round) {
          const order = variants.map((_, i) => variants[(i + round) % variants.length]);
          if (round & 1) order.reverse();
          for (const variant of order) collected[variant].push(await measure(variant, scenario.counts, draw));
        }
        for (const variant of variants) {
          const values = collected[variant];
          const meanTris = Array.from({ length: iterations }, (_, i) => scenario.counts[i % scenario.counts.length]).reduce((a, b) => a + b, 0) / iterations;
          rows.push({ mode: draw ? 'draw' : 'upload', case: scenario.name, variant,
            bytesPerFlush: 84 * (variant === 'full' ? 64 : meanTris),
            submit: stats(values.map(v => v.submitUs)), complete: stats(values.map(v => v.completeUs)), samples: values });
        }
        render(rows);
        await pause();
      }
    }
    const result = { started, environment, verification, rows };
    document.querySelector('#results').textContent = JSON.stringify(result, null, 2);
    if (params.has('save')) {
      const response = await fetch('/__benchmark_results', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) });
      if (!response.ok) throw new Error(`Saving results failed: ${response.status}`);
    }
    status.textContent = 'Complete';
  } catch (error) {
    status.textContent = `Failed: ${error.stack || error}`;
  } finally {
    button.disabled = false;
  }
});
