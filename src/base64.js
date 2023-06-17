const lookup = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";

// TODO: use btoa()/atob() to simplify.

export function encodeArray(arr) {
  var t = '';
  for (let i = 0; i < arr.length; i += 3) {
    var c0 = arr[i + 0];
    var c1 = arr[i + 1];
    var c2 = arr[i + 2];

    // aaaaaabb bbbbcccc ccdddddd
    var a = c0 >>> 2;
    var b = ((c0 & 3) << 4) | (c1 >>> 4);
    var c = ((c1 & 15) << 2) | (c2 >>> 6);
    var d = c2 & 63;

    if (i + 1 >= arr.length) {
      c = 64;
    }
    if (i + 2 >= arr.length) {
      d = 64;
    }

    t += lookup.charAt(a) + lookup.charAt(b) + lookup.charAt(c) + lookup.charAt(d);
  }
  return t;
}

export function decodeArray(str, arr) {
  var outi = 0;

  for (let i = 0; i < str.length; i += 4) {
    var a = lookup.indexOf(str.charAt(i + 0));
    var b = lookup.indexOf(str.charAt(i + 1));
    var c = lookup.indexOf(str.charAt(i + 2));
    var d = lookup.indexOf(str.charAt(i + 3));

    var c0 = (a << 2) | (b >>> 4);
    var c1 = ((b & 15) << 4) | (c >>> 2);
    var c2 = ((c & 3) << 6) | d;

    arr[outi++] = c0;
    if (c !== 64) {
      arr[outi++] = c1;
    }
    if (d !== 64) {
      arr[outi++] = c2;
    }
  }
}
