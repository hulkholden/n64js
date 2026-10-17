import { expect, test } from 'bun:test';
import { fixed16FromFloat, fixed16ToFloat } from './fixed_point.js';

test('float conversion retains signed, unsigned and wide fixed-point values', () => {
  for (const [fixed, value] of [
    [0, 0],
    [-1, -1 / 65536],
    [-0x18000, -1.5],
    [0x7fffffff, 32768 - 1 / 65536],
    [-0x80000000, -32768],
    [0xffffffff, 65536 - 1 / 65536],
    [0x100008000, 65536.5],
    [-0x100004000, -65536.25],
  ]) {
    expect(fixed16ToFloat(fixed)).toBe(value);
    expect(fixed16FromFloat(value)).toBe(fixed);
  }
});

test('float encoding floors sub-LSB fractions toward negative infinity', () => {
  expect(fixed16FromFloat(0.75 / 65536)).toBe(0);
  expect(fixed16FromFloat(-0.25 / 65536)).toBe(-1);
  expect(fixed16FromFloat(-1 - 0.25 / 65536)).toBe(-65537);
});
