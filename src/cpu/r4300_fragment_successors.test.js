import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { setPerformanceProfiling } from '../debug/performance_profile.js';
import * as regs from './cpu0reg.js';
import { Fragment } from './fragments.js';
import {
  DEFAULT_PC,
  JR_RA,
  compileFragmentAt,
  createTestEmulator,
} from './test_helpers.js';

const entry = DEFAULT_PC;
const taken = 0x80001100;
const untaken = entry + 44;

afterEach(() => {
  mock.restore();
  setPerformanceProfiling(false);
});

async function dispatchFixture(uncached) {
  const e = await createTestEmulator();
  const { cpu0: cpu, hardware: h } = e;
  cpu.reset();
  cpu.setRandomSource(() => 0.5);
  cpu.setControlU32(regs.controlStatus, 0x20000000);
  cpu.cop1ControlChanged();
  cpu.setRegS32Extend(16, 0x80003000);
  // CPU, RAM and FPU work before a final BC1F with two 11-op outcomes.
  const words = [
    0x25080001, 0xae080000, 0x46020000, 0, 0, 0, 0, 0x4602003c, 0,
    0x45000000 | ((taken - (entry + 40)) >>> 2), 0,
  ];
  words.forEach((word, i) => h.ram.set32(0x1000 + i * 4, word));
  for (const pc of [taken, untaken]) {
    h.ram.set32(pc & 0x7fffff, JR_RA); // JR ra
    h.ram.set32((pc & 0x7fffff) + 4, 0x25290001); // ADDIU t1,t1,1
  }
  for (const pc of [taken, untaken, entry]) {
    cpu.pc = pc;
    cpu.delayPC = null;
    cpu.setRegS32Extend(31, pc);
    compileFragmentAt(cpu, pc, pc === entry ? 11 : 12);
  }
  const caller = h.fragmentCache.fragments.get(entry);
  expect(caller.opsCompiled).toBe(11);
  if (uncached) {
    // Force misses at both cache levels, including newly compiled generations.
    const getNext = Fragment.prototype.getNextFragment;
    spyOn(Fragment.prototype, 'getNextFragment').mockImplementation(function (pc, ops) {
      this.nextFragments[ops] = undefined;
      this.successors.fill(null);
      return getNext.call(this, pc, ops);
    });
  }
  const snapshots = [];
  function run(condition, cycles = 31, prepare = () => {}) {
    cpu.pc = entry;
    cpu.delayPC = null;
    // ADD.S then C.LT.S: negative input takes the fallthrough path.
    h.cpu1.store32(0, condition ? 0xbf800000 : 0x3f800000);
    h.cpu1.store32(2, 0);
    cpu.setRegS32Extend(31, condition ? untaken : taken);
    prepare();
    cpu.run(cycles);
    expect(e.fatalError()).toBeNull();
    const events = [];
    let deadline = cpu.eventQueue.cyclesToFirstEvent;
    for (let event = cpu.eventQueue.firstEvent; event; event = event.next) {
      events.push([event.type, deadline]);
      deadline += event.cyclesToNextEvent;
    }
    snapshots.push({
      pc: cpu.pc, delayPC: cpu.delayPC, count: cpu.controlCountValue, cycles: cpu.getOpsExecuted(),
      gpr: [...cpu.gprU32], cop0: [...cpu.controlRegU32], fpu: [...h.cpu1.regU32], fcr: [...h.cpu1.control],
      ram: [...h.ram.u8.slice(0x3000, 0x3010)], events,
    });
  }
  return { e, cpu, h, caller, run, snapshots };
}

function runWithMidFragmentStep({ h, run }, targetStep, onStep) {
  const step = h.rsp.step;
  let steps = 0;
  h.rsp.step = function () {
    if (++steps === targetStep) {
      onStep();
    }
    return step.call(this);
  };
  run(false);
  h.rsp.step = step;
}

