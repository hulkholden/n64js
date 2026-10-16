import { afterEach, describe, expect, test } from 'bun:test';
import { performanceProfile, setPerformanceProfiling } from '../debug/performance_profile.js';
import * as regs from './cpu0reg.js';
import {
  ADDIU_T0_1,
  DEFAULT_PC,
  JR_RA,
  compileFragmentAt,
  createTestEmulator,
} from './test_helpers.js';

afterEach(() => {
  setPerformanceProfiling(false);
});

async function createLoopFixture(words, entry = DEFAULT_PC) {
  const e = await createTestEmulator();
  const { cpu0: cpu, hardware: h } = e;
  cpu.reset();
  cpu.setRandomSource(() => 0.5);
  cpu.setControlU32(regs.controlStatus, 0x20000000);
  cpu.cop1ControlChanged();
  words.forEach((word, i) => h.ram.set32((entry & 0x7fffff) + i * 4, word));
  return { e, cpu, h, entry };
}

function captureState(cpu, h) {
  const events = [];
  let deadline = cpu.eventQueue.cyclesToFirstEvent;
  for (let event = cpu.eventQueue.firstEvent; event; event = event.next) {
    events.push([event.type, deadline]);
    deadline += event.cyclesToNextEvent;
  }
  return {
    pc: cpu.pc,
    delayPC: cpu.delayPC,
    count: cpu.controlCountValue,
    cycles: cpu.getOpsExecuted(),
    gpr: [...cpu.gprU32],
    cop0: [...cpu.controlRegU32],
    ram: [...h.ram.u8.slice(0x3000, 0x3040)],
    events,
  };
}

