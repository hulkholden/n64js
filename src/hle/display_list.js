/**
 * Runs commands from the current position in an initialized RSPState.
 * The caller configures the microcode's renderer and warning handler. To handle
 * load-ucode commands, loadMicrocode must return a configured replacement using
 * the same state, given (codeAddr, codeSize, codeDataAddr, codeDataSize).
 * Returns a continuation when a self-branch waits for the CPU to patch the list.
 * Disassembly stops at such a wait; bailAfter applies only to normal execution.
 */
export function executeDisplayList(state, microcode, {
  loadMicrocode = null,
  disassembler = null,
  bailAfter = -1,
} = {}) {
  // Object-list microcodes have their own record layout and termination rules.
  if (microcode.executeDisplayList) {
    return microcode.executeDisplayList({ disassembler, bailAfter });
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
    while (state.nextCommand()) {
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
    while (state.nextCommand()) {
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
}
