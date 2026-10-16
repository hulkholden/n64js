import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_PC,
  cartesianPairs,
  createLCG64,
  createOpRunner,
  createTestCPU,
  resetGPRsWithSentinel,
  special,
} from './test_helpers.js';

const edges = [
  0n, 1n, 2n, -1n, -2n, 0x7fffffffn, 0x80000000n, 0xffffffffn,
  0xffffn, 0x10000n, 0xffff0000n, 0x100000000n, 0x1234567880000000n,
];
const pairs = cartesianPairs(edges);
const next = createLCG64();
for (let i = 0; i < 2048; i++) {
  const seed = next();
  pairs.push([seed, BigInt.asUintN(64, seed * 0xfedcba987654321n)]);
}

for (const compiled of [false, true]) {
  describe(`${compiled ? 'compiled' : 'interpreted'} word multiplication and division`, () => {
    for (const [name, opcode, multiply, signed] of [
      ['MULTU', 0x19, true, false],
      ['DIV', 0x1a, false, true],
      ['DIVU', 0x1b, false, false],
    ]) {
      test(`${name} matches full-precision results and sign-extends both HI and LO`, async () => {
        const cpu = await createTestCPU();
        for (const [s, t] of [[1, 2], [1, 1], [0, 2], [1, 0], [0, 0], [31, 31]]) {
          const run = createOpRunner(compiled, special(opcode, s, t, 0));
          for (const [left, right] of pairs) {
            resetGPRsWithSentinel(cpu);
            cpu.setRegU64(s, left);
            cpu.setRegU64(t, right);
            cpu.setMultHiU64(0x0123456789abcdefn);
            cpu.setMultLoU64(0xfedcba9876543210n);
            const expectedGPR = [...cpu.gprU64];
            const asValue = signed ? BigInt.asIntN : BigInt.asUintN;
            const lhs = asValue(32, expectedGPR[s]);
            const rhs = asValue(32, expectedGPR[t]);
            const product = lhs * rhs;
            const lo = multiply ? product : rhs !== 0n ? lhs / rhs : signed && lhs < 0n ? 1n : -1n;
            const hi = multiply ? product >> 32n : rhs !== 0n ? lhs % rhs : lhs;
            cpu.pc = DEFAULT_PC;
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
