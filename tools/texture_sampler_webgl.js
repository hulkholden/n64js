// Build: bun build tools/texture_sampler_webgl.js --outfile=build/texture_sampler_webgl.js
// Serve the repository root, then open /tools/texture_sampler_webgl.html.
// These tests exercise the real renderer, generated shaders and GPU readback.
import * as gbi from '../src/hle/gbi.js';
import { Renderer } from '../src/hle/renderer.js';
import { RenderTargets } from '../src/hle/render_targets.js';
import { RSPState } from '../src/hle/rsp_state.js';
import { TriangleBuffer } from '../src/hle/triangle_buffer.js';
import { GBIMicrocode } from '../src/hle/gbi_microcode.js';
import { runPresentationTests } from './presentation_webgl.js';
import { runRDPTests } from './rdp_webgl.js';
import { runAffineProjectionTests } from './affine_projection_webgl.js';
import { runFogTests } from './fog_webgl.js';
import { runBg1cycTests } from './s2dex_bg_1cyc_webgl.js';
import { runBgCopyTests } from './s2dex_bg_copy_webgl.js';
import { runLightColorTests } from './light_color_webgl.js';
import { runModifyVertexTests } from './modify_vertex_webgl.js';
import {
  BLUE,
  createTestTexture,
  GREEN,
  RED,
  WHITE,
} from './webgl_test_helpers.js';

