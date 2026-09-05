import { describe, expect, test } from 'bun:test';
import './headless_env.js';
import * as regs from './cpu0reg.js';

const { Hardware } = await import('./hardware.js');
const { initCPU } = await import('./r4300.js');
const { Fragment } = await import('./fragments.js');
const { FragmentContext, generateCodeForOp } = await import('./recompiler.js');
const hardware = new Hardware({ save: 'Eeprom4k' }, { headless: true });
const c = hardware.cpu0;
const fpu = hardware.cpu1;
const pc = 0x80001000;
// Match the systemtest reserved-COP1 matrix: rs values, branch conditions,
// and undefined functions in S/D/W/L formats (231 encodings in total).
const reservedRS = [3, 7, 9, 10, 11, 12, 13, 14, 15, 18, 19, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31];
const words = reservedRS.map(rs => 0x44000000 | (rs << 21));
for (let rt = 4; rt < 32; rt++) words.push(0x45000000 | (rt << 16));
for (const fmt of [16, 17, 20, 21]) {
  for (let fn = 0; fn < 64; fn++) {
    const defined = fmt < 20
      ? fn <= 15 || fn >= 48 || fn === 36 || fn === 37 || (fn === 32 && fmt !== 16) || (fn === 33 && fmt !== 17)
      : fn === 32 || fn === 33;
    if (!defined) words.push(0x44000000 | (fmt << 21) | fn);
  }
}

function execute(word, compiled, usable, delay) {
  initCPU(hardware);
  c.reset();
  fpu.reset();
  c.setControlU32(regs.controlStatus, usable ? 0x20000000 : 0);
  c.cop1ControlChanged();
  c.pc = pc;
  c.delayPC = delay ? pc + 0x80 : 0;
  c.nextPC = c.delayPC || pc + 4;
  fpu.control[31] = 0;
  n64js.getSyncFlow = () => null;
  if (compiled) {
    const fragment = new Fragment(pc);
    fragment.opsCompiled = 1;
    const ctx = new FragmentContext();
    ctx.set(fragment, pc, word, c.nextPC, c.nextPC);
    generateCodeForOp(ctx);
    new Function('c', 'cpu1', 'SR_CU1', fragment.bodyCode)(c, fpu, 0x20000000);
  } else {
    n64js.executeOp(word);
    c.pc = c.nextPC;
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
            expect(c.getControlU32(regs.controlCause)).toBe(cause >>> 0);
            expect(c.getControlU32(regs.controlEPC)).toBe(delay ? pc - 4 : pc);
            expect(c.getControlU32(regs.controlStatus) & 2).toBe(2);
            expect(c.pc).toBe(0x80000180);
            expect(fpu.control[31]).toBe(usable ? 0x20000 : 0);
          }
        }
      });
    }
  });
}
