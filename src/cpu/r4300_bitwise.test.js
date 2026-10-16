import { describe, expect, test } from 'bun:test';
import * as decode from './decode.js';
import {
  DEFAULT_PC,
  cartesianPairs,
  createLCG64,
  createOpRunner,
  createTestCPU,
  resetGPRsWithSentinel,
  special,
} from './test_helpers.js';

const operations = [
  ['AND', decode.SPECIAL_AND, (s, t) => s & t],
  ['OR', decode.SPECIAL_OR, (s, t) => s | t],
  ['XOR', decode.SPECIAL_XOR, (s, t) => s ^ t],
  ['NOR', decode.SPECIAL_NOR, (s, t) => ~(s | t)],
];

const registerAliases = [
  [2, 4, 5], [4, 4, 5], [5, 4, 5], [2, 4, 4], [4, 4, 4],
  [0, 4, 5], [2, 0, 5], [2, 4, 0], [2, 0, 0],
  [4, 4, 0], [5, 0, 5], [0, 0, 0],
];

function operandPairs() {
  const values = [
    0n, 1n, 0xffffffffffffffffn,
    0x7fffffffn, 0x80000000n, 0xffffffffn, 0x100000000n,
    0xffffffff00000000n, 0x7fffffffffffffffn, 0x8000000000000000n,
    0x0123456789abcdefn, 0xfedcba9876543210n,
    0xaaaaaaaa55555555n, 0x55555555aaaaaaaan,
  ];
  const pairs = cartesianPairs(values);
  for (let bit = 0n; bit < 64n; bit++) {
    const single = 1n << bit;
    pairs.push([single, single], [single, BigInt.asUintN(64, ~single)]);
  }
  const next = createLCG64(0x9e3779b97f4a7c15n);
  for (let i = 0; i < 256; i++) {
    pairs.push([next(), next()]);
  }
  return pairs;
}

const pairs = operandPairs();

for (const compiled of [false, true]) {
  describe(`${compiled ? 'compiled' : 'interpreted'} 64-bit bitwise operations`, () => {
    for (const [name, opcode, reference] of operations) {
      test(`${name} preserves every bit, aliased operands and register zero`, async () => {
        const cpu = await createTestCPU();
        for (const [rd, rs, rt] of registerAliases) {
          const run = createOpRunner(compiled, special(opcode, rs, rt, rd));
          for (const [s, t] of pairs) {
            resetGPRsWithSentinel(cpu);
            cpu.setRegU64(rs, s);
            cpu.setRegU64(rt, t);
            const expected = [...cpu.gprU64];
            if (rd !== 0) {
              expected[rd] = BigInt.asUintN(64, reference(expected[rs], expected[rt]));
            }
            cpu.pc = DEFAULT_PC;
            cpu.delayPC = null;
            run(cpu);
            expect([...cpu.gprU64]).toEqual(expected);
          }
        }
      });
    }
  });
}