const output = document.getElementById('results');
try {
  const gl = document.getElementById('display').getContext('webgl2', { antialias: false });
  if (!gl) {
    throw new Error('WebGL2 unavailable');
  }
  const state = new RSPState();
  state.reset(new DataView(new ArrayBuffer(4096)), 0);
  const renderer = new Renderer(gl, state, 1, 1);
  const microcode = new GBIMicrocode(state, state.ramDV);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, 1, 1);
  gl.disable(gl.DITHER);
  const positions = new Float32Array([-1, -1, 0, 1, 3, -1, 0, 1, -1, 3, 0, 1]);
  const colors = new Uint32Array([0xffffffff, 0xffffffff, 0xffffffff]);

  const texture = (width, height, pixels) => createTestTexture(gl, width, height, pixels);
  const quad = texture(2, 2, [RED, GREEN, BLUE, WHITE]);
  const row = texture(4, 1, [RED, GREEN, BLUE, WHITE]);
  const column = texture(1, 4, [RED, GREEN, BLUE, WHITE]);
  const npot = texture(3, 1, [RED, GREEN, BLUE]);

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
    combine = null, primLodFrac = 0, tlut = gbi.TextureLUT.G_TT_NONE,
    otherModeL = 0, blendColor = 0, clearColor = null,
  } = {}) {
    state.rdpOtherModeH = cycle | filter | lod | detail | perspective | tlut;
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
    if (decode) {
      delete renderer.lookupTexture;
    } else {
      renderer.lookupTexture = i => i === tileIndex ? tex : tex1;
    }
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
        while (gl.getError() !== gl.NO_ERROR) {
          /* drain setup errors */
        }
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

  check('integer coordinates select texel centres', RED);
  check('point sampling truncates fractions', RED, { uv: [0.75, 0.75] });
  check('three-point lower triangle', [128, 64, 64, 255], { uv: [0.25, 0.25], filter: gbi.TextureFilter.G_TF_BILERP });
  check('three-point upper triangle', [128, 191, 191, 255], { uv: [0.75, 0.75], filter: gbi.TextureFilter.G_TF_BILERP });
  check('diagonal uses three-point interpolation', [0, 128, 128, 255], { uv: [0.5, 0.5], filter: gbi.TextureFilter.G_TF_BILERP });
  check('average mode midpoint', [128, 128, 128, 255], { uv: [0.5, 0.5], filter: gbi.TextureFilter.G_TF_AVERAGE });
  check('average mode away from midpoint', [128, 64, 64, 255], { uv: [0.25, 0.25], filter: gbi.TextureFilter.G_TF_AVERAGE });
  check('five-bit filter fractions', [239, 8, 8, 255], { uv: [0.06, 0.06], filter: gbi.TextureFilter.G_TF_BILERP });
  check('implicit clamp with zero mask', RED, { uv: [-1, -1] });
  check('clamped upper edge clears fraction', GREEN, { uv: [1.75, 0], filter: gbi.TextureFilter.G_TF_BILERP });
  check('negative wrapped coordinate', GREEN, { uv: [-1, 0], mask: [1, 1] });
  check('wrap seam filters across both edges', [128, 128, 0, 255], { uv: [1.5, 0], mask: [1, 1], filter: gbi.TextureFilter.G_TF_BILERP });
  check('negative mirror coordinate', RED, { uv: [-1, 0], mask: [1, 1], mode: [1, 1] });
  check('mirror seam repeats edge texel', GREEN, { uv: [1.5, 0], mask: [1, 1], mode: [1, 1], filter: gbi.TextureFilter.G_TF_BILERP });
  check('mirror reverses direction', [128, 128, 0, 255], { uv: [2.5, 0], mask: [1, 1], mode: [1, 1], filter: gbi.TextureFilter.G_TF_BILERP });
  check('T wraps independently of S', BLUE, { tex: column, uv: [0, -2], mask: [0, 2] });
  check('T mirrors independently of S', GREEN, { tex: column, uv: [0, -2], mask: [0, 2], mode: [0, 1] });
  check('clamp and mirror both apply', RED, { uv: [6, 0], mask: [1, 0], mode: [3, 0], last: [3, 1] });
  check('clamp extent differs from mask period', GREEN, { uv: [6, 0], mask: [1, 0], mode: [2, 0], last: [3, 1] });
  check('mask period differs from texture width', GREEN, { tex: row, uv: [3, 0], mask: [1, 0] });
  check('fractional origin and shift order', GREEN, { tex: row, uv: [5, 0], origin: [1.25, 0], last: [4.25, 0], shift: [1, 0] });
  check('left shift', BLUE, { tex: row, uv: [0.125, 0], shift: [12, 0] });
  check('generated texture coordinates', WHITE, { uv: [0.75, 0.75], texgen: true });
  check('non-power-of-two decoded bounds', BLUE, { tex: npot, uv: [3, 0], mask: [2, 0] });
  check('copy mode ignores filtering', RED, { uv: [0.75, 0.75], cycle: gbi.CycleType.G_CYC_COPY, filter: gbi.TextureFilter.G_TF_AVERAGE });
  check('second tile wraps index seven to zero', BLUE, { tex1: column, uv: [0, 2], cycle: gbi.CycleType.G_CYC_2CYCLE, tileIndex: 7 });
  check('missing second texture is black', [0, 0, 0, 255], { cycle: gbi.CycleType.G_CYC_2CYCLE });
  // Chopper Attack uses two cycles with LOD enabled but a single mip level.
  // The second cycle must read the base tile, even if the next tile is absent.
  const singleLevelLOD = { cycle: gbi.CycleType.G_CYC_2CYCLE, lod: gbi.TextureLOD.G_TL_LOD };
  check('single-level LOD shares the base tile across cycles', RED, singleLevelLOD);
  check('single-level LOD uses base tile coordinates and addressing', GREEN, {
    ...singleLevelLOD, tileIndex: 7, tex: row, tex1: column, uv: [5, 0],
    origin: [1, 0], last: [4, 0], shift: [1, 0], mask: [2, 0],
  });
  check('single-level LOD preserves generated coordinates', WHITE, { ...singleLevelLOD, texgen: true, uv: [0.75, 0.75] });
  check('single-level sharpen also shares the base tile', RED, { ...singleLevelLOD, detail: gbi.TextureDetail.G_TD_SHARPEN });
  check('detail mode retains a separate second tile', BLUE, { ...singleLevelLOD, detail: gbi.TextureDetail.G_TD_DETAIL, tex1: column, uv: [0, 2] });
  check('multiple LOD levels retain a separate second tile', BLUE, { ...singleLevelLOD, level: 1, tex1: column, uv: [0, 2] });
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
  check('alpha add input six remains constant one', WHITE, {
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
    tex: texture(1, 1, [RED]), tex1: texture(1, 1, [BLUE]),
  });

  // Wetrix supplies twice the texel coordinates for its G_TP_NONE triangles.
  // Use unrelated texture dimensions to catch a size-specific workaround.
  const noPerspective = { rspTriangle: true, perspective: gbi.TexturePerspective.G_TP_NONE };
  check('non-perspective triangles halve S', GREEN, { ...noPerspective, tex: row, uv: [2, 0] });
  check('non-perspective triangles halve T', GREEN, { ...noPerspective, tex: column, uv: [0, 2] });
  check('triangle scale precedes tile shift and origin', GREEN, {
    ...noPerspective, tex: row, uv: [8, 0], shift: [1, 0], origin: [1, 0], last: [4, 0],
  });
  check('both combiner cycles use the triangle scale', GREEN, {
    ...noPerspective, tex1: column, uv: [0, 2], cycle: gbi.CycleType.G_CYC_2CYCLE,
  });
  check('generated triangle coordinates use the same scale', RED, { ...noPerspective, uv: [0.75, 0.75], texgen: true });
  check('perspective triangles retain their coordinate scale', BLUE, { rspTriangle: true, tex: row, uv: [2, 0] });

  // Threshold alpha compare accepts equality (comb_alpha >= threshold).
  // See alpha_compare in angrylion-rdp-plus/src/core/n64video/rdp/blender.c.
  // Clear to a distinct colour before each draw so discarded fragments cannot
  // accidentally pass by retaining the previous draw's pixel.
  const background = [24, 48, 72, 255];
  const alphaValues = [0, 1, 127, 128, 129, 254, 255];
  const alphaPixels = alphaValues.map(alpha => [255, 0, 0, alpha]);
  const alphaTexture = texture(alphaValues.length, 1, alphaPixels);
  const coverageKill = gbi.RenderMode.AA_EN | gbi.RenderMode.CVG_X_ALPHA;

  // Coverage-only opaque surfaces (including Tetrisphere's 0x0011) must
  // ignore combiner alpha for blending. HLE assumes full pixel coverage.
  renderer.logUnhandledBlendMode = mode => { throw new Error(`Unhandled blend mode: 0x${mode.toString(16)}`); };
  for (const cycle of [gbi.CycleType.G_CYC_1CYCLE, gbi.CycleType.G_CYC_2CYCLE]) {
    for (const mode of [0x0010, 0x0011]) {
      const blender = (cycle === gbi.CycleType.G_CYC_1CYCLE ? mode << 2 : mode) << gbi.G_MDSFT_BLENDER;
      const checkBlend = (name, flags, alpha, expected) => check(`${gbi.CycleType.nameOf(cycle)} 0x${mode.toString(16)}: ${name}`, expected, {
        cycle, rspTriangle: true, tex: alphaTexture, tex1: alphaTexture,
        uv: [alphaValues.indexOf(alpha), 0], clearColor: background,
        otherModeL: blender | gbi.RenderMode.AA_EN | flags,
      });
      // Check transitions from alpha blending to coverage-only rendering and
      // back, so stale WebGL blend state cannot hide incorrect mode selection.
      const translucent = [140, 24, 36, 191]; // SRC_ALPHA=128/255 over background.
      checkBlend('combiner alpha blends', 0, 128, translucent);
      checkBlend('coverage ignores zero alpha', gbi.RenderMode.ALPHA_CVG_SEL, 0, [255, 0, 0, 0]);
      checkBlend('coverage ignores partial alpha', gbi.RenderMode.ALPHA_CVG_SEL, 128, [255, 0, 0, 128]);
      checkBlend('coverage times alpha blends', gbi.RenderMode.ALPHA_CVG_SEL | gbi.RenderMode.CVG_X_ALPHA, 128, translucent);
      checkBlend('zero coverage times alpha is discarded', gbi.RenderMode.ALPHA_CVG_SEL | gbi.RenderMode.CVG_X_ALPHA, 0, background);
      checkBlend('coverage multiplication without selection retains alpha blending', gbi.RenderMode.CVG_X_ALPHA, 128, translucent);
    }
  }
  delete renderer.logUnhandledBlendMode;

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
    if (resumedShader !== thresholdShader) {
      throw new Error('Reenabling comparison must reuse the cached shader');
    }
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
    expected = (x, y) => [RED, GREEN, BLUE, WHITE][flip ? x : y],
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
    if (gl.getError() !== gl.NO_ERROR) {
      throw new Error(`${name}: WebGL error`);
    }
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
  checkRectangle('repeated rectangles still wrap', { endT: 8, expected: (x, y) => y % 2 ? BLUE : RED });
  checkRectangle('repeated rectangles still mirror', { endT: 8, modeT: 1, expected: (x, y) => [RED, BLUE, WHITE, GREEN][y] });

  // THPS3 draws atlas glyphs at quarter-pixel positions with AA disabled.
  // Only the upper-left coverage sample counts in this mode: native pixels
  // before the rectangle origin must not sample the neighbouring glyph.
  // Keep the fractional X interpolation offset and the integer Y scanline
  // origin, independently of the snapped coverage bounds.
  for (const scale of [1, 2]) {
    for (const cycle of [gbi.CycleType.G_CYC_1CYCLE, gbi.CycleType.G_CYC_2CYCLE]) {
      for (const flip of [false, true]) {
        for (const fraction of [0.25, 0.5, 0.75]) {
          const name = `fractional rectangle coverage, scale=${scale}, cycle=${cycle}, flip=${flip}, fraction=${fraction}`;
          const size = 6 * scale;
          gl.canvas.width = gl.canvas.height = size;
          renderer.renderTargets.reset();
          renderer.renderTargets = new RenderTargets(gl, size, size);
          renderer.nativeTransform.initDimensions(6, 6);
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.viewport(0, 0, size, size);
          gl.disable(gl.SCISSOR_TEST);
          gl.clear(gl.COLOR_BUFFER_BIT);
          state.scissor = { x0: 0, y0: 0, x1: 6, y1: 6 };
          state.rdpOtherModeH = cycle | gbi.TextureFilter.G_TF_BILERP;
          state.rdpOtherModeL = 0;
          for (const tile of state.tiles.slice(0, 2)) {
            tile.set(0, 2, 1, 0, 0, 2, 2, 0, 2, 2, 0);
            tile.setSize(0, 0, 12, 0);
          }
          renderer.lookupTexture = i => i < 2 ? row : null;
          // The texels before and after the green/blue glyph are red/white.
          // A half-texel step also checks that snapping does not stretch UVs.
          renderer.texRect(0, 1 + fraction, 1 + fraction, 4 + fraction, 4 + fraction,
            1, 0, 2.5, 0, flip);
          const pixels = new Uint8Array(size * size * 4);
          gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          if (gl.getError() !== gl.NO_ERROR) {
            throw new Error(`${name}: WebGL error`);
          }
          // Y starts on floor(y0), while X retains its quarter-pixel offset.
          const samples = flip ? [[0, 128, 128, 255], BLUE, [128, 128, 255, 255]] : {
            0.25: [[0, 159, 96, 255], [0, 32, 223, 255], [96, 96, 255, 255]],
            0.5: [[0, 191, 64, 255], [0, 64, 191, 255], [64, 64, 255, 255]],
            0.75: [[0, 223, 32, 255], [0, 96, 159, 255], [32, 32, 255, 255]],
          }[fraction];
          for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
              const nx = Math.floor(x / scale), ny = Math.floor(y / scale);
              const inside = nx >= 2 && nx < 5 && ny >= 2 && ny < 5;
              const expected = inside ? samples[(flip ? ny : nx) - 2] : [0, 0, 0, 0];
              const offset = ((size - 1 - y) * size + x) * 4;
              const actual = pixels.subarray(offset, offset + 4);
              if (actual.some((value, i) => Math.abs(value - expected[i]) > 1)) {
                throw new Error(`${name} at ${x},${y}: expected ${expected}, got ${Array.from(actual)}`);
              }
            }
          }
          lines.push(`PASS ${name}`);
          passed++;
        }
      }
    }
  }

  // Rush 2049 draws its title in reversed, clamped strips with a wrap mask.
  // Go through command decoding: calling texRect directly misses the old
  // negative-derivative offset that wrapped the first row to the other edge.
  microcode.renderer = renderer;
  for (const scale of [1, 2]) {
    for (const copy of [false, true]) {
      for (const flip of [false, true]) {
        for (const reverseS of [false, true]) {
          const name = `reversed ${reverseS ? 'S' : 'T'} strip, copy=${copy}, flip=${flip}, scale=${scale}`;
          const size = 4 * scale;
          gl.canvas.width = gl.canvas.height = size;
          renderer.renderTargets.reset();
          renderer.renderTargets = new RenderTargets(gl, size, size);
          renderer.nativeTransform.initDimensions(4, 4);
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.viewport(0, 0, size, size);
          state.rdpOtherModeH = copy ? gbi.CycleType.G_CYC_COPY : gbi.TextureFilter.G_TF_BILERP;
          const tile = state.tiles[0];
          tile.set(0, 2, 1, 0, 0, 2, reverseS ? 2 : 0, 0, 2, reverseS ? 0 : 2, 0);
          // Nonzero tile origin, as in Rush's successive image strips.
          tile.setSize(reverseS ? 16 : 0, reverseS ? 0 : 16,
            reverseS ? 28 : 0, reverseS ? 0 : 28);
          renderer.lookupTexture = i => i === 0 ? (reverseS ? row : column) : null;
          const end = (copy ? 3 : 4) * 4;
          const cmd0 = (end << 12) | end;
          const cmd2 = reverseS ? (7 * 32) << 16 : 7 * 32;
          const cmd3 = reverseS ? (copy ? -4096 : -1024) << 16 : 0xfc00;
          microcode.rdpTexRect(cmd0, 0, cmd2, cmd3, undefined, flip);
          const pixels = new Uint8Array(size * size * 4);
          gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          if (gl.getError() !== gl.NO_ERROR) {
            throw new Error(`${name}: WebGL error`);
          }
          for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
              const step = Math.floor((reverseS !== flip ? x : y) / scale);
              const expected = [WHITE, BLUE, GREEN, RED][step];
              const offset = ((size - 1 - y) * size + x) * 4;
              const actual = pixels.subarray(offset, offset + 4);
              if (actual.some((value, i) => value !== expected[i])) {
                throw new Error(`${name} at ${x},${y}: expected ${expected}, got ${Array.from(actual)}`);
              }
            }
          }
          lines.push(`PASS ${name}`);
          passed++;
        }
      }
    }
  }
  // Returning to a triangle must clear the rectangle uniforms on a cached shader.
  gl.canvas.width = gl.canvas.height = 1;
  gl.viewport(0, 0, 1, 1);
  check('triangle after rectangle retains interpolated UVs', [128, 191, 191, 255], { uv: [0.75, 0.75], filter: gbi.TextureFilter.G_TF_BILERP });

  const tmem = state.tmem.tmemData;
  // Bio FREAKS declares its indexed font as IA4. Index 14 would disappear if
  // decoded directly as IA4, but the enabled TLUT supplies opaque white.
  tmem.fill(0);
  tmem[0] = 0xe0;
  for (let bank = 0; bank < 4; bank++) {
    tmem.set([0xff, 0xff], 0x800 + 14 * 8 + bank * 2);
  }
  state.invalidateTileHashes();
  const font = { decode: true, format: gbi.ImageFormat.G_IM_FMT_IA, size: gbi.ImageSize.G_IM_SIZ_4b,
    tex: { width: 1, height: 1 } };
  check('IA4 font uses opaque RGBA16 palette entry for an even index', WHITE, {
    ...font, tlut: gbi.TextureLUT.G_TT_RGBA16,
  });
  check('IA4 without TLUT still uses its own alpha bit', [255, 255, 255, 0], font);
  for (let bank = 0; bank < 4; bank++) {
    tmem.set([0x80, 0x40], 0x800 + 14 * 8 + bank * 2);
  }
  state.invalidateTileHashes();
  check('IA4 font uses independent intensity and alpha from IA16 palette', [128, 128, 128, 64], {
    ...font, tlut: gbi.TextureLUT.G_TT_IA16,
  });

  // Extreme-G enables TLUT for RGBA4/8 track and bike textures. Disabling
  // TLUT must instead expose their intensity values, including alpha.
  for (const [name, size, value, intensity] of [
    ['RGBA4', gbi.ImageSize.G_IM_SIZ_4b, 0xe0, 238],
    ['RGBA8', gbi.ImageSize.G_IM_SIZ_8b, 0x0e, 14],
  ]) {
    tmem[0] = value;
    for (let bank = 0; bank < 4; bank++) {
      tmem.set([0xf8, 0x01], 0x800 + 14 * 8 + bank * 2);
    }
    state.invalidateTileHashes();
    const rgba = { decode: true, format: gbi.ImageFormat.G_IM_FMT_RGBA, size, tex: { width: 1, height: 1 } };
    check(`${name} uses RGBA16 palette when enabled`, RED, { ...rgba, tlut: gbi.TextureLUT.G_TT_RGBA16 });
    check(`${name} uses intensity when TLUT is disabled`, Array(4).fill(intensity), rgba);
    check(`${name} uses IA16 palette when enabled`, [248, 248, 248, 1], { ...rgba, tlut: gbi.TextureLUT.G_TT_IA16 });
  }

  // Decode real CI4 TMEM for the scrolling-background case. A stubbed host
  // texture cannot catch the decoder truncating a 64-texel wrap region.
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
  check('scrolling S decodes the full wrap period', WHITE, { ...scrolling, origin: [32, 0], uv: [16, 0] });
  check('scrolling T decodes the full wrap period', WHITE, { ...scrolling, origin: [0, 32], uv: [0, 16] });
  check('scrolling both axes preserves all texels', BLUE, { ...scrolling, origin: [32, 32], uv: [16, 16] });
  check('wrap boundary filters decoded texels on both sides', [255, 128, 128, 255], {
    ...scrolling, origin: [32, 0], uv: [31.5, 0], filter: gbi.TextureFilter.G_TF_BILERP,
  });
  check('mirroring uses texels beyond the clamp bounds', BLUE, { ...scrolling, origin: [48, 0], uv: [128, 0], mode: [1, 0] });
  check('expanded decoding preserves generated coordinate scale', GREEN, {
    ...scrolling, origin: [32, 0], uv: [0.5, 0], texgen: true,
  });
  check('explicit clamping still uses the tile bounds', BLUE, { ...scrolling, origin: [32, 0], uv: [80, 0], mode: [2, 0] });
  check('copy mode decodes the wrap period even with clamp enabled', WHITE, {
    ...scrolling, origin: [32, 0], uv: [16, 0], mode: [2, 0], cycle: gbi.CycleType.G_CYC_COPY,
  });
  const copyTexture = renderer.lookupTexture(0);
  state.rdpOtherModeH = gbi.CycleType.G_CYC_1CYCLE;
  const clampedTexture = renderer.lookupTexture(0);
  if (clampedTexture.width !== 33 || clampedTexture.height !== 64) {
    throw new Error('Copy texture cache ignored the clamped extent');
  }
  state.rdpOtherModeH = gbi.CycleType.G_CYC_COPY;
  if (renderer.lookupTexture(0) !== copyTexture) {
    throw new Error('Clamped texture cache replaced the copy wrap region');
  }

  // Decoding through a canvas used to erase transparent RGB and quantize
  // low-alpha colours before upload. Verify the actual GPU texture samples.
  tmem.fill(0);
  tmem.set([0xf8, 0x00]);
  state.invalidateTileHashes();
  check('direct upload preserves transparent RGBA16 colour', [255, 0, 0, 0], {
    decode: true, tex: { width: 1, height: 1 },
  });
  tmem.set([0x73, 0x07]);
  state.invalidateTileHashes();
  check('direct upload preserves low-alpha IA16 precision', [115, 115, 115, 7], {
    decode: true, format: gbi.ImageFormat.G_IM_FMT_IA, tex: { width: 1, height: 1 },
  });
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
  while (gl.getError() !== gl.NO_ERROR) {
    /* drain setup errors */
  }
  clearDepthScene();
  state.noNearClipping = true;
  drawDepth([-4, -4, -4], 0xff0000ff);
  checkDepth('NoN renders the field before the near plane', [RED, RED, RED, RED]);

  clearDepthScene();
  state.noNearClipping = false;
  drawDepth([-4, -4, -4], 0xff0000ff);
  checkDepth('ordinary microcode still clips the near plane', [BLUE, BLUE, BLUE, BLUE]);

  clearDepthScene();
  state.noNearClipping = true;
  state.geometryMode.zbuffer = 1;
  state.rdpOtherModeL = gbi.RenderMode.Z_CMP | gbi.RenderMode.Z_UPD;
  drawDepth([-2, 6, -2], 0xff0000ff);
  checkDepth('NoN preserves far clipping with unequal W', [RED, RED, RED, BLUE]);
  // Original Z/W at these four pixels is -1.5, -0.5, 0.5, 1.5. The first
  // two pixels must occlude an ordinary triangle at depth 0.5.
  state.noNearClipping = false;
  drawDepth([0, 0, 0], 0xff00ff00);
  checkDepth('NoN clamps per-fragment depth without changing its slope', [RED, RED, GREEN, GREEN]);

  clearDepthScene();
  state.noNearClipping = true;
  drawDepth([0, 0, 0], 0xff0000ff, [-1, -2, -4]);
  checkDepth('NoN still clips geometry behind the eye', [BLUE, BLUE, BLUE, BLUE]);

  // G.A.S.P character select moves loaded vertices to screen Z = 1.5.
  // The replacement depth must survive WebGL's perspective divide and Z test.
  const depthMicrocode = new GBIMicrocode(state, state.ramDV);
  depthMicrocode.renderer = renderer;
  function drawModifiedDepth(word) {
    const vertices = state.projectedVertices.slice(0, 3);
    const xy = [[-1, -1], [3, -1], [-1, 3]];
    for (let i = 0; i < 3; ++i) {
      const w = 1 << i;
      vertices[i].pos.elems.set([xy[i][0] * w, xy[i][1] * w, 0.5 * w, w]);
      vertices[i].color = 0xff0000ff;
      vertices[i].set = true;
      depthMicrocode.executeModifyVertex(0xb21c0000 | (i << 1), word);
    }
    depthBuffer.reset();
    depthBuffer.pushTri(...vertices);
    renderer.flushTris(depthBuffer);
  }
  clearDepthScene();
  state.noNearClipping = false;
  drawDepth([-0.99, -0.99, -0.99], 0xff00ff00);
  drawModifiedDepth(0x00018000);
  drawDepth([-0.99, -0.99, -0.99], 0xff00ff00);
  checkDepth('G.A.S.P screen-depth updates occlude the background with unequal W', [RED, RED, RED, RED]);

  clearDepthScene();
  drawDepth([1 / 2048, 1 / 2048, 1 / 2048], 0xff00ff00);
  drawModifiedDepth(0x01ff8000);
  checkDepth('screen-depth updates preserve fractional bits during depth testing', [GREEN, GREEN, GREEN, GREEN]);

  // RDP rectangles bypass the RSP's NoN behavior even while it is selected.
  clearDepthScene();
  state.noNearClipping = true;
  state.rdpOtherModeL = gbi.DepthSource.G_ZS_PRIM;
  state.primDepth = -4;
  renderer.texRect(0, 0, 0, 320, 240, 0, 0, 0, 0);
  checkDepth('RDP rectangles retain ordinary clipping after NoN triangles', [BLUE, BLUE, BLUE, BLUE]);

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
    const textureWhite = texture(1, 1, [WHITE]);
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
    function checkClip(name, inside = (x, y) => x >= 2 && x < 5 && y >= 1 && y < 4, foreground = WHITE) {
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      if (gl.getError() !== gl.NO_ERROR) {
        throw new Error(`${name}: WebGL error`);
      }
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const want = inside(x / scale, y / scale) ? foreground : BLUE;
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
    checkClip('drawing restores scissor after presentation', undefined, RED);
    clipRenderer.debugClear();
    checkClip('debug clear ignores the game scissor', () => true, [255, 0, 255, 255]);
  }
  // Banjo-Kazooie queues rendering into the displayed buffer while DP is
  // frozen. Check actual scanout pixels, including the copy outside scissor.
  {
    gl.canvas.width = 2;
    gl.canvas.height = 2;
    const frozenState = new RSPState();
    const frozenRenderer = new Renderer(gl, frozenState, 2, 2);
    frozenRenderer.nativeTransform.initDimensions(2, 2);
    const targets = frozenRenderer.renderTargets;
    function clearImage(address, color) {
      frozenRenderer.setColorImage({ address, width: 2, size: gbi.ImageSize.G_IM_SIZ_16b, format: gbi.ImageFormat.G_IM_FMT_RGBA });
      frozenRenderer.newFrame();
      gl.disable(gl.SCISSOR_TEST);
      gl.colorMask(true, true, true, true);
      gl.clearColor(...color.map(value => value / 255));
      gl.clear(gl.COLOR_BUFFER_BIT);
      targets.markDirty({ y1: 2 });
    }
    function checkFrozen(name, address, expected) {
      frozenRenderer.copyBackBufferToFrontBuffer(address);
      const actual = new Uint8Array(16);
      gl.readPixels(0, 0, 2, 2, gl.RGBA, gl.UNSIGNED_BYTE, actual);
      const error = gl.getError();
      if (error !== gl.NO_ERROR || actual.some((value, i) => value !== expected[i % 4])) {
        throw new Error(`${name}: expected ${expected}, got ${Array.from(actual)} (GL error ${error})`);
      }
      lines.push(`PASS ${name}`);
      passed++;
    }
    while (gl.getError() !== gl.NO_ERROR) {
      /* drain earlier shader setup errors */
    }
    clearImage(0, RED);
    clearImage(16, GREEN);
    targets.setDPFrozen(true);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, 0, 1, 1);
    clearImage(0, BLUE);
    checkFrozen('frozen VI retains the old frame outside the last scissor', 2, RED);
    checkFrozen('frozen VI can switch to the other completed buffer', 18, GREEN);
    targets.setDPFrozen(false);
    checkFrozen('unfreeze publishes the queued frame', 2, BLUE);
    targets.setDPFrozen(true);
    frozenRenderer.newFrame(); // Preserve an inherited color image as well.
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    checkFrozen('new task without SetColorImage preserves frozen pixels', 2, BLUE);
    targets.setDPFrozen(false);
    checkFrozen('second unfreeze publishes the inherited target', 2, WHITE);
    targets.reset();
  }
  // Exercise deletion against real GPU objects, including reset after eviction.
  {
    const cacheState = new RSPState();
    cacheState.reset(new DataView(new ArrayBuffer(8)), 0);
    const cacheRenderer = new Renderer(gl, cacheState, 1, 1);
    cacheRenderer.textureCache.maxEntries = 2;
    cacheState.tiles[0].set(gbi.ImageFormat.G_IM_FMT_RGBA, gbi.ImageSize.G_IM_SIZ_16b,
      1, 0, 0, 0, 0, 0, 0, 0, 0);
    cacheState.tiles[0].setSize(0, 0, 0, 0);
    const textures = [];
    for (const value of [0xf801, 0x07c1, 0x003f]) {
      cacheState.tmem.tmemData.set([value >>> 8, value & 255]);
      cacheState.invalidateTileHashes();
      textures.push(cacheRenderer.lookupTexture(0).texture);
    }
    if (gl.isTexture(textures[0]) || !gl.isTexture(textures[1]) || !gl.isTexture(textures[2])) {
      throw new Error('Cache eviction did not release the oldest GPU texture');
    }
    cacheRenderer.reset();
    if (textures.some(texture => gl.isTexture(texture))) {
      throw new Error('Cache reset retained GPU textures');
    }
    lines.push('PASS texture cache eviction and reset delete GPU objects');
    passed++;
  }
  const suiteRunners = [
    runRDPTests,
    runBgCopyTests,
    runBg1cycTests,
    runAffineProjectionTests,
    runFogTests,
    runLightColorTests,
    runModifyVertexTests,
    runPresentationTests,
  ];
  for (const runSuite of suiteRunners) {
    const results = runSuite(gl);
    lines.push(...results);
    passed += results.length;
  }
  output.textContent = `${passed} passed\n${lines.join('\n')}`;
  document.title = `${passed} passed`;
} catch (error) {
  output.textContent = `FAIL: ${error.stack || error}`;
  document.title = 'FAIL';
}
