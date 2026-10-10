import { addOptionsFolder } from "../debug/dbg_ui.js";
import { performanceProfile } from '../debug/performance_profile.js';

const debugOptions = {
  enableDynarec: true,
};

addOptionsFolder('Performance', folder => {
  folder.add(debugOptions, 'enableDynarec').name('Dynamic Recompilation');
});

const kHotFragmentThreshold = 500;
const kInstructionCacheLines = 512;

export class Fragment {
  constructor(pc, fragmentCache) {
    this.fragmentCache    = fragmentCache;
    this.entryPC          = pc;
    this.generation       = 0;
    this.minPC            = pc;
    this.maxPC            = pc+4;
    this.func             = undefined;
    this.cachedFunc       = undefined;
    this.instructionPCs   = [];
    this.instructionWords = [];
    this.cacheBuckets     = new Set();
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

  invalidate(preserveCompiled = false) {
    // Remove all memberships together: a full I-cache sweep should visit a
    // trace only once, even if it spans several lines or repeats instructions.
    for (const bucket of this.cacheBuckets) {
      bucket.delete(this);
    }
    this.cacheBuckets.clear();
    this.generation++;
    if (performanceProfile.enabled) {
      performanceProfile.counters.fragmentInvalidations++;
    }
    if (preserveCompiled && this.func) {
      // Do not inspect RAM here. The guest may invalidate before writing new
      // code. Keep one candidate, inaccessible to execution until revalidated.
      this.cachedFunc = this.func;
      this.func = undefined;
      return;
    }
    // reset all but entryPC
    this.minPC            = this.entryPC;
    this.maxPC            = this.entryPC+4;
    this.func             = undefined;
    this.cachedFunc       = undefined;
    this.instructionPCs   = [];
    this.instructionWords = [];
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

  recordInstruction(pc, instruction) {
    this.updateMinMax(pc);
    this.instructionPCs.push(pc);
    this.instructionWords.push(instruction >>> 0);
    this.trackInstruction(pc);
  }

  trackInstruction(pc) {
    const bucket = this.fragmentCache.cacheLineBucket(pc);
    bucket.add(this);
    this.cacheBuckets.add(bucket);
  }

  trackInstructions() {
    for (const pc of this.instructionPCs) {
      this.trackInstruction(pc);
    }
  }

  reuse() {
    this.func = this.cachedFunc;
    this.cachedFunc = undefined;
    this.trackInstructions();
    if (performanceProfile.enabled) {
      performanceProfile.counters.fragmentReuses++;
    }
  }

  getCode() {
    if (this.cachedFunc) {
      return `// Awaiting instruction validation before reuse.\n${this.cachedFunc.toString()}`;
    }
    return this.func?.toString() ?? this.bodyCode;
  }

  /**
   * Gets the next fragment and caches the results.
   * @param {number} pc The current pc.
   * @param {number} opsExecuted The number of ops executed.
   * @return {?Fragment}
   */
  getNextFragment(pc, opsExecuted) {
    // An idle executor can complete many loop iterations in one dispatch.
    // Bound the successor cache by trace length, not by the event countdown.
    const exitIndex = Math.min(opsExecuted, this.opsCompiled);
    let nextFragment = this.nextFragments[exitIndex];
    // TODO: why can this change? Is it due to branches taken/not taken? Should improve cache?
    // if (nextFragment && nextFragment.entryPC !== pc) {
    //   throw 'next fragment has broken entryPC?'
    // }
    if (!nextFragment || nextFragment.entryPC !== pc) {
      // If not jump to self, look up and cache for next time around.
      nextFragment = (pc === this.entryPC) ? this : this.fragmentCache.lookupFragment(pc);
      this.nextFragments[exitIndex] = nextFragment;
    }
    // Invalidate the fragment if it's not finished being compiled.
    // This is to ensure we only append instructions to fragments being traced.
    if (nextFragment && nextFragment.opsCompiled > 0 && !nextFragment.func && !nextFragment.cachedFunc) {
      // console.log(`invalidating partially compiled fragment ${toString32(nextFragment.entryPC)} on reentry`)
      nextFragment.invalidate();
    }
    return nextFragment;
  }
}

/** Owns the CPU fragment cache for one Hardware instance. */
export class FragmentCache {
  constructor() {
    this.reset();
  }

  reset() {
    this.hitCounts = new Map();
    this.fragments = new Map();
    this.cacheLineBuckets = Array.from({ length: kInstructionCacheLines }, () => new Set());
  }

  cacheLineBucket(address) {
    return this.cacheLineBuckets[(address >>> 5) & (kInstructionCacheLines - 1)];
  }

  // Index Invalidate uses VA[13:5], regardless of tag. Keep those 512 buckets
  // directly instead of scanning 32 larger-address-space buckets per CACHE.
  invalidateIndex(address) {
    for (const fragment of this.cacheLineBucket(address)) {
      fragment.invalidate(true);
    }
  }

  invalidateEntry(address) {
    const line = address >>> 5;
    for (const fragment of this.cacheLineBucket(address)) {
      // Traces can branch between nonadjacent lines; min/max alone includes
      // holes. Match an actual instruction line, not another tag at this index.
      if (fragment.instructionPCs.some(pc => (pc >>> 5) === line)) {
        fragment.invalidate(true);
      }
    }
  }

  /**
   * Looks up the fragment for the given PC.
   * @param {number} pc
   * @return {?Fragment}
   */
  lookupFragment(pc) {
    let fragment = this.fragments.get(pc);
    if (fragment) {
      // If we failed to complete the fragment for any reason, reset it.
      if (fragment.opsCompiled > 0 && !fragment.func && !fragment.cachedFunc) {
        fragment.invalidate();
      }
      return fragment;
    }

    if (!debugOptions.enableDynarec) {
      return null;
    }

    // Check if this pc is hot enough yet.
    const hits = (this.hitCounts.get(pc) || 0) + 1;
    this.hitCounts.set(pc, hits);
    if (hits < kHotFragmentThreshold) {
      return null;
    }

    fragment = new Fragment(pc, this);
    this.fragments.set(pc, fragment);
    return fragment;
  }
}
