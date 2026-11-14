import { describe, expect, test } from 'bun:test';
import * as regs from './cpu0reg.js';
import * as decode from './decode.js';
import {
  DEFAULT_PC,
  captureExecutionSnapshot,
  compileFragmentAt,
  compileOp,
  compileOps,
  createOpRunner,
  createTestCPU,
  createTestEmulator,
  iop,
  jump,
  regimm,
  resetExecutionState,
  resetGPRsWithSentinel,
  special,
  warmFragmentLookup,
} from './test_helpers.js';

const pc = DEFAULT_PC;

const jumpLinkVariants = (callee) => [
  {
    name: 'JAL',
    word: jump(callee, decode.OP_JAL),
    linkReg: regs.RA,
    prepareTarget: () => {},
  },
  {
    name: 'JALR (rd !== rs)',
    word: special(decode.SPECIAL_JALR, 25, 0, 17),
    linkReg: 17,
    prepareTarget: c => c.setRegU64(25, 0xdeadbeef_00000000n | BigInt(callee >>> 0)),
  },
  {
    name: 'JALR (rd === rs)',
    word: special(decode.SPECIAL_JALR, 25, 0, 25),
    linkReg: 25,
    prepareTarget: c => c.setRegU64(25, 0xdeadbeef_00000000n | BigInt(callee >>> 0)),
  },
  {
    name: 'JALR (rd === 0)',
    word: special(decode.SPECIAL_JALR, 25, 0, 0),
    linkReg: 0,
    prepareTarget: c => c.setRegU64(25, 0xdeadbeef_00000000n | BigInt(callee >>> 0)),
  },
];

describe('JAL and JALR link address codegen', () => {
  test('retains constant link fast path when needsDelayCheck is false', () => {
    const callee = 0x80002000;
    const jalCode = compileOp(jump(callee, decode.OP_JAL), {
      pc,
      needsDelayCheck: false,
    }).bodyCode;
    expect(jalCode).toContain('c.gprS32[62] = 0x80001008;\n  c.gprS32[63] = -1;');
    expect(jalCode).not.toContain('c.nextPC');

    const kusegJalCode = compileOp(jump(0x00002000, decode.OP_JAL), {
      pc: 0x00000100,
      needsDelayCheck: false,
    }).bodyCode;
    expect(kusegJalCode).toContain('c.gprS32[62] = 0x00000108;\n  c.gprS32[63] = 0;');
    expect(kusegJalCode).not.toContain('c.nextPC');

    // Preceding trivial op clears needsDelayCheck; non-trivial LW delay slot prevents fusion.
    const seqCode = compileOps([
      0, // NOP
      special(decode.SPECIAL_JALR, 25, 0, 25),
      iop(decode.OP_LW, 4, 8, 0),
    ], { pc }).bodyCode;
    expect(seqCode).toContain('c.delayPC = c.getRegU32Lo(25);\n  c.gprS32[50] = 0x8000100c;\n  c.gprS32[51] = -1;');
    expect(seqCode).not.toContain('c.nextPC + 4');

    const zeroDestCode = compileOp(special(decode.SPECIAL_JALR, 25, 0, 0), {
      pc,
      needsDelayCheck: false,
    }).bodyCode;
    expect(zeroDestCode).not.toContain('c.gprS32[');
    expect(zeroDestCode).not.toContain('c.nextPC');
  });

  test('computes link dynamically from c.nextPC + 4 when needsDelayCheck is true', () => {
    const callee = 0x80002000;
    const jalCode = compileOp(jump(callee, decode.OP_JAL), {
      pc,
      postPC: 0x80001800,
      nextPC: 0x80001800,
      needsDelayCheck: true,
    }).bodyCode;
    expect(jalCode).not.toContain('0x80001804');
    expect(jalCode).toContain('c.nextPC + 4');

    const jalrAliasedCode = compileOp(special(decode.SPECIAL_JALR, 25, 0, 25), {
      pc,
      postPC: 0x80001800,
      nextPC: 0x80001800,
      needsDelayCheck: true,
    }).bodyCode;
    expect(jalrAliasedCode).not.toContain('0x80001804');
    const readRsPos = jalrAliasedCode.indexOf('c.delayPC = c.getRegU32Lo(25);');
    const writeRdPos = jalrAliasedCode.indexOf('c.gprS32[50] =');
    expect(readRsPos).toBeGreaterThan(-1);
    expect(writeRdPos).toBeGreaterThan(readRsPos);

    const jalrZeroCode = compileOp(special(decode.SPECIAL_JALR, 25, 0, 0), {
      pc,
      postPC: 0x80001800,
      nextPC: 0x80001800,
      needsDelayCheck: true,
    }).bodyCode;
    expect(jalrZeroCode).not.toContain('c.gprS32[');
  });
});

