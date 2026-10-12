/* global window */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [baseline, prototype, profile, output, pairsText = '5'] = process.argv.slice(2);
if (!output) {
  throw new Error('Usage: node micro_browser.js BASELINE PROTOTYPE PROFILE_JSON OUTPUT_JSON [PAIRS]');
}
const captured = JSON.parse(readFileSync(profile))[0].diagnostic;
let root;
const server = createServer((req, res) => {
  if (req.url !== '/micro.js') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<script type="module">import {runMicrobenchmarks} from "/micro.js"; window.runMicrobenchmarks = runMicrobenchmarks;</script>');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/javascript' });
  res.end(readFileSync(resolve(root, 'build/fpu-micro.js')));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const results = [];
try {
  for (let pair = 0; pair < Number(pairsText); pair++) {
    for (const variant of pair % 2 ? ['prototype', 'baseline'] : ['baseline', 'prototype']) {
      root = resolve(variant === 'baseline' ? baseline : prototype);
      const browser = await chromium.launch({ headless: true, channel: 'chromium' });
      try {
        const page = await browser.newPage();
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        await page.waitForFunction(() => window.runMicrobenchmarks);
        const result = await page.evaluate(captured => window.runMicrobenchmarks(captured), captured);
        results.push({ pair: pair + 1, variant, runtime: browser.version(), ...result });
        writeFileSync(output, JSON.stringify(results, null, 2) + '\n');
        console.log(JSON.stringify({ pair: pair + 1, variant, results: result.results }));
      } finally {
        await browser.close();
      }
    }
  }
} finally {
  server.close();
}
