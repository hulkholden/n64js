import '../src/n64.js';
import { GBIMicrocode } from '../src/hle/graphics/microcodes/gbi_microcode.js';

// Count before warning deduplication, without changing execution. This entry
// point also builds on the pre-fix revision for a comparable browser replay.
window.conkerWarnings = {};
const warn = GBIMicrocode.prototype.warn;
GBIMicrocode.prototype.warn = function (type, ...args) {
  const key = `${this.constructor.name}: ${type}`;
  window.conkerWarnings[key] = (window.conkerWarnings[key] || 0) + 1;
  return warn.call(this, type, ...args);
};
