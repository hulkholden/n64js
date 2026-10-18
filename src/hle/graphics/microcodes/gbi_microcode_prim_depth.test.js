import { describe, expect, test } from 'bun:test';
import { GBIMicrocode } from './gbi_microcode.js';
import { RSPState } from '../rsp_state.js';

describe('primitive depth register', () => {
  test('masks the high Z bit, retains all delta-Z bits, and persists across RSP tasks', () => {
    const state = new RSPState();
    const ram = new DataView(new ArrayBuffer(64));
    const microcode = new GBIMicrocode(state, ram);
    expect(state.primDepth).toBe(0);
    expect(state.primDeltaZ).toBe(0);

    microcode.executeSetPrimDepth(0xee000000, 0xffffabcd);
    expect(state.primDepth).toBe(0x7fff);
    expect(state.primDeltaZ).toBe(0xabcd);
    state.reset(ram, 0);
    expect(state.primDepth).toBe(0x7fff);
    expect(state.primDeltaZ).toBe(0xabcd);

    microcode.executeSetPrimDepth(0xee000000, 0x80000000);
    expect(state.primDepth).toBe(0);
    expect(state.primDeltaZ).toBe(0);
  });
});
