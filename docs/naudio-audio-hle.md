# NAUDIO audio HLE

This implementation follows the same first-principles process as ABI1: run local
ROMs in LLE, capture task-start memory and command lists, disassemble their RSP
programs, then compare the new handlers with execution of those instructions.
No other emulator's audio implementation, decompiled audio library, or external
DSP implementation was consulted. Existing libultra header terminology is used
for familiar command names; all NAUDIO packing and behavior below was derived
from the captures. Original bytes and disassembly remain outside the repository.

## Captured programs

| Local ROM | Exact classifier identity | Canonical ROM SHA-256 |
| --- | --- | --- |
| Army Men - Air Combat (USA) | `naudio-standard` | `9edae0d4d39ccb493bfaf8dcd3075db2582dea1b70ffcc477ee15a0048d97eea` |
| Banjo-Kazooie (USA) | `naudio-banjo-kazooie` | `59875835b9a5128bb0054315a7f929e2071c2001e528d70bf543e1d6680e6eff` |
| Donkey Kong 64 (USA) | `naudio-donkey-kong-64` | `b6347d9f1f75d38a88d829b4f80b1acf0d93344170a5fbe9546c484dae416ce3` |

A local byte/hash search also found the exact standard program in Army Men:
Sarge's Heroes and Sarge's Heroes 2. Those two games have not been run for this
implementation; finding bytes alone does not validate their command lists.
Dispatch uses the existing full program/constants classifier, never ROM names.
All three live captures use `rspboot-204`.

## Structure

`audio_base.js` owns private DMEM, typed scratch arrays, DMA and its reusable
undo journal, and the ADPCM kernel shared with ABI1. `audio_buffer.js` holds the
8/16/32-byte rounding helpers. The extracted ABI1 operations retain their existing
behavior and have been rechecked against all four supported programs.

`audio_naudio.js` provides `NAudio`, the standard command implementation.
`audio_banjo.js` and `audio_donkey_kong.js` override only the observed differences.
Shared NAUDIO layouts are named in `audio_naudio_constants.js`. DSP uses the
existing saturation and fixed-point helpers; wide intermediate arithmetic is
kept as Numbers until an instruction requires wrapping, truncation or saturation.

The task dispatcher asks the implementation for its command buffer and batch
size. NAUDIO has no segment-zero initialization. Its command loader also resets
the retained scalar temporary consumed by the variant-specific opcode 14.

All executors, views, channels and scratch arrays survive between tasks.
The undo journal grows on first encountering a larger task and keeps its capacity.
DMA copies and journal entries use signed 32-bit reads/stores to avoid boxed
unsigned values at call boundaries. There are no per-command arrays, objects,
slices or closures on the success path.

## Dispatch and buffers

NAUDIO's dispatch table starts at DMEM zero. Entries are halfword IMEM addresses.
The standard dispatch jumps at `0x10e0` and returns at `0x10ec`; Banjo uses
`0x10e4`/`0x10f0`, and DK64 uses `0x10dc`/`0x10e8`.

| DMEM address | Purpose |
| --- | --- |
| `0x00e` | Loop history RDRAM address, aliasing dispatch slots 7 and 8 |
| `0x0b0` | 64 phases × four signed resampling coefficients |
| `0x2b0` | Command buffer, `0x140` bytes per DMA batch |
| `0x3f0` | ADPCM predictor book, at most `0x100` bytes |
| `0x4f0` | Input and interleaved output area |
| `0x660` | Alternate resampler output |
| `0x9d0`, `0xb40` | Dry left and right |
| `0xcb0`, `0xe20` | Wet left and right |
| `0xfa0` | DSP scratch and saved-state staging |
| `0xfe0` | Envelope configuration vector |
| `0xff0` | Initial left volume |

The fixed mono block is `0x170` bytes: 184 signed 16-bit samples. Resampling,
mixing, envelopes and interleave use this size; there is no SETBUFF command.

## Command derivation

Addresses below refer to the standard program unless marked otherwise.
All RDRAM command pointers are the low 24 bits. DMA drops the low three address
bits and rounds lengths upward to eight bytes, as in the existing SP device.

