import { describe, expect, test } from 'bun:test';
import { createHeadlessEmulator } from '../headless/headless_env.js';
import * as decode from './decode.js';
import { Fragment } from './fragments.js';
import { FragmentContext, generateCodeForOp } from './recompiler.js';

const pc = 0x80001000;
const operations = [
  ['MFHI', decode.SPECIAL_MFHI, 'hi', true],
  ['MFLO', decode.SPECIAL_MFLO, 'lo', true],
  ['MTHI', decode.SPECIAL_MTHI, 'hi', false],
  ['MTLO', decode.SPECIAL_MTLO, 'lo', false],
];

const values = [
  0n, 1n, 0xffffffffffffffffn, 0x7fffffffn, 0x80000000n,
  0xffffffffn, 0x100000000n, 0xffffffff00000000n,
  0x7fffffffffffffffn, 0x8000000000000000n,
  0x0123456789abcdefn, 0xfedcba9876543210n,
];
for (let bit = 0n; bit < 64n; bit++) {
  values.push(1n << bit, BigInt.asUintN(64, ~(1n << bit)));
}

async function createCPU() {
  const { cpu0 } = await createHeadlessEmulator({
    romBuffer: new ArrayBuffer(0x1000),
    rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' },
  });
  n64js.getSyncFlow = () => null;
  return cpu0;
}

function instruction(compiled, word) {
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

function snapshot(cpu) {
  return { gpr: [...cpu.gprU64], hi: cpu.getMultHiU64(), lo: cpu.getMultLoU64() };
}

for (const compiled of [false, true]) {
  describe(`${compiled ? 'compiled' : 'interpreted'} multiplier register moves`, () => {
    for (const [name, opcode, accumulator, fromAccumulator] of operations) {
      test(`${name} copies all 64 bits and respects register zero without disturbing other registers`, async () => {
        const cpu = await createCPU();
        for (let reg = 0; reg < 32; reg++) {
          const run = instruction(compiled, opcode | (reg << (fromAccumulator ? 11 : 21)));
          for (const value of values) {
            cpu.gprU64.fill(0x13579bdf2468ace0n);
            cpu.gprU64[0] = 0n;
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
            cpu.pc = pc;
            cpu.delayPC = null;
            run(cpu);
            expect(snapshot(cpu)).toEqual(expected);
          }
        }
      });
    }

    test('saves a multiply result and restores it after a divide overwrites HI/LO', async () => {
      const cpu = await createCPU();
      const left = 0xfedcba9876543210n;
      const right = 0x0123456789abcdefn;
      const product = left * right;
      cpu.setRegU64(4, left);
      cpu.setRegU64(5, right);
      const words = [
        decode.SPECIAL_DMULTU | (4 << 21) | (5 << 16),
        decode.SPECIAL_MFHI | (6 << 11), decode.SPECIAL_MFLO | (7 << 11),
        decode.SPECIAL_DDIVU | (4 << 21) | (5 << 16),
        decode.SPECIAL_MFHI | (8 << 11), decode.SPECIAL_MFLO | (9 << 11),
        decode.SPECIAL_MTHI | (6 << 21), decode.SPECIAL_MTLO | (7 << 21),
      ];
      for (const word of words) {
        cpu.pc = pc;
        cpu.delayPC = null;
        instruction(compiled, word)(cpu);
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
