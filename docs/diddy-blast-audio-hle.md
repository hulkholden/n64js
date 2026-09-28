# Diddy Kong Racing / Blast Corps ABI1 audio HLE

`abi1-diddy-blast-mixer` was the last ABI1 identity without an HLE handler in the
current classifier manifest. Local runs of Diddy Kong Racing (USA) (En,Fr) and
Blast Corps (USA) confirmed that both use the same reviewed executable and
initialized constants. `DiddyBlastAudio extends GoldenEyeAudio`, and therefore
`ABI1Audio`, handles this identity. Only the resampler table address needs a new
override; the additive envelopes reuse GoldenEye's derived implementation.

All comparisons below use the captured RSP instructions, the existing n64js RSP
interpreter, and original libultra header definitions. No external audio HLE or
reconstructed DSP implementation was consulted. Captures, microcode, coefficient
tables and samples are kept outside the repository.

## Capture identities

| | Diddy Kong Racing USA | Blast Corps USA |
| --- | --- | --- |
| Normalized ROM SHA-256 | `dcf54c82a58f6b38603b5865e90c3baabfe553a4d141a1ea2b282170a2e98876` | `902769f9d27d888a35d8bdbec88ae9f4f3f33583323475678e99b6456eeaa6f5` |
| First task VI retrace | 4 | 6 |
| Bootstrap address | `0x0d84c0` | `0x2e6770` |
| Program address | `0x0d7600` | `0x2e6840` |
| Data address | `0x0e98d0` | `0x30eae0` |
| First list address / bytes | `0x0fd330` / `0x1f20` | `0x38c2b0` / `0x1590` |
| First list commands | 996 | 690 |
| OSTask flags | `0x2` | `0x0` |

Both use `rspboot-208`, declare program size zero and data size `0x800`, and load
the usual fixed `0xf80`-byte program window at IMEM `0x1080`. All **3,776 protected
program bytes** and **720 protected constant bytes** match between the ROMs.
No classifier hashes were added or relaxed.

## Shared layout and command behavior

The segment table (`0x320`), parameters (`0x360`), command batch (`0x380`, 320
bytes), predictor book (`0x4c0`), sample buffer (`0x5c0`) and scratch (`0xf90`) are
unchanged. The loader still clears only segment zero and dispatches at
`0x10e4–0x1110`, returning from each handler to `0x1118`.

| Opcode | Handler | Comparison with the supported ABI1 domain |
| --- | --- | --- |
| 0 SPNOOP | `0x1118` | Same return to dispatch |
| 1 ADPCM | `0x14a4` | Same decode/history arithmetic; different DMA synchronization |
| 2 CLEARBUFF | `0x11ec` | Same 16-byte rounding; zero remains a no-op |
| 3 ENVMIXER | `0x1ba0` | GoldenEye additive progression and saved state |
| 4 LOADBUFF | `0x123c` | Same aligned DMA; waiting is deferred |
| 5 RESAMPLE | `0x18d4` | Same arithmetic/state, coefficients relocated to `0x0d0` |
| 6 SAVEBUFF | `0x1270` | Same aligned DMA; waiting is deferred |
| 7 SEGMENT | `0x12d4` | Same segmented-address table update |
| 8 SETBUFF | `0x12f0` | Same main/AUX buffer parameters |
| 9 SETVOL | `0x132c` | Same packed fields, interpreted as additive increments |
| 10 DMEMMOVE | `0x1428` | Same forward, 16-byte load-before-store copies |
| 11 LOADADPCM | `0x12a4` | Same predictor DMA; waiting is deferred |
| 12 MIXER | `0x1e3c` | Same sample arithmetic/count rounding, different prefetch order |
| 13 INTERLEAVE | `0x1390` | Same left/right samples; individual halfword stores |
| 14 POLEF | `0x1758` | Same recurrence/history arithmetic; different DMA synchronization |
| 15 SETLOOP | `0x1480` | Same resolved state pointer |

DMA helpers at `0x1194` and `0x11c0` mark outstanding work in `s6`. Handlers wait
before consuming or overwriting that data, and `0x1138–0x1144` waits before task
completion and releases the semaphore. These scheduling changes do not need a
separate DSP implementation: HLE completes each DMA synchronously. Instruction
timing and temporary register residue are outside the HLE contract.

INTERLEAVE loads both input vectors at `0x13c4/0x13c8`, then stores alternating
left/right halfwords at `0x13cc–0x1408`. The shared HLE already stages both vectors
before any output writes. DMEMMOVE likewise loads both eight-byte halves at
`0x1458/0x145c` before its stores at `0x1468/0x146c`.

## Additive envelopes and relocated constants

The inserted constant vector at DMEM `0x40` shifts the existing `0x40–0x2bf`
constant region by 16 bytes. Direct comparison shows the original resampler's
512 coefficient bytes unchanged at `0x0d0–0x2cf`, along with the shifted index
vectors and envelope interpolation weights.

RESAMPLE sets its coefficient base to `0x0d0` at `0x1990` and its vector constant
base to `0x50` at `0x19a4`. The index values, per-tap rounded/saturated multiply,
pairwise saturated addition, eight-output staging and 32-byte saved state are
unchanged. The shared handler reads its table base through an overridable getter,
once per command, and continues using coefficients from the task's own DMEM.

ENVMIXER moves its constant base to `0x50` at `0x1bc8`. Its initialization at
`0x1c88–0x1ca0` / `0x1ce4–0x1cfc` and VADDC/VADD progression beginning at `0x1d48`
match the [GoldenEye derivation](goldeneye-audio-hle.md). Branch targets relocate,
and DMA waits are added, but the arithmetic, signed-high-word target choice,
fractional carries, dry/wet accumulation and 80-byte saved state are the same.
Both shared envelope hooks are therefore inherited directly.

