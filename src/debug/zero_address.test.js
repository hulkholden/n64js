import { describe, expect, test } from 'bun:test';
import '../headless/headless_env.js';
import { controlStatus } from '../cpu/cpu0reg.js';
import { disassembleRange as disassembleCPU } from '../cpu/disassemble.js';
import { createTestEmulator, writeTLBEntry } from '../cpu/test_helpers.js';
import { MemoryRegion } from '../memory/memory_region.js';
import { disassembleRange as disassembleRSP } from '../rsp/disassemble_rsp.js';
import { Breakpoints } from './breakpoints.js';

const { Debugger } = await import('./debugger.js');

describe('valid address 0x00000000 handling', () => {
  test('n64js.singleStep restores a breakpoint at virtual address 0', async () => {
    const { cpu0: cpu, hardware } = await createTestEmulator();
    cpu.reset();
    cpu.setControlU32(controlStatus, 0);
    writeTLBEntry(cpu, 0, 0, (2 << 6) | 7, 0);
    hardware.ram.set32(0x2000, 0x24420001); // ADDIU v0, v0, 1 at VA 0.

    const breakpoints = new Breakpoints(hardware, () => {});
    n64js.breakpoints = () => breakpoints;

    breakpoints.toggle(0);
    expect(breakpoints.isBreakpoint(0)).toBe(true);
    cpu.pc = 0;

    n64js.singleStep();

    expect(cpu.pc).toBe(4);
    expect(cpu.getRegU32Lo(2)).toBe(1);
    expect(breakpoints.isBreakpoint(0)).toBe(true);
  });

  test('CPU disassembler marks address 0 as a jump target', () => {
    const previousBreakpoints = n64js.breakpoints;
    const ops = new Map([
      [0, 0x00000000], // NOP
      [4, 0x08000000], // J 0x00000000
    ]);
    n64js.breakpoints = () => ({ getInstruction: addr => ops.get(addr) ?? 0 });
    try {
      const result = disassembleCPU(0, 8, false);
      expect(result[0].instruction.address).toBe(0);
      expect(result[0].isJumpTarget).toBe(true);
      expect(result[1].instruction.target).toBe(0);
    } finally {
      n64js.breakpoints = previousBreakpoints;
    }
  });

  test('RSP disassembler marks IMEM address 0 as a jump target', () => {
    const imem = new MemoryRegion(new ArrayBuffer(0x1000));
    imem.set32(0, 0x00000000); // NOP
    imem.set32(4, 0x08000000); // J 0x0000

    const result = disassembleRSP(imem, 0, 8);
    expect(result[0].instruction.address).toBe(0);
    expect(result[0].isJumpTarget).toBe(true);
    expect(result[1].instruction.target).toBe(0);
  });

  test('Debugger.updateMemoryView displays address 0 instead of falling back to 0x80000000', () => {
    const viewed = [];
    const fakeDebugger = {
      lastMemoryAccessAddress: 0,
      memoryContent: { querySelector: () => ({ replaceChildren() {} }) },
      makeMemoryAccessRow(addr) {
        viewed.push(addr);
        return null;
      },
    };

    Debugger.prototype.updateMemoryView.call(fakeDebugger);
    fakeDebugger.lastMemoryAccessAddress = null;
    Debugger.prototype.updateMemoryView.call(fakeDebugger);

    expect(viewed).toEqual([0, 0x80000000]);
  });
});
