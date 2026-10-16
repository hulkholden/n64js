# Resident Evil 2 inventory workload

Investigation of [#381](https://github.com/hulkholden/n64js/issues/381),
16 October 2026. The comparison base is current main
`c091085ce7981de614b82e644c5e3f6b19fcb696`, not the October 11 scan revision.
Host: Apple M4, 10 cores, 32 GiB RAM, macOS 26.5.2 arm64, Bun 1.3.14.
Every timing run was sequential under an exclusive advisory `/tmp/perf.lock`;
no tests, builds, or other resource-heavy work from this investigation ran
alongside measurements.

## Revalidation

All nine original cases already complete on current main. Fresh emulator/save
state, HLE graphics with the null renderer, default HLE audio,
random-controller v1 / mulberry32, seeds 1–3, 1,800 VIs, five billion cycles,
and the original 60,000 ms timeout. The native inventory report does not
serialize audio mode; HLE was verified in the source at this revision.

| ROM | Seed 1 seconds | Seed 2 seconds | Seed 3 seconds | Cycles at VI 1,800 (all seeds) |
| --- | ---: | ---: | ---: | ---: |
| Biohazard 2 Japan | 31.723 | 31.333 | 31.900 | 2,875,770,773 |
| Resident Evil 2 Europe | 36.083 | 37.629 | 37.479 | 3,438,602,353 |
| Resident Evil 2 USA Rev 1 | 32.112 | 31.665 | 31.810 | 2,877,516,426 |

These wall times include the inventory CLI process and startup. They establish
completion under the documented profile, not the cause of the historical
change. No controlled historical-revision comparison or attribution to a
particular earlier optimization was performed.

Canonical SHA-256 hashes of byte-order-normalized big-endian ROM bytes:

| ROM | SHA-256 |
| --- | --- |
| Japan | `f64a3c4a3873cf145e577ee710366fd638bb8d03f6f01549f81e04df738fd425` |
| Europe | `52093e994c89848b17c8e6f26546d66374cf47c9b471ec15da7f322b7ee17ab8` |
| USA Rev 1 | `71f3f779613bf1f0e2050bfa600425385d2c257a647d2e40f63be1a7986e9aac` |

## Limiting workload

A separate Japan seed-2 run used the performance counters and Bun's 1 ms CPU
sampler. At VI 1,800 it recorded:

- 2,871,134,651 compiled CPU instructions and 4,636,122 interpreted instructions.
- 1,394,798,914 fragment calls.
- 1,387,751,559 idle-skip attempts: 1,381,599,680 rejected for a non-NOP delay
  slot and 6,151,879 rejected because the RSP was active. None skipped time.
- 12,682,646 RSP instructions, all attributed to audio task type 2 by tracking
  the task type at RSP unhalt and instruction-count deltas at halt/checkpoints.
- 895 audio tasks and two HLE graphics tasks; no RSP video/JPEG task starts.

The hot fragment begins at `0x800005ac`, the delay slot of the unconditional
self-branch at `0x800005a8`. Its delay instruction is `DADDIU a0,a0,1`.
That increment must execute on every iteration; treating it as NOP and skipping
emulated cycles would be incorrect.

In the instrumented host profile, `speedHack` accounted for 45.9% of inclusive
sample time. Its repeated internal memory read was wasted work: the recorded
delay-slot instruction already proves the shortcut will reject the loop.
Profiling overhead is included in that observation; it is not a timing sample
for the speedup table below.

Audio is identified by the existing `descriptor-synth-re2` hash and falls back
to LLE even when HLE is requested. Separate explicit-HLE and explicit-LLE
seed-2 runs took 32.358 and 32.454 seconds and matched RAM hashes, cycle counts,
CPU/RSP PCs, and task counts at each 300-VI checkpoint. Audio mode is therefore
not a workload difference in these samples. Startup through emulator creation
took about 0.06 seconds, and graphics task counts stayed at two.

A separate unmodified-main HLE run reached 3,000 VIs in 52.501 seconds and
4,750,650,773 cycles, with 1,495 audio tasks and still two graphics tasks.

## Optimization

For a self-targeting J, BEQ, or BNE, omit the runtime idle-skip call only when
a non-NOP instruction at the delay-slot PC is already recorded in the same
trace. The existing trace instruction tracking supplies cache invalidation
and revalidation; no speculative read or ROM-specific rule is added.
Unobserved and NOP delay slots retain the runtime check.

Retain the existing cycle synchronization and fragment bailout. Active RSP
instructions can schedule events during execution, so turning this trace into
a longer multi-iteration fragment would change scheduling. Every guest
instruction, including the delay-slot increment, still executes.

## Controlled measurements

Fresh process/emulator per sample; explicit HLE audio, HLE/null graphics,
seed 2 with the same random-controller policy and independent CPU random
stream, 1,800 VIs, five billion cycles, counters and sampler disabled. The
headless driver calls `cpu0.run(10_000_000)` until the VI target, records
snapshots every 300 VIs, and uses an event-queue cycle budget. Timings include
ROM load, canonical hashing, startup, compilation, and checkpoint RAM hashing;
module import precedes the timer. This driver omits the inventory IPC and
texture collectors, so its timings are reported separately from the inventory.

Japan used three adjacent base/patch pairs, alternating pair order:
base/patch, patch/base, base/patch. Europe and USA each used one base/patch
control pair. No warm emulator state was reused between samples.

| Region | Base seconds | Patched seconds | Reduction |
| --- | --- | --- | ---: |
| Japan | 32.165, 32.318, 32.437 | 14.450, 14.544, 14.600 | 55.0% |
| Europe | 37.935 | 16.928 | 55.4% |
| USA | 32.480 | 14.567 | 55.2% |

Japan median ± median absolute deviation: **32.318 ± 0.119 seconds** before,
**14.544 ± 0.056 seconds** after (2.22× throughput). The single European and
USA pairs are controls, not variance estimates.

All six checkpoints in every paired run matched the complete RDRAM SHA-256,
event-queue cycles, CPU/RSP PCs, and audio/graphics task counts.

## Validation

All nine patched inventory cases completed at VI 1,800 with the same cycle
counts as main. Wall times were 14.556–14.683 seconds for Japan,
16.989–17.039 seconds for Europe, and 14.560–14.581 seconds for USA.

The full suite passed: 2,584 tests, zero failures. Lint and the production build
also passed. Focused coverage includes J/BEQ/BNE, changing delay-slot values,
conditional loop exits, odd/even event deadlines, active RSP execution,
delay-slot exceptions, cache invalidation, and retaining idle skips for NOP
or unobserved delay slots.

The separate patched counter run matched every baseline checkpoint's RAM,
cycles, CPU/RSP instruction totals, fragment calls, and task counts. Idle-skip
attempts fell from 1,387,751,559 to 15,377; neither run skipped any cycles.

The local `n64-systemtest.z64` produced byte-for-byte identical JSON reports
against base and patch: the same 144 failure reports, ending at the existing
`TLB: linear icache across split 4K PFN (64-bit VA)` exception storm. This is
unchanged partial coverage, not a passing full-ROM test suite.

## Reproduce the inventory check

Use ROMs matching the hashes above, Bun 1.3.14, and separate
base/patch checkouts with `bun install --frozen-lockfile`. Acquire the shared
exclusive `/tmp/perf.lock` before starting; retain it across startup and
measurement, clear its owner record before unlocking, and leave the file in
place. Run sequentially, with a distinct output per ROM/seed/revision:

```sh
bun run inventory '/path/to/Biohazard 2 (Japan).z64' \
  --seed 2 --frames 1800 --max-cycles 5000000000 --timeout-ms 60000 \
  --output /tmp/re2-japan-seed2.json
```

Repeat seeds 1–3 for each regional ROM. Inventory completion means VI-budget
completion, not verified gameplay, pixels, or sound. The observed workload
remains dominated by the same CPU loop and audio tasks. No browser/gameplay
validation was performed, and this change does not add RE2 audio HLE support.
