import { describe, expect, spyOn, test } from 'bun:test';
import './headless_env.js';
import * as regs from './cpu0reg.js';

const { Hardware } = await import('./hardware.js');

function createCPU() {
  return new Hardware({ save: 'Eeprom4k' }, { headless: true }).cpu0;
}

describe('CPU0 random source', () => {
  test('uses Math.random by default and can restore it after an override', () => {
    const random = spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const cpu = createCPU();
      expect(cpu.getRandom()).toBe(16);

      cpu.setRandomSource(() => 0);
      expect(cpu.getRandom()).toBe(0);

      cpu.setRandomSource();
      expect(cpu.getRandom()).toBe(16);
      expect(random).toHaveBeenCalledTimes(2);
    } finally {
      random.mockRestore();
    }
  });

  for (const [wired, expected] of [
    [0, [0, 16, 31]],
    [5, [5, 18, 31]],
    [31, [31, 31, 31]],
    [32, [0, 32, 63]],
    [63, [0, 32, 63]],
  ]) {
    test(`maps one source sample per read into the range for Wired=${wired}`, () => {
      const cpu = createCPU();
      const samples = [0, 0.5, 1 - Number.EPSILON];
      let calls = 0;
      cpu.setRandomSource(() => samples[calls++]);
      cpu.setControlU32(regs.controlWired, wired);

      expect([cpu.getRandom(), cpu.getRandom(), cpu.getRandom()]).toEqual(expected);
      expect(calls).toBe(3);
    });
  }

  test('keeps sources independent between CPUs and preserves sequence state across resets', () => {
    const first = createCPU();
    const second = createCPU();
    const samples = [0.25, 0.5, 0.75];
    let firstIndex = 0;
    let secondIndex = 0;
    first.setRandomSource(() => samples[firstIndex++]);
    second.setRandomSource(() => samples[secondIndex++]);

    expect(first.getRandom()).toBe(8);
    first.reset();
    expect(first.getRandom()).toBe(16);
    expect(second.getRandom()).toBe(8);
    expect(first.getRandom()).toBe(24);
    expect(second.getRandom()).toBe(16);
  });

  test('uses the injected source for COP0 Random reads and TLBWR', () => {
    const cpu = createCPU();
    const samples = [0, 0.5];
    let calls = 0;
    cpu.setRandomSource(() => samples[calls++]);
    cpu.setControlU32(regs.controlWired, 8);
    const setTLB = spyOn(cpu, 'setTLB');
    try {
      expect(cpu.moveFromControl(regs.controlRand)).toBe(8n);
      cpu.tlbWriteRandom();
      expect(setTLB).toHaveBeenCalledTimes(1);
      expect(setTLB).toHaveBeenCalledWith(20);
      expect(calls).toBe(2);
    } finally {
      setTLB.mockRestore();
    }
  });
});
