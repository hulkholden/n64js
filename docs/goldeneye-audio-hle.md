# GoldenEye ABI1 audio HLE

`GoldenEyeAudio extends ABI1Audio` implements `abi1-goldeneye-mixer`. Its only
overrides are envelope initialization and advancement. The runtime selects it by
the existing classifier's exact code/constants identity; other ABI1 programs
are not enabled by this change. Unsupported task and buffer shapes retain atomic
LLE fallback.

The implementation was derived from a local GoldenEye 007 (USA) ROM capture,
comparison with the previously captured Super Mario 64 program, and execution of
the original RSP instructions. Command names and packing use the original
libultra header described in the [Tetrisphere research notes](tetrisphere-audio-hle.md).
No other emulator's audio implementation or reconstructed mixer was consulted.
Captures, instructions, coefficient tables and sample data remain outside git.

## Capture and comparison

The normalized USA ROM SHA-256 is
`2cdcec8a9f0cb6e36337f3ee39d8ad105dc8afa6ba1c02d466e8f5b771f9a162`.
The first audio task appeared at VI retrace 31 and used `rspboot-204`:

- Bootstrap: RDRAM `0x020d90`, declared size `0xd0`.
- Program: `0x022280`, declared size zero; rspboot loads its fixed `0xf80` bytes.
- Data: `0x05d020`, declared size `0x800`.
- Command list: `0x2e5d90`, length `0x1158` (555 commands).

Comparison with `abi1-standard-mixer` established:

- All 2,924 bytes at IMEM `0x1080–0x1beb` are identical. This includes the task
  loader, dispatch, DMA, buffer commands, ADPCM, pole filter, resampler and the
  initial ENVMIXER setup.
- All 704 protected constant bytes match except the dispatch halfword at DMEM
  `0x28`, which relocates MIXER from `0x1e24` to `0x1dc8`.
- MIXER's 120 bytes at `0x1dc8–0x1e3f` are identical to the standard handler at
  `0x1e24–0x1e9b`. The shared rounded, saturated accumulation is therefore retained.
- ENVMIXER starts at `0x1b38` in both programs. GoldenEye replaces multiplicative
  volume progression with addition, shortening the handler by 92 bytes.

The DMEM layout, SETVOL packing, two channels of eight signed integer/unsigned
fractional volume lanes, and five-vector (80-byte) saved state are unchanged.
The fields named `rateHi`/`rateLo` in the shared channel storage represent an
additive signed 16.16 increment in this variant.

## Envelope initialization

At `0x1c08–0x1c20` (left) and `0x1c64–0x1c7c` (right), VMUDL and VMADN multiply
the unsigned interpolation weights by the low and signed high words of the
increment. VMADM/VMADH add the initial integer volume. Each lane's accumulator is:

```text
weight = (lane + 1) * 8192, except lane 7 uses 65535
increment = signedHigh * 65536 + unsignedLow
value = initialVolume * 65536 + floor(increment * weight / 65536)
```

The resulting integer word saturates to signed 16 bits. The fractional word is
the low 16 bits while the accumulator fits signed 32 bits, zero on negative
overflow, and 65535 on positive overflow. This follows the VMADH/VMADN results,
including overflow with extreme initial volumes and increments.

Unlike standard ABI1, the increment is not multiplied by the initial volume,
and the initial volume is not subtracted from a rate-scaled product. For example,
initial volume 1000 and increment +8 produce first-block integer lanes
`1001, 1002, 1003, 1004, 1005, 1006, 1007, 1007`. The final lane has a fraction
of 65528/65536 because its weight is just below one.

## Continued blocks, targets and saved state

VADDC/VADD pairs at `0x1cc8–0x1ccc`, `0x1cdc–0x1ce4`, `0x1cf8–0x1d00` and
`0x1d3c–0x1d5c` advance the two channels. For each lane:

```text
fractionSum = oldLow + incrementLow
newHigh = clampSigned16(oldHigh + incrementHigh + (fractionSum >>> 16))
newLow = fractionSum & 65535
```

The low word wraps even when the high word saturates. This is different from
saturating an entire 16.16 value. INIT uses the interpolated first block without
an extra advance; every later block advances once. Continuation restores the
full saved state and advances before its first output block.

