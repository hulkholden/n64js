import { describe, expect, test } from 'bun:test';
import * as regs from './cpu0reg.js';
import {
  DEFAULT_PC,
  createOpRunner,
  createTestHardware,
  resetTestHardware,
} from './test_helpers.js';

const hardware = createTestHardware();
const cpu = hardware.cpu0;

function execute(word, compiled, delay = false) {
  resetTestHardware(hardware);
  cpu.pc = DEFAULT_PC;
  cpu.delayPC = delay ? DEFAULT_PC + 0x80 : null;
  cpu.nextPC = cpu.delayPC ?? DEFAULT_PC + 4;
  cpu.setRegU64(2, 0x123456789abcdef0n);
  cpu.setControlU32(regs.controlEPC, DEFAULT_PC + 0x100);
  createOpRunner(compiled, word, { postPC: cpu.nextPC, nextPC: cpu.nextPC })(cpu);
  if (!compiled) {
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
          expect(cpu.getControlU32(regs.controlEPC)).toBe(delay ? DEFAULT_PC - 4 : DEFAULT_PC);
          expect(cpu.getControlU32(regs.controlStatus) & 2).toBe(2);
        }
      }
    });

    test('CFC0, CTC0 and BC0 leave registers and branch flow unchanged', () => {
      for (const rs of [2, 6, 8]) {
        for (const operands of [0, 0x1fffff]) {
          for (const delay of [false, true]) {
            execute(0x40000000 | (rs << 21) | operands, compiled, delay);
            expect(cpu.pc).toBe(delay ? DEFAULT_PC + 0x80 : DEFAULT_PC + 4);
            expect(cpu.getControlU32(regs.controlCause)).toBe(0);
            expect(cpu.getControlU32(regs.controlEPC)).toBe(DEFAULT_PC + 0x100);
            expect(cpu.getRegU64(2)).toBe(0x123456789abcdef0n);
          }
        }
      }
    });

    test('CO function decode ignores operand bits, with only RFE trapping among reserved functions', () => {
      for (let funct = 0; funct < 64; funct++) {
        if ([1, 2, 6, 8, 24].includes(funct)) {
          continue;
        }
        for (const operands of [0, 0x1e00000, 0x1fffc0, 0x1ffffc0]) {
          execute(0x42000000 | operands | funct, compiled);
          expect(cpu.pc).toBe(funct === 16 ? 0x80000180 : DEFAULT_PC + 4);
          expect(cpu.getControlU32(regs.controlCause)).toBe(funct === 16 ? 0x28 : 0);
        }
      }
    });

    test('ERET decodes with nonzero operand bits', () => {
      execute(0x43ffffd8, compiled);
      expect(cpu.pc).toBe(DEFAULT_PC + 0x100);
    });
  });
}
