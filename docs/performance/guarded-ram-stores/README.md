# Guarded RAM store groups (issue #166)

This prototype adds an opt-in path for consecutive integer `SW` instructions.
It remains disabled by default: clean paired headless measurements regress the
primary Turok target and most other windows. F-Zero early improves consistently,
but that restricted result does not establish a general benefit.

## Scope and correctness

The compiler groups 2–16 sequential `SW` instructions with the same base
register and offsets congruent modulo four. An intervening instruction, changed
base register, branch/delay-slot boundary, or group-size limit ends a group.
Fragment entry and dynamic delay slots remain generic. Debug-PC validation and
sync generation disable grouping. Pending groups are discarded when a fragment
is invalidated or tracing restarts.

Before the first store, the group computes the physical address corresponding
to its minimum signed offset:

```js
const ramStoreBase = (c.getRegS32Lo(base) + minOffset + 0x80000000) >>> 0;
const ramStoreDV = c.ramDV;
const span = maxOffset - minOffset + 4;
const ordinaryRAM = (ramStoreBase & 3) === 0 &&
  ramStoreBase + span <= Math.min(ramStoreDV.byteLength, 0x800000);
```

Normalization matches `addrS32`'s low-32-bit address semantics. The addition of
`span` is deliberately **not** truncated to 32 bits. The full interval must fit
both the actual RAM view and the existing 8 MiB cached-RAM mapping. This admits
bases just outside RAM when their offsets bring every access inside, while
rejecting misalignment, wraparound across the interval, or any partially
out-of-range word. The backing RAM view is stable during CPU/RSP execution.

The fast path uses the same big-endian `DataView.setUint32(..., false)` as the
helpers. It reads each value register at its original instruction, including
zero and base/value aliases. It retains every RSP step, interrupt check, PC and
exception-progress update, and existing cycle accounting. No instruction
batching, load reuse, store elision, or FP changes are included. Since `SW`
cannot change its base and RSP execution cannot write CPU GPRs, reusing this
address calculation across the existing RSP steps is safe.

A failed guard enters the original generated helper sequence **before any
store**. It retains MMIO and TLB effects, a successful prefix before a later
fault, and interrupt exits between stores. Ordinary RAM writes retain existing
I-cache behavior: they do not invalidate compiled code until the guest executes
the relevant `CACHE` operation.

This first experiment does not extend the GPR fact table or remove bookkeeping.
Those would need separate evidence and measurements. In particular, the Mario
matrix fragment's FP operations and loads are outside this prototype.

## Reproduction

Baseline: `5395330` (current `master` when this work began). Prototype: `f2076e2`, with `--guarded-ram-stores` enabled. The default is disabled.

```sh
# Baseline: run in a checkout of 5395330.
bun run src/headless/benchmark.js --rom "$ROM" --samples 1 \
  --warmup-frames 120 --frames 600 --json

# Prototype: run in this checkout.
bun run src/headless/benchmark.js --rom "$ROM" --samples 1 \
  --warmup-frames 120 --frames 600 --json --guarded-ram-stores

# Repeat both with --warmup-frames 1320 for the later window.
```

Use five adjacent pairs per title/window, alternating baseline/prototype order
(B/P, P/B, B/P, P/B, B/P). Each command starts a fresh process. Profiling is off
for these timings. Early measures VI 121–720; later measures VI 1321–1920.
Graphics lists are skipped, RSP execution remains enabled, and there are no
saves or controller inputs. These are startup/attract sequences, not verified
rendered gameplay. F-Zero's later window remains an anomalous workload and
should not support a general performance claim.

Runtime: Bun 1.3.14, macOS 26.5.2 (25F84), arm64, Apple M4. An initial timing
attempt overlapped another emulator window and was discarded in full. Only the
subsequent clean run is included below. No tests or profiling ran alongside the
clean timed samples.

For programmatic experiments, set `recompilerOptions.guardedRAMStores` in
`src/options.js` before creating/resetting the emulator. Reset when changing
this option: already compiled fragments retain their generated code.

## Validation

`bun test`, `bun run lint`, and `bun run build` pass (1,447 tests).

