# NEAD audio HLE

The implementation was derived from local ROM task captures and their RSP
instructions. No other emulator's audio implementation or decompiled game audio
library was used. Familiar command names follow the existing libultra-header
terminology; the packing and arithmetic below come from disassembly and replay.
ROM bytes, task snapshots, and disassembly are retained only in `/tmp`.

## Captures and structure

Country values below are the ROM header's country byte, in decimal. The games
were Mario Kart USA, Star Fox USA/Japan, Mario/Wave Race Shindou Japan, Yoshi
USA, 1080 Japan/USA, Ocarina USA Rev 1, Majora USA, F-Zero USA, and Doubutsu no Mori.

| ROM header name (country) | Exact identity | Canonical ROM SHA-256 |
| --- | --- | --- |
| Mario Kart 64 (69) | `nead-mario-kart` | `d6b8538dd63f0132ecb2856e7d32816ed3c30e3e479aecd23cf83fb6ba17a5da` |
| Star Fox 64 (69) | `nead-star-fox` | `a8d31134f6d2658fb7bdce5e8f8e74ab70cfcbed73ada22d680225915cb0fe22` |
| Star Fox 64 (74) | `nead-star-fox-revision` | `438d5a25aafe7d0b2e490b9a87183ca3f00d2d7ddce6b3a5784c7bdc0cffc7bd` |
| Super Mario 64 Shindou Edition (74) | `nead-mario-shindou` | `f8807b5e28f1b1a31c5d3675d23ece73f949ccb553dcbb07972666a1e76adfa2` |
| Wave Race 64 Shindou Edition (74) | `nead-wave-race-shindou` | `c53b79a5e6014b5e03b016fadbd5c493270162c17c9624530fc726ea5e3f7b81` |
| Yoshi's Story (69) | `nead-yoshi-story` | `e8a63388c38f8f0bea37e9b13a97f0898ac5496e08ca2028afb8db9a866e0ce9` |
| The Legend of Zelda - Ocarina of Time (v1.1) (69) | `nead-ocarina` | `fb87a0dac188f9292c679da7ac6f772acebe6f68e27293cfc281fc8636008db0` |
| The Legend of Zelda - Majora's Mask (69) | `nead-majora-stadium` | `efb1365b3ae362604514c0f9a1a2d11f5dc8688ba5be660a37debf5e3be43f2b` |
| 1080 Snowboarding (65) | `nead-1080` | `5e9d7168e5786ba1bd4b643431ba7100ff3d7a09e558acae15438d426c0f34df` |
| F-Zero X (69) | `nead-f-zero` | `2be0f861c30752bbdfa727753a454108bc973c27ad814744f191b1278c1f482d` |
| Doubutsu No Mori (74) | `nead-animal-forest` | `d9417be056534fcc0bdff2e6cd5f1135511be7c0a4dace04a96a2649596ce908` |

Dispatch uses the existing reviewed code-and-constants hashes. ROM names do not
select implementations. The Japanese Star Fox program adds a loader loop which
clears just one parameter word; its handlers are otherwise equivalent to the
USA program. It has a dedicated initialization override.

`AudioBase` owns reusable memory, DMA and rollback, ADPCM, pole filtering and
polyphase resampling. The last two kernels were extracted from ABI1, with explicit
layout parameters. ADPCM additionally accepts two-bit residuals and permits
output to overwrite compressed input that has already been consumed. The latter
was exercised by Mario Shindou at task 575 of a longer live run.

`NEADAudio` implements Star Fox's commands. `MarioKartAudio` overrides relative
buffer/segment addressing and one-vector envelope progression. `ShindouAudio`
changes interleave packing and FIR dispatch; `WaveRaceAudio` distinguishes its
additional, still-unreviewed slot three. `NEADDirectAudio` implements Yoshi's
layout, direct-entry command conventions and two-bit ADPCM. Snowboarding, Ocarina,
Majora, Animal Forest and F-Zero specialize that base.

## Layout and loading

| Variant | Params | Command buffer / batch | Book | Resample table | Scratch |
| --- | --- | --- | --- | --- | --- |
| Mario Kart | 0x330 | 0x350 / 128 | 0x3d0 | 0x100 | 0xfa0 |
| Star Fox / Shindou | 0x320 | 0x340 / 128 | 0x3c0 | 0x100 | 0xf90 |
| Yoshi / 1080 / F-Zero | 0x2e0 | 0x300 / 64 | 0x340 | 0xe0 | 0xfc0 |
| Ocarina / Majora | 0x2e0 | 0x2f0 / 64 | 0x330 | 0xe0 | 0xfb0 |
| Animal Forest | 0x2e0 | 0x2f0 / 8 | 0x300 | 0xe0 | 0xfb0 |

The first five identities enter through rspboot. All others execute directly from
IMEM zero. Direct entries pass the declared constant-data size unchanged to
RD_LEN, so they load one extra DMA unit when the size is a multiple of eight.
The bootstrap entries subtract one. Majora and Animal Forest retain the task's
dram-stack pointer at parameter offset 12.

All reviewed entries wait when both DPC XBUS and DMA_BUSY are set. Bootstrap
DP_WAIT also waits on DMA_BUSY alone and checks SP SIG0 for a yield request.
Direct entries ignore those task flags and SIG0. Pending waits and bootstrap
yields remain LLE; only fresh PC-zero tasks are handled.

## Command derivation

Common command slots are ADPCM (1), clear (2), resample (5), set buffers (8),
move (10), load predictor book (11), mix (12), interleave (13), set loop (15),
block copy (16), downsample (17), envelope setup (18/22), envelope mix (19), and
packed DMA load/save (20/21). Later programs add signed PCM8 expansion, nearest
resampling, Q4 gain, fixed-vector multiplication, repeated blocks and FIR filtering.
The source constants identify each slot; variant dispatch overrides changed slots.

