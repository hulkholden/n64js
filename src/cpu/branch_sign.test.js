import { describe, expect, test } from 'bun:test';
import { createHeadlessEmulator } from '../headless/headless_env.js';
import { Fragment } from './fragments.js';
import { FragmentContext, generateCodeForOp } from './recompiler.js';

const pc = 0x80001000;
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
const values = [0n, 1n, -1n, 0x7fffffffn, 0x80000000n, 0xffffffffn,
  0x100000000n, 0xffffffff00000000n, 0x7fffffffffffffffn, 0x8000000000000000n];
for (let bit = 0n; bit < 64n; bit++) {
  values.push(1n << bit, BigInt.asUintN(64, ~(1n << bit)));
}
let seed = 0x123456789abcdefn;
for (let i = 0; i < 128; i++) {
  seed = BigInt.asUintN(64, seed * 6364136223846793005n + 1442695040888963407n);
  values.push(seed);
}

for (const compiled of [false, true]) {
  describe(`${compiled ? 'compiled' : 'interpreted'} sign branches`, () => {
    for (const [name, opcode, condition, likely, link] of cases) {
      test(`${name}: full-width values, zero/RA sources, links, annulment and pending delays`, async () => {
        const { cpu0: cpu } = await createHeadlessEmulator({
          romBuffer: new ArrayBuffer(0x1000),
          rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' },
        });
        n64js.getSyncFlow = () => null;
        for (const source of [0, 4, 31]) {
          for (const offset of [-32768, -1, 0, 3, 32767]) {
            const instruction = (opcode | (source << 21) | (offset & 0xffff)) >>> 0;
            let run = () => n64js.executeOp(instruction);
            if (compiled) {
              const fragment = new Fragment(pc);
              fragment.opsCompiled = 1;
              const ctx = new FragmentContext();
              ctx.set(fragment, pc, instruction, pc + 4, pc + 4);
              generateCodeForOp(ctx);
              run = new Function('c', fragment.bodyCode);
            }
            for (const delayPC of [null, 0x80002000]) {
              for (const value of values) {
                cpu.gprU64.fill(0x123456789abcdef0n);
                cpu.gprU64[0] = 0n;
                cpu.setRegU64(source, value);
                const expected = [...cpu.gprU64];
                const taken = condition(BigInt.asIntN(64, expected[source]));
                const nextPC = delayPC ?? pc + 4;
                if (link) {
                  expected[31] = BigInt.asUintN(64, BigInt((nextPC + 4) | 0));
                }
                cpu.pc = pc;
                cpu.nextPC = nextPC;
                cpu.delayPC = delayPC;
                cpu.branchTarget = null;
                run(cpu);
                expect([...cpu.gprU64]).toEqual(expected);
                expect(compiled ? cpu.delayPC : cpu.branchTarget).toBe(taken ? pc + 4 + offset * 4 : likely ? null : pc + 8);
                expect(compiled ? cpu.pc : cpu.nextPC).toBe(nextPC + (likely && !taken ? 4 : 0));
              }
            }
          }
        }
      });
    }
  });
}

for (const [loadName, opcode, signed] of [['LW', 0x8c000000, true], ['LWU', 0x9c000000, false]]) {
  for (const [name, branch, condition, likely] of cases.filter(([name]) => /^(BLEZ|BGTZ)L?$/.test(name))) {
    test(`compiled ${loadName}/${name} preserves signed versus unsigned width proofs`, async () => {
      const { cpu0: cpu, hardware } = await createHeadlessEmulator({
        romBuffer: new ArrayBuffer(0x1000),
        rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' },
      });
      n64js.getSyncFlow = () => null;
      const fragment = new Fragment(pc);
      const ctx = new FragmentContext();
      const words = [(opcode | (20 << 21) | (4 << 16)) >>> 0, (branch | (4 << 21) | 3) >>> 0];
      words.forEach((word, index) => {
        fragment.opsCompiled++;
        const addr = pc + index * 4;
        ctx.set(fragment, addr, word, addr + 4, addr + 4);
        generateCodeForOp(ctx);
      });
      const run = new Function('c', fragment.bodyCode);
      for (const word of [0, 1, 0x7fffffff, 0x80000000, 0xffffffff]) {
        cpu.setRegS32Extend(20, 0x80002000);
        hardware.ram.set32(0x2000, word);
        cpu.pc = pc;
        cpu.delayPC = null;
        cpu.stuffToDo = 0;
        const value = signed ? BigInt(word | 0) : BigInt(word);
        const taken = condition(value);
        run(cpu);
        expect(cpu.getRegS64(4)).toBe(value);
        expect(cpu.delayPC).toBe(taken ? pc + 20 : likely ? null : pc + 12);
        expect(cpu.pc).toBe(pc + (likely && !taken ? 12 : 8));
      }
    });
  }
}
