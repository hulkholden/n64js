import { bench, run } from 'mitata';
import { TMEM } from './tmem.js';

// Run with: bun src/hle/tmem.bench.js
const tmem = new TMEM();
for (let i = 0; i < 1024; i++) {
  tmem.tmemData32[i] = Math.imul(i + 1, 0x9e3779b1);
}
bench('physical TMEM snapshot (4 KiB XXH32)', () => tmem.hashContents());
await run({});
