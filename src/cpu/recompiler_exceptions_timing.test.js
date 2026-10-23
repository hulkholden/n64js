import { describe, expect, test } from 'bun:test';
import { getPerformanceProfile, setPerformanceProfiling } from '../debug/performance_profile.js';
import * as regs from './cpu0reg.js';
import {
  genericCompareSingle as genericCompareSingleOp,
  genericMultiply as genericMultiplyOp,
} from './cpu1_test_support.js';
import * as decode from './decode.js';
import {
  DEFAULT_PC,
  captureExecutionSnapshot,
  compileFragmentAt,
  cop1,
  copMove,
  createTestEmulator,
  iop,
  jump,
  resetExecutionState,
  special,
} from './test_helpers.js';

const pc = DEFAULT_PC;
const runCycles = 12;
// Emulator breakpoint marker, not a native MIPS instruction.
const breakpointInstruction = 0x70000000;

async function compareExecutions(instructions, prepare = () => {}, train = () => {}, profiled = false, genericMultiply = false) {
  const emulator = await createTestEmulator();
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
    if (copIdx === 1) {
      cop1Checks++;
    }
    return checkCopXUsable.call(this, copIdx);
  };
  const words = [...instructions];
  while (words.length < runCycles) {
    words.push(0);
  }

  function setup(prepareState) {
    resetExecutionState(cpu, words, { pc });
    interruptRSPPCs = [];
    cpu.setRegS32Extend(4, 0x80003000);
    prepareState(cpu, hardware);
    cop1Checks = 0;
  }

  function snapshot() {
    return {
      ...captureExecutionSnapshot(emulator, { ramOffset: 0x3000, ramLength: 0x20 }),
      ramEnd: [...hardware.ram.u8.slice(-16)],
      codeMemory: [...hardware.ram.u8.slice(0x1000, 0x1030)],
      interruptRSPPCs: [...interruptRSPPCs],
    };
  }

  try {
    setPerformanceProfiling(false);
    setup(prepare);
    const normalMultiply = hardware.cpu1.MUL_S;
    const normalCompareSingle = hardware.cpu1.handleFloatCompareSingle;
    if (genericMultiply) {
      hardware.cpu1.MUL_S = genericMultiplyOp;
      hardware.cpu1.handleFloatCompareSingle = genericCompareSingleOp;
    }
    cpu.run(runCycles);
    const interpreted = snapshot();
    const interpretedCop1Checks = cop1Checks;
    hardware.cpu1.MUL_S = normalMultiply;
    hardware.cpu1.handleFloatCompareSingle = normalCompareSingle;

    // Use the production tracer/compiler, with safe inputs so a memory exception
    // does not prevent the training trace from completing.
    setup(train);
    const fragment = compileFragmentAt(cpu, pc, runCycles);

    setup(prepare);
    hardware.fragmentCache.fragments.set(pc, fragment);
    setPerformanceProfiling(profiled);
    cpu.run(runCycles);
    expect(fragment.executionCount).toBe(1);
    expect(snapshot()).toEqual(interpreted);
    return {
      ...interpreted,
      code: fragment.func.toString(),
      profile: getPerformanceProfile(),
      interpretedCop1Checks,
      compiledCop1Checks: cop1Checks,
    };
  } finally {
    setPerformanceProfiling(false);
  }
}

