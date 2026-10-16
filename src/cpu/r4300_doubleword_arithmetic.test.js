import { describe, expect, test } from 'bun:test';
import { controlCause } from './cpu0reg.js';
import {
  DEFAULT_PC,
  cartesianPairs,
  compileOp,
  createLCG64,
  createOpRunner,
  createTestCPU,
  createTestEmulator,
  iop,
  resetGPRsWithSentinel,
  special,
} from './test_helpers.js';

const edges = [
  0n, 1n, -1n, 0x7fffn, -0x8000n, 0x7fffffffn, 0x80000000n,
  0xffffffffn, 0x100000000n, -0x100000000n, 0x7fffffffffffffffn, -0x8000000000000000n,
];
const pairs = cartesianPairs(edges);
const next = createLCG64();
for (let i = 0; i < 512; i++) {
  const seed = next();
  pairs.push([seed, BigInt.asUintN(64, seed << 17n)]);
}

const registerAliases = [[3, 1, 2], [1, 1, 2], [2, 1, 2], [0, 1, 2], [3, 0, 2], [3, 1, 0], [31, 31, 31], [0, 0, 0]];

for (const compiled of [false, true]) {
  describe(`${compiled ? 'compiled' : 'interpreted'} non-trapping doubleword arithmetic`, () => {
    for (const [name, opcode, immediate, subtract] of [
      ['DADDU', 0x2d, false, false],
      ['DSUBU', 0x2f, false, true],
      ['DADDIU', 0x19, true, false],
    ]) {
      test(`${name} propagates carries/borrows and wraps at 64 bits`, async () => {
        const cpu = await createTestCPU();
        for (const [d, s, t] of registerAliases) {
          for (const imm of immediate ? [-32768, -1, 0, 1, 32767] : [0]) {
            const word = immediate ? iop(opcode, s, d, imm) : special(opcode, s, t, d);
            const run = createOpRunner(compiled, word);
            for (const [left, right] of pairs) {
              resetGPRsWithSentinel(cpu);
              cpu.setRegU64(s, left);
              if (!immediate) {
                cpu.setRegU64(t, right);
              }
              const expected = [...cpu.gprU64];
              const rhs = immediate ? BigInt(imm) : expected[t];
              if (d !== 0) {
                expected[d] = BigInt.asUintN(64, subtract ? expected[s] - rhs : expected[s] + rhs);
              }
              cpu.pc = DEFAULT_PC;
              cpu.delayPC = null;
              cpu.setControlU32(controlCause, 0);
              run(cpu);
              expect([...cpu.gprU64]).toEqual(expected);
              expect(cpu.getControlU32(controlCause)).toBe(0);
            }
          }
        }
      });
    }

    test('wrapping DADDIU in a branch delay slot preserves the branch target', async () => {
      const { cpu0: cpu, hardware } = await createTestEmulator();
      cpu.pc = DEFAULT_PC;
      cpu.delayPC = 0x80002000;
      cpu.setRegU64(2, -1n);
      const word = 0x64420001; // DADDIU r2,r2,1
      if (compiled) {
        const fragment = compileOp(word, { postPC: cpu.delayPC, nextPC: DEFAULT_PC + 4 });
        new Function('c', fragment.bodyCode)(cpu);
      } else {
        hardware.ram.set32(0x1000, word);
        cpu.run(1);
      }
      expect(cpu.getRegU64(2)).toBe(0n);
      expect(cpu.pc).toBe(0x80002000);
      expect(cpu.delayPC).toBeNull();
    });
  });
}
