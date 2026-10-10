import { afterEach, describe, expect, test } from 'bun:test';
import { createHeadlessEmulator } from '../headless/headless_env.js';
import { getPerformanceProfile, setPerformanceProfiling } from '../debug/performance_profile.js';
import { Fragment } from './fragments.js';
import * as regs from './cpu0reg.js';

const entry = 0x80001000;
const increment = 0x25080001; // ADDIU t0,t0,1
const jrRA = 0x03e00008;

afterEach(() => setPerformanceProfiling(false));

async function fixture() {
  const e = await createHeadlessEmulator({
    romBuffer: new ArrayBuffer(0x1000),
    rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' },
  });
  e.cpu0.reset();
  n64js.getSyncFlow = () => null;
  return e;
}

function train(e, pc = entry) {
  e.cpu0.pc = pc;
  e.cpu0.setRegS32Extend(31, pc);
  e.cpu0.run(12000);
  const fragment = e.hardware.fragmentCache.fragments.get(pc);
  expect(fragment?.func).toBeFunction();
  expect(e.fatalError()).toBeNull();
  return fragment;
}

function loop(e, pc = entry, physical = pc & 0x7fffff) {
  e.hardware.ram.set32(physical, jrRA);
  e.hardware.ram.set32(physical + 4, increment);
  return train(e, pc);
}

function resume(e, pc = entry, cycles = 40) {
  e.cpu0.pc = pc;
  e.cpu0.delayPC = null;
  e.cpu0.setRegS32Extend(31, pc);
  const before = e.cpu0.getRegU32Lo(8);
  e.cpu0.run(cycles);
  expect(e.fatalError()).toBeNull();
  return e.cpu0.getRegU32Lo(8) - before;
}

