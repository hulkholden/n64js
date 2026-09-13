# Boot activity investigation: issue #92

On 2026-09-13, 12 of the 20 images from [issue #92](https://github.com/hulkholden/n64js/issues/92) already produced graphics and audio at revision `9f19b9b3ab58b6508e98e043e9e32a9d742f7891`. Fixing CPU branches to virtual address zero restores activity for the three Bomberman images. The remaining five images have reproducible startup failures, grouped below into BattleTanx and Gauntlet paths.

Activity is not a claim of playability. Browser checks found outstanding rendering problems in Bomberman, Tetris 64, and Virtual Pool 64. Issue #92 should remain open until the remaining failures have their own linked tracking issues.

## Reproduction and identities

```sh
bun src/headless_audit.js "/path/to/rom" 30
bun src/headless_audit.js "/path/to/rom" 30 input
```

The CLI prints JSON to stdout and emulator diagnostics to stderr. It uses Bun 1.3.14, a fresh emulator/save state, RNG seed 1, HLE graphics with display lists skipped, and LLE audio. A separate CPU event measures 30 emulated seconds at 93,750,000 cycles/second, independently of guest COUNT writes. Controller 0 has the default Controller Pak. The input mode applies Start at 3/6/9 seconds and A at 12/15/18/21/24/27 seconds, for 0.25 seconds each, on VI retraces. Games that never configure VI receive no such pulses and do not poll the controller.

[Machine-readable results](boot-audit-92.json) contain 75 runs: 20 baseline neutral, 20 baseline input, 12 regional/revision controls, 20 fixed neutral, and three fixed Bomberman input runs. The file records the baseline revision, fixed CPU source hashes, normalized ROM SHA-256 hashes, activity counts, final CPU/CP0/RSP/interrupt state, and controller command counts. `cp0` keys are register numbers; `rsp` is `[PC, SP_STATUS]`; `mi` is `[MI_INTR, MI_INTR_MASK]`; controller command keys are `channel:command`. The CLI reproduces the activity measurements and adds explicit VI/PI/SI register fields; its output layout is more descriptive than the original capture harness.

All 20 normalized hashes match those listed in #92. All 20 full-image hashes are distinct. After normalization, the 8 MiB `Virtual Pool 64 (U) (!).v64` contains two identical copies of the complete 4 MiB `Virtual Pool 64 (U) [!].z64`. These are one program payload in two image files and produced identical activity and final state. Retain 20 image identities but count 19 payloads. Determine byte order from the ROM header, not its filename extension.

## All 20 images

Counts below are graphics tasks / audio DMAs at 30 seconds with neutral input. “Already active” means the original no-activity result does not reproduce at the starting revision; no individual upstream commit was bisected as its cause.

| Image | Baseline gfx / audio | Fixed gfx / audio | Disposition |
| --- | ---: | ---: | --- |
| `Armorines - Project S.W.A.R.M. (G) [!].z64` | 717 / 1754 | 717 / 1754 | Already active |
| `Baku Bomberman (J) [!].z64` | 0 / 0 | 1257 / 1646 | [Zero-address dispatch fixed](#bomberman-fixed-zero-address-dispatch); rendering remains incorrect |
| `BattleTanx (U) [!].z64` | 0 / 0 | 0 / 0 | [Startup fault](#battletanx-us-startup-fault-before-vi-initialization) |
| `BattleTanx - Global Assault (U) [!].z64` | 0 / 0 | 0 / 0 | [Startup fault](#battletanx-us-startup-fault-before-vi-initialization) |
| `Bomberman 64 (E) [!].z64` | 0 / 0 | 1244 / 1373 | [Zero-address dispatch fixed](#bomberman-fixed-zero-address-dispatch); rendering remains incorrect |
| `Bomberman 64 (U) [!].z64` | 0 / 0 | 1419 / 1648 | [Zero-address dispatch fixed](#bomberman-fixed-zero-address-dispatch); rendering remains incorrect |
| `Gauntlet Legends (E) [!].z64` | 0 / 0 | 0 / 0 | [Checksum rejection](#gauntlet-legends-reload-checksum-includes-stack-saves) |
| `Gauntlet Legends (J) [!].z64` | 0 / 0 | 0 / 0 | [Checksum rejection](#gauntlet-legends-reload-checksum-includes-stack-saves) |
| `Gauntlet Legends (U) [!].z64` | 0 / 0 | 0 / 0 | [Checksum rejection](#gauntlet-legends-reload-checksum-includes-stack-saves) |
| `South Park (G) [!].z64` | 584 / 1754 | 584 / 1754 | Already active |
| `South Park (U) [!].z64` | 706 / 1754 | 706 / 1754 | Already active |
| `Tetris 64 (J) [!].z64` | 6 / 1754 | 6 / 1754 | Already active; corrupted browser image |
| `Turok - Rage Wars (E) [!].z64` | 725 / 1770 | 725 / 1770 | Already active |
| `Turok 2 - Seeds of Evil (E) [!].z64` | 725 / 1750 | 725 / 1750 | Already active |
| `Turok 2 - Seeds of Evil (U) [!].z64` | 869 / 1750 | 869 / 1750 | Already active |
| `V-Rally Edition 99 (J) [!].z64` | 4310 / 1752 | 4310 / 1752 | Already active |
| `V-Rally Edition 99 (U) [!].z64` | 4320 / 1752 | 4320 / 1752 | Already active |
| `Virtual Pool 64 (E) [!].z64` | 1472 / 1473 | 1472 / 1473 | Already active; distorted browser geometry |
| `Virtual Pool 64 (U) (!).v64` | 1763 / 1769 | 1763 / 1769 | Already active; distorted browser geometry |
| `Virtual Pool 64 (U) [!].z64` | 1763 / 1769 | 1763 / 1769 | Already active; distorted browser geometry |

## Bomberman: fixed zero-address dispatch

The CPU used `0` to mean “no pending branch.” Bomberman's dispatcher executes `JR r0` into a valid TLB mapping at virtual address zero. The emulator executed its delay slot but discarded the zero target and continued through the dispatch stubs. Eventually an allocator received a pointer-sized allocation request and its doubling loop wrapped to zero, explaining the later heap-loop PC in the original report.

Use `null` for absent `delayPC`/`branchTarget`, with explicit null checks in the interpreter, exception handling, and generated code. The debugger now distinguishes no pending branch from a pending branch to `0x00000000`. This is a general CPU correction without ROM detection or game-specific workarounds.

All three regions now submit their first graphics task at approximately 2.55 seconds. The fixed input runs also remain active: Baku Bomberman J `1529 / 1647`, Bomberman E `1244 / 1373`, and Bomberman U `1395 / 1648`. A five-second interpreter-only US run matched the recompiler's `138 / 148` counts. Every other image in the 20-image neutral comparison retained exactly the same graphics/audio counts as baseline.

Browser rendering still needs investigation: US shows a cutscene with repeated/stacked geometry; E shows a castle scene with a large black rectangle; J is almost entirely black at the sampled 30-second frame despite ongoing graphics/audio tasks. The CPU fix resolves their no-activity startup failure, but does not establish correct rendering.

## BattleTanx US: startup fault before VI initialization

Affected images: BattleTanx U and BattleTanx: Global Assault U. Both reproduce with neutral and scheduled input, and display black in the browser. At 30 seconds both have zero VI retraces, no controller commands, RSP PC `0`, SP_STATUS `1` (halted), MI pending `0`, MI mask `0x3f`, and no VI/AI event. The final idle PCs are `0x80077ab4` and `0x8009ee84`; BadVAddr is `0x10` in both. Input and a pending device interrupt do not explain these stalls.

Tracing BattleTanx U past startup identifies a TLB read fault at `0x80121854`: `LW t2, 0x10(t7)` with `t7 = 0`, during timer-list insertion. The sentinel pointer at `0x80146110` contains `0x803c7620`, but that object's next link is zero. The trace enters the fault-reporting path afterward; the final EPC `0x80077800` belongs to that path, not the first fault. The earlier COP1 unusable exception at `0x80110498` is normal lazy FPU initialization: the handler enables CU1 and ERET successfully returns to that instruction.

Global Assault E (M3) is a useful working regional control: `733 / 736`, 1485 VI retraces, and a visible language menu in the browser. Global Assault U has the same null-address/fault-idle signature, but its first fault and the cause of the missing list initialization still need tracing. Do not initialize the list artificially or treat the final idle address as the root cause. The next focused investigation is to trace writes to the timer sentinel and compare startup ordering with the European revision.

## Gauntlet Legends: reload checksum includes stack saves

All E/J/U images reproduce the same checksum-rejection path and black browser output. They have zero VI retraces and controller commands, a halted RSP, MI pending `0x10` (PI) with mask `0`, and no VI/AI event. The pending PI interrupt is masked. The CPU loops at `0x800001c8` (the US sample lands on its delay slot at `0x800001cc`).

The game enters reload/checksum code at virtual `0x80000000`, DMA-copies ROM bytes `[0x1000, 0x101000)` to physical RAM `[0x200000, 0x300000)`, and checks that buffer. Its stack pointer is `0x802033b8`; saving S0 and RA overwrites two words within the checksummed payload. Comparing the DMA buffer with the normalized ROM finds exactly these two differences per region:

| Region | RAM address | ROM word | RAM word |
| --- | --- | --- | --- |
| E | `0x2033cc` | `0xe457f80c` | `0x00000004` |
| E | `0x2033d4` | `0xda8ee35d` | `0x80201570` |
| J | `0x2033cc` | `0x3fb552c4` | `0x00000002` |
| J | `0x2033d4` | `0xae77daf2` | `0x80201570` |
| U | `0x2033cc` | `0xa493b329` | `0x00000006` |
| U | `0x2033d4` | `0xe038f915` | `0x80201570` |

An independent CIC-6102 checksum calculation on the normalized US ROM gives `0x729b5e32 / 0xb728d980`, matching its header. Running the same calculation on the RAM buffer gives `0xaaa79eaf / 0x941f46cd`, exactly matching the game's checksum registers at rejection. This establishes why the comparison fails with the observed memory contents; it does not establish which missing boot/cache behavior should prevent those writes from affecting the checksum.

The next focused investigation is the reload path's cache and stack contract. [Issue #24](https://github.com/hulkholden/n64js/issues/24) tracks missing CPU cache behavior and is relevant context, but has not been proven to be the complete fix. Avoid bypassing the checksum or restoring ROM words as a production workaround.

## Games already active and browser observations

The 12 images already active at the starting revision all have VI and audio activity. Their original final PCs often still appear, which demonstrates why a sampled PC alone is insufficient evidence of a boot stall. Representative browser checks used the normal HLE renderer with actual display-list execution and fresh save state, paused at the same 30-second deadline:

| Image/family checked | Observed output | Disposition |
| --- | --- | --- |
| Armorines G | German main menu | Original no-activity failure no longer reproduces |
| South Park U | Recognizable Acclaim logo/scene | Original no-activity failure no longer reproduces |
| Turok 2 U | Rendered Acclaim logo | Original no-activity failure no longer reproduces |
| Turok: Rage Wars E | Rendered Acclaim Studios logo | Original no-activity failure no longer reproduces |
| V-Rally Edition 99 J | Japanese Rumble Pak prompt with A-button instruction | Expected peripheral prompt after boot; headless controller traffic is active |
| Tetris 64 J | Corrupted dotted/white image | Separate graphics/startup-progress investigation required; six graphics tasks and continuing audio are not proof of correct startup |
| Virtual Pool 64 E/U | Attract/demo interface with severely distorted table geometry | Separate rendering investigation required |

Browser coverage is representative by family, plus all three Bomberman regions; it is not a full gameplay or audio-quality test of every image. Input runs and controller command counts are recorded separately in the JSON. No additional peripheral configuration was required to restore the three Bomberman images.

## Regional and revision controls

These additional 12 images all produced activity at the starting revision. The complete identities and state are in the JSON under `run: "controls"`.

| Control image | Graphics / audio |
| --- | ---: |
| `Turok - Rage Wars (U) [!].z64` | 869 / 1770 |
| `Armorines - Project S.W.A.R.M. (U) [!].z64` | 860 / 1754 |
| `BattleTanx - Global Assault (E) (M3) [!].z64` | 733 / 736 |
| `Turok 2 - Seeds of Evil (G) [!].z64` | 725 / 1752 |
| `V-Rally Edition 99 (E) [!].z64` | 3550 / 1438 |
| `Turok 2 - Seeds of Evil (E) (M4) [!].z64` | 705 / 1752 |
| `Violence Killer - Turok New Generation (J) [!].z64` | 842 / 1750 |
| `South Park (E) [!].z64` | 583 / 1754 |
| `V-Rally 99 (J) (!).n64` | 778 / 1764 |
| `Turok 2 - Seeds of Evil - Kiosk (E) [!].z64` | 715 / 1762 |
| `Turok 2 - Seeds of Evil (U) (Kiosk Demo) [!].z64` | 857 / 1761 |
| `Armorines - Project S.W.A.R.M. (E) [!].z64` | 716 / 1755 |

## Validation

- `bun test`: 254 passed, zero failed. The 18 new CPU cases exercise interpreted and compiled JR/JALR/J/JAL/BEQ/BEQL targets at zero, delay-slot execution, link registers, target instruction execution through a TLB mapping, a successful load in the delay slot, syscall BD/EPC reporting, and annulled likely branches. Against the original CPU implementation, 16 of these cases fail and the two annulled-branch controls pass.
- `bun run lint` and `bun run build` pass.
- The 20-image neutral comparison, baseline input sweep, 12 controls, and fixed Bomberman input runs complete without emulator fatal errors. Guest fault loops still count as nonfatal to the host, so inspect the dispositions above.
- `bun src/headless.js "/path/to/n64-systemtest.z64"` produced byte-for-byte identical baseline/fixed output (2478 lines, 997 test headings). Both runs reach the existing exception-storm abort at `TLB: linear icache across split 4K PFN (64-bit VA)` and time out after `5000063233` cycles. This is unchanged regression evidence, not a full systemtest pass.

ROM images, RAM dumps, and local browser-serving fixtures are not included in this report's artifacts.
