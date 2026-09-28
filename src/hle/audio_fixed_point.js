// Scalar arithmetic shared by the audio HLE. Keep wide accumulators as Numbers
// unless the RSP explicitly wraps them to 32 bits before shifting or saturation.
// Keep helper call chains shallow so hot loops can inline their arithmetic
// without allocating boxed Numbers for wide intermediate results.
// Private constants let V8 fold arithmetic even though their public aliases
// live in module export cells.
const FRACTION_SCALE = 0x10000;
const WORD_MASK = 0xffff;
export const FIXED16_ONE = FRACTION_SCALE;
export const UINT16_MAX = WORD_MASK;
const INT16_MIN = -0x8000;
const INT16_MAX = 0x7fff;
const INT32_MIN = -0x80000000;
const INT32_MAX = 0x7fffffff;
const ROUND_HALF = FRACTION_SCALE / 2;

export function signed16(value) {
  return (value << 16) >> 16;
}

export function unsigned16(value) {
  return value & WORD_MASK;
}

export function clamp16(value) {
  return Math.max(INT16_MIN, Math.min(INT16_MAX, value));
}

// POLEF/ADPCM wrap to signed 32 bits, drop fractional bits, then saturate to
// signed 16 bits. For shifts 0..31, >> also floors negative values correctly.
export function clampShifted32To16(value, shift) {
  return Math.max(INT16_MIN, Math.min(INT16_MAX, value >> shift));
}

// Join a signed integer word and an unsigned fractional word, without wrapping.
export function fixed16FromParts(hi, lo) {
  return hi * FRACTION_SCALE + lo;
}

// Drop 16 fractional bits, rounding negative values down as the RSP does.
export function fixed16ToInt(value) {
  return Math.floor(value / FRACTION_SCALE);
}

export function clampFixed16Hi(value) {
  return Math.max(INT16_MIN, Math.min(INT16_MAX, Math.floor(value / FRACTION_SCALE)));
}

// Low-word saturation uses the range of the entire signed 16.16 value.
// This differs from unsigned16(), which wraps even when the value overflows.
export function clampFixed16Lo(value) {
  return value > INT32_MAX ? WORD_MASK : value < INT32_MIN ? 0 : value & WORD_MASK;
}

// Multiply two signed 16.16 values supplied as signed high/unsigned low words.
// Preserve the envelope's low-product truncation and leave saturation to the
// caller. Multiplying joined 32-bit values would lose precision in a Number.
export function mulFixed16(aHi, aLo, bHi, bLo) {
  return Math.floor(aLo * bLo / FRACTION_SCALE) + aHi * bLo + aLo * bHi + aHi * bHi * FRACTION_SCALE;
}

// RSP VMULF: multiply signed Q15 fractions, round, then saturate the result.
export function mulFraction(a, b) {
  return clampFixed16Hi(a * b * 2 + ROUND_HALF);
}

// VMULF by 32767/32768 followed by VMACF. Retain both products in the
// accumulator: rounding or saturating the destination first changes the sum.
export function mixSample(destination, source, gain) {
  const accumulator = destination * INT16_MAX * 2 + ROUND_HALF + source * gain * 2;
  return clampFixed16Hi(accumulator);
}
