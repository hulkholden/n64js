# BattleTanx boot timing follow-up — issue #103

The proposed **RDRAM-initialization-only fix is insufficient**. Restoring the
measured reference cost would leave both US games below the controller library's
500 ms threshold. No production timing adjustment has been applied.

These measurements predate the [draft compatibility workaround](compatibility-hacks.md),
which bypasses the controller wait without changing emulated time. Use
`--no-compatibility-hacks` for the original n64js behavior measured here.

This follows the [startup diagnosis](battletanx-startup.md). Measurements use
n64js `2094ccf20c8803451152e34b687d801c7a1102f5` and ares
[`b15d4d378c0ae59628d914efba1dfac81b07f88f`](https://github.com/ares-emulator/ares/tree/b15d4d378c0ae59628d914efba1dfac81b07f88f),
on 2026-09-13. The [evidence file](battletanx-boot-timing.json) contains the
checkpoints, cache counters and diagnostic results. ROMs are identified by the
same hashes as the original report.

## Full boot versus skipped initialization

The reference probe runs the actual PIF and IPL3 with 8 MiB RDRAM, deterministic
entropy, and CPU/RSP recompilers disabled. It captures the chip and RI state
after successful RDRAM initialization, then cold-boots the same image again.
On the second run, it restores those chip/RI registers at IPL3 entry and supplies
the detected memory size. IPL3 takes its own existing initialization-skip branch.
COUNT, CPU instructions, PC and event deadlines are not patched.

At the branch convergence, `0xa4000458`, full initialization costs an additional
**18,183,686 reference half-cycles = 96.979659 ms**, for all three images. This is
an emulator comparison, not a measurement from a physical console. The chip
calibration values and timing model are ares's.

First `osGetTime` return inside `osContInit`:

| Image | n64js | ares, full boot | ares, initialization skipped |
| --- | ---: | ---: | ---: |
| BattleTanx USA | 291.032 ms | 596.922 ms | 499.943 ms |
| Global Assault USA | 310.319 ms | 635.515 ms | 538.535 ms |
| Global Assault Europe | 317.294 ms | 682.101 ms | 585.119 ms |

As a further diagnostic, adding 4,545,921 COUNT ticks (the reference initialization
delta rounded down) to the first returned time in each US game gives:

| Image | Diagnostic returned time | Result |
| --- | ---: | --- |
| BattleTanx USA | 388.012 ms | Same null-link fault at `0x80121854` |
| Global Assault USA | 407.299 ms | Same null-link fault at `0x801111d4` |

This uses the existing **return-value-only** probe; it does not implement or
simulate RDRAM initialization in n64js. It tests whether accounting for that
amount of elapsed time would be sufficient to avoid the faulty timer branch.

## Where the remaining time goes

BattleTanx USA, measured between matching instruction PCs:

| Phase | Start → end | n64js | ares, full boot |
| --- | --- | ---: | ---: |
| Initialization branch and initial cache invalidation | `a4000040` → `a4000458` | 0.044 ms | 97.901 ms |
| Relocation and DMA setup | `a4000458` → `80000050` | 0.011 ms | 0.279 ms |
| First 1 MiB PI DMA wait | `80000050` → `800000d8` | 195.691 ms | 199.194 ms |
| Checksum and remaining IPL3 | `800000d8` → `80071000` | 61.079 ms | 91.158 ms |
| Game BSS clear | `80071000` → `80071030` | 28.028 ms | 173.207 ms |

The BSS loop is particularly useful because its work is deterministic and easy
to account for. It clears `0x80147040` through `0x803c887f`, with one 32-bit store
per four-instruction iteration. Both emulators execute **2,627,656 instructions**
between the entry and the call after the loop. n64js charges that many CPU cycles;
ares charges **16,238,196**.

ares records these additional cache operations in that interval:

- 164,228 data-cache fills, at 40 CPU cycles each.
- 163,716 dirty data-cache writebacks, at 40 CPU cycles each.
- 492,684 remaining stores that hit the cache, at one additional cycle each.
- Two instruction-cache fills, at 48 CPU cycles each.

Those charges sum to exactly **13,610,540 extra CPU cycles = 145.179 ms**.
The [ares data-cache implementation](https://github.com/ares-emulator/ares/blob/b15d4d378c0ae59628d914efba1dfac81b07f88f/ares/n64/cpu/dcache.cpp)
and [instruction-cache implementation](https://github.com/ares-emulator/ares/blob/b15d4d378c0ae59628d914efba1dfac81b07f88f/ares/n64/cpu/cpu.hpp)
define these reference costs. This accounts for the observed loop difference;
it does not establish that these fixed latencies are exact hardware timings.

The analogous loop takes 28.381 versus 175.391 ms in Global Assault USA and
29.771 versus 183.992 ms in Europe. The reference's full and skipped runs have
identical cache counts for this loop.

## Consequence for a fix

An isolated boot-delay constant would conceal only part of the missing work.
The next implementation target is data-cache fill/writeback behavior and its
timing, alongside proper RDRAM initialization. The BSS interval above is a useful
small regression target before attempting whole-game validation.

Any such change needs consistent cycle accounting in the interpreter, dynarec,
COUNT and event queue. Cache state also interacts with cache instructions,
uncached aliases, DMA and guest memory visibility. Simply increasing cycles per
instruction or adding a ROM-specific startup delay would not model those effects.
Reference comparisons should be supplemented with hardware/system-test evidence
before choosing the production timing model.

## Reproduce

The n64js harness now emits `bootStages`. Use `--step-startup` for exact
instruction boundaries; its default execution and diagnostic override are
otherwise unchanged:

```sh
bun src/headless_battletanx.js '/Volumes/Data/Roms/BattleTanx (USA).z64' 1 --step-startup --no-compatibility-hacks
bun src/headless_battletanx.js '/Volumes/Data/Roms/BattleTanx (USA).z64' 1 --time-ticks=18188050 --no-compatibility-hacks
bun src/headless_battletanx.js '/Volumes/Data/Roms/BattleTanx - Global Assault (USA).z64' 1 --time-ticks=19092124 --no-compatibility-hacks
```

The standalone [reference probe](probes/ares_battletanx.cpp) and
[build script](probes/build_ares_probe.py) require macOS, Xcode clang, Python 3,
and the pinned ares source. Build products belong in the ignored `build/` folder:

```sh
git clone https://github.com/ares-emulator/ares.git build/ares-source
git -C build/ares-source checkout b15d4d378c0ae59628d914efba1dfac81b07f88f
python3 docs/probes/build_ares_probe.py build/ares-source build/ares-probe
build/ares-probe/ares-battletanx build/ares-source '/Volumes/Data/Roms/BattleTanx (USA).z64'
```

Repeat with the other two ROMs. Each invocation emits JSON lines for a full
boot and a subsequent skipped-initialization boot. The reference tool checks the
hash of the supplied big-endian `.z64`; the n64js tool additionally normalizes ROM
byte order. Both reject unknown images.

The build script reads the reference checkout without changing it. It creates
local compilation units to omit unused embedded resources and guard one unused
Vulkan frontend call. The probe supplies hidden-RAM storage normally provided by
Vulkan. It stops at controller initialization, before graphics work, and does
not claim rendering or playability validation. PIF firmware comes from the
reference checkout; no firmware, game bytes or guest memory dumps are included
in these artifacts.

Validation: the reference probe built from the unmodified pinned checkout and
completed all six boot runs. Three n64js stepped runs preserved the original
controller times and fault results; both added-time diagnostics retained the
US faults. The 30-second BattleTanx threshold probe retained its original
780 graphics tasks, 890 audio DMAs, 1,782 retraces and 3,765 controller commands.
All 242 source tests pass, ESLint passes, and the browser bundle builds.
Unknown-ROM rejection was also checked. Full system-test ROM validation remains
necessary for a future production cache/timing change; this follow-up changes
investigation tooling only.
