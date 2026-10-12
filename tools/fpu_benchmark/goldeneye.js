// Built sources, fresh Chromium context per run, no profiler during timing.
import { chromium } from 'playwright';
/* global window, document */
import { installDiagnostics } from './profile.js';
import { createHash } from 'node:crypto';
import { cpus, release } from 'node:os';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, extname } from 'node:path';
const [baseline, prototype, rom, output, pairsText = '5', diagnosticFlag] = process.argv.slice(2);
if (!output) {
  throw new Error('Usage: node tools/fpu_benchmark/goldeneye.js BASELINE PROTOTYPE ROM OUTPUT [PAIRS] [single-diagnostic]');
}
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
const romSha256 = createHash('sha256').update(readFileSync(rom)).digest('hex');
const host = { platform: process.platform, arch: process.arch, release: release(), cpu: cpus()[0]?.model, node: process.version };
try {
  for (let pair = 0; pair < Number(pairsText); pair++) {
    for (const variant of diagnosticFlag === 'single-diagnostic' ? ['baseline'] : pair % 2 ? ['prototype', 'baseline'] : ['baseline', 'prototype']) {
      root = resolve(variant === 'baseline' ? baseline : prototype);
      const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--autoplay-policy=no-user-gesture-required'] });
      try {
        const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
        await page.addInitScript(() => { window.requestAnimationFrame = () => 1; window.cancelAnimationFrame = () => {}; });
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        await page.waitForFunction(() => window.n64js?.cpu0 && window.n64js?.loadRomAndStartRunning);
        if (diagnosticFlag?.includes('diagnostic')) {
          await page.evaluate(installDiagnostics);
        }
        const result = await page.evaluate(async () => {
          const n = window.n64js;
          const h = n.hardware();
          let seed = 0x12345678;
          n.cpu0.setRandomSource(() => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; });
          n.loadRomAndStartRunning(await (await fetch('/rom')).arrayBuffer());
          n.toggleRun();
          n.reset(); // Discard any synchronous frame run by toggleRun during load.
          seed = 0x12345678;
          await h.aiRegDevice.audioContext.resume();
          const input = n.joybus().channels[0].inputs;
          let fatal = null;
          n.halt = message => { fatal = String(message); n.cpu0.breakExecution(); };
          const run = (frames, buttons = 0) => {
            input.buttons = buttons;
            const target = h.verticalBlankCount + frames;
            h.onVerticalBlank = count => {
              if (count >= target) {
                n.cpu0.breakExecution();
              }
            };
            const start = performance.now();
            while (h.verticalBlankCount < target && !fatal) {
              n.cpu0.run(10_000_000);
            }
            if (fatal) {
              throw new Error(fatal);
            }
            return performance.now() - start;
          };
          run(419);
          const menus = [[10,4096],[180],[10,4096],[180],[10,4096],[420],[10,4096],[120],[10,32768],[90],[10,32768],[90],[10,32768],[90]];
          for (const step of menus) {
            run(...step);
          }
          window.fpuDiagnostic?.begin('loading');
          const loadingStart = performance.now();
          for (const step of [[10,4096],[120],[240],[10,4096],[180],[180]]) {
            run(...step);
          }
          const loadingMs = performance.now() - loadingStart;
          window.fpuDiagnostic?.end();
          run(15,32768); run(180);
          const startVI = h.verticalBlankCount;
          window.fpuDiagnostic?.begin('gameplay');
          const gameplayMs = run(540);
          // Read in the same task, before async hashing permits a buffer clear.
          const canvasPNG = document.getElementById('display').toDataURL('image/png');
          window.fpuDiagnostic?.end();
          const diagnostic = window.fpuDiagnostic?.windows;
          const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
          const bytes = view => new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
          const events = [];
          let deadline = n.cpu0.eventQueue.cyclesToFirstEvent;
          for (let event = n.cpu0.eventQueue.firstEvent; event; event = event.next) {
            events.push([event.type, deadline]); deadline += event.cyclesToNextEvent;
          }
          const state = {
            cpu: await digest(bytes(n.cpu0.gprU32)), cop0: await digest(bytes(n.cpu0.controlRegU32)),
            fpu: await digest(bytes(h.cpu1.regU32)), fcr: [...h.cpu1.control],
            ram: await digest(h.ram.u8), spmem: await digest(h.sp_mem.u8),
            rsp: await digest(bytes(h.rsp.gprU32)), vectors: await digest(bytes(h.rsp.vprU32)),
            accumulator: await digest(bytes(h.rsp.vAccU32)), rspPC: h.rsp.pc, rspDelayPC: h.rsp.delayPC,
            rspHalted: h.rsp.halted, vco: [...h.rsp.vuVCOReg], vcc: [...h.rsp.vuVCCReg], vce: [...h.rsp.vuVCEReg], div: [h.rsp.divDP, h.rsp.divIn, h.rsp.divOut], events,
            devices: Object.fromEntries(['sp_reg','mi_reg','pi_reg','si_reg','ai_reg','vi_reg','dpc_mem'].map(k => [k, [...h[k].u8]])),
          };
          const fragments = [...h.fragmentCache.fragments.values()];
          const codeBytes = fragments.reduce((bytes, f) => bytes + ((f.func ?? f.cachedFunc)?.toString().length ?? 0), 0);
          const gl = document.getElementById('display').getContext('webgl2');
          const debug = gl.getExtension('WEBGL_debug_renderer_info');
          return { canvasPNG, startVI, codeBytes, audioContext: h.aiRegDevice.audioContext.state, diagnostic, state, loadingMs, gameplayMs, vi: h.verticalBlankCount, count: n.cpu0.controlCountValue, pc: n.cpu0.pc, delayPC: n.cpu0.delayPC, renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
        });
        if (pair === 0) {
          writeFileSync(resolve(output, `${variant}.png`), Buffer.from(result.canvasPNG.split(',')[1], 'base64'));
        }
        delete result.canvasPNG;
        const row = { pair: pair + 1, variant, runtime: browser.version(), romSha256, host, buildSha256: createHash('sha256').update(readFileSync(resolve(root, 'build/n64.min.js'))).digest('hex'), ...result };
        results.push(row);
        writeFileSync(resolve(output, 'browser.json'), JSON.stringify(results, null, 2) + '\n');
        console.log(JSON.stringify({ pair: row.pair, variant, runtime: row.runtime, loadingMs: row.loadingMs, gameplayMs: row.gameplayMs, vi: row.vi, renderer: row.renderer }));
      } finally { await browser.close(); }
    }
  }
} finally { server.close(); }
