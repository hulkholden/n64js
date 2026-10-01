# ABI1 audio HLE variants

Audio HLE support is a work in progress. The runtime selects implementations by
the classifier's exact reviewed identity, never by ROM name or ABI1 family alone.
Select **Audio → Emulation Mode → HLE**; LLE remains the default and the fallback
for unsupported identities or command shapes.

| Reviewed identity | Class | Variant behavior |
| --- | --- | --- |
| `abi1-standard-mixer` | `ABI1Audio` | Rounded, saturated multiply-and-accumulate |
| `abi1-tetrisphere-us-mixer` | `TetrisphereAudio extends ABI1Audio` | No sample writes |
| `abi1-goldeneye-mixer` | `GoldenEyeAudio extends ABI1Audio` | Standard MIXER; additive volume envelopes |
| `abi1-diddy-blast-mixer` | `DiddyBlastAudio extends GoldenEyeAudio` | Additive envelopes; relocated resampler table |

`src/hle/audio_abi1.js` owns the command constants, dispatch, DMEM/RDRAM helpers,
write rollback and shared DSP handlers. It also supplies the standard `mix()`.
`src/hle/audio_tetrisphere.js` overrides only `mix()`.
`src/hle/audio_goldeneye.js` overrides `initializeEnvelope()` and
`advanceEnvelope()`; envelope buffer handling, target selection, mixing and saved
state remain shared. See the [GoldenEye derivation](goldeneye-audio-hle.md).
`src/hle/audio_diddy_blast.js` inherits those additive envelope hooks and overrides
the resampler table address; see the [Diddy/Blast derivation](diddy-blast-audio-hle.md).
The selector in `src/hle/hle_audio.js` explicitly maps these identities to their
classes. These are all four ABI1 identities in the current classifier manifest.
Unknown programs still fall back. The reviewed NEAD and NAUDIO families have
their own [NEAD](nead-audio-hle.md) and [NAUDIO](naudio-audio-hle.md) derivations. This
keeps variant changes local to the behavior established by captured instructions.

The reviewed `rspboot-208` path accepts `OS_TASK_DP_WAIT` when DPC DMA is already
idle. A busy or unavailable DPC status, other task flags, or an unreviewed
bootstrap/flag combination retains LLE execution of the original wait. Diddy
Kong Racing exercises this flag on every captured task.

## Reusable storage and profiling

Each hardware instance retains its ABI1 executors, working DMEM, DSP vectors,
envelope channels, task views and classifier result lists. Commands overwrite
the scratch lanes they use. RDRAM DMA uses word copies and a reusable undo
journal; overlapping writes are restored in reverse order on fallback. Journal
capacity grows when first needed and survives both successful and rejected
tasks. DMEM is refreshed from the current task on every execution.

The runtime uses synchronous views of task, code and constant memory instead of
copying snapshots. Classification still checks every protected byte on every
task and revalidates the task layout. The default path classifies once; enabled
observers get an owned result object, and HLE rechecks memory after the callback.
Offline `captureAudioTask()` and default classifier results remain owned copies
and objects. Repeated debug messages are suppressed before formatting strings.

After buffers and caches are warm, normal commands and dispatch reuse their
storage. First use, memory/address changes, new hashes, journal growth, new log entries,
unsupported-command exceptions and optional observer/capture output can still
allocate. Buffers belong to the emulator instance rather than a global singleton.

The capture benchmark isolates `hleProcessAudioTask()` time, excluding ROM
execution, disk I/O and restoring the input RAM image. It reports medians and
90th percentiles; optional Node heap sampling includes collected objects:

```sh
node tools/audio_hle/benchmark.js /tmp/tetrisphere-audio/29 /tmp/tetrisphere-audio/1000 \
  /tmp/sm64-audio-extended/143 /tmp/sm64-audio-extended/1700 \
  --profile=/tmp/audio.heapprofile
```

Use `--module=/path/to/baseline/src/hle/hle_audio.js` to benchmark another checkout
with the same inputs, and `--warmup=150 --iterations=400` to set the run lengths.
On 2026-09-28, Node v24.13.1, the default warmup and sample counts gave these
median task times versus `70d1ee1` (which already includes the initial sample-loop
optimizations):

| Capture | Before (µs) | Reusable storage (µs) |
| --- | ---: | ---: |
| Tetrisphere 29 | 167.4 | 60.6 |
| Tetrisphere 1000 | 742.7 | 580.9 |
| Mario 143 | 208.3 | 38.7 |
| Mario 1700 | 811.7 | 267.7 |

