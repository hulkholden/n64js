import { readFileSync } from 'node:fs';
const rows = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const median = a => { const s = [...a].sort((a,b) => a-b); return s.length % 2 ? s[(s.length-1)/2] : (s[s.length/2-1]+s[s.length/2])/2; };
const stats = a => ({ median: median(a), mad: median(a.map(x => Math.abs(x-median(a)))), min: Math.min(...a), max: Math.max(...a) });
const groups = new Map();
for (const row of rows) {
  const r = row.results?.[0];
  const key = r ? `${r.name}: warmup ${r.warmupFrames}` : 'GoldenEye Chromium';
  if (!groups.has(key)) { groups.set(key, []); }
  groups.get(key).push({ ...row, rate: r?.medianFramesPerSecond ?? 540000 / row.gameplayMs });
}
for (const [name, group] of groups) {
  const baseline = group.filter(x => x.variant === 'baseline');
  const prototype = group.filter(x => x.variant === 'prototype');
  const changes = baseline.flatMap(b => { const p = prototype.find(p => p.pair === b.pair); return p ? [100*(p.rate/b.rate-1)] : []; });
  console.log(JSON.stringify({ name, baseline: stats(baseline.map(x=>x.rate)), prototype: stats(prototype.map(x=>x.rate)), changes, medianChange: median(changes) }, null, 2));
}
