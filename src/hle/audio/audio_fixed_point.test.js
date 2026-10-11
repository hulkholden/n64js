import { describe, expect, test } from 'bun:test';
import {
  clamp16, clampShifted32To16, signed16, unsigned16, fixed16FromParts, fixed16ToInt,
  clampFixed16Hi, clampFixed16Lo, mulFixed16, mulFraction, mixSample, mulUnsignedFraction, clampFractionSum,
} from './audio_fixed_point.js';

describe('audio fixed-point arithmetic', () => {
  test('word conversions wrap while signed saturation clamps', () => {
    expect(signed16(0x8000)).toBe(-32768);
    expect(signed16(0xffff)).toBe(-1);
    expect(signed16(0x10000)).toBe(0);
    expect(unsigned16(-1)).toBe(0xffff);
    expect(unsigned16(0x10000)).toBe(0);
    expect(clamp16(0x8000)).toBe(32767);
    expect(clamp16(-0x8001)).toBe(-32768);
  });

  test('joining negative integer and unsigned fractional words preserves the fraction', () => {
    expect(fixed16FromParts(-2, 0x8000)).toBe(-98304); // -1.5
    expect(fixed16FromParts(-1, 0xffff)).toBe(-1);
    expect(fixed16FromParts(32767, 0xffff)).toBe(0x7fffffff);
    expect(fixed16FromParts(-32768, 0)).toBe(-0x80000000);
  });

  for (const shift of [11, 14]) {
    test(`signed 32-bit wrap precedes shift by ${shift} and saturation`, () => {
      const scale = 2 ** shift;
      expect(clampShifted32To16(scale - 1, shift)).toBe(0);
      expect(clampShifted32To16(-1, shift)).toBe(-1);
      expect(clampShifted32To16(-scale - 1, shift)).toBe(-2);
      expect(clampShifted32To16(32768 * scale, shift)).toBe(32767);
      expect(clampShifted32To16(-32769 * scale, shift)).toBe(-32768);
      expect(clampShifted32To16(0x80000000, shift)).toBe(-32768);
      expect(clampShifted32To16(-0x80000001, shift)).toBe(32767);
      expect(clampShifted32To16(0x100000000 + 7 * scale, shift)).toBe(7);
      expect(clampShifted32To16(-0x100000000 - 7 * scale - 1, shift)).toBe(-8);
    });
  }

  test('dropping fractional bits floors negatives and retains bits above bit 31', () => {
    expect(fixed16ToInt(-1)).toBe(-1);
    expect(fixed16ToInt(-65537)).toBe(-2);
    expect(fixed16ToInt(65535)).toBe(0);
    expect(fixed16ToInt(65536)).toBe(1);
    expect(fixed16ToInt(0x100000001)).toBe(65536);
    expect(fixed16ToInt(-0x100000001)).toBe(-65537);
  });

  test('high and low words saturate together at signed 16.16 boundaries', () => {
    for (const [value, hi, lo] of [
      [-0x100000001, -32768, 0],
      [-0x80000001, -32768, 0],
      [-0x80000000, -32768, 0],
      [-0x7fffffff, -32768, 1],
      [-1, -1, 0xffff],
      [0, 0, 0],
      [0x7ffffffe, 32767, 0xfffe],
      [0x7fffffff, 32767, 0xffff],
      [0x80000000, 32767, 0xffff],
      [0x100000001, 32767, 0xffff],
    ]) {
      expect(clampFixed16Hi(value)).toBe(hi);
      expect(clampFixed16Lo(value)).toBe(lo);
    }
  });

  test('split multiplication agrees with exact integer arithmetic before saturation', () => {
    // These include products whose low fractional bits are lost if the joined
    // 32-bit inputs are multiplied as Numbers, plus negative fractional values.
    const values = [-0x80000000n, -0x7fffffffn, -0x18000n, -1n, 0n, 0xffffn, 0x10000n, 0x7fffff01n, 0x7ffffeffn, 0x7fffffffn];
    for (const a of values) {
      for (const b of values) {
        const actual = mulFixed16(Number(a >> 16n), Number(a & 0xffffn), Number(b >> 16n), Number(b & 0xffffn));
        expect(actual).toBe(Number((a * b) >> 16n));
      }
    }
  });

  test('fractional multiplication rounds ties toward positive infinity and saturates unity', () => {
    expect(mulFraction(1, 16384)).toBe(1);
    expect(mulFraction(-1, 16384)).toBe(0);
    expect(mulFraction(-3, 16384)).toBe(-1);
    expect(mulFraction(-32768, -32768)).toBe(32767);
    expect(mulFraction(-32768, 32767)).toBe(-32767);
  });

  test('mixing keeps both products until the final rounding and saturation', () => {
    expect(mixSample(1, -1, 16384)).toBe(0);
    expect(mixSample(32767, 32767, -32768)).toBe(-1);
    expect(mixSample(-32768, -32768, -32768)).toBe(1);
    expect(mixSample(32767, 32767, 16384)).toBe(32767);
    expect(mixSample(-32768, -32768, 16384)).toBe(-32768);
    expect(mixSample(32767, 12345, 0)).toBe(32766);
    expect(mixSample(-32768, 12345, 0)).toBe(-32767);
  });
});


test('unsigned Q16 volumes floor negative products and Q15 sums round only once', () => {
  expect(mulUnsignedFraction(-1, 1)).toBe(-1);
  expect(mulUnsignedFraction(32767, 65535)).toBe(32766);
  expect(mulUnsignedFraction(-32768, 65535)).toBe(-32768);
  expect(clampFractionSum(16384)).toBe(1);
  expect(clampFractionSum(-16384)).toBe(0);
  expect(clampFractionSum(-16385)).toBe(-1);
  expect(clampFractionSum(0x7fffffff)).toBe(32767);
  expect(clampFractionSum(-0x80000000)).toBe(-32768);
});
