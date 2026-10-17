import { afterEach, describe, expect, test } from 'bun:test';
import { createHeadlessEmulator } from '../headless/headless_env.js';
import { getPerformanceProfile, setPerformanceProfiling } from '../debug/performance_profile.js';
import * as regs from './cpu0reg.js';

const entry = 0x00400000;
const cycles = 12;
const tlbwi = 0x42000002;
const tlbwr = 0x42000006;
const tlbr = 0x42000001;
const mtc0EntryHi = 0x40885000; // MTC0 t0,EntryHi
const dmtc0EntryHi = 0x40a85000;
const setV0 = value => 0x34020000 | value;

afterEach(() => setPerformanceProfiling(false));

async function fixture() {
  const e = await createHeadlessEmulator({
    romBuffer: new ArrayBuffer(0x1000),
    rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' },
  });
  const { cpu0: cpu, hardware: h } = e;
  n64js.getSyncFlow = () => null;
  cpu.setRandomSource(() => 0);

  function reset(prepare) {
    setPerformanceProfiling(false);
    cpu.reset();
    cpu.controlCountValue = 0;
    cpu.opsExecuted = 0;
    cpu.setControlU32(regs.controlStatus, 0);
    h.rsp.reset();
    h.ram.clear();
    h.ram.set32(0x1000, setV0(1));
    h.ram.set32(0x3000, setV0(2));
    cpu.pc = entry;
    prepare();
  }

  function snapshot() {
    expect(e.fatalError()).toBeNull();
    return {
      pc: cpu.pc, delayPC: cpu.delayPC, gpr: [...cpu.gprU64],
      control: [...cpu.controlRegU64], count: cpu.controlCountValue,
      ops: cpu.opsExecuted, rspPC: h.rsp.pc, rspHalted: h.rsp.halted,
    };
  }

  function train(pc = entry, ticks = cycles) {
    cpu.pc = pc;
    for (let i = 0; i < 499; i++) {
      h.fragmentCache.lookupFragment(pc);
    }
    cpu.run(ticks);
    const fragment = h.fragmentCache.fragments.get(pc);
    expect(fragment?.func).toBeFunction();
    return fragment;
  }

  function install(fragment) {
    h.fragmentCache.fragments.set(fragment.entryPC, fragment);
    fragment.trackInstructions();
  }

  function guest(word) {
    const pc = cpu.pc;
    h.ram.set32(0x5000, word);
    cpu.pc = 0xa0005000;
    cpu.run(9); // Include CP0 hazard spacing, as in the issue's reproduction.
    cpu.pc = pc;
  }

  function stage({ index = 0, address = entry, physical = 0x1000, odd = 0x2000,
    valid = true, global = true, asid = 0, mask = 0 } = {}) {
    cpu.setControlU32(regs.controlIndex, index);
    cpu.setControlU32(regs.controlPageMask, mask);
    cpu.setControlU64(regs.controlEntryHi, BigInt.asUintN(64, BigInt((address | asid) | 0)));
    // C=2 (uncached), writable, optionally valid/global.
    const flags = 0x14 | (valid ? 2 : 0) | (global ? 1 : 0);
    cpu.setControlU32(regs.controlEntryLo0, (physical >>> 6) | flags);
    cpu.setControlU32(regs.controlEntryLo1, (odd >>> 6) | flags);
  }

  function map(options, op = tlbwi) {
    stage(options);
    guest(op);
  }

  function compare(profiled, prepare, mutate, options = {}) {
    const { pc = entry, ticks = cycles, trainPrepare = prepare } = options;
    reset(prepare);
    mutate();
    cpu.pc = pc;
    cpu.run(ticks);
    const expected = snapshot();
    reset(trainPrepare);
    const fragment = train(pc, ticks), original = fragment.func;
    reset(prepare);
    install(fragment);
    // Changes must happen after installing the saved compiled fragment.
    mutate();
    cpu.pc = pc;
    setPerformanceProfiling(profiled);
    cpu.run(ticks);
    expect(snapshot()).toEqual(expected);
    if (profiled) {
      const p = getPerformanceProfile();
      expect(p.compiledOps + p.interpretedOps).toBe(ticks);
    }
    return { fragment, original };
  }

  return { cpu, h, reset, snapshot, train, install, guest, stage, map, compare };
}

