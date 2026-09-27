// Shared by Bun and the browser benchmark. Loading, decoding, correctness
// comparisons, classifier construction and warmup are outside timed regions.
import { createAudioMicrocodeClassifier } from '../hle/audio_microcode_classifier.js';
import { audioMicrocodeManifest } from '../hle/audio_microcode_manifest.js';

export const leanStrategies = [
  { name: 'uncached', options: { cache: false } },
  { name: 'cached', options: {} },
];
export const leanFactories = () => leanStrategies.map(s => ({ name: s.name, create: () => createAudioMicrocodeClassifier(undefined, s.options) }));
export const sameResult = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Check loaded samples and the two original positive examples. Mutation tests
 * warm the cache, change a byte in place, then restore it before the next case.
 */
export function verifyLeanSamples(samples) {
  const results = [];
  for (const strategy of leanStrategies) {
    const classify = createAudioMicrocodeClassifier(undefined, strategy.options);
    let mutations = 0, tails = 0;
    for (const sample of samples) {
      if (!sameResult(classify(sample.raw), sample.expected)) throw new Error(`Sample mismatch: ${strategy.name} ${sample.imageId}`);
      if (!['Mario USA', 'Tetrisphere USA'].includes(sample.example)) continue;
      const raw = Object.fromEntries(Object.entries(sample.raw).map(([k, v]) => [k, v.slice()]));
      const program = audioMicrocodeManifest.programs.find(p => p.id === sample.expected.identity);
      const boot = audioMicrocodeManifest.bootstraps.find(b => b.id === sample.expected.bootstrap);
      const ranges = [['imem', boot.bytes], ['code', program.codeBytes], ['data', program.dataBytes]];
      for (const [field, size] of ranges) {
        for (let p = 0; p < size; p++) {
          raw[field][p] ^= 0x80;
          if (classify(raw).status !== 'unknown') throw new Error(`Accepted mutation: ${strategy.name} ${field}:${p}`);
          raw[field][p] ^= 0x80;
          if (!sameResult(classify(raw), sample.expected)) throw new Error('Restored identity mismatch');
          mutations++;
        }
      }
      for (const [field, size] of ranges) raw[field].fill(0xa5, size);
      if (!sameResult(classify(raw), sample.expected)) throw new Error('Excluded tail affected identity');
      tails++;
    }
    results.push({ strategy: strategy.name, samples: samples.length, mutations, tails });
  }
  return results;
}

export function benchmarkLeanSamples(samples, factories = leanFactories(), { rounds = 7, targetMs = 30 } = {}) {
  // Four successive captured tasks per ROM, expanded into 64-call blocks. This
  // preserves local repetition but is a controlled workload, not a game profile.
  const byRun = new Map();
  for (const sample of samples) {
    if (!byRun.has(sample.run)) byRun.set(sample.run, []);
    if (byRun.get(sample.run).length < 4) byRun.get(sample.run).push(sample.raw);
  }
  const blocks = [...byRun.values()].flatMap(raws => Array.from({ length: 64 }, (_, i) => raws[i % raws.length]));
  const shuffled = samples.map(s => s.raw);
  let seed = 0x12345678;
  for (let i = shuffled.length - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = seed % (i + 1); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const workloads = [{ name: 'rom-blocks', raws: blocks }, { name: 'shuffled-images', raws: shuffled }];
  for (const example of ['Mario USA', 'Tetrisphere USA']) {
    const sample = samples.find(s => s.example === example);
    if (sample) workloads.push({ name: example, raws: [sample.raw] });
  }
  const results = [];
  let checksum = 0;
  for (const { name, raws } of workloads) {
    if (!raws.length) continue;
    const states = factories.map(f => ({ name: f.name, classify: f.create(), us: [] }));
    const pass = (classify, repetitions) => {
      let sink = 0;
      for (let n = 0; n < repetitions; n++) for (const raw of raws) {
        const result = classify(raw);
        sink += result.status.length + (result.identity?.length ?? 0);
      }
      checksum = (checksum + sink) >>> 0;
    };
    for (const state of states) {
      pass(state.classify, 1);
      const start = performance.now(); pass(state.classify, 1);
      state.repetitions = Math.max(1, Math.min(100000, Math.ceil(targetMs / Math.max(performance.now() - start, 0.001))));
    }
    // Rotate strategy order between rounds to reduce order/thermal bias.
    for (let round = 0; round < rounds; round++) for (let i = 0; i < states.length; i++) {
      const state = states[(round + i) % states.length];
      const start = performance.now(); pass(state.classify, state.repetitions);
      state.us.push((performance.now() - start) * 1000 / (raws.length * state.repetitions));
    }
    results.push({ workload: name, callsPerPass: raws.length, strategies: states.map(s => {
      const sorted = [...s.us].sort((a, b) => a - b);
      return { strategy: s.name, repetitions: s.repetitions, microsecondsPerCall: s.us,
        median: sorted[Math.floor(sorted.length / 2)], min: sorted[0], max: sorted.at(-1) };
    }) });
  }
  return { rounds, targetMs, checksum, results };
}
