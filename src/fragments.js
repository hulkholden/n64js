
const kEnableDynarec = true;
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

/**
 * An array of invalidation events.
 * @type {!Array<{address: number,
 *                length: number,
 *                system: string,
 *                fragmentsRemoved: boolean}>}
 */
let fragmentInvalidationEvents = [];


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
    this.body_code        = '';
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
    this.bailedOut        = false;
    this.executionCount   = 0;
    this.nextFragments    = [];

    this.body_code        = '';
    this.needsDelayCheck  = true;

    this.cop1statusKnown  = false;
    this.usesCop1         = false;
  }

  /**
   * Gets the next fragment and caches the results.
   * @param {number} pc The current pc.
   * @param {number} opsExecuted The number of ops executed.
   * @return {?Fragment}
   */
  getNextFragment(pc, opsExecuted) {
    let nextFragment = this.nextFragments[opsExecuted];
    if (!nextFragment || nextFragment.entryPC !== pc) {
      // If not jump to self, look up
      if (pc === this.entryPC) {
        nextFragment = this;
      } else {
        nextFragment = lookupFragment(pc);
      }

      // And cache for next time around.
      this.nextFragments[opsExecuted] = nextFragment;
    }
    return nextFragment;
  }
}

export function resetFragments() {
  hitCounts = new Map();
  fragmentMap = new Map();
  fragmentInvalidationEvents = [];
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
  if (!fragment) {
    if (!kEnableDynarec) {
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
  }

  // If we failed to complete the fragment for any reason, reset it
  if (!fragment.func) {
    fragment.invalidate();
  }

  return fragment;
}

export function consumeFragmentInvalidationEvents() {
  let t = fragmentInvalidationEvents;
  fragmentInvalidationEvents = [];
  return t;
}
