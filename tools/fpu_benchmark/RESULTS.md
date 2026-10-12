# GoldenEye FPU measurements, 2026-10-12

Retain the guarded MUL.S path: median paired time falls **0.72% in gameplay**
and **0.92% in loading**, with all five primary pairs improving and identical
captured machine state. The fast path covers 84% of GoldenEye multiplies.

Baseline: `6e9fbd8` (current main when the experiment began), not the older
revision sampled in #341. GoldenEye 007 (USA), ROM SHA-256
`2cdcec8a9f0cb6e36337f3ee39d8ad105dc8afa6ba1c02d466e8f5b771f9a162`.
Apple M4, macOS arm64, Node 24.13.1, Playwright 1.58.2, Chromium 145.0.7632.6,
ANGLE Metal. HLE graphics/audio, render scale 1, CRT off. The primary final
pairs explicitly resume WebAudio output. Profiling is disabled for timing.
See [README.md](README.md) for the complete reproduction commands/protocol.

## Operation selection

These counts were collected before implementing the fast path. They cover
loading VI 1659–2399 and stationary rendered Dam gameplay VI 2594–3134.
The diagnostic run's timings are excluded from the comparisons.

| Window | Operation | Calls | Share of binary f32 operations | Normal/normal inputs | Normal inputs and result |
| --- | --- | ---: | ---: | ---: | ---: |
| Loading | MUL.S | 23,487,165 | 50.58% | 83.94% | 83.94% |
| Loading | ADD.S | 11,947,902 | 25.73% | 78.45% | 78.44% |
| Loading | SUB.S | 9,271,540 | 19.97% | 93.23% | 88.71% |
| Loading | DIV.S | 1,728,329 | 3.72% | 97.96% | 97.96% |
| Gameplay | MUL.S | 12,832,369 | 52.81% | 84.01% | 84.01% |
| Gameplay | ADD.S | 5,525,538 | 22.74% | 77.79% | 77.78% |
| Gameplay | SUB.S | 5,317,772 | 21.88% | 94.86% | 89.99% |
| Gameplay | DIV.S | 623,821 | 2.57% | 94.32% | 94.32% |

All observed binary operations used RM=nearest, with only Invalid enabled
(`FCSR & 0xf80 = 0x800`). Non-normal operands were signed zeros; no input NaNs,
infinities or subnormals occurred. MUL.S was chosen because it dominates both
windows and every normal-input product also had a normal rounded result.
Subtraction's cancellation rate is visible in the last two columns.

## Correctness and scope

The optimization covers nearest-rounded MUL.S only. Other rounding modes,
non-normal inputs and non-normal results use the original generic helper.
Two f32 significands multiply exactly within the host f64 significand/range;
rounding the product once to f32 therefore retains the information needed for
inexact status. Status and destination updates happen only after every guard
passes. Enabled inexact traps use the existing exception helper.

Direct differential tests compare all 64 raw register words, FCSR and trap
counts across 1,679,744 cases: class/sign boundaries, 4096 deterministic raw
operand pairs, all four rounding modes, all 32 enable combinations, FS, both
FR mappings and six alias layouts. Explicit cases check preserved upper halves
on traps, sticky/cause/condition handling and separate MUL.S/SUB.S rounding on
cancellation. Compiled tests compare the prototype with the generic interpreter,
including both profiling modes, both FR modes, inexact/overflow/underflow/invalid
traps, delay slots, disabled COP1, dependent instructions, Count and events.

Existing arithmetic limitations are unchanged: generic normal single arithmetic
ignores directed rounding. For example, `(0x3f800001 * 0x3f800001)` with RM=+inf
produces `0x3f800002`, rather than the next float `0x3f800003`. Generic overflow
also ignores directed rounding (`0x7f7fffff * 2`, RM=toward-zero, produces infinity
rather than max finite). These are separate correctness work, not repaired or
hidden by this optimization; non-nearest modes always fall back.

## Chromium microbenchmarks

