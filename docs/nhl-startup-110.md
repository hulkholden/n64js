# NHL Breakaway startup timing (#110)

Tested on 2026-09-13 against `33815da` plus this change, using Bun 1.3.14 on
macOS arm64. The compatibility delay restores startup in NHL Breakaway 98 E/U
and 99 E/U. The 99 Europe image also has the same failure as the three images
originally reported in [#110](https://github.com/hulkholden/n64js/issues/110).
This is a configurable timing workaround; later gameplay faults remain.

## Cause and exception recovery

The first frame computes `microseconds = (end - start) * 1000000 / 46875000`
using unsigned 64-bit arithmetic, then computes `1000000 / microseconds`.
With n64js's one-cycle-per-instruction timing, its two adjacent `osGetTime`
calls are only 29 or 30 COUNT ticks apart, depending on the half-tick phase.
The first division correctly truncates to zero, so the second division takes
its compiler-generated division-by-zero `BREAK` guard. This happens before any graphics task.

In 98 USA, the calls are at `0x8000c904` and `0x8000c924`, and `osGetTime` is at
`0x8003d4c0`. The first two COUNT reads are 31,056,050 and 31,056,079. The delta
is stored at `0x80091f00/04`, converted to microseconds by the helper called at
`0x8000c9e8`, then stored at `0x80092538`. The integer divisor loaded from there
is zero; the guest executes `DIV s0,a0` at `0x8000ca00`, followed by the zero
guard at `0x8000ca0c`. Disabling dynarec reproduces exactly the same COUNT reads,
fault PC and time. There is no evidence of an arithmetic or recompiler error
in this sequence. The missing execution-time costs are the relevant emulator
limitation; this investigation does not establish their exact hardware value.

The 98 USA exception vector transfers to `0x8003142c`. The guest recognizes
the BREAK, saves the exception/register context, and enters a debug monitor
that polls cartridge address `0xb1fffff0`, with a busy-wait helper at
`0x8003045c`. It does not resume the frame loop during the 30-second run.
The final EPC still identifies the BREAK; Cause is `0x00008424` and SP_STATUS
is `0x243`. This is guest fault handling, rather than a host exception or a
renderer failure.

## Workaround

`src/compatibility_hacks.js` specifies a one-time 64-CPU-cycle delay at the
second `JAL osGetTime`. It adds 32 COUNT ticks: the initial interval becomes
61–62 ticks and converts to one whole microsecond. Subsequent frame iterations
have work between their samples and use normal timing.

The delay consumes no guest instruction and changes no ROM/RAM words. It
charges COUNT and the CPU event queue after the call instruction completes,
preserving the return address and pending delay slot. The BREAK and division
instructions remain intact. Delays are checked against the original instruction,
deferred at debugger breakpoints, consumed once per reset, and omitted from
subsequent compiled execution. This is not a cache/pipeline implementation;
[cache behavior remains tracked separately](https://github.com/hulkholden/n64js/issues/24).

Set an entry's `enabled` to `false`, or pass `enableCompatibilityHacks: false`
to `createHeadlessEmulator`, to reproduce the original behavior. Selection is
by ROM header CRC ID, using the same compatibility configuration as BattleTanx.

| Image | Header CRC ID | Delay site | Original instruction | BREAK PC | Baseline COUNT delta |
| --- | --- | --- | --- | --- | ---: |
| 98 Europe | `9276ce297985c571` | `0x8000c964` | `0x0c00f540` | `0x8000ca4c` | 30 |
| 98 USA | `c3cdfd6dc801e74d` | `0x8000c924` | `0x0c00f530` | `0x8000ca0c` | 29 |
| 99 USA | `d06817444ff2737d` | `0x8000c964` | `0x0c00ee50` | `0x8000ca4c` | 30 |
| 99 Europe | `cb21468727c13100` | `0x8000c9a4` | `0x0c00ee60` | `0x8000ca8c` | 29 |

## Reproduction and validation

```sh
bun src/headless_nhl.js "/path/to/NHL Breakaway 98 (USA).z64" --no-compat
bun src/headless_nhl.js "/path/to/NHL Breakaway 98 (USA).z64" --execute-graphics
bun src/headless_nhl.js "/path/to/NHL Breakaway 98 (USA).z64" --execute-graphics --input
```

The reproducer uses fresh save/emulator state, CPU RNG seed 1 (the LCG in #86),
and a 30-second elapsed-cycle deadline independent of guest COUNT. `--input`
presses Start at 3/6/9 seconds and A at 12/15/18/21/24/27 seconds, each held for
0.25 seconds at VI boundaries. `--seconds=N` changes the duration. Graphics use
HLE and audio uses LLE. `--execute-graphics` executes display lists with
NullRenderer; otherwise the headless harness only counts them. Output reports
guest faults separately from host errors, excluding interrupts and lazy COP1
activation. It does not return a failing process status for observed guest faults.

All four images were run for 30 seconds in neutral and input modes with the
workaround disabled (8 runs), then with it enabled and display lists executed
(8 runs). Disabled runs all produce **0 graphics tasks / 6 audio DMAs** and the
startup BREAK around 0.66 seconds; input does not change this result.

| Image | First graphics (s) | Neutral graphics / audio DMAs | Input graphics / audio DMAs | VI retraces |
| --- | ---: | ---: | ---: | ---: |
| 98 Europe | 1.641955 | 630 / 1375 | 779 / 1679 | 1486 |
| 98 USA | 1.642731 | 831 / 1746 | 799 / 1688 | 1784 |
| 99 USA | 1.608844 | 830 / 1744 | 784 / 1744 | 1784 |
| 99 Europe | 1.608675 | 829 / 1744 | 828 / 1744 | 1487 |

Four additional 30-second input runs used the normal WebGL HLE renderer and VI
presentation in the Codex in-app browser, with local file selection and fresh
state. Host audio playback was suppressed while preserving AI timing. These
runs match the headless graphics/audio counts and fault times. All four show
the license screen at 2 seconds, the main menu/controller-pak dialog at 10
seconds, and team selection at 20 seconds, demonstrating response to Start/A.
98 USA and 99 E/U render the rink by 30 seconds; 98 Europe turns black while
transitioning into the game. Audible output and the main UI's real-time pacing
were not assessed.

### Remaining faults exposed after startup

| Image/mode | First later guest fault | Time (s) |
| --- | --- | ---: |
| 98 Europe, neutral | TLBL at `0x80029df0` | 23.787902 |
| 98 Europe, input | AdES at `0x8012a624` | 28.877022 |
| 98 USA, input | TLBL at `0x80019c48` | 29.030311 |
| 99 USA, input | TLBL at `0x80019888` | 28.932311 |

No unexpected guest fault occurs within 30 seconds for neutral 98 USA/99 USA,
or either mode of 99 Europe. These are startup and menu validation results,
not full-game playability claims. The later faults need separate investigation.

The seven new source tests cover delay timing, Compare/interrupt delivery and
branch state, disabled/mismatched configurations, debugger single-step, reset,
and hot compiled loops. `bun run lint`, all **389 source tests**, and
`bun run build` pass. Baseline/fixed system-test logs are byte-identical: 997
test headings, 144 failure reports, and the existing exception-storm abort at
`TLB: linear icache across split 4K PFN (64-bit VA)`. Coverage beyond that abort
remains unverified. System-test SHA-256:
`a2122627036944ef107589c39894136d1d3dcf25f53b8b244bf80a6c237d0f06`.

After rebasing onto `7bcf2b3` (including the FIFA workaround in #129), lint,
all **402 source tests**, and the build pass. Repeating the four 30-second
NHL input runs gives identical graphics/audio counts, first-graphics times,
and later guest faults. Five-second headless HLE smoke checks also preserve
FIFA Europe/USA startup: 114/135 graphics tasks, respectively, with no
unexpected guest faults or host errors.

## ROM identities

Hashes are SHA-256 over byte-order-normalized big-endian bytes. No ROM data is
included in the reproducer or report.

| Current filename | SHA-256 |
| --- | --- |
| NHL Breakaway 98 (Europe).z64 | `77d6d4ce6b3f8a116f62b27968e91bbb36dbc93c303b21f3141b40887c3a8a27` |
| NHL Breakaway 98 (USA).z64 | `12cd9cde3c40fd2f2be054ff19c48fcb26b0caccd8bac7aa1cf83be0c02a31bb` |
| NHL Breakaway 99 (USA).z64 | `ddafa01182ae8a6a7fa76a3b3cc1211ff5702bc3e9aa0d5ba60ca20408193c29` |
| NHL Breakaway 99 (Europe).z64 | `d43243d318b79cb458ed34e04aa9923eadd6ce1f99df7bdd7d82e00497befb93` |
