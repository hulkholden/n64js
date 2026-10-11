import { describe, expect, test } from 'bun:test';
import { getCombinerText } from './shaders.js';

describe('combiner descriptions', () => {
  test('describes the distinct alpha multiplier and subtract input muxes', () => {
    // Ocarina of Time's NTSC name-entry keyboard combiner.
    const keyboard = getCombinerText(0x00ffadff, 0xfffd9238);
    expect(keyboard).toContain('A0 = (Texel1       - Texel0      ) * PrimLODFrac  + Texel0');
    expect(getCombinerText(0x00ffa1ff, 0xfffd9238)).toContain('* LOD_Frac');
    expect(getCombinerText(0x00ffedff, 0xfffd9238)).toContain('A0 = (1            - Texel0');
  });
});
