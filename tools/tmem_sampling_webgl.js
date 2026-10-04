import * as gbi from '../src/hle/gbi.js';
import { decodeTile } from '../src/hle/debug_texture.js';
import { Renderer } from '../src/hle/renderer.js';
import { RSPState } from '../src/hle/rsp_state.js';

// Compare against independent CPU decoding and filtering, plus physical-memory cases
// that a finite RGBA image cannot represent (bank aliases and unmasked reads).
export function runTMEMSamplingTests(gl) {
  const state = new RSPState();
  state.reset(new DataView(new ArrayBuffer(4096)), 0);
  const renderer = new Renderer(gl, state, 1, 1);
  const tile = state.tiles[0];
  const data = state.tmem.tmemData;
  const positions = new Float32Array([-1, -1, 0, 1, 3, -1, 0, 1, -1, 3, 0, 1]);
  const colors = new Uint32Array([0xffffffff, 0xffffffff, 0xffffffff]);
  const lines = [];
  const rgba = gbi.TextureLUT.G_TT_RGBA16, ia = gbi.TextureLUT.G_TT_IA16;
  function configure(format, size, { line = 3, base = 511, palette = 7, width = 8, height = 3 } = {}) {
    tile.set(format, size, line, base, palette, 0, 0, 0, 0, 0, 0);
    tile.setSize(0, 0, (width - 1) * 4, (height - 1) * 4);
  }
  function draw(uv, { filter = 0, tlut = 0, cycle = gbi.CycleType.G_CYC_1CYCLE, enabled = true } = {}) {
    state.rdpOtherModeH = filter | tlut | cycle;
    state.rdpOtherModeL = 0;
    state.combine.hi = (1 << 20) | (4 << 15) | (1 << 12) | (4 << 9) | (1 << 5) | 4;
    state.combine.lo = ((15 << 28) | (7 << 15) | (7 << 12) | (7 << 9) |
      (15 << 24) | (1 << 21) | (4 << 18) | (7 << 6) | (7 << 3) | 7) >>> 0;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, 1, 1);
    gl.disable(gl.DITHER);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0.2, 0.3, 0.4, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    renderer.setProgramState(positions, colors, new Float32Array([...uv, ...uv, ...uv]), enabled, false, 0);
    gl.disable(gl.BLEND);
    // Copy's fixed combiner optimizes out attributes in the existing VA setup.
    if (cycle === gbi.CycleType.G_CYC_COPY) while (gl.getError() !== gl.NO_ERROR) { /* drain setup */ }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const pixel = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    const error = gl.getError();
    if (error !== gl.NO_ERROR) throw new Error(`TMEM sampler GL error: ${error}`);
    return Array.from(pixel);
  }
  function check(name, actual, expected) {
    if (actual.some((v, i) => Math.abs(v - expected[i]) > 1)) {
      throw new Error(`${name}: expected ${expected}, got ${actual}`);
    }
    lines.push(`PASS direct TMEM: ${name}`);
  }
  function write16(address, value) { data[address & 4095] = value >>> 8; data[(address + 1) & 4095] = value; }
  try {
    for (const [format, size] of [[0, 0], [0, 1], [0, 2], [0, 3], [1, 2], [2, 0], [2, 1], [3, 0], [3, 1], [3, 2], [4, 0], [4, 1]]) {
      for (const tlut of size < 2 ? [0, rgba, ia] : [0]) {
        for (let i = 0; i < data.length; i++) data[i] = (i * 37 + (i >>> 8) * 13 + 29) & 255;
        // Ordinary palette loads replicate each entry across all four banks.
        for (let entry = 0; entry < 256; entry++) {
          for (let bank = 0; bank < 4; bank++) write16(2048 + entry * 8 + bank * 2, (entry * 139 + 0xf801) & 65535);
        }
        configure(format, size);
        for (const uv of [[0, 0], [7, 0], [3, 1], [5, 2], [2.25, 0.25], [2.75, 0.75], [2.5, 0.5]]) {
          for (const filter of [0, gbi.TextureFilter.G_TF_BILERP, gbi.TextureFilter.G_TF_AVERAGE]) {
            const mode = { tlut, filter };
            const decoded = referenceSample(state.tmem, tile, uv, mode);
            // Default SetConvert coefficients are zero: RGB and alpha use Y.
            // Full YUV conversion coefficients are covered by runRDPTests.
            const expected = format === gbi.ImageFormat.G_IM_FMT_YUV ? Array(4).fill(decoded[2]) : decoded;
            check(`format ${format}/${size}, TLUT ${tlut}, UV ${uv}, filter ${filter}`, draw(uv, mode), expected);
          }
        }
      }
    }

    // All indices reference entry zero, whose four physical banks differ.
    data.fill(0);
    configure(2, 0, { base: 0, line: 1, palette: 0, width: 2, height: 2 });
    [32, 64, 128, 224].forEach((value, bank) => write16(2048 + bank * 2, (value << 8) | 255));
    check('lower triangle uses three palette banks', draw([0.25, 0.25], { tlut: ia, filter: gbi.TextureFilter.G_TF_BILERP }), [64, 64, 64, 255]);
    check('upper triangle reverses palette banks', draw([0.75, 0.75], { tlut: ia, filter: gbi.TextureFilter.G_TF_BILERP }), [64, 64, 64, 255]);
    check('average reads all four palette banks', draw([0.5, 0.5], { tlut: ia, filter: gbi.TextureFilter.G_TF_AVERAGE }), [112, 112, 112, 255]);
    write16(2052, 0x00ff);
    check('palette-only overwrite is uploaded', draw([0.25, 0.25], { tlut: ia, filter: gbi.TextureFilter.G_TF_BILERP }), [32, 32, 32, 255]);

    data.fill(0);
    configure(0, 2, { base: 0, line: 1, width: 2, height: 1 });
    [0xf801, 0x07c1, 0x003f, 0xffff].forEach((value, x) => write16(x * 2, value));
    write16(4094, 0x003f);
    check('copy reads beyond decoded image bounds', draw([3, 0], { cycle: gbi.CycleType.G_CYC_COPY }), [255, 255, 255, 255]);
    check('negative unmasked address wraps through TMEM', draw([-1, 0], { cycle: gbi.CycleType.G_CYC_COPY }), [0, 0, 255, 255]);
    configure(0, 2, { base: 0, line: 0, width: 4, height: 2 });
    check('zero stride still samples physical memory with odd-row swap', draw([0, 1]), [0, 0, 255, 255]);

    configure(0, 2, { base: 0, line: 1, width: 1, height: 1 });
    check('RGBA16 tile interpretation', draw([0, 0]), [255, 0, 0, 255]);
    tile.format = 3;
    check('tile reinterpretation without a TMEM upload', draw([0, 0]), [248, 248, 248, 1]);
    configure(0, 2, { base: 0, line: 1, width: 1, height: 1 });
    const second = state.tiles[1];
    second.set(3, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0);
    second.setSize(0, 0, 0, 0);
    data[8] = 0x8f;
    check('second cycle samples an independent tile and format', draw([0, 0], { cycle: gbi.CycleType.G_CYC_2CYCLE }), [136, 136, 136, 255]);
    check('untextured draw disables both tiles', draw([0, 0], { enabled: false }), [0, 0, 0, 255]);
    check('textured draw restores tile sampling', draw([0, 0]), [255, 0, 0, 255]);

    write16(12, 0x07c1);
    write16(20, 0x003f);
    configure(0, 2, { base: 0, line: 1, width: 1, height: 2 });
    check('one-qword stride reads the first odd row', draw([0, 1]), [0, 255, 0, 255]);
    const snapshot = renderer.tmemTexture.texture;
    const uploads = renderer.tmemTexture.misses;
    tile.line = 2;
    check('tile stride can reinterpret the same snapshot', draw([0, 1]), [0, 0, 255, 255]);
    if (renderer.tmemTexture.texture !== snapshot || renderer.tmemTexture.misses !== uploads) {
      throw new Error('Changing tile stride uploaded another snapshot');
    }
    // Revisit snapshots and overflow a small cache using actual integer textures.
    renderer.tmemTexture.reset();
    renderer.tmemTexture.maxEntries = 2;
    data.fill(0);
    write16(0, 0xf801);
    check('cache uploads the first snapshot', draw([0, 0]), [255, 0, 0, 255]);
    const redTexture = renderer.tmemTexture.texture;
    write16(0, 0x07c1);
    check('cache uploads a distinct snapshot', draw([0, 0]), [0, 255, 0, 255]);
    const greenTexture = renderer.tmemTexture.texture;
    write16(0, 0xf801);
    check('cache hit restores the earlier snapshot', draw([0, 0]), [255, 0, 0, 255]);
    if (renderer.tmemTexture.texture !== redTexture) {
      throw new Error('Cache hit allocated a texture');
    }
    write16(0, 0x003f);
    check('cache eviction uploads into the oldest allocation', draw([0, 0]), [0, 0, 255, 255]);
    if (renderer.tmemTexture.texture !== greenTexture) {
      throw new Error('Cache did not recycle the oldest texture');
    }
    write16(0, 0x07c1);
    check('evicted snapshot is uploaded again', draw([0, 0]), [0, 255, 0, 255]);
    renderer.reset();
    if (gl.isTexture(redTexture) || gl.isTexture(greenTexture)) {
      throw new Error('Reset retained cached TMEM textures');
    }
    check('sampling resumes after reset', draw([0, 0]), [0, 255, 0, 255]);
    return lines;
  } finally {
    renderer.reset();
  }
}

