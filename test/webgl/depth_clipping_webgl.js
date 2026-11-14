import * as gbi from '../../src/hle/graphics/gbi.js';
import { GBIMicrocode } from '../../src/hle/graphics/microcodes/gbi_microcode.js';
import { TriangleBuffer } from '../../src/hle/graphics/triangle_buffer.js';
import {
  assertPixels,
  BLUE,
  createWebGLHarness,
  GREEN,
  RED,
} from './webgl_test_helpers.js';

// Wetrix uses NoN microcode with its field and background before the near
// plane. Verify pixels and depth with the production shaders, including a
// triangle crossing both Z planes and having unequal homogeneous W values.
export function runDepthClippingTests(gl) {
  const { state, renderer, microcode } = createWebGLHarness(gl, {
    width: 4,
    height: 1,
    Microcode: GBIMicrocode,
  });
  const lines = [];
  try {
    renderer.newFrame();
    gl.disable(gl.DITHER);
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
      assertPixels(gl, { width: 4, height: 1, expected, label: name });
      lines.push(`PASS ${name}`);
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
    function drawModifiedDepth(word) {
      const vertices = state.projectedVertices.slice(0, 3);
      const xy = [[-1, -1], [3, -1], [-1, 3]];
      for (let i = 0; i < 3; ++i) {
        const w = 1 << i;
        vertices[i].pos.elems.set([xy[i][0] * w, xy[i][1] * w, 0.5 * w, w]);
        vertices[i].color = 0xff0000ff;
        vertices[i].set = true;
        microcode.executeModifyVertex(0xb21c0000 | (i << 1), word);
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
    renderer.lleRect(0, renderer.nativeTransform.calculateRectVertices(0, 0, 320, 240, -4),
      [0, 0, 0, 0, 0, 0, 0, 0], [0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff]);
    checkDepth('RDP rectangles retain ordinary clipping after NoN triangles', [BLUE, BLUE, BLUE, BLUE]);

    return lines;
  } finally {
    renderer.reset();
  }
}