New tests cover negative offsets, 32-bit wraparound, signed-address boundaries,
full access widths, reduced RAM views, cached mapping limits, endianness,
base/value aliases, intervening base changes/loads, overlapping stores, partial
TLB faults, RAM-end fallback, MMIO start/stop and interrupt ordering, active RSP
interrupt exits, pending CPU events, breakpoints, sync generation, invalidation,
and executable-memory/cache behavior. Compiled-versus-interpreted tests compare
CPU/FPU registers, relevant RAM and device state, RSP state, exception state,
Count, and Compare timing, with profiling both on and off.

## Clean paired timings

The clean timing batch took 1,293 seconds (21 minutes 33 seconds) including
startup and warmup. Every pair matched the harness's final GPR/PC fingerprint,
executed cycles, and VI count. [All 120 samples](measurements.json) retain elapsed
seconds, rates, cycles, fingerprints, pairing order, and source hashes.

Rates below are median VI/s ± median absolute deviation (MAD), not confidence
intervals. “Median ratio” compares the two aggregate medians; “paired median”
takes the median of the five within-pair percentage changes. Those can differ
when sample variation is large. Individual changes are in chronological pair
order, with positive meaning faster.

| Title | Window | Baseline VI/s ± MAD | Prototype VI/s ± MAD | Median ratio | Paired median | Individual paired changes (%) |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| turok | early | 165.46 ± 2.91 | 155.33 ± 3.00 | -6.12% | -6.12% | -7.79, -3.01, -8.39, -6.12, -1.81 |
| turok | later | 185.67 ± 3.38 | 182.34 ± 1.09 | -1.79% | -3.44% | -5.41, -4.73, -0.43, -3.00, -3.44 |
| mario | early | 115.59 ± 2.91 | 115.00 ± 1.69 | -0.51% | -2.15% | -2.15, -2.91, +0.07, -1.56, -2.38 |
| mario | later | 82.98 ± 0.77 | 81.60 ± 0.89 | -1.66% | -1.66% | -0.92, -4.22, -1.66, -0.90, -1.66 |
| zelda | early | 112.08 ± 3.94 | 111.10 ± 2.32 | -0.88% | -2.21% | +0.70, -2.21, -4.51, -0.63, -4.26 |
| zelda | later | 88.53 ± 2.99 | 85.29 ± 1.24 | -3.66% | -5.06% | -5.06, -8.02, +7.05, -8.81, -1.45 |
| diddy | early | 175.95 ± 0.11 | 169.35 ± 2.63 | -3.75% | -3.15% | -1.49, -1.44, -7.64, -3.69, -3.15 |
| diddy | later | 111.96 ± 1.83 | 111.06 ± 1.65 | -0.80% | -2.04% | -2.04, -0.72, -0.71, -5.25, -2.39 |
| goldeneye | early | 152.27 ± 4.83 | 154.98 ± 2.13 | +1.78% | -3.28% | +3.79, -5.86, +5.12, -3.28, -3.29 |
| goldeneye | later | 106.53 ± 0.84 | 104.51 ± 1.63 | -1.90% | -1.59% | +0.73, -1.59, -5.69, -4.05, -0.42 |
| fzero | early | 160.45 ± 1.18 | 165.96 ± 0.57 | +3.43% | +3.12% | +3.06, +3.12, +4.77, +1.72, +3.15 |
| fzero | later | 136.07 ± 6.60 | 142.72 ± 3.78 | +4.89% | +2.11% | -0.49, +10.24, -1.23, +2.11, +5.41 |

Title keys: Turok: Dinosaur Hunter (USA, v1.0); Super Mario 64 (USA);
The Legend of Zelda: Ocarina of Time (USA, Rev 1); Diddy Kong Racing (USA, Rev 1);
GoldenEye 007 (USA); F-Zero X (USA). Canonical ROM hashes and header IDs are
recorded with the diagnostics below.

