import { describe, expect, test } from 'bun:test';
import { controlStatus } from './cpu0reg.js';
import { compileOps, createTestEmulator, writeTLBEntry } from './test_helpers.js';

describe('CPU 32-bit PC wraparound', () => {
  test('conditionalBranch and conditionalBranchLikely wrap targets and nextPC modulo 2^32', async () => {
    const { cpu0: cpu } = await createTestEmulator();
    cpu.reset();

    cpu.pc = 0;
    cpu.conditionalBranch(true, -2);
    expect(cpu.branchTarget).toBe(0xfffffffc);

    cpu.pc = 0;
    cpu.conditionalBranchLikely(true, -2);
    expect(cpu.branchTarget).toBe(0xfffffffc);

    cpu.pc = 0xfffffff8;
    cpu.nextPC = 0xfffffffc;
    cpu.conditionalBranchLikely(false, 0);
    expect(cpu.nextPC).toBe(0);
  });

  test('sequential interpreter execution wraps pc from 0xfffffffc to 0', async () => {
    const { cpu0: cpu, hardware, fatalError } = await createTestEmulator();
    cpu.reset();
    cpu.setControlU32(controlStatus, 0);
    // Map VPN2 0xffffe000 (pages 0xffffe000 and 0xfffff000): odd page -> physical page 2.
    writeTLBEntry(cpu, 0, 0xffffe000, 0, (2 << 6) | 7);
    hardware.ram.set32(0x2ffc, 0x00000000); // NOP at VA 0xfffffffc.
    cpu.pc = 0xfffffffc;

    cpu.run(1);

    expect(fatalError()).toBeNull();
    expect(cpu.pc).toBe(0);
  });

  test('compiled untaken branch-likely wraps nextPC from 0xfffffffc to 0', async () => {
    const { cpu0: cpu } = await createTestEmulator();
    cpu.reset();
    cpu.pc = 0xfffffff8;
    // BNEL zero, zero, +0 (untaken): skips delay slot at 0xfffffffc -> 0x00000000.
    const fragment = compileOps([0x54000000], { pc: 0xfffffff8 });
    new Function('c', fragment.bodyCode)(cpu);

    expect(cpu.pc).toBe(0);
  });
});
