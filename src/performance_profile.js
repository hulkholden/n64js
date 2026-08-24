const counterNames = [
  'interpretedOps',
  'compiledOps',
  'fragmentRuns',
  'fragmentCompilations',
  'fragmentInvalidations',
  'speedHackAttempts',
  'speedHackRSPActive',
  'speedHackNonNopDelay',
  'speedHackActivations',
  'speedHackSkippedCycles',
  'rspInstructions',
  'rspTasks',
];

function emptyCounters() {
  return Object.fromEntries(counterNames.map(name => [name, 0]));
}

export const performanceProfile = {
  enabled: false,
  counters: emptyCounters(),
};

export function setPerformanceProfiling(enabled) {
  performanceProfile.enabled = enabled;
  performanceProfile.counters = emptyCounters();
}

export function getPerformanceProfile() {
  return { ...performanceProfile.counters };
}

export function performanceProfileDelta(start) {
  const end = performanceProfile.counters;
  return Object.fromEntries(counterNames.map(name => [name, end[name] - start[name]]));
}
