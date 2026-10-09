// Allocation/source diagnostics; do not use these runs for throughput claims.
// Uses prepare.py and capture.mjs. An optional corpus supports group replay.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const [root, , output] = process.argv.slice(2);
const { RAMStoreGroup } = await import(`${root}/src/cpu/ram_store_group.js`);
const original = !RAMStoreGroup.prototype.reset;
const corpus = [];
const phases = {};
const sources = [];
function counters() {
  const vi = globalThis.n64js?.hardware().verticalBlankCount ?? 0;
  const phase = vi < 120 ? 'warmup' : vi < 720 ? 'early' : vi < 1320 ? 'advance' : 'later';
  return phases[phase] ??= { candidates: 0, stores: 0, groups: 0, histogram: {}, finishMs: 0 };
}
const add = RAMStoreGroup.prototype.add;
RAMStoreGroup.prototype.add = function (...args) {
  const start = performance.now();
  const stats = counters();
  if ((original ? this.stores.length : this.count) === 0) stats.candidates++;
  stats.stores++;
  globalThis.__instrumentationMs += performance.now() - start;
  return add.apply(this, args);
};
const finish = RAMStoreGroup.prototype.finish;
RAMStoreGroup.prototype.finish = function (fragment) {
  const start = performance.now();
  const stats = counters();
  const count = original ? this.stores.length : this.count;
  if (count) {
    stats.histogram[count] = (stats.histogram[count] ?? 0) + 1;
    if (count >= 2) stats.groups++;
    if (original) corpus.push({ base: this.base, stores: this.stores, body: fragment.bodyCode });
  }
  globalThis.__instrumentationMs += performance.now() - start;
  const before = performance.now();
  const result = finish.call(this, fragment);
  const end = performance.now();
  stats.finishMs += end - before;
  return result;
};
let compile;
Object.defineProperty(globalThis, '__compileFragment', {
  get: () => compile,
  set(fn) {
    compile = (...args) => {
      const start = performance.now();
      const source = args.at(-1);
      const match = /return function fragment_(0x[0-9a-f]+)_(\d+)\(/.exec(source);
      sources.push({ pc: match[1], ops: Number(match[2]), bytes: Buffer.byteLength(source),
        sha256: createHash('sha256').update(source).digest('hex') });
      globalThis.__instrumentationMs += performance.now() - start;
      return fn(...args);
    };
  },
});
await import('./capture.mjs');
writeFileSync(`${output}/overhead.json`, JSON.stringify({ original, phases, sources }, null, 2));
if (original) writeFileSync(`${output}/corpus.json`, JSON.stringify(corpus));
