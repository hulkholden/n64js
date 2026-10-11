import { describe, expect, test } from 'bun:test';
import { createHeadlessEmulator } from '../headless/headless_env.js';
import { getPerformanceProfile, setPerformanceProfiling } from '../debug/performance_profile.js';
import * as regs from './cpu0reg.js';
import * as decode from './decode.js';

const pc = 0x80001000;
const runCycles = 12;
const iop = (op, s, t, immediate = 0) => ((op << 26) | (s << 21) | (t << 16) | (immediate & 0xffff)) >>> 0;
const readCount = (decode.OP_COP0 << 26) | (2 << 16) | (regs.controlCount << 11);

function startRSP(h, cycles = runCycles) {
  for (let i = 0; i < cycles; i++) {
    h.rsp.imem.set32(i * 4, iop(decode.OP_ADDIU, 1, 1, 1));
  }
  h.rsp.unhalt();
}

function setupPI(c, h) {
  c.setRegS32Extend(4, 0xa4600000);
  c.setRegS32Extend(5, 1); // Two-byte cartridge DMA, 33 cycles with default timings.
  h.piRegDevice.write32(0xa4600000, 0x3000);
  h.piRegDevice.write32(0xa4600004, 0x10000000);
}

// Train through the real dispatcher with RAM accesses, then run the same trace
// with device addresses. Neither instruction nor device handlers are replaced.
async function compare(instructions, prepare, profiled, { train = () => {}, cycles = runCycles } = {}) {
  const emulator = await createHeadlessEmulator({
    romBuffer: new ArrayBuffer(0x1000),
    rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' },
  });
  const { cpu0: cpu, hardware: h } = emulator;
  n64js.getSyncFlow = () => null;
  let interrupts = [];
  const handleInterrupt = cpu.handleInterrupt;
  cpu.handleInterrupt = function () {
    interrupts.push({ pc: this.pc, delayPC: this.delayPC, count: this.controlCountValue, rspPC: h.rsp.pc });
    return handleInterrupt.call(this);
  };
  const words = [...instructions];
  while (words.length < cycles + 4) {
    words.push(0);
  }
  function setup(fn) {
    h.reset();
    h.rsp.reset();
    h.spRegDevice.dmaQueue = [];
    h.spRegDevice.pendingSPMemAddr = 0;
    h.spRegDevice.pendingDRAMAddr = 0;
    cpu.controlCountValue = 0;
    cpu.opsExecuted = 0;
    cpu.llBit = 0;
    cpu.lastControlRegWrite = 0;
    cpu.setControlU32(regs.controlStatus, 0x20000000);
    cpu.cop1ControlChanged();
    cpu.pc = pc;
    words.forEach((word, i) => h.ram.set32(0x1000 + i * 4, word));
    cpu.setRegS32Extend(4, 0x80003000);
    interrupts = [];
    fn(cpu, h);
  }
  function snapshot() {
    expect(emulator.fatalError()).toBeNull();
    const events = [];
    let deadline = cpu.eventQueue.nextEventCountdown();
    for (let event = cpu.eventQueue.firstEvent; event; event = event.next) {
      events.push([event.type, deadline]);
      deadline += event.cyclesToNextEvent;
    }
    return {
      pc: cpu.pc, delayPC: cpu.delayPC, count: cpu.controlCountValue, ops: cpu.opsExecuted,
      epc: cpu.getControlU32(regs.controlEPC), cause: cpu.getControlU32(regs.controlCause),
      gpr: [...cpu.gprU64], cop0: [...cpu.controlRegU64], fpr: [...h.cpu1.regU32],
      interrupts, events,
      memory: [...h.ram.u8.slice(0x3000, 0x3100)],
      devices: ['sp_reg', 'mi_reg', 'vi_reg', 'ai_reg', 'pi_reg', 'si_reg'].map(name => [...h[name].u8]),
      spDMA: h.spRegDevice.dmaQueue.map(dma => ({ ...dma })),
      aiDMA: { count: h.aiRegDevice.dmaCount, lengths: [...h.aiRegDevice.dmaLengths], durations: [...h.aiRegDevice.dmaDurations] },
      rsp: { pc: h.rsp.pc, delayPC: h.rsp.delayPC, halted: h.rsp.halted, gpr: [...h.rsp.gprU32], memory: [...h.sp_mem.u8] },
    };
  }
  try {
    setPerformanceProfiling(false);
    setup(prepare);
    cpu.run(cycles);
    const interpreted = snapshot();
    setup(train);
    for (let i = 0; i < 499; i++) {
      h.fragmentCache.lookupFragment(pc);
    }
    cpu.run(cycles);
    const fragment = h.fragmentCache.fragments.get(pc);
    expect(fragment?.func).toBeFunction();
    setup(prepare);
    h.fragmentCache.fragments.set(pc, fragment);
    setPerformanceProfiling(profiled);
    cpu.run(cycles);
    expect(fragment.executionCount).toBe(1);
    expect(snapshot()).toEqual(interpreted);
    expect(cpu.fragmentOps).toBeNull();
    expect(cpu.fragmentCycles).toBe(0);
    return { ...interpreted, profile: getPerformanceProfile() };
  } finally {
    setPerformanceProfiling(false);
  }
}