describe('self-looping fragments and self-loop cutoff', () => {
  test('multi-iteration self-loop matches interpreted execution across deadlines, early exits, MFC0 Count, interrupts, and exceptions', async () => {
    // 6-op loop at 0x80001000:
    //   0x80001000: ADDIU t0, t0, 1         (0x25080001)
    //   0x80001004: BEQ   t0, t2, early_out (0x110a0004 -> 0x80001018)
    //   0x80001008: MFC0  t3, Count         (0x400b4800)
    //   0x8000100c: SW    t3, 0(s0)         (0xae0b0000)
    //   0x80001010: BNE   t0, t1, loop      (0x1509fffb -> 0x80001000)
    //   0x80001014: ADDIU s0, s0, 4         (0x26100004)
    //   0x80001018: ADDIU t4, t4, 99        (0x258c0063)
    //   0x8000101c: JR    ra                (0x03e00008)
    //   0x80001020: NOP                     (0x00000000)
    const words = [
      ADDIU_T0_1,
      0x110a0004,
      0x400b4800,
      0xae0b0000,
      0x1509fffb,
      0x26100004,
      0x258c0063,
      JR_RA,
      0x00000000,
    ];

    for (const scenario of ['normal-exit', 'early-branch-exit', 'event-deadline', 'compare-interrupt', 'exception-iter-3', 'rsp-break-iter-4']) {
      const states = [];
      for (const compiled of [false, true]) {
        const { e, cpu, h, entry } = await createLoopFixture(words);

        if (compiled) {
          cpu.pc = entry;
          cpu.delayPC = null;
          cpu.setRegS32Extend(8, 0);          // t0 = 0
          cpu.setRegS32Extend(9, 5);          // t1 = 5
          cpu.setRegS32Extend(10, 999);       // t2 = 999 (don't take early branch during training)
          cpu.setRegS32Extend(16, 0x80003000);// s0
          cpu.setRegS32Extend(31, entry);     // ra
          const frag = compileFragmentAt(cpu, entry, 6);
          expect(frag.opsCompiled).toBe(6);
          expect(frag.getCode()).toContain('do {');
        }

        // Reset dynamic state for test run
        h.ram.u8.fill(0, 0x3000, 0x3040);
        cpu.pc = entry;
        cpu.delayPC = null;
        cpu.controlCountValue = 100;
        cpu.setRegS32Extend(8, 0);            // t0 = 0
        cpu.setRegS32Extend(9, 6);            // t1 = 6 iterations
        cpu.setRegS32Extend(10, scenario === 'early-branch-exit' ? 4 : 999);
        cpu.setRegS32Extend(12, 0);           // t4 = 0
        cpu.setRegS32Extend(16, scenario === 'exception-iter-3' ? 0x7ffffff8 : 0x80003000);
        cpu.setRegS32Extend(31, 0x80001018);

        if (scenario === 'compare-interrupt') {
          cpu.setControlU32(regs.controlStatus, 0x20008001);
          cpu.setCompare((cpu.controlCountValue + 16) / 2);
        }

        const origStep = h.rsp.step;
        let stepCount = 0;
        if (scenario === 'rsp-break-iter-4') {
          h.rsp.step = function () {
            if (++stepCount === 20) {
              cpu.breakExecution();
            }
            return origStep.call(this);
          };
        }

        setPerformanceProfiling(true);
        const runCycles = scenario === 'event-deadline' ? 15 : 40;
        cpu.run(runCycles);
        h.rsp.step = origStep;
        expect(e.fatalError()).toBeNull();

        if (compiled && scenario === 'normal-exit') {
          const frag = h.fragmentCache.fragments.get(entry);
          // All 6 iterations ran inside a single fragment invocation!
          expect(performanceProfile.counters.fragmentRuns).toBe(1);
          expect(performanceProfile.counters.compiledOps).toBe(36);
          // nextFragments array must not grow beyond opsCompiled + 1
          expect(frag.nextFragments.length).toBe(frag.opsCompiled + 1);
        }

        states.push(captureState(cpu, h));
      }
      expect(states[1]).toEqual(states[0]);
    }
  });

  test('rotated loop entered at its 2-op branch test traces across the back-edge and stops when falling through to entryPC', async () => {
    // Classic compiler while-loop layout entered at test (0x80001008):
    //   0x80001000: ADDIU t0, t0, 1         (0x25080001) - loop body op 1
    //   0x80001004: ADDIU t2, t2, 3         (0x254a0003) - loop body op 2 (falls through to 0x80001008)
    //   0x80001008: BNE   t0, t1, 0x80001000(0x1509fffd) - entryPC: 2-op branch stub back to loop top
    //   0x8000100c: ADDIU t3, t3, 5         (0x256b0005) - delay slot
    //   0x80001010: JR    ra                (0x03e00008)
    //   0x80001014: NOP                     (0x00000000)
    const words = [
      ADDIU_T0_1,
      0x254a0003,
      0x1509fffd,
      0x256b0005,
      JR_RA,
      0x00000000,
    ];
    const loopEntry = DEFAULT_PC + 8;

    const states = [];
    for (const compiled of [false, true]) {
      const { e, cpu, h } = await createLoopFixture(words, DEFAULT_PC);

      if (compiled) {
        cpu.pc = loopEntry;
        cpu.delayPC = null;
        cpu.setRegS32Extend(8, 0);    // t0 = 0
        cpu.setRegS32Extend(9, 10);   // t1 = 10
        const frag = compileFragmentAt(cpu, loopEntry, 4);
        expect(frag.opsCompiled).toBe(4);
        expect(frag.getCode()).toContain('do {');
      }

      cpu.pc = loopEntry;
      cpu.delayPC = null;
      cpu.controlCountValue = 0;
      cpu.setRegS32Extend(8, 0);      // t0 = 0
      cpu.setRegS32Extend(9, 8);      // t1 = 8
      cpu.setRegS32Extend(10, 0);     // t2 = 0
      cpu.setRegS32Extend(11, 0);     // t3 = 0
      cpu.setRegS32Extend(31, 0x80001010);
      setPerformanceProfiling(true);
      cpu.run(9 * 4);
      expect(e.fatalError()).toBeNull();
      if (compiled) {
        // 8 full 4-op rotations (t0 = 0..7 -> 1..8) + final 2-op exit branch when t0 == 8 = 34 ops in 1 fragment run
        expect(performanceProfile.counters.fragmentRuns).toBe(1);
        expect(performanceProfile.counters.compiledOps).toBe(34);
      }
      states.push(captureState(cpu, h));
    }
    expect(states[1]).toEqual(states[0]);
  });
});
