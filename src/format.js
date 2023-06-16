export function padString(v,len) {
  var t = v.toString();
  while (t.length < len) {
    t = '0' + t;
  }
  return t;
};

export function toHex(r, bits) {
  r = Number(r);
  if (r < 0) {
      r = 0xFFFFFFFF + r + 1;
  }

  var t = r.toString(16);

  if (bits) {
    var len = Math.floor(bits / 4); // 4 bits per hex char
    while (t.length < len) {
      t = '0' + t;
    }
  }

  return t;
};

export function toString8(v) {
  return '0x' + toHex((v&0xff)>>>0, 8);
};

export function toString16(v) {
  return '0x' + toHex((v&0xffff)>>>0, 16);
};

export function toString32(v) {
  return '0x' + toHex(v, 32);
};

export function toString64(hi, lo) {
  var t = toHex(lo, 32);
  var u = toHex(hi, 32);
  return '0x' + u + t;
};
