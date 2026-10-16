import { afterEach, describe, expect, test } from 'bun:test';
import { getPerformanceProfile, setPerformanceProfiling } from '../debug/performance_profile.js';
import * as regs from './cpu0reg.js';
import { Fragment } from './fragments.js';
import {
  ADDIU_T0_1,
  DEFAULT_PC,
  JR_RA,
  createTestEmulator,
  trainLoopAt,
  trainTraceAt,
  warmFragmentLookup,
} from './test_helpers.js';

afterEach(() => setPerformanceProfiling(false));

async function fixture() {
  const emulator = await createTestEmulator();
  emulator.cpu0.reset();
  return emulator;
}

function resume(emulator, pc = DEFAULT_PC, cycles = 40) {
  emulator.cpu0.pc = pc;
  emulator.cpu0.delayPC = null;
  emulator.cpu0.setRegS32Extend(31, pc);
  const before = emulator.cpu0.getRegU32Lo(8);
  emulator.cpu0.run(cycles);
  expect(emulator.fatalError()).toBeNull();
  return emulator.cpu0.getRegU32Lo(8) - before;
}

for (const profiled of [false, true]) {
  describe(`instruction-cache reuse (profiling ${profiled})`, () => {
    for (const [name, method] of [['index', 'invalidateIndex'], ['hit', 'invalidateEntry']]) {
      test(`${name}: unchanged instructions reuse the same function, including subsequent invalidations`, async () => {
        const e = await fixture();
        const fragment = trainLoopAt(e);
        const original = fragment.func;
        setPerformanceProfiling(profiled);
        for (let i = 0; i < 3; i++) {
          e.hardware.fragmentCache[method](DEFAULT_PC + 4);
          expect(fragment.func).toBeUndefined();
          expect(fragment.cachedFunc).toBe(original);
          expect(resume(e)).toBe(20);
          expect(fragment.func).toBe(original);
          expect(fragment.cachedFunc).toBeUndefined();
        }
        if (profiled) {
          expect(getPerformanceProfile()).toMatchObject({ fragmentCompilations: 0, fragmentRevalidations: 3, fragmentReuses: 3 });
        }
      });

      test(`${name}: writes after invalidation and successor lookup cannot execute the old delay slot`, async () => {
        const e = await fixture();
        const fragment = trainLoopAt(e);
        const original = fragment.func;
        const caller = new Fragment(0x80002000, e.hardware.fragmentCache);
        caller.nextFragments[2] = fragment;
        e.hardware.fragmentCache[method](DEFAULT_PC);
        // Lookup must not validate: an interrupt or guest code can still write
        // RAM before the fragment is actually dispatched.
        expect(caller.getNextFragment(DEFAULT_PC, 2)).toBe(fragment);
        expect(fragment.func).toBeUndefined();
        e.hardware.ram.set32(0x1004, ADDIU_T0_1 + 1);
        setPerformanceProfiling(profiled);
        expect(resume(e)).toBe(40);
        expect(fragment.func).not.toBe(original);
        if (profiled) {
          expect(getPerformanceProfile().fragmentReuses).toBe(0);
        }
      });
    }

    test('full cache sweeps invalidate each trace only once and preserve the pending candidate', async () => {
      const e = await fixture();
      // A trace spanning several cache lines, with a nonadjacent branch target.
      e.hardware.ram.set32(0x1000, 0x08000440); // J 0x80001100
      e.hardware.ram.set32(0x1004, 0);
      e.hardware.ram.set32(0x1100, ADDIU_T0_1);
      e.hardware.ram.set32(0x1104, JR_RA);
      e.hardware.ram.set32(0x1108, 0);
      const fragment = trainTraceAt(e);
      const original = fragment.func;
      expect(fragment.instructionPCs).toContain(0x80001100);
      const compiled = [...e.hardware.fragmentCache.fragments.values()].filter(f => f.func).length;
      const generation = fragment.generation;
      setPerformanceProfiling(profiled);
      for (let sweep = 0; sweep < 3; sweep++) {
        for (let offset = 0; offset < 0x4000; offset += 32) {
          e.hardware.fragmentCache.invalidateIndex(0x80000000 + offset);
        }
      }
      expect(fragment.generation).toBe(generation + 1);
      expect(fragment.cachedFunc).toBe(original);
      if (profiled) {
        expect(getPerformanceProfile().fragmentInvalidations).toBe(compiled);
      }
      resume(e, DEFAULT_PC, 100);
      expect(fragment.func).toBe(original);

      // A hole in the traced PC range is not an instruction-cache dependency.
      e.hardware.fragmentCache.invalidateEntry(0x80001080);
      expect(fragment.func).toBe(original);
      e.hardware.fragmentCache.invalidateEntry(0x80001100);
      e.hardware.ram.set32(0x1100, ADDIU_T0_1 + 1);
      expect(resume(e, DEFAULT_PC, 100)).toBe(40);
      expect(fragment.func).not.toBe(original);
    });

    test('changes to data in the same line do not force recompilation', async () => {
      const e = await fixture();
      const fragment = trainLoopAt(e);
      const original = fragment.func;
      e.hardware.fragmentCache.invalidateEntry(DEFAULT_PC);
      e.hardware.ram.set32(0x1010, 0xdeadbeef);
      setPerformanceProfiling(profiled);
      expect(resume(e)).toBe(20);
      expect(fragment.func).toBe(original);
    });

    test('revalidates mapped instruction bytes after a TLB remap', async () => {
      const e = await fixture();
      const cpu = e.cpu0;
      const pc = 0x00400000;
      cpu.tlbEntries[0].update(0, 0, BigInt(pc), 0x5f, 0x9f);
      const fragment = trainLoopAt(e, pc, 0x1000);
      const original = fragment.func;
      e.hardware.fragmentCache.invalidateIndex(pc);
      setPerformanceProfiling(profiled);
      expect(resume(e, pc)).toBe(20);
      expect(fragment.func).toBe(original);

      e.hardware.fragmentCache.invalidateIndex(pc);
      e.hardware.ram.set32(0x3000, JR_RA);
      e.hardware.ram.set32(0x3004, ADDIU_T0_1 + 1);
      cpu.tlbEntries[0].update(0, 0, BigInt(pc), 0xdf, 0x11f);
      expect(resume(e, pc)).toBe(40);
      expect(fragment.func).not.toBe(original);
    });

    test('an inaccessible later instruction faults only after executing the valid prefix', async () => {
      const e = await fixture();
      const cpu = e.cpu0;
      const pc = 0x00400ff8;
      cpu.tlbEntries[0].update(0, 0, 0x00400000n, 0x5f, 0x9f);
      e.hardware.ram.set32(0x1ff8, 0x34020001); // ORI v0,zero,1
      e.hardware.ram.set32(0x1ffc, ADDIU_T0_1);
      e.hardware.ram.set32(0x2000, JR_RA);
      e.hardware.ram.set32(0x2004, 0);
      trainTraceAt(e, pc);
      e.hardware.fragmentCache.invalidateIndex(pc);
      cpu.tlbEntries[0].update(0, 0, 0x00400000n, 0x5f, 0x9d); // Invalid odd page.
      cpu.setControlU32(regs.controlStatus, 0);
      cpu.setRegU32Extend(2, 0);
      setPerformanceProfiling(profiled);
      expect(resume(e, pc, 3)).toBe(1);
      expect(cpu.getRegU32Lo(2)).toBe(1);
      expect(cpu.getControlU32(regs.controlEPC)).toBe(pc + 8);
      expect(cpu.getControlU32(regs.controlBadVAddr)).toBe(pc + 8);
      expect(cpu.getControlU32(regs.controlCause) & 0x7c).toBe(8);
      expect(cpu.pc).toBe(0x80000180);
    });
  });
}

