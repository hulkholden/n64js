import { describe, expect, test } from 'bun:test';
import { CPU1 } from './cpu1.js';
import { createHeadlessEmulator } from '../headless/headless_env.js';
import * as regs from './cpu0reg.js';
import { MI_INTR_PI, MI_INTR_MASK_REG } from '../devices/mi.js';

const FR = 0x04000000;
const CU1 = 0x20000000;

function expectMapping(fpu, fullMode) {
  for (let i = 0; i < 32; i++) {
    const even = i & ~1;
    expect(fpu.copRegIdx32(i)).toBe(fullMode ? i * 2 : even * 2 + (i & 1));
    expect(fpu.fdRegIdx32(i)).toBe(i * 2);
    expect(fpu.fsRegIdx32(i)).toBe(fullMode ? i * 2 : even * 2);
    expect(fpu.ftRegIdx32(i)).toBe(i * 2);
    expect(fpu.copRegIdx64(i)).toBe(fullMode ? i : even);
    expect(fpu.fdRegIdx64(i)).toBe(i);
    expect(fpu.fsRegIdx64(i)).toBe(fullMode ? i : even);
    expect(fpu.ftRegIdx64(i)).toBe(i);
  }
}

describe('FPU register mode', () => {
  test('initializes every register mapping on construction', () => {
    expectMapping(new CPU1({}), true);
  });

  test('repeated selections and mode transitions preserve register bits', () => {
    const fpu = new CPU1({});
    const bits = Array.from({ length: 32 }, (_, i) => 0x7ff123456789abc0n + BigInt(i));
    fpu.regU64.set(bits);
    for (const fullMode of [true, true, false, false, true, true, false]) {
      fpu.fullMode = fullMode;
      expectMapping(fpu, fullMode);
      expect([...fpu.regU64]).toEqual(bits);
    }
  });

  for (const fullMode of [false, true]) {
    test(`reset from FR=${Number(fullMode)} restores full mode and clears registers`, () => {
      const fpu = new CPU1({});
      fpu.fullMode = fullMode;
      fpu.regU64.fill(0xffffffffffffffffn);
      fpu.control.fill(0xffffffff);
      fpu.reset();
      expectMapping(fpu, true);
      expect([...fpu.regU64]).toEqual(Array(32).fill(0n));
      expect([...fpu.control]).toEqual([0xa00, ...Array(31).fill(0)]);
    });

    test(`status writes still update COP1 usability with unchanged FR=${Number(fullMode)}`, async () => {
      const { cpu0: cpu, hardware } = await createHeadlessEmulator({
        romBuffer: new ArrayBuffer(0x1000),
        rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' },
      });
      const fpu = hardware.cpu1;
      for (const usable of [true, false, true]) {
        cpu.setRegU32Extend(4, (fullMode ? FR : 0) | (usable ? CU1 : 0));
        cpu.execMTC0(4, regs.controlStatus);
        expectMapping(fpu, fullMode);
        fpu.store32(fpu.copRegIdx32(3), 0x12345678);
        cpu.setRegU32Extend(2, 0xdeadbeef);
        cpu.setControlU32(regs.controlCause, 0);
        cpu.pc = 0x80001000;
        cpu.nextPC = cpu.pc + 4;
        cpu.delayPC = null;
        n64js.executeOp(0x44021800); // MFC1 v0, f3.
        expect(cpu.getRegU32Lo(2)).toBe(usable ? 0x12345678 : 0xdeadbeef);
        expect(cpu.getControlU32(regs.controlCause)).toBe(usable ? 0 : (1 << 28) | (11 << 2));
      }
    });

    test(`status writes still update pending interrupts with unchanged FR=${Number(fullMode)}`, async () => {
      const { cpu0: cpu, hardware } = await createHeadlessEmulator({
        romBuffer: new ArrayBuffer(0x1000),
        rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' },
      });
      hardware.mi_reg.set32(MI_INTR_MASK_REG, MI_INTR_PI);
      hardware.miRegDevice.setInterruptBit(MI_INTR_PI);
      for (const enabled of [false, true, false, true]) {
        cpu.setRegU32Extend(4, (fullMode ? FR : 0) | CU1 | 0x400 | Number(enabled));
        cpu.execMTC0(4, regs.controlStatus);
        expectMapping(hardware.cpu1, fullMode);
        expect(cpu.checkForUnmaskedInterrupts()).toBe(enabled);
        expect(cpu.stuffToDo !== 0).toBe(enabled);
      }
    });
  }
});
