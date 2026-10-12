import { CPU1 } from '../../src/cpu/cpu1.js';

// Independent call sites per workload, changing raw input bits and consuming
// destination bits, FCSR and traps. Setup/checksum overhead is included.
export function runMicrobenchmarks(captured = null, iterations = 2_000_000) {
  const fpu = new CPU1({ cpu0: { raiseFPE() { traps++; } } });
  let traps = 0;
  let seed = 0x341;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  const normal = Array.from({ length: 4096 }, () => [
    ((random() & 0x807fffff) | (120 + random() % 15) << 23) >>> 0,
    ((random() & 0x807fffff) | (120 + random() % 15) << 23) >>> 0, 0x800,
  ]);
  const zeros = normal.map(([s, , control], i) => [s, i % 2 ? 0 : 0x80000000, control]);
  const exceptions = [
    [0x00800000, 0x3f000000, 0], [0x7f7fffff, 0x40000000, 0x200],
    [0x7f800001, 0x3f800000, 0], [0x3f800001, 0x3f800001, 0x80],
  ];
  const workloads = { normal, zeros, exceptions };
  if (captured) {
    for (const [name, phase] of Object.entries(captured)) {
      workloads[name] = phase.MUL_S.samples;
    }
  }
  const results = [];
  for (const [name, rows] of Object.entries(workloads)) {
    const data = Uint32Array.from(rows.flat());
    const loop = new Function('f', 'data', 'iterations', `
      let checksum = 0;
      for (let i = 0; i < iterations; i++) {
        const index = (i % ${rows.length}) * 3;
        f.regU32[6] = data[index];
        f.regU32[10] = data[index + 1];
        f.control[31] = data[index + 2];
        f.MUL_S(7, 3, 5);
        checksum = (checksum + f.regU32[14] + f.control[31]) >>> 0;
      }
      return checksum;
    `);
    loop(fpu, data, 200_000);
    const milliseconds = [];
    let checksum;
    for (let sample = 0; sample < 5; sample++) {
      traps = 0;
      // A trap leaves fd unchanged, so seed it identically for every sample.
      fpu.regU32[14] = 0xdeadbeef;
      const start = performance.now();
      const value = loop(fpu, data, iterations);
      milliseconds.push(performance.now() - start);
      const current = [value, traps];
      if (checksum && JSON.stringify(checksum) !== JSON.stringify(current)) {
        throw new Error(`Unstable ${name} checksum`);
      }
      checksum = current;
    }
    results.push({ name, milliseconds, checksum });
  }
  return { iterations, results };
}

if (import.meta.main) {
  const profile = process.argv[2] ? (await Bun.file(process.argv[2]).json())[0].diagnostic : null;
  console.log(JSON.stringify({ runtime: `Bun ${Bun.version}`, ...runMicrobenchmarks(profile) }, null, 2));
}
