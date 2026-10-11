# Active-RSP idle executor (#165)

Independent prototype B, based on `19c9550516e3b86c24b40ceef17d847e4470c58a`.
The halted-prefix experiment in #346 is not included.

Recommendation: keep this as an experimental draft. Rendered GoldenEye gameplay
has a **−0.95% median paired throughput change**, with identical saved state in
all ten runs. The six Bun headless windows have positive median changes ranging
from +0.11% to +6.54%. Batching removes 81% of dispatches in GoldenEye’s early
headless window, but only 0.84% in rendered gameplay, where the eligible loop
accounts for just 0.138% of compiled CPU instructions. See [results/RESULTS.md](results/RESULTS.md) for all individual
browser/headless timing pairs and [results/DIAGNOSTICS.md](results/DIAGNOSTICS.md)
for dispatch, instruction, compilation and source-size measurements.

## Execution contract

The compiler specializes only an existing two-instruction trace whose first
instruction is a NOP delay slot and whose second instruction is an unconditional
self branch: `BEQ rs,rs,-1` or `J` to the branch's own address. Entry requires an
active RSP, no pending CPU work, and the expected incoming delay target. The
original generated body handles other entries. Conditional branches, non-NOP
delay slots, sync-flow tracing and accurate-count codegen retain normal execution.

The shared executor calls the existing RSP step before each CPU instruction. An
RSP interrupt stops it before that CPU instruction. It preserves the original
trace's synchronization points: charge the NOP after the second RSP step, before
the branch helper, then charge the completed branch. PC/delay phase is updated
at the same instruction boundaries. It exits when RSP halts, CPU work becomes
pending, an event fires during cycle synchronization, or fewer than two cycles remain until
the next event. Normal dispatch then handles interrupts, interpretation near a
deadline, cache revalidation and any changed PC. No CPU cycles or RSP instructions
are skipped by batching. If RSP halts during the pair, the existing halted
speedhack still runs at its original branch point.

No entry-time deadline is cached across iterations: RSP MMIO can create an earlier
DMA deadline. The test suite separately reproduces an existing compiled timing
discrepancy: starting an 8-byte DMA in the first RSP step and reading its busy bit
in the second sees 1 in both compiled paths, versus 0 in the interpreter. The
original trace steps RSP twice before charging its initial NOP. This prototype
preserves that ordering and does not fix #174. This case is explicitly excluded
from claims of interpreter equality; it is not hidden by compiled-only checks.

`compiledOps` remains the actual returned instruction count; `fragmentRuns`
counts physical dispatches. `activeRSPIdleBatches` and `activeRSPIdleOps` expose
batch coverage. Speedhack attempt/rejection counters still count each completed
branch. The successor cache is bounded by trace length even when a batch returns
thousands of operations. Existing instruction recording and I-cache validation
protect specialized code exactly as they protect the retained ordinary body.

## Reproduction

Use Bun 1.3.14 and the pinned Playwright 1.58.2 Chromium. Export the baseline into
a separate directory and install/link dependencies. Run measurements sequentially
on an otherwise idle host, without tests, builds or profiling running alongside.

```sh
node tools/rsp_idle/paired.mjs "$BASELINE" "$PROTOTYPE" /tmp/idle-headless.json \
  '/Volumes/Data/Roms/Super Mario 64 (USA).v64' \
  '/Volumes/Data/Roms/Diddy Kong Racing (USA) (En,Fr) (Rev 1).z64' \
  '/Volumes/Data/Roms/GoldenEye 007 (USA).z64'
node tools/rsp_idle/summarize.mjs /tmp/idle-headless.json
```

Five alternating adjacent pairs per game/window, fresh Bun process per sample:
120 or 1320 warmup VIs, followed by 600 measured VIs. This uses the stock headless
benchmark, with RSP execution and default HLE audio enabled, graphics lists
skipped. These are startup/attract windows, not verified gameplay.

Build both checkouts using `bun run build`, then run rendered GoldenEye:

```sh
node tools/rsp_idle/browser.mjs "$BASELINE" "$PROTOTYPE" \
  '/Volumes/Data/Roms/GoldenEye 007 (USA).z64' /tmp/idle-browser 5
```

Fresh Chromium contexts, HLE graphics/audio, render scale 1, CRT off, no concurrent
RAF. The issue's seeded random source and input protocol drive Dam gameplay.
Loading VIs 1660–2399 and stationary gameplay VIs 2595–3134 are timed separately.
The first pair saves screenshots. Every replay saves CPU/FPU/COP0, RSP, full RAM,
device and event fingerprints. The harness checks reproducibility per variant
and fails on any cross-variant state difference.

Append `1 diagnostic` instead of `5` for a separate instrumented replay. It counts
actual returned instruction totals, RSP steps/instructions, batch calls/operations,
compilations and generated source bytes, and retains hot generated bodies. Those
wall times are not throughput evidence. Source bytes are cumulative generated
JavaScript, not resident host machine code. RSP instruction counts do not measure
host execution time.

For headless diagnostic counters, add `--profile` to the stock benchmark command.
Do not mix these timings with the uninstrumented pairs.

## Validation

`src/cpu/recompiler_rsp_idle.test.js` compares the specialized and retained
original compiled bodies with the interpreter, in both profiling modes. Coverage
includes both loop phases, short RunForCycles budgets, event callbacks observing
state, RSP BREAK with/without interrupts, halted/restarted RSP, CPU SP status
writes including SSTEP, PC changes, code invalidation (including a newly scheduled DMA completing inside
the same pair), conditional branches,
non-NOP delay slots, delay-slot faults, Compare deadlines, pending interrupts,
and RSP-created DMA deadlines. SSTEP coverage preserves the emulator’s current
behavior; it does not add hardware single-step support.

Validation: `bun test` (2,259 pass, including 78 targeted cases), `bun run lint`,
and `bun run build`. The two profiled/unprofiled DMA-discrepancy cases explicitly
record the existing interpreter difference; the other 76 cases require equality.

For reproducible headless diagnostic pairs and reports:

```sh
node tools/rsp_idle/diagnostic_pairs.mjs "$BASELINE" "$PROTOTYPE" /tmp/idle-results
node tools/rsp_idle/report.mjs tools/rsp_idle/results
node tools/rsp_idle/report_diagnostics.mjs tools/rsp_idle/results
```
