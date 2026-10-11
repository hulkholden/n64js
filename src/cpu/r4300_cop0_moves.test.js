import { describe, expect, spyOn, test } from 'bun:test';
import { createHeadlessEmulator } from '../headless/headless_env.js';
import * as regs from './cpu0reg.js';
import { Fragment } from './fragments.js';
import { FragmentContext, generateCodeForOp } from './recompiler.js';

const pc = 0x80001000;
const invalidRegisters = [7, 21, 22, 23, 24, 25, 31];
const values = [
  0n, 1n, 0xffffffffffffffffn, 0x7fffffffn, 0x80000000n,
  0xffffffffn, 0x100000000n, 0xffffffff00000000n,
  0x7fffffffffffffffn, 0x8000000000000000n,
  0x0123456789abcdefn, 0xfedcba9876543210n,
];
for (let bit = 0n; bit < 32n; bit++) {
  values.push(0x1234567800000000n | (1n << bit), BigInt.asUintN(64, ~(1n << bit)));
}

async function createCPU() {
  const { cpu0 } = await createHeadlessEmulator({
    romBuffer: new ArrayBuffer(0x1000),
    rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' },
  });
  n64js.getSyncFlow = () => null;
  cpu0.setRandomSource(() => 0.5);
  return cpu0;
}

function instruction(compiled, transfer, rt, fs) {
  const word = 0x40000000 | (transfer << 21) | (rt << 16) | (fs << 11);
  let run;
  if (compiled) {
    const fragment = new Fragment(pc);
    fragment.opsCompiled = 1;
    const ctx = new FragmentContext();
    ctx.set(fragment, pc, word, pc + 4, pc + 4);
    generateCodeForOp(ctx);
    run = new Function('c', fragment.bodyCode);
  } else {
    run = () => n64js.executeOp(word);
  }
  return cpu => {
    cpu.pc = pc;
    cpu.delayPC = null;
    cpu.nextPC = pc + 4;
    cpu.fragmentCycles = 0;
    run(cpu);
  };
}

function prepare(cpu) {
  cpu.gprU64.fill(0x13579bdf2468ace0n);
  cpu.gprU64[0] = 0n;
  cpu.controlRegU64.fill(0xabcdef0198765432n);
  cpu.setControlU64(regs.controlStatus, 0x1234567820008001n);
  cpu.setControlU64(regs.controlCause, 0x8000n);
  cpu.setControlU64(regs.controlWired, 5n);
  cpu.setControlU64(regs.controlCompare, 0xabcdef0100000003n);
  cpu.controlCountValue = 0x1fffffffb;
  cpu.lastControlRegWrite = 0xfedcba9876543210n;
  cpu.stuffToDo = 0;
  cpu.cop1ControlChanged();
  cpu.eventQueue.reset();
  cpu.addCompareEvent(100);
  cpu.addEvent('Unrelated', 27, () => {});
}

function snapshot(cpu) {
  return {
    gpr: [...cpu.gprU64], control: [...cpu.controlRegU64],
    lastWrite: BigInt(cpu.lastControlRegWrite), count: cpu.controlCountValue,
    compareCycles: cpu.getCyclesUntilEvent('Compare'),
    otherCycles: cpu.getCyclesUntilEvent('Unrelated'),
    stuffToDo: cpu.stuffToDo, fullMode: cpu.hardware.cpu1._fullMode,
  };
}