Across a separate 800-task heap sample, allocations attributed to the audio HLE
modules fell from approximately 215 KB per task to zero sampled bytes after
warmup. Sampling is an estimate, not a proof that every engine or task allocates
nothing. These measurements describe captured HLE work, not total emulator FPS.

Reuse validation passed 1,474 unit tests, lint/build, 10,000 DSP comparisons,
62 captures through a shared runtime and 16 fallback/recovery cases. Live runs
of 1,800 frames per game checked all 1,785 Tetrisphere and 1,788 Mario tasks with
zero fallbacks. Both PCM hashes match the previously recorded values exactly.

## Evidence for sharing the handlers

Super Mario 64 (USA) was run locally and its task-start program, constants and
audio lists captured. The normalized ROM SHA-256 was
`17ce077343c6133f8c9f2d6d6d9a4ab62c8cd2aa57c40aea1f490b4c8bb21d91`.
The first audio task appeared at VI retrace 4 and classified as
`abi1-standard-mixer`, with bootstrap `rspboot-208`.

The first task declared program address `0x32c740`, data address `0x33a2c0`,
data size `0x2c0`, list address `0x1d3700` and list length `0x1e8` (61 commands).
The loader still transfers its fixed program window to IMEM `0x1080`.

Comparison with the captured Tetrisphere USA program established:

- All **3,492 code bytes** at IMEM `0x1080–0x1e23` are identical, including task
  entry, batching, DMA, dispatch, ADPCM, resampling, envelope and pole filtering.
- All **704 initialized constant bytes** are identical, including the dispatch
  table and resampler coefficient table.
- MIXER begins at `0x1e24` in both, but the standard program contains the arithmetic
  and sample stores absent in Tetrisphere. The standard handler returns at
  `0x1e94–0x1e98`.

These byte comparisons, the disassembly, and execution of the original guest
instructions are the implementation sources. No other audio HLE or ported mixer
implementation was consulted. The original libultra header and the detailed
shared DSP derivations are linked in the [Tetrisphere research notes](tetrisphere-audio-hle.md).
No ROM-derived instructions, constants, samples or captures are checked in.

## Standard MIXER derivation

The command's low halfword is signed gain. Its second word contains source and
destination halfword offsets, each relative to DMEM `0x5c0`. The current SETBUFF
count supplies the length. A zero count exits; other lengths round up to 32 bytes.

`0x1e4c–0x1e58` load two vectors from each buffer. `0x1e5c/0x1e64` apply VMULF
to the first destination vector with constant 32767, then VMACF with the first
source vector and gain. `0x1e70/0x1e78` repeat for the second vectors. The combined
accumulator is shifted and saturated when stored:

```text
accumulator = oldDestination * 32767 * 2 + 32768 + source * signedGain * 2
newDestination = clampSigned16(floor(accumulator / 65536))
```

Rounding the products independently or simply adding `oldDestination` gives
different results. Even zero gain slightly attenuates large destination samples.
Tests cover signed gain, rounding ties, saturation, in-place mixing, the separate
packed offsets and 32-byte count rounding. Partial overlap is conservatively
rejected: the original program prefetches future source vectors between its two
stores, so an ordinary scalar forward loop is not equivalent for every overlap.

## Envelopes without auxiliary output

Mario's later lists also exercise flags 0 and 1 for ENVMIXER. This is a shared
handler path, not a variant-specific opcode difference. At `0x1bd4–0x1be8`,
clearing AUX replaces both wet output pointers with `scratch + 0x50` and sets
their advance to zero. Both dry channels and the full 80-byte saved envelope
state are still processed.

HLE omits these discarded wet scratch writes. This vector is outside the saved
state and supported sample buffers; it has no subsequent DSP-visible use in the
reviewed command domain. Configured wet buffers therefore remain untouched.
This agrees with command-boundary and complete RDRAM comparisons, including
initialization and continuation. As with other instruction-private temporaries,
HLE does not promise exact scratch or vector-register residue.

## Aidyn Chronicles segment-base lookup

The USA ROM's first audio task at VI frame 3 reproduced the reported fallback.
Command 61 is `06000000 801aaf30` (SAVEBUFF); HLE rejected the high-byte index
0x80 because it assumed every read used one of the sixteen conventional segment
entries. The RSP does not enforce that limit. At `0x1264–0x1270` it shifts the
entire high byte left by two, reads a word at `0x320 + index * 4`, and adds that
base to the command's low 24 bits. Aidyn's pointer therefore reads DMEM 0x520,
within the predictor book. Simply stripping the 0x80 prefix would fail when
that word is nonzero.

