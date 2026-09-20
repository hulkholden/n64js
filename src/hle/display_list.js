import { toString32 } from '../format.js';

// A host execution safeguard, not an emulated RSP timing or stack limit.
const defaultCommandLimit = 1_000_000;

/**
 * Runs commands from the current position in an initialized RSPState.
 * The caller configures the microcode's renderer and warning handler. To handle
 * load-ucode commands, loadMicrocode must return a configured replacement using
 * the same state, given (codeAddr, codeSize, codeDataAddr, codeDataSize).
 * Returns a continuation when a self-branch waits for the CPU to patch the list.
 * Disassembly stops at such a wait; bailAfter applies only to normal execution.
 * commandLimit bounds each synchronous run, checked between command batches.
 * Producer waits get a fresh budget on resume so waiting cannot exhaust it.
 */
export function executeDisplayList(state, microcode, {
  loadMicrocode = null,
  disassembler = null,
  bailAfter = -1,
  commandLimit = defaultCommandLimit,
} = {}) {
  // Object-list microcodes have their own record layout and termination rules.
  if (microcode.executeDisplayList) {
    return microcode.executeDisplayList({ disassembler, bailAfter });
  }
  if (!Number.isSafeInteger(commandLimit) || commandLimit < 1) {
    throw new RangeError('Display-list command limit must be a positive safe integer');
  }
  let ucodeTable = microcode.buildCommandTable();

  if (loadMicrocode) {
    microcode.onLoadUcode((codeAddr, codeSize, codeDataAddr, codeDataSize) => {
      const nextMicrocode = loadMicrocode(codeAddr, codeSize, codeDataAddr, codeDataSize);
      ucodeTable = nextMicrocode.buildCommandTable();
      return nextMicrocode;
    });
  } else {
    // A reused microcode must not retain a previous execution's command table.
    microcode.onLoadUcode(null);
  }

  if (disassembler) {
    const startOp = state.currentOp;
    while (state.nextCommand()) {
      checkLimit(startOp);
      const pc = state.pc - 8;
      disassembler.begin(state.cmd0, state.cmd1, state.dlistStack.length);
      ucodeTable[state.cmd0 >>> 24](state.cmd0, state.cmd1, disassembler);
      disassembler.end();
      state.currentOp++;
      if (state.pc === pc) break;
    }
  } else {
    return run();
  }

  function run() {
    const startOp = state.currentOp;
    while (state.nextCommand()) {
      checkLimit(startOp);
      const pc = state.pc - 8;
      const depth = state.dlistStack.length;
      ucodeTable[state.cmd0 >>> 24](state.cmd0, state.cmd1);
      if (state.postOp(bailAfter)) {
        break;
      }
      // Gauntlet Legends builds lists while the RSP consumes them, replacing
      // a self-branch with a no-op once more commands are ready. Keep the live
      // state and command table, but let the CPU run before fetching it again.
      if (state.pc === pc && state.dlistStack.length === depth) return run;
    }
    return null;
  }

  function checkLimit(startOp) {
    if (state.currentOp - startOp >= commandLimit) {
      const error = new Error(`HLE display-list command limit (${commandLimit}) exceeded at ${toString32(state.pc - 8)}; stack depth ${state.dlistStack.length}`);
      error.name = 'DisplayListLimitError';
      throw error;
    }
  }
}
