# BattleTanx US startup timing — issue #103

This report records the original diagnosis before the
[draft compatibility workaround](compatibility-hacks.md). The underlying timing
fix remains open. The standalone harness's optional time override is a diagnostic
experiment only. Use `--no-compatibility-hacks` to reproduce the results below.

Investigated on 2026-09-13 at `2094ccf20c8803451152e34b687d801c7a1102f5`
with Bun 1.3.14, fresh saves, RNG seed 1, HLE graphics and LLE audio.
[Original issue](https://github.com/hulkholden/n64js/issues/103).

## Cause

Both US games call `osContInit` **before** `osCreateViManager`.
`osContInit` calls `osGetTime` and, if fewer than 500 ms have passed, calls
`osSetTimer` to wait out the remaining time. `osCreateViManager` initializes
libultra's timer list via `__osTimerServicesInit`; that has not happened yet.
The early timer insertion consequently follows a null link and loads from
address `0x10`.

The [libultra controller implementation](https://github.com/n64decomp/libreultra/blob/master/src/io/controller.c)
confirms the 500 ms check and the timer/message-queue wait. The matching code
and startup order were traced in the supplied ROMs, including instruction-at-a-time
startup runs. The US failures occur before any controller command or VI retrace.

The European Global Assault revision calls `osCreateViManager` first. It also
reaches `osContInit` before 500 ms, but its initialized timer list makes the wait
succeed. Thus the regional difference is initialization order, not a missing
controller, PAL input handling, or a different delay threshold.

| Image | First `osGetTime` result (COUNT ticks) | Time | Timer links at controller init |
| --- | ---: | ---: | --- |
| BattleTanx USA | 13,642,129 | 291.032 ms | Both zero |
| Global Assault USA | 14,546,203 | 310.319 ms | Both zero |
| Global Assault Europe | 14,873,153 | 317.294 ms | Both point to the sentinel |

The 500 ms threshold is 23,437,500 ticks at 46.875 MHz. Normal execution and
stepped startup produce the same initial time and first fault for each US ROM.

## Addresses and writes

| Symbol / observation | BattleTanx USA | Global Assault USA | Global Assault Europe |
| --- | --- | --- | --- |
| `osContInit` | `0x80110fe0` | `0x801033f0` | `0x801003c0` |
| First `osGetTime` return site | `0x8011101c` | `0x8010342c` | `0x801003fc` |
| `osCreateViManager` | `0x80121ba0` | `0x80111560` | `0x8010e600` |
| `__osTimerServicesInit` | `0x801215a0` | `0x80110f20` | `0x8010dfc0` |
| Global timer-list pointer | `0x80146110` | `0x80126f00` | `0x801228a0` |
| Sentinel object | `0x803c7620` | `0x803b0550` | `0x803cbc00` |
| First TLB read fault | `0x80121854` | `0x801111d4` | None |

In both US ROMs, startup clears the sentinel's two links and never initializes
them before the fault. The global pointer itself contains the correct sentinel
address. The failing instruction is `LW t2, 0x10(t7)` with `t7 = 0`.
This is uninitialized state, rather than an initialized list later being corrupted.

In the European stepped run, `osCreateViManager` starts at elapsed CPU cycle
26,997,533, and `__osTimerServicesInit` starts at 26,997,541. It writes the sentinel
address to the previous link at 26,997,553 and the next link at 26,997,560.
`osContInit` starts later, at 29,746,281. Its timer is inserted successfully and
removed after the delay expires.

The final US idle PCs (`0x80077ab4` / `0x8009ee84`) belong to the fault-reporting
path. The first TLB fault above is the useful diagnostic location; final EPC can
change as subsequent interrupts enter that path. Lazy COP1 initialization is not
the failure.

## Controlled experiment

The harness can replace **only the first `osGetTime` return value inside
`osContInit`**. It does not initialize the list, change COUNT, advance the event
queue, or modify ROM bytes. The unmodified returned value and list links are
recorded before the override.

For **both** US ROMs:

- Returning 23,437,499 ticks still produces the same null-link TLB fault.
- Returning 23,437,500 ticks avoids the early wait. The game proceeds to
  `osCreateViManager` and initializes its own sentinel links.

This pins the failure to the timer-delay branch, rather than merely demonstrating
that an arbitrary larger delay happens to boot. It is not evidence for the
accuracy of a particular cycle multiplier or boot-time adjustment.

The 30-second observations are below. The input schedule holds Start for 250 ms
at 3, 6 and 9 seconds, then A for 250 ms at 12, 15, 18, 21, 24 and 27 seconds.
Input changes are applied on VI retraces, as in issue #86's portable harness.

| Image / configuration | Graphics tasks | Audio DMAs | VI retraces | First TLB fault |
| --- | ---: | ---: | ---: | --- |
| BattleTanx USA, normal, neutral or input | 0 | 0 | 0 | `0x80121854` |
| Global Assault USA, normal, neutral or input | 0 | 0 | 0 | `0x801111d4` |
| Global Assault Europe, normal, neutral | 733 | 736 | 1,485 | None |
| BattleTanx USA, 500 ms return probe, input | 780 | 890 | 1,782 | None |
| Global Assault USA, 500 ms return probe, input | 720 | 889 | 1,781 | None |

These are headless execution-progress results. Graphics tasks skip rasterization;
this investigation does not establish correct rendering, audio quality, or
playability. No production fix was applied for these runs.

## Reproduce after ROM renaming

The harness selects its trace addresses by **normalized SHA-256**, not filename.
The supplied files were found at `/Volumes/Data/Roms`:

| Current filename | Normalized SHA-256 |
| --- | --- |
| `BattleTanx (USA).z64` | `c5b7cf3523de025e3f18e2c8df2deb0eced5613e7c46cb8c6c5a4f22644ead3f` |
| `BattleTanx - Global Assault (USA).z64` | `88268ce770ff39f2ca839848b842c87866df6c5ddaf775f180b2522c18ff6221` |
| `BattleTanx - Global Assault (Europe) (En,Fr,De).z64` | `8c0f538d32243d7d230ff28432326fbb17ea59bec2e2d9815dc04317dbe70db0` |

From the repository root:

```sh
bun install --frozen-lockfile
bun src/headless_battletanx.js '/Volumes/Data/Roms/BattleTanx (USA).z64' 30 --no-compatibility-hacks
bun src/headless_battletanx.js '/Volumes/Data/Roms/BattleTanx (USA).z64' 30 --input --no-compatibility-hacks
bun src/headless_battletanx.js '/Volumes/Data/Roms/BattleTanx (USA).z64' 1 --step-startup --no-compatibility-hacks
bun src/headless_battletanx.js '/Volumes/Data/Roms/BattleTanx (USA).z64' 1 --time-ticks=23437499 --no-compatibility-hacks
bun src/headless_battletanx.js '/Volumes/Data/Roms/BattleTanx (USA).z64' 30 --input --time-ticks=23437500 --no-compatibility-hacks
```

Repeat with either Global Assault path. Normal runs never replace the time.
`--step-startup` runs one instruction per CPU call through the first fault or the
observed initialization sequence, then resumes normal execution. It is for
precise startup tracing, not an interpreter setting for the entire run.

The harness emits JSON on stdout and emulator messages on stderr. It reports the
ROM hash, input/override settings, first controller time, initialization order,
the first 16 link writes, first TLB fault, task/controller counts and final CPU
state. Unknown images are rejected before running. It uses an event-queue
elapsed-cycle deadline rather than the guest-writable COUNT register, and has a
120-second wall-time limit. Normal dynarec store timestamps can have fragment
granularity; use `--step-startup` for individual startup writes. No ROM bytes or RAM
dumps are included in the report or [12-run evidence file](battletanx-startup.json).

## Proper timing follow-up

The [measured boot follow-up](battletanx-boot-timing.md) now rules out restoring
skipped RDRAM initialization alone as a sufficient fix: its reference cost is
about 97 ms. Cache costs explain another 145 ms in BattleTanx's BSS clear alone.
The reference probe and matching n64js boot checkpoints are preserved there.

A correction must explain why the US startup path executes before 500 ms under
our timing model, and derive the missing time from hardware behavior. The trace
establishes the dependency, but does **not** identify one specific hardware stall
as accounting for the entire deficit.

Relevant existing approximations are `RIRegDevice.reset()` skipping most RDRAM
initialization, one CPU cycle charged per instruction, and missing cache/bus and
instruction-pipeline timing. On BattleTanx, IPL3 explicitly writes zero to COUNT
at `0xa4000044`; increasing a PIF handoff COUNT seed would be overwritten. Its
first 1 MiB PI DMA starts near cycle 5,190, and controller initialization is still
too early after the existing cartridge DMA timing is included.

[Mupen64Plus PR #737](https://github.com/mupen64plus/mupen64plus-core/pull/737)
independently records the same US-only boot sensitivity and uses a per-game
`CountPerOp=3` workaround. A review comment reports performance degradation in
later missions. This corroborates timing sensitivity, not a suitable timing
constant for n64js.

For a future fix, retain these US ROMs and the European control as startup
regressions; preserve the hardware COUNT rate of one tick per two CPU cycles.
Validate any boot, cache or instruction-timing changes against hardware/reference
timing evidence, appropriate system tests, and broader ROM controls. Do not
initialize libultra's list from the emulator or treat the diagnostic override as
a shipped solution.

Validation of this investigation tooling: all 242 source tests pass, ESLint
passes, and the browser bundle builds. No full system-test ROM comparison was
needed for this diagnostic-only change, and none is claimed.
