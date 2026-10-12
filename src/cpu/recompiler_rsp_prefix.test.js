import { describe, expect, test } from 'bun:test';
import { createHeadlessEmulator } from '../headless/headless_env.js';
import { getPerformanceProfile, setPerformanceProfiling } from '../debug/performance_profile.js';
import * as regs from './cpu0reg.js';
import * as sp from '../devices/sp_constants.js';

const pc = 0x80001000;
const cycles = 12;
const add = (s, t, imm) => (0x24000000 | (s << 21) | (t << 16) | (imm & 0xffff)) >>> 0;
const store = 0xac820000; // SW r2,0(r4).
const guard = 'rsp.halted && !c.stuffToDo';

async function execute(mode, profiled, words, prepare, budget = cycles) {
  const emulator = await createHeadlessEmulator({ romBuffer: new ArrayBuffer(0x1000), rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' } });
  const { cpu0: c, hardware: h } = emulator;
  function setup(training) {
    c.reset();
    c.controlCountValue = 0;
    c.opsExecuted = 0;
    c.setControlU32(regs.controlStatus, 0x20000000);
    c.cop1ControlChanged();
    h.cpu1.reset();
    h.rsp.reset();
    h.ram.clear();
    h.sp_mem.clear();
    h.sp_reg.clear();
    h.mi_reg.clear();
    c.pc = pc;
    c.setRegS32Extend(4, 0x80003000);
    words.forEach((word, i) => h.ram.set32(0x1000 + 4 * i, word));
    if (!training) {
      prepare(c, h);
    }
  }
  try {
    setPerformanceProfiling(false);
    let fragment;
    if (mode !== 'interpreter') {
      setup(true);
      for (let i = 0; i < 499; i++) {
        h.fragmentCache.lookupFragment(pc);
      }
      c.run(cycles);
      fragment = h.fragmentCache.fragments.get(pc);
      expect(fragment?.func).toBeFunction();
      expect(fragment.func.toString()).toContain(guard);
      if (mode === 'original') {
        // Execute the retained, original interleaved body at the same boundaries.
        fragment.func = new Function('c', 'cpu1', 'rsp', `return (${fragment.func.toString().replace(guard, 'false')});`)(c, h.cpu1, h.rsp);
      }
    }
    setup(false);
    if (fragment) {
      h.fragmentCache.fragments.set(pc, fragment);
    }
    setPerformanceProfiling(profiled);
    h.rsp.setPerformanceProfiling(profiled);
    const step = h.rsp.step;
    let steps = 0;
    h.rsp.step = function () { steps++; return step.call(this); };
    c.run(budget);
    expect(emulator.fatalError()).toBeNull();
    const events = [];
    let deadline = c.eventQueue.cyclesToFirstEvent;
    for (let event = c.eventQueue.firstEvent; event; event = event.next) {
      events.push([event.type, deadline]);
      deadline += event.cyclesToNextEvent;
    }
    return {
      steps,
      profile: getPerformanceProfile(),
      runs: fragment?.executionCount ?? 0,
      state: {
        pc: c.pc, delayPC: c.delayPC, gpr: [...c.gprU64], cop0: [...c.controlRegU64],
        fpr: [...h.cpu1.regU32], fcr: [...h.cpu1.control], count: c.controlCountValue,
        ops: c.opsExecuted, stuff: c.stuffToDo, events,
        ram: [...h.ram.u8.slice(0x3000, 0x3040)],
        sp: [...h.sp_reg.u8], mi: [...h.mi_reg.u8], spmem: [...h.sp_mem.u8],
        rsp: {
          pc: h.rsp.pc, delayPC: h.rsp.delayPC, halted: h.rsp.halted,
          gpr: [...h.rsp.gprU32], vpr: [...h.rsp.vprU32], acc: [...h.rsp.vAcc],
          vco: [...h.rsp.vuVCOReg], vcc: [...h.rsp.vuVCCReg], vce: [...h.rsp.vuVCEReg],
          div: [h.rsp.divDP, h.rsp.divIn, h.rsp.divOut],
        },
      },
    };
  } finally {
    setPerformanceProfiling(false);
  }
}

function rspProgram(h) {
  for (let i = 0; i < cycles; i++) {
    h.rsp.imem.set32(i * 4, add(1, 1, 1));
  }
}

for (const profiled of [false, true]) {
  describe(`halted RSP prefix, profiling=${profiled}`, () => {
    const compare = async (words, prepare = () => {}, budget = cycles) => {
      const original = await execute('original', profiled, words, prepare, budget);
      const optimized = await execute('optimized', profiled, words, prepare, budget);
      const interpreted = await execute('interpreter', profiled, words, prepare, budget);
      expect(optimized.state).toEqual(original.state);
      expect(optimized.state).toEqual(interpreted.state);
      expect(optimized.profile).toEqual(original.profile);
      return { original, optimized };
    };

    test('omits halted steps but accounts every CPU instruction', async () => {
      const { original, optimized } = await compare([add(1, 1, 1), add(1, 1, 1)]);
      expect(original.steps).toBe(cycles);
      expect(optimized.steps).toBe(0);
      expect(optimized.state.count).toBe(cycles);
    });

    test('keeps every active RSP step', async () => {
      const { optimized } = await compare([0, 0], (c, h) => { rspProgram(h); h.rsp.unhalt(); });
      expect(optimized.steps).toBe(cycles);
      expect(optimized.state.rsp.gpr[1]).toBe(cycles);
    });

    for (const interrupt of [false, true]) {
      test(`active RSP BREAK, interrupt=${interrupt}`, async () => {
        await compare([add(1, 1, 1), add(1, 1, 1)], (c, h) => {
          rspProgram(h);
          h.rsp.imem.set32(8, 0x0000000d);
          if (interrupt) {
            h.sp_reg.set32(sp.SP_STATUS_REG, sp.SP_STATUS_INTR_BREAK);
            h.mi_reg.set32(0xc, 1);
            c.setControlU32(regs.controlStatus, 0x20000401);
            c.statusRegisterChanged();
          }
          h.rsp.unhalt();
        });
      });
    }

    for (const status of [sp.SP_CLR_HALT, sp.SP_CLR_HALT | sp.SP_SET_SSTEP]) {
      test(`SP status write restarts halted RSP, status=${status}`, async () => {
        const { optimized } = await compare([0, 0, store, add(3, 3, 1)], (c, h) => {
          rspProgram(h);
          c.setRegS32Extend(4, 0xa4040010);
          c.setRegS32Extend(2, status);
        });
        expect(optimized.state.rsp.gpr[1]).toBe(9);
        expect(optimized.steps).toBe(10); // The memory helper and all its successors.
      });
    }

    test('pending interrupt is handled before executing the prefix', async () => {
      await compare([0, 0], (c, h) => {
        h.mi_reg.set32(8, 1);
        h.mi_reg.set32(0xc, 1);
        c.setControlU32(regs.controlStatus, 0x20000401);
        c.updateCause3();
        c.statusRegisterChanged();
      });
    });

    for (const deadline of [1, 5, 12]) {
      test(`event at cycle ${deadline} can start RSP`, async () => {
        await compare([0, 0], (c, h) => {
          rspProgram(h);
          c.addEvent('Start RSP', deadline, () => h.rsp.unhalt());
        });
      });
      test(`RunForCycles budget ${deadline} preserves PC and delay state`, async () => {
        await compare([0, 0, 0x10000001, add(1, 1, 1)], () => {}, deadline);
      });
    }

    test('non-NOP delay work and an off-trace exit are retained', async () => {
      const { optimized } = await compare([0, 0, 0x10200002, add(3, 3, 1), add(3, 3, 2)], c => c.setRegS32Extend(1, 1));
      expect(optimized.state.gpr[3]).toBe(3n);
    });

    test('delay-slot fault preserves EPC, BD and the completed prefix', async () => {
      await compare([0, 0, 0x10000001, 0x8c820000], c => c.setRegS32Extend(4, 0x80003001));
    });

    test('Compare write shortens the deadline after the prefix', async () => {
      await compare([0, 0, 0x40845800, add(3, 3, 1), add(3, 3, 1)], c => {
        c.setRegS32Extend(4, 2);
        c.setControlU32(regs.controlStatus, 0x20008001);
        c.statusRegisterChanged();
      });
    });
  });
}