The decision is to **leave the prototype disabled by default**. Ten of the
eleven non-anomalous title/window combinations have negative median paired
changes. F-Zero early improves consistently (+3.12% paired median), but that
restricted headless result does not outweigh the other regressions. F-Zero later
is reported for completeness and excluded from the general conclusion. No
browser-engine or verified rendered-gameplay performance claim is made; the
F-Zero observation would need those follow-ups before enabling this generally.

## Generated-code example

The original Turok target, `0x800afae4`, still compiles to a 35-instruction trace.
It contains a 10-store stack-save group and another four-store group. Its source
is 11,004 bytes before and 16,252 bytes after (+47.7%). Complete, uninstrumented
Function-constructor inputs are retained as [before](turok-before.js.txt) and
[after](turok-after.js.txt).

For the first stack-save group, the helper calls:

```js
c.execSW(31, 29, 84); // ra -> sp+0x54
// original inter-instruction bookkeeping and RSP step
c.execSW(30, 29, 80); // s8 -> sp+0x50
// ...through s0 -> sp+0x30
```

become the following on the guarded branch (bookkeeping omitted here only for
readability; the complete capture retains it):

```js
const ramStoreBase = (c.getRegS32Lo(29) + 48 + 0x80000000) >>> 0;
const ramStoreDV = c.ramDV;
if ((ramStoreBase & 3) === 0 && ramStoreBase + 40 <= Math.min(ramStoreDV.byteLength, 0x800000)) {
  ramStoreDV.setUint32(ramStoreBase + 36, c.getRegS32Lo(31), false);
  // original inter-instruction bookkeeping and RSP step
  ramStoreDV.setUint32(ramStoreBase + 32, c.getRegS32Lo(30), false);
  // ...through offset 0, s0
} else {
  // original generated helper sequence, including all exits and RSP steps
}
```

Both groups in that fragment were reached 55,704 times in the early window and
55,707 times in the later window; every guard hit. These are actual guard-entry
counts, not calls multiplied by a fragment's compiled length.

## Diagnostic methodology

Diagnostics are separate fresh processes, using phases 120 warmup / 600 measured
/ 600 unmeasured / 600 measured. They enable the existing CPU/RSP counters and
instrument actual group-guard evaluations. Captures retain original generated
source before instrumentation and preserve records across fragment invalidation.
For each measured phase, captured fragment counts are checked against the
emulator's compilation counter.

`prepare.py` copies the selected checkout into a temporary directory and adds a
timer around tracing/code generation plus an explicit hook at the Function
constructor. `capture.mjs` measures construction of the **original** generated
source, then separately constructs an instrumented copy for guard counting.
Recorder/rewriting/extra-construction time is subtracted from the tracing timer.
“Trace + construction” is inclusive of Function construction. These are one-run
diagnostic host timings, not statistically established compilation-speed changes;
they exclude later optimizing-JIT work. Source bytes are cumulative emitted
JavaScript, not resident memory or machine-code size.

Diagnostic runs set the CPU Random source to the repository's `createRandom(166)`
for repeatable state comparisons. Timed runs retain the existing harness's normal
host-backed Random source. In unseeded diagnostics, GoldenEye showed small RAM,
CP0, and instruction-count differences despite matching GPR/PC fingerprints;
its timing variation should therefore be interpreted cautiously.

To reproduce a capture, install dependencies in the chosen checkout, then run:

```sh
PROFILE_ROOT=$(python3 docs/performance/guarded-ram-stores/prepare.py "$CHECKOUT")
bun docs/performance/guarded-ram-stores/capture.mjs \
  "$PROFILE_ROOT" "$ROM" "$OUTPUT_DIR" --seed=166
# Add --guarded-ram-stores for the prototype capture.
```

The scratch directory is printed explicitly and can be removed after inspection.
Neither script modifies the supplied checkout. The instrumentation is deliberately
specific to this compiler revision and fails if its expected hook points change.

## Guard hit rates and compilation cost

All observed group guards in these measured windows hit (100%). This is the
hit rate among emitted guard evaluations, not the fraction of memory operations
optimized. Counts below come from the seeded diagnostic run; F-Zero later is
still the anomalous window described above.

