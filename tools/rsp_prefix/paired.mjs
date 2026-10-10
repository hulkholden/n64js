// Run with node; each timed child is the existing, uninstrumented Bun harness.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const [baseline, prototype, output, ...roms] = process.argv.slice(2);
if (!roms.length) { throw new Error('Usage: node paired.mjs BASELINE PROTOTYPE OUTPUT ROM...'); }
const results = [];
for (const rom of roms) {
  for (const warmup of [120, 1320]) {
    for (let pair = 0; pair < 5; pair++) {
      for (const variant of pair % 2 ? ['prototype', 'baseline'] : ['baseline', 'prototype']) {
        const cwd = resolve(variant === 'baseline' ? baseline : prototype);
        const child = spawnSync('bun', ['run', 'src/headless/benchmark.js', '--rom', rom, '--samples', '1', '--warmup-frames', String(warmup), '--frames', '600', '--json'], { cwd, encoding: 'utf8' });
        if (child.status !== 0) { throw new Error(child.stderr); }
        const result = JSON.parse(child.stdout);
        results.push({ pair: pair + 1, variant, ...result });
        writeFileSync(output, JSON.stringify(results, null, 2) + '\n');
        console.log(JSON.stringify({ rom, warmup, pair: pair + 1, variant, rate: result.results[0].medianFramesPerSecond }));
      }
    }
  }
}
// Ensure the final report is parseable before exiting.
JSON.parse(readFileSync(output, 'utf8'));
