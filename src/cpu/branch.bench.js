// Run with `bun src/cpu/branch.bench.js`. The exported runner also works in a
// browser bundle. Compare unchanged copies of this harness across revisions.
import { createHeadlessEmulator } from '../headless/headless_env.js';
import { Fragment } from './fragments.js';
import { FragmentContext, generateCodeForOp } from './recompiler.js';

const operations = [
  ['BLTZ', 0x04000000], ['BGEZ', 0x04010000],
  ['BLTZL', 0x04020000], ['BGEZL', 0x04030000],
  ['BLEZ', 0x18000000], ['BGTZ', 0x1c000000],
  ['BLEZL', 0x58000000], ['BGTZL', 0x5c000000],
  ['BLTZAL', 0x04100000], ['BGEZAL', 0x04110000],
  ['BLTZALL', 0x04120000], ['BGEZALL', 0x04130000],
];

function inputs() {
  const data = new BigUint64Array(256);
  const edges = [0n, 1n, 0xffffffffffffffffn, 0x80000000n, 0xffffffffn,
    0x100000000n, 0xffffffff00000000n, 0x8000000000000000n];
  let seed = 0x123456789abcdefn;
  for (let i = 0; i < data.length; i++) {
    seed = BigInt.asUintN(64, seed * 6364136223846793005n + 1442695040888963407n);
    data[i] = i % 2 ? seed : edges[(i >>> 1) % edges.length];
  }
  return new Uint32Array(data.buffer);
}

export async function runBranchBenchmarks({ iterations = 1_000_000, samples = 5 } = {}) {
  const { cpu0: cpu } = await createHeadlessEmulator({
    romBuffer: new ArrayBuffer(0x1000),
    rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' },
  });
  globalThis.n64js.getSyncFlow = () => null;
  const data = inputs();
  const results = [];
  for (const compiled of [false, true]) {
    for (const [name, opcode] of operations) {
      let invoke = new Function('c', `c.exec${name}(4, 3);`);
      if (compiled) {
        const fragment = new Fragment(0x80001000);
        fragment.opsCompiled = 1;
        const ctx = new FragmentContext();
        ctx.set(fragment, 0x80001000, (opcode | (4 << 21) | 3) >>> 0, 0x80001004, 0x80001004);
        generateCodeForOp(ctx);
        invoke = new Function('c', fragment.bodyCode);
      }
      // Each case gets its own call site. Vary both source words and consume
      // the resulting target/annulment so constant folding cannot remove work.
      const loop = new Function('invoke', `return function ${compiled ? 'compiled' : 'interpreted'}_${name}(c, data, iterations) {
        let checksum = 0;
        for (let i = 0; i < iterations; i++) {
          const index = (i & 255) * 2;
          c.gprU32[8] = data[index];
          c.gprU32[9] = data[index + 1];
          c.pc = 0x80001000;
          c.nextPC = 0x80001004;
          c.delayPC = null;
          c.branchTarget = null;
          invoke(c);
          checksum = (checksum + ((c.delayPC ?? c.branchTarget ?? c.nextPC) & 0xffff)) >>> 0;
        }
        return checksum;
      }`)(invoke);
      loop(cpu, data, 100_000);
      const milliseconds = [];
      let checksum;
      for (let sample = 0; sample < samples; sample++) {
        const start = performance.now();
        const current = loop(cpu, data, iterations);
        milliseconds.push(performance.now() - start);
        if (checksum !== undefined && current !== checksum) {
          throw new Error(`Unstable checksum for ${name}`);
        }
        checksum = current;
      }
      const sorted = [...milliseconds].sort((a, b) => a - b);
      results.push({ name, mode: compiled ? 'compiled' : 'interpreted', milliseconds,
        medianMs: sorted[Math.floor(sorted.length / 2)], checksum });
    }
  }
  return { iterations, samples, results };
}

if (import.meta.main) {
  console.log(JSON.stringify({ runtime: `Bun ${Bun.version}`, ...await runBranchBenchmarks() }, null, 2));
}
