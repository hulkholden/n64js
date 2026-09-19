# F-Zero X stale overlay investigation (#167)

Investigated on `c4aec6e`, Bun 1.3.14, macOS arm64, F-Zero X (USA),
normalized ROM-header CRC `78d90eb3f9c90330`, no input or saved state. The anomalous
window is a correctness failure: an old compiled overlay survives the guest's
instruction-cache flush. It is not evidence for optimizing JR/SW busy loops.

## Reproduction and measurements

The investigation used temporary instrumentation (not included in this change)
with the issue's 120/600/600/600 VI windows, a 5-billion-cycle limit per window,
and 10-million-cycle chunks. It collected generation-specific entry/return
counts, bounded hot-fragment exit samples, thrown-exit counts, next-fragment
cache hit/miss counts, index invalidations, word changes sampled at VI, CPU/FPU
state, and final RAM snapshots and SHA-256 hashes.

Records survived invalidation. `stuffToDo` was sampled before `finishFragment`
advanced events. `off-trace` means a normal short return; `trace-end` means the
full compiled instruction count was returned. Generated source was retained to
check these classifications against the actual return statements. Instrumented
elapsed times were excluded from benchmarks.

To reproduce the execution windows, use the headless runner shown in the timing
protocol below. For interpreter comparisons, use a separate source copy with
`enableDynarec: false` in `src/cpu/fragments.js`. For the graphics/compatibility
comparison, pass `executeGraphics: true, enableCompatibilityHacks: false` to
`createHeadlessEmulator`. No production interpreter setting was changed.

### Transition and caller chain

- VI 0–120: `0x800c2f10` dominates with 27,190,805 executed instructions;
  `0x800687f0` and `0x8006881c` each execute about 20 million instructions.
- VI 236: the per-VI word sample at `0x8011a860` becomes `0x03e00008`
  (`JR ra`). Its following word is `0xafa40000` (`SW a0,0(sp)`).
  The nine-instruction trace trains through caller `0x8011b354` and return
  `0x8011b35c`. Most calls execute all nine instructions; loop completion exits
  after five. There are also a few real `stuffToDo` exits during this period.
- At VI 870 and 875, the guest executes 512 `CACHE 0` operations over
  `0x80000000..0x80003fe0` (observed at `0x800c280c`). RAM at the hot address
  has changed by VI 871 and again by VI 876. The final replacement words are
  `0x305907f0` / `0x57200011`: `ANDI t9,v0,0x7f0; BNEL t9,zero,0x8011a8ac`.
  The old fragment remains compiled on the baseline.
- At VI 1013, the replacement overlay executes `JAL 0x8006a918` at
  `0x8011a858`, followed by NOP. The legitimate link address is `0x8011a860`.
  The callee returns through `0x8006a95c` to that address. Instead of executing
  the new ANDI, the baseline enters its old compiled JR and jumps back to itself.

At the first stale entry, `ra=8011a860`, `sp=800d9480`, `a0=800cd170`,
`s0=802cb328`, `s2=800f5ea0`, `nextPC=8006a970`, `delayPC=null`, and
`stuffToDo=0`. After the two instructions, `pc=nextPC=8011a860` and
`delayPC=null`. The stale SW writes `800cd170` to `800d9480` on every trip;
it is a real erroneous store, not a NOP.

### Exact late-window result (VI 1320–1920)

| Measurement | Baseline | Fixed |
| --- | ---: | ---: |
| Hot fragment compiled length | 9 | 11 (new overlay) |
| Hot fragment calls | 436,187,572 | 1,911 |
| Hot fragment executed instructions | 872,375,144 | 20,850 |
| Two-op self-return to `8011a860` | 436,187,572 | 0 |
| Hot `stuffToDo` / thrown exits | 0 / 0 | 0 / 0 |
| Hot next-fragment cache hits / misses | 436,187,572 / 0 | 1,048 / 863 |
| All compiled instructions | 930,162,367 | 102,910,387 |
| RSP tasks (all types) | 883 | 1,200 |
| Existing idle-loop skipped cycles | 0 | 825,457,280 |

The original count matches the issue exactly. There is no late-window cache
thrashing. The fixed overlay has 19 legitimate two-op exits to `8011a86c`;
its other returns execute 11 instructions and reach several `80117bxx`
destinations. Those small polymorphic-call counts do not justify a cache change
as part of this correctness fix.

## Cause and correction

`execCACHE` treated Index Invalidate I (`op=0`) like Hit Invalidate I (`op=16`).
Its virtual-address range check rejected overlay fragments outside the first
16 KiB, despite the guest intentionally sweeping every hardware cache index.

