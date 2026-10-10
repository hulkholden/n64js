import { beforeEach, describe, expect, test } from 'bun:test';
import { createHeadlessEmulator } from '../headless/headless_env.js';
import * as regs from './cpu0reg.js';
import { EmulatedException } from './emulated_exception.js';

const { Hardware } = await import('../hardware.js');
const { initCPU } = await import('./r4300.js');
const hardware = new Hardware({ save: 'Eeprom4k' }, { headless: true });
const cpu = hardware.cpu0;
const base = 0x12000000;

beforeEach(() => {
  initCPU(hardware);
  cpu.reset();
  cpu.setControlU32(regs.controlStatus, 0);
  hardware.ram.clear();
  n64js.getSyncFlow = () => null;
});

function map(c, index, address, lo0 = 0x87, lo1 = 0xc7, mask = 0) {
  c.setControlU32(regs.controlIndex, index);
  c.setControlU32(regs.controlPageMask, mask);
  c.setControlS64(regs.controlEntryHi, BigInt(address | 0));
  c.setControlU32(regs.controlEntryLo0, lo0);
  c.setControlU32(regs.controlEntryLo1, lo1);
  c.tlbWriteIndex();
}

function translationState(c) {
  return { control: [...c.controlRegU64], pc: c.pc, nextPC: c.nextPC, delayPC: c.delayPC };
}

function restoreTranslationState(c, state) {
  c.controlRegU64.set(state.control);
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
    map(cpu, 7, base);
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
      expect(cpu.translateReadInternal(base + 0x100000)).toBe(0);
      expect(cpu.translateReadInternal(base + 0x100004)).toBe(0);
      expect(scans).toBe(2);
      expect(cpu.translateRead(base)).toBe(0x2000);
      expect(scans).toBe(3);
    } finally {
      delete cpu.tlbFindEntryUncached;
    }
  });

  test('invalidates warm hits and misses after TLBWI, TLBWR and reset', () => {
    expect(cpu.translateReadInternal(base)).toBe(0);
    map(cpu, 7, base);
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
      map(cpu, 2, base, 1, 1);
      expect(translate(cpu, 'translateRead', base).result).toBe('TLBL E_VEC');
      cpu.reset();
      expect(cpu.tlbFindEntry(base)).toBeNull();
    } finally {
      cpu.setRandomSource();
    }
  });

  test('tags global matches with ASID to preserve earlier non-global matches', () => {
    map(cpu, 2, base | 0x12, 0x86, 0xc6);
    map(cpu, 7, base | 0x34, 0x107, 0x147);
    expect(cpu.translateRead(base)).toBe(0x4000);
    // Exercise both guest EntryHi transfer widths, not just raw setters.
    cpu.moveToControl32(regs.controlEntryHi, 0x12);
    expect(cpu.translateRead(base)).toBe(0x2000);
    cpu.moveToControl(regs.controlEntryHi, 0x34n);
    expect(cpu.translateRead(base)).toBe(0x4000);
    cpu.setControlU32(regs.controlIndex, 2);
    cpu.tlbRead();
    expect(cpu.translateRead(base)).toBe(0x2000);
    // Exception-side EntryHi writes change VPN bits but preserve the ASID.
    expect(translate(cpu, 'translateRead', 0x24000000).result).toBe('TLBL UT_VEC');
    expect(cpu.translateRead(base)).toBe(0x2000);
  });

  test('large-page hits do not hide overlapping smaller invalid/read-only pages', () => {
    map(cpu, 2, base + 0x2000, 1, 0xc3);
    map(cpu, 7, base, 7, 0x10007, 0x7fe000);
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
    const other = new Hardware({ save: 'Eeprom4k' }, { headless: true }).cpu0;
    map(cpu, 7, base);
    map(other, 7, base, 0x107, 0x147);
    expect(cpu.translateRead(base)).toBe(0x2000);
    expect(other.translateRead(base)).toBe(0x4000);
    map(other, 7, base, 1, 1);
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
          map(cpu, 7, address | 0x12, 0x1080 | flags, 0x2040 | flags, mask);
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
      const emulator = await createHeadlessEmulator({
        romBuffer: new ArrayBuffer(0x1000),
        rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' },
      });
      const { cpu0: c, hardware: h } = emulator;
      const pc = 0x80001000;
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
        map(c, 6, base, 0x87, 0x147); // Adjacent virtual pages, nonadjacent physical pages.
        if (training || flags !== null) {
          map(c, 7, target, 0x100 | (training ? 7 : flags), 7);
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
      for (let i = 0; i < 499; i++) {
        h.fragmentCache.lookupFragment(pc);
      }
      c.run(12);
      const fragment = h.fragmentCache.fragments.get(pc);
      expect(fragment?.func).toBeFunction();
      let reference;
      try {
        for (const compiled of [false, true]) {
          for (const cached of [false, true]) {
            delete c.tlbFindEntry;
            setup();
            if (!cached) {
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
