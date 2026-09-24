# RAM store group overhead investigation

Follow-up to the [initial prototype report](README.md), 22 September 2026.
The original emitter is `f2076e2`; buffer reuse is `779e2cd`; the compact emitter
is `0d570ca`.

Buffer reuse reduces compiler allocations, but does not recover the throughput
loss. Sharing the generated bookkeeping does recover some performance and is
included in the final opt-in path. GC pause logs do not support temporary group
objects as the dominant cause. The host-JIT observations instead point toward
generated-code layout and optimization/tier-up behavior. The path stays disabled
by default: it still generally trails ordinary helpers in Turok and Zelda.

## Where the allocations happen

`RAMStoreGroup` is compiler scratch state. It is populated while tracing guest
instructions and flushed when a group or fragment ends. The compiled JavaScript
does not reference this object. A cached fragment can execute millions of times
without constructing another group.

The original compiler allocates a group object and its `stores` array for every
candidate, including isolated stores that never become optimized groups. It
allocates a record and formats an extra helper string for each candidate store,
then creates two temporary arrays with `map()` to calculate each emitted group's
minimum and maximum offset. It also allocates generated strings through slicing,
replacement and concatenation. Buffer reuse removes the record/array churn and
avoids formatting helper strings for isolated stores; string emission remains.

The production compiler already reuses one `FragmentContext`. It now owns one
`RAMStoreGroup`, with three fixed buffers (144 bytes of numeric storage, plus
object/buffer headers). Reset changes only the live-entry count. The first new
store overwrites the base, bounds and source position; later stores update the
bounds incrementally. No generated strings are retained in the scratch buffers.
The compiler also reuses its existing sync-flow lookup instead of querying twice
per instruction when grouping is enabled.

Counts through VI 1,920, with the same ROMs and CPU Random seed 166 as the
diagnostic comparisons:

| Title | Candidate groups | Candidate stores | Emitted groups | Original object/array allocations removed |
| --- | ---: | ---: | ---: | ---: |
| Turok | 1,708 | 2,708 | 477 | 7,078 |
| Zelda | 2,957 | 5,348 | 1,005 | 13,272 |
| F-Zero | 1,797 | 3,277 | 548 | 7,967 |

The last column is `2 × candidates + stores + 2 × emitted groups`. It counts
explicit group objects, arrays, records and offset-map arrays, not strings,
engine-internal allocations or bytes reclaimed by GC. The replacement buffers
are allocated once per compiler context. Roughly two thirds of candidates are
singletons, making deferred helper formatting useful even when few groups emit.

Turok's later window builds only 175 candidates containing 247 stores and emits
41 new groups, while compiled groups execute 1,308,044 times. The corresponding
early counts are 767 candidates, 1,296 stores, 230 emitted groups and 1,297,889
executions. Compiler allocation is therefore a different cost from the repeated
guard and store work in the generated function.

## Separating compiler and execution costs

All 7,151 fragments compiled across these three titles have byte-for-byte
identical source before and after pooling. Fragment counts, emulation profiling
counters and full CPU/FPU/RAM/RSP/device/event state also match. This makes the
pooled variant a comparison of compiler work with the same emitted code.

The original emitted path still does the following at runtime:

- Calculate a normalized base, read the RAM view and check alignment and the
  complete span against its length and the cached mapping.
- Perform a `DataView.setUint32` for each store. The JavaScript engine still owns
  the safety checks for those accesses; the explicit group guard does not itself
  disable DataView bounds checks.
- Preserve each instruction's RSP step, PC/next-PC/exception accounting and
  interrupt checks.

The ordinary `execSW` helper is already a small cached-RAM fast path: address
calculation, alignment and a signed range comparison, followed by the same
DataView store. Grouping replaces inexpensive checks while introducing guard
setup and a larger generated function. Most static groups contain two stores,
so a large guard hit count alone does not establish a useful saving.

The original layout duplicates the instruction and inter-instruction code in
its fast and fallback branches. A separate scratch variant computes the guard
once, shares that bookkeeping and branches only around each store helper.
Both layouts preserve the original helper sequence on guard failure. The compact
layout was tested in a scratch checkout, then committed after the comparisons
below. The final source tree matches the measured compact variant exactly.

| Generated source | Original/pooled | Compact | Reduction |
| --- | ---: | ---: | ---: |
| Turok target `0x800afae4` | 16,252 bytes | 12,860 bytes | 20.9% |
| Turok, all fragments | 10,553,734 bytes | 10,233,174 bytes | 3.0% |
| Zelda, all fragments | 18,536,429 bytes | 17,788,437 bytes | 4.0% |
| F-Zero, all fragments | 14,188,548 bytes | 13,734,473 bytes | 3.2% |

The [complete compact Turok source](turok-compact.js.txt) can be compared with the
original report's before/after files.

The compact layout passes the 774 targeted boundary, fault, cache and timing
tests and matches full-state and profiling counters in the three diagnostic
titles. Smaller source is established; its effect on the host JIT and throughput
is examined below.

