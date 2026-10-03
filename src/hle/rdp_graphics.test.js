import { describe, expect, test } from 'bun:test';
import { RDPGraphics } from './rdp_graphics.js';
import { NullRenderer } from './null_renderer.js';
import { RSPState } from './rsp_state.js';
import { RDPBuffer } from '../lle/rdp.js';
import { trianglePacket } from '../../tools/rdp_packet_fixtures.js';
import { createHeadlessEmulator } from '../headless/headless_env.js';
import * as gbi from './gbi.js';

function setup() {
  const ram = new DataView(new ArrayBuffer(0x4000));
  const state = new RSPState();
  state.reset(ram, 0);
  const renderer = new NullRenderer(state);
  const processor = new RDPGraphics(state, ram, renderer);
  const command = words => {
    const dv = new DataView(new ArrayBuffer(words.length * 4));
    words.forEach((v, i) => dv.setUint32(i * 4, v));
    processor.execute((words[0] >>> 24) & 63, new RDPBuffer(dv, 0, dv.byteLength));
  };
  return { ram, state, renderer, processor, command };
}

describe('raw RDP graphics', () => {
  test('uses physical image addresses regardless of the last HLE segment table', () => {
    const { state, command, renderer } = setup();
    state.segments[1] = 0x2000;
    state.segments[0] = 0x1000;
    const targets = [];
    renderer.setColorImage = image => targets.push(image);
    command([0xff10013f, 0x01000040]);
    command([0xfd100003, 0x100]);
    command([0xfe000000, 0x01000080]);
    expect(state.colorImage).toEqual({ format: 0, size: 2, width: 320, address: 0x01000040 });
    expect(state.textureImage.address).toBe(0x100);
    expect(state.depthImage.address).toBe(0x01000080);
    expect(targets).toEqual([state.colorImage]);
  });

  test.each([0x24, 0x25])('decodes a four-word rectangle without reading GBI wrappers (%s)', opcode => {
    const { state, renderer, command } = setup();
    state.pc = 0x1234;
    state.rdpOtherModeH = gbi.CycleType.G_CYC_1CYCLE;
    const draws = [];
    renderer.texRect = (...args) => draws.push(args);
    command([(opcode << 24) | (32 << 12) | 16, (2 << 24), (32 << 16) | 64, (1024 << 16) | 2048]);
    expect(state.pc).toBe(0x1234);
    expect(draws).toEqual([[2, 0, 0, 8, 4, 1, 2, opcode === 0x24 ? 9 : 5, opcode === 0x24 ? 10 : 18, opcode === 0x25]]);
  });

  test.each([false, true])('restores screen positions, shade, tile, depth and texture perspective=%s', perspective => {
    const { state, renderer, command } = setup();
    state.rdpOtherModeH = perspective ? gbi.G_TP_MASK : 0;
    let draw;
    renderer.flushTris = (tb, options) => {
      draw = { count: tb.numTris, positions: [...tb.positions.slice(0, tb.numTris * 12)],
        colors: [...tb.colours.slice(0, tb.numTris * 3)], coords: [...tb.coords.slice(0, tb.numTris * 6)], options };
    };
    command(trianglePacket({ tile: 3, zbuffer: true }));
    expect(state.texture.tile).toBe(3);
    expect(state.geometryMode.zbuffer).toBe(1);
    expect(draw.count).toBe(2);
    expect(draw.options).toBeUndefined();
    expect(draw.colors[0]).toBe(0xff000000);
    expect(draw.colors[1]).toBe(0xff000080);
    expect(draw.positions[3]).toBe(perspective ? 2 : 1);
    expect(draw.positions[7]).toBe(perspective ? 4 : 1);
    expect(draw.positions[4] / draw.positions[7]).toBeCloseTo(8 / 160 - 1);
    expect(draw.positions[5] / draw.positions[7]).toBe(1);
    expect(draw.positions[2]).toBe(0); // Z = 1/2 in device depth.
    expect(draw.coords[2]).toBe(perspective ? 8 : 4);
  });

  test('loads texture bytes into persistent TMEM and observes the selected tile at draw time', async () => {
    const { state, ram, renderer, command } = setup();
    const { hardware } = await createHeadlessEmulator({
      romBuffer: new ArrayBuffer(0x1000), rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' },
    });
    const seen = [];
    renderer.onTextureUse = info => seen.push(info);
    ram.setUint32(0x100, 0xf80107c1);
    hardware.ram.u8.set(new Uint8Array(ram.buffer));
    command([0xfd100001, 0x100]); // RGBA16, width 2
    command([0xf5100200, 0]); // RGBA16 tile, line = 1
    command([0xf4000000, 4 << 12]); // LoadTile, two pixels
    expect([...state.tmem.tmemData.slice(0, 4)]).toEqual([0xf8, 1, 7, 0xc1]);
    state.rdpOtherModeH = 0;
    command(trianglePacket());
    expect(seen).toEqual([{ format: 0, size: 2 }]);
    expect(() => command([0x01000000, 0])).toThrow('Unsupported RDP command');
  });
});
