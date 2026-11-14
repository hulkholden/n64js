import * as gbi from '../../src/hle/graphics/gbi.js';
import { GBIMicrocode } from '../../src/hle/graphics/microcodes/gbi_microcode.js';
import { TriangleBuffer } from '../../src/hle/graphics/triangle_buffer.js';
import {
  assertFramebufferGrid,
  BLUE,
  createWebGLHarness,
  loadTestTexture,
  RED,
  testTexture,
  WHITE,
} from './webgl_test_helpers.js';

// Wave Race changes the scissor around its rotating course preview. Check
// real pixels through SetScissor and every drawing path, at both resolutions.
export function runScissorTests(gl) {
  const positions = new Float32Array([-1, -1, 0, 1, 3, -1, 0, 1, -1, 3, 0, 1]);
  const lines = [];

  for (const scale of [1, 2]) {
    const width = 8 * scale;
    const height = 6 * scale;
    gl.canvas.width = width;
    gl.canvas.height = height;
    const {
      state: clipState,
      renderer: clipRenderer,
      microcode: clipMicrocode,
    } = createWebGLHarness(gl, { width, height, Microcode: GBIMicrocode });

    try {
      clipRenderer.nativeTransform.initDimensions(8, 6);
      clipRenderer.newFrame();
      gl.disable(gl.DITHER);
      clipState.rdpOtherModeH = gbi.TexturePerspective.G_TP_PERSP;
      clipState.combine.hi = (1 << 20) | (4 << 15) | (1 << 12) | (4 << 9) | (1 << 5) | 4;
      clipState.combine.lo = ((15 << 28) | (7 << 15) | (7 << 12) | (7 << 9) |
        (15 << 24) | (1 << 21) | (4 << 18) | (7 << 6) | (7 << 3) | 7) >>> 0;
      clipState.tiles[0].set(0, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0);
      loadTestTexture(clipState, clipState.tiles[0], testTexture(1, 1, [WHITE]));
      const buffer = new TriangleBuffer(1);

      const scissor = (x0 = 2, y0 = 1, x1 = 5, y1 = 4) => {
        clipMicrocode.executeSetScissor(0xed000000 | (x0 * 4 << 12) | y0 * 4, (x1 * 4 << 12) | y1 * 4);
      };
      const fullScissor = () => scissor(0, 0, 8, 6);
      const triangle = () => {
        buffer.numTris = 1;
        buffer.positions.set(positions);
        buffer.colours.fill(0xffffffff);
        clipState.geometryMode.texture = 1;
        clipRenderer.flushTris(buffer);
      };
      const backgroundScene = () => {
        clipRenderer.newFrame();
        fullScissor();
        clipState.rdpOtherModeL = 0;
        clipRenderer.clearColor({ r: 0, g: 0, b: 1, a: 1 });
        scissor();
      };
      const checkClip = (name, inside = (x, y) => x >= 2 && x < 5 && y >= 1 && y < 4, foreground = WHITE) => {
        lines.push(assertFramebufferGrid(gl, {
          width,
          height,
          scale,
          tolerance: 0,
          label: `${name} (${scale}x)`,
          expectedAt: (x, y) => (inside(x, y) ? foreground : BLUE),
        }));
      };

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
      checkClip('debug clear fills black outside the game scissor too', () => true, [0, 0, 0, 255]);
    } finally {
      clipRenderer.reset();
    }
  }

  return lines;
}
