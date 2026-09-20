# Rayman 2 USA seed-1 timeout (#205)

Investigated on 20 September 2026 against
`355caf55a92bbd3d5327cd82b7ed83a229ad4fa3` with Bun 1.3.14.
[Issue #205](https://github.com/hulkholden/n64js/issues/205) reproduces on this revision.

The ERET fix exposes a timing-dependent texture display-list cache failure.
Rayman stamps cached texture sublists with a VI-driven counter, but reuses one
command buffer. Synchronous HLE SP completion lets it build that buffer twice
before the counter advances. The second build treats stale pointers as cache
hits, overwrites their targets, and produces mutually recursive display lists.
The hang is inside HLE traversal; increasing the timeout cannot fix it.

The accompanying ROM-specific workaround gives each render build a distinct
cache generation without changing the VI counter or ERET behavior. The shared
GBI command guard described in the diagnostic controls is a separate change;
the compatibility workaround does not depend on it. Headless completion is
verified below; accurate RSP timing and gameplay are separate questions.

## Reproduction and controls

ROM: `Rayman 2 - The Great Escape (USA) (En,Fr,De,Es,It).z64`.
Normalized SHA-256:
`e9a71380b43e25b998f638480b309e300ad9b8a0439ff36e0a8b5fc4ac132e8a`.
Fresh saves, HLE/null renderer, random-controller v1 / mulberry32, seed 1.

```sh
bun install --frozen-lockfile
bun run inventory "/path/to/ROM.z64" --seed 1 --frames 1800 \
  --max-cycles 5000000000 --timeout-ms 60000 --output repro.json
```

Run the longer diagnostic separately with `--timeout-ms 180000`; retain the
60-second report. Source controls were retained as `git archive` exports with
locked dependencies. Their inventory provenance fields are null because the
exports have no `.git`; the exact revisions are recorded below. Emulator runs
were sequential. The 180-second diagnostic also overlapped development checks,
so its wall time is not a throughput benchmark.

| Source | Budget | Result | VIs | Cycles | Graphics tasks in report |
| --- | ---: | --- | ---: | ---: | ---: |
| Baseline `b629e39b7f79d7b5f3c23b5f98cb04af7488726b` | 60 s | completed | 1800 | 2845111600 | 868 |
| Current `355caf55a92bbd3d5327cd82b7ed83a229ad4fa3` | 60 s | timeout | 793 | 1271956060 | 352 |
| Same current source | 180 s | timeout | 793 | 1271956060 | 352 |
| Current source + command guard | 60 s | halted | 793 | 1272016216 | 353 |
| Current source + guard + cache workaround | 60 s | completed | 1800 | 2845111600 | 1359 |

Timeout reports contain the last checkpoint, before task 353 starts. The guarded
run supplies a terminal report from inside that task, explaining the slightly
higher cycle and task counts. The guarded run ended in approximately 15 seconds.

## Bisection and equal-progress comparison

Testing 810 VIs with a 30-second diagnostic limit isolates:

- Last completing revision: `e6955b860ddaa7721c5e5e750389f8407cfd7083`.
- First timing change exposing the loop: `f3c32244d3bbb68a4a2e12b67e775c64d1e71ff7`
  ([ERET interrupt fix, #143](https://github.com/hulkholden/n64js/pull/143)).

The predecessor reaches VI 810 with **zero graphics tasks**; the successor
reaches 352 tasks before hanging at VI 793. Thus completion under this seeded
input sequence is not a comparison of the same game state. Reverting ERET's
pending-interrupt check would restore a known interrupt-delivery bug and hide
this path rather than explain it.

Profiling at the identical VI 793 / 1271956060-cycle checkpoint gives:

| Counter | `b629e39` | `355caf5` |
| --- | ---: | ---: |
| Graphics tasks | 0 | 352 |
| Total RSP task starts | 1230 | 1807 |
| Interpreted CPU ops | 11890712 | 41257338 |
| Compiled CPU ops | 645980667 | 780725857 |
| Idle-loop skipped cycles | 614084936 | 449973358 |

Separate instrumented runs reached this checkpoint in roughly 10 and 13
seconds. Completed graphics tasks accounted for approximately 0.12 seconds in
the current run. These timings are diagnostic observations, not controlled
benchmark scores. The work counters show that the current run executes more
CPU and graphics work before entering the unbounded task.

## Display-list evidence and excluded explanations

Task 353 uses `RSP Gfx ucode F3DEX.NoN 1.23` (hash `0xfb10824a`) with root
`0x006fbed8`. Its return stack repeatedly contains `0x006fc0a0` and
`0x006fc2c0`: the calls at `0x006fc098` and `0x006fc2b8` enter one another's
lists. This is not the single-command self-branch used for supported CPU
producer waits.

With the guard, one million commands are counted, including triangle batches,
before a `DisplayListLimitError` at `0x006f2490`, stack depth 41666. The terminal
report retains the JavaScript stack and CPU/RSP cursors, and does not synthesize
SP/DP task completion.

Two further diagnostic controls also reproduce the problem:

- Disabling dynamic recompilation still reaches task 353 at VI 793 and enters
  the same recursive list (about 32 seconds to the diagnostic stop).
- Deferring task 353 for 100000 emulated CPU cycles leaves the inspected command
  region `0x006fbeda..0x006fd000` unchanged, then enters the same loop. This does
  not support an ordinary unfinished CPU producer list at task submission.

[Nintendo's gSPDisplayList documentation](https://ultra64.ca/files/documentation/online-manuals/man/n64man/gsp/gSPDisplayList.html)
describes an 18-level F3DEX display-list hierarchy. Inspecting this ROM's own
microcode confirms that calls are ignored once its 18 return slots are full.
An isolated replay with that overflow behavior still performs more than one
million dispatches: bounding stack depth alone expands a huge recursive tree
and is not a demonstrated fix. No microcode stack change is included.

## Guest writes establish the cause

The renderer starts at `0x8008e944` by receiving a buffer-availability message
from queue `0x800ce2a0` (capacity one). Its command buffer is `0x806fbed8`.
The completion handler at `0x8008f52c` returns that message after SP completion.
Our synchronous HLE task execution lets the guest observe that completion
without charging for the graphics work.

The scheduler increments the VI-driven counter at `0x800c8c3c`. At render
startup, `0x8008ea14` loads it and `0x8008ea70` stores the snapshot at
`0x800c8c40`, which is used as a texture-cache generation. Store tracing gives:

| CPU cycle | VI | Event |
| ---: | ---: | --- |
| 1270395045 | 792 | VI-driven counter becomes `0x27a` |
| 1270549671 | 792 | Renderer consumes the buffer-availability message |
| 1270549804 | 792 | Build of task 352 snapshots generation `0x27a` |
| 1270729408 | 792 | SP completion returns the buffer-availability message |
| 1270883985 | 792 | Renderer consumes that message again |
| 1270884118 | 792 | Build of task 353 also snapshots generation `0x27a` |
| 1271957240 | 793 | VI-driven counter becomes `0x27b`, after list construction |

Texture-cache records contain a sublist pointer at offset 8 and a generation at
offset 12. Task 352 stores generation `0x27a` and sublist pointers
`0x806fc070` / `0x806fc288` in records at `0x8061c3b4` / `0x8061c498`.
Task 353 sees those same generations at the comparison at `0x8009d5e4`.
The cache-hit path at `0x8009d674..0x8009d680` emits calls to the old pointers,
while the new main list overwrites those locations. Those calls create the
cross-linked lists observed by the HLE runner. The cache-miss path would have
rebuilt the texture sublists and updated both fields.

This distinguishes invalid guest-generated commands from an HLE decode error
or a dynarec error. It also explains why delaying consumption of task 353 does
not repair the list: its bad pointers have already been written.

## Causal controls and workaround

Three controls retain the ERET fix and the seed-1 input driver:

- Change only the generation stored while building task 353, from `0x27a` to
  `0x1000027a`. This forces cache misses for that build. It reaches 1800 VIs and
  1359 graphics tasks, without skipping a task or changing interrupt delivery.
- Advance the generation once per render build. This also reaches 1800 VIs and
  1359 graphics tasks. The final generation is 1360 while the original
  VI-driven counter is 1641: they serve distinct purposes.
- Leave guest instructions unmodified and defer every graphics task's SP
  completion until the next VI, retaining ordinary HLE execution and DP
  FullSync behavior. This reaches 1800 VIs and 1107 graphics tasks. Deferring
  only task 352 instead moves the failure to task 354 at VI 794.

The delay experiment supports the missing graphics-time explanation, but a
whole-VI delay is not an accurate RSP model and changes throughput. It is not
included in the implementation. The exact hardware task duration has not been
measured. ERET changed scheduling enough to expose the collision; the bisection
does not show that the corrected pending-interrupt check is itself wrong.

The workaround is restricted to ROM ID `9bbfc5f3e2330f16`:

1. At `0x8008ea14`, load the previous cache generation (`0x800c8c40`) instead of
   the VI-driven counter (`0x800c8c3c`).
2. At `0x8008ea6c`, increment that generation before the existing store.
   This replaces a redundant `LUI at,0x800d`: AT already has that value from
   `0x8008ea58`, and the intervening instructions do not change it.

Both original instruction words must match before either is changed. The
compatibility mechanism applies the pair on first execution, after the boot
checksum, and invalidates compiled fragments. Unknown IDs, disabled hacks, or
mismatched instructions retain the original code. A separate counter preserves
cache equality and relative age ordering without changing the game's VI
counter. The observed generation consumers are texture/cache operations; this
is still a guest workaround, not a claim of accurate CPU/RSP scheduling.

## Command guard scope (separate change)

The one-million-command limit is a host safeguard, not a hardware limit or
cycle model. It is checked between command batches. Each producer-wait
continuation gets a fresh budget; debugger `bailAfter` still takes precedence
when it stops earlier. Microcode switches retain the same budget. Object-list
microcodes have independent runners and are outside this change. A legitimate
list exceeding this limit could halt too; no complete ROM-corpus claim is made.

## Validation

With the production cache-generation workaround and command guard enabled,
the original 60-second-budget, 1800-VI inventory runs complete:

| Seed | VIs | Cycles | Graphics tasks |
| ---: | ---: | ---: | ---: |
| 1 | 1800 | 2845111600 | 1359 |
| 2 | 1800 | 2845111600 | 745 |
| 3 | 1800 | 2845142560 | 1178 |

For seeds 2 and 3, the complete `result` and `collectors` objects match their
guard-only controls. An interpreter-only seed-1 run also crosses the failure
point and reaches VI 810 / 369 graphics tasks without a fatal error; profiling
confirms zero compiled operations and zero compiled fragments.

Paired 60-second-budget runs on the retained current source and the guarded
source both complete 1800 VIs for seeds 2 and 3. Their entire `result` and
`collectors` objects match for each seed: 2845111600 cycles for seed 2 and
2845142560 for seed 3. Elapsed times were approximately 33/32 seconds (seed 2)
and 35/36 seconds (seed 3), respectively. This is HLE/null-renderer validation;
these controls predate the cache-generation workaround.

Synthetic tests cover recursive calls, multi-command branch cycles, batching,
microcode reloads, disassembly, debugger limits, and repeated producer waits.
Headless task execution verifies that a limit error cannot fabricate SP/DP
completion. CLI tests verify terminal exception evidence and retain independent
wall-clock timeout and interrupted-scan coverage using an unpatched producer
wait. Compatibility tests exercise distinct generations with an unchanged VI counter
in interpreted and compiled execution, disabled/unknown ROMs, atomic rejection
of mismatched instruction pairs, and invalidation of compiled companion code.

The original combined implementation passed all 1368 tests, lint, build, and
whitespace checks. Validation uses
HLE with the null renderer. Browser visuals, audible output, and controllable
gameplay remain unverified, as does behavior over a complete playthrough.

## Independent compatibility change

After separating the guard and rebasing onto master
`3b75924bf64ef396c4a70155d4774c99671dd914`, the compatibility-only branch passes
1387 tests, lint, build, and whitespace checks. With no command guard present,
seed 1 completes the original 1800-VI / 60-second-budget inventory run:
2845111600 cycles and 1358 graphics tasks. The newer base contains SI DMA timing
changes, so task counts need not match the original investigation base.

The independent guard-only branch on that same newer master also completes
seed 1 with exactly the same result and collector objects (1800 VIs,
2845111600 cycles, 1358 graphics tasks), without the compatibility workaround.
The guard does not alter successful guest execution or emulated timing. Thus
newer master changes already avoid this particular seeded failure path; the
original failing revision and causal controls above remain the evidence for
the workaround. The compatibility PR is a draft because its necessity on
current master needs further evaluation.
