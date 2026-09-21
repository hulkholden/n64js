import * as gbi from '../../src/hle/gbi.js';
import { Renderer } from '../../src/hle/renderer.js';
import { RenderTargets } from '../../src/hle/render_targets.js';
import { RSPState } from '../../src/hle/rsp_state.js';
import { TriangleBuffer } from '../../src/hle/triangle_buffer.js';

export const nativeWidth = 128;
export const nativeHeight = 96;
export const scales = [1, 2];
export const scrollOffsets = [15.75, 16, 16.25, 16.5];

// Deliberately asymmetric colours and contrasting edges make direction,
// repetition, clamping and filtering visible without any game assets.
function checker(x, y) {
  return ((x >> 2) + (y >> 2)) & 1 ? [40, 88, 152] : [240, 208, 96];
}

function bordered(x, y, width, height) {
  if (x === 0) return [248, 64, 88];
  if (x === width - 1) return [56, 224, 144];
  if (y === 0) return [80, 160, 248];
  if (y === height - 1) return [232, 96, 224];
  return checker(x, y);
}

// Interpolated values exactly on a 1/32-texel boundary can round either way
// on different GPUs. Nudge these scene coordinates well below one filter step;
// exact filter-boundary behaviour is covered by the constant-UV pixel tests.
function betweenFilterSteps(coords, scale = 1) {
  return coords.map(value => value + scale / 512);
}