| Title | Early hits / attempts | Later hits / attempts |
| --- | ---: | ---: |
| turok | 1,297,889 / 1,297,889 | 1,308,044 / 1,308,044 |
| mario | 1,177,770 / 1,177,770 | 1,767,374 / 1,767,374 |
| zelda | 585,044 / 585,044 | 1,002,319 / 1,002,319 |
| diddy | 470,277 / 470,277 | 794,623 / 794,623 |
| goldeneye | 475,908 / 475,908 | 1,344,548 / 1,344,548 |
| fzero | 4,897,421 / 4,897,421 | 381,819 / 381,819 |

Cumulative totals through VI 1920, including warmup and the unmeasured advance:

| Title | Fragments constructed (both) | Source MiB, baseline → prototype | Trace + construction ms, B → P | Function construction ms, B → P |
| --- | ---: | ---: | ---: | ---: |
| turok | 1,654 | 9.51 → 10.06 (+5.84%) | 284.6 → 289.9 | 67.1 → 69.1 |
| mario | 1,709 | 9.95 → 10.52 (+5.67%) | 255.0 → 268.6 | 59.7 → 62.2 |
| zelda | 3,235 | 16.41 → 17.68 (+7.71%) | 405.2 → 393.0 | 87.8 → 91.4 |
| diddy | 1,643 | 9.17 → 9.64 (+5.17%) | 253.8 → 255.4 | 61.0 → 61.7 |
| goldeneye | 4,794 | 23.31 → 24.86 (+6.65%) | 421.9 → 468.4 | 70.8 → 79.0 |
| fzero | 2,262 | 12.78 → 13.53 (+5.87%) | 333.7 → 320.3 | 71.4 → 69.6 |

Every seeded baseline/prototype comparison matched at VI 720 and VI 1920 in
CPU GPRs, HI/LO, CP0, FPU registers/FCSR, all 8 MiB of RAM, RSP scalar/vector/
accumulator state, SP memory, sampled device-register banks, and event deadlines.
The CPU/RSP profiling counters also matched exactly. GoldenEye was additionally
checked with seed 167: both variants matched under each seed, while changing the
seed changed baseline RAM. This confirms the earlier unseeded mismatch was
nondeterminism rather than a demonstrated store-group regression.

[Diagnostic results](diagnostics.json) retain per-window counters, full-state
hashes, cumulative and window-only generation costs, and the busiest groups.
The positive guard rates show that failed-guard overhead does not explain these
slowdowns. Source growth is established, but its role in runtime regressions is
an inference; this experiment does not isolate JIT or code-cache effects. A
separate experiment could reduce duplicated bookkeeping/code before attempting
loads, constant propagation, or instruction batching.

Mario's 68-instruction `0x80196570` matrix fragment is byte-for-byte unchanged
(SHA-256 `7d6a0ab50f24d9c23550b769e2890d238e77c6cb17cf2de6fca1a9a7fd38f87a`).
No load reuse or FP fusion was introduced.

Canonical big-endian ROM identities (hashes taken after byte-order conversion):

| Title | Header CRC ID | SHA-256 |
| --- | --- | --- |
| turok | `0df1702fff87415c` | `4111045ae8e05da883037906dc9f693d8e6f55ad6b3a0c43a9472c632486e082` |
| mario | `ff2b5a632623028b` | `17ce077343c6133f8c9f2d6d6d9a4ab62c8cd2aa57c40aea1f490b4c8bb21d91` |
| zelda | `1fa83dd4191e1e02` | `fb87a0dac188f9292c679da7ac6f772acebe6f68e27293cfc281fc8636008db0` |
| diddy | `0d4302e49dfcfcd2` | `7de1a8fb2a9558cfc3d9ad4497df698c1e89cf7095ac1531557df2af40ba8bcf` |
| goldeneye | `d150bcdca31afd09` | `2cdcec8a9f0cb6e36337f3ee39d8ad105dc8afa6ba1c02d466e8f5b771f9a162` |
| fzero | `78d90eb3f9c90330` | `2be0f861c30752bbdfa727753a454108bc973c27ad814744f191b1278c1f482d` |
