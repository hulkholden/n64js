import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
const rows = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const median = values => { const a = [...values].sort((a,b) => a-b); return (a[Math.floor((a.length-1)/2)] + a[Math.ceil((a.length-1)/2)]) / 2; };
const summary = values => ({ values, median: median(values), min: Math.min(...values), max: Math.max(...values), mad: median(values.map(v => Math.abs(v - median(values)))) });
const comparisons = [];
for (const pair of [...new Set(rows.map(r => r.pair))]) {
  const a = rows.find(r => r.pair === pair && r.variant === 'baseline');
  const b = rows.find(r => r.pair === pair && r.variant === 'prototype');
  if (!a || !b) { continue; }
  const same = isDeepStrictEqual(a.state, b.state) && a.count === b.count && a.pc === b.pc && a.delayPC === b.delayPC;
  let trace;
  if (a.diagnostic && b.diagnostic) {
    const x = a.diagnostic.trace, y = b.diagnostic.trace;
    const firstMismatch = x.findIndex((r, i) => !isDeepStrictEqual(r, y[i]));
    trace = { same: x.length === y.length && firstMismatch === -1, baselineEvents: x.length, prototypeEvents: y.length,
      firstMismatch: firstMismatch < 0 ? undefined : { index: firstMismatch, baseline: x[firstMismatch], prototype: y[firstMismatch] },
      pcm: { baseline: a.diagnostic.pcm, prototype: b.diagnostic.pcm, same: isDeepStrictEqual(a.diagnostic.pcm, b.diagnostic.pcm) },
      gameplay: { baseline: a.diagnostic.gameplay, prototype: b.diagnostic.gameplay } };
  }
  comparisons.push({ pair, machineStateMatches: same, trace });
}
console.log(JSON.stringify({ comparisons, timings: Object.fromEntries(['baseline','prototype'].map(variant => [variant,
  Object.fromEntries([['loading',740],['gameplay',540]].map(([phase, count]) => [phase,
    summary(rows.filter(r => r.variant === variant).map(r => r[phase + 'Ms'] / count))]))])) }, null, 2));
if (comparisons.some(r => !r.machineStateMatches || r.trace?.same === false || r.trace?.pcm?.same === false)) { process.exitCode = 1; }