export const scenes = [
  {
    id: 'clamp', title: 'Clamp · non-power-of-two texture',
    description: '13 × 9 texels. The four coloured edges extend outwards; the centre stays intact.',
    draw(h) {
      h.tile({ width: 13, height: 9, mode: [2, 2] });
      h.rect([8, 8, 120, 88], [-5, -4, 18, 13]);
    },
  },
  ...[
    ['repeat-s', 'Repeat S', [0, 2], [4, 0], [-8, -4, 40, 20], 'Horizontal edges filter into the next repetition; the top and bottom clamp.'],
    ['repeat-t', 'Repeat T', [2, 0], [0, 4], [-4, -8, 20, 40], 'Vertical edges filter into the next repetition; the left and right clamp.'],
    ['mirror-s', 'Mirror S', [1, 2], [4, 0], [-8, -4, 40, 20], 'Horizontal repetitions reverse direction, including negative coordinates.'],
    ['mirror-t', 'Mirror T', [2, 1], [0, 4], [-4, -8, 20, 40], 'Vertical repetitions reverse direction, including negative coordinates.'],
    ['mirror-both', 'Mirror S + T', [1, 1], [4, 4], [-8, -8, 40, 40], 'Both axes reverse independently; the edge texel repeats at each turn.'],
  ].map(([id, title, mode, mask, uv, description]) => ({
    id, title, description,
    draw(h) {
      h.tile({ mode, mask });
      h.rect([8, 8, 120, 88], uv);
    },
  })),
  {
    id: 'filtering', title: 'Point / three-point / average',
    description: 'The same 2 × 2 colour texture enlarged three ways. Average differs at exact half-texel midpoints.',
    draw(h) {
      const colors = [[248, 32, 32], [32, 248, 32], [32, 32, 248], [248, 248, 248]];
      h.tile({ width: 2, height: 2, pixels: (x, y) => colors[y * 2 + x] });
      for (const [i, filter] of [gbi.TextureFilter.G_TF_POINT, gbi.TextureFilter.G_TF_BILERP, gbi.TextureFilter.G_TF_AVERAGE].entries()) {
        h.mode({ filter });
        h.rect([4 + i * 42, 12, 40 + i * 42, 84], [0, 0, 1.5, 1.5]);
      }
    },
  },
  {
    id: 'adjacent-strips', title: 'Adjacent image strips',
    description: 'Eight wrapped 32 × 8 strips form one checkerboard. At 2×, no extra lines should appear at strip boundaries.',
    draw(h) {
      for (let strip = 0; strip < 8; strip++) {
        h.tile({ width: 32, height: 8, mask: [5, 3], last: [31, 8], pixels: (x, y) => checker(x, y + strip * 8) });
        h.rect([16, 16 + strip * 8, 112, 24 + strip * 8], [0, 0, 32, 8]);
      }
    },
  },
  {
    id: 'scroll', title: 'Scroll across a wrap boundary', frames: scrollOffsets.length,
    description: 'Four fixed quarter-texel offsets cross the 16-texel boundary on both axes. Full mask periods remain visible with a shifted tile origin.',
    draw(h, frame) {
      h.tile({ mask: [4, 4], origin: [8, 8], last: [16, 16] });
      const start = scrollOffsets[frame];
      h.rect([8, 8, 120, 88], [start, start, start + 24, start + 24]);
    },
  },
  {
    id: 'origin-shift', title: 'Tile origin and shifts',
    description: 'Left: shift right before subtracting a fractional origin. Right: left shift. Both should show the same image.',
    draw(h) {
      h.tile({ origin: [1.25, 2.5], shift: [1, 1] });
      h.rect([4, 12, 60, 84], [2.5, 5, 32.5, 35]);
      h.tile({ shift: [15, 15] });
      h.rect([68, 12, 124, 84], [0, 0, 7.5, 7.5]);
    },
  },
  {
    id: 'flipped', title: 'Flipped and reversed coordinates',
    description: 'Left: exchanged S/T axes. Right: decreasing S and T. Edge colours reveal the orientation.',
    draw(h) {
      h.tile();
      h.rect([4, 12, 60, 84], [0, 0, 16, 16], true);
      h.rect([68, 12, 124, 84], betweenFilterSteps([15, 15, -1, -1]));
    },
  },
  {
    id: 'rotated', title: 'Rotated rectangle and triangle',
    description: 'A rotated sprite and a triangle use interpolated coordinates, with intentional wrapping on both axes.',
    draw(h) {
      h.tile({ mask: [4, 4] });
      h.renderer.texRectRot(0, 24, 8, 66, 30, 6, 66, 48, 88, ...betweenFilterSteps([-4, -4, 24, 24]));
      h.triangle([[78, 12], [124, 80], [66, 76]], [[-4, -4], [28, 24], [-4, 24]]);
    },
  },
  {
    id: 'rectangle-triangles', title: 'Rectangle → triangles',
    description: 'One texture and cached shader: a rectangle, then two triangles. Triangle UVs must not inherit the rectangle’s native-pixel sampling.',
    draw(h) {
      h.tile({ mask: [4, 4] });
      h.rect([4, 12, 60, 84], [-3.25, -3.25, 20.75, 20.75]);
      h.triangle([[68, 12], [124, 12], [68, 84]], [[-3.25, -3.25], [20.75, -3.25], [-3.25, 20.75]]);
      h.triangle([[124, 12], [124, 84], [68, 84]], [[20.75, -3.25], [20.75, 20.75], [-3.25, 20.75]]);
    },
  },
  {
    id: 'two-slots', title: 'Two texture slots',
    description: 'Cycle one samples a repeating checkerboard; cycle two multiplies it by a separately mirrored colour ramp.',
    draw(h) {
      h.tile({ mask: [4, 4], pixels: checker });
      h.tile({ index: 1, mode: [1, 1], mask: [3, 3], width: 8, height: 8, pixels: (x, y) => [80 + x * 24, 80 + y * 24, 248] });
      h.mode({ twoSlots: true });
      h.rect([8, 8, 120, 88], [-8, -8, 40, 40]);
    },
  },
  {
    id: 'triangle-perspective', title: 'Triangle coordinate scale',
    description: 'Left: G_TP_PERSP. Right: doubled S/T with G_TP_NONE, as used by Wetrix. Both triangles should match.',
    draw(h) {
      h.tile();
      h.triangle([[4, 12], [60, 12], [4, 84]], [[0, 0], [16, 0], [0, 16]]);
      h.mode({ perspective: false });
      h.triangle([[68, 12], [124, 12], [68, 84]], [[0, 0], [32, 0], [0, 32]]);
    },
  },
];

