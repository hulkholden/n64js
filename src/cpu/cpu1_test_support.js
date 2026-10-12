import { CPU1 } from './cpu1.js';

// Recover the MUL table through its guaranteed zero-operand fallback. Tests
// can then call the unchanged generic helper without duplicating its policy or
// adding a production switch just to disable the optimization.
const probe = new CPU1({});
let multiplyCases;
probe.f32BinaryOp = (d, s, t, cases) => { multiplyCases = cases; };
probe.MUL_S(0, 0, 0);

export function genericMultiply(d, s, t) {
  this.f32BinaryOp(d, s, t, multiplyCases);
}