The branch tests the **signed high word** of the increment. Positive high words
use VCL with cleared carry flags, an unsigned minimum against the target;
nonpositive high words use VGE, a signed maximum. A positive fractional-only
increment (high word zero) therefore follows the latter path. Target selection
does not clear or replace the fractional lanes.

The left state stores at `0x1d0c/0x1d14` occur before the next speculative left
advance. Right state stores at `0x1da0/0x1da4` occur after the loop. Both saved
channels consequently contain the last **used** lanes, not the speculative next
left block. The shared HLE loop preserves this behavior by advancing just before
each block and saving after its last use.

Dry/wet gain multiplication and destination accumulation are unchanged. Without
AUX, both wet pointers are redirected to discarded scratch, as in standard
ABI1. Configured wet buffers stay untouched. Short envelopes and overlapping
buffers remain outside the supported domain rather than acquiring guessed
semantics.

## Reproduction and validation

```sh
bun tools/audio_hle/capture.js '/Volumes/Data/Roms/GoldenEye 007 (USA).z64' /tmp/goldeneye-audio 600 50
bun tools/audio_hle/replay.js /tmp/goldeneye-audio/1 /tmp/goldeneye-audio/132 /tmp/goldeneye-audio/250
bun tools/audio_hle/differential.js /tmp/goldeneye-audio/1
bun tools/audio_hle/fallbacks.js /tmp/goldeneye-audio/250
bun tools/audio_hle/validate_rom.js '/Volumes/Data/Roms/GoldenEye 007 (USA).z64' 600
```

The extended run captured 1,800 retraces, sampling every 100th task and each new
opcode/flags combination. Its input file pressed Start at frames 240, 360, 480
and 1200; A at 600, 720, 840, 960, 1080, 1320 and 1440; and Z at 1560 and 1680.
Every press lasted eight retraces. Pass this JSON event list as the final argument
to capture or live validation. This sequence does not establish complete gameplay
coverage. The captures exercised envelope flags 8 and 9; flags 0 and 1 are covered
by the synthetic RSP comparisons and unit tests.

Results on 2026-09-28:

- **885 live tasks over 1,800 retraces**, all RDRAM writes matched at SP completion,
  with **zero fallbacks**. The oracle executed **132,056,818 RSP instructions**.
  AI dequeued **2,598,400 PCM bytes**, including **2,159,809 nonzero bytes**.
  PCM SHA-256: `4e82f11d79351a056bc2244c1f04d936b6ed9a34eb53da517715843d59490a8e`.
- **19 GoldenEye captures, 16,647 commands and 2,676,458 instructions** matched
  at command boundaries and across the entire final RDRAM image. The same reused
  runtime also passed all 39 Tetrisphere and 23 Mario capture regressions.
- **5,000 synthetic DSP trials per identity** for GoldenEye, standard ABI1 and
  Tetrisphere. GoldenEye's envelope trials include full signed increments and
  volumes, fractional carry, saturation, target crossings, INIT/continuation and
  AUX on/off.
- **Eight atomic fallback/recovery cases** passed for GoldenEye, including a
  rejected command after a real RDRAM write.
- **1,517 unit tests**, lint and the browser build passed. Seven GoldenEye tests
  cover additive ramps, saved-state continuation, output mixing, saturation,
  carry, target selection and retained rejection guards.

The overrides reuse the base class's channel arrays and allocate no per-command
storage. Profiling exposed boxed Numbers in the task dispatcher when unsigned
command words containing negative increments crossed the handler call boundary.
Reading both packed words as signed 32-bit values preserves all decoded bits and
removes those allocations. Complete-task replay validates that change too.

On Node v24.13.1, with 150 warmup tasks and 400 timed iterations per capture,
GoldenEye captures 132, 250 and extended 800 took median times of **88.3, 301.2 and
225.5 µs** respectively. A separate 600-task heap sample recorded **zero sampled
bytes** attributed to the audio HLE modules after warmup. Sampling is not proof
of zero allocations on every engine or input. Existing Mario/Tetrisphere task
medians stayed within 3% of the pre-GoldenEye implementation in the comparison;
their allocation sample also remained zero.

The oracle is n64js's RSP interpreter, not physical-console measurements. HLE
remains synchronous and does not promise identical instruction-private scratch
or vector-register residue. Other regions and longer gameplay remain independent
validation opportunities.
