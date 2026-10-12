/* global window */
// Diagnostic only: install in a separate run, never in the timing pairs.
export function installDiagnostics() {
  const fpu = window.n64js.hardware().cpu1;
  const scratch = new Float32Array(1);
  const bits = new Uint32Array(scratch.buffer);
  const classify = value => {
    const exponent = value & 0x7f800000;
    const mantissa = value & 0x007fffff;
    if (exponent === 0) {
      return mantissa ? 'subnormal' : value >>> 31 ? '-zero' : '+zero';
    }
    if (exponent === 0x7f800000) {
      return mantissa ? (mantissa & 0x00400000 ? 'qnan' : 'snan') : value >>> 31 ? '-inf' : '+inf';
    }
    return 'normal';
  };
  // Count fallback calls, keeping the production code free of instrumentation.
  const binaryOp = fpu.f32BinaryOp;
  let genericCalls = 0;
  fpu.f32BinaryOp = function (d, s, t, cases) {
    genericCalls++;
    return binaryOp.call(this, d, s, t, cases);
  };
  const windows = {};
  let active = null;
  let seed = 0x341;
  window.fpuDiagnostic = {
    windows,
    begin(name) { active = windows[name] = {}; },
    end() { active = null; },
  };
  for (const name of ['ADD_S', 'SUB_S', 'MUL_S', 'DIV_S']) {
    const original = fpu[name];
    fpu[name] = function (d, s, t) {
      if (active) {
        const row = active[name] ??= { calls: 0, classes: {}, rounding: [0, 0, 0, 0], enables: {}, normalResult: 0, samples: [] };
        const si = this.fsRegIdx32(s);
        const ti = this.ftRegIdx32(t);
        const sb = this.loadU32(si);
        const tb = this.loadU32(ti);
        const sc = classify(sb);
        const tc = classify(tb);
        const key = `${sc}/${tc}`;
        row.calls++;
        row.classes[key] = (row.classes[key] ?? 0) + 1;
        row.rounding[this.control[31] & 3]++;
        const enables = this.control[31] & 0xf80;
        row.enables[enables] = (row.enables[enables] ?? 0) + 1;
        if (sc === 'normal' && tc === 'normal') {
          const sv = this.loadF32(si);
          const tv = this.loadF32(ti);
          scratch[0] = name === 'ADD_S' ? sv + tv : name === 'SUB_S' ? sv - tv : name === 'MUL_S' ? sv * tv : sv / tv;
          if (classify(bits[0]) === 'normal') {
            row.normalResult++;
          }
        }
        // Deterministic reservoir, retaining raw operands/FCSR for replay.
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const index = row.calls <= 4096 ? row.calls - 1 : Math.floor(seed / 4294967296 * row.calls);
        if (index < 4096) {
          row.samples[index] = [sb, tb, this.control[31]];
        }
      }
      const before = genericCalls;
      const result = original.call(this, d, s, t);
      if (active && name === 'MUL_S') {
        const row = active.MUL_S;
        row.fastPathHits = (row.fastPathHits ?? 0) + Number(genericCalls === before);
      }
      return result;
    };
  }
}
