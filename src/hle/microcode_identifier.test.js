import { describe, expect, test } from 'bun:test';
import { identifyMicrocode, MicrocodeId } from './microcode_identifier.js';

describe('microcode identification', () => {
  test('a hash match takes precedence even when its handler ID is zero', () => {
    const version = 'RSP Gfx ucode S2DEX fifo 2.0';
    const hash = 0x313f038b; // Pilotwings selects GBI0 despite the conflicting string.
    expect(identifyMicrocode(version, hash)).toEqual({
      id: MicrocodeId.GBI0, family: 'GBI0', variant: null, version, hash, detection: 'hash',
    });
  });

  test('uses the version string to identify base families and S2DEX when the hash is unknown', () => {
    for (const [version, id, family, variant] of [
      ['RSP Gfx ucode F3DEX 1.0', MicrocodeId.GBI1, 'GBI1', null],
      ['RSP Gfx ucode F3DEX fifo 2.0', MicrocodeId.GBI2, 'GBI2', null],
      ['RSP Gfx ucode S2DEX 1.0', MicrocodeId.GBI1_SDEX, 'GBI1', 'S2DEX'],
      ['RSP Gfx ucode S2DEX fifo 2.0', MicrocodeId.GBI2_SDEX, 'GBI2', 'S2DEX'],
    ]) {
      expect(identifyMicrocode(version, 0x12345678)).toMatchObject({
        id, family, variant, detection: 'string',
      });
    }
  });

  test('marks empty and unrecognized versions as GBI0 fallbacks', () => {
    for (const version of ['', 'unrecognized microcode']) {
      expect(identifyMicrocode(version, 0)).toMatchObject({
        id: MicrocodeId.GBI0, family: 'GBI0', variant: null, detection: 'fallback',
      });
    }
  });

  test('recognizes Indiana Jones without falling back to a supported GBI family', () => {
    expect(identifyMicrocode('', 0xdd57a04e)).toMatchObject({
      id: MicrocodeId.F5_INDI, family: 'F5', variant: 'INDI', detection: 'hash',
    });
  });
});
