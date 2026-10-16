import { describe, expect, test } from 'bun:test';
import { CPU1 } from './cpu1.js';
import { genericMultiply } from './cpu1_test_support.js';
import { cartesianPairs } from './test_helpers.js';

function createFPU(generic = false) {
  const state = { traps: 0 };
  state.fpu = new CPU1({ cpu0: { raiseFPE() { state.traps++; } } });
  if (generic) {
    state.fpu.MUL_S = genericMultiply;
  }
  return state;
}

// Both signs of all classes, normal/subnormal boundaries and rounding ties.
const edges = [0, 1, 0x003fffff, 0x007fffff, 0x00800000, 0x00800001,
  0x3effffff, 0x3f000000, 0x3f000001, 0x3f7fffff, 0x3f800000, 0x3f800001,
  0x3fc00000, 0x3fffffff, 0x40000000, 0x4b000001, 0x7f000000, 0x7f7fffff,
  0x7f800000, 0x7f800001, 0x7fbfffff, 0x7fc00000, 0x7fffffff]
  .flatMap(bits => [bits, (bits | 0x80000000) >>> 0]);
const pairs = cartesianPairs(edges);
let seed = 0x12345678;
const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
for (let i = 0; i < 4096; i++) {
  pairs.push([random(), random()]);
}

function compare(fast, slow, s, t, control, d, fs, ft) {
  for (const state of [fast, slow]) {
    const fpu = state.fpu;
    // Sentinels include upper halves, adjacent words and unrelated registers.
    fpu.regU32.fill(0xdeadbeef);
    fpu.regU32[fpu.fsRegIdx32(fs)] = s;
    fpu.regU32[fpu.ftRegIdx32(ft)] = t;
    fpu.control[31] = control;
    state.traps = 0;
    fpu.MUL_S(d, fs, ft);
  }
  const mismatch = fast.traps !== slow.traps || fast.fpu.control[31] !== slow.fpu.control[31] ||
    fast.fpu.regU32.some((bits, i) => bits !== slow.fpu.regU32[i]);
  if (mismatch) {
    throw new Error(`MUL.S mismatch: ${JSON.stringify({ s, t, control, d, fs, ft, fullMode: fast.fpu.fullMode })}`);
  }
}

describe('normal single multiply versus generic arithmetic', () => {
  for (const fullMode of [false, true]) {
    test(`all classes and generated raw operands, rounding/FS modes and aliases, FR=${Number(fullMode)}`, () => {
      const fast = createFPU();
      const slow = createFPU(true);
      fast.fpu.fullMode = slow.fpu.fullMode = fullMode;
      for (const [d, s, t] of [[7, 3, 5], [3, 3, 5], [5, 3, 5], [2, 3, 5], [7, 3, 3], [3, 3, 3]]) {
        for (let rm = 0; rm < 4; rm++) {
          for (const fs of [0, 0x01000000]) {
            for (let i = 0; i < pairs.length; i++) {
              // Cycle through every combination of the five exception enables;
              // preserve pre-existing sticky/condition bits, replace old causes.
              const control = 0x0083f07c | fs | rm | ((i & 31) << 7);
              compare(fast, slow, ...pairs[i], control, d, s, t);
            }
          }
        }
      }
    });

    test(`boundary pairs with every exception-enable combination, FR=${Number(fullMode)}`, () => {
      const fast = createFPU();
      const slow = createFPU(true);
      fast.fpu.fullMode = slow.fpu.fullMode = fullMode;
      for (let enables = 0; enables < 32; enables++) {
        for (let rm = 0; rm < 4; rm++) {
          for (const fs of [0, 0x01000000]) {
            for (const [s, t] of pairs.slice(0, edges.length ** 2)) {
              compare(fast, slow, s, t, 0x0083f020 | fs | rm | (enables << 7), 5, 3, 5);
            }
          }
        }
      }
    });
  }

  test('normal exact/inexact results update cause and sticky bits and preserve fd on an enabled trap', () => {
    const { fpu } = createFPU();
    fpu.regU32[6] = 0x3f800001;
    fpu.regU32[10] = 0x3f800001;
    fpu.control[31] = 0x0083f020;
    fpu.MUL_S(5, 3, 5);
    expect(fpu.regU64[5]).toBe(0x3f800002n);
    expect(fpu.control[31]).toBe(0x00801024);

    const trapped = createFPU();
    trapped.fpu.regU64[3] = 0x123456783f800001n;
    trapped.fpu.regU64[5] = 0x9abcdef03f800001n;
    trapped.fpu.control[31] = 0x0083f0a0;
    trapped.fpu.MUL_S(5, 3, 5);
    expect(trapped.fpu.regU64[5]).toBe(0x9abcdef03f800001n);
    expect(trapped.fpu.control[31]).toBe(0x008010a0);
    expect(trapped.traps).toBe(1);

    trapped.fpu.regF32[6] = 2;
    trapped.fpu.regF32[10] = 3;
    trapped.fpu.MUL_S(5, 3, 5);
    expect(trapped.fpu.regU64[5]).toBe(0x40c00000n);
    expect(trapped.fpu.control[31]).toBe(0x008000a0);
    expect(trapped.traps).toBe(1);
  });

  test('fallbacks apply status once and preserve destinations on underflow/overflow/NaN traps', () => {
    for (const [s, t, control, expected, status, traps] of [
      [0x80000000, 0x40000000, 0, 0x80000000n, 0, 0],
      [0x00800000, 0x3f000000, 0, 0x123456789abcdef0n, 0x20000, 1],
      [0x00800000, 0x3f000000, 0x1000000, 0n, 0x100300c, 0],
      [0x7f7fffff, 0x40000000, 0x200, 0x123456789abcdef0n, 0x5200, 1],
      [0x7fc00001, 0x40000000, 0x800, 0x123456789abcdef0n, 0x10800, 1],
      [0x7f800001, 0x40000000, 0, 0x123456789abcdef0n, 0x20000, 1],
    ]) {
      const state = createFPU();
      const fpu = state.fpu;
      fpu.regU32[6] = s;
      fpu.regU32[10] = t;
      fpu.regU64[7] = 0x123456789abcdef0n;
      fpu.control[31] = control;
      let clears = 0;
      const clear = fpu.clearCause;
      fpu.clearCause = function () { clears++; clear.call(this); };
      fpu.MUL_S(7, 3, 5);
      expect(fpu.regU64[7]).toBe(expected);
      expect(fpu.control[31]).toBe(status);
      expect(state.traps).toBe(traps);
      expect(clears).toBe(1);
    }
  });

  test('multiply and subtract keep separate rounding when their results cancel', () => {
    for (const fullMode of [false, true]) {
      const { fpu } = createFPU();
      fpu.fullMode = fullMode;
      fpu.regU32[fpu.fsRegIdx32(2)] = 0x3f800001; // 1 + 2^-23.
      fpu.regU32[fpu.ftRegIdx32(4)] = 0x3f7ffffe; // 1 - 2^-23.
      fpu.regU32[fpu.ftRegIdx32(6)] = 0x3f800000; // 1.
      fpu.MUL_S(2, 2, 4);
      expect(fpu.regU64[2]).toBe(0x3f800000n);
      expect(fpu.control[31]).toBe(0x1004);
      fpu.SUB_S(2, 2, 6);
      expect(fpu.regU64[2]).toBe(0n); // A fused operation would give -2^-46.
      expect(fpu.control[31]).toBe(4); // Cause cleared; inexact stays sticky.
    }
  });
});
