import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { createHeadlessEmulator } from '../headless/headless_env.js';
import { Fragment } from './fragments.js';
import { setPerformanceProfiling } from '../debug/performance_profile.js';
import * as regs from './cpu0reg.js';

const entry = 0x80001000;
const taken = 0x80001100;
const untaken = entry + 44;

afterEach(() => { mock.restore(); setPerformanceProfiling(false); });

async function dispatchFixture(uncached) {
  const e = await createHeadlessEmulator({
    romBuffer: new ArrayBuffer(0x1000),
    rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' },
  });
  const { cpu0: cpu, hardware: h } = e;
  n64js.getSyncFlow = () => null;
  cpu.reset();
  cpu.setRandomSource(() => 0.5);
  cpu.setControlU32(regs.controlStatus, 0x20000000);
  cpu.cop1ControlChanged();
  cpu.setRegS32Extend(16, 0x80003000);
  // CPU, RAM and FPU work before a final BC1F with two 11-op outcomes.
  const words = [0x25080001, 0xae080000, 0x46020000, 0, 0, 0, 0, 0x4602003c, 0,
    0x45000000 | ((taken - (entry + 40)) >>> 2), 0];
  words.forEach((word, i) => h.ram.set32(0x1000 + i * 4, word));
  for (const pc of [taken, untaken]) {
    h.ram.set32(pc & 0x7fffff, 0x03e00008); // JR ra
    h.ram.set32((pc & 0x7fffff) + 4, 0x25290001); // ADDIU t1,t1,1
  }
  for (const pc of [taken, untaken, entry]) {
    for (let i = 0; i < 499; i++) {
      h.fragmentCache.lookupFragment(pc);
    }
    cpu.pc = pc;
    cpu.delayPC = null;
    cpu.setRegS32Extend(31, pc);
    cpu.run(pc === entry ? 11 : 12);
    expect(h.fragmentCache.fragments.get(pc)?.func).toBeFunction();
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

for (const profiled of [false, true]) {
  describe(`cached successor dispatch (profiling ${profiled})`, () => {
    for (const scenario of ['alternating', 'deadline', 'interrupt', 'changed-code', 'reuse', 'exception', 'early-exit', 'zero-exit', 'source-invalidation']) {
      test(`${scenario} matches uncached dispatch`, async () => {
        const results = [];
        for (const uncached of [true, false]) {
          setPerformanceProfiling(false);
          const { cpu, h, caller, run, snapshots } = await dispatchFixture(uncached);
          setPerformanceProfiling(profiled);
          // Warm both branch outcomes sharing the same instruction-count slot.
          run(false); run(true);
          if (!uncached) {
            const successors = caller.successors.filter(Boolean).map(fragment => fragment.entryPC);
            expect(successors).toContain(taken);
            expect(successors).toContain(untaken);
          }
          switch (scenario) {
            case 'alternating':
              for (let i = 0; i < 8; i++) {
                run(Boolean(i & 1));
              }
              break;
            case 'deadline':
              // Only five cycles remain when dispatch reaches the cached target.
              run(false, 16);
              break;
            case 'interrupt':
              run(false, 31, () => {
                cpu.setControlU32(regs.controlStatus, 0x20008001);
                cpu.setCompare((cpu.controlCountValue + 12) / 2);
              });
              break;
            case 'changed-code':
            case 'reuse':
              h.fragmentCache.invalidateEntry(taken);
              if (scenario === 'changed-code') {
                h.ram.set32(0x1104, 0x25290002);
              }
              run(false);
              break;
            case 'exception':
              run(false, 31, () => cpu.setRegS32Extend(16, 0x80003001));
              break;
            case 'source-invalidation':
            case 'zero-exit':
            case 'early-exit': {
              const step = h.rsp.step;
              let steps = 0;
              h.rsp.step = function () {
                if (++steps === (scenario === 'zero-exit' ? 1 : 5)) {
                  if (scenario === 'source-invalidation') {
                    caller.invalidate();
                  } else {
                    cpu.breakExecution();
                  }
                }
                return step.call(this);
              };
              run(false);
              h.rsp.step = step;
              break;
            }
          }
          const last = snapshots.at(-1);
          if (scenario === 'deadline') {
            expect(last.pc).toBe(taken + 4);
            expect(last.delayPC).toBe(taken);
          } else if (scenario === 'interrupt') {
            expect(cpu.getControlU32(regs.controlEPC)).toBe(taken);
            expect(cpu.getControlU32(regs.controlCause) & 0x8000).toBe(0x8000);
          } else if (scenario === 'changed-code' || scenario === 'reuse') {
            const increment = last.gpr[18] - snapshots[1].gpr[18];
            expect(increment).toBe(scenario === 'changed-code' ? 20 : 10);
          } else if (scenario === 'exception') {
            expect(cpu.getControlU32(regs.controlEPC)).toBe(entry + 4);
            expect(cpu.getControlU32(regs.controlBadVAddr)).toBe(0x80003001);
          } else if (scenario === 'source-invalidation') {
            expect(caller.opsCompiled).toBe(0);
            expect(caller.func).toBeUndefined();
            expect(last.cycles - snapshots[1].cycles).toBe(31);
          } else if (scenario === 'early-exit' || scenario === 'zero-exit') {
            const ops = scenario === 'zero-exit' ? 0 : 4;
            expect(last.pc).toBe(entry + ops * 4);
            expect(last.cycles - snapshots[1].cycles).toBe(ops);
          }
          results.push(snapshots);
          mock.restore();
        }
        expect(results[1]).toEqual(results[0]);
      });
    }
  });
}
