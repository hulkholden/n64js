# Issue 162: first 32-bit-word code-generation prototype

Baseline: `c4aec6e62072d9d9a367c277bee1cc53503caa84` (current master when this work started).
Runtime: Bun 1.3.14, macOS arm64. Date: 2026-09-19.

This patch changes only compiled ANDI/ORI/XORI and OR encodings of register
moves/clears. It leaves the interpreter unchanged as a differential oracle.
General two-input AND/OR/XOR/NOR, BEQ/BNE and SLT/SLTU remain follow-up experiments;
no register-width assumptions, register allocator or FP arithmetic changes are included.

## Generated code

Examples, excluding the unchanged instruction/RSP/timing boilerplate:

| Guest operation | Before | After |
| --- | --- | --- |
| `ANDI r9,r8,240` | `c.execANDI(9, 8, 240);` | `c.setRegU32Extend(9, c.getRegU32Lo(8) & 240);` |
| `ORI r2,r1,65535` | `c.execORI(2, 1, 65535);` | `c.setRegS64LoHi(2, c.getRegS32Lo(1) \| 65535, c.gprS32[3]);` |
| `XORI r2,r1,65535` | `c.execXORI(2, 1, 65535);` | `c.setRegS64LoHi(2, c.getRegS32Lo(1) ^ 65535, c.gprS32[3]);` |
| `OR r5,r11,r0` | `c.execMOV(5, 11);` | `c.setRegS64LoHi(5, c.getRegS32Lo(11), c.gprS32[23]);` |
| `OR r5,r0,r0` | `c.execCLEAR(5);` | `c.setRegS64LoHi(5, 0, 0);` |
| `OR r5,r5,r0` | `c.execMOV(5, 5);` | No register write. |

OR also recognizes moves with the zero source in the other operand. Writes to
register zero emit no register work. All cases retain the normal instruction
boilerplate, including RSP steps, PC/delay-slot handling and guest operation counts.
ANDI clears the high word; ORI/XORI preserve it. Function arguments read both source
words before either destination word is written, so aliasing is safe.

[Retained generated functions](issue-162-generated.txt) contain matching changed
hot fragments from Mario and GoldenEye, before and after. They were collected
separately from timing runs at VI 1920. Call counts refer to surviving fragment
objects, not a complete instruction profile across invalidations.

## Correctness

- `bun test`: 1,113 pass, 0 fail across 53 files.
- `bun run lint` and `bun run build`: pass.
- Added compiled/interpreted differential cases with profiling both off and on:
  mixed high/low signs, all-ones high words, zero sources/destinations,
  destination/source aliasing, self-copies, zero and 0xffff immediates, taken delay
  slots, a delay-slot memory fault, and active RSP execution with an event callback.
- Differential snapshots compare GPRs, PC/delay PC, exception registers, FPU
  registers/control, relevant RAM, Count/Compare timing, and RSP registers/DMEM.
- Separate full-ROM checks use the original phased sequence of 120/600/600/600 VI
  retraces. Baseline and combined snapshots match at VI 720, 1320 and 1920 for both
  ROMs: all RAM, CPU GPRs/control/HI/LO, FPU registers/control, SP memory, RSP scalar,
  vector and accumulator state, flags, PCs, cycles, and pending event countdowns.
  [Snapshot hashes and timing state](issue-162-state.json) are retained.
- GoldenEye initially differed in control registers and RAM with the default
  nondeterministic CPU Random-register source. Repeating its correctness runs with
  a fixed LCG seed (1; multiplier 1664525; increment 1013904223; unsigned 32-bit)
  gave identical snapshots. Timed runs use the unchanged benchmark harness and its
  default random source.

## Timing method

USA Super Mario 64 (original release, ROM ID `ff2b5a632623028b`) and USA GoldenEye
007 (original release, ROM ID `d150bcdca31afd09`). No saves or controller input;
headless boot/startup/attract execution, graphics display lists skipped, RSP enabled.
These are not verified rendered gameplay workloads.

The [reproduction runner](../../tools/benchmark_word_codegen.py) creates all four
source trees and performs the full sequence (120 fresh-process measurements for
these two ROMs):

```sh
bun install --frozen-lockfile
python3 tools/benchmark_word_codegen.py \
  --rom "$MARIO_ROM" --rom "$GOLDENEYE_ROM" --output /tmp/word-codegen.jsonl
```

Each row uses five adjacent baseline/prototype pairs, in alternating order:
B/P, P/B, B/P, P/B, B/P. Each invocation starts a fresh Bun process and emulator,
with one measured sample, no profiling instrumentation, and the existing harness:

```sh
bun run src/headless/benchmark.js --rom "$ROM" --samples 1 \
  --warmup-frames 120 --frames 600 --json
bun run src/headless/benchmark.js --rom "$ROM" --samples 1 \
  --warmup-frames 1320 --frames 600 --json
```

The early window ends at VI 720; the late window ends at VI 1920. The later timing
window starts fresh with 1320 warmup retraces rather than using the phased
correctness run. Three separate variants are compared to the same baseline:

- **Immediates:** replace only the functions from `generateANDI` through the new
  `generateLogicalImmediate` helper, before `generateLUI`.
- **Moves:** replace only `generateOR`, before `generateXOR`.
- **Combined:** the full production patch.

