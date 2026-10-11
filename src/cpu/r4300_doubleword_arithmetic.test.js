import { describe, expect, test } from 'bun:test';
import { createHeadlessEmulator } from '../headless/headless_env.js';
import { controlCause } from './cpu0reg.js';
import { Fragment } from './fragments.js';
import { FragmentContext, generateCodeForOp } from './recompiler.js';

const pc = 0x80001000;
const edges = [0n, 1n, -1n, 0x7fffn, -0x8000n, 0x7fffffffn, 0x80000000n,
  0xffffffffn, 0x100000000n, -0x100000000n, 0x7fffffffffffffffn, -0x8000000000000000n];
const pairs = edges.flatMap(s => edges.map(t => [s, t]));
let seed = 0x123456789abcdefn;
for (let i = 0; i < 512; i++) {
  seed = BigInt.asUintN(64, seed * 6364136223846793005n + 1442695040888963407n);
  pairs.push([seed, BigInt.asUintN(64, seed << 17n)]);
}

for (const compiled of [false, true]) {
  describe(`${compiled ? 'compiled' : 'interpreted'} non-trapping doubleword arithmetic`, () => {
    for (const [name, opcode, immediate, subtract] of [
      ['DADDU', 0x2d, false, false], ['DSUBU', 0x2f, false, true], ['DADDIU', 0x19, true, false],
    ]) {
      test(`${name} propagates carries/borrows and wraps at 64 bits`, async () => {
        const { cpu0: cpu } = await createHeadlessEmulator({
          romBuffer: new ArrayBuffer(0x1000), rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' },
        });
        n64js.getSyncFlow = () => null;
        for (const [d, s, t] of [[3, 1, 2], [1, 1, 2], [2, 1, 2], [0, 1, 2], [3, 0, 2], [3, 1, 0], [31, 31, 31], [0, 0, 0]]) {
          for (const imm of immediate ? [-32768, -1, 0, 1, 32767] : [0]) {
            const word = immediate ? (opcode << 26) | (s << 21) | (d << 16) | (imm & 0xffff)
              : (s << 21) | (t << 16) | (d << 11) | opcode;
            let run = () => n64js.executeOp(word);
            if (compiled) {
              const fragment = new Fragment(pc);
              fragment.opsCompiled = 1;
              const ctx = new FragmentContext();
              ctx.set(fragment, pc, word, pc + 4, pc + 4);
              generateCodeForOp(ctx);
              run = new Function('c', fragment.bodyCode);
            }
            for (const [left, right] of pairs) {
              cpu.gprU64.fill(0x13579bdf2468ace0n);
              cpu.gprU64[0] = 0n;
              cpu.setRegU64(s, left);
              if (!immediate) {
                cpu.setRegU64(t, right);
              }
              const expected = [...cpu.gprU64];
              const rhs = immediate ? BigInt(imm) : expected[t];
              if (d !== 0) {
                expected[d] = BigInt.asUintN(64, subtract ? expected[s] - rhs : expected[s] + rhs);
              }
              cpu.pc = pc;
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
      const { cpu0: cpu, hardware } = await createHeadlessEmulator({
        romBuffer: new ArrayBuffer(0x1000), rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' },
      });
      n64js.getSyncFlow = () => null;
      cpu.pc = pc;
      cpu.delayPC = 0x80002000;
      cpu.setRegU64(2, -1n);
      const word = 0x64420001; // DADDIU r2,r2,1
      if (compiled) {
        const fragment = new Fragment(pc);
        fragment.opsCompiled = 1;
        const ctx = new FragmentContext();
        ctx.set(fragment, pc, word, cpu.delayPC, pc + 4);
        generateCodeForOp(ctx);
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
