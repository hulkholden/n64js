import { describe, expect, test } from 'bun:test';
import { createHeadlessEmulator } from '../headless/headless_env.js';
import * as regs from './cpu0reg.js';
import * as decode from './decode.js';
import { getPerformanceProfile, setPerformanceProfiling } from '../debug/performance_profile.js';

const { getFragmentMap, lookupFragment } = await import('./fragments.js');
const pc = 0x80001000;
const runCycles = 12;
const iop = (op, s, t, immediate = 0) => ((op << 26) | (s << 21) | (t << 16) | (immediate & 0xffff)) >>> 0;
const special = (op, s, t, d) => ((decode.OP_SPECIAL << 26) | (s << 21) | (t << 16) | (d << 11) | op) >>> 0;
const copMove = (op, transfer, t, d) => ((op << 26) | (transfer << 21) | (t << 16) | (d << 11)) >>> 0;
const cop1 = (format, op, d, s, t = 0) => ((decode.OP_COP1 << 26) | (format << 21) | (t << 16) | (s << 11) | (d << 6) | op) >>> 0;
const jump = target => ((decode.OP_J << 26) | ((target >>> 2) & 0x03ffffff)) >>> 0;
// Emulator breakpoint marker, not a native MIPS instruction.
const breakpointInstruction = 0x70000000;

async function compareExecutions(instructions, prepare = () => {}, train = () => {}, profiled = false) {
  const emulator = await createHeadlessEmulator({
    romBuffer: new ArrayBuffer(0x1000),
    rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' },
  });
  const { cpu0: cpu, hardware } = emulator;
  let cop1Checks = 0;
  let interruptRSPPCs = [];
  const handleInterrupt = cpu.handleInterrupt;
  cpu.handleInterrupt = function () {
    interruptRSPPCs.push(hardware.rsp.pc);
    return handleInterrupt.call(this);
  };
  const checkCopXUsable = cpu.checkCopXUsable;
  cpu.checkCopXUsable = function (copIdx) {
    if (copIdx === 1) cop1Checks++;
    return checkCopXUsable.call(this, copIdx);
  };
  n64js.getSyncFlow = () => null;
  const words = [...instructions];
  while (words.length < runCycles) words.push(0);

  function setup(prepareState) {
    cpu.reset();
    cpu.controlCountValue = 0;
    cpu.opsExecuted = 0;
    cpu.llBit = 0;
    cpu.lastControlRegWrite = 0n;
    cpu.setControlU32(regs.controlStatus, 0x20000000);
    cpu.cop1ControlChanged();
    hardware.cpu1.reset();
    hardware.rsp.reset();
    hardware.sp_mem.clear();
    hardware.sp_reg.clear();
    hardware.mi_reg.clear();
    interruptRSPPCs = [];
    cpu.pc = pc;
    hardware.ram.u8.fill(0);
    words.forEach((word, i) => hardware.ram.set32(0x1000 + i * 4, word));
    cpu.setRegS32Extend(4, 0x80003000);
    prepareState(cpu, hardware);
    cop1Checks = 0;
  }

  function snapshot() {
    expect(emulator.fatalError()).toBeNull();
    return {
      pc: cpu.pc,
      llBit: cpu.llBit,
      llAddr: cpu.getControlU32(regs.controlLLAddr),
      rspPC: hardware.rsp.pc,
      rspGPR: [...hardware.rsp.gprU32],
      rspHalted: hardware.rsp.halted,
      interruptRSPPCs: [...interruptRSPPCs],
      mi: [...hardware.mi_reg.u8],
      sp: [...hardware.sp_reg.u8],
      delayPC: cpu.delayPC,
      gpr: [...cpu.gprU64],
      cause: cpu.getControlU32(regs.controlCause),
      epc: cpu.getControlU32(regs.controlEPC),
      badVAddr: cpu.getControlU32(regs.controlBadVAddr),
      status: cpu.getControlU32(regs.controlStatus),
      fcsr: hardware.cpu1.control[31],
      fpr: Array.from({ length: 32 }, (_, i) => hardware.cpu1.loadU32(hardware.cpu1.fdRegIdx32(i))),
      rawFpr: [...hardware.cpu1.regU32],
      memory: [...hardware.ram.u8.slice(0x3000, 0x3020)],
      countCycles: cpu.controlCountValue,
      compareCycles: cpu.getCyclesUntilEvent('Compare'),
      rsp: {
        pc: hardware.rsp.pc,
        delayPC: hardware.rsp.delayPC,
        halted: hardware.rsp.halted,
        gpr: [...hardware.rsp.gprU32],
        memory: [...hardware.rsp.dmem.u8],
      },
    };
  }

  try {
    setPerformanceProfiling(false);
    setup(prepare);
    cpu.run(runCycles);
    const interpreted = snapshot();
    const interpretedCop1Checks = cop1Checks;

    // Use the production tracer/compiler, with safe inputs so a memory exception
    // does not prevent the training trace from completing.
    setup(train);
    for (let i = 0; i < 499; i++) lookupFragment(pc);
    cpu.run(runCycles);
    const fragment = getFragmentMap().get(pc);
    expect(fragment?.func).toBeFunction();

    setup(prepare);
    getFragmentMap().set(pc, fragment);
    setPerformanceProfiling(profiled);
    cpu.run(runCycles);
    expect(fragment.executionCount).toBe(1);
    expect(snapshot()).toEqual(interpreted);
    return { ...interpreted, code: fragment.func.toString(), profile: getPerformanceProfile(), interpretedCop1Checks, compiledCop1Checks: cop1Checks };
  } finally {
    setPerformanceProfiling(false);
  }
}

