import { describe, expect, test } from 'bun:test';
import { CPU1 } from './cpu1.js';

function createFPU() {
  let faults = 0;
  const fpu = new CPU1({ cpu0: { raiseFPE() { faults++; } } });
  return { fpu, faults: () => faults };
}

describe('double classification from raw words', () => {
  test('preserves every exponent class, sign and mantissa word boundary', () => {
    const { fpu } = createFPU();
    const mantissas = [0n, 1n, 0x80000000n, 0x100000000n, 0x8000000000000n, 0xfffffffffffffn];
    for (const sign of [0n, 0x8000000000000000n]) {
      for (let exponent = 0; exponent < 2048; exponent++) {
        for (const mantissa of mantissas) {
          const bits = sign | BigInt(exponent) << 52n | mantissa;
          // Float classes: normal, +0, -0, +inf, -inf, qNaN, sNaN, denormal.
          const expected = exponent === 0 ? (mantissa ? 7 : sign ? 2 : 1) :
            exponent === 2047 ? (mantissa ? (mantissa & 0x8000000000000n ? 5 : 6) : sign ? 4 : 3) : 0;
          const index = exponent % 32;
          fpu.regU64[index] = bits;
          expect(fpu.loadF64Type(index)).toBe(expected);
          expect(fpu.regU64[index]).toBe(bits);
          fpu.tempU64[0] = bits;
          fpu.regU64[index] = 0x123456789abcdef0n;
          fpu.storeTemp64(index);
          expect(fpu.regU64[index]).toBe(bits);
        }
      }
    }
  });

  // Existing arithmetic results and status at 2e6f311, including preserved
  // destinations on traps. This optimization must not alter the FPU policy.
  const sentinel = 0x123456789abcdef0n;
  const cases = [
    ['ADD_D', 0x3ff0000000000000n, 0x4000000000000000n, 0, 0x4008000000000000n, 0, 0],
    ['ADD_D', 0x8000000000000000n, 0x8000000000000000n, 0, 0x8000000000000000n, 0, 0],
    ['MUL_D', 0x0010000000000000n, 0x3fe0000000000000n, 0, sentinel, 0x20000, 1],
    ['MUL_D', 0x0010000000000000n, 0x3fe0000000000000n, 0x1000000, 0n, 0x100300c, 0],
    ['MUL_D', 0x7fefffffffffffffn, 0x4000000000000000n, 0, 0x7ff0000000000000n, 0x5014, 0],
    ['DIV_D', 0x3ff0000000000000n, 0x8000000000000000n, 0, 0xfff0000000000000n, 0x8020, 0],
    ['DIV_D', 0x3ff0000000000000n, 0x8000000000000000n, 0x400, sentinel, 0x8400, 1],
    ['DIV_D', 0n, 0n, 0, 0x7ff7ffffffffffffn, 0x10040, 0],
    ['ADD_D', 0x7ff8000000000001n, 0x3ff0000000000000n, 0, 0x7ff7ffffffffffffn, 0x10040, 0],
    ['ADD_D', 0x7ff0000000000001n, 0x3ff0000000000000n, 0, sentinel, 0x20000, 1],
    ['ADD_D', 0x7ff0000000000000n, 0xfff0000000000000n, 0, 0x7ff7ffffffffffffn, 0x10040, 0],
    ['ADD_D', 0x3ff0000000000000n, 0x3ca0000000000000n, 0, 0x3ff0000000000000n, 0x1004, 0],
  ];
  for (const fullMode of [false, true]) {
    test(`preserves arithmetic bits, flags and traps (FR=${Number(fullMode)})`, () => {
      for (const [op, s, t, control, result, status, traps] of cases) {
        const { fpu, faults } = createFPU();
        fpu.fullMode = fullMode;
        // Odd source S selects its even neighbour in FR=0; T stays odd.
        fpu.regU64[fpu.fsRegIdx64(3)] = s;
        fpu.regU64[fpu.ftRegIdx64(5)] = t;
        fpu.regU64[fpu.fdRegIdx64(7)] = sentinel;
        fpu.control[31] = control;
        fpu[op](7, 3, 5);
        expect(fpu.regU64[fpu.fdRegIdx64(7)]).toBe(result);
        expect(fpu.control[31]).toBe(status);
        expect(faults()).toBe(traps);
      }
    });
  }

  test('classifies aliased operands before storing a result', () => {
    const { fpu } = createFPU();
    fpu.regF64[3] = 1;
    fpu.regU64[5] = 0x8000000000000000n;
    fpu.DIV_D(5, 3, 5);
    expect(fpu.regU64[5]).toBe(0xfff0000000000000n);
    fpu.regF64[3] = 4;
    fpu.SQRT_D(3, 3);
    expect(fpu.regF64[3]).toBe(2);
    fpu.CVT_S_D(3, 3);
    expect(fpu.regU64[3]).toBe(0x40000000n);
  });
});
