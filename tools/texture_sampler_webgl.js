// Build: bun build tools/texture_sampler_webgl.js --outfile=build/texture_sampler_webgl.js
// Serve the repository root, then open /tools/texture_sampler_webgl.html.
// These tests exercise the real renderer, generated shaders and GPU readback.
import * as gbi from '../src/hle/gbi.js';
import { Renderer } from '../src/hle/renderer.js';
import { RenderTargets } from '../src/hle/render_targets.js';
import { RSPState } from '../src/hle/rsp_state.js';
import { TriangleBuffer } from '../src/hle/triangle_buffer.js';

const output = document.getElementById('results');
try {
  const gl = document.getElementById('display').getContext('webgl2', { antialias: false });
  if (!gl) throw new Error('WebGL2 unavailable');
  const state = new RSPState();
  state.reset(new DataView(new ArrayBuffer(4096)), 0);
  const renderer = new Renderer(gl, state, 1, 1);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, 1, 1);
  gl.disable(gl.DITHER);
  const positions = new Float32Array([-1, -1, 0, 1, 3, -1, 0, 1, -1, 3, 0, 1]);
  const colors = new Uint32Array([0xffffffff, 0xffffffff, 0xffffffff]);

  function texture(width, height, pixels) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(pixels.flat()));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return { width, height, texture: tex };
  }
  const red = [255, 0, 0, 255], green = [0, 255, 0, 255];
  const blue = [0, 0, 255, 255], white = [255, 255, 255, 255];
  const quad = texture(2, 2, [red, green, blue, white]);
  const row = texture(4, 1, [red, green, blue, white]);
  const column = texture(1, 4, [red, green, blue, white]);
  const npot = texture(3, 1, [red, green, blue]);

  let passed = 0;
  const lines = [];
  function check(name, expected, {
    uv = [0, 0], tex = quad, tex1 = null, filter = gbi.TextureFilter.G_TF_POINT,
    cycle = gbi.CycleType.G_CYC_1CYCLE, mode = [0, 0], mask = [0, 0],
    shift = [0, 0], origin = [0, 0], last = [tex.width - 1, tex.height - 1],
    texgen = false, second = false, enabled = true, tileIndex = 0,
    lod = gbi.TextureLOD.G_TL_TILE, level = 0, detail = gbi.TextureDetail.G_TD_CLAMP,
    decode = false, format = gbi.ImageFormat.G_IM_FMT_RGBA, size = gbi.ImageSize.G_IM_SIZ_16b, line = 1,
    rspTriangle = false, perspective = gbi.TexturePerspective.G_TP_PERSP,
  } = {}) {
    state.rdpOtherModeH = cycle | filter | lod | detail | perspective;
    state.texture.level = level;
    // (texel - zero) * shade + zero, in each combiner cycle. Keep both
    // vertex attributes active, including when testing the second sampler.
    const input = second ? 2 : 1;
    state.combine.hi = (input << 20) | (4 << 15) | (input << 12) | (4 << 9) | (1 << 5) | 4;
    state.combine.lo = ((15 << 28) | (7 << 15) | (7 << 12) | (7 << 9) |
      (15 << 24) | (1 << 21) | (4 << 18) | (7 << 6) | (7 << 3) | 7) >>> 0;
    const tile = state.tiles[tileIndex];
    tile.set(format, size, line, 0, 0, mode[0], mask[0], shift[0], mode[1], mask[1], shift[1]);
    tile.setSize(origin[0] * 4, origin[1] * 4, last[0] * 4, last[1] * 4);
    const nextTile = state.tiles[(tileIndex + 1) & 7];
    nextTile.set(0, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0);
    nextTile.setSize(0, 0, (tex1?.width - 1 || 0) * 4, (tex1?.height - 1 || 0) * 4);
    if (decode) delete renderer.lookupTexture;
    else renderer.lookupTexture = i => i === tileIndex ? tex : tex1;
    const coords = new Float32Array([...uv, ...uv, ...uv]);
    if (rspTriangle) {
      const buffer = new TriangleBuffer(1);
      buffer.numTris = 1;
      buffer.positions.set(positions);
      buffer.colours.set(colors);
      buffer.coords.set(coords);
      state.texture.tile = tileIndex;
      state.geometryMode.texture = enabled;
      state.geometryMode.lighting = texgen;
      state.geometryMode.textureGen = texgen;
      renderer.flushTris(buffer);
    } else {
      renderer.setProgramState(positions, colors, coords, enabled, texgen, tileIndex);
      // Existing VertexArray setup enables inactive attributes in copy/fill
      // shaders; discard those setup errors so drawing errors remain visible.
      while (gl.getError() !== gl.NO_ERROR) { /* drain setup errors */ }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    const actual = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, actual);
    const error = gl.getError();
    if (error !== gl.NO_ERROR || actual.some((value, i) => Math.abs(value - expected[i]) > 1)) {
      throw new Error(`${name}: expected ${expected}, got ${Array.from(actual)} (GL error ${error})`);
    }
    lines.push(`PASS ${name}`);
    passed++;
  }

  check('integer coordinates select texel centres', red);
  check('point sampling truncates fractions', red, { uv: [0.75, 0.75] });
  check('three-point lower triangle', [128, 64, 64, 255], { uv: [0.25, 0.25], filter: gbi.TextureFilter.G_TF_BILERP });
  check('three-point upper triangle', [128, 191, 191, 255], { uv: [0.75, 0.75], filter: gbi.TextureFilter.G_TF_BILERP });
  check('diagonal uses three-point interpolation', [0, 128, 128, 255], { uv: [0.5, 0.5], filter: gbi.TextureFilter.G_TF_BILERP });
  check('average mode midpoint', [128, 128, 128, 255], { uv: [0.5, 0.5], filter: gbi.TextureFilter.G_TF_AVERAGE });
  check('average mode away from midpoint', [128, 64, 64, 255], { uv: [0.25, 0.25], filter: gbi.TextureFilter.G_TF_AVERAGE });
  check('five-bit filter fractions', [239, 8, 8, 255], { uv: [0.06, 0.06], filter: gbi.TextureFilter.G_TF_BILERP });
  check('implicit clamp with zero mask', red, { uv: [-1, -1] });
  check('clamped upper edge clears fraction', green, { uv: [1.75, 0], filter: gbi.TextureFilter.G_TF_BILERP });
  check('negative wrapped coordinate', green, { uv: [-1, 0], mask: [1, 1] });
  check('wrap seam filters across both edges', [128, 128, 0, 255], { uv: [1.5, 0], mask: [1, 1], filter: gbi.TextureFilter.G_TF_BILERP });
  check('negative mirror coordinate', red, { uv: [-1, 0], mask: [1, 1], mode: [1, 1] });
  check('mirror seam repeats edge texel', green, { uv: [1.5, 0], mask: [1, 1], mode: [1, 1], filter: gbi.TextureFilter.G_TF_BILERP });
  check('mirror reverses direction', [128, 128, 0, 255], { uv: [2.5, 0], mask: [1, 1], mode: [1, 1], filter: gbi.TextureFilter.G_TF_BILERP });
  check('T wraps independently of S', blue, { tex: column, uv: [0, -2], mask: [0, 2] });
  check('T mirrors independently of S', green, { tex: column, uv: [0, -2], mask: [0, 2], mode: [0, 1] });
  check('clamp and mirror both apply', red, { uv: [6, 0], mask: [1, 0], mode: [3, 0], last: [3, 1] });
  check('clamp extent differs from mask period', green, { uv: [6, 0], mask: [1, 0], mode: [2, 0], last: [3, 1] });
  check('mask period differs from texture width', green, { tex: row, uv: [3, 0], mask: [1, 0] });
  check('fractional origin and shift order', green, { tex: row, uv: [5, 0], origin: [1.25, 0], last: [4.25, 0], shift: [1, 0] });
  check('left shift', blue, { tex: row, uv: [0.125, 0], shift: [12, 0] });
  check('generated texture coordinates', white, { uv: [0.75, 0.75], texgen: true });
  check('non-power-of-two decoded bounds', blue, { tex: npot, uv: [3, 0], mask: [2, 0] });
  check('copy mode ignores filtering', red, { uv: [0.75, 0.75], cycle: gbi.CycleType.G_CYC_COPY, filter: gbi.TextureFilter.G_TF_AVERAGE });
  check('second tile wraps index seven to zero', blue, { tex1: column, uv: [0, 2], cycle: gbi.CycleType.G_CYC_2CYCLE, tileIndex: 7 });
  check('missing second texture is black', [0, 0, 0, 255], { cycle: gbi.CycleType.G_CYC_2CYCLE });
  // Chopper Attack uses two cycles with LOD enabled but a single mip level.
  // The second cycle must read the base tile, even if the next tile is absent.
  const singleLevelLOD = { cycle: gbi.CycleType.G_CYC_2CYCLE, lod: gbi.TextureLOD.G_TL_LOD };
  check('single-level LOD shares the base tile across cycles', red, singleLevelLOD);
  check('single-level LOD uses base tile coordinates and addressing', green, {
    ...singleLevelLOD, tileIndex: 7, tex: row, tex1: column, uv: [5, 0],
    origin: [1, 0], last: [4, 0], shift: [1, 0], mask: [2, 0],
  });
  check('single-level LOD preserves generated coordinates', white, { ...singleLevelLOD, texgen: true, uv: [0.75, 0.75] });
  check('single-level sharpen also shares the base tile', red, { ...singleLevelLOD, detail: gbi.TextureDetail.G_TD_SHARPEN });
  check('detail mode retains a separate second tile', blue, { ...singleLevelLOD, detail: gbi.TextureDetail.G_TD_DETAIL, tex1: column, uv: [0, 2] });
  check('multiple LOD levels retain a separate second tile', blue, { ...singleLevelLOD, level: 1, tex1: column, uv: [0, 2] });
  check('untextured draw clears previous sampler state', [0, 0, 0, 255], { enabled: false });
  check('texture sampling resumes after an untextured draw', [128, 191, 191, 255], { uv: [0.75, 0.75], filter: gbi.TextureFilter.G_TF_BILERP });

  // Wetrix supplies twice the texel coordinates for its G_TP_NONE triangles.
  // Use unrelated texture dimensions to catch a size-specific workaround.
  const noPerspective = { rspTriangle: true, perspective: gbi.TexturePerspective.G_TP_NONE };
  check('non-perspective triangles halve S', green, { ...noPerspective, tex: row, uv: [2, 0] });
  check('non-perspective triangles halve T', green, { ...noPerspective, tex: column, uv: [0, 2] });
  check('triangle scale precedes tile shift and origin', green, {
    ...noPerspective, tex: row, uv: [8, 0], shift: [1, 0], origin: [1, 0], last: [4, 0],
  });
  check('both combiner cycles use the triangle scale', green, {
    ...noPerspective, tex1: column, uv: [0, 2], cycle: gbi.CycleType.G_CYC_2CYCLE,
  });
  check('generated triangle coordinates use the same scale', red, { ...noPerspective, uv: [0.75, 0.75], texgen: true });
  check('perspective triangles retain their coordinate scale', blue, { rspTriangle: true, tex: row, uv: [2, 0] });

  // Exercise rectangle interpolation through real geometry, not constant UVs.
  // A four-row, wrapped strip is the same boundary case as Mario Kart's menus.
  function checkRectangle(name, {
    width = 8, height = 8, flip = false, modeT = 0, startT = 0, endT = 4,
    nativeWidth = 4, nativeHeight = 4, originX = 0, originY = 0, tileTop = 0,
    expected = (x, y) => [red, green, blue, white][flip ? x : y],
  } = {}) {
    gl.canvas.width = width;
    gl.canvas.height = height;
    renderer.renderTargets.reset();
    renderer.renderTargets = new RenderTargets(gl, width, height);
    renderer.nativeTransform.initDimensions(nativeWidth, nativeHeight);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    state.rdpOtherModeH = gbi.TextureFilter.G_TF_BILERP;
    const tile = state.tiles[0];
    tile.set(0, 2, 1, 0, 0, 0, 0, 0, modeT, 2, 0);
    tile.setSize(0, tileTop * 4, 0, (tileTop + 4) * 4); // Five-row bounds, four-row mask.
    renderer.lookupTexture = i => i === 0 ? column : null;
    renderer.texRect(0, originX, originY, originX + 4, originY + 4, 0, startT, 0, endT, flip);
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    if (gl.getError() !== gl.NO_ERROR) throw new Error(`${name}: WebGL error`);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const nativeX = Math.floor((x + 0.5) * nativeWidth / width) - originX;
        const nativeY = Math.floor((y + 0.5) * nativeHeight / height) - originY;
        const inside = nativeX >= 0 && nativeX < 4 && nativeY >= 0 && nativeY < 4;
        const want = inside ? expected(nativeX, nativeY) : [0, 0, 0, 0];
        const offset = ((height - 1 - y) * width + x) * 4;
        const actual = pixels.subarray(offset, offset + 4);
        if (actual.some((value, i) => Math.abs(value - want[i]) > 1)) {
          throw new Error(`${name} at ${x},${y}: expected ${want}, got ${Array.from(actual)}`);
        }
      }
    }
    lines.push(`PASS ${name}`);
    passed++;
  }
  checkRectangle('native rectangle starts at command S/T', { width: 4, height: 4 });
  checkRectangle('upscaled wrapped strip has no seams');
  checkRectangle('screen and tile origins do not shift rectangle samples', {
    width: 12, height: 12, nativeWidth: 6, nativeHeight: 6, originX: 1, originY: 1,
    tileTop: 4, startT: 4, endT: 8,
  });
  checkRectangle('noninteger framebuffer scaling preserves native samples', { width: 7, height: 9 });
  checkRectangle('flipped rectangle swaps native coordinate increments', { flip: true });
  checkRectangle('rectangles retain intentional fractional filtering', {
    startT: 0.25, endT: 2.25,
    expected: (x, y) => [[191, 64, 0, 255], [64, 191, 0, 255], [0, 191, 64, 255], [0, 64, 191, 255]][y],
  });
  checkRectangle('repeated rectangles still wrap', { endT: 8, expected: (x, y) => y % 2 ? blue : red });
  checkRectangle('repeated rectangles still mirror', { endT: 8, modeT: 1, expected: (x, y) => [red, blue, white, green][y] });
  // Returning to a triangle must clear the rectangle uniforms on a cached shader.
  gl.canvas.width = gl.canvas.height = 1;
  gl.viewport(0, 0, 1, 1);
  check('triangle after rectangle retains interpolated UVs', [128, 191, 191, 255], { uv: [0.75, 0.75], filter: gbi.TextureFilter.G_TF_BILERP });

  // Decode real CI4 TMEM for the scrolling-background case. A stubbed host
  // texture cannot catch the decoder truncating a 64-texel wrap region.
  const tmem = state.tmem.tmemData;
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x += 2) {
      const index = ((x >>> 4) + (y >>> 4)) & 3;
      tmem[(y * 32 + x / 2) ^ ((y & 1) ? 4 : 0)] = index * 17;
    }
  }
  for (const [i, color] of [0xf801, 0x07c1, 0x003f, 0xffff].entries()) {
    for (let bank = 0; bank < 4; bank++) {
      tmem[0x800 + i * 8 + bank * 2] = color >>> 8;
      tmem[0x800 + i * 8 + bank * 2 + 1] = color & 255;
    }
  }
  state.invalidateTileHashes();
  const scrolling = { decode: true, format: gbi.ImageFormat.G_IM_FMT_CI, size: gbi.ImageSize.G_IM_SIZ_4b,
    line: 4, tex: { width: 64, height: 64 }, mask: [6, 6], last: [64, 64] };
  // check() normally disables the TLUT; RGBA16 is also the decoder's default.
  check('scrolling S decodes the full wrap period', white, { ...scrolling, origin: [32, 0], uv: [16, 0] });
  check('scrolling T decodes the full wrap period', white, { ...scrolling, origin: [0, 32], uv: [0, 16] });
  check('scrolling both axes preserves all texels', blue, { ...scrolling, origin: [32, 32], uv: [16, 16] });
  check('wrap boundary filters decoded texels on both sides', [255, 128, 128, 255], {
    ...scrolling, origin: [32, 0], uv: [31.5, 0], filter: gbi.TextureFilter.G_TF_BILERP,
  });
  check('mirroring uses texels beyond the clamp bounds', blue, { ...scrolling, origin: [48, 0], uv: [128, 0], mode: [1, 0] });
  check('expanded decoding preserves generated coordinate scale', green, {
    ...scrolling, origin: [32, 0], uv: [0.5, 0], texgen: true,
  });
  check('explicit clamping still uses the tile bounds', blue, { ...scrolling, origin: [32, 0], uv: [80, 0], mode: [2, 0] });
  check('copy mode decodes the wrap period even with clamp enabled', white, {
    ...scrolling, origin: [32, 0], uv: [16, 0], mode: [2, 0], cycle: gbi.CycleType.G_CYC_COPY,
  });
  const copyTexture = renderer.lookupTexture(0);
  state.rdpOtherModeH = gbi.CycleType.G_CYC_1CYCLE;
  const clampedTexture = renderer.lookupTexture(0);
  if (clampedTexture.width !== 33 || clampedTexture.height !== 64) throw new Error('Copy texture cache ignored the clamped extent');
  state.rdpOtherModeH = gbi.CycleType.G_CYC_COPY;
  if (renderer.lookupTexture(0) !== copyTexture) throw new Error('Clamped texture cache replaced the copy wrap region');
  output.textContent = `${passed} passed\n${lines.join('\n')}`;
  document.title = `${passed} passed`;
} catch (error) {
  output.textContent = `FAIL: ${error.stack || error}`;
  document.title = 'FAIL';
}
