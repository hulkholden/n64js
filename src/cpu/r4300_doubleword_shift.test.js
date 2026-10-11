import { describe, expect, test } from 'bun:test';
import { createHeadlessEmulator } from '../headless/headless_env.js';
import { Fragment } from './fragments.js';
import { FragmentContext, generateCodeForOp } from './recompiler.js';

const pc = 0x80001000;
const values = [0n, -1n, 0x80000000n, 0xffffffffn, 0xffffffff00000000n,
  0x0123456789abcdefn, 0xfedcba9876543210n];
for (let bit = 0n; bit < 64n; bit++) {
  values.push(1n << bit, BigInt.asUintN(64, ~(1n << bit)));
}
let seed = 0x123456789abcdefn;
for (let i = 0; i < 64; i++) {
  seed = BigInt.asUintN(64, seed * 6364136223846793005n + 1442695040888963407n);
  values.push(seed);
}

for (const compiled of [false, true]) {
  describe(`${compiled ? 'compiled' : 'interpreted'} doubleword shifts`, () => {
    for (const [name, opcode, variable, bias, left, signed] of [
      ['DSLLV', 0x14, true, 0, true, false], ['DSRLV', 0x16, true, 0, false, false], ['DSRAV', 0x17, true, 0, false, true],
      ['DSLL', 0x38, false, 0, true, false], ['DSRL', 0x3a, false, 0, false, false], ['DSRA', 0x3b, false, 0, false, true],
      ['DSLL32', 0x3c, false, 32, true, false], ['DSRL32', 0x3e, false, 32, false, false], ['DSRA32', 0x3f, false, 32, false, true],
    ]) {
      test(`${name} preserves all source bits for every shift count and register alias`, async () => {
        const { cpu0: cpu } = await createHeadlessEmulator({
          romBuffer: new ArrayBuffer(0x1000), rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' },
        });
        n64js.getSyncFlow = () => null;
        for (const [d, t, s] of [[2, 4, 5], [4, 4, 5], [5, 4, 5], [4, 4, 4], [2, 4, 4], [0, 4, 5], [2, 0, 5], [2, 4, 0], [31, 31, 31], [0, 0, 0]]) {
          for (let shift = 0; shift < (variable ? 64 : 32); shift++) {
            const word = (t << 16) | (d << 11) | (variable ? s << 21 : shift << 6) | opcode;
            let run = () => n64js.executeOp(word);
            if (compiled) {
              const fragment = new Fragment(pc);
              fragment.opsCompiled = 1;
              const ctx = new FragmentContext();
              ctx.set(fragment, pc, word, pc + 4, pc + 4);
              generateCodeForOp(ctx);
              run = new Function('c', fragment.bodyCode);
            }
            for (const value of values) {
              cpu.gprU64.fill(0x13579bdf2468ace0n);
              cpu.gprU64[0] = 0n;
              cpu.setRegU64(t, value);
              if (variable) {
                cpu.setRegU64(s, (s === t ? BigInt.asUintN(64, value) & ~63n : 0xfedcba98ffffffc0n) | BigInt(shift));
              }
              const expected = [...cpu.gprU64];
              const amount = variable ? expected[s] & 63n : BigInt(shift + bias);
              const source = signed ? BigInt.asIntN(64, expected[t]) : expected[t];
              if (d !== 0) {
                expected[d] = BigInt.asUintN(64, left ? source << amount : source >> amount);
              }
              cpu.pc = pc;
              cpu.delayPC = null;
              run(cpu);
              expect([...cpu.gprU64]).toEqual(expected);
            }
          }
        }
      });
    }
  });
}