for (const profiled of [false, true]) {
  describe(`compiled exceptions and timing${profiled ? ' with profiling' : ''}`, () => {
    const compare = (words, prepare, train) => compareExecutions(words, prepare, train, profiled);

    for (const [name, opcode, operation] of [
      ['ANDI', decode.OP_ANDI, (s, i) => s & i],
      ['ORI', decode.OP_ORI, (s, i) => s | i],
      ['XORI', decode.OP_XORI, (s, i) => s ^ i],
    ]) {
      for (const value of [0n, 0xffffffffffffffffn, 0x800000007fffffffn, 0x7fffffff80000000n, 0xffffffff00000000n]) {
        for (const imm of [0, 0xffff]) {
          for (const [source, destination] of [[1, 2], [1, 1], [0, 2], [1, 0], [0, 0]]) {
            test(`${name} ${value.toString(16)} imm=${imm} r${source}->r${destination}`, async () => {
              const setup = c => c.setRegU64(1, value);
              const word = iop(opcode, source, destination, imm);
              // Exercise the operation in a taken branch delay slot as well.
              const result = await compare([iop(decode.OP_BEQ, 0, 0, 1), word], setup, setup);
              const expected = operation(source === 0 ? 0n : value, BigInt(imm));
              expect(result.gpr[destination]).toBe(destination === 0 ? 0n : expected);
              expect(result.code).not.toContain(`exec${name}`);
              if (profiled) expect(result.profile.compiledOps).toBe(runCycles);
            });
          }
        }
      }
    }

    for (const [s, t, d] of [[0, 0, 2], [1, 0, 2], [0, 1, 2], [1, 0, 1], [0, 1, 1], [1, 0, 0], [0, 1, 0], [0, 0, 0]]) {
      for (const value of [0n, 0xffffffffffffffffn, 0x800000007fffffffn, 0x7fffffff80000000n]) {
        test(`OR move/clear ${s},${t}->${d} ${value.toString(16)}`, async () => {
          const setup = c => {
            c.setRegU64(1, value);
            c.setRegU64(2, 0x123456789abcdef0n);
          };
          const result = await compare([iop(decode.OP_BEQ, 0, 0, 1), special(decode.SPECIAL_OR, s, t, d)], setup, setup);
          expect(result.gpr[d]).toBe(d === 0 || (s === 0 && t === 0) ? 0n : value);
          expect(result.code).not.toMatch(/exec(MOV|CLEAR|OR)\(/);
          if (profiled) expect(result.profile.compiledOps).toBe(runCycles);
        });
      }
    }

    test('word logical operations preserve active RSP and event ordering', async () => {
      const setup = (c, h) => {
        c.setRegU64(1, 0xffffffff80000000n);
        h.rsp.imem.u8.fill(0);
        h.rsp.imem.set32(0, iop(decode.OP_ADDIU, 1, 1, 1)); // ADDIU r1,r1,1
        h.rsp.imem.set32(4, jump(0)); // J 0
        h.rsp.imem.set32(8, iop(decode.OP_SW, 0, 1)); // SW r1,0(r0), delay slot
        h.rsp.unhalt();
        c.addEvent('Observe word operations', runCycles, () => {
          h.ram.set32(0x3000, c.getRegU32Lo(3));
          h.ram.set32(0x3004, h.rsp.gprU32[1]);
        });
      };
      // Include elided self-copy and register-zero writes while the RSP runs.
      const result = await compare([
        iop(decode.OP_ORI, 1, 2, 0xffff),
        iop(decode.OP_XORI, 2, 2, 0x8000),
        special(decode.SPECIAL_OR, 2, 0, 3),
        special(decode.SPECIAL_OR, 3, 0, 3),
        iop(decode.OP_ORI, 1, 0, 0xffff),
        iop(decode.OP_ANDI, 3, 4, 0xffff),
        special(decode.SPECIAL_OR, 0, 0, 2),
      ], setup, setup);
      expect(result.rsp.gpr[1]).toBeGreaterThan(0);
      expect(result.memory.slice(4, 8)).not.toEqual([0, 0, 0, 0]);
      expect(result.countCycles).toBe(runCycles);
    });

    test('word logical operations before a delay-slot fault preserve completed state', async () => {
      const setup = c => {
        c.setRegU64(1, 0xffffffff80000000n);
        c.setRegS32Extend(4, 0x80003001);
      };
      const result = await compare([
        iop(decode.OP_ORI, 1, 2, 0xffff),
        iop(decode.OP_XORI, 2, 2, 0x8000),
        special(decode.SPECIAL_OR, 2, 0, 3),
        iop(decode.OP_ANDI, 3, 5, 0xffff),
        special(decode.SPECIAL_OR, 0, 0, 6),
        iop(decode.OP_BEQ, 0, 0, 1),
        iop(decode.OP_LW, 4, 7),
      ], setup);
      expect(result.gpr[3]).toBe(0xffffffff80007fffn);
      expect(result.gpr[5]).toBe(0x7fffn);
      expect(result.gpr[6]).toBe(0n);
      expect(result.cause).toBe(0x80000010);
      expect(result.epc).toBe(pc + 20);
    });

    for (const [name, word, address, cause] of [
      ['LW alignment', iop(decode.OP_LW, 4, 2), 0x80003001, 0x10],
      ['SW alignment', iop(decode.OP_SW, 4, 2), 0x80003001, 0x14],
      ['LD alignment', iop(decode.OP_LD, 4, 2), 0x80003004, 0x10],
      ['SD alignment', iop(decode.OP_SD, 4, 2), 0x80003004, 0x14],
      ['LL alignment', iop(decode.OP_LL, 4, 2), 0x80003001, 0x10],
      ['LW TLB miss', iop(decode.OP_LW, 4, 2), 0x00400000, 0x08],
      ['SW TLB miss', iop(decode.OP_SW, 4, 2), 0x00400000, 0x0c],
      ['LD TLB miss', iop(decode.OP_LD, 4, 2), 0x00400000, 0x08],
      ['SD TLB miss', iop(decode.OP_SD, 4, 2), 0x00400000, 0x0c],
      ['LWC1 TLB miss', iop(decode.OP_LWC1, 4, 2), 0x00400000, 0x08],
    ]) {
      test(`${name} preserves the branch EPC and BD`, async () => {
        const result = await compare([iop(decode.OP_BEQ, 0, 0, 1), word], c => c.setRegS32Extend(4, address));
        expect(result.cause).toBe((0x80000000 | cause) >>> 0);
        expect(result.epc).toBe(pc);
        expect(result.badVAddr).toBe(address);
        if (profiled) expect(result.profile.compiledOps).toBe(2);
      });
    }

    for (const opcode of [
      decode.OP_LB, decode.OP_LBU, decode.OP_LH, decode.OP_LHU, decode.OP_LW, decode.OP_LWU,
      decode.OP_LD, decode.OP_LWL, decode.OP_LWR, decode.OP_LDL, decode.OP_LDR,
      decode.OP_SB, decode.OP_SH, decode.OP_SW, decode.OP_SD, decode.OP_SWL, decode.OP_SWR,
      decode.OP_SDL, decode.OP_SDR, decode.OP_LL, decode.OP_LLD, decode.OP_SC, decode.OP_SCD,
    ]) {
      for (const address of [0x80003000, 0xa0003000]) {
        test(`sequential integer memory ${opcode.toString(16)} at ${address.toString(16)} matches interpreter`, async () => {
          const setup = (c, h) => {
            c.setRegS32Extend(4, address);
            c.setRegU64(2, 0x123456789abcdef0n);
            c.llBit = 1;
            h.ram.set32(0x3000, 0xfedcba98);
            h.ram.set32(0x3004, 0x76543210);
          };
          const result = await compare([0, 0, iop(opcode, 4, 2)], setup, setup);
          expect(result.code).not.toContain('if (c.pc !== 0x8000100c)');
        });
      }
    }

    for (const taken of [false, true]) {
      for (const word of [iop(decode.OP_LW, 4, 2), iop(decode.OP_SW, 4, 2)]) {
        test(`integer memory delay slot exits when branch differs from training, taken=${taken}, op=${word.toString(16)}`, async () => {
          const setup = (c, h, branchTaken) => {
            c.setRegS32Extend(5, branchTaken ? 0 : 1);
            c.setRegS32Extend(2, 0x1234);
            h.ram.set32(0x3000, 0x5678);
          };
          const result = await compare([iop(decode.OP_BEQ, 5, 0, 2), word, iop(decode.OP_ADDIU, 3, 3, 1), iop(decode.OP_ADDIU, 3, 3, 2)],
            (c, h) => setup(c, h, taken), (c, h) => setup(c, h, !taken));
          expect(result.gpr[3]).toBe(taken ? 2n : 3n);
          expect(result.code).toContain(`if (c.pc !== 0x800010${taken ? '08' : '0c'})`);
        });
      }
    }

    test('sequential MMIO interrupt is serviced before another active RSP step', async () => {
      const setup = (c, h) => {
        c.setControlU32(regs.controlStatus, 0x20000401);
        c.statusRegisterChanged();
        c.setRegS32Extend(4, 0xa430000c); // MI interrupt mask.
        c.setRegS32Extend(2, 2); // Enable pending SP interrupt.
        h.mi_reg.set32(8, 1);
        for (let i = 0; i < runCycles; i++) h.sp_mem.set32(0x1000 + i * 4, iop(decode.OP_ADDIU, 1, 1, 1));
        h.rsp.unhalt();
      };
      const result = await compare([0, 0, iop(decode.OP_SW, 4, 2), iop(decode.OP_ORI, 0, 3, 0x77)], setup,
        (c, h) => { setup(c, h); h.mi_reg.set32(8, 0); });
      expect(result.epc).toBe(pc + 12);
      expect(result.gpr[3]).toBe(0n);
      expect(result.interruptRSPPCs).toEqual([12]);
      expect(result.code).not.toContain('if (c.pc !== 0x8000100c)');
      expect(result.code).toContain('if (c.stuffToDo) { return 3; }');
    });

    test('sequential store can start the RSP through MMIO', async () => {
      const setup = (c, h) => {
        c.setRegS32Extend(4, 0xa4040010); // SP status.
        c.setRegS32Extend(2, 1); // Clear HALT.
        for (let i = 0; i < runCycles; i++) h.sp_mem.set32(0x1000 + i * 4, iop(decode.OP_ADDIU, 1, 1, 1));
      };
      const result = await compare([0, 0, iop(decode.OP_SW, 4, 2), iop(decode.OP_LW, 5, 6)],
        (c, h) => { setup(c, h); c.setRegS32Extend(5, 0x80003000); },
        (c, h) => { setup(c, h); c.setRegS32Extend(5, 0x80003000); });
      expect(result.rspHalted).toBe(false);
      expect(result.rspGPR[1]).toBe(9);
    });

    test('four COP1 memory operations share one usability check', async () => {
      const result = await compare([
        iop(decode.OP_LWC1, 4, 2),
        iop(decode.OP_SWC1, 4, 2, 4),
        iop(decode.OP_LDC1, 4, 2),
        iop(decode.OP_SDC1, 4, 2, 8),
      ]);
      expect(result.interpretedCop1Checks).toBe(4);
      expect(result.compiledCop1Checks).toBe(1);
    });

    test('COP1 memory operations reuse an earlier arithmetic usability check', async () => {
      const result = await compare([cop1(decode.COP1_FMT_S, decode.COP1_FUNC_ADD, 0, 0, 0), iop(decode.OP_LWC1, 4, 2), iop(decode.OP_SWC1, 4, 2, 4)]);
      expect(result.interpretedCop1Checks).toBe(2);
      expect(result.compiledCop1Checks).toBe(0);
    });

    test('a Status write forces a new COP1 memory usability check', async () => {
      const setup = c => c.setRegS32Extend(5, 0x20000000);
      const result = await compare([
        iop(decode.OP_LWC1, 4, 2),
        copMove(decode.OP_COP0, decode.COP_MT, 5, regs.controlStatus),
        iop(decode.OP_SWC1, 4, 2, 4),
      ], setup, setup);
      expect(result.interpretedCop1Checks).toBe(2);
      expect(result.compiledCop1Checks).toBe(2);
    });

    for (const [name, opcode, store, wide] of [
      ['LWC1', decode.OP_LWC1, false, false], ['LDC1', decode.OP_LDC1, false, true],
      ['SWC1', decode.OP_SWC1, true, false], ['SDC1', decode.OP_SDC1, true, true],
    ]) {
      for (const fullMode of [false, true]) {
        for (const ft of [0, 3, 4, 31]) {
          test(`${name} FR=${Number(fullMode)} f${ft} preserves raw bits`, async () => {
            const setup = (c, h) => {
              c.setControlU32(regs.controlStatus, 0x20000000 | (fullMode ? 0x04000000 : 0));
              c.statusRegisterChanged();
              c.setRegS32Extend(4, 0x80003010);
              h.ram.set32(0x3000, 0x7fa12345);
              h.ram.set32(0x3004, 0x89abcdef);
              h.cpu1.store64(h.cpu1.copRegIdx64(ft), 0xfff123456789abcdn);
            };
            const word = iop(opcode, 4, ft, -16);
            // Repeat after the first COP1 check, including a taken delay slot.
            const result = await compare([word, iop(decode.OP_BEQ, 0, 0, 1), word], setup, setup);
            expect(result.cause).toBe(0);
            if (store) {
              expect(result.memory.slice(0, wide ? 8 : 4)).not.toEqual(Array(wide ? 8 : 4).fill(0));
            }
          });
        }
      }
      for (const delay of [false, true]) {
        for (const known of [false, true]) {
          for (const [fault, address, cause] of [
            ['alignment', 0x80003001, store ? 0x14 : 0x10],
            ['TLB miss', 0x00400000, store ? 0x0c : 0x08],
          ]) {
            test(`${name} ${fault}, delay=${delay}, COP1 checked=${known}`, async () => {
              const result = await compare(
                [known ? copMove(decode.OP_COP1, decode.COP_MF, 2, 0) : 0, delay ? iop(decode.OP_BEQ, 0, 0, 1) : 0, iop(opcode, 4, 3)],
                c => c.setRegS32Extend(4, address));
              expect(result.cause).toBe((cause | (delay ? 0x80000000 : 0)) >>> 0);
              expect(result.epc).toBe(pc + (delay ? 4 : 8));
              expect(result.badVAddr).toBe(address);
            });
          }
        }
        test(`${name} disabled COP1 precedes memory faults, delay=${delay}`, async () => {
          const result = await compare([delay ? iop(decode.OP_BEQ, 0, 0, 1) : 0, iop(opcode, 4, 0)], c => {
            c.setControlU32(regs.controlStatus, 0);
            c.cop1ControlChanged();
            c.setRegS32Extend(4, 0x80003001);
          });
          expect(result.cause).toBe((0x1000002c | (delay ? 0x80000000 : 0)) >>> 0);
          expect(result.epc).toBe(pc + (delay ? 0 : 4));
        });
      }
      for (const write of [copMove(decode.OP_COP0, decode.COP_MT, 5, regs.controlStatus), copMove(decode.OP_COP0, decode.COP_DMT, 5, regs.controlStatus)]) {
        test(`${name} remaps odd registers after FR changes ${write.toString(16)}`, async () => {
          const setup = (c, h) => {
            c.setRegS32Extend(5, 0x24000000);
            h.cpu1.regU32.forEach((_, i, regs) => { regs[i] = 0x12345600 + i; });
            h.ram.set32(0x3000, 0x89abcdef);
            h.ram.set32(0x3004, 0xfedcba98);
          };
          const word = iop(opcode, 4, 3);
          const result = await compare([word, write, word | 8], setup, setup);
          expect(result.cause).toBe(0);
        });
        test(`${name} rechecks COP1 after Status write ${write.toString(16)}`, async () => {
          const setup = c => c.setRegS32Extend(5, 0);
          const result = await compare([iop(opcode, 4, 0), write, iop(opcode, 4, 0)],
            setup, c => c.setRegS32Extend(5, 0x20000000));
          expect(result.cause).toBe(0x1000002c);
          expect(result.epc).toBe(pc + 8);
        });
      }
    }

    test('a successful delay-slot load clears the delay before a later fault', async () => {
      const result = await compare([iop(decode.OP_BEQ, 0, 0, 1), iop(decode.OP_LW, 4, 2), iop(decode.OP_LW, 5, 3)],
        c => c.setRegS32Extend(5, 0x80003001), c => c.setRegS32Extend(5, 0x80003004));
      expect(result.cause).toBe(0x10);
      expect(result.epc).toBe(pc + 8);
    });

    const noFPE = c => c.setRegS32Extend(4, 0);
    for (const fcsr of [0x20000, 0x10800]) {
      for (const delay of [false, true]) {
        test(`CTC1 raises FPE for FCSR=${fcsr.toString(16)}${delay ? ' in a delay slot' : ''}`, async () => {
          const result = await compare(
            [copMove(decode.OP_COP1, decode.COP_MF, 2, 0), 0, delay ? iop(decode.OP_BEQ, 0, 0, 1) : 0, copMove(decode.OP_COP1, decode.COP_CT, 4, 31), iop(decode.OP_ORI, 0, 3, 0x77)],
            c => c.setRegS32Extend(4, fcsr), noFPE);
          expect(result.cause).toBe(delay ? 0x8000003c : 0x3c);
          expect(result.epc).toBe(pc + (delay ? 8 : 12));
          expect(result.gpr[3]).toBe(0n);
        });
      }
    }

    test('a nontrapping CTC1 continues through the fragment', async () => {
      const result = await compare([
        copMove(decode.OP_COP1, decode.COP_MF, 2, 0),
        0,
        copMove(decode.OP_COP1, decode.COP_CT, 4, 31),
        iop(decode.OP_ORI, 0, 3, 0x77),
      ], noFPE, noFPE);
      expect(result.gpr[3]).toBe(119n);
      expect(result.cause).toBe(0);
    });

    // FIFA's startup sequence (#109). n64-systemtest's CvtW cases establish
    // that converting infinity is Unimplemented, even with Invalid disabled:
    // https://github.com/lemmy-64/n64-systemtest/blob/main/src/tests/cop1/mod.rs
    for (const invalidEnabled of [false, true]) {
      for (const negativeZero of [false, true]) {
        test(`TRUNC.W.S after DIV.S by ${negativeZero ? '-0' : '+0'}, Invalid ${invalidEnabled ? 'enabled' : 'disabled'}`, async () => {
          const fcsr = 0x01000004 | (invalidEnabled ? 0x800 : 0);
          const setup = (c, h, divisor) => {
            const f = h.cpu1;
            f.control[31] = fcsr;
            f.store32(f.fsRegIdx32(18), 0x46ac3e00); // 22047.0f
            f.store32(f.fsRegIdx32(8), divisor);
            f.store32(f.fdRegIdx32(10), 0x12345678);
          };
          const result = await compare(
            [cop1(decode.COP1_FMT_S, decode.COP1_FUNC_DIV, 0, 18, 8), cop1(decode.COP1_FMT_S, decode.COP1_FUNC_TRUNC_W, 10, 0, 0), copMove(decode.OP_COP1, decode.COP_MF, 3, 10)], // DIV.S; TRUNC.W.S; MFC1
            (c, h) => setup(c, h, negativeZero ? 0x80000000 : 0),
            (c, h) => setup(c, h, 0x42700000)); // Train with 60.0f.
          expect(result.cause).toBe(0x3c);
          expect(result.epc).toBe(pc + 4);
          expect(result.fcsr).toBe(fcsr | 0x20020); // Unimplemented cause + sticky Divide-by-zero.
          expect(result.fpr[0]).toBe(negativeZero ? 0xff800000 : 0x7f800000);
          expect(result.fpr[10]).toBe(0x12345678); // Faulting conversion does not write fd.
          expect(result.gpr[3]).toBe(0n); // The dependent MFC1 must not execute.
        });
      }
    }

    for (const [name, read, write] of [
      ['32-bit', copMove(decode.OP_COP0, decode.COP_MF, 2, regs.controlCount), copMove(decode.OP_COP0, decode.COP_MT, 4, regs.controlCount)],
      ['64-bit', copMove(decode.OP_COP0, decode.COP_DMF, 2, regs.controlCount), copMove(decode.OP_COP0, decode.COP_DMT, 4, regs.controlCount)],
    ]) {
      for (const phase of [0, 1]) {
        test(`${name} Count reads include preceding instructions, phase ${phase}`, async () => {
          const result = await compare([0, 0, read, 0, read | (1 << 16)], c => {
            c.controlCountValue = phase;
          });
          expect(result.gpr[2]).toBe(1n);
          expect(result.gpr[3]).toBe(2n);
          expect(result.countCycles).toBe(runCycles + phase);
        });
      }

      test(`${name} Count writes discard cycles preceding the write`, async () => {
        const setup = c => c.setRegS32Extend(4, 100);
        const result = await compare([0, 0, write], setup, setup);
        expect(result.countCycles).toBe(210);
        expect(result.compareCycles).toBe(0x200000000 - 210);
      });
    }

    for (const [name, word, initialCompare, value] of [
      ['MTC0 Compare', copMove(decode.OP_COP0, decode.COP_MT, 4, regs.controlCompare), null, 2],
      ['DMTC0 Compare', copMove(decode.OP_COP0, decode.COP_DMT, 4, regs.controlCompare), null, 2],
      ['MTC0 Count', copMove(decode.OP_COP0, decode.COP_MT, 4, regs.controlCount), 102, 100],
      ['DMTC0 Count', copMove(decode.OP_COP0, decode.COP_DMT, 4, regs.controlCount), 102, 100],
    ]) {
      test(`${name} respects a newly shortened timer deadline`, async () => {
        const setup = c => {
          c.setRegS32Extend(4, value);
          c.setControlU32(regs.controlStatus, 0x20008001);
          c.statusRegisterChanged();
          if (initialCompare !== null) c.setCompare(initialCompare);
        };
        const words = [0, 0, word, 0, ...(initialCompare === null ? [] : [0, 0]), iop(decode.OP_ORI, 0, 3, 0x77)];
        const result = await compare(words, setup, c => c.setRegS32Extend(4, 1000));
        expect(result.gpr[3]).toBe(0n);
        expect(result.epc).toBe(pc + (initialCompare === null ? 16 : 24));
        expect(result.cause & 0x8000).toBe(0x8000);
      });
    }

    for (const prefix of [0, 2, 11]) {
      test(`a memory fault charges ${prefix} completed fragment instructions`, async () => {
        const words = [...Array(prefix).fill(0), iop(decode.OP_LW, 4, 2)];
        const result = await compare(words, (c, hardware) => {
          c.setRegS32Extend(4, 0x80003001);
          for (let i = 0; i < runCycles; i++) hardware.ram.set32(0x180 + 4 * i, iop(decode.OP_DADDIU, 3, 3, 1));
        });
        expect(result.gpr[3]).toBe(BigInt(runCycles - prefix - 1));
        expect(result.countCycles).toBe(runCycles);
        if (profiled) expect(result.profile.compiledOps).toBe(prefix + 1);
      });
    }

    test('a fault after a Count read does not charge synchronized cycles twice', async () => {
      const result = await compare([
        0,
        0,
        copMove(decode.OP_COP0, decode.COP_MF, 2, regs.controlCount),
        0,
        iop(decode.OP_LW, 4, 3),
      ], (c, hardware) => {
        c.setRegS32Extend(4, 0x80003001);
        for (let i = 0; i < runCycles; i++) hardware.ram.set32(0x180 + 4 * i, iop(decode.OP_DADDIU, 8, 8, 1));
      });
      expect(result.gpr[2]).toBe(1n);
      expect(result.gpr[8]).toBe(7n);
      expect(result.countCycles).toBe(runCycles);
    });

    test('a breakpoint charges preceding instructions without charging the stopped instruction', async () => {
      const result = await compare([0, 0, breakpointInstruction],
        () => { n64js.breakpoints = () => ({ isBreakpoint: () => true }); },
        () => { n64js.breakpoints = () => ({ isBreakpoint: () => false }); });
      expect(result.pc).toBe(pc + 8);
      expect(result.countCycles).toBe(2);
      if (profiled) expect(result.profile.compiledOps).toBe(2);
    });

    for (const [name, branch] of [['BEQ', iop(decode.OP_BEQ, 0, 0, -1)], ['J', jump(0x100c)]]) {
      test(`${name} idle-loop skipping uses the current event countdown`, async () => {
        const setup = c => c.addEvent('Stop idle loop', 100, () => c.breakExecution());
        const result = await compare([0, 0, 0, branch, 0], setup, setup);
        expect(result.countCycles).toBe(100);
      });
    }
  });
}
