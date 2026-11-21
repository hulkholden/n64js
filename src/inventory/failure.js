// Failure evidence is separate from a derived signature: retain the original
// stack (including paths/lines) so later classifiers can regroup saved reports.
export function captureFailure(kind, error, emulator) {
  const failure = { version: 1, kind };
  if (kind === 'exception') {
    // Some emulator paths throw strings. Do not invent an Error or stack for
    // those, and do not send arbitrary error objects over worker IPC.
    failure.exception = {
      name: typeof error?.name === 'string' ? error.name : null,
      message: String(error?.message ?? error),
      stack: typeof error?.stack === 'string' ? error.stack : null,
    };
  }
  if (emulator) {
    const { cpu0, hardware } = emulator;
    // Capture numeric state synchronously at the halt, before CPU.run cleans
    // up. These are emulator cursors, not a reconstructed faulting instruction.
    failure.context = {
      cpu: { pc: cpu0.pc >>> 0, nextPC: cpu0.nextPC >>> 0, delayPC: cpu0.delayPC >>> 0 },
      rsp: { pc: hardware.rsp.pc, halted: hardware.rsp.halted },
    };
  }
  return failure;
}
