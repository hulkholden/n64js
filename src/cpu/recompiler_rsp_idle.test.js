import { describe, expect, test } from 'bun:test';
import { createHeadlessEmulator } from '../headless/headless_env.js';
import { getPerformanceProfile, setPerformanceProfiling } from '../debug/performance_profile.js';
import * as regs from './cpu0reg.js';
import * as sp from '../devices/sp_constants.js';

const branchPC = 0x80001000;
const entryPC = branchPC + 4;
const beq = 0x1000ffff;
const jump = 0x08000400;
const add = 0x24210001; // ADDIU r1,r1,1, valid on both processors.

async function execute(mode, profiled, { branch = beq, delay = 0, budget = 64, prepare = () => {} } = {}) {
  const emulator = await createHeadlessEmulator({ romBuffer: new ArrayBuffer(0x1000), rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' } });
  const { cpu0: c, hardware: h } = emulator;
  const observations = [];
  const observe = () => observations.push([c.pc, c.delayPC, c.controlCountValue, h.rsp.pc, h.rsp.gprU32[1]]);
  function setup(training) {
    c.reset();
    c.controlCountValue = 0;
    c.opsExecuted = 0;
    c.setControlU32(regs.controlStatus, 0x20000000);
    c.cop1ControlChanged();
    h.cpu1.reset(); h.rsp.reset(); h.ram.clear(); h.sp_mem.clear(); h.sp_reg.clear(); h.mi_reg.clear();
    h.spRegDevice.dmaQueue = [];
    if (delay === 0x8c220000) {
      c.setRegS32Extend(1, 0x80003000);
    }
    c.pc = entryPC;
    c.delayPC = branchPC;
    h.ram.set32(0x1000, branch);
    h.ram.set32(0x1004, delay);
    for (let i = 0; i < 128; i++) {
      h.rsp.imem.set32(i * 4, add);
    }
    h.rsp.unhalt();
    if (!training) {
      prepare(c, h, observe);
    }
    observations.length = 0;
  }
  try {
    setPerformanceProfiling(false);
    let fragment;
    if (mode !== 'interpreter') {
      setup(true);
      for (let i = 0; i < 499; i++) {
        h.fragmentCache.lookupFragment(entryPC);
      }
      c.run(2);
      fragment = h.fragmentCache.fragments.get(entryPC);
      expect(fragment?.func).toBeFunction();
      if (mode === 'original') {
        fragment.func = new Function('c', 'cpu1', 'rsp', `return (${fragment.func.toString().replace('!rsp.halted && !c.stuffToDo', 'false')});`)(c, h.cpu1, h.rsp);
      }
    }
    setup(false);
    if (fragment) {
      fragment.executionCount = 0; h.fragmentCache.fragments.set(entryPC, fragment); fragment.trackInstructions();
    }
    setPerformanceProfiling(profiled);
    h.rsp.setPerformanceProfiling(profiled);
    c.run(budget);
    expect(emulator.fatalError()).toBeNull();
    const events = [];
    let deadline = c.eventQueue.cyclesToFirstEvent;
    for (let event = c.eventQueue.firstEvent; event; event = event.next) {
      events.push([event.type, deadline]); deadline += event.cyclesToNextEvent;
    }
    return {
      profile: getPerformanceProfile(), runs: fragment?.executionCount ?? 0,
      code: fragment?.func?.toString() ?? '', slots: fragment?.nextFragments.length ?? 0,
      state: {
        pc: c.pc, delayPC: c.delayPC, gpr: [...c.gprU64], cop0: [...c.controlRegU64],
        fpr: [...h.cpu1.regU32], fcr: [...h.cpu1.control], count: c.controlCountValue,
        ops: c.opsExecuted, stuff: c.stuffToDo, events, observations,
        ram: [...h.ram.u8.slice(0x1000, 0x1040)], sp: [...h.sp_reg.u8], mi: [...h.mi_reg.u8], spmem: [...h.sp_mem.u8],
        rsp: {
          pc: h.rsp.pc, delayPC: h.rsp.delayPC, halted: h.rsp.halted,
          gpr: [...h.rsp.gprU32], vpr: [...h.rsp.vprU32], acc: [...h.rsp.vAcc],
          vco: [...h.rsp.vuVCOReg], vcc: [...h.rsp.vuVCCReg], vce: [...h.rsp.vuVCEReg],
          div: [h.rsp.divDP, h.rsp.divIn, h.rsp.divOut],
        },
      },
    };
  } finally { setPerformanceProfiling(false); }
}

for (const profiled of [false, true]) {
  describe(`active RSP idle batching, profiling=${profiled}`, () => {
    const compare = async (options = {}) => {
      const original = await execute('original', profiled, options);
      const optimized = await execute('optimized', profiled, options);
      const interpreted = await execute('interpreter', profiled, options);
      expect(optimized.state).toEqual(interpreted.state);
      expect(optimized.state).toEqual(original.state);
      if (profiled) {
        expect(optimized.profile.compiledOps + optimized.profile.interpretedOps).toBe(optimized.state.ops);
        expect(optimized.profile.rspInstructions).toBe(interpreted.profile.rspInstructions);
      }
      return { original, optimized, interpreted };
    };

    for (const branch of [beq, jump, 0x1021ffff]) {
      test(`batches unconditional self branch ${branch.toString(16)}`, async () => {
        const { original, optimized } = await compare({ branch });
        expect(optimized.code).toContain('runActiveRSPIdleLoop');
        expect(original.runs).toBe(32);
        expect(optimized.runs).toBe(1);
        expect(optimized.slots).toBeLessThanOrEqual(3);
        if (profiled) {
          expect(optimized.profile.activeRSPIdleOps).toBe(64);
          expect(optimized.profile.compiledOps).toBe(64);
          expect(optimized.profile.speedHackRSPActive).toBe(original.profile.speedHackRSPActive);
        }
      });
    }
    for (const budget of [1, 2, 3, 4, 7, 8, 9]) {
      test(`RunForCycles ends at phase ${budget}`, async () => { await compare({ budget }); });
      test(`event at cycle ${budget} observes exact phase and exits`, async () => {
        await compare({ prepare(c, h, observe) { c.addEvent('Observe', budget, () => { observe(); c.breakExecution(); }); } });
      });
    }
    for (const instruction of [0, 1, 6, 7]) {
      for (const interrupt of [false, true]) {
        test(`RSP BREAK at instruction ${instruction}, interrupt=${interrupt}`, async () => {
          await compare({ prepare(c, h) {
            h.rsp.imem.set32(instruction * 4, 0x0000000d);
            if (interrupt) {
              h.sp_reg.set32(sp.SP_STATUS_REG, sp.SP_STATUS_INTR_BREAK);
              h.mi_reg.set32(0xc, 1);
              c.setControlU32(regs.controlStatus, 0x20000401);
              c.statusRegisterChanged();
            }
          } });
        });
      }
    }
    test('halted RSP uses the original speedhack', async () => {
      const { optimized } = await compare({ prepare(c, h) { h.rsp.halt(0); } });
      expect(optimized.profile.activeRSPIdleOps).toBe(0);
    });
    test('event restarts halted RSP', async () => {
      await compare({ prepare(c, h) { h.rsp.halt(0); c.addEvent('Restart', 5, () => h.rsp.unhalt()); } });
    });
    for (const status of [sp.SP_CLR_HALT, sp.SP_CLR_HALT | sp.SP_SET_SSTEP]) {
      test(`CPU SP status write restarts RSP before entering the loop, status=${status}`, async () => {
        await compare({ prepare(c, h) {
          h.rsp.halt(0);
          c.pc = 0x80001010; c.delayPC = null;
          c.setRegS32Extend(4, 0xa4040010); c.setRegS32Extend(2, status);
          h.ram.set32(0x1010, 0xac820000); // SW r2,0(r4), clears SP HALT.
          h.ram.set32(0x1014, jump);
        } });
      });
    }
    test('event changes the PC without setting stuffToDo', async () => {
      await compare({ prepare(c) { c.addEvent('Redirect', 6, () => { c.pc = 0x80001010; c.delayPC = null; }); } });
    });
    test('event invalidates and rewrites the delay slot', async () => {
      await compare({ prepare(c, h) {
        c.addEvent('Rewrite', 6, () => {
          h.fragmentCache.invalidateEntry(entryPC); h.ram.set32(0x1004, add);
        });
      } });
    });
    test('different incoming delay target falls back', async () => {
      const { optimized } = await compare({ prepare(c) { c.delayPC = 0x80001010; } });
      expect(optimized.profile.activeRSPIdleOps).toBe(0);
    });
    test('non-NOP delay slot remains observable', async () => {
      const { optimized } = await compare({ delay: add });
      expect(optimized.code).not.toContain('runActiveRSPIdleLoop');
      expect(optimized.state.gpr[1]).toBe(32n);
    });
    test('conditional self branch is not specialized', async () => {
      const { optimized } = await compare({ branch: 0x1022ffff });
      expect(optimized.code).not.toContain('runActiveRSPIdleLoop');
    });
    test('delay-slot load exception uses original exception bookkeeping', async () => {
      const { optimized } = await compare({ delay: 0x8c220000, prepare(c) { c.setRegS32Extend(1, 0x80003001); } });
      expect(optimized.code).not.toContain('runActiveRSPIdleLoop');
    });
    test('pending interrupt prevents batch entry', async () => {
      await compare({ prepare(c, h) {
        h.mi_reg.set32(8, 1); h.mi_reg.set32(0xc, 1);
        c.setControlU32(regs.controlStatus, 0x20000401); c.updateCause3(); c.statusRegisterChanged();
      } });
    });
    test('Compare deadline interrupts within a batch', async () => {
      await compare({ prepare(c) {
        c.setRegS32Extend(1, 3); c.execMTC0(1, regs.controlCompare);
        c.setControlU32(regs.controlStatus, 0x20008001); c.statusRegisterChanged();
      } });
    });
    test('new DMA completion invalidates the loop before another iteration', async () => {
      await compare({ prepare(c, h) {
        h.rsp.imem.set32(0, 0x40801000); // MTC0 SP_RD_LEN, one-cycle DMA.
        const complete = h.spRegDevice.dmaComplete.bind(h.spRegDevice);
        h.spRegDevice.dmaComplete = () => {
          complete();
          h.fragmentCache.invalidateEntry(entryPC);
          h.ram.set32(0x1004, add);
        };
      } });
    });
    test('records the existing RSP DMA deadline discrepancy without extending it', async () => {
      // Existing compiled timing (#174): both paths step RSP twice before
      // charging the NOP. Keep this separate from the interpreter-equal cases.
      const options = { budget: 8, prepare(c, h) {
        h.rsp.imem.set32(0, 0x40801000); // MTC0 SP_RD_LEN, 8-byte DMA.
        h.rsp.imem.set32(4, 0x40023000); // MFC0 SP_DMA_BUSY.
      } };
      const original = await execute('original', profiled, options);
      const optimized = await execute('optimized', profiled, options);
      const interpreted = await execute('interpreter', profiled, options);
      expect(optimized.state).toEqual(original.state);
      expect(optimized.state.rsp.gpr[2]).toBe(1);
      expect(interpreted.state.rsp.gpr[2]).toBe(0);
    });
  });
}
