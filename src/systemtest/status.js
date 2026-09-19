// Keep these string values stable: they are written to JSON results and reports.
export const RunStatus = Object.freeze({
  RUNNING: 'running',
  COMPLETE: 'complete',
  STORM: 'storm',
  EMPTY: 'empty',
  ERROR: 'error',
  TIMEOUT: 'timeout',
});
