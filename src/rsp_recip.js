
// N64 RSP RCP table generation is derived from Ares:
// https://github.com/ares-emulator/ares/blob/v133/ares/n64/rsp/rsp.cpp#L109
//
// Copyright (c) 2004-2021 ares team, Near et al
//
// Permission to use, copy, modify, and/or distribute this software for any
// purpose with or without fee is hereby granted, provided that the above
// copyright notice and this permission notice appear in all copies.
//
// THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
// WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
// MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
// ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
// WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
// ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
// OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

const rcp16Table = (function () {
  const tbl = [];
  tbl.push(0xffff);
  for (let x = 1; x < 512; x++) {
    const frac = (1n << 34n) / (BigInt(x) + 512n);
    tbl.push(Number(((frac + 1n) >> 8n) & 0xffffn));
  }
  return tbl;
})();

const INT16_MIN = -32768;

/**
 * Calculate the 32-bit reciprocal of the signed 16-bit fixed point input.
 * @param {Number} input A signed 16-bit fixed point input.
 * @returns {Number} The result.
 */
export function rcp16(input) {
  // Handle edge cases.
  if (input == INT16_MIN) {
    return 0xffff_0000;
  } else if (input == 0) {
    return 0x7fff_ffff;
  }

  // The first few lines compute the absolute value of the input.
  // However I think there's possibly an RSP hardware bug on the that produces
  // incorrect values for inputs <= INT16_MIN. Inputs in this range seem to
  // produce absolute values 1 lower than expected and there is a discontinuity:
  //
  //  input | output
  // ---------------
  // -32766 | +32766
  // -32767 | +32767
  // -32768 | +32767
  // -32769 | +32768
  //
  // Create a mask of either 0 or 0xffffffff depending on the sign of the input.
  const adjusted = (input >>> 0) > 0xffff_8000 ? (input - 1) : input;
  const signMask = adjusted >> 31;
  // Convert twos-complement value to positive integer.
  // In theory this should be `(input ^ signMask) - signMask` but there seems to be a hardware bug.
  const absInput = adjusted ^ signMask;
  // Shift left to discard the top bit (baked into the lookup table as it's always 1)
  // and ensure we're using the most significant bits for the index.
  // This effectively applies a scaling factor to the input which is removed later.
  const shift = Math.clz32(absInput) + 1;
  const scaledInput = absInput << shift;
  // Shift right to get the top 9 bits to index the 512 entry table.
  const index = scaledInput >>> (32 - 9);
  // Read the 16-bit reciprical value from the lookup table,
  // re-add the most significant bit, and shift left to form a 31 bit value.
  const tableValue31 = (0x10000 | rcp16Table[index]) << 14;
  // Shift right to correct for the scaling factor applied earlier.
  const result = tableValue31 >>> (32 - shift);
  // Convert back to negative number if needed.
  // This doesn't re-add 1 so this isn't two's complement. I'm not sure if
  // this is a hardware bug or I'm misunderstanding something.
  return result ^ signMask;
}