export function createHarness(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error('WebGL2 unavailable');
  const ram = new Uint8Array(4096);
  // TMEM.loadTile reads the emulator's RAM accessor. Supply only synthetic RAM;
  // texture upload, decoding, caching, binding and shader generation stay real.
  window.n64js = { hardware: () => ({ cachedMemDevice: { u8: ram } }) };
  const state = new RSPState();
  state.reset(new DataView(ram.buffer), 0);
  const renderer = new Renderer(gl, state, nativeWidth, nativeHeight);
  renderer.nativeTransform.initDimensions(nativeWidth, nativeHeight);
  const triangleBuffer = new TriangleBuffer(1);

  const h = {
    renderer,
    mode({ filter = gbi.TextureFilter.G_TF_BILERP, twoSlots = false, perspective = true } = {}) {
      state.rdpOtherModeH = filter | (twoSlots ? gbi.CycleType.G_CYC_2CYCLE : gbi.CycleType.G_CYC_1CYCLE) |
        (perspective ? gbi.TexturePerspective.G_TP_PERSP : gbi.TexturePerspective.G_TP_NONE);
      state.rdpOtherModeL = 0;
      // Cycle 1: tex0 * shade. Cycle 2: combined * tex1 (slot names swap in
      // cycle 2). Alpha also uses shade, keeping all vertex attributes active.
      const cycle2Color = twoSlots ? 1 : 4;
      state.combine.hi = (1 << 20) | (4 << 15) | (1 << 12) | (4 << 9) | cycle2Color;
      state.combine.lo = ((15 << 28) | (15 << 24) | (1 << 21) | (4 << 18) |
        (7 << 15) | (7 << 12) | (7 << 9) | (7 << 6) | (7 << 3) | 7) >>> 0;
    },
    tile({ index = 0, width = 16, height = 16, mode = [0, 0], mask = [0, 0],
      shift = [0, 0], origin = [0, 0], last = [origin[0] + width - 1, origin[1] + height - 1], pixels = bordered } = {}) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const [r, g, b] = pixels(x, y, width, height);
          const rgba16 = ((r >> 3) << 11) | ((g >> 3) << 6) | ((b >> 3) << 1) | 1;
          const offset = (y * width + x) * 2;
          ram[offset] = rgba16 >>> 8;
          ram[offset + 1] = rgba16 & 255;
        }
      }
      const tile = state.tiles[index];
      const line = Math.ceil(width / 4);
      const tmem = index * 128;
      tile.set(gbi.ImageFormat.G_IM_FMT_RGBA, gbi.ImageSize.G_IM_SIZ_16b, line, tmem, 0,
        mode[0], mask[0], shift[0], mode[1], mask[1], shift[1]);
      state.textureImage.set(gbi.ImageFormat.G_IM_FMT_RGBA, gbi.ImageSize.G_IM_SIZ_16b, width, 0);
      state.tmem.loadTile(state.textureImage, tile, 0, 0, (width - 1) * 4, (height - 1) * 4, null);
      tile.setSize(origin[0] * 4, origin[1] * 4, last[0] * 4, last[1] * 4);
      state.invalidateTileHashes();
    },
    rect(bounds, uv, flip = false) {
      renderer.texRect(0, ...bounds, ...uv, flip);
    },
    triangle(points, uv) {
      triangleBuffer.numTris = 1;
      triangleBuffer.positions.set(points.flatMap(([x, y]) => [2 * x / nativeWidth - 1, 1 - 2 * y / nativeHeight, 0, 1]));
      triangleBuffer.colours.fill(0xffffffff);
      const coordinateScale = (state.rdpOtherModeH & gbi.G_TP_MASK) ? 1 : 2;
      triangleBuffer.coords.set(betweenFilterSteps(uv.flat(), coordinateScale));
      state.geometryMode.texture = 1;
      renderer.flushTris(triangleBuffer);
    },
    render(scene, scale, frame) {
      const width = nativeWidth * scale;
      const height = nativeHeight * scale;
      if (renderer.renderTargets.width !== width) {
        const previous = renderer.renderTargets;
        previous.reset();
        previous.deleteTarget(previous.fallback);
        gl.deleteRenderbuffer(previous.depth);
        renderer.renderTargets = new RenderTargets(gl, width, height);
      }
      canvas.width = width;
      canvas.height = height;
      renderer.newFrame();
      gl.disable(gl.DITHER);
      gl.disable(gl.SCISSOR_TEST);
      gl.clearColor(16 / 255, 24 / 255, 40 / 255, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      state.tmem.tmemData.fill(0);
      for (const tile of state.tiles) tile.line = 0;
      h.mode();
      scene.draw(h, frame);
      const error = gl.getError();
      if (error !== gl.NO_ERROR) throw new Error(`${scene.id}: WebGL error ${error}`);

      // Compare framebuffer pixels, never a screenshot scaled by CSS or DPR.
      const bottomUp = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bottomUp);
      if (gl.getError() !== gl.NO_ERROR) throw new Error(`${scene.id}: readPixels failed`);
      const pixels = new Uint8ClampedArray(bottomUp.length);
      for (let y = 0; y < height; y++) {
        const row = (height - 1 - y) * width * 4;
        pixels.set(bottomUp.subarray(row, row + width * 4), y * width * 4);
      }
      return new ImageData(pixels, width, height);
    },
  };
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  h.environment = {
    userAgent: navigator.userAgent,
    gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    webgl: gl.getParameter(gl.VERSION),
    options: gl.getContextAttributes(),
    nativeDimensions: [nativeWidth, nativeHeight],
  };
  return h;
}