Packed transfers and mixing use `(word0 >>> 12) & 0xff0` bytes. Buffer addresses
are halfwords except the envelope's 16-byte packed fields. Mario Kart adds 0x450
to sample offsets and resolves segmented RAM pointers through the table at 0x320.
Its loader repeatedly clears segment zero, not the entire table. Guarded segment
entries must not alias its parameter block.

### ADPCM and resampling

ADPCM retains the shared signed, wrapping 32-bit predictor sum, Q11 truncation
and saturation. Direct NEAD flag 4 chooses two-bit residuals (five-byte encoded
frames), except F-Zero, which always uses four-bit residuals (nine-byte frames).
Output frames contain sixteen signed samples preceded by 32 bytes of history.
INIT and LOOP follow the captured instruction tests, including zero-count state
loads/stores. Predictor and buffer checks reject unreviewed aliasing.

The polyphase resampler uses four independently rounded/saturated Q15 products,
saturated pair additions and a saturated final sum. Each iteration stages eight
windows before storing its vector. Phase advances by twice the unsigned pitch.
Mario Kart retains ABI1's tail/alignment state. Later NEAD programs instead use
flag 2 to halve saved history, or flag 4 to duplicate it. They preserve bytes
10..31 of the saved state, including on INIT. Star Fox's table setup is at 0x1618;
Ocarina's corresponding instruction is at 0x15ac.

### Envelopes and vector register dependencies

Volumes are unsigned Q16 values; VMUDM floors signed sample products without
rounding. Two-vector variants initialize alternating gains, then double and wrap
increments for each 16-sample iteration. Mario Kart advances once per eight
samples. Dry and wet additions saturate separately. Complement flags act on
sample bit patterns, not arithmetic negation. 1080 and Zelda variants add wet
masks and move the channel-swap flag. F-Zero ignores complement flags and skips
wet writes when its second wet gain is zero. Its MFC2 wet-path test also replaces
the scalar wet increment, observable on consecutive envelope commands.

Envelope configuration lives in RSP registers. The HLE requires explicit setup
before consuming those values after another DSP command. FIR similarly requires
its setup immediately before processing, rather than guessing clobbered scalar
state. Command batch DMA does not invalidate either setup.

ADDMIXER begins by doubling V31 with VADDC. The resulting carry affects the first
output vector. HLE seeds that register from the actual task-entry RSP state,
tracks reviewed writers, and publishes it only after successful completion.
Captures and the live oracle therefore include vector-register snapshots.

### FIR and buffer edge behavior

The FIR is an eight-tap causal convolution. It rounds once after the entire Q15
sum and saves the unfiltered final input vector as history. Wave Race/Shindou,
Yoshi and 1080 save 16 bytes. Zelda/Animal Forest save 32 bytes: input history plus
coefficients. These variants first average new and saved coefficients, including
averaging with zero on INIT. Wave Race's filter entry is 0x1cfc; Ocarina's is 0x1cb0.

Clear with count zero does nothing. Several DSP and copy loops still execute
one block for zero count. Majora's move copies vector blocks then exact halfword
remainders, and even zero count copies one halfword. Animal Forest's corresponding
move skips zero count. Mixer output may overlap an earlier source region when
stores cannot overwrite unread samples; unreviewed forward overlap uses LLE.

## Validation and allocation

The initial captured corpus contains 303 tasks and 53,138 commands across all
eleven identities. Every task was checked command by command (persistent DMEM
and RAM writes), then again through production dispatch with complete final RAM
comparison. An additional live Mario Shindou failure capture verifies safe ADPCM
input/output overlap. Unknown identities, modified code/constants, waits, bad
commands and failures after RAM stores are tested for atomic fallback and reuse.
Direct-program mutation tests modify IMEM, which is the executable source.

Live runs cover 1,200 VI frames per ROM: 12,630 completed tasks and 900,412,310
oracle RSP instructions, with no HLE fallbacks or RAM output mismatches. All runs
produced nonzero PCM. These are startup/attract-mode checks, not exhaustive gameplay
or a hardware timing validation.

255,000 synthetic command comparisons use random samples, coefficients, gains, flags, phases,
short/zero counts, clipping, supported overlap and repeated envelopes. The original
captured instructions are the only oracle. ABI1's 20,000 and NAUDIO's 41,000 DSP
comparisons also pass after the shared-kernel extraction.

Executors, typed scratch vectors, the copy block, coefficients, memory views and
undo journals are retained per hardware instance. First setup and journal growth
allocate; warmed successful commands do not deliberately create objects, arrays,
views or closures. V8 heap sampling across 1,200 measured tasks alternating six
variants reported zero sampled bytes attributed to audio HLE functions after
warmup. Negative-zero wet masks and unnecessary reads of unused loop pointers
were removed after profiling. Sampling is evidence for this workload, not a proof
about every engine or unreviewed input.

## Reproduction and remaining scope

Use local ROM paths with `tools/audio_hle/capture.js`, then `replay.js` and
`differential_nead.js` on the captured prefixes. `validate_rom.js` runs live HLE
with an isolated LLE oracle; `fallbacks.js` exercises rollback/recovery.
`benchmark.js` supports `--profile=/tmp/nead.heapprofile`. All research tools and
this document stay on the reference branch when preparing a runtime-only PR.

The complex slot-three multiplication in Wave Race/Yoshi/Ocarina/1080, direct
slot-zero processing, unknown table slots, uninitialized register-dependent forms,
and unsafe overlaps still fall back atomically to the original RSP. Captured
startup tasks do not require these forms. HLE remains opt-in and does not select
handlers by family guesses or ROM names.
