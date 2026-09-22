import { Matrix4x4 } from '../src/graphics/Matrix4x4.js';
import * as gbi from '../src/hle/gbi.js';
import { GBIMicrocode } from '../src/hle/gbi_microcode.js';
import { Renderer } from '../src/hle/renderer.js';
import { RSPState } from '../src/hle/rsp_state.js';
import { TriangleBuffer } from '../src/hle/triangle_buffer.js';

// Runs in the existing pixel-check page/GL context, so CI exercises the actual
// vertex loader, shader variants, interpolation and final framebuffer blend.
export function runFogTests(gl) {
  const lines = [];
  const ram = new DataView(new ArrayBuffer(64));
  const state = new RSPState();
  state.reset(ram, 0);
  const renderer = new Renderer(gl, state, 4, 1);
  const microcode = new GBIMicrocode(state, ram);
  microcode.renderer = renderer;
  renderer.newFrame();
  gl.disable(gl.DITHER);
  state.rdpOtherModeH = gbi.CycleType.G_CYC_2CYCLE;
  state.rdpOtherModeL = 0xc8000000; // FOG_SHADE_A, opaque second cycle.
  state.primColor = 0x0000ffff;
  state.fogColor = 0xff000000; // Red with ZERO alpha: fog uses shade alpha.

  function combine(rgb0 = 3, alpha0 = 3, rgb1 = rgb0, alpha1 = alpha0) {
    // Both cycles select D; A/B/C are zero. Defaults output primitive RGBA.
    state.combine.hi = 0x00ffffff;
    state.combine.lo = (0xfffc7038 | (rgb0 << 15) | (alpha0 << 9) | (rgb1 << 6) | alpha1) >>> 0;
  }
  combine();

  function load(z = [2, 2, 2], { fog = true, varyingW = false, scale = 1 } = {}) {
    state.geometryMode.fog = fog ? 1 : 0;
    state.fogParameters.set(512, -128);
    state.projection[0] = varyingW ? new Matrix4x4([
      scale, 0, 0, 0,
      0, scale, 0, 0,
      0, 0, 0.75 * scale, -scale,
      0, 0, scale, 0,
    ]) : new Matrix4x4([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 0.25, 0,
      0, 0, 0, 1,
    ]);
    const xy = varyingW ? [[-2, -2], [12, -4], [-8, 24]] : [[-1, -1], [3, -1], [-1, 3]];
    for (let i = 0; i < 3; i++) {
      ram.setInt16(i * 16, xy[i][0]);
      ram.setInt16(i * 16 + 2, xy[i][1]);
      ram.setInt16(i * 16 + 4, z[i]);
      ram.setUint32(i * 16 + 12, 0x0000ff29); // Blue, alpha 41 if fog is off.
    }
    microcode.loadVertices(0, 3, 0);
  }

  function check(name, expected) {
    renderer.newFrame();
    gl.clearColor(0, 1, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const buffer = new TriangleBuffer(1);
    buffer.pushTri(...state.projectedVertices.slice(0, 3));
    renderer.flushTris(buffer);
    const actual = new Uint8Array(16);
    gl.readPixels(0, 0, 4, 1, gl.RGBA, gl.UNSIGNED_BYTE, actual);
    const error = gl.getError();
    if (error !== gl.NO_ERROR || actual.some((value, i) => Math.abs(value - expected.flat()[i]) > 1)) {
      throw new Error(`${name}: expected ${expected.flat()}, got ${Array.from(actual)} (GL error ${error})`);
    }
    lines.push(`PASS ${name}`);
    return renderer.getCurrentN64Shader(state.noNearClipping);
  }
  const solid = color => Array(4).fill(color);
  const gradient = factors => factors.map(a => [a, 0, 255 - a, 255]);

  load([0, 0, 0]);
  check('fog clamps to zero before the fog range', solid([0, 0, 255, 255]));
  load();
  const fogShader = check('partial fog uses shade alpha, not fog-colour alpha', solid([128, 0, 127, 255]));
  load([4, 4, 4]);
  check('fog clamps to full at the far end', solid([255, 0, 0, 255]));
  load([0, 2, 4]);
  // At the four pixel centres, barycentrics for the oversized triangle are
  // (3/4-t, t, 1/4), t = 1/16,3/16,5/16,7/16. Vertex alphas are 0,128,255.
  check('fog interpolates already clamped per-vertex factors', gradient([71.75, 87.75, 103.75, 119.75]));

  for (const scale of [1, 32768]) {
    for (const noNearClipping of [false, true]) {
      state.noNearClipping = noNearClipping;
      load([2, 4, 8], { varyingW: true, scale });
      // W = 2,4,8 (times scale), Z/W = 1/4,1/2,5/8, alpha = 0,128,192.
      check(`fog is affine with unequal W (scale ${scale}, NoN ${noNearClipping})`, gradient([56, 72, 88, 104]));
    }
  }
  state.noNearClipping = false;

  load();
  state.geometryMode.fog = 0;
  state.fogParameters.set(0, 0);
  check('draw-time fog disable and parameter changes preserve cached alpha', solid([128, 0, 127, 255]));
  state.fogColor = 0x00ff00ff;
  const recolored = check('fog-colour changes update a cached shader', solid([0, 128, 127, 255]));
  if (recolored !== fogShader) throw new Error('Fog colour or RSP fog state changed the shader cache key');
  state.fogColor = 0xff000000;
  load(undefined, { fog: false });
  check('fog-disabled vertex loads retain source shade alpha', solid([41, 0, 214, 255]));
  load();
  check('reenabling fog affects newly loaded vertices', solid([128, 0, 127, 255]));

  state.rdpOtherModeL = 0;
  const plainShader = check('removing first-cycle fog changes the shader variant', solid([0, 0, 255, 255]));
  if (plainShader === fogShader) throw new Error('First-cycle blender state missing from shader cache key');
  state.rdpOtherModeL = 0xc8000000;
  if (check('restoring fog reuses the original shader', solid([128, 0, 127, 255])) !== fogShader) {
    throw new Error('Restoring first-cycle fog failed to reuse its shader');
  }
  state.rdpOtherModeH = gbi.CycleType.G_CYC_1CYCLE;
  // Keep the FOG_SHADE_A bits and inspect shader output with framebuffer
  // blending disabled; one-cycle fog blending is outside scope.
  renderer.setGLBlendMode = () => gl.disable(gl.BLEND);
  check('two-cycle fog shader is not applied in one-cycle mode', solid([0, 0, 255, 255]));
  delete renderer.setGLBlendMode;
  state.rdpOtherModeH = gbi.CycleType.G_CYC_2CYCLE;

  combine(3, 3, 0, 0);
  // Cycle one computes primitive * shade + primitive (blue = 2), then passes it.
  state.combine.hi = (3 << 20) | (4 << 15) | (7 << 12) | (7 << 9) | (15 << 5) | 31;
  check('fog blends clamped combiner RGB', solid([128, 0, 127, 255]));

  combine(3, 4); // Primitive RGB, shade alpha in both combiner cycles.
  check('combiner SHADE alpha reads the cached fog factor', solid([128, 0, 127, 128]));
  // Shade alpha must remain affine even if the blender doesn't select fog.
  state.rdpOtherModeL = 0;
  load([2, 4, 8], { varyingW: true });
  check('combiner SHADE alpha interpolates linearly without a fog blender', [56, 72, 88, 104].map(a => [0, 0, 255, a]));

  // A translucent blue texel supplies alpha independently of shade/fog.
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 255, 128]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  renderer.lookupTexture = () => ({ texture, width: 1, height: 1 });
  for (const tile of state.tiles.slice(0, 2)) {
    tile.set(gbi.ImageFormat.G_IM_FMT_RGBA, gbi.ImageSize.G_IM_SIZ_32b, 1, 0, 0, 2, 0, 0, 2, 0, 0);
    tile.setSize(0, 0, 0, 0);
  }
  state.geometryMode.texture = 1;
  combine(1, 1, 2, 2); // TEXEL0, accounting for the second-cycle input swap.
  load();
  state.rdpOtherModeL = 0xc81049d8; // Captured fog + translucent surface mode.
  check('fogged textured surface preserves transparency over the framebuffer', solid([64, 127, 64, 191]));
  state.rdpOtherModeL |= gbi.AlphaCompare.G_AC_THRESHOLD;
  state.blendColor = 129;
  check('fog keeps alpha testing on independent texture alpha', solid([0, 255, 0, 255]));
  state.blendColor = 128;
  check('fogged texture passes alpha-threshold equality', solid([64, 127, 64, 191]));
  return lines;
}
