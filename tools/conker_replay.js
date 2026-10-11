/* global window, document, n64js */ // Playwright page callbacks.
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';

// Fresh-save browser replay with controller transitions keyed to VI retraces.
// See conker.md. ROMs remain local and are never included in the output.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: {
  rom: { type: 'string' }, output: { type: 'string', default: 'build/conker-replay' },
  frames: { type: 'string', default: '600,1800,3600' },
  input: { type: 'string' }, bundle: { type: 'string' },
} });
if (!values.rom) {
  throw new Error('Usage: node tools/conker_replay.js --rom /path/to/conker.z64 [--input transitions.json]');
}
const frames = values.frames.split(',').map(Number);
if (frames.some((n, i) => !Number.isSafeInteger(n) || n <= (frames[i - 1] || 0))) {
  throw new Error('--frames must be strictly increasing positive VI counts');
}
const input = values.input ? JSON.parse(await readFile(values.input, 'utf8')) : [];
if (!Array.isArray(input) || input.some((v, i) => !Number.isSafeInteger(v.vi) || v.vi < 0 ||
    (i > 0 && v.vi <= input[i - 1].vi) ||
    !Number.isInteger(v.buttons) || v.buttons < 0 || v.buttons > 0xffff ||
    ['stickX', 'stickY'].some(k => !Number.isInteger(v[k] ?? 0) || Math.abs(v[k] ?? 0) > 80))) {
  throw new Error('Input must be ordered { vi, buttons, stickX?, stickY? } transitions');
}
const output = resolve(values.output);
await mkdir(output, { recursive: true });
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim();
const bundle = values.bundle ? resolve(values.bundle) : resolve(output, 'replay.js');
if (!values.bundle) {
  execFileSync('bun', ['build', 'tools/conker_replay_browser.js', `--outfile=${bundle}`,
    '--define', `__BUILD_VERSION__=${JSON.stringify(revision)}`], { cwd: root, stdio: 'inherit' });
}
const rom = await readFile(values.rom);
if (rom.readUInt32BE(0) !== 0x80371240) {
  throw new Error('Supply a big-endian .z64 ROM so the recorded hash is canonical');
}
const hash = buffer => createHash('sha256').update(buffer).digest('hex');
const report = {
  revision, dirty: Boolean(dirty), romSHA256: hash(rom), bundleSHA256: hash(await readFile(bundle)),
  settings: { graphics: 'HLE', audio: 'HLE', renderScale: 1, canvasScale: 1, crt: 'Off', freshSave: true },
  input, snapshots: [], errors: [],
};
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/rom') {
      response.end(rom);
      return;
    }
    const path = pathname === '/replay.js' ? bundle : resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (pathname !== '/replay.js' && relative(root, path).startsWith('..')) {
      throw new Error('Outside repository');
    }
    let data = await readFile(path);
    if (pathname === '/') {
      data = Buffer.from(data.toString().replace('build/n64.min.js', 'replay.js'));
    }
    response.setHeader('Content-Type', ({ '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css' })[extname(path)] || 'application/octet-stream');
    response.end(data);
  } catch {
    response.statusCode = 404;
    response.end();
  }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
let browser;
try {
  browser = await chromium.launch({ channel: 'chromium', headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 850 } });
  const errors = report.errors;
  report.browser = browser.version();
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(() => {
    // CPU execution below stops at each VI, independent of host frame pacing.
    window.requestAnimationFrame = () => 0;
    window.cancelAnimationFrame = () => {};
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  report.bundleVersion = await page.locator('#build-version').innerText();
  report.gpu = await page.evaluate(async() => {
    localStorage.clear();
    n64js.loadRomAndStartRunning(await (await fetch('/rom')).arrayBuffer());
    n64js.toggleRun();
    n64js.reset();
    window.halts = [];
    const halt = n64js.halt;
    n64js.halt = (msg) => { window.halts.push(String(msg));halt(msg); };
    window.tasks = 0;window.loads = {};
    const hardware = n64js.hardware();
    hardware.onGraphicsTask = () => window.tasks++;
    hardware.onMicrocodeLoad = info => { window.loads[`${info.family}/${info.variant}`] = (window.loads[`${info.family}/${info.variant}`] || 0) + 1; };
    hardware.onVerticalBlank = () => n64js.cpu0.breakExecution();
    const gl = document.getElementById('display').getContext('webgl2');
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  });
  const snapshots = report.snapshots;
  for (const target of frames) {
    let snapshot;
    do {
      // Bound each evaluation, including when WebGL uses a software backend.
      snapshot = await page.evaluate(({ target, input }) => {
        const hardware = n64js.hardware(), cpu = n64js.cpu0;
        const controller = n64js.joybus().channels[0].inputs;
        const end = Math.min(target, hardware.verticalBlankCount + 120);
        const start = performance.now();
        while (hardware.verticalBlankCount < end && !window.halts.length) {
          const transition = input.findLast(v => v.vi <= hardware.verticalBlankCount);
          controller.buttons = transition?.buttons ?? 0;
          controller.stick_x = transition?.stickX ?? 0;
          controller.stick_y = transition?.stickY ?? 0;
          cpu.run(100_000_000);
          if (performance.now() - start > 60000) {
            throw Error('VI replay timeout');
          }
        }
        const canvas = document.getElementById('display');
        const gl = canvas.getContext('webgl2');
        return { vi: hardware.verticalBlankCount, pc: cpu.pc >>> 0, tasks: window.tasks, loads: window.loads, halts: window.halts, glError: gl.getError(), warnings: window.conkerWarnings };
      }, { target, input });
    } while (snapshot.vi < target && !snapshot.halts.length);
    snapshot.image = `vi-${snapshot.vi}.png`;
    snapshots.push(snapshot);
    await page.locator('#display').screenshot({ path: resolve(output, snapshot.image) });
    await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(snapshot));
    if (snapshot.halts.length) {
      break;
    }
  }
  if (report.errors.length || report.snapshots.some(s => s.halts.length || s.glError)) {
    process.exitCode = 1;
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