for (const profiled of [false, true]) {
  describe(`compiled MMIO timing${profiled ? ' with profiling' : ''}`, () => {
    const run = (words, prepare, options) => compare(words, prepare, profiled, options);

    for (const prefix of [0, 2]) {
      test(`SP DMA deadline excludes ${prefix} preceding instructions`, async () => {
        const result = await run([...Array(prefix).fill(0), iop(decode.OP_SW, 4, 5, 8)], c => {
          c.setRegS32Extend(4, 0xa4040000);
          c.setRegS32Extend(5, 127);
        });
        expect(result.events).toContainEqual(['SP DMA', 4 + prefix]);
        expect(result.count).toBe(runCycles);
      });
    }

    test('an eight-byte SP DMA completes before the following busy-register read', async () => {
      const result = await run([0, 0, iop(decode.OP_SW, 4, 0, 8), iop(decode.OP_LW, 4, 2, 0x18)], c => {
        c.setRegS32Extend(4, 0xa4040000);
      });
      expect(result.gpr[2]).toBe(0n);
      expect(result.events.some(([name]) => name === 'SP DMA')).toBe(false);
    });

    test('VI_CURRENT includes elapsed instructions across a scanline boundary', async () => {
      const result = await run([0, 0, iop(decode.OP_LW, 4, 2, 0x10)], (c, h) => {
        c.setRegS32Extend(4, 0xa4400000);
        h.viRegDevice.write32(0xa4400018, 524);
        const elapsed = h.viRegDevice.countPerScanline * 2 - 1;
        c.eventQueue.incrementCount(elapsed);
        c.incrementCount(elapsed);
      });
      expect(result.gpr[2]).toBe(2n);
    });

    test('DMA after a Count read charges only the unsynchronized prefix', async () => {
      const result = await run([0, 0, readCount, 0, iop(decode.OP_SW, 4, 5, 8)], c => {
        c.setRegS32Extend(4, 0xa4040000);
        c.setRegS32Extend(5, 127);
      });
      expect(result.gpr[2]).toBe(1n);
      expect(result.events).toContainEqual(['SP DMA', 8]);
      expect(result.count).toBe(runCycles);
    });

    for (const taken of [false, true]) {
      test(`DMA in a delay slot preserves the dynamic branch target, taken=${taken}`, async () => {
        const result = await run([
          0, iop(decode.OP_BEQ, 6, 0, 2), iop(decode.OP_SW, 4, 0, 8),
          iop(decode.OP_ADDIU, 3, 3, 1), iop(decode.OP_LW, 4, 2, 0x18),
        ], c => {
          c.setRegS32Extend(4, 0xa4040000);
          c.setRegS32Extend(6, taken ? 0 : 1);
        }, { train: c => c.setRegS32Extend(6, taken ? 1 : 0) });
        expect(result.gpr[2]).toBe(0n);
        expect(result.gpr[3]).toBe(taken ? 0n : 1n);
        expect(result.delayPC).toBeNull();
      });

      test(`device interrupt in a delay slot is serviced before the next RSP step, taken=${taken}`, async () => {
        const result = await run([
          0, iop(decode.OP_BEQ, 6, 0, 2), iop(decode.OP_SW, 4, 5, 4), iop(decode.OP_ADDIU, 3, 3, 1),
        ], (c, h) => {
          c.setRegS32Extend(4, 0xa4500000);
          c.setRegS32Extend(5, 8);
          c.setRegS32Extend(6, taken ? 0 : 1);
          c.setControlU32(regs.controlStatus, 0x20000401);
          c.statusRegisterChanged();
          h.miRegDevice.write32(0xa430000c, 0x20); // Unmask AI interrupt.
          startRSP(h);
        });
        const target = pc + (taken ? 16 : 12);
        expect(result.interrupts).toEqual([{ pc: target, delayPC: null, count: 3, rspPC: 12 }]);
        expect(result.epc).toBe(target);
        expect(result.cause >>> 31).toBe(0);
        expect(result.gpr[3]).toBe(0n);
        expect(result.rsp.gpr[1]).toBe(runCycles);
      });
    }

    test('a PI deadline created inside a fragment interrupts at the correct instruction', async () => {
      const words = Array(64).fill(0);
      words[2] = iop(decode.OP_SW, 4, 5, 0x0c);
      words[35] = iop(decode.OP_ADDIU, 3, 3, 1);
      const result = await run(words, (c, h) => {
        setupPI(c, h);
        c.setControlU32(regs.controlStatus, 0x20000401);
        c.statusRegisterChanged();
        h.miRegDevice.write32(0xa430000c, 0x200); // Unmask PI interrupt.
        startRSP(h, 64);
      }, { cycles: 64 });
      expect(result.interrupts).toEqual([{ pc: pc + 35 * 4, delayPC: null, count: 35, rspPC: 35 * 4 }]);
      expect(result.gpr[3]).toBe(0n);
      expect(result.rsp.gpr[1]).toBe(64);
    });

    test('PI DMA scheduling excludes preceding instructions', async () => {
      const result = await run([0, 0, iop(decode.OP_SW, 4, 5, 0x0c)], setupPI);
      expect(result.events).toContainEqual(['PI Interrupt', 23]);
    });

    test('SI DMA scheduling excludes preceding instructions', async () => {
      const result = await run([0, 0, iop(decode.OP_SW, 4, 0, 0x10)], (c, h) => {
        c.setRegS32Extend(4, 0xa4800000);
        h.siRegDevice.write32(0xa4800000, 0x3000);
      });
      expect(result.events).toContainEqual(['SI DMA', 0x900 - 10]);
    });

    test('AI DMA scheduling excludes preceding instructions', async () => {
      const result = await run([0, 0, iop(decode.OP_SW, 4, 5, 4)], c => {
        c.setRegS32Extend(4, 0xa4500000);
        c.setRegS32Extend(5, 8);
      });
      expect(result.events).toContainEqual(['AI DMA', Math.floor(8 * 93750000 / (32000 * 4)) - 10]);
    });

    for (const opcode of [decode.OP_LW, decode.OP_LWU, decode.OP_LWC1]) {
      test(`AI length read through opcode ${opcode.toString(16)} includes elapsed instructions`, async () => {
        const result = await run([0, 0, iop(opcode, 4, 3, 4)], (c, h) => {
          c.setRegS32Extend(4, 0xa4500000);
          h.aiRegDevice.write32(0xa4500004, 16);
          // One cycle before the eight-byte boundary, with ample time before
          // completion so the dispatcher will enter the compiled fragment.
          const elapsed = Math.floor(h.aiRegDevice.dmaDurations[0] / 2) - 1;
          c.eventQueue.incrementCount(elapsed);
          c.incrementCount(elapsed);
        });
        if (opcode === decode.OP_LWC1) {
          expect(result.fpr.every(word => word === 0)).toBe(true);
        } else {
          expect(result.gpr[3]).toBe(0n);
        }
      });
    }

    test('a COP1 store can create an SP DMA deadline', async () => {
      const result = await run([0, 0, iop(decode.OP_SWC1, 4, 0, 8), iop(decode.OP_LW, 4, 2, 0x18)], c => {
        c.setRegS32Extend(4, 0xa4040000);
      });
      expect(result.gpr[2]).toBe(0n);
    });

    test('a fault after synchronized MMIO keeps the delay-slot EPC and total cycles', async () => {
      const result = await run([
        0, 0, readCount, iop(decode.OP_SW, 4, 5, 8),
        iop(decode.OP_BEQ, 0, 0, 1), iop(decode.OP_LW, 6, 3),
      ], c => {
        c.setRegS32Extend(4, 0xa4040000);
        c.setRegS32Extend(5, 127);
        c.setRegS32Extend(6, 0x80003001);
      }, { train: c => c.setRegS32Extend(6, 0x80003000) });
      expect(result.epc).toBe(pc + 16);
      expect(result.cause).toBe(0x80000010);
      expect(result.events).toContainEqual(['SP DMA', 7]);
      expect(result.count).toBe(runCycles);
    });

    test('an unaligned device address faults without starting DMA', async () => {
      const result = await run([0, 0, readCount, iop(decode.OP_BEQ, 0, 0, 1), iop(decode.OP_SW, 4, 0, 9)], c => {
        c.setRegS32Extend(4, 0xa4040000);
      }, { train: c => c.setRegS32Extend(4, 0x80002fff) });
      expect(result.epc).toBe(pc + 12);
      expect(result.cause).toBe(0x80000014);
      expect(result.events.some(([name]) => name === 'SP DMA')).toBe(false);
      expect(result.count).toBe(runCycles);
    });

    for (const address of [0x80003000, 0xa0003000, 0x00400000]) {
      test(`RAM at ${address.toString(16)} executes the whole compiled fragment`, async () => {
        const result = await run([0, 0, iop(decode.OP_SW, 4, 5), iop(decode.OP_LW, 4, 3)], c => {
          c.setRegS32Extend(4, address);
          c.setRegS32Extend(5, 0x1234);
          c.tlbEntries[0].update(0, 0, 0x00400000n, (3 << 6) | 7, (4 << 6) | 7);
        });
        expect(result.gpr[3]).toBe(0x1234n);
        if (profiled) {
          expect(result.profile.compiledOps).toBe(runCycles);
        }
      });
    }
  });
}
