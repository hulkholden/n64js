import { describe, expect, test } from 'bun:test';
import { createHeadlessEmulator } from './headless_env.js';
import * as regs from './cpu0reg.js';
import { MI_INTR_PI, MI_INTR_MASK_REG } from './devices/mi.js';

const { getFragmentMap, lookupFragment } = await import('./fragments.js');
const pc = 0x80001000;
const resumePC = 0x80002000;
const interruptVector = 0x80000180;
const cycles = 16;
const IE = 1;
const EXL = 2;
const ERL = 4;
const IM_RCP = 0x400;

async function executeReturn(compiled, status, pending = true) {
  const emulator = await createHeadlessEmulator({
    romBuffer: new ArrayBuffer(0x1000),
    rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' },
  });
  const { cpu0: cpu, hardware } = emulator;
  n64js.getSyncFlow = () => null;
  hardware.ram.set32(pc & 0x7fffff, 0x42000018); // ERET
  hardware.ram.set32(resumePC & 0x7fffff, 0x24020001); // ADDIU v0, zero, 1

  function prepare(status, pending) {
    cpu.reset();
    hardware.mi_reg.clear();
    cpu.pc = pc;
    cpu.setControlU32(regs.controlStatus, status);
    cpu.setControlU32(regs.controlEPC, resumePC);
    cpu.setControlU32(regs.controlErrorEPC, resumePC);
    cpu.llBit = 1;
    hardware.mi_reg.set32(MI_INTR_MASK_REG, MI_INTR_PI);
    if (pending) hardware.miRegDevice.setInterruptBit(MI_INTR_PI);
    cpu.statusRegisterChanged();
    expect(cpu.checkForUnmaskedInterrupts()).toBe(false);
    cpu.addEvent('Unrelated device', 40, () => {});
  }

  let fragment;
  if (compiled) {
    // Train the real compiler with no pending interrupt, then replay the same
    // trace with an interrupt already asserted while EXL/ERL masks delivery.
    prepare(IM_RCP | IE | EXL, false);
    for (let i = 0; i < 499; i++) lookupFragment(pc);
    cpu.run(cycles);
    fragment = getFragmentMap().get(pc);
    expect(fragment?.func).toBeFunction();
  }
  prepare(status, pending);
  if (compiled) getFragmentMap().set(pc, fragment);
  const count = cpu.controlCountValue;
  cpu.run(cycles);
  expect(emulator.fatalError()).toBeNull();
  if (compiled) expect(fragment.executionCount).toBe(1);
  expect(cpu.controlCountValue - count).toBe(cycles);
  expect(cpu.getCyclesUntilEvent('Unrelated device')).toBe(40 - cycles);
  expect(cpu.llBit).toBe(0);
  return cpu;
}

for (const compiled of [false, true]) {
  describe(`${compiled ? 'compiled' : 'interpreted'} ERET interrupts`, () => {
    for (const [name, level] of [['EXL', EXL], ['ERL', ERL]]) {
      test(`delivers a pending PI interrupt when ${name} clears`, async () => {
        const cpu = await executeReturn(compiled, IM_RCP | IE | level);
        expect(cpu.getRegU32Lo(2)).toBe(0); // Do not execute the resumed thread.
        expect(cpu.getControlU32(regs.controlEPC)).toBe(resumePC);
        expect(cpu.getControlU32(regs.controlCause)).toBe(IM_RCP); // Int, no BD.
        expect(cpu.getControlU32(regs.controlStatus)).toBe(IM_RCP | IE | EXL);
        expect(cpu.pc).toBe(interruptVector + (cycles - 1) * 4);
      });
    }

    for (const [name, status, pending, remainingStatus] of [
      ['IE disabled', IM_RCP | EXL, true, IM_RCP],
      ['RCP masked', IE | EXL, true, IE],
      ['EXL still set after clearing ERL', IM_RCP | IE | EXL | ERL, true, IM_RCP | IE | EXL],
      ['no pending interrupt', IM_RCP | IE | EXL, false, IM_RCP | IE],
    ]) {
      test(`resumes without an interrupt with ${name}`, async () => {
        const cpu = await executeReturn(compiled, status, pending);
        expect(cpu.getRegU32Lo(2)).toBe(1);
        expect(cpu.getControlU32(regs.controlStatus)).toBe(remainingStatus);
        expect(cpu.pc).toBe(resumePC + (cycles - 1) * 4);
      });
    }
  });
}
