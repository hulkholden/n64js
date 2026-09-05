import { describe, expect, test } from 'bun:test';
import './headless_env.js';
import * as regs from './cpu0reg.js';

const { Hardware } = await import('./hardware.js');
const { initCPU } = await import('./r4300.js');
const { Fragment } = await import('./fragments.js');
const { FragmentContext, generateCodeForOp } = await import('./recompiler.js');

const hardware = new Hardware({ save: 'Eeprom4k' }, { headless: true });
const cpu = hardware.cpu0;
const pc = 0x80001000;

function execute(word, compiled, delay = false) {
  initCPU(hardware);
  cpu.reset();
  cpu.setControlU32(regs.controlStatus, 0);
  cpu.pc = pc;
  cpu.delayPC = delay ? pc + 0x80 : 0;
  cpu.nextPC = cpu.delayPC || pc + 4;
  cpu.setRegU64(2, 0x123456789abcdef0n);
  cpu.setControlU32(regs.controlEPC, pc + 0x100);
  n64js.getSyncFlow = () => null;
  if (compiled) {
    const fragment = new Fragment(pc);
    fragment.opsCompiled = 1;
    const ctx = new FragmentContext();
    ctx.set(fragment, pc, word >>> 0, cpu.nextPC, cpu.nextPC);
    generateCodeForOp(ctx);
    new Function('c', fragment.bodyCode)(cpu);
  } else {
    n64js.executeOp(word >>> 0);
    cpu.pc = cpu.nextPC;
  }
}

for (const compiled of [false, true]) {
  describe(compiled ? 'compiled COP0' : 'interpreted COP0', () => {
    test('reserved rs values raise RI with correct EPC and delay-slot state', () => {
      for (const rs of [3, 7, 9, 10, 11, 12, 13, 14, 15]) {
        for (const delay of [false, true]) {
          execute(0x40000000 | (rs << 21), compiled, delay);
          expect(cpu.pc).toBe(0x80000180);
          expect(cpu.getControlU32(regs.controlCause)).toBe((0x28 | (delay ? 0x80000000 : 0)) >>> 0);
          expect(cpu.getControlU32(regs.controlEPC)).toBe(delay ? pc - 4 : pc);
          expect(cpu.getControlU32(regs.controlStatus) & 2).toBe(2);
        }
      }
    });

    test('CFC0, CTC0 and BC0 leave registers and branch flow unchanged', () => {
      for (const rs of [2, 6, 8]) {
        for (const operands of [0, 0x1fffff]) {
          for (const delay of [false, true]) {
            execute(0x40000000 | (rs << 21) | operands, compiled, delay);
            expect(cpu.pc).toBe(delay ? pc + 0x80 : pc + 4);
            expect(cpu.getControlU32(regs.controlCause)).toBe(0);
            expect(cpu.getControlU32(regs.controlEPC)).toBe(pc + 0x100);
            expect(cpu.getRegU64(2)).toBe(0x123456789abcdef0n);
          }
        }
      }
    });

    test('CO function decode ignores operand bits, with only RFE trapping among reserved functions', () => {
      for (let funct = 0; funct < 64; funct++) {
        if ([1, 2, 6, 8, 24].includes(funct)) continue;
        for (const operands of [0, 0x1e00000, 0x1fffc0, 0x1ffffc0]) {
          execute(0x42000000 | operands | funct, compiled);
          expect(cpu.pc).toBe(funct === 16 ? 0x80000180 : pc + 4);
          expect(cpu.getControlU32(regs.controlCause)).toBe(funct === 16 ? 0x28 : 0);
        }
      }
    });

    test('ERET decodes with nonzero operand bits', () => {
      execute(0x43ffffd8, compiled);
      expect(cpu.pc).toBe(pc + 0x100);
    });
  });
}
