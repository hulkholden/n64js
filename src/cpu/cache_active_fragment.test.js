import { describe, expect, test } from 'bun:test';
import { createHeadlessEmulator } from '../headless/headless_env.js';
import { getPerformanceProfile, setPerformanceProfiling } from '../debug/performance_profile.js';

const entry = 0x80001000;
const cycles = 24;

async function fixture(op, delaySlot) {
  const emulator = await createHeadlessEmulator({
    romBuffer: new ArrayBuffer(0x1000),
    rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' },
  });
  const { cpu0: cpu, hardware } = emulator;
  n64js.getSyncFlow = () => null;
  const cache = (0xbcc00000 | (op << 16)) >>> 0; // CACHE op,0(a2)
  const words = delaySlot
    ? [0xac850040, 0x0000000f, 0x00e00008, cache] // SW; SYNC; JR; CACHE
    : [0xac850040, 0x0000000f, cache, 0x00e00008, 0];
  while (words.length < cycles + 16) {
    words.push(0);
  }
  words[16] = 0x34020001; // ORI v0,zero,1

  function setup(address, replacement = 0x34020002) {
    cpu.reset();
    cpu.controlCountValue = 0;
    hardware.rsp.reset();
    words.forEach((word, i) => hardware.ram.set32(0x1000 + i * 4, word));
    cpu.pc = entry;
    cpu.setRegS32Extend(4, 0xa0001000);
    cpu.setRegU32Extend(5, replacement);
    cpu.setRegS32Extend(6, address);
    cpu.setRegS32Extend(7, entry + 0x40);
  }
  function snapshot() {
    expect(emulator.fatalError()).toBeNull();
    return {
      pc: cpu.pc, delayPC: cpu.delayPC, count: cpu.controlCountValue,
      gpr: [...cpu.gprU64], target: hardware.ram.getU32(0x1040),
    };
  }
  function warm() {
    for (let i = 0; i < 499; i++) {
      cpu.hardware.fragmentCache.lookupFragment(entry);
    }
  }
  return { cpu, setup, snapshot, warm };
}

for (const profiled of [false, true]) {
  describe(`active CACHE invalidation (profiling ${profiled})`, () => {
    for (const op of [0, 0x10]) {
      for (const delaySlot of [false, true]) {
        for (const targetLine of [false, true]) {
          test(`op ${op}, delay slot ${delaySlot}, target line ${targetLine}`, async () => {
            const { cpu, setup, snapshot, warm } = await fixture(op, delaySlot);
            const address = entry + (targetLine ? 0x40 : 0) + (op === 0 ? 0x4000 : 0);
            try {
              setPerformanceProfiling(false);
              setup(address);
              cpu.run(cycles);
              const expected = snapshot();
              expect(cpu.getRegU32Lo(2)).toBe(2);

              // Train with an unrelated invalidation address, then invalidate
              // either the executing prefix or the modified target's cache line.
              setup(0x80003000, 0x34020001);
              warm();
              cpu.run(cycles);
              const fragment = cpu.hardware.fragmentCache.fragments.get(entry);
              expect(fragment?.func).toBeFunction();
              setup(address);
              cpu.hardware.fragmentCache.fragments.set(entry, fragment);
              // CPU reset now clears cache-line subscriptions as well as the
              // lookup map. Reinstall both for this deliberately saved trace.
              fragment.trackInstructions();
              setPerformanceProfiling(profiled);
              cpu.run(cycles);
              expect(snapshot()).toEqual(expected);
              if (profiled) {
                expect(getPerformanceProfile().compiledOps).toBeGreaterThan(0);
                if (!targetLine) {
                  expect(getPerformanceProfile().fragmentInvalidations).toBeGreaterThan(0);
                }
              }
            } finally {
              setPerformanceProfiling(false);
            }
          });
        }

        test(`op ${op}, delay slot ${delaySlot}: invalidation while tracing`, async () => {
          const { cpu, setup, snapshot, warm } = await fixture(op, delaySlot);
          try {
            setPerformanceProfiling(profiled);
            setup(entry);
            cpu.run(cycles);
            const expected = snapshot();
            setup(entry);
            warm();
            cpu.run(cycles);
            expect(snapshot()).toEqual(expected);
            const fragment = cpu.hardware.fragmentCache.fragments.get(entry);
            expect(fragment?.func).toBeUndefined();
            expect(fragment?.opsCompiled).toBe(0);
            // Re-entering the old address must still execute the SW/JR prefix.
            cpu.pc = entry;
            cpu.setRegU32Extend(5, 0x34020003);
            cpu.run(cycles);
            expect(cpu.getRegU32Lo(2)).toBe(3);
          } finally {
            setPerformanceProfiling(false);
          }
        });
      }
    }
  });
}
