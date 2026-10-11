import { executeDisplayList } from '../src/hle/graphics/display_list.js';
import * as gbi from '../src/hle/graphics/gbi.js';
import { GBI2Conker } from '../src/hle/graphics/microcodes/gbi2_conker.js';
import { CLEAR, WHITE, assertPixels, createWebGLHarness, loadTestTexture, testTexture } from './webgl_test_helpers.js';

export function runConkerTests(gl) {
  const { ram, state, renderer, microcode, resetFrame } = createWebGLHarness(gl, {
    Microcode: GBI2Conker,
  });
  state.viewport.transform = renderer.nativeTransform.viTransform;
  state.rdpOtherModeH = gbi.TexturePerspective.G_TP_PERSP;
  state.rdpOtherModeL = 0;
  microcode.executeTexture(0xd7000002, 0xffffffff);
  // TEXEL0 * SHADE keeps both vertex attributes active.
  state.combine.hi = (1 << 20) | (4 << 15) | (1 << 12) | (4 << 9);
  state.combine.lo = ((15 << 28) | (7 << 15) | (7 << 12) | (7 << 9)) >>> 0;
  const tile = state.tiles[0];
  tile.set(gbi.ImageFormat.G_IM_FMT_RGBA, gbi.ImageSize.G_IM_SIZ_32b, 1, 0, 0, 2, 0, 0, 2, 0, 0);
  tile.setSize(0, 0, 0, 0);
  loadTestTexture(state, tile, testTexture(1, 1, [WHITE]));

  // Literal packets encode (0,1,2) in each TRI4 slot, with degenerate padding.
  // Compare against the inherited commands under real GPU culling. Decoder
  // index assertions alone missed the mismatch in the initial implementation.
  const packets = [
    ['TRI1', 0x05000204, 0],
    ['TRI2', 0x06000204, 0],
    ['QUAD', 0x07000204, 0],
    ['TRI4 slot 0', 0x10040000, 0x80000000],
    ['TRI4 slot 1', 0x10000022, 0],
    ['TRI4 slot 2', 0x10000000, 0x00110000],
    ['TRI4 slot 3', 0x10000000, 0x00000022],
  ];
  const lines = [];
  for (const mirrored of [false, true]) {
    const points = [[-1, -1], [3, -1], [-1, 3]];
    points.forEach(([x, y], i) => {
      const offset = 0x100 + i * 16;
      ram.setInt16(offset, mirrored ? y : x);
      ram.setInt16(offset + 2, mirrored ? x : y);
      ram.setUint32(offset + 12, 0xffffffff);
    });
    // Literal F3DEX2 wire bits: back = 0x400, front = 0x200. The shared
    // GBI2 implementation internally swaps both winding and cull flags.
    for (const [name, cull, visible] of [
      ['back', 0x400, !mirrored], ['front', 0x200, mirrored], ['off', 0, true],
    ]) {
      for (const [packetName, cmd0, cmd1] of packets) {
        for (const debug of [false, true]) {
          const commands = [
            [0xd9000000, 0x00200000 | cull],
            [0x01003006, 0x100],
            [cmd0, cmd1],
            [0xdf000000, 0],
          ];
          commands.forEach(([a, b], i) => {
            ram.setUint32(8 + i * 8, a);
            ram.setUint32(12 + i * 8, b);
          });
          state.pc = 8;
          resetFrame([0, 0, 0, 0]);
          const disassembler = debug ? { begin() {}, end() {}, text() {}, tip() {} } : null;
          executeDisplayList(state, microcode, { disassembler });
          const label = `Conker ${packetName}: cull ${name}, mirrored=${mirrored}, disassembly=${debug}`;
          assertPixels(gl, { expected: [visible ? WHITE : CLEAR], label });
          lines.push(`PASS ${label}`);
        }
      }
    }
  }
  return lines;
}
