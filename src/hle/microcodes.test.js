import { describe, expect, spyOn, test } from 'bun:test';
import '../headless_env.js';
import { GBI0, GBI0GE, GBI0PD, GBI0SE, GBI0WR } from './gbi0.js';
import { GBI0DKR } from './gbi0_dkr.js';
import { GBI1, GBI1LL } from './gbi1.js';
import { GBI2, GBI2Conker } from './gbi2.js';
import { GBI1SDEX, GBI2SDEX } from './gbi_s2dex.js';
import { graphicsOptions } from './graphics_options.js';
import { create } from './microcodes.js';
import { RSPState } from './rsp_state.js';

describe('microcode construction', () => {
  test('selects every existing handler and preserves the version and state', () => {
    const log = spyOn(console, 'log').mockImplementation(() => {});
    try {
      for (const [version, hash, Handler] of [
        ['', 0, GBI0],
        ['F3DEX', 0, GBI1],
        ['F3DEX fifo', 0, GBI2],
        ['S2DEX', 0, GBI1SDEX],
        ['S2DEX fifo', 0, GBI2SDEX],
        ['F3DEX fifo', 0x64cc729d, GBI0WR],
        ['F3DEX fifo', 0x0c10181a, GBI0DKR],
        ['F3DEX fifo', 0x6d8bec3e, GBI1LL],
        ['F3DEX fifo', 0x6cbb521d, GBI0SE],
        ['F3DEX fifo', 0x23f92542, GBI0GE],
        ['F3DEX fifo', 0x60256efc, GBI2Conker],
        ['F3DEX fifo', 0xcac47dc4, GBI0PD],
      ]) {
        const state = new RSPState();
        const ramDV = new DataView(new ArrayBuffer(0x1000));
        const task = {
          detectVersionString: () => version,
          computeMicrocodeHash: () => hash,
        };
        const microcode = create(task, state, ramDV);
        expect(microcode.constructor).toBe(Handler);
        expect(microcode.version).toBe(version);
        expect(microcode.state).toBe(state);
        expect(microcode.ramDV).toBe(ramDV);
      }
    } finally {
      log.mockRestore();
    }
  });

  test('keeps one-shot code dumping and deduplicated numeric-ID logging in the factory', () => {
    const log = spyOn(console, 'log').mockImplementation(() => {});
    const previousOptions = { ...graphicsOptions };
    try {
      graphicsOptions.dumpMicrocode = true;
      graphicsOptions.dumpMicrocodeSubstring = 'factory dump test';
      const version = 'RSP factory dump test';
      const calls = [];
      const task = {
        detectVersionString: () => { calls.push('version'); return version; },
        computeMicrocodeHash: () => { calls.push('hash'); return 0x60256efc; },
        dumpCode: () => { calls.push('dump'); },
      };
      const state = new RSPState();
      const ramDV = new DataView(new ArrayBuffer(0x1000));
      create(task, state, ramDV);
      create(task, state, ramDV);

      expect(calls).toEqual(['version', 'dump', 'hash', 'version', 'hash']);
      expect(graphicsOptions.dumpMicrocode).toBe(false);
      expect(log).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith(`New RSP graphics ucode seen: ${version} = ucode 10`);
    } finally {
      Object.assign(graphicsOptions, previousOptions);
      log.mockRestore();
    }
  });
});