Five alternating fresh-browser pairs; each cell is the median of the five
per-browser medians, in milliseconds for two million helper calls. Each browser
has 200,000 warmup calls and five measured batches. Setup/checksum costs are
included; microbenchmarks use FR=1. All result/FCSR/trap checksums match. Individual samples are retained
in `results.json`; host JIT tiering remains a source of variation.

| Workload | Baseline | Prototype | Time reduction |
| --- | ---: | ---: | ---: |
| Generated normal operands/results | 33.30 | 24.30 | 27.03% |
| Signed-zero fallback | 40.30 | 46.40 | -15.14% |
| Exception-heavy | 31.00 | 37.00 | -19.35% |
| Captured loading mix | 37.50 | 24.90 | 33.60% |
| Captured gameplay mix | 37.70 | 24.20 | 35.81% |

Fallbacks pay for the failed guards. A helper microbenchmark improvement is not
an equivalent game-speed improvement.

## Initial helper prototype

An initial boolean-returning helper used the same guards, with MUL.S dispatching
the fallback after the helper returned false. Five exploratory alternating pairs
had a median paired gameplay time reduction of only **0.08%** (individual changes
+0.23%, -1.27%, +0.08%, -0.14%, +0.58%). Loading's median paired reduction was
0.27%. A brief background Spotlight indexing burst affected early measurements;
WebAudio output was suspended, though HLE audio emulation remained enabled.
This version was rejected. The final experiment moves the guarded code directly
into MUL.S and explicitly enables WebAudio output for both variants.

## Primary rendered GoldenEye timing pairs

Five sequential fresh-browser pairs, alternating order. Times are milliseconds
for the complete 740-VI loading or 540-VI gameplay window. Positive reductions
mean less elapsed time.

| Pair/order | Load baseline | Load prototype | Reduction | Gameplay baseline | Gameplay prototype | Reduction |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 / B→P | 13317.0 | 13244.4 | 0.55% | 9602.4 | 9487.1 | 1.20% |
| 2 / P→B | 13486.3 | 13320.7 | 1.23% | 9548.0 | 9486.0 | 0.65% |
| 3 / B→P | 13440.4 | 13323.3 | 0.87% | 9603.2 | 9533.8 | 0.72% |
| 4 / P→B | 13471.9 | 13348.5 | 0.92% | 9578.3 | 9499.5 | 0.82% |
| 5 / B→P | 13511.7 | 13373.8 | 1.02% | 9611.8 | 9542.7 | 0.72% |

**Loading:** median paired reduction 0.92% (range 0.55–1.23%). Baseline median 13471.9 ms (18.205 ms/VI), MAD 31.5 ms, range 13317.0–13511.7 ms. Prototype median 13323.3 ms (18.004 ms/VI), MAD 25.2 ms, range 13244.4–13373.8 ms.

**Gameplay:** median paired reduction 0.72% (range 0.65–1.20%). Baseline median 9602.4 ms (17.782 ms/VI), MAD 9.4 ms, range 9548.0–9611.8 ms. Prototype median 9499.5 ms (17.592 ms/VI), MAD 13.5 ms, range 9486.0–9542.7 ms.

Every timing run ended with identical captured CPU/FPU/COP0 registers, PC/delay
PC, Count, RAM, SP memory, RSP scalar/vector/accumulator/control state, device
registers and pending events. Baseline/prototype screenshots are byte-identical.
Generated guest JS is unchanged (28,216,528 bytes at the checkpoint).
The production minified bundle grows by 447 bytes.

The separate prototype diagnostic confirmed 19,715,628 fast-path hits during
loading (83.942% of MUL.S) and 10,780,476 in gameplay (84.010%). Counts and final
state match the pre-implementation diagnostic and uninstrumented timings.

Retain the direct MUL.S fast path: every primary pair improved both loading and
gameplay, while all tested architectural behavior was preserved. This is a small,
workload-specific gain on one host/browser, not a general emulator speedup claim.
The zero/exception microbenchmark regressions remain a cost for other workloads.

Validation: **2,471 tests passed**, including the new differential/compiled
cases; `bun run lint` and `bun run build` passed.
