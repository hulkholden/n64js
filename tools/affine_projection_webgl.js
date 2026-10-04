import { Matrix4x4 } from '../src/graphics/Matrix4x4.js';
import * as gbi from '../src/hle/gbi.js';
import { T3DUX } from '../src/hle/t3dux.js';
import { TriangleBuffer } from '../src/hle/triangle_buffer.js';
import { Turbo3D } from '../src/hle/turbo3d.js';
import {
  BLUE,
  CLEAR,
  testTexture,
  loadTestTexture,
  createWebGLHarness,
  GREEN,
  RED,
  solid,
  WHITE,
  assertPixels,
} from './webgl_test_helpers.js';

// Exercise both loaders and the real shaders: finite buffer checks alone
// cannot detect accidentally restoring perspective-correct interpolation.
export function runAffineProjectionTests(gl) {
  const lines = [];
  const texture = testTexture( 4, 1, [RED, GREEN, BLUE, WHITE]);

  for (const [Type, variant] of [[Turbo3D], [T3DUX, false], [T3DUX, true]]) {
    const { ram, state, renderer, microcode, resetFrame } = createWebGLHarness(gl, {
      width: 4,
      height: 1,
      ramBytes: 256,
      Microcode: Type,
      variant,
    });
    state.viewport.transform = renderer.nativeTransform.viTransform;
    state.geometryMode.shadeSmooth = true;
    state.geometryMode.cullBack = true;
    state.rdpOtherModeH = gbi.TexturePerspective.G_TP_PERSP;
    state.rdpOtherModeL = 0;
    // Output TEXEL0 * SHADE, keeping UV and color attributes active.
    state.combine.hi = (1 << 20) | (4 << 15) | (1 << 12) | (4 << 9);
    state.combine.lo = ((15 << 28) | (7 << 15) | (7 << 12) | (7 << 9)) >>> 0;
    const tile = state.tiles[0];
    tile.set(gbi.ImageFormat.G_IM_FMT_RGBA, gbi.ImageSize.G_IM_SIZ_32b, 1, 0, 0, 2, 0, 0, 2, 0, 0);
    tile.setSize(0, 0, 12, 0);
    loadTestTexture(state, tile, texture);
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
      resetFrame([0, 0, 0, 0]);
      if (drawOptions !== null) {
        const tb = new TriangleBuffer(1);
        tb.pushTriWithUV(...vertices, 0, 0, 8, 0, 0, 0);
        renderer.flushTris(tb, drawOptions);
      } else if (turbo) {
        microcode.drawObjectTriangles(64, 1);
      } else {
        microcode.drawTriangles(64, 1, 0);
      }
      const label = `${Type.name} (${variant ?? 'SDK'}): ${name}`;
      assertPixels(gl, { width: 4, height: 1, expected, label });
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
        check(`affine UV with unequal w, scale ${scale}, NoN ${noNearClipping}`, [RED, GREEN, BLUE, WHITE]);
        check('ordinary draw restores perspective UV on the cached shader', [RED, GREEN, GREEN, BLUE], {});
        check('affine draw restores affine UV on the cached shader', [RED, GREEN, BLUE, WHITE]);
      }
    }
    state.noNearClipping = false;
    state.rdpOtherModeH = 0; // Affine mode must preserve the existing S/T half-scale.
    load(points, varyingW, [0, 16, 0]);
    check('G_TP_NONE preserves triangle coordinate scale', [RED, GREEN, BLUE, WHITE]);
    state.rdpOtherModeH = gbi.TexturePerspective.G_TP_PERSP;
    state.rdpOtherModeL = 0;

    const nearCrossing = new Matrix4x4(varyingW.elems.slice());
    nearCrossing.elems[11] = -1.5;
    load(points, nearCrossing);
    check('near-plane clipping preserves affine UV with unequal w', [CLEAR, CLEAR, BLUE, WHITE]);

    // White texture isolates RGB/alpha interpolation without inactive inputs.
    const colors = [0x00000000, 0x80808080, 0xffffffff];
    // Screen barycentrics are (3/4-t,t,1/4), t=1/16,3/16,5/16,7/16.
    const affineGray = [71.75, 87.75, 103.75, 119.75].map(v => [v, v, v, v]);
    for (const scale of [1, 32768]) {
      const matrix = new Matrix4x4(varyingW.elems.map(value => value * scale));
      for (const noNearClipping of [false, true]) {
        state.noNearClipping = noNearClipping;
        load(points, matrix, [3.5, 3.5, 3.5], colors);
        check(`shade RGBA remains affine with unequal w, scale ${scale}, NoN ${noNearClipping}`, affineGray);
      }
    }
    state.noNearClipping = false;
    load(points, nearCrossing, [3.5, 3.5, 3.5], colors);
    check('near-plane clipping preserves affine RGBA', [CLEAR, CLEAR, ...affineGray.slice(2)]);

    // Keep both SHADE and TEXEL0 active while changing interpolation modes on
    // the same cached shader. RDP needs affine shade with perspective UVs.
    load(points, varyingW, [0, 8, 0], colors);
    const expectedInterpolation = affineUV => Array.from({ length: 4 }, (_, i) => {
      const t = (2 * i + 1) / 16;
      const inverseW = (0.75 - t) + t / 2 + 0.25 / 4;
      const shade = 128 * t + 255 / 4;
      const alpha = 128 * t + 255 / 4;
      const u = affineUV ? 8 * t : (8 * t / 2) / inverseW;
      const texel = [RED, GREEN, BLUE, WHITE][Math.floor(u)];
      return [...texel.slice(0, 3).map(channel => channel * shade / 255), alpha];
    });
    check('object draw uses affine shade and UVs', expectedInterpolation(true));
    for (const [name, options] of [
      ['ordinary draw keeps affine RGBA with perspective UVs', {}],
      ['affine UV mode preserves affine RGBA', { affineUV: true }],
      ['perspective UV mode can be restored without changing shade', {}],
    ]) {
      check(name, expectedInterpolation(options.affineUV), options);
    }

    const eyeCrossing = new Matrix4x4([1, 0, 0, 0, 0, 1, 0, 0,
      0, 0, 0, -1, 0, 0, 1, 0]);
    for (const w of [0, -2, 1]) {
      load([[-2, -2, 2], [6, -2, 2], [-2, 10, w]], eyeCrossing, [3.5, 3.5, 3.5]);
      check(`clips a triangle with third vertex w=${w} and keeps its visible portion`, solid(WHITE));
    }
    state.geometryMode.cullBack = false;
    load([[-2, -2, -2], [6, -2, -2], [-2, 10, -2]], eyeCrossing, [3.5, 3.5, 3.5]);
    check('geometry entirely behind the camera is clipped', solid(CLEAR));
    load([[-2, -2, 0], [6, -2, 0], [-2, 10, 0]], eyeCrossing, [3.5, 3.5, 3.5]);
    check('geometry on the eye plane is clipped', solid(CLEAR));
    load([[-1, -1, -2], [3, -1, 0], [-1, 3, 0]], Matrix4x4.identity(), [3.5, 3.5, 3.5]);
    check('near-plane crossing clips only the outside portion', [CLEAR, CLEAR, WHITE, WHITE]);
  }
  return lines;
}
