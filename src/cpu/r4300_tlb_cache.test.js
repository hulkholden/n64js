import { beforeEach, describe, expect, test } from 'bun:test';
import * as regs from './cpu0reg.js';
import { EmulatedException } from './emulated_exception.js';
import {
  DEFAULT_PC,
  compileFragmentAt,
  createTestEmulator,
  createTestHardware,
  resetTestHardware,
  writeTLBEntry,
} from './test_helpers.js';

const hardware = createTestHardware();
const cpu = hardware.cpu0;
const base = 0x12000000;

beforeEach(() => {
  resetTestHardware(hardware);
});

function translationState(c) {
  return { control: [...c.controlRegU64], pc: c.pc, nextPC: c.nextPC, delayPC: c.delayPC };
}

function restoreTranslationState(c, state) {
  c.controlRegU64.set(state.control);
  c.setControlU64(regs.controlEntryHi, state.control[regs.controlEntryHi]);
  c.pc = state.pc;
  c.nextPC = state.nextPC;
  c.delayPC = state.delayPC;
}

function translate(c, method, address) {
  let result;
  try {
    result = c[method](address);
  } catch (error) {
    expect(error).toBeInstanceOf(EmulatedException);
    result = error.msg;
  }
  return { result, ...translationState(c) };
}

describe('cached TLB lookup', () => {
  test('reuses hits and misses, and keeps colliding virtual pages distinct', () => {
    writeTLBEntry(cpu, 7, base);
    const colliding = base + 0x10000000;
    const lookup = cpu.tlbFindEntryUncached;
    let scans = 0;
    cpu.tlbFindEntryUncached = function (address, asid) {
      scans++;
      return lookup.call(this, address, asid);
    };
    try {
      for (let i = 0; i < 3; i++) {
        expect(cpu.translateRead(base + i * 4)).toBe(0x2000 + i * 4);
      }
      expect(scans).toBe(1);
      expect(cpu.translateReadInternal(colliding)).toBe(0);
      expect(cpu.translateReadInternal(colliding + 4)).toBe(0);
      expect(scans).toBe(2);
      expect(cpu.translateRead(base)).toBe(0x2000);
      expect(scans).toBe(3);
    } finally {
      delete cpu.tlbFindEntryUncached;
    }
  });

  test('serves warm valid reads and dirty writes from cached 4 KiB page frames without calling tlbFindEntry', () => {
    writeTLBEntry(cpu, 6, base, 0x87, 0xc3); // Writable even page, read-only odd page.
    hardware.ram.set32(0x2010, 0x11223344);
    expect(cpu.translateRead(base)).toBe(0x2000);
    expect(cpu.translateRead(base + 0x1000)).toBe(0x3000);

    cpu.tlbFindEntry = () => { throw new Error('Unexpected tlbFindEntry on warm page-frame cache hit'); };
    cpu.getControlU32 = () => { throw new Error('Unexpected getControlU32 on warm page-frame cache hit'); };
    try {
      expect(cpu.translateReadInternal(base + 0x100)).toBe(0x2100);
      expect(cpu.readInstructionForValidation(base + 0x10)).toBe(0x11223344);

      cpu.tryTranslateRead = () => { throw new Error('Unexpected tryTranslateRead on warm translateRead'); };
      cpu.translateReadSlow = () => { throw new Error('Unexpected translateReadSlow on warm translateRead'); };
      expect(cpu.translateRead(base + 0xffc)).toBe(0x2ffc);
      expect(cpu.translateWrite(base + 0xffc)).toBe(0x2ffc);
      expect(cpu.translateRead(base + 0x1ffc)).toBe(0x3ffc);
    } finally {
      delete cpu.tlbFindEntry;
      delete cpu.getControlU32;
      delete cpu.tryTranslateRead;
      delete cpu.translateReadSlow;
    }

    // Read-only pages must not populate tlbWriteTags; writes still take the slow path and fault.
    expect(translate(cpu, 'translateWrite', base + 0x1ffc).result).toBe('Mod E_VEC');
  });

  test('calls tlbFindEntry only once on cold hits and on unmapped or invalid read faults', () => {
    writeTLBEntry(cpu, 6, base, 0x87, 0xc1); // Valid even page, invalid odd page.
    const findEntry = cpu.tlbFindEntry;
    let lookups = 0;
    cpu.tlbFindEntry = function (address) {
      lookups++;
      return findEntry.call(this, address);
    };
    try {
      expect(cpu.translateRead(base)).toBe(0x2000);
      expect(lookups).toBe(1);

      expect(translate(cpu, 'translateRead', base + 0x1000).result).toBe('TLBL E_VEC');
      expect(lookups).toBe(2);

      expect(translate(cpu, 'translateRead', 0x24000000).result).toBe('TLBL UT_VEC');
      expect(lookups).toBe(3);
    } finally {
      delete cpu.tlbFindEntry;
    }
  });

  test('avoids conflict misses and full-cache flushes across GoldenEye 0x70000000 and 0x7f000000 segments', () => {
    writeTLBEntry(cpu, 1, 0x70000000, 0x1f, 0x1, 0x7fe000);
    writeTLBEntry(cpu, 2, 0x7f01a000, 0xc61f, 0xc65f, 0);
    writeTLBEntry(cpu, 3, 0x7f008000, 0xc51f, 0xc55f, 0);
    const lookup = cpu.tlbFindEntryUncached;
    let scans = 0;
    cpu.tlbFindEntryUncached = function (address, asid) {
      scans++;
      return lookup.call(this, address, asid);
    };
    try {
      // Same low 12-bit page offsets (0x01a, 0x008) in 0x70000000 and 0x7f000000.
      const pages = [0x7001a000, 0x7f01a000, 0x7f01b000, 0x70008000, 0x7f008000, 0x7011a000, 0x7021a000];
      for (const va of pages) {
        cpu.translateRead(va);
      }
      expect(scans).toBe(pages.length);
      for (const va of pages) {
        cpu.translateRead(va + 0x100);
      }
      expect(scans).toBe(pages.length);

      // Replacing one 4 KiB TLB entry invalidates only its old and new page pairs.
      writeTLBEntry(cpu, 3, 0x7f020000, 0xd51f, 0xd55f, 0);
      for (const va of [0x7001a000, 0x7f01a000, 0x7f01b000, 0x70008000, 0x7011a000, 0x7021a000]) {
        cpu.translateRead(va + 0x200);
      }
      expect(scans).toBe(pages.length);
      expect(cpu.translateReadInternal(0x7f008000)).toBe(0);
      expect(cpu.translateRead(0x7f020000)).toBe(0x354000);
      expect(scans).toBe(pages.length + 2);
    } finally {
      delete cpu.tlbFindEntryUncached;
    }
  });

  test('invalidates warm hits and misses after TLBWI, TLBWR and reset', () => {
    expect(cpu.translateReadInternal(base)).toBe(0);
    writeTLBEntry(cpu, 7, base);
    expect(cpu.translateRead(base)).toBe(0x2000);
    cpu.setControlU32(regs.controlEntryLo0, 0x107);
    cpu.tlbWriteIndex();
    expect(cpu.translateWrite(base)).toBe(0x4000);
    cpu.setControlU32(regs.controlEntryLo0, 0x187);
    cpu.setRandomSource(() => 7 / 32);
    try {
      cpu.tlbWriteRandom();
      expect(cpu.translateRead(base)).toBe(0x6000);
      // A write to a different, earlier entry changes first-match priority.
      writeTLBEntry(cpu, 2, base, 1, 1);
      expect(translate(cpu, 'translateRead', base).result).toBe('TLBL E_VEC');
      cpu.reset();
      expect(cpu.tlbFindEntry(base)).toBeNull();
    } finally {
      cpu.setRandomSource();
    }
  });

  test('tags global matches with ASID to preserve earlier non-global matches', () => {
    writeTLBEntry(cpu, 2, base | 0x12, 0x86, 0xc6);
    writeTLBEntry(cpu, 7, base | 0x34, 0x107, 0x147);
    expect(cpu.translateRead(base)).toBe(0x4000);
    // Exercise both guest EntryHi transfer widths, not just raw setters.
    cpu.moveToControl32(regs.controlEntryHi, 0x12);
    expect(cpu.currentASID).toBe(0x12);
    expect(cpu.translateRead(base)).toBe(0x2000);
    cpu.moveToControl(regs.controlEntryHi, 0x34n);
    expect(cpu.currentASID).toBe(0x34);
    expect(cpu.translateRead(base)).toBe(0x4000);
    cpu.setControlU32(regs.controlEntryHi, 0x12);
    expect(cpu.translateRead(base)).toBe(0x2000);
    cpu.setControlS32Extend(regs.controlEntryHi, 0x34);
    expect(cpu.translateRead(base)).toBe(0x4000);
    cpu.setControlU64(regs.controlEntryHi, 0x12n);
    expect(cpu.translateRead(base)).toBe(0x2000);
    cpu.maskControlBits32(regs.controlEntryHi, 0xff, 0x34);
    expect(cpu.translateRead(base)).toBe(0x4000);
    cpu.clearControlBits32(regs.controlEntryHi, 0x24);
    cpu.setControlBits32(regs.controlEntryHi, 0x02);
    expect(cpu.translateRead(base)).toBe(0x2000);
    cpu.maskControlBits64(regs.controlEntryHi, 0xffn, 0x34n);
    expect(cpu.translateRead(base)).toBe(0x4000);
    cpu.setControlU32(regs.controlIndex, 2);
    cpu.tlbRead();
    expect(cpu.currentASID).toBe(0x12);
    expect(cpu.translateRead(base)).toBe(0x2000);
    // Exception-side EntryHi writes change VPN bits but preserve the ASID.
    expect(translate(cpu, 'translateRead', 0x24000000).result).toBe('TLBL UT_VEC');
    expect(cpu.currentASID).toBe(0x12);
    expect(cpu.translateRead(base)).toBe(0x2000);
    cpu.reset();
    expect(cpu.currentASID).toBe(0);
  });

  test('large-page hits do not hide overlapping smaller invalid/read-only pages', () => {
    writeTLBEntry(cpu, 2, base + 0x2000, 1, 0xc3);
    writeTLBEntry(cpu, 7, base, 7, 0x10007, 0x7fe000);
    expect(cpu.translateRead(base)).toBe(0);
    expect(translate(cpu, 'translateRead', base + 0x2000).result).toBe('TLBL E_VEC');
    expect(cpu.translateRead(base + 0x3000)).toBe(0x3000);
    expect(translate(cpu, 'translateWrite', base + 0x3000).result).toBe('Mod E_VEC');
    expect(cpu.translateRead(base + 0x4000)).toBe(0x4000);
    expect(cpu.translateRead(base + 0x400000)).toBe(0x400000);
    expect(cpu.translateRead(base + 0x7ffffc)).toBe(0x7ffffc);
    expect(translate(cpu, 'translateRead', base + 0x800000).result).toBe('TLBL UT_VEC');
  });

  test('keeps separate CPUs isolated, including updates and resets', () => {
    const other = createTestHardware().cpu0;
    writeTLBEntry(cpu, 7, base);
    writeTLBEntry(other, 7, base, 0x107, 0x147);
    expect(cpu.translateRead(base)).toBe(0x2000);
    expect(other.translateRead(base)).toBe(0x4000);
    writeTLBEntry(other, 7, base, 1, 1);
    expect(other.translateReadInternal(base)).toBe(0);
    expect(cpu.translateRead(base)).toBe(0x2000);
    other.reset();
    expect(cpu.translateRead(base)).toBe(0x2000);
  });

  test('direct cached and uncached RAM segments bypass TLB lookup', () => {
    cpu.tlbFindEntry = () => { throw new Error('Unexpected TLB lookup'); };
    try {
      for (const address of [0x80003000, 0xa0003000]) {
        cpu.store32fast(address | 0, 0x12345678);
        expect(cpu.loadS32fast(address | 0)).toBe(0x12345678);
      }
    } finally {
      delete cpu.tlbFindEntry;
    }
  });

  test('matches uncached translation and fault state across masks, ASIDs and permissions', () => {
    const masks = [0, 0x6000, 0x1e000, 0x7e000, 0x1fe000, 0x7fe000, 0x1ffe000, 0xaaa000];
    for (const address of [0, base, 0xe0000000]) {
      for (const mask of masks) {
        for (const flags of [0, 1, 2, 3, 6, 7]) {
          writeTLBEntry(cpu, 7, address | 0x12, 0x1080 | flags, 0x2040 | flags, mask);
          const pageSize = cpu.tlbEntries[7].checkbit;
          for (const asid of [0x12, 0x34]) {
            cpu.setControlU32(regs.controlEntryHi, asid);
            for (const offset of [0, 4, pageSize - 4, pageSize, pageSize * 2 - 4, pageSize * 2]) {
              const va = (address + offset) >>> 0;
              for (const method of ['translateRead', 'translateWrite', 'translateReadInternal', 'readInstructionForValidation']) {
                cpu.pc = 0x80001004;
                cpu.nextPC = cpu.pc + 4;
                cpu.delayPC = 0x80002000;
                cpu.setControlU32(regs.controlStatus, 0);
                const initial = translationState(cpu);
                // Fill the cache, then compare the warm result with the full scan.
                translate(cpu, method, va);
                restoreTranslationState(cpu, initial);
                const cached = translate(cpu, method, va);
                restoreTranslationState(cpu, initial);
                cpu.invalidateTLBCache();
                cpu.tlbFindEntry = cpu.tlbFindEntryUncached;
                try {
                  expect(cached).toEqual(translate(cpu, method, va));
                } finally {
                  delete cpu.tlbFindEntry;
                }
              }
            }
          }
        }
      }
    }
  });
});

