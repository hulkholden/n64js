import { describe, expect, test } from 'bun:test';
import { GBIMicrocode } from './gbi_microcode.js';
import { RSPState } from '../rsp_state.js';

describe('SetConvert', () => {
  test('decodes signed SetConvert coefficients, including the split K2 field', () => {
    const state = new RSPState();
    const ram = new DataView(new ArrayBuffer(64));
    const ucode = new GBIMicrocode(state, ram);
    const lines = [];
    // The command used by Vigilante 8's intro.
    ucode.executeSetConvert(0xec15fd5d, 0x3b78e42a, { text: line => lines.push(line) });
    expect(Array.from(state.convert)).toEqual([175, -43, -89, 222, 114, 42]);
    expect(lines).toEqual(['gsDPSetConvert(175, -43, -89, 222, 114, 42);']);
    state.reset(ram, 0);
    expect(Array.from(state.convert)).toEqual([175, -43, -89, 222, 114, 42]);
    ucode.executeSetConvert(0xec201000, 0x04020100);
    expect(Array.from(state.convert)).toEqual([-256, -256, 0, -256, -256, -256]);
  });
});
