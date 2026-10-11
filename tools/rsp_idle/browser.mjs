// Built sources, fresh Chromium context per run, no profiler during timing.
import { chromium } from 'playwright';
import { installDiagnostics } from './browser_diagnostics.mjs';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, extname } from 'node:path';
const [baseline, prototype, rom, output, pairsText = '5', diagnosticFlag] = process.argv.slice(2);
if (!output) { throw new Error('Usage: node browser.mjs BASELINE PROTOTYPE ROM OUTPUT [PAIRS]'); }
mkdirSync(output, { recursive: true });
let root;
const server = createServer((req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    const file = path === '/rom' ? rom : resolve(root, '.' + (path === '/' ? '/index.html' : path));
    const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' }[extname(file)] || 'application/octet-stream';
    const content = readFileSync(file);
    res.writeHead(200, { 'Content-Type': mime });
    res.end(content);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const results = [];
try {
  for (let pair = 0; pair < Number(pairsText); pair++) {
    for (const variant of pair % 2 ? ['prototype', 'baseline'] : ['baseline', 'prototype']) {
      root = resolve(variant === 'baseline' ? baseline : prototype);
      const browser = await chromium.launch({ headless: true, channel: 'chromium' });
      try {
        const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
        await page.addInitScript(() => { window.requestAnimationFrame = () => 1; window.cancelAnimationFrame = () => {}; });
        if (diagnosticFlag === 'diagnostic') { await page.addInitScript(installDiagnostics); }
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        await page.waitForFunction(() => window.n64js?.cpu0 && window.n64js?.loadRomAndStartRunning);
        const result = await page.evaluate(async () => {
          const n = window.n64js;
          const h = n.hardware();
          let seed = 0x12345678;
          n.cpu0.setRandomSource(() => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; });
          n.loadRomAndStartRunning(await (await fetch('/rom')).arrayBuffer());
          n.toggleRun();
          n.reset(); // Discard any synchronous frame run by toggleRun during load.
          seed = 0x12345678;
          if (window.rspIdleStats) {
            const idle = n.cpu0.runActiveRSPIdleLoop;
            if (idle) {
              n.cpu0.runActiveRSPIdleLoop = function (pc) {
                window.rspIdleStats.idleBatches++;
                const ops = idle.call(this, pc);
                window.rspIdleStats.idleOps += ops;
                return ops;
              };
            }
            const step = h.rsp.step;
            h.rsp.step = function () {
              window.rspIdleStats.steps++;
              if (this.halted) { window.rspIdleStats.haltedSteps++; }
              else { window.rspIdleStats.rspInstructions++; }
              return step.call(this);
            };
          }
          const input = n.joybus().channels[0].inputs;
          let fatal = null;
          n.halt = message => { fatal = String(message); n.cpu0.breakExecution(); };
          const run = (frames, buttons = 0) => {
            input.buttons = buttons;
            const target = h.verticalBlankCount + frames;
            h.onVerticalBlank = count => { if (count >= target) { n.cpu0.breakExecution(); } };
            const start = performance.now();
            while (h.verticalBlankCount < target && !fatal) { n.cpu0.run(10_000_000); }
            if (fatal) { throw new Error(fatal); }
            return performance.now() - start;
          };
          run(419);
          if (window.rspIdleStats && !window.rspIdleStats.compilations) { throw new Error('Compilation diagnostic hook did not fire'); }
          const menus = [[10,4096],[180],[10,4096],[180],[10,4096],[420],[10,4096],[120],[10,32768],[90],[10,32768],[90],[10,32768],[90]];
          for (const step of menus) { run(...step); }
          const loadingCounters = { ...window.rspIdleStats };
          const loadingStart = performance.now();
          for (const step of [[10,4096],[120],[240],[10,4096],[180],[180]]) { run(...step); }
          const loadingMs = performance.now() - loadingStart;
          run(15,32768); run(180);
          const gameplayCounters = { ...window.rspIdleStats };
          const gameplayMs = run(540);
          const delta = start => Object.fromEntries(Object.entries(window.rspIdleStats ?? {}).map(([k,v]) => [k, v - start[k]]));
          const diagnostic = window.rspIdleStats ? {
            total: { ...window.rspIdleStats },
            loadingAndEntry: Object.fromEntries(Object.keys(gameplayCounters).map(k => [k, gameplayCounters[k] - loadingCounters[k]])),
            gameplay: delta(gameplayCounters),
            hottest: [...window.rspIdleSources.values()].sort((a,b) => b.runs-a.runs).slice(0,8),
          } : undefined;
          const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
          const bytes = view => new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
          const events = [];
          let deadline = n.cpu0.eventQueue.cyclesToFirstEvent;
          for (let event = n.cpu0.eventQueue.firstEvent; event; event = event.next) {
            events.push([event.type, deadline]); deadline += event.cyclesToNextEvent;
          }
          const state = {
            cop0Words: [...n.cpu0.controlRegU32],
            cpu: await digest(bytes(n.cpu0.gprU32)), cop0: await digest(bytes(n.cpu0.controlRegU32)),
            fpu: await digest(bytes(h.cpu1.regU32)), fcr: [...h.cpu1.control],
            ram: await digest(h.ram.u8), spmem: await digest(h.sp_mem.u8),
            rsp: await digest(bytes(h.rsp.gprU32)), vectors: await digest(bytes(h.rsp.vprU32)),
            accumulator: await digest(bytes(h.rsp.vAccU32)), rspPC: h.rsp.pc, rspDelayPC: h.rsp.delayPC,
            rspHalted: h.rsp.halted, vco: [...h.rsp.vuVCOReg], vcc: [...h.rsp.vuVCCReg], vce: [...h.rsp.vuVCEReg], div: [h.rsp.divDP, h.rsp.divIn, h.rsp.divOut], events,
            devices: Object.fromEntries(['sp_reg','mi_reg','pi_reg','si_reg','ai_reg','vi_reg','dpc_mem'].map(k => [k, [...h[k].u8]])),
          };
          const gl = document.getElementById('display').getContext('webgl2');
          const debug = gl.getExtension('WEBGL_debug_renderer_info');
          return { diagnostic, state, loadingMs, gameplayMs, vi: h.verticalBlankCount, count: n.cpu0.controlCountValue, pc: n.cpu0.pc, delayPC: n.cpu0.delayPC, renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
        });
        if (pair === 0 && diagnosticFlag !== 'diagnostic') { await page.locator('#display').screenshot({ path: resolve(output, `${variant}.png`) }); }
        const row = { pair: pair + 1, variant, runtime: browser.version(), ...result };
        results.push(row);
        writeFileSync(resolve(output, 'browser.json'), JSON.stringify(results, null, 2) + '\n');
        const previous = results.find(r => r.variant === variant);
        if (JSON.stringify(previous.state) !== JSON.stringify(row.state)) { throw new Error('Non-deterministic replay state'); }
        const base = results.find(r => r.pair === row.pair && r.variant === 'baseline');
        const opt = results.find(r => r.pair === row.pair && r.variant === 'prototype');
        if (base && opt) {
          const differences = Object.keys(base.state).filter(k => JSON.stringify(base.state[k]) !== JSON.stringify(opt.state[k]));
          console.log(JSON.stringify({ pair: row.pair, stateDifferences: differences }));
          if (differences.length || base.pc !== opt.pc || base.delayPC !== opt.delayPC || base.count !== opt.count) { throw new Error('Baseline/prototype replay state differs'); }
        }
        console.log(JSON.stringify({ pair: row.pair, variant, runtime: row.runtime, loadingMs: row.loadingMs, gameplayMs: row.gameplayMs, vi: row.vi, renderer: row.renderer }));
      } finally { await browser.close(); }
    }
  }
} finally { server.close(); }
