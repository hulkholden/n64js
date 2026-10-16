import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_PC,
  bitSweepValues64,
  createOpRunner,
  createTestCPU,
  resetGPRsWithSentinel,
  special,
} from './test_helpers.js';

const values = bitSweepValues64([
  0n, -1n, 0x80000000n, 0xffffffffn, 0xffffffff00000000n,
  0x0123456789abcdefn, 0xfedcba9876543210n,
], 64);

const shiftOps = [
  ['DSLLV', 0x14, true, 0, true, false],
  ['DSRLV', 0x16, true, 0, false, false],
  ['DSRAV', 0x17, true, 0, false, true],
  ['DSLL', 0x38, false, 0, true, false],
  ['DSRL', 0x3a, false, 0, false, false],
  ['DSRA', 0x3b, false, 0, false, true],
  ['DSLL32', 0x3c, false, 32, true, false],
  ['DSRL32', 0x3e, false, 32, false, false],
  ['DSRA32', 0x3f, false, 32, false, true],
];

const registerAliases = [
  [2, 4, 5], [4, 4, 5], [5, 4, 5], [4, 4, 4], [2, 4, 4],
  [0, 4, 5], [2, 0, 5], [2, 4, 0], [31, 31, 31], [0, 0, 0],
];

for (const compiled of [false, true]) {
  describe(`${compiled ? 'compiled' : 'interpreted'} doubleword shifts`, () => {
    for (const [name, opcode, variable, bias, left, signed] of shiftOps) {
      test(`${name} preserves all source bits for every shift count and register alias`, async () => {
        const cpu = await createTestCPU();
        for (const [d, t, s] of registerAliases) {
          for (let shift = 0; shift < (variable ? 64 : 32); shift++) {
            const word = variable ? special(opcode, s, t, d) : special(opcode, 0, t, d, shift);
            const run = createOpRunner(compiled, word);
            for (const value of values) {
              resetGPRsWithSentinel(cpu);
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
              cpu.pc = DEFAULT_PC;
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
