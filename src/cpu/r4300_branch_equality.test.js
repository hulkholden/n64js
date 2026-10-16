import { describe, expect, test } from 'bun:test';
import * as decode from './decode.js';
import {
  DEFAULT_PC,
  cartesianPairs,
  createOpRunner,
  createTestCPU,
  iop,
} from './test_helpers.js';

const offset = 3;
const values = [
  0n, 1n, 0xffffffffn, 0x100000000n, 0xffffffff00000000n,
  0xffffffffffffffffn, 0x7fffffffffffffffn, 0x8000000000000000n,
];
const pairs = cartesianPairs(values);
for (let bit = 0n; bit < 64n; bit++) {
  const value = 1n << bit;
  pairs.push([value, value], [value, 0n], [0n, value]);
}

const branches = [
  ['BEQ', decode.OP_BEQ, true, false],
  ['BNE', decode.OP_BNE, false, false],
  ['BEQL', decode.OP_BEQL, true, true],
  ['BNEL', decode.OP_BNEL, false, true],
];

for (const compiled of [false, true]) {
  describe(`${compiled ? 'compiled' : 'interpreted'} full-width branch equality`, () => {
    for (const [name, op, equal, likely] of branches) {
      test(`${name} compares both words and preserves branch/annulment behavior`, async () => {
        const cpu = await createTestCPU();
        for (const [s, t] of [[4, 5], [4, 4], [4, 0], [0, 5], [0, 0]]) {
          const run = createOpRunner(compiled, iop(op, s, t, offset));
          for (const [left, right] of pairs) {
            cpu.setRegU64(s, left);
            cpu.setRegU64(t, right);
            const before = [...cpu.gprU64];
            const taken = (before[s] === before[t]) === equal;
            cpu.pc = DEFAULT_PC;
            cpu.nextPC = DEFAULT_PC + 4;
            cpu.delayPC = null;
            cpu.branchTarget = null;
            run(cpu);
            const target = taken ? DEFAULT_PC + 4 + offset * 4 : likely ? null : DEFAULT_PC + 8;
            expect(compiled ? cpu.delayPC : cpu.branchTarget).toBe(target);
            expect(compiled ? cpu.pc : cpu.nextPC).toBe(DEFAULT_PC + (likely && !taken ? 8 : 4));
            expect([...cpu.gprU64]).toEqual(before);
          }
        }
      });
    }
  });
}
