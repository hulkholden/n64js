// Run with: bun src/hle/tmem_load.bench.js [baseline=HEAD] [output=build/tmem-load-benchmark.json]
// Requires Playwright Chromium (as used by test:visual). Compare only the TMEM
// implementation at the baseline revision, using the worktree's support modules.
// The baseline must expose the same TMEM API as the worktree.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../', import.meta.url));
const baseline = process.argv[2] ?? 'HEAD';
const output = resolve(process.argv[3] ?? 'build/tmem-load-benchmark.json');
const variants = ['baseline', 'current'];
const sourcePath = resolve(root, 'src/hle/tmem.js');
const sources = [
  execFileSync('git', ['show', `${baseline}:src/hle/tmem.js`], { cwd: root, encoding: 'utf8' }),
  await readFile(sourcePath, 'utf8'),
];
const rounds = 9;
const sampleMs = 45;
const browser = await chromium.launch({ headless: true });
const pages = [];
try {
  for (let v = 0; v < variants.length; v++) {
    const result = await Bun.build({
      entrypoints: [resolve(root, 'src/hle/rsp_state.js')],
      target: 'browser',
      format: 'esm',
      plugins: [{
        name: 'tmem-source',
        setup(build) {
          build.onLoad({ filter: /\/tmem\.js$/ }, () => ({ contents: sources[v], loader: 'js' }));
        },
      }],
    });
    if (!result.success) {
      throw new AggregateError(result.logs, 'Benchmark bundle failed');
    }
    const source = await result.outputs[0].text();
    const page = await browser.newPage();
    await page.evaluate(async source => {
      const { RSPState } = await import(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
      const ram = Uint8Array.from({ length: 8 * 1024 * 1024 }, (_, i) => (i * 37 + (i >>> 8) * 13) & 255);
      globalThis.n64js = { hardware: () => ({ cachedMemDevice: { u8: ram } }) };
      const cases = [];
      // RDP format/size values: RGBA=0, YUV=1, CI=2; 4/8/16/32-bit=0/1/2/3.
      const make = (name, method, format, size, width, height = 1, address = 0, tileSize = size, offset = 0) => {
        const state = new RSPState();
        state.reset(new DataView(ram.buffer), 0);
        const tile = state.tiles[7];
        const bankBytesPerTexel = format === 1 ? 1 : size === 3 ? 2 : (1 << size) / 2;
        const line = method === 'tile' ? Math.ceil(width * bankBytesPerTexel / 8) : 0;
        tile.set(format, tileSize, line, offset, 0, 0, 0, 0, 0, 0, 0);
        state.textureImage.set(format, size, width, address);
        tile.setSize(0, 0, method === 'block' ? width * height - 1 : (width - 1) * 4,
          method === 'block' ? Math.ceil(2048 / (width * (1 << size) / 16)) : (height - 1) * 4);
        const run = method === 'block' ? () => state.tmem.loadBlock(state.textureImage, tile)
          : method === 'tile' ? () => state.tmem.loadTile(state.textureImage, tile)
            : () => state.tmem.loadTLUT(state.textureImage, tile);
        cases.push({ name, run, state });
      };
      for (const method of ['block', 'tile']) {
        make(`${method} RGBA16 aligned 2KiB`, method, 0, 2, 32, 32);
        make(`${method} CI8 aligned 2KiB`, method, 2, 1, 64, 32);
        make(`${method} RGBA32 4KiB`, method, 0, 3, 32, 32);
        make(`${method} YUV16 2KiB`, method, 1, 2, 32, 32);
        make(`${method} RGBA16 unaligned 2KiB`, method, 0, 2, 32, 32, 1);
        make(`${method} source16 tile32`, method, 0, 2, 32, 32, 0, 3);
        make(`${method} RGBA32 tiny 16B`, method, 0, 3, 4, 1);
        make(`${method} YUV16 tiny 16B`, method, 1, 2, 8, 1);
      }
      make('tile CI8 odd stride/wrapped', 'tile', 2, 1, 63, 32, 3, 1, 509);
      make('TLUT 16 entries', 'tlut', 0, 2, 16, 1, 0, 0, 256);
      make('TLUT 256 entries', 'tlut', 0, 2, 256, 1, 0, 0, 256);
      make('TLUT odd 256 entries', 'tlut', 0, 2, 256, 1, 1, 0, 256);
      const individual = [...cases];
      cases.push({ name: 'mixed formats', run: () => {
        for (const c of individual) {
          c.run();
        }
      } });
      // Warm every format before timing: the real load sites are polymorphic.
      for (let i = 0; i < 2000; i++) {
        for (const c of individual) {
          c.run();
        }
      }
      globalThis.measure = (index, count) => {
        const run = cases[index].run;
        const start = performance.now();
        for (let i = 0; i < count; i++) {
          run();
        }
        return performance.now() - start;
      };
      globalThis.names = cases.map(c => c.name);
      globalThis.snapshot = () => individual.map(c => Array.from(c.state.tmem.tmemData));
    }, source);
    pages.push(page);
  }
  const names = await pages[0].evaluate(() => globalThis.names);
  const snapshot = async page => JSON.stringify(await page.evaluate(() => globalThis.snapshot()));
  if (await snapshot(pages[0]) !== await snapshot(pages[1])) {
    throw new Error('TMEM differs after warmup');
  }

  const counts = [];
  for (let i = 0; i < names.length; i++) {
    const elapsed = await pages[0].evaluate(i => globalThis.measure(i, 1000), i);
    counts.push(Math.max(100, Math.min(1000000, Math.ceil(sampleMs / Math.max(0.1, elapsed) * 1000))));
  }
  const samples = variants.map(() => names.map(() => []));
  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < names.length; i++) {
      // Alternate order to reduce bias from warmup or CPU frequency changes.
      for (let j = 0; j < pages.length; j++) {
        const v = (j + round) % pages.length;
        const elapsed = await pages[v].evaluate(({ i, count }) => globalThis.measure(i, count), { i, count: counts[i] });
        samples[v][i].push(elapsed * 1000 / counts[i]);
      }
    }
  }
  if (await snapshot(pages[0]) !== await snapshot(pages[1])) {
    throw new Error('TMEM differs after timing');
  }
  const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const results = names.map((name, i) => ({
    name, iterations: counts[i],
    timings: variants.map((variant, v) => ({ variant, medianUs: median(samples[v][i]), samplesUs: samples[v][i] })),
  }));
  const environment = { chromium: browser.version(), cpu: os.cpus()[0].model, platform: process.platform, arch: process.arch };
  console.log(environment);
  console.table(results.map(({ name, timings }) => ({
    name, baselineUs: timings[0].medianUs.toFixed(3), currentUs: timings[1].medianUs.toFixed(3),
    speedup: (timings[0].medianUs / timings[1].medianUs).toFixed(2) + 'x',
  })));
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({
    environment, baseline, rounds, sampleMs,
    sourceHashes: sources.map(source => createHash('sha256').update(source).digest('hex')),
    results,
  }, null, 2) + '\n');
  console.log(`Results: ${output}`);
} finally {
  await browser.close();
}
