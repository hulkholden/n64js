import { describe, expect, test } from 'bun:test';
import { GBIMicrocode } from './gbi_microcode.js';
import { RSPState } from './rsp_state.js';
import { getCombinerText } from './shaders.js';

describe('primitive LOD fraction', () => {
  test('SetPrimColor updates the fraction independently of RGBA and preserves it across tasks', () => {
    const state = new RSPState();
    const ram = new DataView(new ArrayBuffer(64));
    const microcode = new GBIMicrocode(state, ram);
    expect(state.primLodFrac).toBe(0);

    // The minimum-level field must not become part of the fraction.
    microcode.executeSetPrimColor(0xfa001b80, 0x12345678);
    expect(state.primColor).toBe(0x12345678);
    expect(state.primLodFrac).toBe(128);
    state.reset(ram, 0);
    expect(state.primLodFrac).toBe(128);

    microcode.executeSetPrimColor(0xfa0000ff, 0x12345678);
    expect(state.primLodFrac).toBe(255);
    microcode.executeSetPrimColor(0xfa000000, 0x12345678);
    expect(state.primLodFrac).toBe(0);
  });

  test('describes the distinct alpha multiplier and subtract input muxes', () => {
    // Ocarina of Time's NTSC name-entry keyboard combiner.
    const keyboard = getCombinerText(0x00ffadff, 0xfffd9238);
    expect(keyboard).toContain('A0 = (Texel1       - Texel0      ) * PrimLODFrac  + Texel0');
    expect(getCombinerText(0x00ffa1ff, 0xfffd9238)).toContain('* LOD_Frac');
    expect(getCombinerText(0x00ffedff, 0xfffd9238)).toContain('A0 = (1            - Texel0');
  });
});