describe('single-op JAL and JALR with dynamic delayPC', () => {
  test('matches interpreter across null, KSEG0, KUSEG, and 32-bit sign/wrap boundaries', async () => {
    const cpu = await createTestCPU();
    const callee = 0x80003450;
    const variants = [
      ...jumpLinkVariants(callee),
      {
        name: 'JALR (rd === rs === 0)',
        word: special(decode.SPECIAL_JALR, 0, 0, 0),
        linkReg: 0,
        prepareTarget: () => {},
      },
    ];

    for (const trainedNextPC of [0x80001800, 0x00000200]) {
      for (const variant of variants) {
        const runInterp = createOpRunner(false, variant.word);
        const runCompiled = createOpRunner(true, variant.word, {
          pc,
          postPC: trainedNextPC,
          nextPC: trainedNextPC,
          needsDelayCheck: true,
        });

        for (const delayPC of [
          null,
          0x80001800,
          0x80002400,
          0x00000200,
          0x7ffffffc,
          0xfffffffc,
        ]) {
          const runOnce = (runner, isCompiled) => {
            resetGPRsWithSentinel(cpu);
            variant.prepareTarget(cpu);
            const nextPC = (delayPC ?? (pc + 4)) >>> 0;
            cpu.pc = pc;
            cpu.nextPC = nextPC;
            cpu.delayPC = delayPC;
            cpu.branchTarget = null;
            runner(cpu);
            return {
              gpr: [...cpu.gprU64],
              pc: (isCompiled ? cpu.pc : cpu.nextPC) >>> 0,
              target: (isCompiled ? cpu.delayPC : cpu.branchTarget) >>> 0,
            };
          };

          const expected = runOnce(runInterp, false);
          const actual = runOnce(runCompiled, true);
          expect(actual).toEqual(expected);
        }
      }
    }
  });
});

