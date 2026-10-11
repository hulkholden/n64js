import { describe, expect, test } from 'bun:test';
import { createHeadlessEmulator } from '../headless/headless_env.js';
import { Fragment } from './fragments.js';
import { FragmentContext, generateCodeForOp } from './recompiler.js';

const pc = 0x80001000;
const values = [0n, -1n, 0x80000000n, 0xffffffffn, 0xffffffff00000000n,
  0x7fffffff80000000n, 0x800000007fffffffn, 0x0123456789abcdefn];
for (let bit = 0n; bit < 64n; bit++) {
  values.push(1n << bit, BigInt.asUintN(64, ~(1n << bit)));
}

for (const compiled of [false, true]) {
  describe(`${compiled ? 'compiled' : 'interpreted'} logical immediates`, () => {
    for (const [name, opcode, operation] of [
      ['ANDI', 0x0c, (s, imm) => s & imm],
      ['ORI', 0x0d, (s, imm) => s | imm],
      ['XORI', 0x0e, (s, imm) => s ^ imm],
    ]) {
      test(`${name} zero-extends the immediate and preserves all other register bits`, async () => {
        const { cpu0: cpu } = await createHeadlessEmulator({
          romBuffer: new ArrayBuffer(0x1000), rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' },
        });
        n64js.getSyncFlow = () => null;
        for (const [source, destination] of [[1, 2], [1, 1], [0, 2], [1, 0], [0, 0], [31, 31]]) {
          for (const immediate of [0, 1, 0x7fff, 0x8000, 0xffff, 0x5555, 0xaaaa]) {
            const word = (opcode << 26) | (source << 21) | (destination << 16) | immediate;
            let run = () => n64js.executeOp(word);
            if (compiled) {
              const fragment = new Fragment(pc);
              fragment.opsCompiled = 1;
              const ctx = new FragmentContext();
              ctx.set(fragment, pc, word, pc + 4, pc + 4);
              generateCodeForOp(ctx);
              run = new Function('c', fragment.bodyCode);
            }
            for (const value of values) {
              cpu.gprU64.fill(0x13579bdf2468ace0n);
              cpu.gprU64[0] = 0n;
              cpu.setRegU64(source, value);
              const expected = [...cpu.gprU64];
              if (destination !== 0) {
                expected[destination] = operation(expected[source], BigInt(immediate));
              }
              cpu.pc = pc;
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
