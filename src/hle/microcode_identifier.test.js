import { describe, expect, test } from 'bun:test';
import { identifyMicrocode } from './microcode_identifier.js';

describe('microcode identification', () => {
  test('preserves every hash override and gives it precedence over the version string', () => {
    const version = 'RSP Gfx ucode S2DEX fifo 2.0';
    for (const [hash, id, family, variant] of [
      [0x60256efc, 10, 'GBI2', 'CONKER'],
      [0x6d8bec3e, 7, 'GBI1', 'LL'],
      [0x0c10181a, 6, 'GBI0', 'DKR'],
      [0x713311dc, 6, 'GBI0', 'DKR'],
      [0x23f92542, 9, 'GBI0', 'GE'],
      [0x169dcc9d, 6, 'GBI0', 'DKR'],
      [0x26da8a4c, 7, 'GBI1', 'LL'],
      [0xcac47dc4, 11, 'GBI0', 'PD'],
      [0x6cbb521d, 8, 'GBI0', 'SE'],
      [0xdd560323, 7, 'GBI1', 'LL'],
      [0x64cc729d, 5, 'GBI0', 'WR'],
      [0xd73a12c4, 0, 'GBI0', null],
      [0x313f038b, 0, 'GBI0', null],
    ]) {
      expect(identifyMicrocode(version, hash)).toEqual({
        id, family, variant, version, hash, detection: 'hash',
      });
    }
  });

  test('preserves the existing string heuristics for unknown hashes', () => {
    const hash = 0x12345678;
    for (const [version, id, family, variant] of [
      ['RSP Gfx ucode F3DEX 1.0', 1, 'GBI1', null],
      ['RSP Gfx ucode L3DEX 1.0', 1, 'GBI1', null],
      ['RSP Gfx ucode F3DEX fifo 2.0', 2, 'GBI2', null],
      ['RSP Gfx ucode L3DEX fifo 2.0', 2, 'GBI2', null],
      ['RSP Gfx ucode S2DEX 1.0', 3, 'GBI1', 'S2DEX'],
      ['RSP Gfx ucode S2DEX fifo 2.0', 4, 'GBI2', 'S2DEX'],
      ['RSP Gfx ucode F3DEX xbux 2.0', 2, 'GBI2', null],
      ['RSP Gfx ucode S2DEX xbux 2.0', 4, 'GBI2', 'S2DEX'],
      // These cases intentionally retain the old spelling and position rules.
      ['RSP Gfx ucode F3DEX xbus 2.0', 1, 'GBI1', null],
      ['fifo before F3DEX', 1, 'GBI1', null],
      ['xbux before L3DEX', 1, 'GBI1', null],
      ['RSP Gfx ucode F3DEX FIFO 2.0', 1, 'GBI1', null],
    ]) {
      expect(identifyMicrocode(version, hash)).toEqual({
        id, family, variant, version, hash, detection: 'string',
      });
    }
  });

  test('marks empty and unrecognized versions as GBI0 fallbacks', () => {
    for (const version of ['', 'RSP SW Version: 2.0D, 04-01-96', 'unknown fifo', 'f3dex fifo']) {
      expect(identifyMicrocode(version, 0)).toEqual({
        id: 0, family: 'GBI0', variant: null, version, hash: 0, detection: 'fallback',
      });
    }
  });
});
