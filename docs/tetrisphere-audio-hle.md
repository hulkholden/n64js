# Tetrisphere USA audio HLE

The initial implementation was derived from the audio RSP program captured while running
Tetrisphere (USA), using n64js's existing RSP interpreter as the differential
oracle. No other emulator's audio HLE, ported audio mixer, or reconstructed DSP
implementation was used. This document records the derivation for
`abi1-tetrisphere-us-mixer`; matching the ABI1 family alone is insufficient.
The shared handlers now live in `src/hle/audio_abi1.js`, with Tetrisphere's mixer
override in `src/hle/audio_tetrisphere.js`. See [ABI1 variants](abi1-audio-hle.md)
for the standard mixer, Super Mario 64 validation and current support.

The interface source is the original libultra 2.0I `PR/abi.h`, revision 1.32:
[header mirror](https://raw.githubusercontent.com/n64decomp/libreultra/master/include/2.0I/PR/abi.h).
Only command numbers, flags, packing macros and state typedef sizes are used
from the header. Explanatory additions in modern header mirrors are not an
implementation source. DSP arithmetic, rounding, buffer layout, and quirks below
come from the captured instructions and experiments against them.

The classifier dependency is [PR #255](https://github.com/hulkholden/n64js/pull/255).
Its program/constants hashes establish which executable is being replaced;
classifier family names are not used to infer command behavior.

## Running it

Select **Audio → Emulation Mode → HLE**. LLE remains the default. Other identities,
yield/resume tasks, unsupported buffer layouts and unreviewed command shapes run
on the RSP. Failed HLE attempts restore all RDRAM writes before falling back;
DMEM is private until the whole task succeeds. The existing AI path plays the
resulting guest PCM, and the SP device signals normal task completion.

Selection uses reviewed microcode identities, including the standard ABI1 mixer,
rather than assuming a ROM name or region determines the program. No timing
equivalence to the instruction-by-instruction implementation is promised.

## Capture and reproduction

All commands run from the repository root with Bun. Supply your local ROM. The
output directory should be outside the repository: captures contain ROM-derived
code, samples, and RDRAM. No such bytes are checked in.

```sh
bun tools/audio_hle/capture.js '/Volumes/Data/Roms/Tetrisphere (USA).z64' /tmp/tetrisphere-audio 600 50
bun tools/audio_hle/replay.js /tmp/tetrisphere-audio/1 /tmp/tetrisphere-audio/29
bun tools/audio_hle/differential.js /tmp/tetrisphere-audio/1
bun tools/audio_hle/fallbacks.js /tmp/tetrisphere-audio/1
bun tools/audio_hle/validate_rom.js '/Volumes/Data/Roms/Tetrisphere (USA).z64' 600
```

Capture saves a sample whenever a new command/flags pair appears and every Nth
audio task. Each prefix has `task`, `imem`, `code`, `data`, `dmem`, and `ram` binary
files plus decoded command words. The first program observation has a disassembly
with IMEM addresses. `capture.json` records the ROM hash, identity, frame, command
counts and controller inputs. Disassembly includes the full loader window;
bytes after the reviewed code end may be data, not executable instructions.

The capture and live validation tools accept an optional final JSON input file:

```json
[{"frame":720,"buttons":4096},{"frame":728,"buttons":0}]
```

Events specify the complete button mask at a VI retrace. For the extended run,
Start was held at frames 720 and 840 for eight retraces each, followed by A at
960, 1080, …, 1680, also for eight retraces. This is an input sequence, not an
assertion that every gameplay mode was visited.

`replay.js` executes the captured bootstrap and command list on an isolated RSP
with synchronous DMA. It compares parameter memory, predictor books and sample
buffers after every command, and every RSP RDRAM write. It separately executes
the production HLE task dispatcher and compares the entire final RDRAM image.
The replay has an instruction budget and rejects unsupported strided DMA.

`differential.js` executes the real captured handlers with deterministic synthetic
samples, codebooks and state. It compares five DSP commands across 1,000 trials
each, including initialization, continuation, ADPCM loop, resampler OUT and
envelopes with and without AUX. It selects the handler for the captured identity.
`fallbacks.js` checks rejection without mutation, including an unsupported command
after an actual RDRAM save. Unit tests use synthetic data and need no ROM.

`validate_rom.js` runs the game with HLE enabled. At each audio start it executes
an isolated copy of the task on the RSP, restores the live interpreter binding,
and checks the resulting RDRAM writes at real SP completion. It counts any LLE
fallback and rejects a run with unverified or fallback tasks. It also hashes the
PCM actually dequeued by AI and counts nonzero bytes; it does not listen to the
output or validate against a physical console.

## Executable and DMEM layout

The initial USA task was observed at VI retrace 15:

- Bootstrap at RDRAM `0x0dd300`, declared size `0xd0`, identity `rspboot-204`.
- Program at `0x0de7d0`; the task declares code size zero. The bootstrap loads
  its fixed `0xf80` bytes at IMEM `0x1080` regardless.
- Data at `0x0f1d70`, declared/loaded size `0x800`. Classification protects the
  initialized prefix of `0x2c0` bytes; HLE still loads the whole task data region.
- First list at `0x2a96d0`, length `0xbc8` (377 commands).
- Reviewed executable ends just before IMEM `0x1e70`.

| DMEM range | Meaning derived from accesses |
| --- | --- |
| `0x000–0x00f` | vector constants |
| `0x010–0x02f` | sixteen halfword command-handler addresses |
| `0x030–0x0bf` | unpacking, index and interpolation constants |
| `0x0c0–0x2bf` | 64 phases × four signed resampler coefficients |
| `0x320–0x35f` | sixteen segment bases |
| `0x360–0x37f` | buffer, volume and loop parameters |
| `0x380–0x4bf` | 320-byte command DMA batch |
| `0x4c0–0x5bf` | supported predictor-book region |
| `0x5c0–0xf8f` | supported sample buffers |
| `0xf90` onward | DSP state and instruction-private temporaries |

Entry `0x1080` loads the list address/size from OSTask. `0x1150` fetches up to
320 bytes. `0x10e4–0x1110` reads two words, selects `(w0 >>> 24) & 0x7f`, reads the
halfword dispatch target, and jumps. HLE rejects opcodes above 15, rather than
following arbitrary guest-controlled dispatch entries.

The initialization loop at `0x10c0–0x10d0` repeatedly stores to **the same** segment
zero address; it does not increment the pointer. HLE clears only segment zero.
DMA routines are at `0x1184` and `0x11b0`. SP register writes align addresses down
to eight bytes, and transfer lengths round up to eight. The task exits at
`0x1138–0x1140`, setting task-done and breaking.

## Command map

Names and packed fields use the header; the handler addresses come directly from
the ROM's DMEM dispatch table. Command buffer addresses are relative to `0x5c0`.

| Opcode | Name | Handler | Derived behavior |
| --- | --- | --- | --- |
| 0 | SPNOOP | `0x1118` | Return to dispatch |
| 1 | ADPCM | `0x1470` | History plus 9-byte blocks → 16 samples per block |
| 2 | CLEARBUFF | `0x11dc` | Zero in 16-byte blocks; zero length is a no-op |
| 3 | ENVMIXER | `0x1b38` | Two volume envelopes; dry/wet stereo accumulation |
| 4 | LOADBUFF | `0x1214` | DMA to configured input; zero length is a no-op |
| 5 | RESAMPLE | `0x187c` | Four-tap, 64-phase filter; eight outputs per loop |
| 6 | SAVEBUFF | `0x1254` | DMA from configured output |
| 7 | SEGMENT | `0x12d0` | Store low 24 bits at the selected segment slot |
| 8 | SETBUFF | `0x12ec` | Main input/output/count or three auxiliary addresses |
| 9 | SETVOL | `0x1328` | Initial volumes, target/rate pairs, or dry/wet gains |
| 10 | DMEMMOVE | `0x140c` | Forward copies with a 16-byte load-before-store unit |
| 11 | LOADADPCM | `0x1294` | DMA predictor data to `0x4c0` |
| 12 | MIXER | `0x1e24` | **No memory writes in this executable** |
| 13 | INTERLEAVE | `0x138c` | Eight left/right sample pairs per loop |
| 14 | POLEF | `0x170c` | Eight-sample recurrence and an eight-byte history |
| 15 | SETLOOP | `0x144c` | Store resolved loop address at parameter offset `0x10` |

### MIXER is intentionally a no-op

`0x1e24–0x1e6c` loads vectors and counts down, but contains no arithmetic or sample
stores. Implementing the header's intended general mixing operation here would
change this ROM's behavior. The exact identity guard is essential. A regression
test uses nonzero buffers, so silence cannot disguise an accidental change.

### ADPCM

`0x1534–0x15e0` extracts the header's predictor index and scale, unpacks sixteen
signed nibbles, and scales them. Scale values at least 12 use the unshifted
12-bit-position nibbles. Each group of eight then forms a sum of two history
terms, the current residual times 2048, and preceding residuals multiplied by
the second coefficient row in reverse order. `0x1600–0x16c8` truncates the sum
to signed 32 bits, shifts right 11 and saturates to signed 16 bits. The saturated
last two outputs become the next group's history.

INIT zeros 32 output bytes. Otherwise those bytes come from the command's state
address, or the saved loop address for LOOP. Decoded output follows that prefix;
the final 32 bytes are written back to the command state address, even when the
requested decoded count is zero. ADPCM was not observed in the extended game
trace; its implementation is supported by disassembly and synthetic RSP trials.

### Pole filter

The first and second eight-coefficient rows are loaded at `0x17ac–0x17bc`.
The second row is also scaled by the low 16 bits of `gain << 2` and written back
to the book. The recurrence uses the **original** second row for the history
term and the **scaled** row for preceding input samples. Each sum wraps to
signed 32 bits, shifts right 14 and saturates. Input gain is interpreted as a
signed halfword. The last eight output bytes are saved.

A surprising INIT detail is preserved: `0x176c` clears only four scratch bytes;
the last two history samples at `0xf94`/`0xf96` survive. Zeroing all eight would
be cleaner-looking but would not reproduce the instructions.

### Resampler

The state contains four history samples, a fractional position, a saved alignment
adjustment and an additional 16-byte input tail. INIT clears the first ten scratch
bytes. Continuation loads the 32-byte state. OUT restores the additional tail and
adjusts the input position before prepending history (`0x18e8–0x1914`).

Pitch advances an unsigned 16-bit fraction by `2 * pitch` per output. Its high
six bits select four coefficients from the **task-loaded** table, not a copied
lookup table in source. `0x1a38–0x1a94` rounds and saturates each tap's product
separately, adds adjacent pairs with saturation, then adds the pair sums with
saturation. This is not interchangeable with one rounded four-term dot product.
Eight windows are read before each output vector is stored. `0x1ad8–0x1b20`
saves the next four source samples, fraction, alignment and tail.

### Envelope mixer

The 80-byte saved state is five vectors: left integer/fractional volumes, right
integer/fractional volumes, and target/rate/dry/wet parameters. Each channel has
eight volume lanes. Initialization interpolates between the initial volume and
its rate-scaled value using weights 1/8 through 7/8 and 65535/65536. The rate
product is saturated **before** subtracting the initial volume; randomized
trials caught the difference from interpolating an unlimited product.

Following blocks multiply each fixed-point lane by its 16.16 rate using the
partial-product truncation visible at `0x1cf0–0x1d00`. Positive integer rates use
the unsigned minimum selected by VCL with cleared carry flags; other rates use
signed maximum. Fractional lanes are retained when the integer lane reaches its
target. Dry/wet gains each use a rounded fractional multiply. Accumulation scales
the old destination by 32767/32768 and adds the input product in the same
accumulator before final saturation (`0x1d50–0x1de0`).

## Deliberate bounds and remaining work

The current implementation accepts ordinary fresh USA tasks, bounded lists,
normal sample buffers, and the command shapes covered by the derivation and
checks. It falls back for envelopes shorter than one continued
or two initial vector blocks, zero-length resampling, overlapping envelope
buffers, unsupported predictor indices/books, wrapping buffers/DMAs, and unusual
entry/yield layouts. ADPCM and pole filter overlap checks also bound the supported
domain. This is a conservative supported subset, not a claim about every possible
ABI1 input. These cases can be expanded with focused RSP experiments.

HLE preserves DSP-visible memory and state, not every scratch byte, vector
register or DMA-register residue. It runs tasks synchronously. The baseline
oracle is the existing n64js RSP implementation, not measurements from N64
hardware. Browser listening, long gameplay sessions, European microcode, and
hardware confirmation remain useful independent checks.

## Initial Tetrisphere validation

These results precede the ABI1 generalization. Subsequent shared-class regression
results are recorded in the [ABI1 validation guide](abi1-audio-hle.md).

- 39 saved lists spanning 1,800 VI retraces: **27,865 commands** and **5,764,249
  RSP instructions**, with command-boundary and complete-task RDRAM agreement.
- **4,000 deterministic synthetic DSP trials**, including ADPCM, pole filtering,
  resampling, envelope mixing and saved-state flags.
- Eight rejection/rollback cases, including a late failure after a real save.
- The committed live validator completed **1,800 retraces**, with **1,785 audio
  tasks**, **zero fallback tasks**, and **269,469,158 oracle RSP instructions**.
  All task state/sample writes agreed. AI consumed **5,128,896 PCM bytes**,
  including **4,799,101 nonzero bytes**. PCM SHA-256:
  `cbf39bb965b5dd3f3eba5f9888a2db08b0bb688f9a76c98a0028dea32a560a9b`.
- **1,445 unit tests pass**, including 12 new command tests and the unknown-task
  HLE fallback integration check. Lint and the browser bundle build pass.
