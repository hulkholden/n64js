import { describe, expect, test } from 'bun:test';
import { createHeadlessEmulator } from '../headless/headless_env.js';
import * as decode from './decode.js';
import { Fragment } from './fragments.js';
import { FragmentContext, generateCodeForOp } from './recompiler.js';

const pc = 0x80001000;
const operations = [
  ['AND', decode.SPECIAL_AND, (s, t) => s & t],
  ['OR', decode.SPECIAL_OR, (s, t) => s | t],
  ['XOR', decode.SPECIAL_XOR, (s, t) => s ^ t],
  ['NOR', decode.SPECIAL_NOR, (s, t) => ~(s | t)],
];

function operandPairs() {
  const values = [
    0n, 1n, 0xffffffffffffffffn,
    0x7fffffffn, 0x80000000n, 0xffffffffn, 0x100000000n,
    0xffffffff00000000n, 0x7fffffffffffffffn, 0x8000000000000000n,
    0x0123456789abcdefn, 0xfedcba9876543210n,
    0xaaaaaaaa55555555n, 0x55555555aaaaaaaan,
  ];
  const pairs = values.flatMap(s => values.map(t => [s, t]));
  for (let bit = 0n; bit < 64n; bit++) {
    const single = 1n << bit;
    pairs.push([single, single], [single, BigInt.asUintN(64, ~single)]);
  }
  // Deterministic full-width inputs, independent of the implementation's words.
  let seed = 0x9e3779b97f4a7c15n;
  const next = () => seed = BigInt.asUintN(64, seed * 6364136223846793005n + 1442695040888963407n);
  for (let i = 0; i < 256; i++) {
    pairs.push([next(), next()]);
  }
  return pairs;
}

const pairs = operandPairs();

function instruction(compiled, opcode, rd, rs, rt) {
  const word = ((rs << 21) | (rt << 16) | (rd << 11) | opcode) >>> 0;
  if (!compiled) {
    return () => n64js.executeOp(word);
  }
  const fragment = new Fragment(pc);
  fragment.opsCompiled = 1;
  const ctx = new FragmentContext();
  ctx.set(fragment, pc, word, pc + 4, pc + 4);
  generateCodeForOp(ctx);
  return new Function('c', fragment.bodyCode);
}

for (const compiled of [false, true]) {
  describe(`${compiled ? 'compiled' : 'interpreted'} 64-bit bitwise operations`, () => {
    for (const [name, opcode, reference] of operations) {
      test(`${name} preserves every bit, aliased operands and register zero`, async () => {
        const { cpu0: cpu } = await createHeadlessEmulator({
          romBuffer: new ArrayBuffer(0x1000),
          rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' },
        });
        n64js.getSyncFlow = () => null;
        // Distinct registers, every source/destination alias, and zero in each
        // position. OR also exercises the generated move/clear specializations.
        for (const [rd, rs, rt] of [
          [2, 4, 5], [4, 4, 5], [5, 4, 5], [2, 4, 4], [4, 4, 4],
          [0, 4, 5], [2, 0, 5], [2, 4, 0], [2, 0, 0],
          [4, 4, 0], [5, 0, 5], [0, 0, 0],
        ]) {
          const run = instruction(compiled, opcode, rd, rs, rt);
          for (const [s, t] of pairs) {
            cpu.gprU64.fill(0x13579bdf2468ace0n);
            cpu.gprU64[0] = 0n;
            cpu.setRegU64(rs, s);
            cpu.setRegU64(rt, t);
            const expected = [...cpu.gprU64];
            if (rd !== 0) {
              expected[rd] = BigInt.asUintN(64, reference(expected[rs], expected[rt]));
            }
            cpu.pc = pc;
            cpu.delayPC = null;
            run(cpu);
            expect([...cpu.gprU64]).toEqual(expected);
          }
        }
      });
    }
  });
}