| Opcode | Command and packing |
| --- | --- |
| 1 | ADPCM: state address in word 0; flags in word 1 bits 28–31, output count in bits 16–27, input byte offset in bits 12–15, output offset in bits 0–11 |
| 2 | CLEARBUFF: offset in word 0 low halfword, count in word 1 low halfword; rounds to vectors and clears one vector even when count is zero |
| 3 | ENVMIXER: INIT in word 0 bit 16, initial right volume in its low halfword, state address in word 1 |
| 4/6 | LOADBUFF/SAVEBUFF: count in word 0 bits 12–23, offset in bits 0–11, RAM address in word 1; count zero does nothing |
| 5 | RESAMPLE: state address in word 0; word 1 holds INIT in bits 30–31, pitch in bits 14–29, input offset in bits 2–13, output selector in bits 0–1 |
| 9 | SETVOL: flags in word 0 bits 16–23; low halfword and word 1 populate the envelope configuration |
| 10 | DMEMMOVE: input offset in word 0 low halfword, output/count in word 1 high/low halfwords; forward copies of staged 16-byte blocks |
| 11 | LOADADPCM: byte count in word 0 low halfword, RAM address in word 1 |
| 12 | MIXER: signed gain in word 0 low halfword, input/output offsets in word 1 high/low halfwords |
| 13 | INTERLEAVE: fixed input/output buffers and block size; remaining bits ignored |
| 14 | Jump into a SETVOL tail, described below; it does **not** run the nearby pole filter |
| 15 | SETLOOP: low 24 bits of word 1 stored at DMEM `0x00e` |

ADPCM at `0x139c` shares the ABI1 recurrence: signed residual nibbles, predictor
history, a signed 32-bit wrapped accumulator, an 11-bit shift and saturation.
Output count rounds up to 32 bytes; count zero still imports/clears and saves
history. INIT and LOOP are tested independently as in the original instructions.

Resampling at `0x17ec` stages eight windows before storing each vector. Every tap
uses rounded, saturated VMULF, then two saturated pair sums and a saturated final
sum. Phase advances by twice the packed pitch per sample. The saved state is
16 bytes: four history samples, an unsigned phase halfword, and six bytes the
handler never writes. INIT clears the input history but retains those six scratch
bytes when saving; continuation loads and preserves them from RAM.

SETVOL at `0x127c` uses flag bit 2 to select a volume/right-target branch and
bit 1 to select initial left volume plus dry/wet gain. With bit 2 clear it writes
the left target and signed 16.16 increment. The other branch writes the right
target/increment. The initial right volume instead comes from ENVMIXER itself.

ENVMIXER at `0x1a64` initializes eight lanes with weights 1/8 through 7/8 and
65535/65536. It adds a signed 16.16 increment per vector, wrapping fractional
carry and saturating the high word independently. Nonnegative rate high words
select signed minimum against the target; negative high words select signed
maximum. Both dry and wet buses always run. Five vectors (80 bytes) are saved.
MIXER and envelope output use the existing combined rounded destination VMULF
plus source VMACF helper, preserving the accumulator until final saturation.

## Specializations

All three tables contain `0x02b0` at slot 14. RSP instruction addressing wraps
that to `0x12b0`, inside SETVOL, even though the unused pole filter remains in
the program. Actual live lists exercise this slot in Army Men and Banjo.

- Standard: writes word 1's low halfword into the right fractional increment.
- Banjo: the extra dispatch instruction shifts SETVOL by four bytes. The same
  target now first writes scalar `v0` to the right integer increment, then writes
  the low halfword. `v0` must be retained across commands and cleared at DMA batch
  boundaries; treating this as a no-op or a filter is incorrect.
- DK64: the target writes the left target, integer increment from `v0`, and
  fractional increment from word 1. Synthetic instruction comparisons cover it;
  the captured DK64 live lists did not contain opcode 14.

DK64 additionally derives all-one masks from the low bits of dry and wet gain at
`0x1a98–0x1aa8`. The dry bit complements input samples before the left channel's
products; the wet bit complements them before the right channel's products.
This is bitwise complement, not arithmetic negation. Both buses use the selected
sample, and the gain still includes its original low bit.