All four reviewed ABI1 programs perform the same address lookup. The HLE now
reads that live DMEM word, wraps the sum to 32 bits, and masks DMA addresses to
24 bits. SETLOOP preserves the full sum, matching the SW at `0x1464` in the
standard program. Out-of-RAM DMA still rejects the task atomically. SEGMENT
writes beyond the conventional table remain outside the reviewed domain.
No extra buffers, views or per-command allocations are introduced.

The first capture matches all 377 command results and the complete final RAM.
It is retained under `/tmp/aidyn-abi1-failure/failure`; disassembly is in
`/tmp/aidyn-abi1-disassembly.txt`. Separate 1800-VI-frame runs of the USA and
European ROMs completed 1797 and 1798 audio tasks respectively, with nonzero PCM,
no fallbacks and no oracle output mismatches. These runs cover startup/attract
behavior, not exhaustive gameplay.

`differential_abi1_addresses.js` executes LOADBUFF, SAVEBUFF, LOADADPCM and SETLOOP
using every high-byte index and four base patterns, including sign bits and
overflow. All 16384 comparisons across the four ABI1 programs pass. The existing
20000 DSP trials now additionally use extended indices and nonzero/high-bit bases.
Eleven fallback/reuse cases pass on the Aidyn capture. The standalone fix passed
1585 unit tests, lint and build, without requiring the open NEAD or NAUDIO PRs.

## Armorines ADPCM predictors

The initial snapshot investigation found another fallback after the Aidyn
address fix. The USA ROM first
rejects audio task 1229 at VI frame 1236; the European ROM rejects task 1251 at
frame 1048. USA command 190 (`01000000 0075bf60`) decodes from DMEM 0x5c0 to
0x700 with count 352. Its second compressed frame has header 0xdd, selecting
predictor 13, beyond the original HLE's eight-entry limit.

At `0x1538–0x1544`, the standard RSP program masks the full four-bit index,
multiplies it by 32 and adds the book base 0x4c0. Entries 8–15 read coefficients
from sample memory at 0x5c0–0x6bf. The other three ABI1 programs agree. This is
the ABI1 counterpart of Tony Hawk 3's NAUDIO issue. HLE now permits those reads
while keeping the accessible coefficients below output, preserving fallback for
unsafe coefficient/output overlap. The LOADADPCM size guard remains unchanged.
The fix adds no allocations and is independent of both the Aidyn and NAUDIO PRs.

Both failure captures replay successfully: 1079 commands and complete final RAM
match the original RSP programs. Captures are under `/tmp/armorines-abi1-failure/`
and `/tmp/armorines-europe-abi1-failure/`; the disassembly is retained in
`/tmp/armorines-abi1-disassembly.txt`. Runs of 2400 VI frames completed 2390 USA,
2870 European and 2870 German audio tasks with nonzero PCM, zero fallbacks and
zero snapshot-oracle mismatches. These checks froze RAM at task start in both
paths, so they did not establish equivalence to an independent live LLE run.
The concurrent-transfer investigation below supersedes that audio-quality claim.

The 20000 synthetic DSP comparisons across all four ABI1 programs now exercise
every predictor index, including coefficients that overlap compressed input.
Eleven atomic fallback/reuse checks pass on the USA capture. The standalone
branch passes 1577 tests, lint and the production build.

## Armorines concurrent sample transfers

The reported USA title/menu corruption is caused by synchronous HLE reading
compressed samples before the CPU's PI DMA queue has finished uploading them.
The first divergence in independent 2400-frame boots is audio task 1220, command
37 (`04000000 0075e420`): HLE reads 64 zero bytes, while the live RSP reaches the
load after a PI upload and reads a valid compressed frame starting with 0x52.
The command-list hashes are identical. The upper predictor indices encountered
later in the earlier investigation were downstream of this stale-input issue;
supporting the full instruction-defined lookup did not repair the timing race.

Checking only PI busy at task entry is insufficient. At task 1238, PI status is
zero, but the CPU submits another sample transfer shortly after starting RSP.
PI now maintains an allocation-free DMA generation, advanced on submission and
hardware reset. Audio HLE conservatively falls back whenever that generation
has changed since the previous HLE-mode audio task, or PI remains busy. It can
resume after an interval without PI activity. The decision precedes any HLE
writes and is independent of ROM name and microcode family. The first fallback
of this kind logs `LLE (HLE fallback: PI DMA activity)` separately from an
unsupported-command fallback.

Independent USA boots now agree byte for byte through 2400 VI frames: 2390 audio
tasks, 2389 AI buffers and 3516608 PCM bytes, SHA-256
`09984446b1d628ca2525afc5aea167910a052a24c04965be39300fcbaddb2f78`.
The standalone runtime PR also produces this digest, with 1212 HLE tasks and
1178 streaming fallbacks. These results do not depend on the Aidyn or NEAD PRs.

