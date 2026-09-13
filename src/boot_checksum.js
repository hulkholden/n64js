// Reconstructed from the MIPS PIF ROM's checksum routine (ROM offsets
// 0x210..0x63f). Arithmetic is unsigned modulo 2^32, except the 64-bit product.
// The returned temporaries reproduce the register contents at the IPL3 entry.
const checksumMagic = 0x6c078965;

function rol32(word, shift) {
  return ((word << shift) | (word >>> (32 - shift))) >>> 0;
}

function ror32(word, shift) {
  return ((word >>> shift) | (word << (32 - shift))) >>> 0;
}

function multiply(x, y) {
  const product = BigInt(x >>> 0) * BigInt(y >>> 0);
  return { hi: Number(product >> 32n), lo: Number(product & 0xffff_ffffn) };
}

function foldProduct({ hi, lo }) {
  // The zero-difference fallback is the product's low word, not x.
  return ((hi - lo) >>> 0) || lo;
}

function mix(x, y, fallback) {
  return foldProduct(multiply(x, y || fallback));
}

// ipl3 is a big-endian MemoryRegion containing ROM bytes 0x40..0xfff.
// seed is the low byte of the PIF boot word, distinct from the seed in s6.
export function calculateIPL3BootState(ipl3, seed) {
  const first = ipl3.getU32(0);
  const state = new Uint32Array(16);
  state.fill(((Math.imul(checksumMagic, seed) + 1) >>> 0) ^ first);

  let previous = first;
  let t9 = 0;
  for (let i = 1; i <= 0x3f0; ++i) {
    const word = ipl3.getU32(4 * (i - 1));
    state[0] += mix(0x3ef - i, word, i);
    state[1] = mix(state[1], word, i);
    state[2] ^= word;
    state[3] += mix((word + 5) >>> 0, checksumMagic, i);
    state[9] = previous < word ? mix(state[9], word, i) : state[9] + word;

    const rightLow = ror32(word, previous & 31);
    const leftHigh = rol32(word, previous >>> 27);
    state[4] += rightLow;
    state[7] = mix(state[7], rol32(word, previous & 31), i);
    state[6] = word < state[6]
      ? ((state[6] + state[3]) >>> 0) ^ ((word + i) >>> 0)
      : state[6] ^ ((state[4] + word) >>> 0);
    state[5] += leftHigh;
    state[8] = mix(state[8], ror32(word, previous >>> 27), i);

    if (i === 0x3f0) {
      // The machine reads a lookahead word from IMEM, but exits before using it.
      // Preserve t9's last shift result for the later reduction's residual state.
      t9 = word >>> (previous >>> 27);
      break;
    }
    const next = ipl3.getU32(4 * i);
    state[15] = mix(mix(state[15], leftHigh, i), rol32(next, word >>> 27), i);
    state[14] = mix(mix(state[14], rightLow, i), ror32(next, word & 31), i);
    state[13] += ror32(word, word & 31) + ror32(next, next & 31);
    state[10] = mix((state[10] + word) >>> 0, next, i);
    state[11] = mix(state[11] ^ word, next, i);
    state[12] += state[8] ^ word;
    previous = word;
  }

  let q0 = state[0], q1 = state[0], q2 = state[0], q3 = state[0];
  let at = 0, t5 = 0, t8 = 0;
  for (let j = 0; j < 16; ++j) {
    const word = state[j];
    t5 = q0;
    q0 = (q0 + ror32(word, word & 31)) >>> 0;
    at = word < q0 ? 1 : 0;
    if (at) {
      q1 = (q1 + word) >>> 0;
      t9 = q1;
    } else {
      q1 = mix(q1, word, j);
    }
    t8 = word & 2;
    q2 = (t8 >>> 1) === (word & 1) ? (q2 + word) >>> 0 : mix(q2, word, j);
    if (word & 1) {
      q3 = (q3 ^ word) >>> 0;
      t5 = q3;
    } else {
      q3 = mix(q3, word, j);
    }
  }

  const product = multiply(q0, q1 || 16);
  const v0 = foldProduct(product);
  return {
    v0,
    a0: v0 & 0xffff,
    a1: (q3 ^ q2) >>> 0,
    at, t5, t8, t9,
    t4: q3,
    t6: q2,
    t7: product.lo,
    hi: product.hi,
    lo: product.lo,
  };
}
