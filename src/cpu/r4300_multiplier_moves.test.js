import { describe, expect, test } from 'bun:test';
import * as decode from './decode.js';
import {
  DEFAULT_PC,
  bitSweepValues64,
  createOpRunner,
  createTestCPU,
  resetGPRsWithSentinel,
} from './test_helpers.js';

const operations = [
  ['MFHI', decode.SPECIAL_MFHI, 'hi', true],
  ['MFLO', decode.SPECIAL_MFLO, 'lo', true],
  ['MTHI', decode.SPECIAL_MTHI, 'hi', false],
  ['MTLO', decode.SPECIAL_MTLO, 'lo', false],
];

const values = bitSweepValues64([
  0n, 1n, 0xffffffffffffffffn, 0x7fffffffn, 0x80000000n,
  0xffffffffn, 0x100000000n, 0xffffffff00000000n,
  0x7fffffffffffffffn, 0x8000000000000000n,
  0x0123456789abcdefn, 0xfedcba9876543210n,
]);

function snapshot(cpu) {
  return { gpr: [...cpu.gprU64], hi: cpu.getMultHiU64(), lo: cpu.getMultLoU64() };
}

for (const compiled of [false, true]) {
  describe(`${compiled ? 'compiled' : 'interpreted'} multiplier register moves`, () => {
    for (const [name, opcode, accumulator, fromAccumulator] of operations) {
      test(`${name} copies all 64 bits and respects register zero without disturbing other registers`, async () => {
        const cpu = await createTestCPU();
        for (let reg = 0; reg < 32; reg++) {
          const run = createOpRunner(compiled, opcode | (reg << (fromAccumulator ? 11 : 21)));
          for (const value of values) {
            resetGPRsWithSentinel(cpu);
            cpu.setMultHiU64(0x0123456789abcdefn);
            cpu.setMultLoU64(0xfedcba9876543210n);
            if (fromAccumulator) {
              if (accumulator === 'hi') {
                cpu.setMultHiU64(value);
              } else {
                cpu.setMultLoU64(value);
              }
            } else {
              cpu.setRegU64(reg, value);
            }
            const expected = snapshot(cpu);
            if (fromAccumulator) {
              if (reg !== 0) {
                expected.gpr[reg] = expected[accumulator];
              }
            } else {
              expected[accumulator] = expected.gpr[reg];
            }
            cpu.pc = DEFAULT_PC;
            cpu.delayPC = null;
            run(cpu);
            expect(snapshot(cpu)).toEqual(expected);
          }
        }
      });
    }

    test('saves a multiply result and restores it after a divide overwrites HI/LO', async () => {
      const cpu = await createTestCPU();
      const left = 0xfedcba9876543210n;
      const right = 0x0123456789abcdefn;
      const product = left * right;
      cpu.setRegU64(4, left);
      cpu.setRegU64(5, right);
      const words = [
        decode.SPECIAL_DMULTU | (4 << 21) | (5 << 16),
        decode.SPECIAL_MFHI | (6 << 11),
        decode.SPECIAL_MFLO | (7 << 11),
        decode.SPECIAL_DDIVU | (4 << 21) | (5 << 16),
        decode.SPECIAL_MFHI | (8 << 11),
        decode.SPECIAL_MFLO | (9 << 11),
        decode.SPECIAL_MTHI | (6 << 21),
        decode.SPECIAL_MTLO | (7 << 21),
      ];
      for (const word of words) {
        cpu.pc = DEFAULT_PC;
        cpu.delayPC = null;
        createOpRunner(compiled, word)(cpu);
      }
      expect(cpu.getRegU64(6)).toBe(product >> 64n);
      expect(cpu.getRegU64(7)).toBe(BigInt.asUintN(64, product));
      expect(cpu.getRegU64(8)).toBe(left % right);
      expect(cpu.getRegU64(9)).toBe(left / right);
      expect(cpu.getMultHiU64()).toBe(product >> 64n);
      expect(cpu.getMultLoU64()).toBe(BigInt.asUintN(64, product));
    });
  });
}
