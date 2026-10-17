import { afterEach, describe, expect, test } from 'bun:test';
import { performanceProfile, setPerformanceProfiling } from '../debug/performance_profile.js';
import { SP_DRAM_ADDR_REG, SP_MEM_ADDR_REG } from '../devices/sp_constants.js';
import * as regs from './cpu0reg.js';
import {
  ADDIU_T0_1,
  DEFAULT_PC,
  JR_RA,
  compileFragmentAt,
  compileOp,
  createTestEmulator,
  iop,
  jump,
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
  for (const [name, branch] of [
    ['J', jump(DEFAULT_PC)],
    ['BEQ unconditional', iop(4, 0, 0, -1)],
    ['BEQ', iop(4, 9, 10, -1)],
    ['BNE', iop(5, 8, 9, -1)],
  ]) {
    test(`${name} with a traced non-NOP delay slot preserves execution and deadlines without idle-skip attempts`, async () => {
      const words = [branch, ADDIU_T0_1, JR_RA, 0];
      for (const cycles of [1, 2, 3, 11, 12, 19]) {
        const states = [];
        for (const compiled of [false, true]) {
          const { e, cpu, h, entry } = await createLoopFixture(words);
          const prepare = () => {
            // Enter the delay slot with the branch back-edge already pending.
            cpu.pc = entry + 4;
            cpu.delayPC = entry;
            cpu.setRegS32Extend(8, 0);
            cpu.setRegS32Extend(9, 5);
            cpu.setRegS32Extend(10, 5);
            cpu.setRegS32Extend(31, entry + 8);
          };
          prepare();
          if (compiled) {
            const fragment = compileFragmentAt(cpu, entry + 4, 2);
            expect(fragment.getCode()).not.toContain('do {');
            expect(fragment.getCode()).not.toContain('speedHack');
          }
          prepare();
          cpu.controlCountValue = 0;
          cpu.opsExecuted = 0;
          setPerformanceProfiling(true);
          cpu.run(cycles);
          expect(e.fatalError()).toBeNull();
          if (compiled) {
            expect(performanceProfile.counters.speedHackAttempts).toBe(0);
          }
          states.push(captureState(cpu, h));
          setPerformanceProfiling(false);
        }
        expect(states[1]).toEqual(states[0]);
      }
    });

    test(`${name} keeps the runtime idle-skip check when its delay slot is unobserved`, () => {
      expect(compileOp(branch).getCode()).toContain('c.speedHack()');
    });

    test(`${name} keeps the runtime idle-skip check for a traced NOP delay slot`, async () => {
      const { cpu, h, entry } = await createLoopFixture([branch, 0]);
      cpu.pc = entry + 4;
      cpu.delayPC = entry;
      cpu.setRegS32Extend(9, 5);
      cpu.setRegS32Extend(10, 5);
      // Keep the RSP active during training so no time is skipped.
      h.rsp.halted = false;
      const fragment = compileFragmentAt(cpu, entry + 4, 2);
      expect(fragment.getCode()).toContain('c.speedHack()');
      expect(fragment.getCode()).not.toContain('do {');
    });
  }

  test('a rotated self-loop preserves active RSP stepping and delay-slot exceptions', async () => {
    const states = [];
    for (const compiled of [false, true]) {
      // Chase a pointer in the delay slot; the third load is misaligned.
      const { e, cpu, h, entry } = await createLoopFixture([jump(DEFAULT_PC), iop(0x23, 16, 16)]);
      h.ram.set32(0x3000, 0x80003004);
      h.ram.set32(0x3004, 0x7fffffff);
      cpu.pc = entry + 4;
      cpu.delayPC = entry;
      cpu.setRegS32Extend(16, 0x80003000);
      if (compiled) {
        const fragment = compileFragmentAt(cpu, entry + 4, 2);
        expect(fragment.getCode()).not.toContain('do {');
      }
      cpu.pc = entry + 4;
      cpu.delayPC = entry;
      cpu.controlCountValue = 0;
      cpu.opsExecuted = 0;
      cpu.setRegS32Extend(16, 0x80003000);
      // RSP scalar ADDIU r1,r1,1 instructions continue alongside the CPU.
      for (let pc = 0; pc < 24; pc += 4) {
        h.rsp.imem.set32(pc, iop(9, 1, 1, 1));
      }
      h.rsp.halted = false;
      cpu.run(6);
      expect(e.fatalError()).toBeNull();
      expect(cpu.getControlU32(regs.controlCause)).toBe(0x80000010);
      expect(cpu.getControlU32(regs.controlEPC)).toBe(entry);
      expect(h.rsp.getRegS32(1)).toBe(6);
      states.push({ ...captureState(cpu, h), rspPC: h.rsp.pc });
    }
    expect(states[1]).toEqual(states[0]);
  });

  test('changing a traced delay slot to NOP invalidates the loop and restores idle skipping', async () => {
    const { cpu, h, entry } = await createLoopFixture([jump(DEFAULT_PC), ADDIU_T0_1]);
    cpu.pc = entry + 4;
    cpu.delayPC = entry;
    const fragment = compileFragmentAt(cpu, entry + 4, 2);
    expect(fragment.getCode()).not.toContain('speedHack');

    h.ram.set32((entry & 0x7fffff) + 4, 0);
    h.fragmentCache.invalidateIndex(entry + 4);
    expect(fragment.func).toBeUndefined();
    cpu.pc = entry + 4;
    cpu.delayPC = entry;
    // Stop at an external deadline so a NOP loop can safely use the idle skip.
    cpu.addEvent('test deadline', 100, () => cpu.breakExecution());
    setPerformanceProfiling(true);
    cpu.run(10);
    expect(performanceProfile.counters.speedHackActivations).toBeGreaterThan(0);
    expect(performanceProfile.counters.speedHackSkippedCycles).toBeGreaterThan(0);
  });

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

  for (const loopOps of [4, 12]) {
    for (const syncCount of [false, true]) {
      for (const profiled of [false, true]) {
        test(`${loopOps}-op loop respects a new RSP DMA deadline, Count sync=${syncCount}, profiling=${profiled}`, async () => {
          const words = Array(loopOps).fill(ADDIU_T0_1);
          if (syncCount) {
            words[1] = 0x400b4800; // MFC0 t3, Count: charges preceding fragment cycles.
          }
          words[loopOps - 2] = iop(4, 0, 0, -(loopOps - 1)); // BEQ zero, zero, loop
          words[loopOps - 1] = iop(9, 10, 10, 1); // ADDIU t2, t2, 1
          const deadline = loopOps * 4;
          const states = [];
          for (const compiled of [false, true]) {
            const { e, cpu, h, entry } = await createLoopFixture(words);
            cpu.pc = entry;
            cpu.delayPC = null;
            if (compiled) {
              const fragment = compileFragmentAt(cpu, entry, loopOps);
              expect(fragment.opsCompiled).toBe(loopOps);
              expect(fragment.getCode()).toContain('do {');
            }

            cpu.pc = entry;
            cpu.delayPC = null;
            cpu.controlCountValue = 0;
            cpu.opsExecuted = 0;
            cpu.gprU32.fill(0);

            // The first RSP instruction starts a real DMA after the compiled
            // loop has read its original (much later) run-budget deadline.
            const sp = h.spRegDevice;
            sp.write32(0xa4040000 + SP_MEM_ADDR_REG, 0);
            sp.write32(0xa4040000 + SP_DRAM_ADDR_REG, 0x4000);
            h.sp_mem.clear();
            h.rsp.imem.set32(0, 0x40881000); // MTC0 t0, SP_RD_LEN
            h.rsp.setRegU32(8, deadline * 8 - 1);
            h.rsp.halted = false;
            const dmaComplete = sp.dmaComplete;
            let completion;
            sp.dmaComplete = function () {
              dmaComplete.call(this);
              completion = { cycles: cpu.controlCountValue, rspPC: h.rsp.pc };
              cpu.breakExecution();
            };

            setPerformanceProfiling(profiled);
            cpu.run(loopOps * 10);
            expect(e.fatalError()).toBeNull();
            expect(completion).toEqual({ cycles: deadline, rspPC: deadline * 4 });
            expect(sp.dmaQueue).toHaveLength(0);
            states.push(captureState(cpu, h));
            setPerformanceProfiling(false);
          }
          expect(states[1]).toEqual(states[0]);
        });
      }
    }
  }

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

  test('untaken Branch-Likely fall-throughs at opsCompiled >= 3 do not prematurely terminate fragment tracing', async () => {
    // 6-op self-loop where ops 3 and 4 are untaken Branch-Likely instructions
    // (BEQL and BC1FL) whose annulled delay slots must be skipped without
    // terminating the trace before the loop's BNE back-edge:
    //   0x80001000: ADDIU t0, t0, 1         (op 1)
    //   0x80001004: ADDIU t2, t2, 2         (op 2)
    //   0x80001008: BEQL  t0, t3, exit      (op 3: untaken -> skips 0x8000100c, lands at 0x80001010)
    //   0x8000100c: ADDIU t4, t4, 99        (annulled delay slot)
    //   0x80001010: BC1FL exit              (op 4: untaken when FPCSR_C != 0 -> skips 0x80001014, lands at 0x80001018)
    //   0x80001014: ADDIU t5, t5, 77        (annulled delay slot)
    //   0x80001018: BNE   t0, t1, loop      (op 5: backward branch to 0x80001000)
    //   0x8000101c: ADDIU t6, t6, 3         (op 6: delay slot -> returns to 0x80001000)
    //   0x80001020: ADDIU t7, t7, 11        (exit target)
    //   0x80001024: JR    ra
    //   0x80001028: NOP
    const words = [
      ADDIU_T0_1,
      iop(9, 10, 10, 2),       // ADDIU t2, t2, 2
      iop(20, 8, 11, 5),       // BEQL  t0, t3, +5 (target 0x80001020)
      iop(9, 12, 12, 99),      // ADDIU t4, t4, 99 (annulled unless BEQL taken)
      0x45020003,              // BC1FL +3 (target 0x80001020)
      iop(9, 13, 13, 77),      // ADDIU t5, t5, 77 (annulled unless BC1FL taken)
      iop(5, 8, 9, -7),        // BNE   t0, t1, -7 (target 0x80001000)
      iop(9, 14, 14, 3),       // ADDIU t6, t6, 3
      iop(9, 15, 15, 11),      // ADDIU t7, t7, 11
      JR_RA,
      0,
    ];

    for (const scenario of ['normal-exit', 'beql-taken-iter-3', 'bc1fl-taken-iter-1']) {
      const states = [];
      for (const compiled of [false, true]) {
        const { e, cpu, h, entry } = await createLoopFixture(words);
        // Set FPCSR_C = 1 so BC1FL is untaken during training.
        h.cpu1.control[31] = 0x00800000;

        if (compiled) {
          cpu.pc = entry;
          cpu.delayPC = null;
          cpu.setRegS32Extend(8, 0);    // t0 = 0
          cpu.setRegS32Extend(9, 5);    // t1 = 5
          cpu.setRegS32Extend(11, 999); // t3 = 999
          const frag = compileFragmentAt(cpu, entry, 6);
          expect(frag.opsCompiled).toBe(6);
          expect(frag.getCode()).toContain('do {');
        }

        cpu.pc = entry;
        cpu.delayPC = null;
        cpu.controlCountValue = 0;
        h.cpu1.control[31] = scenario === 'bc1fl-taken-iter-1' ? 0 : 0x00800000;
        cpu.setRegS32Extend(8, 0);      // t0 = 0
        cpu.setRegS32Extend(9, 5);      // t1 = 5
        cpu.setRegS32Extend(10, 0);     // t2 = 0
        cpu.setRegS32Extend(11, scenario === 'beql-taken-iter-3' ? 3 : 999);
        cpu.setRegS32Extend(12, 0);     // t4 = 0
        cpu.setRegS32Extend(13, 0);     // t5 = 0
        cpu.setRegS32Extend(14, 0);     // t6 = 0
        cpu.setRegS32Extend(15, 0);     // t7 = 0
        cpu.setRegS32Extend(31, entry + 0x20);
        setPerformanceProfiling(true);
        cpu.run(30);
        expect(e.fatalError()).toBeNull();
        if (compiled && scenario === 'normal-exit') {
          expect(performanceProfile.counters.fragmentRuns).toBe(1);
          expect(performanceProfile.counters.compiledOps).toBe(30);
        }
        states.push(captureState(cpu, h));
      }
      expect(states[1]).toEqual(states[0]);
    }
  });

  test('taken branch with offset +2 (delaySlotPC + 8) is still treated as a taken forward branch rather than an untaken Branch-Likely fall-through', async () => {
    // 8 sequential ADDIUs followed by a taken BEQ r0, r0, +2 (op 9) + delay slot (op 10).
    // At the delay slot (entryPC = 0x80001024), entryDelayPC is 0x8000102c === entryPC + 8.
    // Because entryDelayPC !== null, shouldStopOnBranch must recognize this as a taken
    // forward branch at opsCompiled === 10 (>= kMinOpsBeforeForwardBranchStop) and stop.
    const words = [
      ADDIU_T0_1,
      ADDIU_T0_1,
      ADDIU_T0_1,
      ADDIU_T0_1,
      ADDIU_T0_1,
      ADDIU_T0_1,
      ADDIU_T0_1,
      ADDIU_T0_1,
      iop(4, 0, 0, 2), // BEQ r0, r0, +2 (from 0x80001020 -> target 0x8000102c, which is delaySlotPC + 8)
      ADDIU_T0_1,      // delay slot at 0x80001024
      ADDIU_T0_1,      // skipped instruction at 0x80001028
      ADDIU_T0_1,      // branch target at 0x8000102c
      JR_RA,
      0,
    ];
    const { cpu, entry } = await createLoopFixture(words);
    cpu.pc = entry;
    cpu.delayPC = null;
    const frag = compileFragmentAt(cpu, entry, 10);
    expect(frag.opsCompiled).toBe(10);
  });

  test('11-op multi-branch loop with untaken Branch-Likely guards and internal forward branch to loop latch compiles as a single self-loop', async () => {
    // Modeled on GoldenEye 007's hot 0x7f0ba3b8 traversal loop:
    //   0x80001000: ANDI  t3, t2, 1         (op 1)
    //   0x80001004: BNEL  t3, r0, latch     (op 2: untaken -> skips 0x80001008, lands at 0x8000100c)
    //   0x80001008: LW    t2, 8(a3)         (annulled delay slot when op 2 untaken)
    //   0x8000100c: LBU   t4, 4(a3)         (op 3)
    //   0x80001010: BEQL  s3, t4, early_out (op 4: untaken -> skips 0x80001014, lands at 0x80001018)
    //   0x80001014: ADDIU t6, t6, 100       (annulled delay slot when op 4 untaken)
    //   0x80001018: LBU   t5, 5(a3)         (op 5)
    //   0x8000101c: BNEL  s3, t5, latch     (op 6: taken forward branch -> 0x8000102c)
    //   0x80001020: LW    t2, 8(a3)         (op 7: delay slot -> jumps forward to latch at 0x8000102c)
    //   0x80001024: ADDIU t7, t7, 50        (untaken fall-through path if s3 == t5)
    //   0x80001028: LW    t2, 8(a3)
    // latch (0x8000102c):
    //   0x8000102c: ADDIU s2, s2, 8         (op 8)
    //   0x80001030: ADDIU a3, a3, 8         (op 9)
    //   0x80001034: BNEL  t2, r0, loop      (op 10: backward Branch-Likely -> 0x80001000)
    //   0x80001038: LBU   t2, 6(a3)         (op 11: delay slot -> returns to 0x80001000)
    // early_out (0x8000103c):
    //   0x8000103c: ADDIU v0, s2, 0
    //   0x80001040: JR    ra
    //   0x80001044: NOP
    const words = [
      iop(12, 10, 11, 1),      // 0x80001000: ANDI  t3($11), t2($10), 1
      iop(21, 11, 0, 9),       // 0x80001004: BNEL  t3($11), r0($0), +9  (-> 0x8000102c)
      iop(35, 7, 10, 8),       // 0x80001008: LW    t2($10), 8(a3($7))
      iop(36, 7, 12, 4),       // 0x8000100c: LBU   t4($12), 4(a3($7))
      iop(20, 19, 12, 10),     // 0x80001010: BEQL  s3($19), t4($12), +10 (-> 0x8000103c)
      iop(9, 14, 14, 100),     // 0x80001014: ADDIU t6($14), t6($14), 100
      iop(36, 7, 13, 5),       // 0x80001018: LBU   t5($13), 5(a3($7))
      iop(21, 19, 13, 3),      // 0x8000101c: BNEL  s3($19), t5($13), +3 (-> 0x8000102c)
      iop(35, 7, 10, 8),       // 0x80001020: LW    t2($10), 8(a3($7))
      iop(9, 15, 15, 50),      // 0x80001024: ADDIU t7($15), t7($15), 50
      iop(35, 7, 10, 8),       // 0x80001028: LW    t2($10), 8(a3($7))
      iop(9, 18, 18, 8),       // 0x8000102c: ADDIU s2($18), s2($18), 8
      iop(9, 7, 7, 8),         // 0x80001030: ADDIU a3($7), a3($7), 8
      iop(21, 10, 0, -14),     // 0x80001034: BNEL  t2($10), r0($0), -14 (-> 0x80001000)
      iop(36, 7, 10, 6),       // 0x80001038: LBU   t2($10), 6(a3($7))
      iop(9, 18, 2, 0),        // 0x8000103c: ADDIU v0($2), s2($18), 0
      JR_RA,                   // 0x80001040: JR    ra
      0,                       // 0x80001044: NOP
    ];

    const setupRecords = (h, scenario) => {
      // Populate 5 8-byte records starting at 0x80003000.
      // Each record has bytes at +4 (t4), +5 (t5), +6 (next t2 flag), and word at +8 (next record's continuation flag).
      h.ram.u8.fill(0, 0x3000, 0x3040);
      for (let i = 0; i < 5; i++) {
        const base = 0x3000 + i * 8;
        h.ram.u8[base + 4] = scenario === 'beql-match-iter-3' && i === 2 ? 42 : 10 + i;
        h.ram.u8[base + 5] = scenario === 'bnel-fallthrough-iter-2' && i === 1 ? 42 : 20 + i;
        // Byte +6 of record i (loaded in back-edge delay slot for record i) is the low bit tested by ANDI on iteration i.
        h.ram.u8[base + 6] = scenario === 'first-bnel-taken-iter-3' && i === 2 ? 1 : 2;
        // Word at base + 8 (which overlaps record i+1's +0..+3) is loaded into t2 and tested by back-edge BNEL t2 != 0.
        h.ram.set32(base + 8, i < 4 ? 2 : 0);
      }
    };

    for (const scenario of [
      'normal-5-iters',
      'first-bnel-taken-iter-3',
      'beql-match-iter-3',
      'bnel-fallthrough-iter-2',
      'event-deadline',
      'compare-interrupt',
    ]) {
      const states = [];
      for (const compiled of [false, true]) {
        const { e, cpu, h, entry } = await createLoopFixture(words);

        const initRegs = () => {
          cpu.pc = entry;
          cpu.delayPC = null;
          cpu.controlCountValue = 200;
          cpu.setRegS32Extend(2, 0);           // v0 = 0
          cpu.setRegS32Extend(7, 0x80003000);  // a3 = 0x80003000
          cpu.setRegS32Extend(10, 2);          // t2 = 2 (even -> bit 0 is 0, non-zero)
          cpu.setRegS32Extend(11, 0);          // t3 = 0
          cpu.setRegS32Extend(12, 0);          // t4 = 0
          cpu.setRegS32Extend(13, 0);          // t5 = 0
          cpu.setRegS32Extend(14, 0);          // t6 = 0
          cpu.setRegS32Extend(15, 0);          // t7 = 0
          cpu.setRegS32Extend(18, 0);          // s2 = 0
          cpu.setRegS32Extend(19, 42);         // s3 = 42 (search key)
          cpu.setRegS32Extend(31, entry + 0x3c);
        };

        if (compiled) {
          setupRecords(h, 'normal-5-iters');
          initRegs();
          const frag = compileFragmentAt(cpu, entry, 11);
          expect(frag.opsCompiled).toBe(11);
          expect(frag.getCode()).toContain('do {');
        }

        setupRecords(h, scenario);
        initRegs();

        if (scenario === 'compare-interrupt') {
          cpu.setControlU32(regs.controlStatus, 0x20008001);
          cpu.setCompare((cpu.controlCountValue + 26) / 2);
        }

        setPerformanceProfiling(true);
        const runCycles = scenario === 'event-deadline' ? 25 : 55;
        cpu.run(runCycles);
        expect(e.fatalError()).toBeNull();

        if (compiled && scenario === 'normal-5-iters') {
          // 4 full 11-op iterations + 5th iteration exiting at op 10 (untaken back-edge BNEL) = 54 ops in 1 fragment run
          expect(performanceProfile.counters.fragmentRuns).toBe(1);
          expect(performanceProfile.counters.compiledOps).toBe(54);
        }

        states.push(captureState(cpu, h));
      }
      expect(states[1]).toEqual(states[0]);
    }
  });
});

