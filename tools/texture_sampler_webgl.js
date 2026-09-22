// Build: bun build tools/texture_sampler_webgl.js --outfile=build/texture_sampler_webgl.js
// Serve the repository root, then open /tools/texture_sampler_webgl.html.
// These tests exercise the real renderer, generated shaders and GPU readback.
import * as gbi from '../src/hle/gbi.js';
import { Renderer } from '../src/hle/renderer.js';
import { RenderTargets } from '../src/hle/render_targets.js';
import { RSPState } from '../src/hle/rsp_state.js';
import { TriangleBuffer } from '../src/hle/triangle_buffer.js';
import { GBIMicrocode } from '../src/hle/gbi_microcode.js';

const output = document.getElementById('results');
try {
  const gl = document.getElementById('display').getContext('webgl2', { antialias: false });
  if (!gl) throw new Error('WebGL2 unavailable');
  const state = new RSPState();
  state.reset(new DataView(new ArrayBuffer(4096)), 0);
  const renderer = new Renderer(gl, state, 1, 1);
  const microcode = new GBIMicrocode(state, state.ramDV);
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
    combine = null, primLodFrac = 0,
    otherModeL = 0, blendColor = 0, clearColor = null,
  } = {}) {
    state.rdpOtherModeH = cycle | filter | lod | detail | perspective;
    state.rdpOtherModeL = otherModeL;
    state.blendColor = blendColor;
    state.texture.level = level;
    // (texel - zero) * shade + zero, in each combiner cycle. Keep both
    // vertex attributes active, including when testing the second sampler.
    const input = second ? 2 : 1;
    state.combine.hi = (input << 20) | (4 << 15) | (input << 12) | (4 << 9) | (1 << 5) | 4;
    state.combine.lo = ((15 << 28) | (7 << 15) | (7 << 12) | (7 << 9) |
      (15 << 24) | (1 << 21) | (4 << 18) | (7 << 6) | (7 << 3) | 7) >>> 0;
    if (combine) {
      [state.combine.hi, state.combine.lo] = combine;
    }
    microcode.executeSetPrimColor(0xfa000000 | primLodFrac, 0xffffffff);
    const tile = state.tiles[tileIndex];
    tile.set(format, size, line, 0, 0, mode[0], mask[0], shift[0], mode[1], mask[1], shift[1]);
    tile.setSize(origin[0] * 4, origin[1] * 4, last[0] * 4, last[1] * 4);
    const nextTile = state.tiles[(tileIndex + 1) & 7];
    nextTile.set(0, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0);
    nextTile.setSize(0, 0, (tex1?.width - 1 || 0) * 4, (tex1?.height - 1 || 0) * 4);
    if (decode) delete renderer.lookupTexture;
    else renderer.lookupTexture = i => i === tileIndex ? tex : tex1;
    const coords = new Float32Array([...uv, ...uv, ...uv]);
    if (clearColor) {
      gl.clearColor(...clearColor.map(value => value / 255));
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
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
      // Inspect the combiner result directly, including its alpha channel.
      gl.disable(gl.BLEND);
      // Existing VertexArray setup enables inactive attributes in copy/fill
      // and custom combiners; discard setup errors for those shader variants.
      if (cycle === gbi.CycleType.G_CYC_COPY || cycle === gbi.CycleType.G_CYC_FILL || combine) {
        while (gl.getError() !== gl.NO_ERROR) { /* drain setup errors */ }
      }
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
    return renderer.getCurrentN64Shader();
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

  // Ocarina of Time's NTSC name-entry grid blends Latin and Japanese glyphs
  // using (TEXEL1 - TEXEL0) * PRIM_LOD_FRAC + TEXEL0 in the first alpha cycle.
  const glyphBlend = {
    cycle: gbi.CycleType.G_CYC_2CYCLE,
    combine: [0x00ffadff, 0xfffd9238],
    tex: texture(1, 1, [[255, 255, 255, 64]]),
    tex1: texture(1, 1, [[255, 255, 255, 192]]),
  };
  for (const [fraction, alpha] of [[0, 64], [64, 96], [128, 128], [255, 192], [0, 64]]) {
    check(`glyph alpha blend at primitive LOD fraction ${fraction}`, [255, 255, 255, alpha], {
      ...glyphBlend, primLodFrac: fraction,
    });
  }

  // The multiplier uses a different mux table from the alpha A/B/D inputs.
  check('alpha multiplier zero selects LOD fraction, not combined alpha', [255, 255, 255, 64], {
    ...glyphBlend, combine: [0x00ffa1ff, 0xfffd9238],
  });
  check('alpha add input six remains constant one', white, {
    ...glyphBlend, combine: [0x00ffffff, 0xfffdfc38], primLodFrac: 64,
  });
  check('second alpha cycle blends with swapped texel inputs', [255, 255, 255, 160], {
    ...glyphBlend, combine: [0x00ffffff, 0xff59fc09], primLodFrac: 64,
  });
  check('one-cycle alpha uses primitive LOD fraction', [255, 255, 255, 16], {
    ...glyphBlend, cycle: gbi.CycleType.G_CYC_1CYCLE,
    combine: [0x00ff9dff, 0xfffdfe38], primLodFrac: 64,
  });
  check('RGB multiplier uses the same primitive LOD fraction', [191, 0, 64, 255], {
    ...glyphBlend, combine: [0x00277fff, 0x1ffcfc38], primLodFrac: 64,
    tex: texture(1, 1, [red]), tex1: texture(1, 1, [blue]),
  });

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

  // Threshold alpha compare accepts equality (comb_alpha >= threshold).
  // See alpha_compare in angrylion-rdp-plus/src/core/n64video/rdp/blender.c.
  // Clear to a distinct colour before each draw so discarded fragments cannot
  // accidentally pass by retaining the previous draw's pixel.
  const background = [24, 48, 72, 255];
  const alphaValues = [0, 1, 127, 128, 129, 254, 255];
  const alphaPixels = alphaValues.map(alpha => [255, 0, 0, alpha]);
  const alphaTexture = texture(alphaValues.length, 1, alphaPixels);
  const coverageKill = gbi.RenderMode.AA_EN | gbi.RenderMode.CVG_X_ALPHA;
  for (const cycle of [gbi.CycleType.G_CYC_1CYCLE, gbi.CycleType.G_CYC_2CYCLE]) {
    function checkAlpha(name, alpha, threshold, writes, otherModeL = gbi.AlphaCompare.G_AC_THRESHOLD) {
      const index = alphaValues.indexOf(alpha);
      return check(`${gbi.CycleType.nameOf(cycle)}: ${name}`, writes ? alphaPixels[index] : background, {
        cycle, tex: alphaTexture, tex1: alphaTexture, uv: [index, 0],
        otherModeL, blendColor: (0x12345600 | threshold) >>> 0, clearColor: background,
      });
    }
    const thresholdShader = checkAlpha('alpha above threshold writes', 129, 128, true);
    checkAlpha('alpha below threshold is discarded', 127, 128, false);
    checkAlpha('alpha equal to threshold writes', 128, 128, true);
    const raisedShader = checkAlpha('raising threshold discards the same alpha', 129, 130, false);
    const loweredShader = checkAlpha('lowering threshold restores the same alpha', 129, 128, true);
    if (raisedShader !== thresholdShader || loweredShader !== thresholdShader) {
      throw new Error('Changing blend alpha must reuse the cached shader');
    }
    checkAlpha('disabling comparison writes below threshold', 127, 130, true, gbi.AlphaCompare.G_AC_NONE);
    checkAlpha('disabled comparison writes zero alpha', 0, 130, true, gbi.AlphaCompare.G_AC_NONE);
    const resumedShader = checkAlpha('reenabling comparison uploads the latest threshold', 129, 130, false);
    if (resumedShader !== thresholdShader) throw new Error('Reenabling comparison must reuse the cached shader');
    checkAlpha('zero threshold accepts zero alpha', 0, 0, true);
    checkAlpha('maximum threshold discards lower alpha', 254, 255, false);
    checkAlpha('maximum threshold accepts equal alpha', 255, 255, true);

    // Coverage's existing zero-alpha approximation must still reject zero,
    // including when a cached threshold shader previously accepted it.
    checkAlpha('coverage approximation rejects zero alpha', 0, 255, false, coverageKill);
    checkAlpha('coverage approximation accepts positive alpha', 1, 255, true, coverageKill);
    checkAlpha('coverage still rejects zero with threshold enabled', 0, 0, false,
      coverageKill | gbi.AlphaCompare.G_AC_THRESHOLD);
    checkAlpha('threshold equality survives with coverage enabled', 128, 128, true,
      coverageKill | gbi.AlphaCompare.G_AC_THRESHOLD);
    checkAlpha('disabling coverage restores zero-alpha writes', 0, 255, true, gbi.AlphaCompare.G_AC_NONE);
  }
  state.rdpOtherModeL = 0;
  state.blendColor = 0;
  gl.clearColor(0, 0, 0, 0);

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

  // Wetrix uses NoN microcode with its field and background before the near
  // plane. Verify pixels and depth with the production shaders, including a
  // triangle crossing both Z planes and having unequal homogeneous W values.
  gl.canvas.width = 4;
  gl.canvas.height = 1;
  renderer.renderTargets = new RenderTargets(gl, 4, 1);
  renderer.newFrame();
  state.reset(new DataView(new ArrayBuffer(4096)), 0);
  state.rdpOtherModeH = gbi.CycleType.G_CYC_1CYCLE;
  state.rdpOtherModeL = 0;
  // Output shade in both cycles, without textures.
  state.combine.hi = 0x00ffffff;
  state.combine.lo = 0xfffe793c;
  const depthBuffer = new TriangleBuffer(1);
  function drawDepth(z, color, w = [1, 2, 4]) {
    depthBuffer.numTris = 1;
    const xy = [[-1, -1], [3, -1], [-1, 3]];
    for (let i = 0; i < 3; i++) {
      depthBuffer.positions.set([xy[i][0] * w[i], xy[i][1] * w[i], z[i] * w[i], w[i]], i * 4);
    }
    depthBuffer.colours.fill(color);
    renderer.flushTris(depthBuffer);
  }
  function clearDepthScene() {
    gl.clearColor(0, 0, 1, 1);
    gl.clearDepth(1);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }
  function checkDepth(name, expected) {
    const actual = new Uint8Array(16);
    gl.readPixels(0, 0, 4, 1, gl.RGBA, gl.UNSIGNED_BYTE, actual);
    const error = gl.getError();
    if (error !== gl.NO_ERROR || actual.some((value, i) => Math.abs(value - expected.flat()[i]) > 1)) {
      throw new Error(`${name}: expected ${expected.flat()}, got ${Array.from(actual)} (GL error ${error})`);
    }
    lines.push(`PASS ${name}`);
    passed++;
  }
  // Ignore inactive UV attribute setup errors as the sampler checks do above.
  while (gl.getError() !== gl.NO_ERROR) { /* drain setup errors */ }
  clearDepthScene();
  state.noNearClipping = true;
  drawDepth([-4, -4, -4], 0xff0000ff);
  checkDepth('NoN renders the field before the near plane', [red, red, red, red]);

  clearDepthScene();
  state.noNearClipping = false;
  drawDepth([-4, -4, -4], 0xff0000ff);
  checkDepth('ordinary microcode still clips the near plane', [blue, blue, blue, blue]);

  clearDepthScene();
  state.noNearClipping = true;
  state.geometryMode.zbuffer = 1;
  state.rdpOtherModeL = gbi.RenderMode.Z_CMP | gbi.RenderMode.Z_UPD;
  drawDepth([-2, 6, -2], 0xff0000ff);
  checkDepth('NoN preserves far clipping with unequal W', [red, red, red, blue]);
  // Original Z/W at these four pixels is -1.5, -0.5, 0.5, 1.5. The first
  // two pixels must occlude an ordinary triangle at depth 0.5.
  state.noNearClipping = false;
  drawDepth([0, 0, 0], 0xff00ff00);
  checkDepth('NoN clamps per-fragment depth without changing its slope', [red, red, green, green]);

  clearDepthScene();
  state.noNearClipping = true;
  drawDepth([0, 0, 0], 0xff0000ff, [-1, -2, -4]);
  checkDepth('NoN still clips geometry behind the eye', [blue, blue, blue, blue]);

  // RDP rectangles bypass the RSP's NoN behavior even while it is selected.
  state.rdpOtherModeL = gbi.DepthSource.G_ZS_PRIM;
  state.primDepth = -4;
  renderer.texRect(0, 0, 0, 320, 240, 0, 0, 0, 0);
  checkDepth('RDP rectangles retain ordinary clipping after NoN triangles', [blue, blue, blue, blue]);

  // Wave Race changes the scissor around its rotating course preview. Check
  // real pixels through SetScissor and every drawing path, at both resolutions.
  for (const scale of [1, 2]) {
    const width = 8 * scale, height = 6 * scale;
    gl.canvas.width = width;
    gl.canvas.height = height;
    const clipState = new RSPState();
    clipState.reset(new DataView(new ArrayBuffer(4096)), 0);
    const clipRenderer = new Renderer(gl, clipState, width, height);
    clipRenderer.nativeTransform.initDimensions(8, 6);
    const clipMicrocode = new GBIMicrocode(clipState, clipState.ramDV);
    clipRenderer.newFrame();
    clipState.rdpOtherModeH = gbi.TexturePerspective.G_TP_PERSP;
    clipState.combine.hi = (1 << 20) | (4 << 15) | (1 << 12) | (4 << 9) | (1 << 5) | 4;
    clipState.combine.lo = ((15 << 28) | (7 << 15) | (7 << 12) | (7 << 9) |
      (15 << 24) | (1 << 21) | (4 << 18) | (7 << 6) | (7 << 3) | 7) >>> 0;
    clipState.tiles[0].set(0, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0);
    clipRenderer.lookupTexture = () => textureWhite;
    const textureWhite = texture(1, 1, [white]);
    const buffer = new TriangleBuffer(1);
    function scissor(x0 = 2, y0 = 1, x1 = 5, y1 = 4) {
      clipMicrocode.executeSetScissor(0xed000000 | (x0 * 4 << 12) | y0 * 4, (x1 * 4 << 12) | y1 * 4);
    }
    function fullScissor() { scissor(0, 0, 8, 6); }
    function triangle() {
      buffer.numTris = 1;
      buffer.positions.set(positions);
      buffer.colours.fill(0xffffffff);
      clipState.geometryMode.texture = 1;
      clipRenderer.flushTris(buffer);
    }
    function backgroundScene() {
      clipRenderer.newFrame();
      fullScissor();
      clipState.rdpOtherModeL = 0;
      clipRenderer.clearColor({ r: 0, g: 0, b: 1, a: 1 });
      scissor();
    }
    function checkClip(name, inside = (x, y) => x >= 2 && x < 5 && y >= 1 && y < 4, foreground = white) {
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      if (gl.getError() !== gl.NO_ERROR) throw new Error(`${name}: WebGL error`);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const want = inside(x / scale, y / scale) ? foreground : blue;
          const offset = ((height - 1 - y) * width + x) * 4;
          const actual = pixels.subarray(offset, offset + 4);
          if (actual.some((value, i) => value !== want[i])) {
            throw new Error(`${name} (${scale}x) at ${x},${y}: expected ${want}, got ${Array.from(actual)}`);
          }
        }
      }
      lines.push(`PASS ${name} (${scale}x)`);
      passed++;
    }
    for (const [name, draw] of [
      ['triangle scissor', triangle],
      ['filled rectangle scissor', () => clipRenderer.fillRect(0, 0, 8, 6, { r: 1, g: 1, b: 1, a: 1 })],
      ['texture rectangle scissor', () => clipRenderer.texRect(0, 0, 0, 8, 6, 0, 0, 0, 0)],
      // A large diamond covers the box while extending beyond all four edges.
      ['rotated rectangle scissor', () => clipRenderer.texRectRot(0, -8, 3, 4, -9, 4, 15, 16, 3, 0, 0, 0, 0)],
      ['color clear scissor', () => clipRenderer.clearColor({ r: 1, g: 1, b: 1, a: 1 })],
    ]) {
      backgroundScene();
      draw();
      checkClip(name);
    }
    backgroundScene();
    fullScissor();
    clipRenderer.clearDepth(0);
    scissor();
    clipRenderer.clearDepth(1);
    fullScissor();
    clipState.geometryMode.zbuffer = 1;
    clipState.rdpOtherModeL = gbi.RenderMode.Z_CMP | gbi.RenderMode.Z_UPD;
    triangle();
    checkClip('depth clear scissor');

    backgroundScene();
    scissor(5, 4, 2, 1);
    triangle();
    checkClip('inverted scissor draws nothing', () => false);
    scissor(2, 1, 2, 4);
    triangle();
    checkClip('empty scissor draws nothing', () => false);
    fullScissor();
    triangle();
    checkClip('expanded scissor takes effect on the next draw', () => true);

    backgroundScene();
    triangle();
    clipRenderer.copyBackBufferToFrontBuffer(0);
    checkClip('presentation copies pixels outside the last scissor');
    clipRenderer.newFrame();
    clipRenderer.fillRect(0, 0, 8, 6, { r: 1, g: 0, b: 0, a: 1 });
    checkClip('drawing restores scissor after presentation', undefined, red);
    clipRenderer.debugClear();
    checkClip('debug clear ignores the game scissor', () => true, [255, 0, 255, 255]);
  }
  output.textContent = `${passed} passed\n${lines.join('\n')}`;
  document.title = `${passed} passed`;
} catch (error) {
  output.textContent = `FAIL: ${error.stack || error}`;
  document.title = 'FAIL';
}
