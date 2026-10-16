import { describe, expect, test } from 'bun:test';
import { controlCause, controlEPC, controlStatus } from './cpu0reg.js';
import {
  DEFAULT_PC,
  compileOp,
  createTestEmulator,
} from './test_helpers.js';

async function createCPU() {
  const emulator = await createTestEmulator();
  emulator.cpu0.reset();
  emulator.cpu0.setControlU32(controlStatus, 0);
  emulator.cpu0.pc = DEFAULT_PC;
  return emulator;
}

function runInstruction(emulator, compiled, word) {
  const { cpu0: cpu, hardware } = emulator;
  if (!compiled) {
    hardware.ram.set32(0x1000, word);
    cpu.run(1);
    return;
  }
  const fragment = compileOp(word, { postPC: cpu.delayPC ?? DEFAULT_PC + 4, nextPC: DEFAULT_PC + 4 });
  new Function('c', fragment.bodyCode)(cpu);
}

for (const compiled of [false, true]) {
  describe(compiled ? 'compiled ADDIU' : 'interpreted ADDIU', () => {
    for (const [name, source, immediate, expected] of [
      ['positive overflow', 0x7fffffffn, 1, -0x80000000n],
      ['negative overflow', -0x80000000n, -1, 0x7fffffffn],
      ['signed immediate', 0n, -1, -1n],
      ['carry out of the low word', -1n, 1, 0n],
    ]) {
      test(`${name} wraps without raising an exception`, async () => {
        const emulator = await createCPU();
        const cpu = emulator.cpu0;
        cpu.setRegU64(4, source);
        // ADDIU v0, a0, immediate.
        runInstruction(emulator, compiled, 0x24820000 | (immediate & 0xffff));
        expect(cpu.getRegS64(2)).toBe(expected);
        expect(cpu.getControlU32(controlCause)).toBe(0);
        expect(cpu.getControlU32(controlStatus)).toBe(0);
        expect(cpu.pc).toBe(DEFAULT_PC + 4);
      });
    }

    test('overflow in a delay slot preserves the branch destination', async () => {
      const emulator = await createCPU();
      const cpu = emulator.cpu0;
      cpu.setRegS32Extend(2, 0x7fffffff);
      cpu.delayPC = 0x80002000;
      runInstruction(emulator, compiled, 0x24420001); // ADDIU v0, v0, 1.
      expect(cpu.getRegS64(2)).toBe(-0x80000000n);
      expect(cpu.pc).toBe(0x80002000);
      expect(cpu.delayPC).toBeNull();
      expect(cpu.getControlU32(controlCause)).toBe(0);
    });

    test('discarding an overflowing result still leaves exception state unchanged', async () => {
      const emulator = await createCPU();
      const cpu = emulator.cpu0;
      cpu.setRegS32Extend(4, 0x7fffffff);
      runInstruction(emulator, compiled, 0x24800001); // ADDIU zero, a0, 1.
      expect(cpu.getRegS64(0)).toBe(0n);
      expect(cpu.getControlU32(controlStatus)).toBe(0);
      expect(cpu.getControlU32(controlCause)).toBe(0);
      expect(cpu.pc).toBe(DEFAULT_PC + 4);
    });

    test('ADDI continues to trap on signed overflow', async () => {
      const emulator = await createCPU();
      const cpu = emulator.cpu0;
      cpu.setRegS32Extend(4, 0x7fffffff);
      cpu.setRegS32Extend(2, 123);
      runInstruction(emulator, compiled, 0x20820001); // ADDI v0, a0, 1.
      expect(cpu.getRegS64(2)).toBe(123n);
      expect(cpu.getControlU32(controlCause)).toBe(12 << 2);
      expect(cpu.getControlU32(controlEPC)).toBe(DEFAULT_PC);
      expect(cpu.pc).toBe(0x80000180);
    });
  });
}
