import { describe, expect, test } from 'bun:test';
import { createHeadlessEmulator } from '../headless/headless_env.js';
import * as decode from './decode.js';
import { Fragment } from './fragments.js';
import { FragmentContext, generateCodeForOp } from './recompiler.js';

const pc = 0x80001000;
const offset = 3;
const values = [0n, 1n, 0xffffffffn, 0x100000000n, 0xffffffff00000000n,
  0xffffffffffffffffn, 0x7fffffffffffffffn, 0x8000000000000000n];
const pairs = values.flatMap(s => values.map(t => [s, t]));
for (let bit = 0n; bit < 64n; bit++) {
  const value = 1n << bit;
  pairs.push([value, value], [value, 0n], [0n, value]);
}

for (const compiled of [false, true]) {
  describe(`${compiled ? 'compiled' : 'interpreted'} full-width branch equality`, () => {
    for (const [name, op, equal, likely] of [
      ['BEQ', decode.OP_BEQ, true, false],
      ['BNE', decode.OP_BNE, false, false],
      ['BEQL', decode.OP_BEQL, true, true],
      ['BNEL', decode.OP_BNEL, false, true],
    ]) {
      test(`${name} compares both words and preserves branch/annulment behavior`, async () => {
        const { cpu0: cpu } = await createHeadlessEmulator({
          romBuffer: new ArrayBuffer(0x1000),
          rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' },
        });
        n64js.getSyncFlow = () => null;
        for (const [s, t] of [[4, 5], [4, 4], [4, 0], [0, 5], [0, 0]]) {
          const word = ((op << 26) | (s << 21) | (t << 16) | offset) >>> 0;
          let run = () => n64js.executeOp(word);
          if (compiled) {
            const fragment = new Fragment(pc);
            fragment.opsCompiled = 1;
            const ctx = new FragmentContext();
            ctx.set(fragment, pc, word, pc + 4, pc + 4);
            generateCodeForOp(ctx);
            run = new Function('c', fragment.bodyCode);
          }
          for (const [left, right] of pairs) {
            cpu.setRegU64(s, left);
            cpu.setRegU64(t, right);
            const before = [...cpu.gprU64];
            const taken = (before[s] === before[t]) === equal;
            cpu.pc = pc;
            cpu.nextPC = pc + 4;
            cpu.delayPC = null;
            cpu.branchTarget = null;
            run(cpu);
            const target = taken ? pc + 4 + offset * 4 : likely ? null : pc + 8;
            expect(compiled ? cpu.delayPC : cpu.branchTarget).toBe(target);
            expect(compiled ? cpu.pc : cpu.nextPC).toBe(pc + (likely && !taken ? 8 : 4));
            expect([...cpu.gprU64]).toEqual(before);
          }
        }
      });
    }
  });
}
