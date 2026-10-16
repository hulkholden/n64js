import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_PC,
  cartesianPairs,
  createLCG64,
  createOpRunner,
  createTestCPU,
  iop,
  resetGPRsWithSentinel,
  special,
} from './test_helpers.js';

const edges = [
  0n, 1n, -1n, 0x7fffn, -0x8000n, 0x7fffffffn, 0x80000000n,
  -0x80000000n, 0xffffffffn, 0x100000000n, -0x100000000n,
  0x7fffffffffffffffn, -0x8000000000000000n,
];
const pairs = cartesianPairs(edges);
const next = createLCG64();
for (let i = 0; i < 512; i++) {
  const seed = next();
  // Alternate equal high words with different high words.
  pairs.push([seed, i & 1 ? seed ^ 0xffffffffn : BigInt.asUintN(64, seed << 17n)]);
}

const registerAliases = [[3, 1, 2], [1, 1, 2], [2, 1, 2], [0, 1, 2], [3, 0, 2], [3, 1, 0], [31, 31, 31], [0, 0, 0]];

for (const compiled of [false, true]) {
  describe(`${compiled ? 'compiled' : 'interpreted'} full-width less-than comparisons`, () => {
    for (const [name, opcode, immediate, unsigned] of [
      ['SLT', 0x2a, false, false],
      ['SLTU', 0x2b, false, true],
      ['SLTI', 0x0a, true, false],
      ['SLTIU', 0x0b, true, true],
    ]) {
      test(`${name} matches independent 64-bit ordering with aliased and zero registers`, async () => {
        const cpu = await createTestCPU();
        for (const [d, s, t] of registerAliases) {
          for (const imm of immediate ? [-32768, -1, 0, 1, 32767] : [0]) {
            const word = immediate ? iop(opcode, s, d, imm) : special(opcode, s, t, d);
            const run = createOpRunner(compiled, word);
            if (compiled) {
              expect(run.code).not.toMatch(/getReg[SU]64/);
            }
            for (const [left, right] of pairs) {
              resetGPRsWithSentinel(cpu);
              cpu.setRegU64(s, left);
              if (!immediate) {
                cpu.setRegU64(t, right);
              }
              const expected = [...cpu.gprU64];
              const asValue = unsigned ? BigInt.asUintN : BigInt.asIntN;
              if (d !== 0) {
                expected[d] = asValue(64, expected[s]) < asValue(64, immediate ? BigInt(imm) : expected[t]) ? 1n : 0n;
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
