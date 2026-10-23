import { CPU1 } from './cpu1.js';

// Recover the multiply-op table through MUL_S's zero-operand fallback. Tests
// can then call the unchanged generic helper without duplicating its policy or
// adding a production switch just to disable the optimization.
const probe = new CPU1({});
let multiplyCases;
probe.f32BinaryOp = (d, s, t, cases) => { multiplyCases = cases; };
probe.MUL_S(0, 0, 0);

export function genericMultiply(d, s, t) {
  this.f32BinaryOp(d, s, t, multiplyCases);
}

export function genericCompareSingle(op, s, t) {
  const classify = (bits) => {
    const exponent = bits & 0x7f80_0000;
    const mantissa = bits & 0x007f_ffff;
    if (exponent === 0x7f80_0000 && mantissa !== 0) {
      return (bits & (1 << 22)) ? 5 /* floatTypeQNaN */ : 6 /* floatTypeSNaN */;
    }
    return 0;
  };
  const fsType = classify(this.loadU32(this.fsRegIdx32(s)));
  const ftType = classify(this.loadU32(this.ftRegIdx32(t)));

  let c = false;
  if (fsType >= 5 || ftType >= 5) {
    if ((op & 0x8) || fsType === 5 || ftType === 5) {
      if (this.raiseException(0x10 /* exceptionInvalidBit */)) {
        return;
      }
    }
    if (op & 0x1) {
      c = true;
    }
  } else {
    const fs = this.loadF32(this.fsRegIdx32(s));
    const ft = this.loadF32(this.ftRegIdx32(t));
    if (op & 0x4) {
      c |= fs < ft;
    }
    if (op & 0x2) {
      c |= fs == ft;
    }
  }
  this.setCondition(c);
}
