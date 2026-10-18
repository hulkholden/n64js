import * as gbi from '../src/hle/graphics/gbi.js';
import { GBIMicrocode } from '../src/hle/graphics/microcodes/gbi_microcode.js';
import { TriangleBuffer } from '../src/hle/graphics/triangle_buffer.js';
import { assertPixels, createWebGLHarness, loadTestTexture, testTexture,
  RED, GREEN, BLUE, WHITE, solid } from './webgl_test_helpers.js';

export function runPrimitiveDepthTests(gl) {
  const h = createWebGLHarness(gl, { width: 2, height: 2, Microcode: GBIMicrocode });
  const { renderer, state, microcode } = h;
  const lines = [];
  state.combine.hi = 0x00ffffff;
  state.combine.lo = 0xfffe793c; // Shade, in both cycles.
  renderer.nativeTransform.initDimensions(2, 2);
  Object.assign(state.scissor, { x0: 0, y0: 0, x1: 2, y1: 2 });
  state.tiles[0].set(0, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0);
  loadTestTexture(state, state.tiles[0], testTexture(1, 1, [WHITE]));
  const tb = new TriangleBuffer(1);
  const compareUpdate = gbi.RenderMode.Z_CMP | gbi.RenderMode.Z_UPD;

  function reset() {
    h.resetFrame(BLUE);
    gl.depthMask(true);
    gl.clearDepth(1);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    state.geometryMode.zbuffer = 1;
    state.rdpOtherModeL = compareUpdate;
  }
  function primitive(z, mode = compareUpdate) {
    microcode.executeSetPrimDepth(0xee000000, z << 16);
    state.rdpOtherModeL = gbi.DepthSource.G_ZS_PRIM | mode;
  }
  function triangle(z, color) {
    tb.numTris = 1;
    const xy = [[-1, -1], [3, -1], [-1, 3]];
    for (let i = 0; i < 3; ++i) {
      const w = 1 << i; // Primitive depth must survive unequal clip W.
      tb.positions.set([xy[i][0] * w, xy[i][1] * w, z * w, w], i * 4);
    }
    tb.colours.fill(color);
    renderer.flushTris(tb);
  }
  function check(label, color) {
    assertPixels(gl, { width: 2, height: 2, expected: solid(color), label });
    lines.push(label);
  }

  for (const noNearClipping of [false, true]) {
    state.noNearClipping = noNearClipping;
    const name = noNearClipping ? 'NoN' : 'ordinary';
    reset();
    primitive(0xffff, gbi.RenderMode.Z_UPD);
    triangle(0, 0xff0000ff);
    state.rdpOtherModeL = compareUpdate;
    triangle(0.95, 0xff00ff00);
    check(`${name}: XG2 track appears in front of primitive-depth sky`, GREEN);

    reset();
    triangle(0, 0xff00ff00);
    state.geometryMode.zbuffer = 0;
    primitive(0x1000);
    triangle(0.9, 0xff0000ff);
    check(`${name}: primitive Z replaces vertex Z without RSP zbuffer mode`, RED);
    state.geometryMode.zbuffer = 1;
    state.rdpOtherModeL = compareUpdate;
    triangle(0, 0xff00ff00);
    check(`${name}: switching back to pixel depth restores its range`, RED);

    reset();
    triangle(-0.5, 0xff00ff00);
    state.geometryMode.zbuffer = 0;
    primitive(0x7fff);
    triangle(-0.9, 0xff0000ff);
    check(`${name}: primitive depth comparison rejects farther geometry`, GREEN);

    reset();
    triangle(-0.5, 0xff00ff00);
    primitive(0x7fff, gbi.RenderMode.Z_UPD);
    triangle(0, 0xff0000ff);
    check(`${name}: update-only primitive depth overwrites nearer pixels`, RED);
    state.rdpOtherModeL = compareUpdate;
    triangle(0, 0xff00ff00);
    check(`${name}: update-only primitive draw writes the far depth`, GREEN);

    reset();
    primitive(0x1000);
    triangle(2, 0xff0000ff);
    check(`${name}: primitive depth preserves RSP far clipping`, BLUE);
    triangle(-2, 0xff0000ff);
    check(`${name}: primitive depth preserves the microcode's near clipping`, noNearClipping ? RED : BLUE);
  }

  // RDP rectangles use primitive depth even without G_ZBUFFER, and must not
  // inherit the RSP's NoN shader or clip against the raw 15-bit register value.
  state.noNearClipping = true;
  for (const rotated of [false, true]) {
    reset();
    triangle(0, 0xff00ff00);
    state.geometryMode.zbuffer = 0;
    for (const [z, color] of [[0xffff, GREEN], [0, WHITE]]) {
      primitive(z);
      if (rotated) {
        renderer.texRectRot(0, 0, 0, 2, 0, 0, 2, 2, 2, 0, 0, 0, 0);
      } else {
        renderer.texRect(0, 0, 0, 2, 2, 0, 0, 0, 0, false);
      }
      check(`${rotated ? 'rotated' : 'axis-aligned'} rectangle at primitive Z=${z}`, color);
    }
  }
  renderer.reset();
  return lines;
}
