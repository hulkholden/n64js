import { expect, test } from 'bun:test';
import { create } from './microcodes.js';
import { RSPState } from './rsp_state.js';

test('microcode loads select NoN clipping and restore ordinary clipping', () => {
  const state = new RSPState();
  const ram = new DataView(new ArrayBuffer(4096));
  for (const [version, noNearClipping] of [
    ['RSP Gfx ucode F3DEX.NoN     1.21 Yoshitaka Yasumoto Nintendo.', true],
    ['RSP Gfx ucode F3DEX 1.23', false],
    ['RSP Gfx ucode F3DEX.NoN fifo 2.08', true],
    ['RSP Gfx ucode F3DEX fifo 2.08', false],
  ]) {
    create({ detectVersionString: () => version, computeMicrocodeHash: () => 0 }, state, ram);
    expect(state.noNearClipping).toBe(noNearClipping);
  }
  state.noNearClipping = true;
  state.reset(ram, 0);
  expect(state.noNearClipping).toBe(false);
});
