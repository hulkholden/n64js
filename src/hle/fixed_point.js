// Conversions for values with 16 fractional bits. Keep wide intermediates as
// Numbers; callers apply signed/unsigned wrapping or saturation where needed.
// Encoding and integer conversion round toward negative infinity.
const FRACTION_SCALE = 0x10000;

export function fixed16FromFloat(value) {
  return Math.floor(value * FRACTION_SCALE);
}

export function fixed16ToFloat(value) {
  return value / FRACTION_SCALE;
}

// Drop fractional bits, rounding negative values down as the RSP does.
export function fixed16ToInt(value) {
  return Math.floor(value / FRACTION_SCALE);
}
