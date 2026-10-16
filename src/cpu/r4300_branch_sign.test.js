import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_PC,
  bitSweepValues64,
  compileOps,
  createOpRunner,
  createTestCPU,
  createTestEmulator,
  resetGPRsWithSentinel,
} from './test_helpers.js';

const cases = [
  ['BLTZ', 0x04000000, v => v < 0n, false, false],
  ['BGEZ', 0x04010000, v => v >= 0n, false, false],
  ['BLTZL', 0x04020000, v => v < 0n, true, false],
  ['BGEZL', 0x04030000, v => v >= 0n, true, false],
  ['BLEZ', 0x18000000, v => v <= 0n, false, false],
  ['BGTZ', 0x1c000000, v => v > 0n, false, false],
  ['BLEZL', 0x58000000, v => v <= 0n, true, false],
  ['BGTZL', 0x5c000000, v => v > 0n, true, false],
  ['BLTZAL', 0x04100000, v => v < 0n, false, true],
  ['BGEZAL', 0x04110000, v => v >= 0n, false, true],
  ['BLTZALL', 0x04120000, v => v < 0n, true, true],
  ['BGEZALL', 0x04130000, v => v >= 0n, true, true],
];

const values = bitSweepValues64([
  0n, 1n, -1n, 0x7fffffffn, 0x80000000n, 0xffffffffn,
  0x100000000n, 0xffffffff00000000n, 0x7fffffffffffffffn, 0x8000000000000000n,
], 128);

for (const compiled of [false, true]) {
  describe(`${compiled ? 'compiled' : 'interpreted'} sign branches`, () => {
    for (const [name, opcode, condition, likely, link] of cases) {
      test(`${name}: full-width values, zero/RA sources, links, annulment and pending delays`, async () => {
        const cpu = await createTestCPU();
        for (const source of [0, 4, 31]) {
          for (const offset of [-32768, -1, 0, 3, 32767]) {
            const instruction = (opcode | (source << 21) | (offset & 0xffff)) >>> 0;
            const run = createOpRunner(compiled, instruction);
            for (const delayPC of [null, 0x80002000]) {
              for (const value of values) {
                resetGPRsWithSentinel(cpu, 0x123456789abcdef0n);
                cpu.setRegU64(source, value);
                const expected = [...cpu.gprU64];
                const taken = condition(BigInt.asIntN(64, expected[source]));
                const nextPC = delayPC ?? DEFAULT_PC + 4;
                if (link) {
                  expected[31] = BigInt.asUintN(64, BigInt((nextPC + 4) | 0));
                }
                cpu.pc = DEFAULT_PC;
                cpu.nextPC = nextPC;
                cpu.delayPC = delayPC;
                cpu.branchTarget = null;
                run(cpu);
                expect([...cpu.gprU64]).toEqual(expected);
                expect(compiled ? cpu.delayPC : cpu.branchTarget).toBe(
                  taken ? DEFAULT_PC + 4 + offset * 4 : likely ? null : DEFAULT_PC + 8,
                );
                expect(compiled ? cpu.pc : cpu.nextPC).toBe(nextPC + (likely && !taken ? 4 : 0));
              }
            }
          }
        }
      });
    }
  });
}

describe('compiled sign branch width proofs', () => {
  for (const [loadName, opcode, signed] of [['LW', 0x8c000000, true], ['LWU', 0x9c000000, false]]) {
    for (const [name, branch, condition, likely] of cases.filter(([name]) => /^(BLEZ|BGTZ)L?$/.test(name))) {
      test(`compiled ${loadName}/${name} preserves signed versus unsigned width proofs`, async () => {
        const { cpu0: cpu, hardware } = await createTestEmulator();
        const fragment = compileOps([
          (opcode | (20 << 21) | (4 << 16)) >>> 0,
          (branch | (4 << 21) | 3) >>> 0,
        ]);
        const run = new Function('c', fragment.bodyCode);
        for (const word of [0, 1, 0x7fffffff, 0x80000000, 0xffffffff]) {
          cpu.setRegS32Extend(20, 0x80002000);
          hardware.ram.set32(0x2000, word);
          cpu.pc = DEFAULT_PC;
          cpu.delayPC = null;
          cpu.stuffToDo = 0;
          const value = signed ? BigInt(word | 0) : BigInt(word);
          const taken = condition(value);
          run(cpu);
          expect(cpu.getRegS64(4)).toBe(value);
          expect(cpu.delayPC).toBe(taken ? DEFAULT_PC + 20 : likely ? null : DEFAULT_PC + 12);
          expect(cpu.pc).toBe(DEFAULT_PC + (likely && !taken ? 12 : 8));
        }
      });
    }
  }
});
