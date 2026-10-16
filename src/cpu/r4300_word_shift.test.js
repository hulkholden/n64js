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
  0n, 0xffffffffffffffffn, 0x80000000n, 0xffffffffn,
  0xffffffff00000000n, 0x0123456789abcdefn, 0xfedcba9876543210n,
], 64);

const registerAliases = [[2, 4, 5], [4, 4, 5], [5, 4, 5], [4, 4, 4], [2, 4, 4], [0, 4, 5], [2, 0, 5], [2, 4, 0], [0, 0, 0]];

for (const compiled of [false, true]) {
  describe(`${compiled ? 'compiled' : 'interpreted'} arithmetic word shifts`, () => {
    for (const variable of [false, true]) {
      test(`${variable ? 'SRAV' : 'SRA'} matches a full-width shift then word sign extension`, async () => {
        const cpu = await createTestCPU();
        for (const [rd, rt, rs] of registerAliases) {
          for (let shift = 0; shift < 32; shift++) {
            const word = variable ? special(7, rs, rt, rd) : special(3, 0, rt, rd, shift);
            const run = createOpRunner(compiled, word);
            for (const value of values) {
              resetGPRsWithSentinel(cpu);
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