describe('instruction-cache isolation and validation', () => {
  test('reset drops pending code and its cache subscriptions', async () => {
    const e = await fixture();
    const old = trainLoopAt(e);
    const original = old.func;
    e.hardware.fragmentCache.invalidateIndex(DEFAULT_PC);
    const generation = old.generation;
    e.cpu0.reset();
    const replacement = trainLoopAt(e);
    e.hardware.fragmentCache.invalidateIndex(DEFAULT_PC);
    expect(old.generation).toBe(generation);
    expect(replacement.cachedFunc).not.toBe(original);
    expect(resume(e)).toBe(20);
  });

  test('creating, invalidating and resetting hardware leaves another instance\'s fragments intact', async () => {
    const first = await fixture();
    const firstFragment = trainLoopAt(first);
    const firstFunction = firstFragment.func;
    const second = await fixture();
    const secondFragment = trainLoopAt(second);
    const secondFunction = secondFragment.func;
    expect(first.hardware.fragmentCache.fragments.get(DEFAULT_PC)).toBe(firstFragment);
    expect(firstFragment.func).toBe(firstFunction);
    expect(secondFragment).not.toBe(firstFragment);

    // Execute CACHE on the first CPU while the second is the selected emulator.
    // Invalidation must use the receiver's hardware, not the global CPU binding.
    first.cpu0.setRegS32Extend(4, DEFAULT_PC);
    first.cpu0.execCACHE(0, 4, 0);
    expect(firstFragment.func).toBeUndefined();
    expect(firstFragment.cachedFunc).toBe(firstFunction);
    expect(secondFragment.func).toBe(secondFunction);

    first.hardware.reset();
    expect(first.hardware.fragmentCache.fragments.size).toBe(0);
    expect(second.hardware.fragmentCache.fragments.get(DEFAULT_PC)).toBe(secondFragment);
    expect(secondFragment.func).toBe(secondFunction);
    // The second cache still owns its subscriptions after the first resets.
    second.hardware.fragmentCache.invalidateEntry(DEFAULT_PC);
    expect(secondFragment.cachedFunc).toBe(secondFunction);
  });

  test('hot-entry counts and successor lookup belong to the fragment\'s hardware', async () => {
    const first = await fixture();
    const firstCache = first.hardware.fragmentCache;
    for (let i = 0; i < 499; i++) {
      expect(firstCache.lookupFragment(DEFAULT_PC)).toBeNull();
    }
    const second = await fixture();
    const secondCache = second.hardware.fragmentCache;
    expect(secondCache.lookupFragment(DEFAULT_PC)).toBeNull();
    const firstFragment = firstCache.lookupFragment(DEFAULT_PC);
    expect(firstFragment).toBeInstanceOf(Fragment);
    warmFragmentLookup(second.hardware, DEFAULT_PC);
    const secondFragment = secondCache.fragments.get(DEFAULT_PC);
    expect(secondFragment).toBeInstanceOf(Fragment);
    expect(secondFragment).not.toBe(firstFragment);

    const caller = new Fragment(DEFAULT_PC + 0x1000, firstCache);
    expect(caller.getNextFragment(DEFAULT_PC, 2)).toBe(firstFragment);
    firstCache.reset();
    expect(firstCache.lookupFragment(DEFAULT_PC)).toBeNull();
    expect(secondCache.lookupFragment(DEFAULT_PC)).toBe(secondFragment);
  });

  test('validation rejects unmapped, invalid, wrong-ASID, out-of-RAM and device addresses without side effects', async () => {
    const e = await fixture();
    const cpu = e.cpu0;
    const pc = 0x00400000;
    const before = [...cpu.controlRegU64];
    expect(cpu.readInstructionForValidation(pc)).toBeNull();
    cpu.tlbEntries[0].update(0, 0, BigInt(pc), 0x5d, 0x9d); // Invalid pages.
    expect(cpu.readInstructionForValidation(pc)).toBeNull();
    cpu.tlbEntries[0].update(0, 0, BigInt(pc + 1), 0x5e, 0x9e); // ASID 1, not global.
    expect(cpu.readInstructionForValidation(pc)).toBeNull();
    cpu.tlbEntries[0].update(0, 0, BigInt(pc), 0x2001f, 0x2005f); // Physical 8 MiB.
    expect(cpu.readInstructionForValidation(pc)).toBeNull();
    expect(cpu.readInstructionForValidation(0x80800000)).toBeNull();
    expect(cpu.readInstructionForValidation(0xa4600000)).toBeNull();
    expect(cpu.readInstructionForValidation(DEFAULT_PC + 1)).toBeNull();
    expect([...cpu.controlRegU64]).toEqual(before);
    e.hardware.ram.set32(0x1000, 0xffffffff);
    expect(cpu.readInstructionForValidation(DEFAULT_PC)).toBe(0xffffffff);
    expect(cpu.readInstructionForValidation(0xa0001000)).toBe(0xffffffff);
  });
});
