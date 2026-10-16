import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_PC,
  bitSweepValues64,
  createOpRunner,
  createTestCPU,
  iop,
  resetGPRsWithSentinel,
} from './test_helpers.js';

const values = bitSweepValues64([
  0n, -1n, 0x80000000n, 0xffffffffn, 0xffffffff00000000n,
  0x7fffffff80000000n, 0x800000007fffffffn, 0x0123456789abcdefn,
]);

for (const compiled of [false, true]) {
  describe(`${compiled ? 'compiled' : 'interpreted'} logical immediates`, () => {
    for (const [name, opcode, operation] of [
      ['ANDI', 0x0c, (s, imm) => s & imm],
      ['ORI', 0x0d, (s, imm) => s | imm],
      ['XORI', 0x0e, (s, imm) => s ^ imm],
    ]) {
      test(`${name} zero-extends the immediate and preserves all other register bits`, async () => {
        const cpu = await createTestCPU();
        for (const [source, destination] of [[1, 2], [1, 1], [0, 2], [1, 0], [0, 0], [31, 31]]) {
          for (const immediate of [0, 1, 0x7fff, 0x8000, 0xffff, 0x5555, 0xaaaa]) {
            const run = createOpRunner(compiled, iop(opcode, source, destination, immediate));
            for (const value of values) {
              resetGPRsWithSentinel(cpu);
              cpu.setRegU64(source, value);
              const expected = [...cpu.gprU64];
              if (destination !== 0) {
                expected[destination] = operation(expected[source], BigInt(immediate));
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