## Isolated game comparisons

Sixty accepted fresh-process runs produced 120 measured windows. Each title has
five alternating blocks: off/original/pooled/compact, then reverse order, and so
on. Two Zelda blocks and one F-Zero block were discarded and repeated after
browser CPU activity was detected. The accepted batch, including those retries,
took 1,272 seconds. No tests or profiling ran alongside it.

These are VI-throughput changes, not rendered frame rates. Each cell is the
median of the five within-block percentage changes; positive is faster.
"Off" is the original prototype with grouping disabled, which emits ordinary
helpers. It is not a newly updated master checkout.

| Title | Window | Original vs off | Pooled vs original | Compact vs pooled | Compact vs original | Compact vs off |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Turok | early | -3.28% | -0.46% | +1.90% | +1.43% | -1.78% |
| Turok | later | -2.42% | -0.09% | +2.48% | +2.39% | -0.09% |
| Zelda | early | -3.33% | -1.30% | +2.49% | +1.06% | -1.66% |
| Zelda | later | -1.73% | -1.13% | +1.67% | +0.69% | -1.34% |
| F-Zero | early | +2.03% | +0.25% | +0.08% | +0.12% | +2.37% |
| F-Zero | later* | -3.16% | +0.38% | +1.70% | +1.56% | -1.77% |

\* F-Zero's later window retains the original report's anomalous-workload caveat
and is excluded from the general performance conclusion. These remain headless
startup/attract sequences with graphics lists skipped, no saves or input, and
the RSP enabled. They are not verified browser gameplay. The new seeded phase
sequence also differs from the original timing series: each later window follows
an early window in the same process. Do not combine the two series statistically.

The compact-versus-pooled change is positive in all five Turok and Zelda blocks
in both windows. F-Zero early is effectively flat (three positive, two negative).
Pooling alone has no consistent game-level benefit, despite its cheaper builder.
The compact layout recovers part of the loss without justifying default enablement.

Variability remains material. For example, the first Turok "off" early sample
was 147.46 VI/s, versus 169.30–173.02 in the other four. It is retained, not
discarded after inspecting its timing. [Raw samples and summaries](overhead-measurements.json)
include every accepted rate, within-block change, median/MAD, state hash, source
tree hash and the process records that caused the three rejected blocks.

## Isolated replays

Five alternating original/pooled pairs replay each captured candidate corpus in
fresh processes. Values below are the median milliseconds per complete corpus:

| Title | Record, original | Record, pooled | Record + emit, original | Record + emit, pooled |
| --- | ---: | ---: | ---: | ---: |
| Turok | 0.0434 | 0.0122 | 0.5589 | 0.4888 |
| Zelda | 0.0805 | 0.0207 | 1.1251 | 0.9860 |
| F-Zero | 0.0508 | 0.0142 | 0.6780 | 0.5940 |

Recording costs fall 72–74%; recording plus emission falls about 12%. The
remaining string operations dominate this component. These are warm replays
(20 warmup passes, then 1,000 recording or 100 emission passes), not estimates
of total emulator compilation time. They exclude disassembly, other instruction
generation, native Function construction and host optimization of the fragments.
They do not directly attribute GC pauses.

The separate execution replay constructs the function once, warms it for
100,000 calls and times five million calls. Five alternating blocks produce the
following median nanoseconds per store burst:

| Stores | Ordinary helpers | Original grouped | Compact grouped |
| --- | ---: | ---: | ---: |
| 2 | 3.848 | 3.162 | 3.293 |
| 4 | 5.082 | 4.095 | 4.097 |
| 10 | 8.927 | 6.940 | 6.970 |
| 16 | 13.130 | 10.049 | 10.195 |

RAM hashes, final PC and completed-operation checksums match. Group recording
does not execute in the timed loop. These results establish that the grouped
memory path can help in a favorable, small function with a stopped RSP. Host
optimization can simplify this synthetic loop; these are not per-instruction
costs in a real game. They do not reproduce the regressions in full emulator
traces or justify attributing those regressions solely to the guard arithmetic.

Raw [replay samples](overhead-replays.json) and
[allocation/source/state diagnostics](overhead-diagnostics.json) retain the
underlying counts, identities and measurements.

## GC and host-JIT diagnostics

