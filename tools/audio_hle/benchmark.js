#!/usr/bin/env node
// Benchmark captured tasks without ROM execution, disk I/O or RAM restoration
// in the timed interval. Node's optional heap sampling includes collected
// objects, so short-lived allocation traffic is visible as well as retention.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

let iterations = 400, warmup = 150, profilePath;
let moduleURL = new URL('../../src/hle/hle_audio.js', import.meta.url);
const prefixes = [];
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--iterations=')) iterations = Number(arg.slice(13));
  else if (arg.startsWith('--warmup=')) warmup = Number(arg.slice(9));
  else if (arg.startsWith('--profile=')) profilePath = arg.slice(10);
  else if (arg.startsWith('--module=')) moduleURL = pathToFileURL(resolve(arg.slice(9)));
  else if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
  else prefixes.push(arg);
}
if (!prefixes.length || !Number.isSafeInteger(iterations) || iterations < 1 || !Number.isSafeInteger(warmup) || warmup < 0) {
  throw new Error('Usage: node tools/audio_hle/benchmark.js <capture-prefix> [...] [--iterations=400] [--warmup=150] [--profile=/tmp/audio.heapprofile] [--module=/path/to/baseline/hle_audio.js]');
}
const { hleProcessAudioTask } = await import(moduleURL.href);
const cases = prefixes.map(prefix => {
  const read = key => new Uint8Array(readFileSync(`${prefix}-${key}.bin`));
  const ram = read('ram'), sp = new Uint8Array(8192);
  sp.set(read('dmem')); sp.set(read('imem'), 4096);
  return { prefix, ram, sp, times: new Float64Array(iterations), hardware: {
    ram: { u8: ram.slice() }, sp_mem: { u8: sp.slice() }, rsp: { pc: 0 }, spRegDevice: { writeReg32() {} },
    dpcDevice: { statusReg: 0 },
  } };
});

function run(item) {
  item.hardware.ram.u8.set(item.ram);
  item.hardware.sp_mem.u8.set(item.sp);
  const start = performance.now();
  if (!hleProcessAudioTask(item.hardware)) throw new Error(`Unexpected fallback: ${item.prefix}`);
  return performance.now() - start;
}

for (let i = 0; i < warmup; i++) for (const item of cases) run(item);
for (let i = 0; i < iterations; i++) for (const item of cases) item.times[i] = run(item);
for (const item of cases) {
  item.times.sort();
  console.log(JSON.stringify({ prefix: item.prefix, iterations,
    medianUS: item.times[Math.floor(iterations / 2)] * 1000,
    p90US: item.times[Math.floor(iterations * 0.9)] * 1000,
  }));
}

if (profilePath) {
  const { Session } = await import('node:inspector/promises');
  const session = new Session();
  session.connect();
  await session.post('HeapProfiler.startSampling', { samplingInterval: 512,
    includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  const rounds = Math.min(iterations, 200);
  for (let i = 0; i < rounds; i++) for (const item of cases) run(item);
  const { profile } = await session.post('HeapProfiler.stopSampling');
  session.disconnect();
  writeFileSync(profilePath, JSON.stringify(profile));
  let total = 0;
  const rows = [];
  function visit(node) {
    if (node.selfSize && /\/(?:audio_[^/]+|hle_audio)\.js$/.test(node.callFrame.url)) {
      total += node.selfSize;
      rows.push({ function: node.callFrame.functionName, file: node.callFrame.url.split('/').pop(), bytes: node.selfSize });
    }
    for (const child of node.children) visit(child);
  }
  visit(profile.head);
  rows.sort((a, b) => b.bytes - a.bytes);
  console.log(JSON.stringify({ profilePath, sampledBytesPerTask: total / (rounds * cases.length), top: rows.slice(0, 12) }));
}
