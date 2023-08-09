
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

export function rcp16(input) {
  // Handle edge cases.
  if (input == -32768) {
    return 0xffff_0000;
  } else if (input == 0) {
    return 0x7fff_ffff;
  }

  const signBits = input >> 31;
  const absInput = (input ^ signBits) - signBits;
  const shift = Math.clz32(absInput) + 1;
  const index = ((absInput << shift)) >>> 23;     // Extract most significant bits (less top bit).
  const result = ((0x10000 | rcp16Table[index]) << 14) >>> (32 - shift);
  return result ^ signBits;
}