describe('cached translations during execution', () => {
  for (const [name, flags, store, cause] of [
    ['writable', 7, true, 0],
    ['read-only load', 3, false, 0],
    ['read-only store', 3, true, 4],
    ['invalid load', 1, false, 8],
    ['invalid store', 1, true, 12],
    ['missing load', null, false, 8],
    ['missing store', null, true, 12],
  ]) {
    test(`${name} matches uncached interpreter and compiled delay-slot accesses`, async () => {
      const emulator = await createTestEmulator();
      const { cpu0: c, hardware: h } = emulator;
      const pc = DEFAULT_PC;
      const target = base + 0x2000;
      const words = [
        0x8c820000, // LW v0, 0(a0): last word in the even page.
        0xac820004, // SW v0, 4(a0): first word in the odd page.
        0x10000001, // BEQ zero, zero, +1.
        store ? 0xaca20000 : 0x8ca20000, // SW/LW v0, 0(a1) in the delay slot.
      ];
      function setup(training = false) {
        c.reset();
        c.controlCountValue = 0;
        c.opsExecuted = 0;
        c.setControlU32(regs.controlStatus, 0);
        h.rsp.reset();
        h.ram.clear();
        words.forEach((word, i) => h.ram.set32(0x1000 + i * 4, word));
        writeTLBEntry(c, 6, base, 0x87, 0x147); // Adjacent virtual pages, nonadjacent physical pages.
        if (training || flags !== null) {
          writeTLBEntry(c, 7, target, 0x100 | (training ? 7 : flags), 7);
        }
        h.ram.set32(0x2ffc, 0x12345678);
        h.ram.set32(0x4000, 0xabcdef01);
        c.setRegS32Extend(4, base + 0xffc);
        c.setRegS32Extend(5, target);
        c.pc = pc;
        // Warm valid, invalid and absent entries through a non-faulting path.
        for (const va of [base + 0xffc, base + 0x1000, target]) {
          c.translateReadInternal(va);
        }
      }
      function snapshot() {
        expect(emulator.fatalError()).toBeNull();
        return {
          // nextPC is interpreter scratch state, not committed CPU state.
          control: [...c.controlRegU64], pc: c.pc, delayPC: c.delayPC,
          gpr: [...c.gprU64], count: c.controlCountValue,
          memory: h.ram.u8.slice(0x2000, 0x6000),
          rspPC: h.rsp.pc, rspHalted: h.rsp.halted,
        };
      }
      setup(true);
      const fragment = compileFragmentAt(c, pc, 12);
      let reference;
      try {
        for (const compiled of [false, true]) {
          for (const cached of [false, true]) {
            delete c.tlbFindEntry;
            setup();
            if (!cached) {
              c.invalidateTLBCache();
              c.tlbFindEntry = c.tlbFindEntryUncached;
            }
            if (compiled) {
              h.fragmentCache.fragments.set(pc, fragment);
            }
            const executions = fragment.executionCount;
            c.run(12);
            if (compiled) {
              expect(fragment.executionCount).toBe(executions + 1);
            }
            const state = snapshot();
            reference ??= state;
            expect(state).toEqual(reference);
            expect(h.ram.getU32(0x5000)).toBe(0x12345678);
            expect(c.getControlU32(regs.controlCause)).toBe(cause ? (0x80000000 | cause) >>> 0 : 0);
            if (cause) {
              expect(c.getControlU32(regs.controlEPC)).toBe(pc + 8);
              expect(c.getControlU32(regs.controlBadVAddr)).toBe(target);
              expect(c.pc).toBe((flags === null ? 0x80000000 : 0x80000180) + 32);
            }
          }
        }
      } finally {
        delete c.tlbFindEntry;
      }
    });
  }
});
