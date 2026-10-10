import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(process.argv[2] ?? 'tools/rsp_idle/results');
const read = p => JSON.parse(readFileSync(resolve(root, p), 'utf8'));
const n = v => v.toLocaleString('en-US');
const change = (b,p) => `${((p / b - 1) * 100).toFixed(2)}%`;
let text = '# Active-RSP idle diagnostics\n\nSeparate instrumented replays; these wall times are excluded from throughput results. RSP instruction counts measure executed guest work, not host CPU time.\n';
for (const game of ['mario','diddy','goldeneye']) {
  const b=read(`diagnostic-${game}-baseline/diagnostic.json`), p=read(`diagnostic-${game}-prototype/diagnostic.json`);
  text += `\n## ${game}, VIs ${b.warmup+1}–${b.warmup+600}\n\n| Counter | Baseline | Prototype |\n| --- | ---: | ---: |\n`;
  for (const key of ['fragmentRuns','compiledOps','interpretedOps','rspInstructions','activeRSPIdleBatches','activeRSPIdleOps','fragmentCompilations','speedHackRSPActive','speedHackSkippedCycles']) {
    text += `| ${key} | ${n(b.profile[key] ?? 0)} | ${n(p.profile[key] ?? 0)} |\n`;
  }
  const total = (r,key) => r.startup[key]+r.measured[key];
  text += `\nDispatch change: **${change(b.profile.fragmentRuns,p.profile.fragmentRuns)}**. Total CPU instructions (compiled + interpreted): ${n(b.profile.compiledOps+b.profile.interpretedOps)} → ${n(p.profile.compiledOps+p.profile.interpretedOps)}.\n`;
  text += `\nCumulative generated source: ${n(total(b,'sourceBytes'))} → ${n(total(p,'sourceBytes'))} bytes. Instrumented tracing/codegen/Function time: ${total(b,'compileMs').toFixed(2)} → ${total(p,'compileMs').toFixed(2)} ms. These single compilation probes include diagnostic overhead and are not statistical timing estimates.\n`;
  const differences = Object.keys(b.state).filter(k => JSON.stringify(b.state[k]) !== JSON.stringify(p.state[k]));
  text += `\nSaved final-state differences: ${differences.length ? differences.join(', ') : 'none'}.\n`;
}
if (existsSync(resolve(root,'browser-diagnostic/browser.json'))) {
  const rows=read('browser-diagnostic/browser.json');
  const b=rows.find(r=>r.variant==='baseline'), p=rows.find(r=>r.variant==='prototype');
  text += '\n## Rendered GoldenEye gameplay, VIs 2595–3134\n\n| Counter | Baseline | Prototype |\n| --- | ---: | ---: |\n';
  for(const key of ['fragmentRuns','completedCompiledOps','steps','haltedSteps','rspInstructions','idleBatches','idleOps','guards','hits','compilations','sourceBytes','constructionMs']) {
    text += `| ${key} | ${n(b.diagnostic.gameplay[key])} | ${n(p.diagnostic.gameplay[key])} |\n`;
  }
  text += `\nDispatch change: **${change(b.diagnostic.gameplay.fragmentRuns,p.diagnostic.gameplay.fragmentRuns)}**. Generated-source change: **${change(b.diagnostic.gameplay.sourceBytes,p.diagnostic.gameplay.sourceBytes)}**.\n`;
  text += `\nBatch coverage: **${(100*p.diagnostic.gameplay.idleOps/p.diagnostic.gameplay.completedCompiledOps).toFixed(3)}%** of compiled CPU instructions. Across the full 3134-VI replay, generated source grows ${n(b.diagnostic.total.sourceBytes)} → ${n(p.diagnostic.total.sourceBytes)} bytes: just 110 added bytes, compiled before the gameplay window. Full-replay Function construction is ${b.diagnostic.total.constructionMs.toFixed(1)} → ${p.diagnostic.total.constructionMs.toFixed(1)} ms (single diagnostic probe).\n`;
  text += '\nFunction construction excludes source generation and later host-JIT optimization. Source bytes are cumulative new JavaScript bodies, not resident host machine code. Generated hot bodies are retained in the raw diagnostic JSON.\n';
}
text += '\nThe focused DMA test separately demonstrates the legacy two-step-before-NOP-charge discrepancy. Both compiled paths retain the same result at that boundary; the interpreter differs. The discrepancy remains outside this dispatch-only prototype and is not counted as an interpreter-equal case.\n';
writeFileSync(resolve(root,'DIAGNOSTICS.md'),text);
console.log(text);
