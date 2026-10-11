import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(process.argv[2] ?? 'tools/rsp_idle/results');
const read = name => JSON.parse(readFileSync(resolve(root, name), 'utf8'));
const median = a => [...a].sort((a,b) => a-b)[Math.floor(a.length / 2)];
const f = v => v.toFixed(2);
const signed = v => `${v >= 0 ? '+' : ''}${f(v)}%`;
const summarize = rates => `${f(median(rates))} ± ${f(median(rates.map(r => Math.abs(r-median(rates)))))}`;
const groups = new Map();
for (const row of read('headless.json')) {
  const r = row.results[0];
  const key = `${r.name}, VIs ${r.warmupFrames + 1}–${r.warmupFrames + 600}`;
  if (!groups.has(key)) { groups.set(key, []); }
  groups.get(key).push({ ...row, rate: r.medianFramesPerSecond });
}
if (existsSync(resolve(root, 'browser/browser.json'))) {
  const rows = read('browser/browser.json');
  for (const [phase, frames, field] of [['loading', 740, 'loadingMs'], ['gameplay', 540, 'gameplayMs']]) {
    groups.set(`GoldenEye Chromium ${phase}`, rows.map(r => ({ ...r, rate: frames * 1000 / r[field] })));
  }
}
let text = '# Active-RSP idle batching measurements\n\n';
text += 'Baseline: `19c9550516e3b86c24b40ceef17d847e4470c58a`. Runtime/ROM/source hashes are in [environment.json](environment.json). Five adjacent, alternating pairs per workload; fresh process/context per sample; profiling disabled. Rates are VI/s, not rendered game FPS. Variation is median absolute deviation (MAD).\n\n';
text += '| Workload | Baseline median ± MAD | Prototype median ± MAD | Individual paired changes | Median paired change |\n| --- | ---: | ---: | --- | ---: |\n';
for (const [name, rows] of groups) {
  const base = rows.filter(r => r.variant === 'baseline');
  const opt = rows.filter(r => r.variant === 'prototype');
  if (base.length !== 5 || opt.length !== 5) { throw new Error(`Incomplete pairs: ${name}`); }
  const changes = base.map(b => 100 * (opt.find(p => p.pair === b.pair).rate / b.rate - 1));
  text += `| ${name} | ${summarize(base.map(r => r.rate))} | ${summarize(opt.map(r => r.rate))} | ${changes.map(signed).join(', ')} | ${signed(median(changes))} |\n`;
}
text += '\nHeadless windows use the stock harness, RSP and HLE audio enabled, graphics lists skipped. Browser windows use the issue’s seeded, rendered Dam protocol with HLE graphics/audio. Headless GPR/PC fingerprints alone are not a correctness oracle. Raw samples are retained alongside this report.\n';
if (existsSync(resolve(root, 'browser/browser.json'))) {
  const rows = read('browser/browser.json');
  const base = rows.find(r => r.variant === 'baseline');
  const opt = rows.find(r => r.variant === 'prototype');
  const differences = Object.keys(base.state).filter(k => JSON.stringify(base.state[k]) !== JSON.stringify(opt.state[k]));
  text += `\nBrowser final-state differences: ${differences.length ? differences.join(', ') : 'none across the saved CPU/FPU/COP0, RSP, RAM, device and event state'}. CPU PC/delay/Count match: ${base.pc === opt.pc && base.delayPC === opt.delayPC && base.count === opt.count}.\n`;
  text += '\n| Baseline Dam scene | Prototype Dam scene |\n| --- | --- |\n| ![Baseline](browser/baseline.png) | ![Prototype](browser/prototype.png) |\n';
}
writeFileSync(resolve(root, 'RESULTS.md'), text);
console.log(text);