describe('delay-slot fragment entry beginning with JAL or JALR', () => {
  for (const variant of jumpLinkVariants(DEFAULT_PC + 0x40)) {
    test(`${variant.name}: trained with entryDelayPC !== null matches interpreter when re-entered with delayPC === null, matching delayPC, or different delayPC`, async () => {
      const emulator = await createTestEmulator();
      const { cpu0: cpu, hardware } = emulator;
      // Memory layout from DEFAULT_PC (0x80001000):
      //   0x80001000 (+0x00): JAL / JALR -> callee (0x80001040) [fragment entryPC!]
      //   0x80001004 (+0x04): OR t0, linkReg, r0  (delay slot when entered with delayPC === null; t0 += 1 in t1)
      //   0x80001008 (+0x08): ADDIU t2, t2, 99    (fallthrough if callee skipped - should not run)
      //   ...
      //   0x80001020 (+0x20): OR t0, linkReg, r0  (trainDelayPC X: runs as JAL/JALR's delay slot!)
      //   0x80001024 (+0x24): ADDIU t2, t2, 88    (should not run)
      //   ...
      //   0x80001030 (+0x30): OR t0, linkReg, r0  (otherDelayPC Y: runs as JAL/JALR's delay slot!)
      //   0x80001034 (+0x34): ADDIU t2, t2, 77    (should not run)
      //   ...
      //   0x80001040 (+0x40): ADDIU t1, t1, 5     (callee target!)
      //   0x80001044 (+0x44): NOP
      const trainDelayPC = pc + 0x20;
      const otherDelayPC = pc + 0x30;
      const kusegDelayPC = 0x00000100;
      const observeReg = variant.linkReg === 0 ? 0 : variant.linkReg;
      const observeLinkInT0 = special(decode.SPECIAL_OR, observeReg, 0, 8);

      const words = new Array(24).fill(0);
      words[0x00 >> 2] = variant.word;
      words[0x04 >> 2] = observeLinkInT0;
      words[0x08 >> 2] = iop(decode.OP_ADDIU, 10, 10, 99);
      words[0x20 >> 2] = observeLinkInT0;
      words[0x24 >> 2] = iop(decode.OP_ADDIU, 10, 10, 88);
      words[0x30 >> 2] = observeLinkInT0;
      words[0x34 >> 2] = iop(decode.OP_ADDIU, 10, 10, 77);
      words[0x40 >> 2] = iop(decode.OP_ADDIU, 9, 9, 5);

      const setupState = (entryDelayPC) => {
        resetExecutionState(cpu, words, { pc });
        // Map virtual page 0 to physical 0x2000 so kusegDelayPC (0x100) is executable too.
        cpu.tlbEntries[0].update(0, 0, 0n, (2 << 6) | 7, 1);
        hardware.ram.set32(0x2100, observeLinkInT0);
        hardware.ram.set32(0x2104, iop(decode.OP_ADDIU, 10, 10, 66));
        resetGPRsWithSentinel(cpu);
        cpu.setRegS32Extend(8, 0);
        cpu.setRegS32Extend(9, 0);
        cpu.setRegS32Extend(10, 0);
        variant.prepareTarget(cpu);
        cpu.pc = pc;
        cpu.delayPC = entryDelayPC;
      };

      // Train the fragment at `pc` while in a branch delay slot (`delayPC = trainDelayPC`).
      setupState(trainDelayPC);
      warmFragmentLookup(hardware, pc);
      cpu.run(3);
      const fragment = hardware.fragmentCache.fragments.get(pc);
      expect(fragment?.func).toBeFunction();
      expect(fragment.entryDelayPC).toBe(trainDelayPC);

      for (const runtimeDelayPC of [trainDelayPC, null, otherDelayPC, kusegDelayPC]) {
        hardware.fragmentCache.reset();
        setupState(runtimeDelayPC);
        cpu.run(3);
        const interpreted = captureExecutionSnapshot(emulator);

        setupState(runtimeDelayPC);
        fragment.executionCount = 0;
        hardware.fragmentCache.fragments.set(pc, fragment);
        cpu.run(3);
        expect(fragment.executionCount).toBe(1);
        const compiled = captureExecutionSnapshot(emulator);

        expect(compiled).toEqual(interpreted);

        const expectedNextPC = runtimeDelayPC ?? (pc + 4);
        const expectedLink = BigInt.asUintN(64, BigInt((expectedNextPC + 4) | 0));
        if (variant.linkReg === 0) {
          expect(compiled.gpr[0]).toBe(0n);
          expect(compiled.gpr[8]).toBe(0n);
        } else {
          expect(compiled.gpr[variant.linkReg]).toBe(expectedLink);
          expect(compiled.gpr[8]).toBe(expectedLink);
        }
        expect(compiled.gpr[9]).toBe(5n);
        expect(compiled.gpr[10]).toBe(0n);
      }
    });
  }
});

