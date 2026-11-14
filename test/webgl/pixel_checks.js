// Serve the repository root after `bun run build:visual`, then open
// /test/webgl/pixel_checks.html (optional ?suite=<name> runs a single suite).
import { runAffineProjectionTests } from './affine_projection_webgl.js';
import { runConkerTests } from './conker_webgl.js';
import { runDepthClippingTests } from './depth_clipping_webgl.js';
import { runDPFreezeTests } from './dp_freeze_webgl.js';
import { runF3DFLXTests, runFogTests } from './fog_webgl.js';
import { runHLECommandTests } from './hle_commands_webgl.js';
import { runL3DEXTests } from './l3dex_webgl.js';
import { runLightColorTests } from './light_color_webgl.js';
import { runModifyVertexTests } from './modify_vertex_webgl.js';
import { runMoveWordPointsTests } from './moveword_points_webgl.js';
import { runPresentationTests } from './presentation_webgl.js';
import { runPrimitiveDepthTests } from './primitive_depth_webgl.js';
import { runRDPTests } from './rdp_webgl.js';
import { runBg1cycTests } from './s2dex_bg_1cyc_webgl.js';
import { runBgCopyTests } from './s2dex_bg_copy_webgl.js';
import { runScissorTests } from './scissor_webgl.js';
import { runSprite2DTests } from './sprite2d_webgl.js';
import { runTextureSamplerTests } from './texture_sampler_webgl.js';
import { runTMEMSamplingTests } from './tmem_sampling_webgl.js';

const suites = [
  ['texture-sampler', runTextureSamplerTests],
  ['depth-clipping', runDepthClippingTests],
  ['scissor', runScissorTests],
  ['dp-freeze', runDPFreezeTests],
  ['tmem-sampling', runTMEMSamplingTests],
  ['rdp', runRDPTests],
  ['s2dex-bg-copy', runBgCopyTests],
  ['s2dex-bg-1cyc', runBg1cycTests],
  ['affine-projection', runAffineProjectionTests],
  ['conker', runConkerTests],
  ['l3dex', runL3DEXTests],
  ['fog', runFogTests],
  ['f3dflx', runF3DFLXTests],
  ['light-color', runLightColorTests],
  ['modify-vertex', runModifyVertexTests],
  ['moveword-points', runMoveWordPointsTests],
  ['presentation', runPresentationTests],
  ['hle-commands', runHLECommandTests],
  ['sprite2d', runSprite2DTests],
  ['primitive-depth', runPrimitiveDepthTests],
];

const output = document.getElementById('results');
globalThis.n64js ??= { warn: console.warn };

try {
  const gl = document.getElementById('display').getContext('webgl2', { antialias: false });
  if (!gl) {
    throw new Error('WebGL2 unavailable');
  }
  const requested = new URLSearchParams(location.search).get('suite');
  const selected = requested ? suites.filter(([name]) => name === requested) : suites;
  if (!selected.length) {
    throw new Error(`Unknown WebGL test suite: ${requested}`);
  }
  const lines = [];
  for (const [, runSuite] of selected) {
    lines.push(...runSuite(gl));
  }
  output.textContent = `${lines.length} passed\n${lines.join('\n')}`;
  document.title = `${lines.length} passed`;
} catch (error) {
  output.textContent = `FAIL: ${error.stack || error}`;
  document.title = 'FAIL';
}
