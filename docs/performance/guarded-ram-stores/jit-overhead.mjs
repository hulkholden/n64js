// Diagnostic only; enabling JIT timing changes the measurement environment.
// BUN_JSC_reportTotalCompileTimes=1 BUN_JSC_logGC=1 bun jit-overhead.mjs <checkout> <rom> [off]
import { totalCompileTime, numberOfDFGCompiles, reoptimizationRetryCount } from 'bun:jsc';

const [root] = process.argv.slice(2);
await import(`${root}/src/headless/headless_env.js`);
const { getFragmentMap } = await import(`${root}/src/cpu/fragments.js`);
const log = console.log;
console.log = value => {
  const result = JSON.parse(value);
  const totalJITCompileMs = totalCompileTime();
  if (!(totalJITCompileMs > 0)) throw new Error('JIT timing unavailable; set BUN_JSC_reportTotalCompileTimes=1');
  // GC logs after this marker belong to result collection/shutdown, not replay.
  process.stderr.write('RAM_STORE_DIAGNOSTICS_END\n');
  const fragments = [];
  for (const f of getFragmentMap().values()) {
    if (!f.func) continue;
    fragments.push({ pc: `0x${f.entryPC.toString(16)}`, ops: f.opsCompiled,
      groups: [...f.func.toString().matchAll(/Guarded RAM SW group/g)].length,
      dfgCompiles: numberOfDFGCompiles(f.func), retries: reoptimizationRetryCount(f.func) });
  }
  // Retain state identities, but do not mix instrumented rates into throughput data.
  log(JSON.stringify({ totalJITCompileMs, fragments,
    windows: result.windows.map(({ name, endVI, state, cycles }) => ({ name, endVI, state, cycles })) }));
};
await import('./measure-overhead.mjs');