describe('JAL and JALR in the delay slot of conditional branches', () => {
  const branchKinds = [
    {
      name: 'BNE',
      makeWord: off => iop(decode.OP_BNE, 4, 0, off),
      setCond: (c, taken) => c.setRegS32Extend(4, taken ? 1 : 0),
    },
    {
      name: 'BLTZ',
      makeWord: off => regimm(decode.REGIMM_BLTZ, 4, off),
      setCond: (c, taken) => c.setRegS32Extend(4, taken ? -1 : 0),
    },
  ];

  for (const branchKind of branchKinds) {
    for (const variant of jumpLinkVariants(DEFAULT_PC + 0x40)) {
      for (const trainTaken of [true, false]) {
        test(`${branchKind.name} + ${variant.name} trained=${trainTaken ? 'taken' : 'untaken'} matches interpreter for both runtime outcomes`, async () => {
          const emulator = await createTestEmulator();
          const { cpu0: cpu, hardware } = emulator;
          // Layout from DEFAULT_PC (0x80001000):
          //   0x80001000 (+0x00): BNE / BLTZ -> branchTarget (0x80001020)
          //   0x80001004 (+0x04): JAL / JALR -> callee (0x80001040) [in conditional branch delay slot!]
          //   0x80001008 (+0x08): OR t0, linkReg, r0  (runs as JAL/JALR delay slot when branch UNTAKEN!)
          //   0x8000100c (+0x0c): ADDIU t2, t2, 99    (skipped because JAL/JALR jumps to callee)
          //   ...
          //   0x80001020 (+0x20): OR t0, linkReg, r0  (branchTarget: runs as JAL/JALR delay slot when branch TAKEN!)
          //   0x80001024 (+0x24): ADDIU t2, t2, 88    (skipped because JAL/JALR jumps to callee)
          //   ...
          //   0x80001040 (+0x40): ADDIU t1, t1, 7     (callee target!)
          const branchTarget = pc + 0x20;
          const off = (branchTarget - (pc + 4)) >> 2;
          const observeReg = variant.linkReg === 0 ? 0 : variant.linkReg;
          const observeLinkInT0 = special(decode.SPECIAL_OR, observeReg, 0, 8);

          const words = new Array(24).fill(0);
          words[0x00 >> 2] = branchKind.makeWord(off);
          words[0x04 >> 2] = variant.word;
          words[0x08 >> 2] = observeLinkInT0;
          words[0x0c >> 2] = iop(decode.OP_ADDIU, 10, 10, 99);
          words[0x20 >> 2] = observeLinkInT0;
          words[0x24 >> 2] = iop(decode.OP_ADDIU, 10, 10, 88);
          words[0x40 >> 2] = iop(decode.OP_ADDIU, 9, 9, 7);

          const setupState = (taken) => {
            resetExecutionState(cpu, words, { pc });
            resetGPRsWithSentinel(cpu);
            cpu.setRegS32Extend(8, 0);
            cpu.setRegS32Extend(9, 0);
            cpu.setRegS32Extend(10, 0);
            branchKind.setCond(cpu, taken);
            variant.prepareTarget(cpu);
          };

          setupState(trainTaken);
          const fragment = compileFragmentAt(cpu, pc, 4);

          for (const runtimeTaken of [true, false]) {
            hardware.fragmentCache.reset();
            setupState(runtimeTaken);
            cpu.run(4);
            const interpreted = captureExecutionSnapshot(emulator);

            setupState(runtimeTaken);
            fragment.executionCount = 0;
            hardware.fragmentCache.fragments.set(pc, fragment);
            cpu.run(4);
            expect(fragment.executionCount).toBe(1);
            const compiled = captureExecutionSnapshot(emulator);

            expect(compiled).toEqual(interpreted);

            const expectedDelaySlotPC = runtimeTaken ? branchTarget : (pc + 8);
            const expectedLink = BigInt.asUintN(64, BigInt((expectedDelaySlotPC + 4) | 0));
            if (variant.linkReg === 0) {
              expect(compiled.gpr[0]).toBe(0n);
              expect(compiled.gpr[8]).toBe(0n);
            } else {
              expect(compiled.gpr[variant.linkReg]).toBe(expectedLink);
              expect(compiled.gpr[8]).toBe(expectedLink);
            }
            expect(compiled.gpr[9]).toBe(7n);
            expect(compiled.gpr[10]).toBe(0n);
          }
        });
      }
    }
  }
});