// Format decoding is the debugger's CPU implementation, independent of GLSL.
// These coordinates are inside the tile; palette banks contain equal entries.
function referenceSample(tmem, tile, [s, t], { tlut, filter }) {
  const { pixels, width, height } = decodeTile(tmem, tile, tlut);
  const x = Math.floor(s), y = Math.floor(t);
  const u = Math.floor((s - x) * 32) / 32;
  const v = Math.floor((t - y) * 32) / 32;
  function texel(dx, dy) {
    const offset = (Math.min(y + dy, height - 1) * width + Math.min(x + dx, width - 1)) * 4;
    return pixels.subarray(offset, offset + 4);
  }
  const a = texel(0, 0);
  if (filter === gbi.TextureFilter.G_TF_POINT) {
    return Array.from(a);
  }
  const b = texel(1, 0), c = texel(0, 1), d = texel(1, 1);
  return Array.from(a, (value, i) => {
    if (filter === gbi.TextureFilter.G_TF_AVERAGE && u === 0.5 && v === 0.5) {
      return Math.floor((value + b[i] + c[i] + d[i]) / 4 + 0.5);
    }
    const color = u + v < 1
      ? value + (b[i] - value) * u + (c[i] - value) * v
      : d[i] + (c[i] - d[i]) * (1 - u) + (b[i] - d[i]) * (1 - v);
    return Math.floor(color + 0.5);
  });
}