Separate runs enable `BUN_JSC_logGC=1` and
`BUN_JSC_reportTotalCompileTimes=1`, using `jit-overhead.mjs`. The GC parser sums
the `p=…ms` pause records before an explicit end marker; it does not confuse
them with the collector's longer cycle-duration records. JIT time comes from
[`bun:jsc.totalCompileTime`](https://bun.com/reference/bun/jsc/totalCompileTime).
The pause/cycle distinction is visible in
[JavaScriptCore's collector logging](https://github.com/WebKit/WebKit/blob/main/Source/JavaScriptCore/heap/Heap.cpp).
No forced GC or altered optimization thresholds are used. Instrumented rates
are excluded from throughput results.

These are single diagnostics per title/variant, covering startup through the
final state snapshot. They are not estimates with confidence intervals.

| Title | Variant | Collections | Sum of GC pauses | Aggregate JIT compilation | Live fragments with zero DFG counter |
| --- | --- | ---: | ---: | ---: | ---: |
| Turok | off | 48 | 130.8 ms | 8,548 ms | 416 |
| Turok | original | 47 | 130.8 ms | 8,076 ms | 456 |
| Turok | pooled | 47 | 128.7 ms | 8,274 ms | 456 |
| Turok | compact | 48 | 136.8 ms | 8,337 ms | 425 |
| Zelda | off | 29 | 139.1 ms | 11,165 ms | 710 |
| Zelda | original | 28 | 145.7 ms | 10,982 ms | 777 |
| Zelda | pooled | 29 | 156.5 ms | 11,198 ms | 778 |
| Zelda | compact | 29 | 144.9 ms | 11,185 ms | 719 |
| F-Zero | off | 117 | 178.4 ms | 7,803 ms | 259 |
| F-Zero | original | 118 | 185.7 ms | 7,449 ms | 302 |
| F-Zero | pooled | 118 | 189.5 ms | 7,511 ms | 302 |
| F-Zero | compact | 117 | 184.5 ms | 7,803 ms | 265 |

Pooling does not systematically reduce GC pause totals. The original layout
also spends less aggregate time compiling host code than "off", so these data
do not support "more JIT compilation time" as the explanation either. These
totals cover all JavaScript tiers and the whole run; they are not a decomposition
of the measured windows' elapsed time.

The stronger clue is which fragments have a nonzero optimizing-JIT counter at
the end. Compared with "off", the original layout loses that observation in
40 Turok, 67 Zelda and 43 F-Zero fragments; 36, 65 and 39 respectively contain
store groups. Compact restores nonzero counters in 31, 58 and 37 of those.
The counts come from [`numberOfDFGCompiles`](https://bun.com/reference/bun/jsc)
on the still-live fragment functions. They are end-of-run observations, not proof
that a function can never optimize. A few unchanged functions differ too.

This supports code-size/profile/tier-up effects as an explanation for some of
the overhead: the microbenchmark's tiny, fully warmed functions benefit, while
real traces retain more lower-tier code with duplicated bookkeeping. It does
not identify a particular JSC cutoff or inlining decision. Pooling preserves
the emitted functions and largely preserves this JIT pattern; changing their
layout improves both the pattern and throughput.

[Native diagnostic data](overhead-native.json) include individual pause and
cycle records, total counters, state identities and the affected fragment PCs.
One Zelda pooled diagnostic was repeated after browser contention. All four
variants matched state, cycles and the live fragment PC/instruction-count map
for each title.

## Validation and measurement controls

The committed buffer-reuse change passes 1,448 tests, lint and build, including a
new regression test that fills the buffers, flushes them, changes bases and
offset ranges, abandons a singleton and reuses a context across fragments. It
checks that buffer identity survives and old entries never leak into new code.

An initial timing attempt overlapped a separate ROM-inventory task and was
discarded. Allocation/source/state diagnostics were retained, but their timing
fields are excluded. Subsequent throughput measurements wait for the other task
to finish and run serially, without concurrent tests or profiling. Read-only
process sampling rejects a block if another busy Bun, Node or Chrome-renderer
process appears.

The scripts alongside this report separate three experiments:

- `prepare-overhead.py`, `measure-overhead.mjs` and `run-overhead.py` freeze the
  variants and run five alternating blocks of off/original/pooled/compact. Each
  fresh process uses CPU Random seed 166 and measures VI 121–720 and 1321–1920;
  the later window follows the early window in that same process. Full-state
  hashes and executed cycles must match across every sample.
- `prepare.py`, `capture-overhead.mjs` and `capture.mjs` collect candidate counts,
  source hashes and state/counter comparisons. These instrumented runs are not
  throughput samples. The original variant also writes a candidate-group corpus
  locally for replay; it is not checked into the repository.
- `replay-groups.mjs` measures recording alone or recording plus string emission
  over that corpus, excluding emulation and Function construction.
  `replay-stores.mjs` separately compiles a synthetic store burst once and times
  its execution using the real CPU/RAM helpers with the RSP stopped. Its timed
  loop performs no group construction, and is not a gameplay benchmark.
- `jit-overhead.mjs` adds the separate host diagnostics described above. Capture
  stderr to retain GC logs; discard everything after `RAM_STORE_DIAGNOSTICS_END`
  when summing pauses. The JSON output deliberately omits instrumented rates.

Example preparation (install dependencies in the pooled checkout first):

```sh
python3 docs/performance/guarded-ram-stores/prepare-overhead.py /path/to/f2076e2 /path/to/779e2cd /tmp/ram-store-overhead
python3 docs/performance/guarded-ram-stores/run-overhead.py /tmp/ram-store-overhead /path/to/roms
```