const scenarios = [
  {
    name: 'alternating',
    act: ({ run }) => {
      for (let i = 0; i < 8; i++) {
        run(Boolean(i & 1));
      }
    },
  },
  {
    name: 'deadline',
    // Only five cycles remain when dispatch reaches the cached target.
    act: ({ run }) => run(false, 16),
    verify: ({ last }) => {
      expect(last.pc).toBe(taken + 4);
      expect(last.delayPC).toBe(taken);
    },
  },
  {
    name: 'interrupt',
    act: ({ cpu, run }) => run(false, 31, () => {
      cpu.setControlU32(regs.controlStatus, 0x20008001);
      cpu.setCompare((cpu.controlCountValue + 12) / 2);
    }),
    verify: ({ cpu }) => {
      expect(cpu.getControlU32(regs.controlEPC)).toBe(taken);
      expect(cpu.getControlU32(regs.controlCause) & 0x8000).toBe(0x8000);
    },
  },
  {
    name: 'changed-code',
    act: ({ h, run }) => {
      h.fragmentCache.invalidateEntry(taken);
      h.ram.set32(0x1104, 0x25290002);
      run(false);
    },
    verify: ({ snapshots, last }) => {
      expect(last.gpr[18] - snapshots[1].gpr[18]).toBe(20);
    },
  },
  {
    name: 'reuse',
    act: ({ h, run }) => {
      h.fragmentCache.invalidateEntry(taken);
      run(false);
    },
    verify: ({ snapshots, last }) => {
      expect(last.gpr[18] - snapshots[1].gpr[18]).toBe(10);
    },
  },
  {
    name: 'exception',
    act: ({ cpu, run }) => run(false, 31, () => cpu.setRegS32Extend(16, 0x80003001)),
    verify: ({ cpu }) => {
      expect(cpu.getControlU32(regs.controlEPC)).toBe(entry + 4);
      expect(cpu.getControlU32(regs.controlBadVAddr)).toBe(0x80003001);
    },
  },
  {
    name: 'early-exit',
    act: ctx => runWithMidFragmentStep(ctx, 5, () => ctx.cpu.breakExecution()),
    verify: ({ snapshots, last }) => {
      expect(last.pc).toBe(entry + 16);
      expect(last.cycles - snapshots[1].cycles).toBe(4);
    },
  },
  {
    name: 'zero-exit',
    act: ctx => runWithMidFragmentStep(ctx, 1, () => ctx.cpu.breakExecution()),
    verify: ({ snapshots, last }) => {
      expect(last.pc).toBe(entry);
      expect(last.cycles - snapshots[1].cycles).toBe(0);
    },
  },
  {
    name: 'source-invalidation',
    act: ctx => runWithMidFragmentStep(ctx, 5, () => ctx.caller.invalidate()),
    verify: ({ caller, snapshots, last }) => {
      expect(caller.opsCompiled).toBe(0);
      expect(caller.func).toBeUndefined();
      expect(last.cycles - snapshots[1].cycles).toBe(31);
    },
  },
];

for (const profiled of [false, true]) {
  describe(`cached successor dispatch (profiling ${profiled})`, () => {
    for (const { name, act, verify } of scenarios) {
      test(`${name} matches uncached dispatch`, async () => {
        const results = [];
        for (const uncached of [true, false]) {
          setPerformanceProfiling(false);
          const ctx = await dispatchFixture(uncached);
          const { caller, run, snapshots } = ctx;
          setPerformanceProfiling(profiled);
          // Warm both branch outcomes sharing the same instruction-count slot.
          run(false);
          run(true);
          if (!uncached) {
            const successors = caller.successors.filter(Boolean).map(fragment => fragment.entryPC);
            expect(successors).toContain(taken);
            expect(successors).toContain(untaken);
          }
          act(ctx);
          verify?.({ ...ctx, last: snapshots.at(-1) });
          results.push(snapshots);
          mock.restore();
        }
        expect(results[1]).toEqual(results[0]);
      });
    }
  });
}
