export function padString(v, len) {
  let t = v.toString();
  while (t.length < len) {
    t = '0' + t;
  }
  return t;
}

export function toHex(r, bits) {
  let unsigned;
  if (typeof (r) == 'bigint') {
    const mask = bits ? ((1n << BigInt(bits)) - 1n) : 0xffff_ffff_ffff_ffffn;
    unsigned = r & mask;
  } else {
    const mask = (bits && bits < 32) ? ((1 << bits) - 1) : 0xffff_ffff;
    unsigned = (Number(r) & mask) >>> 0;
  }

  let t = unsigned.toString(16);
  if (bits) {
    // 4 bits per hex char
    const len = bits >> 2;
    while (t.length < len) {
      t = '0' + t;
    }
  }
  return t;
}

export function toStringN(v, bits) { return '0x' + toHex(v, bits); }
export function toString8(v) { return '0x' + toHex(v, 8); }
export function toString16(v) { return '0x' + toHex(v, 16); }
export function toString32(v) { return '0x' + toHex(v, 32); }
export function toString64(v) { return '0x' + toHex(v, 64); }
