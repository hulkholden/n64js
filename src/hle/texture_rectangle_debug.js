import { textureRectOptions } from '../options.js';

const maxSamples = 32;
const emptyCounts = () => ({ bindings: 0, candidates: 0, candidateS: 0, candidateT: 0,
  changed: 0, changedS: 0, changedT: 0, samples: [] });
let counts;

export const textureRectDebug = {
  options: textureRectOptions,
  reset() { counts = { baseline: emptyCounts(), clamp: emptyCounts() }; },
  snapshot() { return structuredClone({ maxSamplesPerMode: maxSamples, ...counts }); },
};
textureRectDebug.reset();

// Called only when instrumentation is enabled. Count texture bindings, not
// pixels or distinct rectangles: a two-cycle rectangle can bind two tiles.
export function recordTextureRectBinding(clampEnabled, candidateS, candidateT, details) {
  const mode = counts[clampEnabled ? 'clamp' : 'baseline'];
  mode.bindings++;
  mode.candidateS += Number(candidateS);
  mode.candidateT += Number(candidateT);
  if (!candidateS && !candidateT) return;
  mode.candidates++;
  if (clampEnabled) {
    mode.changed++;
    mode.changedS += Number(candidateS);
    mode.changedT += Number(candidateT);
  }
  if (mode.samples.length < maxSamples) {
    // Keep values as they were at the draw, independent of mutable tile/UV state.
    mode.samples.push(structuredClone({ candidateS, candidateT, ...details }));
  }
}
