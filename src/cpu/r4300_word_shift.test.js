import { describe, expect, test } from 'bun:test';
import { createHeadlessEmulator } from '../headless/headless_env.js';
import { Fragment } from './fragments.js';
import { FragmentContext, generateCodeForOp } from './recompiler.js';

const pc = 0x80001000;
const values = [0n, 0xffffffffffffffffn, 0x80000000n, 0xffffffffn,
  0xffffffff00000000n, 0x0123456789abcdefn, 0xfedcba9876543210n];
for (let bit = 0n; bit < 64n; bit++) {
  values.push(1n << bit, BigInt.asUintN(64, ~(1n << bit)));
}
let seed = 0x123456789abcdefn;
for (let i = 0; i < 64; i++) {
  seed = BigInt.asUintN(64, seed * 6364136223846793005n + 1442695040888963407n);
  values.push(seed);
}

for (const compiled of [false, true]) {
  describe(`${compiled ? 'compiled' : 'interpreted'} arithmetic word shifts`, () => {
    for (const variable of [false, true]) {
      test(`${variable ? 'SRAV' : 'SRA'} matches a full-width shift then word sign extension`, async () => {
        const { cpu0: cpu } = await createHeadlessEmulator({
          romBuffer: new ArrayBuffer(0x1000),
          rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' },
        });
        n64js.getSyncFlow = () => null;
        for (const [rd, rt, rs] of [[2, 4, 5], [4, 4, 5], [5, 4, 5], [4, 4, 4], [2, 4, 4], [0, 4, 5], [2, 0, 5], [2, 4, 0], [0, 0, 0]]) {
          for (let shift = 0; shift < 32; shift++) {
            const word = (rt << 16) | (rd << 11) | (variable ? (rs << 21) | 7 : (shift << 6) | 3);
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
              cpu.setRegU64(rt, value);
              // Exercise masking of all bits outside the five-bit shift amount.
              if (variable) {
                const shiftRegister = rs === rt ? value & ~31n : 0xfedcba98ffffffe0n;
                cpu.setRegU64(rs, shiftRegister | BigInt(shift));
              }
              const expected = [...cpu.gprU64];
              const amount = variable ? Number(expected[rs] & 31n) : shift;
              if (rd !== 0) {
                expected[rd] = BigInt.asUintN(64, BigInt.asIntN(32, BigInt.asIntN(64, expected[rt]) >> BigInt(amount)));
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
