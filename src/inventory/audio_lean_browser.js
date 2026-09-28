import { benchmarkLeanSamples, verifyLeanSamples } from './audio_lean_measure.js';
import { createMicrocodeHash } from '../hle/audio_microcode_hash.js';

globalThis.runAudioLeanBenchmark = async encoded => {
  const samples = encoded.map(s => ({ ...s, raw: Object.fromEntries(Object.entries(s.raw).map(([k, v]) =>
    [k, Uint8Array.from(atob(v), c => c.charCodeAt(0))])) }));
  const hash = createMicrocodeHash(), bytes = new Uint8Array(4100);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 73 + (i >>> 3)) & 255;
  // Independent browser-native oracle, including every padding boundary and
  // an unaligned view. This is outside the classification benchmark.
  for (let length = 4096; length >= 0; length--) {
    const view = bytes.subarray(3, length + 3);
    const expected = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', view)), n => n.toString(16).padStart(2, '0')).join('');
    if (hash(view) !== expected) throw new Error(`Browser hash mismatch at length ${length}`);
  }
  return { userAgent: navigator.userAgent, hashLengthsChecked: 4097,
    verification: verifyLeanSamples(samples), benchmark: benchmarkLeanSamples(samples) };
};
