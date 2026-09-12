import { describe, expect, test } from 'bun:test';
import { executeDisplayList } from './display_list.js';
import * as gbi from './gbi.js';
import { GBI1 } from './gbi1.js';
import { NullRenderer } from './null_renderer.js';
import { RSPState } from './rsp_state.js';

describe('NullRenderer', () => {
  test('runs vertex, triangle, clear, and rectangle commands without browser setup', () => {
    const ramDV = new DataView(new ArrayBuffer(0x2000));
    const state = new RSPState();
    state.reset(ramDV, 8);
    state.colorImage.address = 0x1000;
    state.colorImage.size = gbi.ImageSize.G_IM_SIZ_16b;
    state.rdpOtherModeH = gbi.CycleType.G_CYC_FILL;
    const microcode = new GBI1(state, ramDV);
    microcode.renderer = new NullRenderer(state);

    // Load three vertices, then draw enough triangles to cross a batch boundary.
    for (let index = 0; index < 3; index++) {
      ramDV.setInt16(0x800 + index * 16, index === 1 ? 1 : 0);
      ramDV.setInt16(0x800 + index * 16 + 2, index === 2 ? 1 : 0);
      ramDV.setUint32(0x800 + index * 16 + 12, 0xffffffff);
    }
    const commands = [
      [0x04000c00, 0x800], // Load vertices 0–2.
      ...Array.from({ length: microcode.triangleBuffer.maxTris + 1 }, () => [0xbf000000, 0x00000204]),
      [0xf7000000, 0xffff], // Fill colour.
      [0xf6000000 | ((319 * 4) << 12) | (239 * 4), 0], // Full-screen colour clear.
      [0xf6000000 | ((15 * 4) << 12) | (15 * 4), 0], // Partial fill.
      [0xfe000000, 0x1000], // Depth and colour images now coincide.
      [0xf6000000 | ((15 * 4) << 12) | (15 * 4), 0], // Depth clear.
      [0xf5000000 | (gbi.ImageFormat.G_IM_FMT_CI << 21) | (1 << 9), 0], // CI4 tile.
      [0xe4000000 | ((8 * 4) << 12) | (8 * 4), 0], // Texture rectangle and parameters.
      [0xb4000000, 0],
      [0xb3000000, 0x04000400],
      [0xe5000000 | ((8 * 4) << 12) | (8 * 4), 0], // Flipped texture rectangle.
      [0xb4000000, 0],
      [0xb3000000, 0x04000400],
      [0xfa000000, 0x12345678], // State update after the drawing commands.
      [0xb8000000, 0],
    ];
    commands.forEach(([cmd0, cmd1], index) => {
      ramDV.setUint32(8 + index * 8, cmd0);
      ramDV.setUint32(12 + index * 8, cmd1);
    });

    executeDisplayList(state, microcode);

    expect(state.projectedVertices.slice(0, 3).map(vertex => vertex.set)).toEqual([true, true, true]);
    expect(microcode.triangleBuffer.empty()).toBe(true);
    expect(state.tiles[0]).toMatchObject({ format: gbi.ImageFormat.G_IM_FMT_CI, size: gbi.ImageSize.G_IM_SIZ_4b });
    expect(state.primColor).toBe(0x12345678);
    expect(state.nextCommand()).toBe(false);
  });

  test('uses the current VI dimensions and RDP depth source for rectangle vertices', () => {
    const state = new RSPState();
    const renderer = new NullRenderer(state);
    renderer.nativeTransform.initDimensions(640, 480);
    state.primDepth = 0.75;

    for (const source of [gbi.DepthSource.G_ZS_PIXEL, gbi.DepthSource.G_ZS_PRIM]) {
      state.rdpOtherModeL = source;
      const depth = source === gbi.DepthSource.G_ZS_PRIM ? 0.75 : 0;
      expect(renderer.calculateRectVertices(0, 0, 640, 480)).toEqual([
        -1, 1, depth, 1,
        1, 1, depth, 1,
        -1, -1, depth, 1,
        1, -1, depth, 1,
      ]);
    }
  });
});