for (const compiled of [false, true]) {
  describe(`${compiled ? 'compiled' : 'interpreted'} COP0 moves`, () => {
    test('MTC0 matches full-width masks, sign extension and side effects for every control register', async () => {
      const cpu = await createCPU();
      // Cause and Watch writes log diagnostics in the existing full-width path.
      const log = spyOn(console, 'log').mockImplementation(() => {});
      try {
        for (let fs = 0; fs < 32; fs++) {
          for (const rt of [0, 1, 31]) {
            const run = instruction(compiled, 4, rt, fs);
            for (const value of values) {
              prepare(cpu);
              cpu.setRegU64(rt, value);
              cpu.moveToControl(fs, BigInt.asIntN(32, cpu.getRegU64(rt)));
              const expected = snapshot(cpu);
              prepare(cpu);
              cpu.setRegU64(rt, value);
              run(cpu);
              expect(snapshot(cpu)).toEqual(expected);
            }
          }
        }
      } finally {
        log.mockRestore();
      }
    });

    test('MFC0 sign-extends low words for every control register and discards writes to r0', async () => {
      const cpu = await createCPU();
      for (let fs = 0; fs < 32; fs++) {
        for (const rt of [0, 1, 31]) {
          const run = instruction(compiled, 0, rt, fs);
          for (const value of values) {
            prepare(cpu);
            cpu.setControlU64(fs, value);
            // Keep MI and Cause consistent, while testing all other Cause bits.
            cpu.clearControlBits32(regs.controlCause, 0x400);
            cpu.lastControlRegWrite = value;
            const expected = snapshot(cpu);
            if (rt !== 0) {
              expected.gpr[rt] = BigInt.asUintN(64, BigInt.asIntN(32, cpu.moveFromControl(fs)));
            }
            run(cpu);
            expect(snapshot(cpu)).toEqual(expected);
          }
        }
      }
    });

    test('invalid-register reads retain unmasked writes across MTC0 and DMTC0', async () => {
      const cpu = await createCPU();
      const writes = [
        [4, regs.controlStatus, 1, 0x1234567880080000n],
        [5, regs.controlStatus, 1, 0xfedcba9880000001n],
        [4, regs.controlCompare, 1, 0x1234567880000000n],
        [4, regs.controlEPC, 1, 0x12345678ffffffffn],
        [5, regs.controlEPC, 1, 0xfedcba9876543210n],
        [4, regs.controlPRId, 1, 0x12345678abcdef01n],
        [4, regs.controlInvalid7, 1, 0x1234567887654321n],
        [4, regs.controlCount, 0, 0xffffffffffffffffn],
      ];
      prepare(cpu);
      for (const [transfer, fs, rt, value] of writes) {
        cpu.setRegU64(rt, value);
        const expected = rt === 0 ? 0n : transfer === 4 ? BigInt.asIntN(32, value) : value;
        instruction(compiled, transfer, rt, fs)(cpu);
        for (const invalid of invalidRegisters) {
          instruction(compiled, 0, 2, invalid)(cpu);
          instruction(compiled, 1, 3, invalid)(cpu);
          expect(cpu.getRegS64(2)).toBe(BigInt.asIntN(32, expected));
          expect(cpu.getRegU64(3)).toBe(BigInt.asUintN(64, expected));
        }
      }
    });

    test('Status writes clear the high word and bit 19 for both transfer widths', async () => {
      const cpu = await createCPU();
      for (const transfer of [4, 5]) {
        for (const value of values) {
          prepare(cpu);
          cpu.setRegU64(4, value);
          instruction(compiled, transfer, 4, regs.controlStatus)(cpu);
          expect(cpu.getControlU64(regs.controlStatus)).toBe(value & 0xfff7ffffn);
        }
      }
    });

    test('Count reads preserve half ticks, signed results and 32-bit wrapping', async () => {
      const cpu = await createCPU();
      const read = instruction(compiled, 0, 2, regs.controlCount);
      for (const cycles of [0, 1, 2, 3, 0xfffffffe, 0xffffffff, 0x100000000, 0x1fffffffe, 0x1ffffffff, 0x200000000, 0x200000001, 0x200000002]) {
        cpu.controlCountValue = cycles;
        read(cpu);
        expect(cpu.getRegS64(2)).toBe(BigInt.asIntN(32, BigInt(cycles) >> 1n));
        expect(cpu.controlCountValue).toBe(cycles);
      }
    });

    test('Random reads to r0 still consume one sample, and Cause reads still check consistency', async () => {
      const cpu = await createCPU();
      prepare(cpu);
      let samples = 0;
      cpu.setRandomSource(() => { samples++; return 0.5; });
      instruction(compiled, 0, 0, regs.controlRand)(cpu);
      expect(samples).toBe(1);
      expect(cpu.getRegU64(0)).toBe(0n);
      cpu.setControlBits32(regs.controlCause, 0x400);
      expect(() => instruction(compiled, 0, 0, regs.controlCause)(cpu)).toThrow();
    });
  });
}