DK64 slots 7 and 8 initially alias MIXER. They are supported only while their
actual table entries still name that handler: SETLOOP overwrites both entries.
The other variants do not have those aliases. Slot zero jumps straight to the
loop without decrementing its batch counter, so HLE rejects it instead of
assuming it is an ordinary no-op.

## Task eligibility and fallback

The two recognised rspboot programs mask only OSTask's DP_WAIT flag. Army Men
captures contain arbitrary other flag bits, which the RSP ignores. NAUDIO HLE
checks SP signal zero, the actual bootstrap yield request, and falls back if it
is set or its status is unavailable. DP_WAIT requires DPC DMA idle; the NAUDIO
entry also waits when XBUS mode and DPC DMA busy are both set. DMA busy alone
without DP_WAIT or XBUS is allowed, matching the instructions at `0x1080–0x10a8`.

Nonzero entry PC, unsupported instructions, buffer layouts outside the reviewed
DMEM range, overlapping mixer buffers, invalid predictors and malformed command
lists fall back. Private DMEM is published only on success; previous RAM writes
are undone before LLE reruns the task. NEAD and unreviewed identities remain LLE.

## Validation and reproduction

Capture 900 VI frames for each ROM with `capture.js`, then replay every prefix
listed in its `capture.json`. The local directories used here are
`/tmp/army-naudio`, `/tmp/banjo-naudio`, and `/tmp/dk64-naudio`.

```sh
bun tools/audio_hle/capture.js '/Volumes/Data/Roms/Banjo-Kazooie (USA).z64' /tmp/banjo-naudio 900 100
bun tools/audio_hle/replay.js /tmp/banjo-naudio/1 /tmp/banjo-naudio/200
bun tools/audio_hle/differential_naudio.js /tmp/banjo-naudio/1
bun tools/audio_hle/fallbacks.js /tmp/banjo-naudio/200
bun tools/audio_hle/validate_rom.js '/Volumes/Data/Roms/Banjo-Kazooie (USA).z64' 1800
node tools/audio_hle/benchmark.js /tmp/army-naudio/200 /tmp/banjo-naudio/200 /tmp/dk64-naudio/200 --iterations=600 --warmup=400 --profile=/tmp/naudio.heapprofile
```

| Program | Captures | Commands compared | RSP instructions |
| --- | ---: | ---: | ---: |
| Standard | 21 | 4,757 | 1,600,293 |
| Banjo | 17 | 4,917 | 975,585 |
| DK64 | 17 | 10,345 | 1,985,196 |

Replay compares the predictor/sample area and persistent parameters after every
command, each RSP RAM write, and the entire final RAM image from the production
dispatcher. It retains a single production runtime across captures and identity
changes. The synthetic tool runs 1,000 trials per supported opcode: 13,000 each
for standard/Banjo, 15,000 for DK64 including the aliases. Inputs include random
samples/state/codebooks, extreme signed envelopes, all ADPCM flags, all nibble
scales, short/zero counts, misaligned DMA, overlapping moves, full pitch range,
and the scalar `v0` observed by opcode 14.

Each ROM also ran live for 1,800 VI frames with a separate instruction-executed
oracle at every task. Army Men verified 1,242 tasks, Banjo 886, and DK64 865;
all had zero fallbacks and nonzero PCM output. These are neutral-input startup
runs, not a claim of complete gameplay or hardware timing validation.

Each variant passes 12 atomic fallback/recovery cases, idle DP_WAIT, ignored
flag bits and non-XBUS DMA busy. ROM-independent unit tests cover command packing,
variant behavior, saved-state preservation and scratch reuse. Existing ABI1 unit,
replay and 20,000 synthetic DSP comparisons pass after sharing the memory and
ADPCM implementation.

A warmed Node heap-sampling run reported zero sampled bytes in audio HLE functions
across 600 tasks. This is evidence about the measured success paths, not proof
that a first task, a larger journal or an exceptional fallback never allocates.