for (const profiled of [false, true]) {
  describe(`compiled instruction translations (profiling ${profiled})`, () => {
    for (const op of [tlbwi, tlbwr]) {
      for (const change of ['unchanged', 'remap', 'invalid', 'missing', 'unrelated']) {
        test(`${op === tlbwi ? 'TLBWI' : 'TLBWR'}: ${change}`, async () => {
          const { cpu, map, compare } = await fixture();
          const { fragment, original } = compare(profiled, () => map(), () => {
            cpu.setRandomSource(() => change === 'unrelated' ? 1 / 32 : 0);
            map({
              physical: change === 'remap' ? 0x3000 : 0x1000,
              valid: change !== 'invalid',
              address: change === 'missing' || change === 'unrelated' ? entry + 0x2000 : entry,
              index: change === 'unrelated' ? 1 : 0,
            }, op);
          });
          if (change === 'unchanged' || change === 'unrelated') {
            expect(fragment.func).toBe(original);
            expect(fragment.executionCount).toBe(1);
          }
          expect(cpu.getRegU32Lo(2)).toBe(change === 'remap' ? 2 : change === 'invalid' || change === 'missing' ? 0 : 1);
          if (change === 'invalid' || change === 'missing') {
            expect(cpu.getControlU32(regs.controlCause)).toBe(8);
            expect(cpu.getControlU32(regs.controlEPC)).toBe(entry);
            expect(cpu.getControlU32(regs.controlBadVAddr)).toBe(entry);
          }
        });
      }
    }

    for (const op of [mtc0EntryHi, dmtc0EntryHi, tlbr]) {
      for (const global of [false, true]) {
        test(`ASID switch via ${op.toString(16)}, global ${global}`, async () => {
          const { cpu, map, guest, compare } = await fixture();
          const { fragment, original } = compare(profiled, () => {
            map({ index: 1, physical: 0x3000, asid: 1, global: false });
            map({ global });
            cpu.setControlU32(regs.controlIndex, 1);
            cpu.setRegU32Extend(8, entry | 1);
          }, () => guest(op));
          expect(cpu.getRegU32Lo(2)).toBe(global ? 1 : 2);
          if (global) {
            expect(fragment.func).toBe(original);
            expect(fragment.executionCount).toBe(1);
          }
        });
      }
    }

    test('an ASID change can select a non-global entry before a global one', async () => {
      const { cpu, map, guest, compare } = await fixture();
      compare(profiled, () => {
        map({ index: 0, physical: 0x3000, asid: 1, global: false });
        map({ index: 1 });
        cpu.setRegU32Extend(8, entry | 1);
      }, () => guest(mtc0EntryHi));
      expect(cpu.getRegU32Lo(2)).toBe(2);
    });

    for (const delaySlot of [false, true]) {
      for (const invalid of [false, true]) {
        test(`trace crosses an odd-page boundary, invalid ${invalid}, delay slot ${delaySlot}`, async () => {
          const { cpu, h, map, guest, compare } = await fixture();
          const pc = entry + 0xff8;
          compare(profiled, () => {
            map();
            h.ram.set32(0x1ff8, 0x34030007); // ORI v1,zero,7
            h.ram.set32(0x1ffc, delaySlot ? 0x10000001 : 0); // BEQ +1 or NOP
            h.ram.set32(0x2000, setV0(1));
          }, () => {
            cpu.setControlU32(regs.controlEntryLo1, (0x3000 >>> 6) | (invalid ? 0x15 : 0x17));
            guest(tlbwi);
          }, { pc });
          expect(cpu.getRegU32Lo(3)).toBe(7);
          expect(cpu.getRegU32Lo(2)).toBe(invalid ? 0 : 2);
          if (invalid) {
            expect(cpu.getControlU32(regs.controlEPC)).toBe(entry + (delaySlot ? 0xffc : 0x1000));
            expect(cpu.getControlU32(regs.controlCause)).toBe(delaySlot ? 0x80000008 : 8);
            expect(cpu.getControlU32(regs.controlBadVAddr)).toBe(entry + 0x1000);
          }
        });
      }
    }

    test('an earlier small mapping overrides part of a large code page', async () => {
      const { cpu, h, map, compare } = await fixture();
      compare(profiled, () => {
        map({ index: 7, physical: 0, odd: 0x4000, mask: 0x6000 });
        h.ram.set32(0x1ff8, 0x34030007);
        h.ram.set32(0x2000, setV0(1));
      }, () => map({ address: entry + 0x2000, physical: 0x3000 }), { pc: entry + 0x1ff8 });
      expect(cpu.getRegU32Lo(3)).toBe(7);
      expect(cpu.getRegU32Lo(2)).toBe(2);
    });

    test('physical address zero is a valid code mapping', async () => {
      const { cpu, h, map, compare } = await fixture();
      compare(profiled, () => {
        map();
        h.ram.set32(0, setV0(3));
      }, () => map({ physical: 0 }));
      expect(cpu.getRegU32Lo(2)).toBe(3);
    });

    test('sign-extended mapped kernel addresses are validated', async () => {
      const { cpu, map, compare } = await fixture();
      const pc = 0xc0400000;
      compare(profiled, () => map({ address: pc }),
        () => map({ address: pc, physical: 0x3000 }), { pc });
      expect(cpu.getRegU32Lo(2)).toBe(2);
    });

    test('a trace with an unmapped entry tracks its nonadjacent mapped target', async () => {
      const { cpu, h, map, compare } = await fixture();
      compare(profiled, () => {
        map({ physical: 0x2000 });
        h.ram.set32(0x1000, 0x00800008); // JR a0
        h.ram.set32(0x1004, 0x34030007); // ORI v1,zero,7 (delay slot)
        h.ram.set32(0x2000, setV0(1));
        cpu.setRegU32Extend(4, entry);
      }, () => map({ physical: 0x3000 }), { pc: 0x80001000 });
      expect(cpu.getRegU32Lo(2)).toBe(2);
      expect(cpu.getRegU32Lo(3)).toBe(7);
    });

    for (const mapped of [false, true]) {
      test(`unchanged mappings need no repeated page lookups, mapped ${mapped}`, async () => {
        const { cpu, reset, map, guest, train } = await fixture();
        const pc = mapped ? entry : 0x80001000;
        reset(() => map());
        const fragment = train(pc), original = fragment.func;
        map({ index: 1, address: entry + 0x2000 });
        const translate = cpu.translateInstructionAddress;
        let lookups = 0;
        cpu.translateInstructionAddress = function (address) {
          lookups++;
          return translate.call(this, address);
        };
        try {
          setPerformanceProfiling(profiled);
          cpu.pc = pc;
          cpu.run(cycles);
          expect(lookups).toBe(mapped ? 1 : 0);
          lookups = 0;
          // EntryHi's VPN changes do not change the address space.
          cpu.setRegU32Extend(8, entry + 0x4000);
          guest(mtc0EntryHi);
          cpu.pc = pc;
          cpu.run(cycles);
          expect(lookups).toBe(0);
          expect(fragment.func).toBe(original);
          expect(fragment.executionCount).toBe(2);
        } finally {
          delete cpu.translateInstructionAddress;
        }
      });
    }

    for (const invalid of [false, true]) {
      test(`TLBWI changes its own mapping while being traced, invalid ${invalid}`, async () => {
        const { cpu, h, reset, map, stage, snapshot, train } = await fixture();
        function prepare() {
          map();
          stage({ physical: 0x3000, valid: !invalid });
          h.ram.set32(0x1000, 0x24630001); // ADDIU v1,v1,1
          h.ram.set32(0x1004, tlbwi);
        }
        reset(prepare);
        cpu.run(cycles);
        const expected = snapshot();
        reset(prepare);
        setPerformanceProfiling(profiled);
        const fragment = train();
        expect(snapshot()).toEqual(expected);
        expect(fragment.opsCompiled).toBe(2);
        if (invalid) {
          expect(cpu.getControlU32(regs.controlEPC)).toBe(entry + 8);
          expect(cpu.getControlU32(regs.controlCause)).toBe(8);
        } else {
          // Reentry must reject the old prefix even though the mapping changed
          // before that prefix finished compiling.
          cpu.pc = entry;
          cpu.run(cycles);
          expect(cpu.getRegU32Lo(2)).toBe(2);
          expect(cpu.getRegU32Lo(3)).toBe(1);
        }
      });
    }

    for (const op of [tlbwi, tlbwr, mtc0EntryHi, dmtc0EntryHi, tlbr]) {
      for (const delaySlot of [false, true]) {
        test(`active trace changes its own mapping via ${op.toString(16)}, delay slot ${delaySlot}`, async () => {
          const { cpu, h, map, stage, compare } = await fixture();
          const write = op === tlbwi || op === tlbwr;
          const prepare = (training = false) => {
            map({ index: 1, asid: 1, physical: 0x3000, global: false });
            map({ global: write });
            if (write) {
              stage({ physical: training ? 0x1000 : 0x3000 });
            } else {
              cpu.setControlU32(regs.controlIndex, training ? 0 : 1);
              cpu.setRegU32Extend(8, entry | (training ? 0 : 1));
            }
            cpu.setRegU32Extend(4, entry + 0x40);
            h.ram.set32(0x1000, 0x24630001); // ADDIU v1,v1,1
            h.ram.set32(0x1004, delaySlot ? 0x00800008 : 0); // JR a0 or NOP
            h.ram.set32(0x1008, op);
            const offset = delaySlot ? 0x40 : 12;
            h.ram.set32(0x1000 + offset, setV0(1));
            h.ram.set32(0x3000 + offset, setV0(2));
          };
          const { fragment } = compare(profiled, () => prepare(), () => {}, { trainPrepare: () => prepare(true) });
          expect(cpu.getRegU32Lo(2)).toBe(2);
          expect(cpu.getRegU32Lo(3)).toBe(1);
          expect(fragment.executionCount).toBe(1);
          expect(fragment.opsCompiled).toBe(3);
          if (profiled) {
            expect(getPerformanceProfile().compiledOps).toBe(3);
          }
        });
      }
    }

    for (const invalid of [false, true]) {
      test(`a compiled TLBWI dispatches a cached successor, invalid ${invalid}`, async () => {
        const { cpu, h, reset, map, stage, snapshot, train, install } = await fixture();
        const callerPC = 0x80006000;
        function prepare(training = false) {
          map();
          stage({ physical: training ? 0x1000 : 0x3000, valid: training || !invalid });
          h.ram.set32(0x6000, 0x24630001); // ADDIU v1,v1,1
          h.ram.set32(0x6004, 0x00800008); // JR a0
          h.ram.set32(0x6008, tlbwi); // Delay slot changes target mapping.
          cpu.setRegU32Extend(4, entry);
          cpu.pc = callerPC;
        }
        reset(prepare);
        cpu.run(24);
        const expected = snapshot();
        reset(() => prepare(true));
        const target = train();
        const caller = train(callerPC);
        expect(caller.getNextFragment(entry, 3)).toBe(target);
        reset(prepare);
        install(target);
        install(caller);
        setPerformanceProfiling(profiled);
        cpu.run(24);
        expect(snapshot()).toEqual(expected);
        expect(caller.executionCount).toBe(1);
        expect(cpu.getRegU32Lo(2)).toBe(invalid ? 0 : 2);
      });
    }
  });
}
