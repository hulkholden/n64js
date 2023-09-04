export function padString(v, len) {
  var t = v.toString();
  while (t.length < len) {
    t = '0' + t;
  }
  return t;
};

export function toHex(r, bits) {
  let unsigned;
  if (typeof (r) == 'bigint') {
    unsigned = (r & 0xffff_ffff_ffff_ffffn);
  } else {
    unsigned = Number(r) >>> 0;
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
};

export function toStringN(v, bits) {
  return '0x' + toHex(v, bits);
}

export function toString8(v) {
  return '0x' + toHex((v & 0xff) >>> 0, 8);
};

export function toString16(v) {
  return '0x' + toHex((v & 0xffff) >>> 0, 16);
};

export function toString32(v) {
  return '0x' + toHex(v, 32);
};

export function toString64(hi, lo) {
  var t = toHex(lo, 32);
  var u = toHex(hi, 32);
  return '0x' + u + t;
};

export function toString64_bigint(v) {
  return '0x' + toHex(v, 64);
};
