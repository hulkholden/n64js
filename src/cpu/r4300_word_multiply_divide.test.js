import { describe, expect, test } from 'bun:test';
import { createHeadlessEmulator } from '../headless/headless_env.js';
import { Fragment } from './fragments.js';
import { FragmentContext, generateCodeForOp } from './recompiler.js';

const pc = 0x80001000;
const edges = [0n, 1n, 2n, -1n, -2n, 0x7fffffffn, 0x80000000n, 0xffffffffn,
  0xffffn, 0x10000n, 0xffff0000n, 0x100000000n, 0x1234567880000000n];
const pairs = edges.flatMap(s => edges.map(t => [s, t]));
let seed = 0x123456789abcdefn;
for (let i = 0; i < 2048; i++) {
  seed = BigInt.asUintN(64, seed * 6364136223846793005n + 1442695040888963407n);
  pairs.push([seed, BigInt.asUintN(64, seed * 0xfedcba987654321n)]);
}

for (const compiled of [false, true]) {
  describe(`${compiled ? 'compiled' : 'interpreted'} word multiplication and division`, () => {
    for (const [name, opcode, multiply, signed] of [
      ['MULTU', 0x19, true, false], ['DIV', 0x1a, false, true], ['DIVU', 0x1b, false, false],
    ]) {
      test(`${name} matches full-precision results and sign-extends both HI and LO`, async () => {
        const { cpu0: cpu } = await createHeadlessEmulator({
          romBuffer: new ArrayBuffer(0x1000), rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' },
        });
        n64js.getSyncFlow = () => null;
        for (const [s, t] of [[1, 2], [1, 1], [0, 2], [1, 0], [0, 0], [31, 31]]) {
          const word = (s << 21) | (t << 16) | opcode;
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
            cpu.gprU64.fill(0x13579bdf2468ace0n);
            cpu.gprU64[0] = 0n;
            cpu.setRegU64(s, left);
            cpu.setRegU64(t, right);
            cpu.setMultHiU64(0x0123456789abcdefn);
            cpu.setMultLoU64(0xfedcba9876543210n);
            const expectedGPR = [...cpu.gprU64];
            const asValue = signed ? BigInt.asIntN : BigInt.asUintN;
            const lhs = asValue(32, expectedGPR[s]), rhs = asValue(32, expectedGPR[t]);
            const product = lhs * rhs;
            const lo = multiply ? product : rhs !== 0n ? lhs / rhs : signed && lhs < 0n ? 1n : -1n;
            const hi = multiply ? product >> 32n : rhs !== 0n ? lhs % rhs : lhs;
            cpu.pc = pc;
            cpu.delayPC = null;
            run(cpu);
            expect(cpu.getMultLoS64()).toBe(BigInt.asIntN(32, lo));
            expect(cpu.getMultHiS64()).toBe(BigInt.asIntN(32, hi));
            expect([...cpu.gprU64]).toEqual(expectedGPR);
          }
        }
      });
    }
  });
}
