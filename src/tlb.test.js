import { beforeEach, describe, expect, test } from 'bun:test';
import './headless_env.js';
import * as regs from './cpu0reg.js';

const { Hardware } = await import('./hardware.js');
const { initCPU } = await import('./r4300.js');
const { Fragment } = await import('./fragments.js');
const { FragmentContext, generateCodeForOp } = await import('./recompiler.js');

const hardware = new Hardware({ save: 'Eeprom4k' }, { headless: true });
const cpu = hardware.cpu0;
const pc = 0x80001000;

beforeEach(() => {
  initCPU(hardware);
  cpu.reset();
  cpu.setControlU32(regs.controlStatus, 0);
  hardware.ram.clear();
  n64js.getSyncFlow = () => null;
});

function execute(word, compiled) {
  cpu.pc = pc;
  cpu.nextPC = pc + 4;
  if (compiled) {
    const fragment = new Fragment(pc);
    fragment.opsCompiled = 1;
    const ctx = new FragmentContext();
    ctx.set(fragment, pc, word >>> 0, pc + 4, pc + 4);
    generateCodeForOp(ctx);
    new Function('c', fragment.bodyCode)(cpu);
  } else {
    n64js.executeOp(word >>> 0);
  }
}

function mapPages(address, pageMask, lo0, lo1, compiled = false, asid = 0) {
  for (const [reg, value] of [
    [regs.controlIndex, 7],
    [regs.controlPageMask, pageMask],
    [regs.controlEntryHi, address | asid],
    [regs.controlEntryLo0, lo0],
    [regs.controlEntryLo1, lo1],
  ]) {
    cpu.setRegS32Extend(1, value);
    execute(0x40810000 | (reg << 11), compiled); // MTC0 r1, reg
  }
  execute(0x42000002, compiled); // TLBWI
}

for (const compiled of [false, true]) {
  describe(compiled ? 'compiled TLB accesses' : 'interpreted TLB accesses', () => {
    for (const base of [0x00800000, 0xc0000000, 0xe0000000]) {
      for (const [pageMask, pageSize] of [[0, 0x1000], [0x007fe000, 0x400000]]) {
        test(`reads and writes both ${pageSize.toString(16)}-byte pages at ${base.toString(16)}`, () => {
          // Gauntlet's decompressor maps 0xe0000000 with MTC0 EntryHi and
          // 4 MiB pages, then writes its first output byte at 0xe0000400.
          // EntryHi contains a sign-extended pointer; the memory handler must
          // preserve the same high VPN bits.
          mapPages(base, pageMask, 0x1f, (pageSize >>> 6) | 0x1f, compiled);
          for (const offset of [0x400, pageSize + 0x400, 2 * pageSize - 4]) {
            const address = (base + offset) >>> 0;
            expect(cpu.translateRead(address)).toBe(offset);
            expect(cpu.translateWrite(address)).toBe(offset);
            expect(cpu.translateReadInternal(address)).toBe(offset);

            cpu.setRegS32Extend(2, address);
            cpu.setRegS32Extend(3, 0x3c);
            execute(0xa0430000, compiled); // SB r3, 0(r2)
            expect(hardware.ram.getU8(offset)).toBe(0x3c);
            execute(0x90440000, compiled); // LBU r4, 0(r2)
            expect(cpu.getRegU64(4)).toBe(0x3cn);

            cpu.setRegS32Extend(3, 0x89abcdef);
            execute(0xac430000, compiled); // SW r3, 0(r2)
            expect(hardware.ram.getU32(offset)).toBe(0x89abcdef);
            execute(0x8c440000, compiled); // LW r4, 0(r2)
            expect(cpu.getRegS64(4)).toBe(-1985229329n);
          }
        });
      }
    }
  });
}

describe('TLB lookup constraints', () => {
  test('keeps high VPN bits significant', () => {
    mapPages(0xe0000000, 0, 0x1f, 0x5f);
    expect(cpu.tlbFindEntry(0xe0000400)).toBe(cpu.tlbEntries[7]);
    // A zero-extended VPN describes a different 64-bit virtual address.
    cpu.setControlU64(regs.controlEntryHi, 0x00000000e0000000n);
    cpu.tlbWriteIndex();
    expect(cpu.tlbFindEntry(0xe0000400)).toBeNull();
  });

  test('requires matching ASID unless both pages are global', () => {
    for (const flags of [0x1e, 0x1f]) {
      mapPages(0xe0000000, 0, flags, 0x5e, false, 0x12);
      expect(cpu.tlbFindEntry(0xe0000400)).toBe(cpu.tlbEntries[7]);
      cpu.setControlU32(regs.controlEntryHi, 0x34);
      expect(cpu.tlbFindEntry(0xe0000400)).toBeNull();
    }
    mapPages(0xe0000000, 0, 0x1f, 0x5f, false, 0x12);
    cpu.setControlU32(regs.controlEntryHi, 0x34);
    expect(cpu.tlbFindEntry(0xe0000400)).toBe(cpu.tlbEntries[7]);
  });

  test('still raises invalid-page and modification exceptions for matching high addresses', () => {
    mapPages(0xe0000000, 0, 0x19, 0x5b); // Invalid even page, read-only odd page.
    expect(() => cpu.translateRead(0xe0000400)).toThrow();
    expect(cpu.nextPC).toBe(0x80000180);
    expect(cpu.getControlU32(regs.controlCause) & 0x7c).toBe(8);
    expect(cpu.getControlU64(regs.controlBadVAddr)).toBe(0xffffffffe0000400n);
    expect(cpu.translateRead(0xe0001400)).toBe(0x1400);
    expect(() => cpu.translateWrite(0xe0001400)).toThrow();
    expect(cpu.nextPC).toBe(0x80000180);
    expect(cpu.getControlU32(regs.controlCause) & 0x7c).toBe(4);
    expect(cpu.getControlU64(regs.controlBadVAddr)).toBe(0xffffffffe0001400n);
  });
});
