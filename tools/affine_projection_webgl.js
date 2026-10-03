import { Matrix4x4 } from '../src/graphics/Matrix4x4.js';
import * as gbi from '../src/hle/gbi.js';
import { Renderer } from '../src/hle/renderer.js';
import { RSPState } from '../src/hle/rsp_state.js';
import { T3DUX } from '../src/hle/t3dux.js';
import { TriangleBuffer } from '../src/hle/triangle_buffer.js';
import { Turbo3D } from '../src/hle/turbo3d.js';

// Exercise both loaders and the real shaders: finite buffer checks alone
// cannot detect accidentally restoring perspective-correct interpolation.
export function runAffineProjectionTests(gl) {
  const lines = [];
  const red = [255, 0, 0, 255], green = [0, 255, 0, 255];
  const blue = [0, 0, 255, 255], white = [255, 255, 255, 255];
  const clear = [0, 0, 0, 0];
  const solid = color => Array(4).fill(color);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 4, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
    new Uint8Array([red, green, blue, white].flat()));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  for (const [Type, variant] of [[Turbo3D], [T3DUX, false], [T3DUX, true]]) {
    const ram = new DataView(new ArrayBuffer(256));
    const state = new RSPState();
    state.reset(ram, 0);
    const renderer = new Renderer(gl, state, 4, 1);
    const microcode = new Type(state, ram, variant);
    microcode.renderer = renderer;
    state.viewport.transform = renderer.nativeTransform.viTransform;
    state.geometryMode.shadeSmooth = true;
    state.geometryMode.cullBack = true;
    state.rdpOtherModeH = gbi.TexturePerspective.G_TP_PERSP;
    state.rdpOtherModeL = 0;
    // Output TEXEL0 * SHADE, keeping UV and color attributes active.
    state.combine.hi = (1 << 20) | (4 << 15) | (1 << 12) | (4 << 9);
    state.combine.lo = ((15 << 28) | (7 << 15) | (7 << 12) | (7 << 9)) >>> 0;
    renderer.lookupTexture = () => ({ texture, width: 4, height: 1 });
    const tile = state.tiles[0];
    tile.set(gbi.ImageFormat.G_IM_FMT_RGBA, gbi.ImageSize.G_IM_SIZ_32b, 1, 0, 0, 2, 0, 0, 2, 0, 0);
    tile.setSize(0, 0, 12, 0);
    ram.setUint32(64, 0x00010200);
    ram.setUint32(68, 0x03040500);
    const turbo = Type === Turbo3D;
    const vertices = (turbo ? state.projectedVertices : microcode.vertices).slice(0, 3);

    function load(points, matrix, u = [0, 8, 0], colors = [0xffffffff, 0xffffffff, 0xffffffff]) {
      microcode.transform = matrix;
      points.forEach(([x, y, z], i) => {
        const offset = i * (turbo ? 16 : 8);
        ram.setInt16(offset, x);
        ram.setInt16(offset + 2, y);
        ram.setInt16(offset + 4, z);
        if (turbo) {
          ram.setInt16(offset + 8, u[i] * 32);
          ram.setUint32(offset + 12, colors[i], true);
        }
      });
      if (turbo) {
        microcode.loadObjectVertices(0, 0, 3, 0);
      } else {
        microcode.loadVertices(0, 0, 3, 0);
        colors.forEach((color, i) => {
          microcode.attributes.setUint32(i * 4, color, true);
          microcode.attributes.setInt16((i + 3) * 4, u[i] * 32);
        });
        microcode.attributeValid.fill(1, 0, 6);
      }
      if (vertices.some(v => ![...v.pos.elems].every(Number.isFinite))) {
        throw new Error(`${Type.name}: nonfinite projected vertex`);
      }
    }

    function check(name, expected, drawOptions = null) {
      renderer.newFrame();
      gl.disable(gl.DITHER);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (drawOptions !== null) {
        const tb = new TriangleBuffer(1);
        tb.pushTriWithUV(...vertices, 0, 0, 8, 0, 0, 0);
        renderer.flushTris(tb, drawOptions);
      } else if (turbo) {
        microcode.drawObjectTriangles(64, 1);
      } else {
        microcode.drawTriangles(64, 1, 0);
      }
      const actual = new Uint8Array(16);
      gl.readPixels(0, 0, 4, 1, gl.RGBA, gl.UNSIGNED_BYTE, actual);
      const error = gl.getError();
      const label = `${Type.name} (${variant ?? 'SDK'}): ${name}`;
      if (error !== gl.NO_ERROR || actual.some((value, i) => Math.abs(value - expected.flat()[i]) > 1)) {
        throw new Error(`${label}: expected ${expected.flat()}, got ${Array.from(actual)} (GL error ${error})`);
      }
      lines.push(`PASS ${label}`);
    }

    const varyingW = new Matrix4x4([1, 0, 0, 0, 0, 1, 0, 0,
      0, 0, 0, 0, 0, 0, 1, 0]);
    const points = [[-1, -1, 1], [6, -2, 2], [-4, 12, 4]];
    state.geometryMode.texture = true;
    for (const scale of [1, 32768]) {
      const matrix = new Matrix4x4(varyingW.elems.map(value => value * scale));
      for (const noNearClipping of [false, true]) {
        state.noNearClipping = noNearClipping;
        load(points, matrix);
        check(`affine UV with unequal w, scale ${scale}, NoN ${noNearClipping}`, [red, green, blue, white]);
        check('ordinary draw restores perspective UV on the cached shader', [red, green, green, blue], {});
        check('affine draw restores affine UV on the cached shader', [red, green, blue, white]);
      }
    }
    state.noNearClipping = false;
    state.rdpOtherModeH = 0; // Affine mode must preserve the existing S/T half-scale.
    load(points, varyingW, [0, 16, 0]);
    check('G_TP_NONE preserves triangle coordinate scale', [red, green, blue, white]);
    state.rdpOtherModeH = gbi.TexturePerspective.G_TP_PERSP;
    state.rdpOtherModeL = 0;

    const nearCrossing = new Matrix4x4(varyingW.elems.slice());
    nearCrossing.elems[11] = -1.5;
    load(points, nearCrossing);
    check('near-plane clipping preserves affine UV with unequal w', [clear, clear, blue, white]);

    // White texture isolates RGB/alpha interpolation without inactive inputs.
    const colors = [0x00000000, 0x80808080, 0xffffffff];
    load(points, varyingW, [3.5, 3.5, 3.5], colors);
    // Screen barycentrics are (3/4-t,t,1/4), t=1/16,3/16,5/16,7/16.
    check('shade RGBA remains affine with unequal w', [71.75, 87.75, 103.75, 119.75].map(v => [v, v, v, v]));

    // Keep both SHADE and TEXEL0 active while changing interpolation modes on
    // the same cached shader. RDP needs affine shade with perspective UVs.
    load(points, varyingW, [0, 8, 0], colors);
    const expectedInterpolation = (affineShade, affineUV) => Array.from({ length: 4 }, (_, i) => {
      const t = (2 * i + 1) / 16;
      const inverseW = (0.75 - t) + t / 2 + 0.25 / 4;
      const shade = affineShade ? 128 * t + 255 / 4 : (128 * t / 2 + 255 / 16) / inverseW;
      const alpha = 128 * t + 255 / 4;
      const u = affineUV ? 8 * t : (8 * t / 2) / inverseW;
      const texel = [red, green, blue, white][Math.floor(u)];
      return [...texel.slice(0, 3).map(channel => channel * shade / 255), alpha];
    });
    check('object draw enables affine shade and UVs', expectedInterpolation(true, true));
    for (const [name, options] of [
      ['RDP shade preserves perspective UVs', { affineShade: true }],
      ['ordinary draw restores perspective shade and UVs', {}],
      ['UV-only affine mode preserves perspective shade', { affineUV: true }],
      ['both affine controls can be restored', { affineShade: true, affineUV: true }],
      ['RDP shade disables the previous affine UV mode', { affineShade: true }],
    ]) {
      check(name, expectedInterpolation(options.affineShade, options.affineUV), options);
    }

    const eyeCrossing = new Matrix4x4([1, 0, 0, 0, 0, 1, 0, 0,
      0, 0, 0, -1, 0, 0, 1, 0]);
    for (const w of [0, -2, 1]) {
      load([[-2, -2, 2], [6, -2, 2], [-2, 10, w]], eyeCrossing, [3.5, 3.5, 3.5]);
      check(`clips a triangle with third vertex w=${w} and keeps its visible portion`, solid(white));
    }
    state.geometryMode.cullBack = false;
    load([[-2, -2, -2], [6, -2, -2], [-2, 10, -2]], eyeCrossing, [3.5, 3.5, 3.5]);
    check('geometry entirely behind the camera is clipped', solid(clear));
    load([[-2, -2, 0], [6, -2, 0], [-2, 10, 0]], eyeCrossing, [3.5, 3.5, 3.5]);
    check('geometry on the eye plane is clipped', solid(clear));
    load([[-1, -1, -2], [3, -1, 0], [-1, 3, 0]], Matrix4x4.identity(), [3.5, 3.5, 3.5]);
    check('near-plane crossing clips only the outside portion', [clear, clear, white, white]);
  }
  gl.deleteTexture(texture);
  return lines;
}