The rerun used the checked-in reproduction runner with all source variants in
separate temporary directories. The runner now explicitly links each export to
the checkout's installed dependencies; git archives do not include node_modules.
This fixes standalone execution outside a temporary directory with shared packages
and does not change the emulator or generated code. Initial dependency-resolution
failures produced no timed samples and are excluded.

Timed subprocesses ran sequentially, with no builds or tests launched by this task
during measurement. Process snapshots before and periodically during the rerun
found no competing test/benchmark workers; the existing Bun test server was idle.
This is a normal desktop session,
not proof that all other sources of system load were absent. Browser-engine and
verified-gameplay confirmation have not been performed.

## Results: rerun after the concurrent tests stopped

Median VI/s ± median absolute deviation (MAD). MAD measures variation, not a confidence interval. Each row has five samples per side. The change column compares medians; the last column compares each adjacent pair in collection order.

| ROM | Window (VI) | Variant | Baseline VI/s ± MAD | Prototype VI/s ± MAD | Median change | Paired changes (%) |
| --- | --- | --- | ---: | ---: | ---: | --- |
| Mario | 120–720 | Immediates | 106.76 ± 1.52 | 109.32 ± 1.71 | +2.40% | +2.41, +3.94, +0.79, +2.55, +2.48 |
| Mario | 120–720 | Moves | 104.39 ± 1.24 | 107.16 ± 0.62 | +2.65% | +0.58, +9.02, +4.35, +2.95, +2.60 |
| Mario | 120–720 | Combined | 104.62 ± 0.44 | 109.49 ± 0.38 | +4.65% | +2.69, +5.93, +5.08, +4.65, +4.95 |
| Mario | 1320–1920 | Immediates | 70.47 ± 0.73 | 71.52 ± 0.24 | +1.49% | +1.38, +3.12, +3.12, +0.45, +1.28 |
| Mario | 1320–1920 | Moves | 71.20 ± 0.22 | 72.67 ± 0.11 | +2.07% | +2.41, +1.41, +1.75, +2.29, +1.92 |
| Mario | 1320–1920 | Combined | 71.35 ± 0.26 | 73.72 ± 0.36 | +3.32% | +3.01, +4.21, +3.22, +3.80, -5.58 |
| GoldenEye | 120–720 | Immediates | 145.90 ± 1.96 | 149.04 ± 1.46 | +2.15% | -1.50, +2.26, +0.67, +4.55, -4.25 |
| GoldenEye | 120–720 | Moves | 146.60 ± 2.67 | 149.63 ± 3.15 | +2.06% | +2.88, +0.05, +8.37, +2.06, -0.74 |
| GoldenEye | 120–720 | Combined | 148.77 ± 2.44 | 152.75 ± 0.24 | +2.68% | +6.85, +5.23, +1.02, +5.57, +2.51 |
| GoldenEye | 1320–1920 | Immediates | 109.50 ± 1.29 | 114.72 ± 1.43 | +4.77% | +3.33, +5.21, -0.18, +8.15, +2.24 |
| GoldenEye | 1320–1920 | Moves | 110.55 ± 0.90 | 112.90 ± 0.31 | +2.13% | +3.00, +1.85, +4.50, +1.30, +1.02 |
| GoldenEye | 1320–1920 | Combined | 107.99 ± 1.75 | 115.24 ± 2.46 | +6.71% | -2.04, +4.43, +5.01, +11.36, +12.38 |

All 120 invocations completed, taking 24.1 minutes of fresh-process wall time including warmups. Every timed sample executed 600 retraces. Cycles and the harness GPR/PC fingerprint agree across all variants/repeats and with the earlier series within each ROM/window.

[Raw rerun samples](issue-162-pairs.jsonl) record the generator SHA-256, baseline revision, runtime, process and measured elapsed time, cycles, VI/s and fingerprint. Baseline revision, runtime and all four generator hashes match the original series exactly.

## Comparison with the original series

The user confirmed another test series overlapped the original measurements. The [superseded report](issue-162-contended.md) and [original raw samples](issue-162-contended-pairs.jsonl) are preserved. They are not pooled with the rerun. Combined-patch comparisons:

| ROM | Window (VI) | Original median change | Rerun median change |
| --- | --- | ---: | ---: |
| Mario | 120–720 | -2.24% | +4.65% |
| Mario | 1320–1920 | +3.21% | +3.32% |
| GoldenEye | 120–720 | +2.31% | +2.68% |
| GoldenEye | 1320–1920 | +7.07% | +6.71% |

## Interpretation

The rerun supports a positive combined result in all four measured windows:
+4.65% / +3.32% for Mario and +2.68% / +6.71% for GoldenEye. Eighteen of the twenty
combined pairs are positive. The largest change from the original interpretation
is Mario's early window: its previously negative median is now positive, with
all five pairs positive. The other three combined median changes are close to
the original estimates.

Both independent families now have positive medians in every window. Mario's
immediate-only and move-only pairs are all positive. GoldenEye's independent
families still include some negative pairs, especially in its early window.
The original later-immediate outliers of +24.86% and +35.17% did not recur.

Residual variation remains: the combined later Mario group includes a -5.58%
pair, and combined later GoldenEye ranges from -2.04% to +12.38%. These are retained
in the table and raw data. Five pairs and periodic process checks do not establish
an absence of all system-load effects. These results provide stronger support for
this prototype in the measured Bun headless workloads; browser and verified
rendered-gameplay repetition are still needed before making a broad performance
claim. Independent-family medians should not be added together, and the follow-up
instruction families remain separate experiments.
