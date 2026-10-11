import { describe, expect, test } from 'bun:test';
import { GBIMicrocode } from './gbi_microcode.js';
import { CycleType } from '../gbi.js';
import { RSPState } from '../rsp_state.js';

describe('texture rectangle starting coordinates', () => {
  for (const flip of [false, true]) {
    for (const cycle of [CycleType.G_CYC_1CYCLE, CycleType.G_CYC_2CYCLE, CycleType.G_CYC_COPY]) {
      test(`negative derivatives preserve fractional S/T (flip=${flip}, cycle=${cycle})`, () => {
        const state = new RSPState();
        state.rdpOtherModeH = cycle;
        const microcode = new GBIMicrocode(state, new DataView(new ArrayBuffer(8)));
        const draws = [];
        microcode.renderer = { texRect: (...args) => draws.push(args) };
        const copy = cycle === CycleType.G_CYC_COPY;
        // A 4x8 rectangle at (2,3), starting at S=11.25, T=19.5.
        // Copy mode encodes inclusive screen bounds and a four-pixel S step.
        const cmd0 = ((copy ? 5 : 6) * 4 << 12) | ((copy ? 10 : 11) * 4);
        const cmd1 = (3 << 24) | (8 << 12) | 12;
        const cmd2 = (360 << 16) | 624;
        const cmd3 = ((copy ? -4096 : -1024) << 16) | 0xfc00;
        microcode.rdpTexRect(cmd0, cmd1, cmd2, cmd3, undefined, flip);
        expect(draws).toEqual([[3, 2, 3, 6, 11, 11.25, 19.5,
          flip ? 3.25 : 7.25, flip ? 15.5 : 11.5, flip]]);
      });
    }
  }
});
