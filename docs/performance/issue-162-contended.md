# Issue 162: original series with concurrent tests

**Superseded by the [rerun report](issue-162.md).** The user confirmed another test series overlapped these measurements. Retained for audit; use the rerun for current comparisons.

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

Baseline and variant source trees were exported into separate temporary directories;
the combined generator was byte-compared with the working tree. Timed subprocesses
were launched sequentially. Preliminary measurements that overlapped this task's
tests were discarded. Another Codex task was observed running CPU benchmarks on
the same machine, so background contention is a limitation. Variation and individual
paired changes are reported rather than treating small differences as established
wins. Browser-engine and verified-gameplay confirmation have not been performed;
these measurements do not establish a general gameplay speedup.

## Results

Median VI/s ± median absolute deviation (MAD). MAD is a variation measure, not a confidence interval. Each row has five samples per side. The change column compares medians; the last column compares each adjacent pair, in collection order.

| ROM | Window (VI) | Variant | Baseline VI/s ± MAD | Prototype VI/s ± MAD | Median change | Paired changes (%) |
| --- | --- | --- | ---: | ---: | ---: | --- |
| Mario | 120–720 | Immediates | 94.13 ± 4.21 | 95.71 ± 4.85 | +1.68% | +2.80, -5.63, +1.68, -2.71, +5.06 |
| Mario | 120–720 | Moves | 95.47 ± 2.65 | 95.65 ± 2.99 | +0.19% | +4.36, +0.19, +0.77, +19.80, -7.22 |
| Mario | 120–720 | Combined | 86.88 ± 4.02 | 84.94 ± 8.41 | -2.24% | -2.00, -1.59, -2.24, +6.98, +4.22 |
| Mario | 1320–1920 | Immediates | 60.89 ± 1.57 | 60.83 ± 1.37 | -0.11% | -2.07, -0.37, +2.55, -2.35, +3.04 |
| Mario | 1320–1920 | Moves | 64.00 ± 0.36 | 64.50 ± 0.66 | +0.79% | +1.82, -0.89, -0.34, +3.50, +2.43 |
| Mario | 1320–1920 | Combined | 66.01 ± 0.13 | 68.13 ± 1.47 | +3.21% | +3.97, +4.54, +3.01, +3.82, +7.62 |
| GoldenEye | 120–720 | Immediates | 150.86 ± 1.60 | 152.62 ± 4.99 | +1.16% | +6.18, +6.17, -0.27, -2.34, +1.06 |
| GoldenEye | 120–720 | Moves | 148.16 ± 3.61 | 154.40 ± 1.36 | +4.21% | +2.99, -0.88, +6.03, +7.42, +7.97 |
| GoldenEye | 120–720 | Combined | 147.76 ± 6.72 | 151.17 ± 1.73 | +2.31% | -2.18, +8.54, +4.24, +9.48, +0.63 |
| GoldenEye | 1320–1920 | Immediates | 103.46 ± 4.65 | 107.52 ± 1.90 | +3.92% | +2.20, +1.43, -2.31, +35.17, +24.86 |
| GoldenEye | 1320–1920 | Moves | 104.23 ± 0.54 | 106.26 ± 1.93 | +1.95% | +0.12, +8.02, -0.17, +5.23, +3.79 |
| GoldenEye | 1320–1920 | Combined | 103.35 ± 1.18 | 110.67 ± 0.23 | +7.07% | +6.85, +8.53, +7.30, +3.21, +8.55 |

All 120 invocations completed. Total fresh-process wall time including warmups: 26.6 minutes. Every timed sample executed 600 retraces; cycles and the harness GPR/PC fingerprint agreed across all variants and repeats within each ROM/window.

[Raw paired samples](issue-162-contended-pairs.jsonl) include per-run elapsed time, VI/s, cycles, fingerprint, runtime and the SHA-256 of the generator actually used. The reproduction runner emits the same format.


## Interpretation

Immediate-only code generation shows no clear benefit in Mario: +1.68% early
with mixed pairs and -0.11% later. Moves are also small in Mario (+0.19% and
+0.79%). GoldenEye's move-only medians are more positive (+4.21% early, +1.95%
later), although its pairs remain variable. The +3.92% later immediate-only
median includes paired outliers of +35.17% and +24.86%; these are retained, not
filtered out.

The strongest consistent signal is the combined patch in the later windows:
+3.21% for Mario and +7.07% for GoldenEye, with all five pairs positive in each.
The combined early-window results are mixed (-2.24% Mario, +2.31% GoldenEye).
Independent-family changes must not be added together: the groups have separate
paired baselines and there is visible drift even in the unchanged baseline.
These results support further controlled measurements of this small prototype.
Quiet-machine, browser-engine and verified-gameplay repetition are still needed
before making a broad performance claim; the follow-up instruction families
should remain independent experiments.
