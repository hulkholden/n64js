import { describe, expect, test } from 'bun:test';
import { createHeadlessEmulator } from '../headless/headless_env.js';
import { controlCause, controlCompare, controlCount, controlStatus } from './cpu0reg.js';

const timerInterrupt = 0x8000;
const countWrapCycles = 0x2_0000_0000;

async function createCPU() {
  const { cpu0 } = await createHeadlessEmulator({
    romBuffer: new ArrayBuffer(0x1000),
    rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' },
  });
  return cpu0;
}

function advance(cpu, cycles) {
  cpu.incrementCount(cycles);
  cpu.eventQueue.incrementCount(cycles);
}

function pending(cpu) {
  return cpu.getControlU32(controlCause) & timerInterrupt;
}

describe('CP0 Compare timer', () => {
  test('uses two CPU cycles per COUNT tick and preserves the half-tick phase', async () => {
    for (const phase of [0, 1]) {
      const cpu = await createCPU();
      cpu.controlCountValue = 200 + phase;
      cpu.setCompare(103);
      expect(cpu.getCyclesUntilEvent('Compare')).toBe(6 - phase);
      advance(cpu, 5 - phase);
      expect(pending(cpu)).toBe(0);
      advance(cpu, 1);
      expect(pending(cpu)).toBe(timerInterrupt);
      expect(cpu.hasEvent('Compare')).toBe(false);
    }
  });

  test('writing the current COUNT waits for the next wrap instead of scheduling zero cycles', async () => {
    for (const phase of [0, 1]) {
      const cpu = await createCPU();
      cpu.controlCountValue = 200 + phase;
      expect(() => cpu.setCompare(100)).not.toThrow();
      expect(cpu.getCyclesUntilEvent('Compare')).toBe(countWrapCycles - phase);
      advance(cpu, countWrapCycles - phase - 1);
      expect(pending(cpu)).toBe(0);
      advance(cpu, 1);
      expect(pending(cpu)).toBe(timerInterrupt);
    }
  });

  test('schedules correctly across the 32-bit COUNT wrap', async () => {
    const cpu = await createCPU();
    cpu.controlCountValue = 0xffff_fffe * 2 + 1;
    cpu.setCompare(1);
    expect(cpu.getCyclesUntilEvent('Compare')).toBe(5);
    advance(cpu, 4);
    expect(pending(cpu)).toBe(0);
    advance(cpu, 1);
    expect(pending(cpu)).toBe(timerInterrupt);
    cpu.setCompare(3);
    expect(cpu.getCyclesUntilEvent('Compare')).toBe(4);
  });

  test('rewriting Compare acknowledges the interrupt and rearms even when its value is unchanged', async () => {
    const cpu = await createCPU();
    cpu.setControlU32(controlStatus, timerInterrupt | 1);
    cpu.setCompare(2);
    advance(cpu, 4);
    expect(cpu.checkForUnmaskedInterrupts()).toBe(true);
    cpu.setCompare(2);
    expect(pending(cpu)).toBe(0);
    expect(cpu.checkForUnmaskedInterrupts()).toBe(false);
    expect(cpu.stuffToDo).toBe(0);
    expect(cpu.getCyclesUntilEvent('Compare')).toBe(countWrapCycles);
  });

  test('rewriting an unexpired Compare preserves its deadline and unrelated events', async () => {
    const cpu = await createCPU();
    let otherFired = false;
    cpu.addEvent('Other device', 5, () => { otherFired = true; });
    cpu.setCompare(4);
    advance(cpu, 3);
    cpu.setCompare(4);
    expect(cpu.getCyclesUntilEvent('Compare')).toBe(5);
    expect(cpu.getCyclesUntilEvent('Other device')).toBe(2);
    advance(cpu, 2);
    expect(otherFired).toBe(true);
    expect(pending(cpu)).toBe(0);
    advance(cpu, 3);
    expect(pending(cpu)).toBe(timerInterrupt);
  });

  test('COUNT writes reschedule Compare, use only 32 bits, and do not acknowledge pending interrupts', async () => {
    const cpu = await createCPU();
    cpu.setCompare(10);
    cpu.moveToControl(controlCount, 8n);
    expect(cpu.getCyclesUntilEvent('Compare')).toBe(4);
    advance(cpu, 4);
    expect(pending(cpu)).toBe(timerInterrupt);
    cpu.moveToControl(controlCount, 0x1234_5678_0000_0009n);
    expect(cpu.controlCountValue).toBe(18);
    expect(pending(cpu)).toBe(timerInterrupt);
    expect(cpu.getCyclesUntilEvent('Compare')).toBe(2);
    cpu.setCompare(1);
    cpu.moveToControl(controlCount, -1n);
    expect(cpu.controlCountValue).toBe(0xffff_ffff * 2);
    expect(cpu.getCyclesUntilEvent('Compare')).toBe(4);
  });

  test('MTC0 execution delivers the timer at the programmed COUNT', async () => {
    const cpu = await createCPU();
    cpu.pc = 0x80000000;
    cpu.setControlU32(controlStatus, 0);
    cpu.cop1ControlChanged();
    cpu.setRegU64(4, 100n);
    cpu.setRegU64(5, 102n);
    cpu.ramDV.setUint32(0, 0x40844800); // MTC0 a0, Count
    cpu.ramDV.setUint32(4, 0x40855800); // MTC0 a1, Compare
    cpu.run(3);
    expect(pending(cpu)).toBe(0);
    cpu.run(1);
    expect(pending(cpu)).toBe(timerInterrupt);
    expect(cpu.moveFromControl(controlCount)).toBe(102n);
    expect(cpu.getControlU32(controlCompare)).toBe(102);
  });
});