The VR4300 has a 16 KiB, direct-mapped instruction cache with 32-byte lines;
index invalidation uses the 512 indices independently of the tag. See the
[NEC VR4300 manual, cache organization and CACHE instruction](https://n64dev.org/p/U10504EJ7V0UMJ1.pdf).

The fix discards all compiled fragments registered under the selected
`VA[13:5]` index, across the larger software fragment-bucket array. This is
conservative because n64js does not model hardware I-cache residency. Hit
invalidation retains its existing address-based behavior. Data-cache operations,
JR/SW execution, delay slots, event accounting and idle-loop recognition are
unchanged. Cached successor references see the invalidated fragment object and
cannot execute its old function. On the fixed run, the old generation is
invalidated at VI 870 and later code is compiled from the replacement overlay.

## Interpreter, browser, compatibility and state checks

A rendered Chrome/WebGL run used the real app and local ROM, fresh boot, no
saved state/input, and explicit CPU chunks up to VI 1920. All three variants
reported no fatal error:

| At VI 1920 | Original recompiler | Fixed recompiler | Interpreter |
| --- | --- | --- | --- |
| Visible demo race time | 00'13"22 | 00'17"10 | 00'17"10 |
| Graphics tasks | 1,427 | 1,661 | 1,661 |
| Sampled RA | `8011a860` | `800679f8` | `800679f8` |

VI progress alone concealed the fault. The original still services interrupts
and submits graphics tasks, but the stale loop disrupts demo progress. The
interpreter and fixed recompiler agree on progress and task count, although
their racer/camera states differ. This is not a claim of bit-identical full-game
execution or comprehensive gameplay validation.

Headless runs all finish at VI 1920, PC/nextPC `80000180`, delayPC null,
3,023,622,411 accounted cycles, RSP halted at PC 0, with no fatal error.
Interrupt-check counts are 11,001 original and 11,979 fixed/interpreter.
Final Cause/Status are `10000400/2000ff03` original and
`90000400/0000ff03` fixed/interpreter. The corrected run and interpreter have
identical final GPR arrays and FPU control arrays, but different FPR/RAM bytes.
Full-run state equality is therefore not asserted.

Final RAM SHA-256:

| Mode | SHA-256 |
| --- | --- |
| Original | `0f5325a130e67e6a65915918d91f793ec7821586b73d7ad0044316c5a6158d9a` |
| Fixed | `ac58a26bc6743af475192bd9d480c1a35d859fc7c480d3a119c3d1bf1bc83e1b` |
| Interpreter | `a02904514ef874a30b42483f6e4d5f26d8c0eea1f48721b2361e539cb9126ced` |

The fixed `executeGraphics=true, enableCompatibilityHacks=false` run has the
same RAM hash as the fixed default run. There is no F-Zero instruction patch
in the compatibility table. The separate `ROMD2A1Device` read at `a5000508`
returns `~0` in all these modes, including browser and interpreter; this existing
64DD probe workaround is not controlled by `enableCompatibilityHacks` and was
left in place. Thus these comparisons do not claim operation with that
workaround removed.

## Regression checks

`cache_invalidation.test.js` covers interpreted and generated CACHE operations,
overlay tags sharing an index, unrelated indices, cached successor references,
replacement instruction execution, the original SW's observable effect, branch
likely annulment, delayPC and cycle accounting, hit invalidation and ignored
D-cache operations. The index-invalidating regression fails against the original
implementation and passes with the fix.

Validation: all 751 tests passed with `bun test`; `bun run lint`,
`bun run build`, and `git diff --check` passed. Against the baseline, the
four index/overlay regression cases fail and the two hit/D-cache controls pass.

## Timing protocol

Run uninstrumented fresh processes alternately on baseline and fixed trees,
three pairs, after other emulation runs have stopped. Within each process:

```js
const e = await createHeadlessEmulator(await loadROMFile(rom));
for (const frames of [120, 600, 600, 600]) {
  const start = performance.now();
  runFrames(e, frames, 5_000_000_000, 10_000_000);
  console.log(e.hardware.verticalBlankCount, performance.now() - start);
}
```

The late-window measurements compare different guest behavior and must not be
included in general recompiler optimization speedup claims.

Measured wall time in seconds (Bun profiling disabled):

| Run | VI 0–120 | VI 120–720 | VI 720–1320 | VI 1320–1920 |
| --- | ---: | ---: | ---: | ---: |
| before 1 | 3.864 | 5.238 | 8.294 | 11.137 |
| after 1 | 3.823 | 5.380 | 5.675 | 6.165 |
| before 2 | 3.929 | 5.285 | 8.035 | 11.161 |
| after 2 | 3.826 | 5.350 | 5.586 | 6.342 |
| before 3 | 3.658 | 4.969 | 8.334 | 11.258 |
| after 3 | 3.785 | 5.562 | 5.513 | 6.448 |

The first window is comparable; the next window includes a full-cache sweep
at VI 235 and the fix recompiles code the baseline incorrectly retains. Later
windows include the correctness divergence described above. No general
performance improvement is inferred from these timings.
