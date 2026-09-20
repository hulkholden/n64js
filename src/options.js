
export const kSpeedHackEnabled = true;

export const kAccurateCountUpdating = false;

// Experimental compiler paths are opt-in. Change these before compiling traces
// (reset the emulator when switching); existing fragments retain their code.
export const recompilerOptions = {
  guardedRAMStores: false,
};
