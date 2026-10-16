import { describe, expect, test } from 'bun:test';
import * as regs from './cpu0reg.js';
import {
  DEFAULT_PC,
  compileOp,
  createTestHardware,
  resetTestHardware,
} from './test_helpers.js';

const hardware = createTestHardware();
const cpu = hardware.cpu0;
const fpu = hardware.cpu1;

// Match the systemtest reserved-COP1 matrix: rs values, branch conditions,
// and undefined functions in S/D/W/L formats (231 encodings in total).
const reservedRS = [3, 7, 9, 10, 11, 12, 13, 14, 15, 18, 19, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31];
const words = reservedRS.map(rs => 0x44000000 | (rs << 21));
for (let rt = 4; rt < 32; rt++) {
  words.push(0x45000000 | (rt << 16));
}
for (const fmt of [16, 17, 20, 21]) {
  for (let fn = 0; fn < 64; fn++) {
    const defined = fmt < 20
      ? fn <= 15 || fn >= 48 || fn === 36 || fn === 37 || (fn === 32 && fmt !== 16) || (fn === 33 && fmt !== 17)
      : fn === 32 || fn === 33;
    if (!defined) {
      words.push(0x44000000 | (fmt << 21) | fn);
    }
  }
}

function execute(word, compiled, usable, delay) {
  resetTestHardware(hardware);
  fpu.reset();
  cpu.setControlU32(regs.controlStatus, usable ? 0x20000000 : 0);
  cpu.cop1ControlChanged();
  cpu.pc = DEFAULT_PC;
  cpu.delayPC = delay ? DEFAULT_PC + 0x80 : null;
  cpu.nextPC = cpu.delayPC ?? DEFAULT_PC + 4;
  fpu.control[31] = 0;
  if (compiled) {
    const fragment = compileOp(word, { postPC: cpu.nextPC, nextPC: cpu.nextPC });
    new Function('c', 'cpu1', 'SR_CU1', fragment.bodyCode)(cpu, fpu, 0x20000000);
  } else {
    n64js.executeOp(word);
    cpu.pc = cpu.nextPC;
  }
}

for (const compiled of [false, true]) {
  describe(compiled ? 'compiled reserved COP1' : 'interpreted reserved COP1', () => {
    for (const usable of [false, true]) {
      test(usable ? 'raises FPE with unimplemented cause' : 'unusable takes precedence over reserved decode', () => {
        for (const word of words) {
          for (const delay of [false, true]) {
            execute(word, compiled, usable, delay);
            const cause = (usable ? 15 << 2 : (1 << 28) | (11 << 2)) | (delay ? 0x80000000 : 0);
            expect(cpu.getControlU32(regs.controlCause)).toBe(cause >>> 0);
            expect(cpu.getControlU32(regs.controlEPC)).toBe(delay ? DEFAULT_PC - 4 : DEFAULT_PC);
            expect(cpu.getControlU32(regs.controlStatus) & 2).toBe(2);
            expect(cpu.pc).toBe(0x80000180);
            expect(fpu.control[31]).toBe(usable ? 0x20000 : 0);
          }
        }
      });
    }
  });
}
