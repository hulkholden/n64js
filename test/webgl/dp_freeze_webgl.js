import * as gbi from '../../src/hle/graphics/gbi.js';
import {
  assertPixels,
  BLUE,
  createWebGLHarness,
  GREEN,
  RED,
  solid,
  WHITE,
} from './webgl_test_helpers.js';

// Banjo-Kazooie queues rendering into the displayed buffer while DP is
// frozen. Check actual scanout pixels, including the copy outside scissor.
export function runDPFreezeTests(gl) {
  gl.canvas.width = 2;
  gl.canvas.height = 2;
  const { renderer: frozenRenderer } = createWebGLHarness(gl, { width: 2, height: 2 });
  const targets = frozenRenderer.renderTargets;
  const lines = [];

  function clearImage(address, color) {
    frozenRenderer.setColorImage({
      address,
      width: 2,
      size: gbi.ImageSize.G_IM_SIZ_16b,
      format: gbi.ImageFormat.G_IM_FMT_RGBA,
    });
    frozenRenderer.newFrame();
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.clearColor(...color.map(value => value / 255));
    gl.clear(gl.COLOR_BUFFER_BIT);
    targets.markDirty({ y1: 2 });
  }

  function checkFrozen(name, address, expected) {
    frozenRenderer.copyBackBufferToFrontBuffer(address);
    assertPixels(gl, { width: 2, height: 2, expected: solid(expected), tolerance: 0, label: name });
    lines.push(`PASS ${name}`);
  }

  try {
    frozenRenderer.nativeTransform.initDimensions(2, 2);
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
    return lines;
  } finally {
    frozenRenderer.reset();
  }
}
