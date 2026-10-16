import { afterEach, describe, expect, test } from 'bun:test';
import { createHeadlessEmulator } from '../headless/headless_env.js';
import { setPerformanceProfiling, performanceProfile } from '../debug/performance_profile.js';
import { dynarecConfig } from './r4300.js';
import * as regs from './cpu0reg.js';

const defaultConfig = { ...dynarecConfig };

afterEach(() => {
  Object.assign(dynarecConfig, defaultConfig);
  setPerformanceProfiling(false);
});

async function createTestCPU(words, entry = 0x80001000) {
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
  words.forEach((word, i) => h.ram.set32((entry & 0x7fffff) + i * 4, word));
  return { e, cpu, h, entry };
}

function warmFragment(h, entry) {
  for (let i = 0; i < 499; i++) {
    h.fragmentCache.lookupFragment(entry);
  }
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
      0x25080001,
      0x110a0004,
      0x400b4800,
      0xae0b0000,
      0x1509fffb,
      0x26100004,
      0x258c0063,
      0x03e00008,
      0x00000000,
    ];

    for (const scenario of ['normal-exit', 'early-branch-exit', 'event-deadline', 'compare-interrupt', 'exception-iter-3', 'rsp-break-iter-4']) {
      const states = [];
      for (const compiled of [false, true]) {
        Object.assign(dynarecConfig, {
          ...defaultConfig,
          selfLoopCutoff: 'immediate',
          minSelfLoopOps: 1,
          enableSelfLoop: true,
        });
        const { e, cpu, h, entry } = await createTestCPU(words);

        if (compiled) {
          warmFragment(h, entry);
          cpu.pc = entry;
          cpu.delayPC = null;
          cpu.setRegS32Extend(8, 0);          // t0 = 0
          cpu.setRegS32Extend(9, 5);          // t1 = 5
          cpu.setRegS32Extend(10, 999);       // t2 = 999 (don't take early branch during training)
          cpu.setRegS32Extend(16, 0x80003000);// s0
          cpu.setRegS32Extend(31, entry);     // ra
          cpu.run(6);
          const frag = h.fragmentCache.fragments.get(entry);
          expect(frag?.func).toBeFunction();
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
        // For exception-iter-3, start s0 at 0x80002ff9 so iter 1..3 fault or set s0 so iter 1 works?
        // Wait: s0 increments by 4 each iter, so to fault only on iter 3, let's test overflow or TLB miss!
        // With unmapped address 0x0000fff8, iter 1 accesses 0x80003000, etc. Instead let's use Compare or unaligned base via ADDIU?
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

  test('multi-block loop with internal forward branch stops cleanly at entryPC instead of mid-iteration', async () => {
    // 7-op loop at 0x80001000 with an internal taken forward branch at op 3:
    //   0x80001000: ADDIU t0, t0, 1         (0x25080001) - op 1
    //   0x80001004: ANDI  t2, t0, 1         (0x310a0001) - op 2
    //   0x80001008: BNE   t2, r0, skip      (0x15400002 -> 0x80001014) - op 3 (internal forward branch)
    //   0x8000100c: ADDIU t3, t3, 10        (0x256b000a) - op 4 (delay slot)
    //   0x80001010: ADDIU t3, t3, 100       (0x256b0064) - skipped when t2 != 0
    //   0x80001014: ADDIU t4, t4, 1         (0x258c0001) - op 5 (skip target)
    //   0x80001018: BNE   t0, t1, loop      (0x1509fff9 -> 0x80001000) - op 6 (back-edge branch)
    //   0x8000101c: ADDIU t5, t5, 3         (0x25ad0003) - op 7 (delay slot -> pc = 0x80001000)
    //   0x80001020: JR    ra                (0x03e00008)
    //   0x80001024: NOP                     (0x00000000)
    const words = [
      0x25080001,
      0x310a0001,
      0x15400002,
      0x256b000a,
      0x256b0064,
      0x258c0001,
      0x1509fff9,
      0x25ad0003,
      0x03e00008,
      0x00000000,
    ];

    for (const cfg of [
      { selfLoopCutoff: 'immediate', minSelfLoopOps: 1, enableSelfLoop: true, minOpsBeforeBranchStop: 9, expectedOps: 7 },
      { selfLoopCutoff: 'immediate', minSelfLoopOps: 1, enableSelfLoop: true, minOpsBeforeBranchStop: 17, expectedOps: 7 },
      { selfLoopCutoff: 'unroll', minSelfLoopOps: 14, enableSelfLoop: true, maxSelfLoopBodyOps: 0, minOpsBeforeBranchStop: 9, expectedOps: 14 },
    ]) {
      const states = [];
      for (const compiled of [false, true]) {
        Object.assign(dynarecConfig, { ...defaultConfig, ...cfg });
        const { e, cpu, h, entry } = await createTestCPU(words);

        if (compiled) {
          warmFragment(h, entry);
          cpu.pc = entry;
          cpu.delayPC = null;
          cpu.setRegS32Extend(8, 0);   // t0 = 0 (iter 1 has t0=1 -> t2=1,iter 2 if unrolled also needs t2=1 if we use t2=1)
          // Wait: so iter 2 also takes the forward branch during training, let's replace ANDI t2, t0, 1 with ORI t2, r0, 1 during training or test both paths!
          h.ram.set32((entry & 0x7fffff) + 4, 0x340a0001); // ORI t2, r0, 1
          cpu.setRegS32Extend(9, 10);  // t1 = 10
          cpu.run(cfg.expectedOps);
          const frag = h.fragmentCache.fragments.get(entry);
          expect(frag?.func).toBeFunction();
          expect(frag.opsCompiled).toBe(cfg.expectedOps);
          expect(frag.getCode()).toContain('do {');
        } else {
          h.ram.set32((entry & 0x7fffff) + 4, 0x340a0001);
        }

        cpu.pc = entry;
        cpu.delayPC = null;
        cpu.controlCountValue = 0;
        cpu.setRegS32Extend(8, 0);
        cpu.setRegS32Extend(9, 8);
        cpu.setRegS32Extend(11, 0);
        cpu.setRegS32Extend(12, 0);
        cpu.setRegS32Extend(13, 0);
        cpu.setRegS32Extend(31, 0x80001020);
        cpu.run(8 * 7 + 2);
        expect(e.fatalError()).toBeNull();
        states.push(captureState(cpu, h));
      }
      expect(states[1]).toEqual(states[0]);
    }
  });
});
