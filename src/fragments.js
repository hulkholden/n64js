import { dbgGUI } from "./dbg_ui.js";

const debugOptions = {
  enableDynarec: true,
};

const perfFolder = dbgGUI.addFolder('Performance');
perfFolder.add(debugOptions, 'enableDynarec').name('Dynamic Recompilation');

const kHotFragmentThreshold = 500;

/**
 * The fragment map.
 * @type {!Map<number, !Fragment>}
 */
let fragmentMap = new Map();

/**
 * Hit counts keyed by PC.
 * @type {!Map<number, number>}
 */
let hitCounts = new Map();

export class Fragment {
  constructor(pc) {
    this.entryPC          = pc;
    this.minPC            = pc;
    this.maxPC            = pc+4;
    this.func             = undefined;
    this.opsCompiled      = 0;
    this.executionCount   = 0;
    this.bailedOut        = false;    // Set if a fragment bailed out.
    this.nextFragments    = [];       // One slot per op

    // State used when compiling
    this.bodyCode         = '';
    this.needsDelayCheck  = true;

    this.cop1statusKnown = false;
    this.usesCop1        = false;
  }

  invalidate() {
    // reset all but entryPC
    this.minPC            = this.entryPC;
    this.maxPC            = this.entryPC+4;
    this.func             = undefined;
    this.opsCompiled      = 0;
    this.executionCount   = 0;
    this.bailedOut        = false;
    this.nextFragments    = [];

    this.bodyCode         = '';
    this.needsDelayCheck  = true;

    this.cop1statusKnown  = false;
    this.usesCop1         = false;
  }

  updateMinMax(pc) {
    this.minPC = Math.min(this.minPC, pc);
    this.maxPC = Math.max(this.maxPC, pc + 4);
  }

  /**
   * Gets the next fragment and caches the results.
   * @param {number} pc The current pc.
   * @param {number} opsExecuted The number of ops executed.
   * @return {?Fragment}
   */
  getNextFragment(pc, opsExecuted) {
    let nextFragment = this.nextFragments[opsExecuted];
    // TODO: why can this change? Is it due to branches taken/not taken? Should improve cache?
    // if (nextFragment && nextFragment.entryPC !== pc) {
    //   throw 'next fragment has broken entryPC?'
    // }
    if (!nextFragment || nextFragment.entryPC !== pc) {
      // If not jump to self, look up and cache for next time around.
      nextFragment = (pc === this.entryPC) ? this : lookupFragment(pc);
      this.nextFragments[opsExecuted] = nextFragment;
    }
    // Invalidate the fragment if it's not finished being compiled.
    // This is to ensure we only append instructions to fragments being traced.
    if (nextFragment && nextFragment.opsCompiled > 0 && !nextFragment.func) {
      // console.log(`invalidating partially compiled fragment ${toString32(nextFragment.entryPC)} on reentry`)
      nextFragment.invalidate();
    }
    return nextFragment;
  }
}

export function resetFragments() {
  hitCounts = new Map();
  fragmentMap = new Map();
}

/**
 * Returns the fragment map.
 * @return {!Map<number, !Fragment>}
 */
export function getFragmentMap() {
  return fragmentMap;
}

/**
 * Looks up the fragment for the given PC.
 * @param {number} pc
 * @return {?Fragment}
 */
export function lookupFragment(pc) {
  let fragment = fragmentMap.get(pc);
  if (fragment) {
    // If we failed to complete the fragment for any reason, reset it
    if (fragment.opsCompiled > 0 && !fragment.func) {
      // console.log(`fragment ${toString32(fragment.entryPC)} partially compiled ${fragment.opsCompiled} ops, invalidating and starting over`);
      fragment.invalidate();
    }
    return fragment;
  }

  if (!debugOptions.enableDynarec) {
    return null;
  }

  // Check if this pc is hot enough yet
  let hc = hitCounts.get(pc) || 0;
  hc++;
  hitCounts.set(pc, hc);

  if (hc < kHotFragmentThreshold) {
    return null;
  }

  fragment = new Fragment(pc);
  fragmentMap.set(pc, fragment);
  return fragment;
}