An extended 3600-frame run presses Start at frames 1800 and 2100 for eight frames
each. Both modes execute the same 3588 command lists and play 3587 AI buffers
(5280064 bytes). The HLE-selected run uses 1216 HLE tasks and 2372 LLE fallbacks.
The large corruption is gone, but these streams are not bit-identical: the
largest signed 16-bit sample difference is 32. Tracing the first difference,
task 2241, finds an RSP read at DMEM 0x5c0 / RDRAM 0x761a20 on opposite sides of
a concurrent PI upload. Both tasks execute LLE, with matching task-start audio
RAM and DMEM; incoming vector-register differences do not change isolated
replay. Their live reads differ by 126 CPU cycles, so one sees the old compressed
frame and the other the replacement. Thus this guard addresses observed early
HLE reads, but does not provide cycle-identical execution or prove general
safety for transfers whose first submission occurs after task entry.

The new `capture_pcm.js` tool records actual AI output and per-task execution
paths from reset. Use independent runs as well as command-level DSP replay:

```sh
bun tools/audio_hle/capture_pcm.js '/Volumes/Data/Roms/Armorines - Project S.W.A.R.M. (USA).z64' HLE 2400 /tmp/armorines-hle
bun tools/audio_hle/capture_pcm.js '/Volumes/Data/Roms/Armorines - Project S.W.A.R.M. (USA).z64' LLE 2400 /tmp/armorines-lle
cmp /tmp/armorines-hle.pcm /tmp/armorines-lle.pcm
```

Regression tests use a synthetic microcode identity and real emulated PI DMA to
cover active transfers, idle gaps, reset and HLE resumption, including unchanged
RAM/DMEM on fallback. No ROM bytes are checked in. The standalone PR passes 1581
tests, lint and the production build.

## Reproduction

Use the local ROM and an output directory outside the repository:

```sh
bun tools/audio_hle/capture.js '/Volumes/Data/Roms/Super Mario 64 (USA).v64' /tmp/sm64-audio 600 100
bun tools/audio_hle/replay.js /tmp/sm64-audio/1 /tmp/sm64-audio/200
bun tools/audio_hle/differential.js /tmp/sm64-audio/1
bun tools/audio_hle/fallbacks.js /tmp/sm64-audio/1
bun tools/audio_hle/validate_rom.js '/Volumes/Data/Roms/Super Mario 64 (USA).v64' 600
```

The same tools select the Tetrisphere subclass when given its captures. For the
extended Mario run, an optional input JSON file pressed Start at retraces 240 and
360, then A at 480, 600, 720, 960, 1200 and 1440. Every press lasted eight retraces.
For example, a Start press is `[{"frame":240,"buttons":4096},{"frame":248,"buttons":0}]`.
Pass the input file as the final argument to capture or live validation. This
input sequence is not a claim of complete gameplay coverage.

## Validation

- Super Mario 64: **1,788 live audio tasks across 1,800 VI retraces**, all compared
  with isolated execution of their original RSP program, with **zero fallbacks**.
  The oracle executed **216,367,703 instructions**. AI dequeued **3,814,400 PCM
  bytes**, of which **3,187,822 were nonzero**. PCM SHA-256:
  `bd0ceeb9aee05f55fa26211221d340c0f0187bbea382f6f563e6116cab8f1e61`.
- Mario capture replay: **23 lists, 8,903 commands, 2,349,466 RSP instructions**.
  Parameters, sample buffers and RSP stores agree after each command. Separately,
  the production HLE task dispatcher agrees on the entire final RDRAM image.
- Tetrisphere regression after refactoring: **585 live tasks / 600 retraces**, zero
  fallbacks, plus **37 saved lists / 27,229 commands** replayed successfully.
- **5,000 deterministic synthetic DSP trials per identity**, covering ADPCM,
  resampling, envelope mixing with/without AUX, MIXER and pole filtering.
- ROM-independent unit tests exercise shared commands through both classes,
  standard mixer arithmetic, the Tetrisphere override and exact identity selection.
  The full suite passes **1,463 tests**, including 30 ABI1 tests; lint and the
  browser bundle build also pass.

The reference is n64js's existing RSP interpreter, not physical-console audio.
Task timing is still synchronous. Short envelopes, zero-length resampling,
unreviewed overlapping/wrapping buffers and unsupported task layouts retain the
existing atomic LLE fallback. Supporting one standard executable does not enable
every program labelled ABI1.
