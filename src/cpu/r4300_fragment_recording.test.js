import { afterEach, describe, expect, test } from 'bun:test';
import { createHeadlessEmulator } from '../headless/headless_env.js';
import { getPerformanceProfile, setPerformanceProfiling } from '../debug/performance_profile.js';
import * as regs from './cpu0reg.js';

const entry = 0x80001000;

afterEach(() => setPerformanceProfiling(false));

async function loopFixture(length = 5) {
  const e = await createHeadlessEmulator({
    romBuffer: new ArrayBuffer(0x1000),
    rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' },
  });
  const { cpu0: cpu, hardware: h } = e;
  n64js.getSyncFlow = () => null;
  const words = [
    0x24210001, // ADDIU r1,r1,1
    0xac810000, // SW r1,0(a0)
    ...(length === 5 ? [0x24c60001] : []), // ADDIU r6,r6,1
    0x14250000 | ((1 - length) & 0xffff), // BNE r1,a1,entry
    0x24e70001, // ADDIU r7,r7,1 (delay slot)
  ];

  function reset(iterations = 1000) {
    cpu.reset();
    h.cpu1.reset();
    h.rsp.reset();
    cpu.controlCountValue = 0;
    cpu.opsExecuted = 0;
    cpu.setRandomSource(() => 0.5);
    cpu.setControlU32(regs.controlStatus, 0x20000000);
    cpu.cop1ControlChanged();
    cpu.pc = entry;
    cpu.setRegS32Extend(4, 0x80003000);
    cpu.setRegS32Extend(5, iterations);
    h.ram.u8.fill(0);
    words.forEach((word, i) => h.ram.set32(0x1000 + i * 4, word));
  }

  function compile() {
    reset();
    for (let i = 0; i < 499; i++) {
      h.fragmentCache.lookupFragment(entry);
    }
    cpu.run(20);
    const fragment = h.fragmentCache.fragments.get(entry);
    expect(fragment?.func).toBeFunction();
    return fragment;
  }

  function snapshot() {
    expect(e.fatalError()).toBeNull();
    const events = [];
    let deadline = cpu.eventQueue.cyclesToFirstEvent;
    for (let event = cpu.eventQueue.firstEvent; event; event = event.next) {
      events.push([event.type, deadline]);
      deadline += event.cyclesToNextEvent;
    }
    return {
      pc: cpu.pc, delayPC: cpu.delayPC, count: cpu.controlCountValue, cycles: cpu.getOpsExecuted(),
      gpr: [...cpu.gprU32], cop0: [...cpu.controlRegU32],
      memory: h.ram.getU32(0x3000), events,
    };
  }

  return { cpu, h, reset, compile, snapshot };
}

test('five-instruction loops end the trace after the first taken branch and its delay slot', async () => {
  const { compile } = await loopFixture();
  const fragment = compile();
  expect(fragment.opsCompiled).toBe(5);
  expect(fragment.instructionPCs).toEqual([entry, entry + 4, entry + 8, entry + 12, entry + 16]);
});

test('four-instruction loops can still unroll through a second iteration', async () => {
  const { compile } = await loopFixture(4);
  const fragment = compile();
  expect(fragment.opsCompiled).toBe(8);
  expect(fragment.instructionPCs).toEqual([...Array(8)].map((_, i) => entry + (i % 4) * 4));
});

for (const profiled of [false, true]) {
  describe(`short trace execution (profiling ${profiled})`, () => {
    for (const scenario of [4, 5, 6, 9, 10, 11, 'branch-exit', 'event']) {
      test(`${scenario} matches the interpreter`, async () => {
        const { cpu, h, reset, compile, snapshot } = await loopFixture();
        const fragment = compile();
        const cycles = typeof scenario === 'number' ? scenario : scenario === 'event' ? 100 : 11;
        const results = [];
        for (const compiled of [false, true]) {
          reset(scenario === 'branch-exit' ? 2 : 1000);
          if (compiled) {
            h.fragmentCache.fragments.set(entry, fragment);
            fragment.trackInstructions();
          }
          if (scenario === 'event') {
            // The next deadline leaves only one instruction after the first trace.
            cpu.addEvent('deadline', 6, () => cpu.breakExecution());
          }
          setPerformanceProfiling(profiled);
          cpu.run(cycles);
          results.push(snapshot());
          if (compiled && profiled) {
            const executed = scenario === 'event' ? 6 : cycles;
            expect(getPerformanceProfile().compiledOps).toBe(Math.floor(executed / 5) * 5);
          }
        }
        expect(results[1]).toEqual(results[0]);
        expect(results[1].cycles).toBe(scenario === 'event' ? 6 : cycles);
        if (scenario === 'branch-exit') {
          expect(results[1].pc).toBe(entry + 24);
          expect(cpu.getRegU32Lo(7)).toBe(2);
        }
      });
    }
  });
}