for (const profiled of [false, true]) {
  describe(`compiled exceptions and timing${profiled ? ' with profiling' : ''}`, () => {
    const compare = (words, prepare, train, genericMultiply) => compareExecutions(words, prepare, train, profiled, genericMultiply);

    for (const fullMode of [false, true]) {
      for (const delay of [false, true]) {
        for (const [name, s, t, fcsr, cause] of [
          ['exact', 0x40000000, 0x40400000, 0, 0],
          ['inexact', 0x3f800001, 0x3f800001, 0, 0],
          ['inexact trap', 0x3f800001, 0x3f800001, 0x80, 0x3c],
          ['overflow trap', 0x7f7fffff, 0x40000000, 0x200, 0x3c],
          ['underflow trap', 0x00800000, 0x3f000000, 0, 0x3c],
          ['flushed underflow', 0x00800000, 0x3f000000, 0x1000000, 0],
          ['subnormal operand', 1, 0x40000000, 0, 0x3c],
          ['invalid trap', 0x7fc00001, 0x40000000, 0x800, 0x3c],
          ['signed zero', 0x80000000, 0x40000000, 0, 0],
          ['directed fallback', 0x3f800001, 0x3f800001, 2, 0],
        ]) {
          test(`MUL.S ${name}, FR=${Number(fullMode)}, delay=${delay} matches generic interpreter`, async () => {
            const setup = (c, h, safe = false) => {
              c.setControlU32(regs.controlStatus, 0x20000000 | (fullMode ? 0x04000000 : 0));
              c.cop1ControlChanged();
              const f = h.cpu1;
              f.control[31] = fcsr | 0x00800020;
              f.regU32[f.fsRegIdx32(3)] = safe ? 0x40000000 : s;
              f.regU32[f.ftRegIdx32(5)] = safe ? 0x40400000 : t;
              f.regU32[f.ftRegIdx32(5) + 1] = 0x12345678;
            };
            const result = await compare([
              copMove(decode.OP_COP1, decode.COP_MF, 2, 0),
              delay ? iop(decode.OP_BEQ, 0, 0, 1) : 0,
              cop1(decode.COP1_FMT_S, 0x02 /* MUL.S */, 5, 3, 5),
              iop(decode.OP_ORI, 0, 3, 0x77),
            ], setup, (c, h) => setup(c, h, true), true);
            expect(result.cause).toBe((cause | (cause && delay ? 0x80000000 : 0)) >>> 0);
            expect(result.countCycles).toBe(runCycles);
            expect(result.code.match(/executeCop1_disabled/g)?.length).toBe(1);
            if (cause) {
              expect(result.epc).toBe(pc + (delay ? 4 : 8));
              expect(result.fpr[5]).toBe(t);
              expect(result.rawFpr[11]).toBe(0x12345678);
              expect(result.gpr[3]).toBe(0n);
            } else {
              expect(result.rawFpr[11]).toBe(0);
              expect(result.gpr[3]).toBe(0x77n);
            }
          });
        }

        for (const [name, opFunc, s, t, fcsr, cause] of [
          ['C.LT.S ordered true', 0x3c, 0x3f800000, 0x40000000, 0, 0],
          ['C.LT.S ordered false', 0x3c, 0x40000000, 0x3f800000, 0, 0],
          ['C.EQ.S signed zero', 0x32, 0x80000000, 0x00000000, 0, 0],
          ['C.ULT.S qNaN untaken trap', 0x35, 0x7fc00001, 0x3f800000, 0, 0],
          ['C.LT.S qNaN invalid trap', 0x3c, 0x7fc00001, 0x3f800000, 0x800, 0x3c],
          ['C.SEQ.S sNaN invalid trap', 0x3a, 0x7f800001, 0x3f800000, 0x800, 0x3c],
        ]) {
          test(`${name}, FR=${Number(fullMode)}, delay=${delay} matches generic interpreter`, async () => {
            const setup = (c, h, safe = false) => {
              c.setControlU32(regs.controlStatus, 0x20000000 | (fullMode ? 0x04000000 : 0));
              c.cop1ControlChanged();
              const f = h.cpu1;
              f.control[31] = fcsr | 0x00800020;
              f.regU32[f.fsRegIdx32(3)] = safe ? 0x3f800000 : s;
              f.regU32[f.ftRegIdx32(5)] = safe ? 0x40000000 : t;
            };
            const result = await compare([
              copMove(decode.OP_COP1, decode.COP_MF, 2, 0),
              delay ? iop(decode.OP_BEQ, 0, 0, 1) : 0,
              cop1(decode.COP1_FMT_S, opFunc, 0, 3, 5),
              iop(decode.OP_ORI, 0, 3, 0x77),
            ], setup, (c, h) => setup(c, h, true), true);
            expect(result.cause).toBe((cause | (cause && delay ? 0x80000000 : 0)) >>> 0);
            expect(result.countCycles).toBe(runCycles);
          });
        }
      }
    }

    test('MUL.S checks COP1 usability before arithmetic in a delay slot', async () => {
      const setup = (c, h) => {
        c.setControlU32(regs.controlStatus, 0);
        c.cop1ControlChanged();
        h.cpu1.control[31] = 0x008010a4;
        h.cpu1.regU64[5] = 0x123456783f800001n;
      };
      const result = await compare([
        iop(decode.OP_BEQ, 0, 0, 1),
        cop1(decode.COP1_FMT_S, 0x02 /* MUL.S */, 5, 3, 5),
      ], setup, undefined, true);
      expect(result.cause).toBe(0x9000002c);
      expect(result.epc).toBe(pc);
      expect(result.fcsr).toBe(0x008010a4);
      expect(result.fpr[5]).toBe(0x3f800001);
      expect(result.rawFpr[11]).toBe(0x12345678);
    });

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
              if (profiled) {
                expect(result.profile.compiledOps).toBe(runCycles);
              }
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
          if (profiled) {
            expect(result.profile.compiledOps).toBe(runCycles);
          }
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
        if (profiled) {
          expect(result.profile.compiledOps).toBe(2);
        }
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
        for (let i = 0; i < runCycles; i++) {
          h.sp_mem.set32(0x1000 + i * 4, iop(decode.OP_ADDIU, 1, 1, 1));
        }
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
        for (let i = 0; i < runCycles; i++) {
          h.sp_mem.set32(0x1000 + i * 4, iop(decode.OP_ADDIU, 1, 1, 1));
        }
      };
      const result = await compare([0, 0, iop(decode.OP_SW, 4, 2), iop(decode.OP_LW, 5, 6)],
        (c, h) => { setup(c, h); c.setRegS32Extend(5, 0x80003000); },
        (c, h) => { setup(c, h); c.setRegS32Extend(5, 0x80003000); });
      expect(result.rspHalted).toBe(false);
      expect(result.rspGPR[1]).toBe(9);
    });

    test('guarded stores preserve overlap, base/value aliasing and big-endian bytes', async () => {
      const setup = c => {
        c.setRegS32Extend(4, 0x80003008);
        c.setRegU64(2, 0xdeadbeef12345678n);
      };
      const result = await compare([0,
        iop(decode.OP_SW, 4, 2, -8), iop(decode.OP_SW, 4, 4, -8), iop(decode.OP_SW, 4, 0, -4),
        iop(decode.OP_LW, 4, 4, -8), // Load overwrites the base before the next group.
        iop(decode.OP_SW, 4, 2, 0), iop(decode.OP_SW, 4, 2, 4),
      ], setup, setup);
      expect(result.code.match(/Guarded RAM SW group/g)).toHaveLength(2);
      expect(result.memory.slice(0, 16)).toEqual([
        0x80, 0, 0x30, 8, 0, 0, 0, 0, 0x12, 0x34, 0x56, 0x78, 0x12, 0x34, 0x56, 0x78,
      ]);
    });

    test('groups recompute their base after arithmetic and a base/destination-aliasing load', async () => {
      const setup = c => {
        c.setRegS32Extend(2, 0x12345678);
        c.setRegS32Extend(3, 0x80003010);
      };
      const result = await compare([0,
        iop(decode.OP_SW, 4, 2), iop(decode.OP_SW, 4, 2, 4),
        iop(decode.OP_ADDIU, 4, 4, 8),
        iop(decode.OP_SW, 4, 3), iop(decode.OP_SW, 4, 3, 4),
        iop(decode.OP_LW, 4, 4),
        iop(decode.OP_SW, 4, 2), iop(decode.OP_SW, 4, 2, 4),
      ], setup, setup);
      expect(result.code.match(/Guarded RAM SW group/g)).toHaveLength(3);
      expect(result.memory.slice(0, 24)).toEqual([
        0x12, 0x34, 0x56, 0x78, 0x12, 0x34, 0x56, 0x78,
        0x80, 0, 0x30, 0x10, 0x80, 0, 0x30, 0x10,
        0x12, 0x34, 0x56, 0x78, 0x12, 0x34, 0x56, 0x78,
      ]);
    });

    for (const [name, address, cause] of [
      ['alignment', 0x80003001, 0x14], ['TLB miss', 0x00400000, 0x0c],
      ['wraparound to TLB', 0xfffffffc, 0x0c],
    ]) {
      test(`guarded store fallback preserves ${name} exceptions and timing`, async () => {
        const result = await compare([0, iop(decode.OP_SW, 4, 2), iop(decode.OP_SW, 4, 3, 4)],
          c => c.setRegS32Extend(4, address));
        expect(result.code).toContain('Guarded RAM SW group');
        expect(result.epc).toBe(pc + 4);
        expect(result.badVAddr).toBe(address);
        expect(result.cause).toBe(cause);
      });
    }

    test('failed group guard preserves an earlier store before a later TLB fault', async () => {
      const setup = c => {
        c.setRegS32Extend(4, 0x00403ffc);
        c.setRegS32Extend(2, 0x12345678);
        c.setControlU32(regs.controlIndex, 0);
        c.setControlU32(regs.controlPageMask, 0);
        c.setControlU32(regs.controlEntryHi, 0x00402000);
        c.setControlU32(regs.controlEntryLo0, 0xc7); // Map both halves; next pair remains unmapped.
        c.setControlU32(regs.controlEntryLo1, 0xc7);
        c.tlbWriteIndex();
      };
      const result = await compare([0, iop(decode.OP_SW, 4, 2, -0xffc),
        iop(decode.OP_SW, 4, 2, 4)], setup);
      expect(result.code).toContain('Guarded RAM SW group');
      expect(result.memory.slice(0, 4)).toEqual([0x12, 0x34, 0x56, 0x78]);
      expect(result.epc).toBe(pc + 8);
      expect(result.badVAddr).toBe(0x00404000);
      expect(result.cause).toBe(0x0c);
    });

    test('group crossing RAM end uses helpers without duplicate or out-of-bounds fast writes', async () => {
      const setup = c => {
        c.setRegS32Extend(4, 0x807ffffc);
        c.setRegS32Extend(2, 0x12345678);
      };
      const result = await compare([0, iop(decode.OP_SW, 4, 2), iop(decode.OP_SW, 4, 3, 4)], setup);
      expect(result.ramEnd.slice(-4)).toEqual([0x12, 0x34, 0x56, 0x78]);
      expect(result.code).toContain('Guarded RAM SW group');
    });

    test('guarded fallback services MMIO interrupt before the second store or RSP step', async () => {
      const setup = (c, h) => {
        c.setControlU32(regs.controlStatus, 0x20000401);
        c.statusRegisterChanged();
        c.setRegS32Extend(4, 0xa430000c);
        c.setRegS32Extend(2, 2); // Enable pending SP interrupt.
        c.setRegS32Extend(3, 1); // Second store would disable it.
        h.mi_reg.set32(8, 1);
        for (let i = 0; i < runCycles; i++) {
          h.sp_mem.set32(0x1000 + i * 4, iop(decode.OP_ADDIU, 1, 1, 1));
        }
        h.rsp.unhalt();
      };
      const result = await compare([0, iop(decode.OP_SW, 4, 2), iop(decode.OP_SW, 4, 3)], setup);
      expect(result.code).toContain('Guarded RAM SW group');
      expect(result.epc).toBe(pc + 8);
      expect(result.interruptRSPPCs).toEqual([8]);
    });

    test('guarded fallback can start then stop RSP between stores', async () => {
      const setup = (c, h) => {
        c.setRegS32Extend(4, 0xa4040010);
        c.setRegS32Extend(2, 1); // Clear HALT.
        c.setRegS32Extend(3, 2); // Set HALT.
        h.sp_mem.set32(0x1000, iop(decode.OP_ADDIU, 1, 1, 1));
      };
      const result = await compare([0, iop(decode.OP_SW, 4, 2), iop(decode.OP_SW, 4, 3)], setup);
      expect(result.code).toContain('Guarded RAM SW group');
      expect(result.rspGPR[1]).toBe(1);
      expect(result.rspHalted).toBe(true);
    });

    test('RAM group retains active RSP steps and a mid-group RSP interrupt exit', async () => {
      const setup = (c, h) => {
        c.setControlU32(regs.controlStatus, 0x20000401);
        c.statusRegisterChanged();
        c.setRegS32Extend(2, 0x12345678);
        h.mi_reg.set32(0xc, 1); // SP interrupt mask.
        h.sp_reg.set32(0x10, 0x40); // Interrupt on BREAK (without raising it yet).
        h.sp_mem.set32(0x1008, 0x0000000d); // BREAK before the second store.
        h.rsp.unhalt();
      };
      const result = await compare([0, iop(decode.OP_SW, 4, 2), iop(decode.OP_SW, 4, 2, 4)], setup);
      expect(result.code).toContain('Guarded RAM SW group');
      expect(result.memory.slice(0, 8)).toEqual([0x12, 0x34, 0x56, 0x78, 0, 0, 0, 0]);
      expect(result.epc).toBe(pc + 8);
      expect(result.interruptRSPPCs).toEqual([12]);
    });

    test('guarded loads preserve sign-extension, $zero destination, and trailing base-clobbering loads', async () => {
      const setup = (c, h) => {
        c.setRegS32Extend(4, 0x80003000);
        h.ram.set32(0x3000, 0x76543210);
        h.ram.set32(0x3004, 0x89abcdef);
        h.ram.set32(0x3008, 0x80003010);
        h.ram.set32(0x3010, 0x11223344);
        h.ram.set32(0x3014, 0xfeedface);
      };
      const result = await compare([
        0,
        iop(decode.OP_LW, 4, 0, 0),
        iop(decode.OP_LW, 4, 2, 0),
        iop(decode.OP_LW, 4, 3, 4),
        iop(decode.OP_LW, 4, 4, 8), // Clobbers base r4 at the end of the first group.
        iop(decode.OP_LW, 4, 5, 0),
        iop(decode.OP_LW, 4, 6, 4),
      ], setup, setup);
      expect(result.code).toContain('Guarded RAM LW group (4 loads)');
      expect(result.code).toContain('Guarded RAM LW group (2 loads)');
      expect(result.gpr[0]).toBe(0n);
      expect(result.gpr[2]).toBe(0x76543210n);
      expect(result.gpr[3]).toBe(BigInt.asUintN(64, -0x76543211n));
      expect(result.gpr[4]).toBe(0xffffffff80003010n);
      expect(result.gpr[5]).toBe(0x11223344n);
      expect(result.gpr[6]).toBe(0xfffffffffeedfacen);
    });

    test('failed load group guard preserves an earlier load before a later TLB fault', async () => {
      const setup = (c, h) => {
        c.setRegS32Extend(4, 0x00403ffc);
        c.setControlU32(regs.controlIndex, 0);
        c.setControlU32(regs.controlPageMask, 0);
        c.setControlU32(regs.controlEntryHi, 0x00402000);
        c.setControlU32(regs.controlEntryLo0, 0xc7);
        c.setControlU32(regs.controlEntryLo1, 0xc7);
        c.tlbWriteIndex();
        h.ram.set32(0x3000, 0x89abcdef);
      };
      const result = await compare([
        0,
        iop(decode.OP_LW, 4, 2, -0xffc),
        iop(decode.OP_LW, 4, 3, 4),
      ], setup);
      expect(result.code).toContain('Guarded RAM LW group (2 loads)');
      expect(result.gpr[2]).toBe(0xffffffff89abcdefn);
      expect(result.gpr[3]).toBe(0n);
      expect(result.epc).toBe(pc + 8);
      expect(result.badVAddr).toBe(0x00404000);
      expect(result.cause).toBe(0x08);
    });

    test('RAM load group retains active RSP steps and a mid-group RSP interrupt exit', async () => {
      const setup = (c, h) => {
        c.setControlU32(regs.controlStatus, 0x20000401);
        c.statusRegisterChanged();
        h.ram.set32(0x3000, 0x12345678);
        h.ram.set32(0x3004, 0x89abcdef);
        h.mi_reg.set32(0xc, 1); // SP interrupt mask.
        h.sp_reg.set32(0x10, 0x40); // Interrupt on BREAK.
        h.sp_mem.set32(0x1008, 0x0000000d); // BREAK before the second load.
        h.rsp.unhalt();
      };
      const result = await compare([0, iop(decode.OP_LW, 4, 2), iop(decode.OP_LW, 4, 3, 4)], setup);
      expect(result.code).toContain('Guarded RAM LW group (2 loads)');
      expect(result.gpr[2]).toBe(0x12345678n);
      expect(result.gpr[3]).toBe(0n);
      expect(result.epc).toBe(pc + 8);
      expect(result.interruptRSPPCs).toEqual([12]);
    });

    test('a breakpoint after a RAM group charges only completed instructions', async () => {
      const result = await compare([0, iop(decode.OP_SW, 4, 2), iop(decode.OP_SW, 4, 2, 4), breakpointInstruction],
        c => {
          c.setRegS32Extend(2, 0x12345678);
          n64js.breakpoints = () => ({ isBreakpoint: () => true });
        }, () => { n64js.breakpoints = () => ({ isBreakpoint: () => false }); });
      expect(result.code).toContain('Guarded RAM SW group');
      expect(result.memory.slice(0, 8)).toEqual([0x12, 0x34, 0x56, 0x78, 0x12, 0x34, 0x56, 0x78]);
      expect(result.pc).toBe(pc + 12);
      expect(result.countCycles).toBe(3);
      if (profiled) {
        expect(result.profile.compiledOps).toBe(3);
      }
    });

    test('events due inside a store group keep the interpreter event boundary', async () => {
      const observations = [];
      const setup = c => {
        c.setRegS32Extend(2, 0x12345678);
        c.addEvent('observe stores', 2, () => observations.push([c.pc, c.hardware.ram.getU32(0x3004)]));
      };
      // This event rejects the compiled fragment before entry, so test that path
      // separately from compareExecutions, which requires a compiled invocation.
      const emulator = await createTestEmulator();
      const { cpu0: c, hardware } = emulator;
      const words = [0, iop(decode.OP_SW, 4, 2), iop(decode.OP_SW, 4, 2, 4), ...Array(9).fill(0)];
      const reset = () => {
        resetExecutionState(c, words, { pc });
        c.setRegS32Extend(4, 0x80003000);
      };
      reset();
      const fragment = compileFragmentAt(c, pc, runCycles);
      expect(fragment.func.toString()).toContain('Guarded RAM SW group');
      reset(); setup(c); c.run(runCycles);
      reset(); setup(c); hardware.fragmentCache.fragments.set(pc, fragment); c.run(runCycles);
      expect(fragment.executionCount).toBe(0);
      expect(observations).toEqual([[pc + 8, 0], [pc + 8, 0]]);
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

    test('unchecked SWC1 services an MMIO interrupt before another active RSP step', async () => {
      const setup = (c, h) => {
        c.setControlU32(regs.controlStatus, 0x20000401);
        c.statusRegisterChanged();
        c.setRegS32Extend(4, 0xa430000c); // MI interrupt mask.
        h.cpu1.store32(h.cpu1.copRegIdx32(2), 2); // Enable pending SP interrupt.
        h.mi_reg.set32(8, 1);
        for (let i = 0; i < runCycles; i++) {
          h.sp_mem.set32(0x1000 + i * 4, iop(decode.OP_ADDIU, 1, 1, 1));
        }
        h.rsp.unhalt();
      };
      const result = await compare([
        copMove(decode.OP_COP1, decode.COP_MF, 2, 0), 0,
        iop(decode.OP_SWC1, 4, 2), iop(decode.OP_ORI, 0, 3, 0x77),
      ], setup, (c, h) => { setup(c, h); h.mi_reg.set32(8, 0); });
      expect(result.epc).toBe(pc + 12);
      expect(result.gpr[3]).toBe(0n);
      expect(result.interruptRSPPCs).toEqual([12]);
      expect(result.code).not.toContain('if (c.pc !== 0x8000100c)');
      expect(result.code).toContain('if (c.stuffToDo) { return 3; }');
      if (profiled) {
        expect(result.profile.compiledOps).toBe(3);
      }
    });

    test('unchecked SWC1 starts the RSP before the following COP1 load', async () => {
      const setup = (c, h) => {
        c.setRegS32Extend(4, 0xa4040010); // SP status.
        c.setRegS32Extend(5, 0xa4000000); // RSP DMEM.
        h.cpu1.store32(h.cpu1.copRegIdx32(2), 1); // Clear HALT.
        h.rsp.gprU32[1] = 0x12345678;
        h.sp_mem.set32(0x1000, iop(decode.OP_SW, 0, 1));
      };
      const result = await compare([
        copMove(decode.OP_COP1, decode.COP_MF, 2, 0), 0,
        iop(decode.OP_SWC1, 4, 2), iop(decode.OP_LWC1, 5, 4),
      ], setup, setup);
      expect(result.rspHalted).toBe(false);
      expect(result.fpr[4]).toBe(0x12345678);
      expect(result.rspPC).toBe(36);
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
      for (const taken of [false, true]) {
        test(`unchecked ${name} delay target differs from training, taken=${taken}`, async () => {
          const setup = (c, h, branchTaken) => {
            c.setRegS32Extend(5, branchTaken ? 0 : 1);
            h.cpu1.store64(h.cpu1.copRegIdx64(2), 0x123456789abcdef0n);
            h.ram.set32(0x3000, 0x7fa12345);
            h.ram.set32(0x3004, 0x89abcdef);
          };
          const result = await compare([
            copMove(decode.OP_COP1, decode.COP_MF, 2, 0),
            iop(decode.OP_BEQ, 5, 0, 2), iop(opcode, 4, 2),
            iop(decode.OP_ADDIU, 3, 3, 1), iop(decode.OP_ADDIU, 3, 3, 2),
          ], (c, h) => setup(c, h, taken), (c, h) => setup(c, h, !taken));
          expect(result.gpr[3]).toBe(taken ? 2n : 3n);
          expect(result.code).toContain(`if (c.pc !== 0x800010${taken ? '0c' : '10'})`);
          if (profiled) {
            expect(result.profile.compiledOps).toBe(3);
          }
        });
      }

      test(`unchecked ${name} clears the delay slot before a subsequent fault`, async () => {
        const result = await compare([
          copMove(decode.OP_COP1, decode.COP_MF, 2, 0),
          iop(decode.OP_BEQ, 0, 0, 1), iop(opcode, 4, 2),
          0, 0, iop(decode.OP_LW, 5, 3),
        ], c => c.setRegS32Extend(5, 0x80003001), c => c.setRegS32Extend(5, 0x80003004));
        expect(result.cause).toBe(0x10);
        expect(result.epc).toBe(pc + 20);
        expect(result.countCycles).toBe(runCycles);
        if (profiled) {
          expect(result.profile.compiledOps).toBe(6);
        }
      });

      for (const address of [0x80003000, 0xa0003000, 0x00400000]) {
        for (const fullMode of [false, true]) {
          test(`sequential unchecked ${name} FR=${Number(fullMode)} at ${address.toString(16)}`, async () => {
            const setup = (c, h) => {
              c.setControlU32(regs.controlStatus, 0x20000000 | (fullMode ? 0x04000000 : 0));
              c.statusRegisterChanged();
              c.setRegS32Extend(4, address);
              c.tlbEntries[0].update(0, 0, 0x00400000n, 0xc7, 0x107);
              h.ram.set32(0x3000, 0x7fa12345);
              h.ram.set32(0x3004, 0x89abcdef);
              h.cpu1.regU32.forEach((_, i, regs) => { regs[i] = 0xfff12300 + i; });
            };
            const result = await compare([
              copMove(decode.OP_COP1, decode.COP_MF, 2, 0), 0,
              iop(opcode, 4, 3), iop(opcode, 4, 3, 8), 0,
            ], setup, setup);
            expect(result.cause).toBe(0);
            expect(result.code).not.toContain('if (c.pc !== 0x8000100c)');
            expect(result.code).not.toContain('if (c.pc !== 0x80001010)');
            const afterAccess = result.code.slice(result.code.indexOf(`c.exec${name}Unchecked`));
            expect(afterAccess).not.toContain('if (c.delayPC !== null)');
            expect(result.code).toContain('c.exec' + name + 'Unchecked');
            if (profiled) {
              expect(result.profile.compiledOps).toBe(runCycles);
            }
          });
        }
      }

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
              expect(result.countCycles).toBe(runCycles);
              if (profiled) {
                expect(result.profile.compiledOps).toBe(3);
              }
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
          if (initialCompare !== null) {
            c.setCompare(initialCompare);
          }
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
          for (let i = 0; i < runCycles; i++) {
            hardware.ram.set32(0x180 + 4 * i, iop(decode.OP_DADDIU, 3, 3, 1));
          }
        });
        expect(result.gpr[3]).toBe(BigInt(runCycles - prefix - 1));
        expect(result.countCycles).toBe(runCycles);
        if (profiled) {
          expect(result.profile.compiledOps).toBe(prefix + 1);
        }
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
        for (let i = 0; i < runCycles; i++) {
          hardware.ram.set32(0x180 + 4 * i, iop(decode.OP_DADDIU, 8, 8, 1));
        }
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
      if (profiled) {
        expect(result.profile.compiledOps).toBe(2);
      }
    });

    test('hoisted !rsp.halted check skips rsp.step when halted and exits on mid-fragment RSP break interrupt', async () => {
      const setup = (c, h, triggerInterrupt = true) => {
        c.setControlU32(regs.controlStatus, 0x20000401);
        c.statusRegisterChanged();
        h.mi_reg.set32(0x0c, 1); // Enable MI_INTR_SP in MI_INTR_MASK_REG.
        c.setRegS32Extend(4, 0xa4040010); // SP_STATUS_REG
        // Clear HALT (0x01) and Clear BROKE (0x04), plus Set INTR_BREAK (0x100) when testing interrupt exit.
        c.setRegS32Extend(5, triggerInterrupt ? 0x105 : 0x05);
        h.sp_mem.set32(0x1000, iop(decode.OP_ADDIU, 1, 1, 7));
        h.sp_mem.set32(0x1004, special(0x0d)); // RSP BREAK
      };
      const result = await compare([
        0,
        iop(decode.OP_SW, 4, 5, 0), // Start RSP at instruction 1
        iop(decode.OP_ADDIU, 2, 2, 1), // Step 1 of RSP (ADDIU) runs before this op
        iop(decode.OP_ADDIU, 2, 2, 2), // Step 2 of RSP (BREAK -> SP interrupt) runs before this op and exits
        iop(decode.OP_ADDIU, 2, 2, 4),
      ], (c, h) => setup(c, h, true), (c, h) => setup(c, h, false));
      expect(result.code).toContain('let rspHalted = rsp.halted;');
      expect(result.code).toContain('if (!rspHalted) { rsp.step(); rspHalted = rsp.halted; if (c.stuffToDo)');
      expect(result.rspHalted).toBe(true);
      expect(result.gpr[2]).toBe(1n);
      expect(result.epc).toBe(pc + 12);
      expect(result.interruptRSPPCs).toEqual([8]);
    });

    test('checked SWC1 starts the RSP before the following instruction', async () => {
      const setup = (c, h) => {
        c.setRegS32Extend(4, 0xa4040010); // SP_STATUS_REG
        h.cpu1.store32(h.cpu1.copRegIdx32(2), 1); // Clear HALT.
        h.sp_mem.set32(0x1000, iop(decode.OP_ADDIU, 1, 1, 1));
      };
      const result = await compare([
        iop(decode.OP_SWC1, 4, 2),
        iop(decode.OP_ADDIU, 3, 3, 1),
      ], setup, setup);
      expect(result.code).toContain('c.execSWC1(2, 4, 0);');
      expect(result.rspHalted).toBe(false);
      expect(result.rspGPR[1]).toBe(1);
    });

    test('non-store helpers and fast-path RAM store groups do not reload rsp.halted', async () => {
      const setup = (c, h) => {
        c.setRegS32Extend(4, 0x80003000);
        c.setRegS32Extend(2, 0x12345678);
        h.ram.set32(0x3000, 0x11223344);
        h.cpu1.store32(h.cpu1.fsRegIdx32(2), 0x40000000);
        h.cpu1.store32(h.cpu1.ftRegIdx32(4), 0x40400000);
      };
      const result = await compare([
        0,
        cop1(decode.COP1_FMT_S, 0x02 /* MUL.S */, 6, 2, 4),
        iop(decode.OP_LW, 4, 3, 0),
        iop(decode.OP_SW, 4, 2, 4),
        iop(decode.OP_SW, 4, 3, 8),
        iop(decode.OP_LWC1, 4, 8, 4),
        iop(decode.OP_ADDIU, 3, 3, 1),
      ], setup, setup);
      expect(result.code).toContain('Guarded RAM SW group (2 stores)');
      // Only the entry declaration, the 12 step preambles (+1 in the slow fallback),
      // and the 3 slow-fallback refreshes (2 slow stores + 1 post-fallback) mention rsp.halted.
      expect(result.code.match(/rspHalted = rsp\.halted;/g)).toHaveLength(1 + 12 + 1 + 3);
    });

    for (const [name, branch] of [['BEQ', iop(decode.OP_BEQ, 0, 0, -1)], ['J', jump(0x100c)]]) {
      test(`${name} idle-loop skipping uses the current event countdown`, async () => {
        const setup = c => c.addEvent('Stop idle loop', 100, () => c.breakExecution());
        const result = await compare([0, 0, 0, branch, 0], setup, setup);
        expect(result.countCycles).toBe(100);
      });
    }

    test('non-delay fragment entry elides step-0 delay checks and groups step-0 RAM accesses', async () => {
      const setup = c => {
        c.setRegS32Extend(2, 0x12345678);
        c.setRegS32Extend(3, -0x76543210);
      };
      const result = await compare([
        iop(decode.OP_SW, 4, 2, 0),
        iop(decode.OP_SW, 4, 3, 4),
        iop(decode.OP_LW, 4, 5, 0),
        iop(decode.OP_LW, 4, 6, 4),
      ], setup, setup);
      expect(result.code).toContain('Guarded RAM SW group (2 stores)');
      expect(result.code).toContain('Guarded RAM LW group (2 loads)');
      expect(result.code).not.toContain('c.delayPC ??');
      expect(result.code).not.toContain('if (c.delayPC !== null)');
      expect(result.code).not.toContain('if (c.pc !== 0x80001004)');
      expect(result.gpr[5]).toBe(0x12345678n);
      expect(result.gpr[6]).toBe(BigInt.asUintN(64, -0x76543210n));
    });

    test('entering a delay slot at a cached non-delay fragment drops to the interpreter and honors delayPC', async () => {
      const emulator = await createTestEmulator();
      const { cpu0: c, hardware } = emulator;
      // Words at 0x80001000..0x8000102c:
      //   0x80001000: BEQ   r8, r9, -1   (speed-hack branch -> bails out after 1 op with pc=0x80001004, delayPC=0x80001000)
      //   0x80001004: SW    r2, 0(r4)    (start of cached non-delay fragment F2)
      //   0x80001008: SW    r3, 4(r4)    (second store of F2's step-0 SW group)
      //   0x8000100c: ADDIU r5, r5, 1
      //   0x80001010: ADDIU r6, r6, 99   (branch target for direct delay-slot entry test)
      const words = [
        iop(decode.OP_BEQ, 8, 9, -1),
        iop(decode.OP_SW, 4, 2, 0),
        iop(decode.OP_SW, 4, 3, 4),
        iop(decode.OP_ADDIU, 5, 5, 1),
        iop(decode.OP_ADDIU, 6, 6, 99),
        ...Array(8).fill(0),
      ];

      // Compile F2 starting at pc + 4 with entryDelayPC === null (so [SW, SW] at pc + 4 forms a step-0 SW group).
      resetExecutionState(c, words, { pc });
      c.pc = pc + 4;
      c.setRegS32Extend(4, 0x80003000);
      const nonDelayFragment = compileFragmentAt(c, pc + 4, 4);
      expect(nonDelayFragment.entryDelayPC).toBeNull();
      expect(nonDelayFragment.func.toString()).toContain('Guarded RAM SW group (2 stores)');

      // 1. Direct cpu.run() entry at pc + 4 with a pending delayPC = pc + 0x10:
      //    F2 must not be entered; only the single delay-slot SW at pc + 4 runs before jumping to pc + 0x10.
      const runDirectDelayEntry = (withCachedFragment, address = 0x80003000) => {
        resetExecutionState(c, words, { pc });
        c.pc = pc + 4;
        c.delayPC = pc + 0x10;
        c.setRegS32Extend(2, 0x11223344);
        c.setRegS32Extend(3, 0x55667788);
        c.setRegS32Extend(4, address);
        if (withCachedFragment) {
          nonDelayFragment.executionCount = 0;
          hardware.fragmentCache.fragments.set(pc + 4, nonDelayFragment);
        }
        setPerformanceProfiling(profiled);
        c.run(4);
        setPerformanceProfiling(false);
        return captureExecutionSnapshot(emulator, { ramOffset: 0x3000, ramLength: 0x10 });
      };

      const directInterpreted = runDirectDelayEntry(false);
      const directCompiled = runDirectDelayEntry(true);
      expect(nonDelayFragment.executionCount).toBe(0);
      expect(directCompiled).toEqual(directInterpreted);
      expect(directCompiled.memory.slice(0, 8)).toEqual([0x11, 0x22, 0x33, 0x44, 0, 0, 0, 0]);
      expect(directCompiled.gpr[5]).toBe(0n);
      expect(directCompiled.gpr[6]).toBe(99n);

      // 2. Faulting delay-slot instruction at pc + 4 with F2 cached preserves Cause.BD and EPC = pc.
      const faultInterpreted = runDirectDelayEntry(false, 0x80003001);
      const faultCompiled = runDirectDelayEntry(true, 0x80003001);
      expect(nonDelayFragment.executionCount).toBe(0);
      expect(faultCompiled).toEqual(faultInterpreted);
      expect(faultCompiled.cause).toBe(0x80000014);
      expect(faultCompiled.epc).toBe(pc);

      // 3. Chained getNextFragment transition from a 1-op branch fragment F1 at pc into pc + 4 with delayPC !== null:
      resetExecutionState(c, words, { pc });
      c.setRegS32Extend(8, 1);
      c.setRegS32Extend(9, 1);
      const branchFragment = compileFragmentAt(c, pc, 1);
      expect(branchFragment.opsCompiled).toBe(1);

      const runChainedTransition = withCachedFragments => {
        resetExecutionState(c, words, { pc });
        c.setRegS32Extend(2, 0x11223344);
        c.setRegS32Extend(3, 0x55667788);
        c.setRegS32Extend(4, 0x80003000);
        c.setRegS32Extend(8, 1);
        c.setRegS32Extend(9, 1);
        // Keep RSP active so speedHack does not skip cycles.
        hardware.rsp.halted = false;
        if (withCachedFragments) {
          branchFragment.executionCount = 0;
          nonDelayFragment.executionCount = 0;
          hardware.fragmentCache.fragments.set(pc, branchFragment);
          hardware.fragmentCache.fragments.set(pc + 4, nonDelayFragment);
        }
        setPerformanceProfiling(profiled);
        c.run(4);
        setPerformanceProfiling(false);
        return captureExecutionSnapshot(emulator, { ramOffset: 0x3000, ramLength: 0x10 });
      };

      const chainedInterpreted = runChainedTransition(false);
      const chainedCompiled = runChainedTransition(true);
      expect(branchFragment.executionCount).toBe(2);
      expect(nonDelayFragment.executionCount).toBe(0);
      expect(chainedCompiled).toEqual(chainedInterpreted);
    });
  });
}
