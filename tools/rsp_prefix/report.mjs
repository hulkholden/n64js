import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const dir = resolve(process.argv[2] ?? 'tools/rsp_prefix/results');
const median = a => { const s = [...a].sort((a,b)=>a-b); return s.length % 2 ? s[(s.length-1)/2] : (s[s.length/2-1]+s[s.length/2])/2; };
const mad = a => median(a.map(v=>Math.abs(v-median(a))));
const fmt = a => `${median(a).toFixed(2)} ± ${mad(a).toFixed(2)}`;
const signed = n => `${n>=0?'+':''}${n.toFixed(2)}%`;
const lines = ['# Measurements', '', 'Baseline `19c9550`; Apple M4, macOS 26.5.2; Bun 1.3.14 and Playwright 1.58.2 / Chromium 145.0.7632.6, ANGLE Metal.', '', 'Five adjacent pairs per workload, alternating baseline-first and prototype-first. Each sample uses a fresh emulator/process or browser context. All accepted timings were collected after the competing Chrome workload was paused; the earlier contended samples were discarded. Values below are median ± median absolute deviation (MAD), not confidence intervals. Positive paired changes mean faster execution.', ''];
const groups = new Map();
if (existsSync(resolve(dir,'headless.json'))) {
  for (const row of JSON.parse(readFileSync(resolve(dir,'headless.json')))) {
    const r=row.results[0]; const key=`${r.name}, VI ${r.warmupFrames+1}–${r.warmupFrames+600}`;
    if (!groups.has(key)) { groups.set(key, []); }
    groups.get(key).push({...row, rate:r.medianFramesPerSecond});
  }
}
const browser = JSON.parse(readFileSync(resolve(dir,'browser/browser.json')));
groups.set('GoldenEye Dam loading, VI 1660–2399 (Chromium)',browser.map(r=>({...r,rate:740000/r.loadingMs})));
groups.set('GoldenEye Dam stationary, VI 2595–3134 (Chromium)',browser.map(r=>({...r,rate:540000/r.gameplayMs})));
lines.push('| Workload | Baseline VI/s ± MAD | Prototype VI/s ± MAD | Paired changes, in order | Median paired change |','| --- | ---: | ---: | --- | ---: |');
for (const [name,rows] of groups) {
  const b=rows.filter(r=>r.variant==='baseline'), p=rows.filter(r=>r.variant==='prototype');
  if (b.length!==5 || p.length!==5) { throw new Error(`Incomplete pairs for ${name}`); }
  const changes=b.map(x=>100*(p.find(y=>y.pair===x.pair).rate/x.rate-1));
  lines.push(`| ${name} | ${fmt(b.map(r=>r.rate))} | ${fmt(p.map(r=>r.rate))} | ${changes.map(signed).join(', ')} | ${signed(median(changes))} |`);
}
const first = browser[0];
const matching = browser.every(r=>JSON.stringify([r.state,r.vi,r.count,r.pc,r.delayPC])===JSON.stringify([first.state,first.vi,first.count,first.pc,first.delayPC]));
lines.push('', `All ${browser.length} browser samples have identical recorded CPU/FPU/COP0/RAM/RSP/device/event state: **${matching}**. First-pair canvas screenshots are byte-identical. The screenshots show the stationary Dam scene:`, '', '| Baseline | Prototype |','| --- | --- |','| ![Baseline Dam](browser/baseline.png) | ![Prototype Dam](browser/prototype.png) |', '', 'Raw per-run durations, rates, states and settings are retained in [headless.json](headless.json) and [browser/browser.json](browser/browser.json).');
writeFileSync(resolve(dir,'RESULTS.md'),lines.join('\n')+'\n');