for (const profiled of [false, true]) {
  describe(`instruction-cache reuse (profiling ${profiled})`, () => {
    for (const [name, method] of [['index', 'invalidateIndex'], ['hit', 'invalidateEntry']]) {
      test(`${name}: unchanged instructions reuse the same function, including subsequent invalidations`, async () => {
        const e = await fixture();
        const fragment = loop(e), original = fragment.func;
        setPerformanceProfiling(profiled);
        for (let i = 0; i < 3; i++) {
          e.hardware.fragmentCache[method](entry + 4);
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
        const fragment = loop(e), original = fragment.func;
        const caller = new Fragment(0x80002000, e.hardware.fragmentCache);
        caller.nextFragments[2] = fragment;
        e.hardware.fragmentCache[method](entry);
        // Lookup must not validate: an interrupt or guest code can still write
        // RAM before the fragment is actually dispatched.
        expect(caller.getNextFragment(entry, 2)).toBe(fragment);
        expect(fragment.func).toBeUndefined();
        e.hardware.ram.set32(0x1004, increment + 1);
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
      e.hardware.ram.set32(0x1100, increment);
      e.hardware.ram.set32(0x1104, jrRA);
      e.hardware.ram.set32(0x1108, 0);
      const fragment = train(e), original = fragment.func;
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
      resume(e, entry, 100);
      expect(fragment.func).toBe(original);

      // A hole in the traced PC range is not an instruction-cache dependency.
      e.hardware.fragmentCache.invalidateEntry(0x80001080);
      expect(fragment.func).toBe(original);
      e.hardware.fragmentCache.invalidateEntry(0x80001100);
      e.hardware.ram.set32(0x1100, increment + 1);
      expect(resume(e, entry, 100)).toBe(40);
      expect(fragment.func).not.toBe(original);
    });

    test('changes to data in the same line do not force recompilation', async () => {
      const e = await fixture();
      const fragment = loop(e), original = fragment.func;
      e.hardware.fragmentCache.invalidateEntry(entry);
      e.hardware.ram.set32(0x1010, 0xdeadbeef);
      setPerformanceProfiling(profiled);
      expect(resume(e)).toBe(20);
      expect(fragment.func).toBe(original);
    });

    test('revalidates mapped instruction bytes after a TLB remap', async () => {
      const e = await fixture(), cpu = e.cpu0;
      const pc = 0x00400000;
      cpu.tlbEntries[0].update(0, 0, BigInt(pc), 0x5f, 0x9f);
      const fragment = loop(e, pc, 0x1000), original = fragment.func;
      e.hardware.fragmentCache.invalidateIndex(pc);
      setPerformanceProfiling(profiled);
      expect(resume(e, pc)).toBe(20);
      expect(fragment.func).toBe(original);

      e.hardware.fragmentCache.invalidateIndex(pc);
      e.hardware.ram.set32(0x3000, jrRA);
      e.hardware.ram.set32(0x3004, increment + 1);
      cpu.tlbEntries[0].update(0, 0, BigInt(pc), 0xdf, 0x11f);
      expect(resume(e, pc)).toBe(40);
      expect(fragment.func).not.toBe(original);
    });

    test('an inaccessible later instruction faults only after executing the valid prefix', async () => {
      const e = await fixture(), cpu = e.cpu0;
      const pc = 0x00400ff8;
      cpu.tlbEntries[0].update(0, 0, 0x00400000n, 0x5f, 0x9f);
      e.hardware.ram.set32(0x1ff8, 0x34020001); // ORI v0,zero,1
      e.hardware.ram.set32(0x1ffc, increment);
      e.hardware.ram.set32(0x2000, jrRA);
      e.hardware.ram.set32(0x2004, 0);
      train(e, pc);
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

test('reset drops pending code and its cache subscriptions', async () => {
  const e = await fixture();
  const old = loop(e), original = old.func;
  e.hardware.fragmentCache.invalidateIndex(entry);
  const generation = old.generation;
  e.cpu0.reset();
  const replacement = loop(e);
  e.hardware.fragmentCache.invalidateIndex(entry);
  expect(old.generation).toBe(generation);
  expect(replacement.cachedFunc).not.toBe(original);
  expect(resume(e)).toBe(20);
});

test('creating, invalidating and resetting hardware leaves another instance\'s fragments intact', async () => {
  const first = await fixture();
  const firstFragment = loop(first), firstFunction = firstFragment.func;
  const second = await fixture();
  const secondFragment = loop(second), secondFunction = secondFragment.func;
  expect(first.hardware.fragmentCache.fragments.get(entry)).toBe(firstFragment);
  expect(firstFragment.func).toBe(firstFunction);
  expect(secondFragment).not.toBe(firstFragment);

  // Execute CACHE on the first CPU while the second is the selected emulator.
  // Invalidation must use the receiver's hardware, not the global CPU binding.
  first.cpu0.setRegS32Extend(4, entry);
  first.cpu0.execCACHE(0, 4, 0);
  expect(firstFragment.func).toBeUndefined();
  expect(firstFragment.cachedFunc).toBe(firstFunction);
  expect(secondFragment.func).toBe(secondFunction);

  first.hardware.reset();
  expect(first.hardware.fragmentCache.fragments.size).toBe(0);
  expect(second.hardware.fragmentCache.fragments.get(entry)).toBe(secondFragment);
  expect(secondFragment.func).toBe(secondFunction);
  // The second cache still owns its subscriptions after the first resets.
  second.hardware.fragmentCache.invalidateEntry(entry);
  expect(secondFragment.cachedFunc).toBe(secondFunction);
});

test('hot-entry counts and successor lookup belong to the fragment\'s hardware', async () => {
  const first = await fixture();
  const firstCache = first.hardware.fragmentCache;
  for (let i = 0; i < 499; i++) {
    expect(firstCache.lookupFragment(entry)).toBeNull();
  }
  const second = await fixture();
  const secondCache = second.hardware.fragmentCache;
  expect(secondCache.lookupFragment(entry)).toBeNull();
  const firstFragment = firstCache.lookupFragment(entry);
  expect(firstFragment).toBeInstanceOf(Fragment);
  for (let i = 0; i < 499; i++) {
    secondCache.lookupFragment(entry);
  }
  const secondFragment = secondCache.fragments.get(entry);
  expect(secondFragment).toBeInstanceOf(Fragment);
  expect(secondFragment).not.toBe(firstFragment);

  const caller = new Fragment(entry + 0x1000, firstCache);
  expect(caller.getNextFragment(entry, 2)).toBe(firstFragment);
  firstCache.reset();
  expect(firstCache.lookupFragment(entry)).toBeNull();
  expect(secondCache.lookupFragment(entry)).toBe(secondFragment);
});

test('validation rejects unmapped, invalid, wrong-ASID, out-of-RAM and device addresses without side effects', async () => {
  const e = await fixture(), cpu = e.cpu0;
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
  expect(cpu.readInstructionForValidation(entry + 1)).toBeNull();
  expect([...cpu.controlRegU64]).toEqual(before);
  e.hardware.ram.set32(0x1000, 0xffffffff);
  expect(cpu.readInstructionForValidation(entry)).toBe(0xffffffff);
  expect(cpu.readInstructionForValidation(0xa0001000)).toBe(0xffffffff);
});
