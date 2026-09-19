import { describe, expect, test } from 'bun:test';
import { createHeadlessEmulator } from '../headless_env.js';
import { controlCause, controlEPC, controlStatus } from './cpu0reg.js';

const { Fragment } = await import('./fragments.js');
const { FragmentContext, generateCodeForOp } = await import('./recompiler.js');

async function createCPU(pc, branch, slot) {
  const emulator = await createHeadlessEmulator({
    romBuffer: new ArrayBuffer(0x1000),
    rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' },
  });
  const { cpu0: cpu, hardware } = emulator;
  cpu.reset();
  cpu.setControlU32(controlStatus, 0);
  // Map virtual page zero to physical page 2, like Bomberman's dispatcher.
  cpu.tlbEntries[0].update(0, 0, 0n, (2 << 6) | 7, 1);
  hardware.ram.set32(0x2000, 0x24630001); // ADDIU v1, v1, 1 at VA 0.
  hardware.ram.set32(0x1000, branch);
  hardware.ram.set32(0x1004, slot);
  // Also use mapped VA 0x100 for direct/relative branches to zero.
  hardware.ram.set32(0x2100, branch);
  hardware.ram.set32(0x2104, slot);
  cpu.pc = pc;
  return emulator;
}

function runBranch(cpu, compiled, branch, slot, target = 0) {
  if (!compiled) {
    cpu.run(2);
    return;
  }
  n64js.getSyncFlow = () => null;
  const pc = cpu.pc;
  const fragment = new Fragment(pc);
  const ctx = new FragmentContext();
  for (const [i, word] of [branch, slot].entries()) {
    fragment.opsCompiled++;
    const postPC = i === 0 ? pc + 4 : target;
    ctx.set(fragment, pc + i * 4, word, postPC, postPC);
    generateCodeForOp(ctx);
  }
  new Function('c', fragment.bodyCode)(cpu);
}

for (const compiled of [false, true]) {
  describe(compiled ? 'compiled branches to zero' : 'interpreted branches to zero', () => {
    for (const [name, pc, word, link] of [
      ['JR', 0x80001000, 0x00000008, false],
      ['JALR', 0x80001000, 0x0000f809, true],
      ['J', 0x100, 0x08000000, false],
      ['JAL', 0x100, 0x0c000000, true],
      ['BEQ', 0x100, 0x1000ffbf, false],
      ['BEQL', 0x100, 0x5000ffbf, false],
    ]) {
      test(`${name} executes its delay slot and reaches mapped address zero`, async () => {
        const slot = 0x24420001; // ADDIU v0, v0, 1.
        const { cpu0: cpu, fatalError } = await createCPU(pc, word, slot);
        runBranch(cpu, compiled, word, slot);
        expect(fatalError()).toBeNull();
        expect(cpu.pc).toBe(0);
        expect(cpu.getRegU32Lo(2)).toBe(1);
        expect(cpu.getRegU32Lo(31)).toBe(link ? pc + 8 : 0);
        cpu.run(1);
        expect(cpu.pc).toBe(4);
        expect(cpu.getRegU32Lo(3)).toBe(1);
      });
    }

    test('a load in the delay slot preserves the zero target', async () => {
      const branch = 0x00000008; // JR zero.
      const slot = 0x8c820000; // LW v0, 0(a0).
      const { cpu0: cpu, hardware } = await createCPU(0x80001000, branch, slot);
      cpu.setRegS32Extend(4, 0x80003000);
      hardware.ram.set32(0x3000, 0x12345678);
      runBranch(cpu, compiled, branch, slot);
      expect(cpu.pc).toBe(0);
      expect(cpu.getRegU32Lo(2)).toBe(0x12345678);
    });

    test('an exception in the delay slot sets BD and reports the branch EPC', async () => {
      const branch = 0x00000008; // JR zero.
      const slot = 0x0000000c; // SYSCALL.
      const { cpu0: cpu } = await createCPU(0x80001000, branch, slot);
      runBranch(cpu, compiled, branch, slot, 0x80000180);
      expect(cpu.pc).toBe(0x80000180);
      expect(cpu.getControlU32(controlCause)).toBe(0x80000020);
      expect(cpu.getControlU32(controlEPC)).toBe(0x80001000);
    });

    test('an untaken likely branch annuls its delay slot', async () => {
      const branch = 0x5400ffbf; // BNEL zero, zero, VA 0.
      const slot = 0x24420001;
      const { cpu0: cpu } = await createCPU(0x100, branch, slot);
      if (compiled) {
        runBranch(cpu, true, branch, slot);
      } else {
        cpu.run(1);
      }
      expect(cpu.pc).toBe(0x108);
      expect(cpu.getRegU32Lo(2)).toBe(0);
    });
  });
}