## MIXER prefetching

The command still supplies signed gain and two offsets relative to `0x5c0`.
`0x1e8c/0x1e98` and subsequent VMULF/VMACF pairs use the same combined accumulator
as standard ABI1:

```text
newSample = clampSigned16(floor((oldSample * 32767 * 2 + 32768
                              + source * signedGain * 2) / 65536))
```

The new pipeline preloads four vectors, processes the first two, then loops over
64-byte groups. Its epilogue stores an additional 32 bytes only when required.
Zero count returns immediately; nonzero counts still round up to 32 bytes. The
different prefetch order gives the same result for disjoint buffers or exact
in-place mixing. Partial overlap remains rejected rather than assuming that a
scalar forward loop reproduces that order.

The synthetic oracle now tests MIXER counts around 32-, 64-, 96- and 128-byte
boundaries, including zero, one byte, signed gains and exact in-place buffers.

## Diddy's task flag

All captured Diddy tasks set bit 1, named `OS_TASK_DP_WAIT` in the original
libultra 2.0I [PR/sptask.h](https://raw.githubusercontent.com/n64decomp/libreultra/master/include/2.0I/PR/sptask.h),
revision 1.8. The captured `rspboot-208` reads it at `0x1068–0x1070`; the selected
path checks DPC status bit `0x100` at `0x1080–0x1088` before loading task data.
This is a wait request, not a yielded task.

HLE accepts this flag only for the reviewed bootstrap and only when DPC DMA is
already idle. Busy or unavailable status falls back without touching memory, so
the original bootstrap handles its wait. Yielded tasks, other flag bits, unknown
programs, unusual entry points and unsupported buffer shapes still fall back.
Offline replay and benchmark fixtures explicitly supply idle DPC status; fallback
tests cover busy and missing status as well as successful idle execution.

## Reproduction

```sh
bun tools/audio_hle/capture.js '/Volumes/Data/Roms/Diddy Kong Racing (USA) (En,Fr).v64' /tmp/diddy-audio 600 100
bun tools/audio_hle/capture.js '/Volumes/Data/Roms/Blast Corps (USA).v64' /tmp/blast-audio 600 100
bun tools/audio_hle/replay.js /tmp/diddy-audio/1 /tmp/diddy-audio/200 /tmp/blast-audio/1 /tmp/blast-audio/200
bun tools/audio_hle/differential.js /tmp/diddy-audio/1
bun tools/audio_hle/fallbacks.js /tmp/diddy-audio/200
bun tools/audio_hle/validate_rom.js '/Volumes/Data/Roms/Diddy Kong Racing (USA) (En,Fr).v64' 600
bun tools/audio_hle/validate_rom.js '/Volumes/Data/Roms/Blast Corps (USA).v64' 600
```

Both extended runs used 1,800 retraces with Start pressed at 240 and 360; A at
480, 600, 720, 840, 960, 1080, 1200, 1320, 1560 and 1680; and Z at 1440. Every
press lasted eight retraces. Pass the corresponding JSON event file as the final
argument to capture or validation. This input sequence does not establish full
gameplay coverage.

## Validation

- Diddy: **898 live tasks over 1,800 retraces**, **zero fallbacks** and
  **124,396,187 oracle RSP instructions**. AI dequeued **2,639,808 PCM bytes**, of
  which **2,266,351 were nonzero**. PCM SHA-256:
  `a5fabf3c88fd367b7344613b7948e75b10e258439315111da7f8895459ae8da8`.
- Blast Corps: **897 live tasks over 1,800 retraces**, **zero fallbacks** and
  **152,674,325 oracle RSP instructions**. AI dequeued **2,633,536 PCM bytes**, of
  which **2,507,742 were nonzero**. PCM SHA-256:
  `43791bec44f1ec61b9665e891d36cced5249108bdbb3aa390442f8e9da96eb03`.
- **32 new captures** matched at command boundaries and across complete final
  RDRAM images: Diddy **17,024 commands / 2,025,107 instructions**, Blast Corps
  **15,446 commands / 2,080,465 instructions**. The same reused runtime also
  passed the previous **81 captures** from Mario, Tetrisphere and GoldenEye.
- **5,000 DSP trials per identity**, covering all four supported ABI1 identities,
  including full signed additive-envelope values and the expanded MIXER counts.
- **11 atomic rejection/recovery cases per game**, plus explicit idle-DP handling,
  across all five tested games. The two reviewed bootstrap types retain their
  separate flag acceptance rules.
- **1,535 unit tests**, lint and the browser build passed. The **72 audio tests**
  include all four identity mappings, shared additive-envelope behavior, MIXER
  variants and first/last-phase resampling with refreshed task coefficients.

The new subclass allocates no additional buffers. After 150 warmup iterations,
Node v24.13.1 measured median task times of **178.1 / 307.5 µs** for Diddy captures
200 / extended 800 and **116.5 / 355.5 µs** for Blast captures 200 / extended 800.
A separate 800-task heap sample recorded **zero sampled bytes** attributed to the
audio HLE modules. Sampling does not prove every engine or input allocates nothing.
The mixed Mario/Tetrisphere/GoldenEye benchmark had slightly lower task medians
after this change, with small allocation samples on both versions (4.1 bytes/task
before, 7.2 after). The zero-allocation sample above is specific to the new
Diddy/Blast workload.

These results use n64js's RSP interpreter as the oracle, not physical hardware.
All four ABI1 identities currently in the manifest now have implementations;
this does not establish support for every unclassified ABI1 executable or the
separate NAUDIO and NEAD families.
