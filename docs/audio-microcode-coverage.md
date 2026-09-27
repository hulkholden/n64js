# Expanded task-start microcode identities

This extends the [initial two-identity review](audio-microcode-reference.md) to
20 exact program identities using saved captures and RSP disassembly, not another
emulator's signature table. Names are descriptive anchors, not SDK versions or
HLE dispatch rules. ROM names, structural fingerprints and later instruction
loads are review evidence only; the classifier receives raw task-start bytes.

## Reviewed ranges

All ranges begin at zero and end at the exclusive offsets below. `rspboot`
programs use the raw RDRAM code window loaded at IMEM `0x1080`. Direct programs
use actual task-start IMEM at `0x1000`. Both use raw RDRAM data. Every byte in
each prefix is protected, including gaps and padding.

| Identity | Layout | Code end | Data end | ROM images |
| --- | --- | ---: | ---: | ---: |
| `abi1-standard-mixer` | rspboot | `0xe20` | `0x2c0` | 530 |
| `abi1-tetrisphere-us-mixer` | rspboot | `0xdf0` | `0x2c0` | 1 |
| `abi1-diddy-blast-mixer` | rspboot | `0xec0` | `0x2d0` | 8 |
| `abi1-goldeneye-mixer` | rspboot | `0xdc0` | `0x2c0` | 3 |
| `naudio-standard` | rspboot | `0xc60` | `0x2b0` | 161 |
| `naudio-banjo-kazooie` | rspboot | `0xc60` | `0x2b0` | 4 |
| `naudio-donkey-kong-64` | rspboot | `0xc30` | `0x2b0` | 4 |
| `nead-mario-kart` | rspboot | `0xc70` | `0x300` | 7 |
| `nead-wave-race-shindou` | rspboot | `0xf60` | `0x330` | 1 |
| `nead-star-fox` | rspboot | `0xf00` | `0x330` | 4 |
| `nead-star-fox-revision` | rspboot | `0xf10` | `0x330` | 1 |
| `nead-mario-shindou` | rspboot | `0xf10` | `0x330` | 1 |
| `nead-yoshi-story` | direct | `0xf50` | `0x2e0` | 3 |
| `nead-ocarina` | direct | `0xfb0` | `0x2e0` | 17 |
| `nead-majora-stadium` | direct | `0x1000` | `0x2e0` | 10 |
| `nead-1080` | direct | `0xf80` | `0x2e0` | 2 |
| `nead-f-zero` | direct | `0xd40` | `0x2e0` | 3 |
| `nead-animal-forest` | direct | `0xf50` | `0x2e0` | 1 |
| `descriptor-synth-twine` | rspboot | `0xf40` | `0x230` | 17 |
| `descriptor-synth-re2` | rspboot | `0xf40` | `0x230` | 4 |

The descriptor programs retain family `Unknown`: their exact identities are
reviewed, but no ABI1/NAUDIO/NEAD family or vendor version is inferred.

## Derivation

The review follows entry, command-table targets, direct calls, saved-link returns
and DMA setup, then inspects terminal routines and adjacent bytes. Byte stability
corroborates the boundaries; it does not define them. Manifest lengths are not
generated from the structural traversal.

The additional ABI1 programs end at return-to-dispatch delay slots `0x1f38`
(Diddy/Blast) and `0x1e3c` (GoldenEye). Diddy/Blast has an extra constants block
before its resampling table: its protected data ends at `0x2d0`, not `0x2c0`.

The three NAudio programs dispatch from DMEM zero, with packed transfers and
fixed-length interleave. Their final mixer delay slots are `0x1cd0`, `0x1cd4`
and `0x1ca4`; full resampling tables end at `0x2b0`. Following bytes include
unrelated copied graphics programs in some ROMs. They are not reached by the
reviewed audio dispatcher or DMA paths.

The rspboot NEAD variants have extended tables at DMEM `0x10`. Mario Kart's
last audio delay slot is `0x1ce8`; its coefficient table ends at `0x300`.
Shindou/Star Fox variants retain initialized tables through `0x330`. Their
final audio delay slots are `0x1fd0`, `0x1f74`, `0x1f84` and `0x1f80`, in table
order. Mario Shindou transfers back to the command loop with JAL; treating that
as a returning call makes the provisional walker continue into adjacent data.
No range is inferred from that overestimate.

Direct NEAD entry reads `OSTask.ucode_data` and `ucode_data_size`, loads DMEM
zero, then dispatches from the table at `0x10`. The complete coefficient table
ends at `0x2e0`. Yoshi, Ocarina, 1080 and F-Zero end at audio delay slots
`0x1f40`, `0x1fa0`, `0x1f70` and `0x1d24`. Majora/Stadium uses all of IMEM,
including the final delay slot at `0x1ffc`. Animal Forest's main traversal ends
at `0x1f14`, but the protected range retains the following helper through
`0x1f48`. Its indirect calls use fixed address `0x1e88`, saving return links in
`t0`. Adjacent CPU/graphics code and tables are excluded only after inspection.

Both descriptor programs load task descriptors to DMEM `0x250`, then process
voices, sample buffers and state. Their prefix contains vector constants and
the coefficient table through `0x228`, padded to `0x230`. At `0x1518`/`0x1520`
they set the workspace base to `0x230` and overwrite its two vectors before
reading them; these varying bytes are scratch. Indirect returns use saved `ra`
in `s8` or `t0`, not external code. Final returns at `0x1fac`/`0x1fb4` and their
delay slots are protected. Their full code hashes differ; their constants match.

This identifies programs for normal command use. It does not certify malformed
commands, command-dependent memory writes or a future HLE implementation.

## Loading checks and lookup cost

The two exact rspboot identities and their layout checks remain. Direct entry
requires matching task boot/code addresses and a declared 4-KiB boot window.
It hashes **actual IMEM**, not the RDRAM code copy. The protected program includes
its own loader; the result reports `bootstrap: "direct-imem"`.

Direct entry writes `ucode_data_size` to `SP_RD_LEN` unchanged; rspboot subtracts
one. Direct `0x2df` therefore loads `0x2e0` bytes, including the last coefficient
byte beyond the declared size. Direct `0x2e0` loads `0x2e8`. Both classifiers
independently implement these conventions, rejecting truncated windows,
unaligned/null pointers and transfers overlapping `OSTask` at `0xfc0`.

An optional SHA-256 of the first `0x80` code bytes narrows browser candidates.
It never establishes identity: all candidates still need complete code/constants
hashes, and overlapping matches remain ambiguous. Shared entry prefixes work.
The native reference deliberately ignores lookup metadata, exposing incorrect
selectors during corpus comparison. Byte-verified caches are bounded by manifest
range lengths; only eligible code/data ranges are inspected. The maximum retained
copies total 64,412 bytes, plus hash scratch, independent of task count.

## Remaining unknowns

Four observed groups, covering 20 ROM images, remain unrecognized:

- Perfect Dark / Banjo-Tooie: shared main code, distinct external overlays.
- Jet Force Gemini / Mickey's Speedway: custom bootstrap and an external overlay.
- Conker: command `0x1214` loads an overlay using data `0x08`/`0x0c`/`0x0e`;
  its source starts at code offset `0xf70`, outside most of the captured window.
- Indiana Jones / Battle for Naboo: descriptor synthesis with observed overlays.

The [instruction audit](audio-instruction-audit-20260926.md) retains overlay
evidence and gaps. Post-execution capture alone cannot identify an overlay at
task start. These cases need a reviewed way to snapshot and validate their
complete external code before admission, not just a similar main-code match.

## Reproduction

The saved 858-ROM instruction corpus is at
`/Volumes/Data/n64js-inventory/diagnostics/2026-09-26-audio-instruction-corpus/corpus`.
Use `audio-microcode-reference --check` for coverage and family cross-tabs, then
`audio-microcode-lean --browser` for every-task browser/reference agreement and
timing. No new full ROM execution is needed. Lean verification now mutates every
protected byte of every reviewed program/loading-layout example, including
direct IMEM and the rounded final data byte. It also restores each identity and
changes excluded tails. Raw bytes and disassemblies remain local.

The expanded manifest has 29 positive/negative examples. The full instruction
corpus contains 414,701 recognized tasks and 5,533 unknown tasks, with zero
ambiguities or structural-family disagreements: 782 of 802 audio-observed ROM
images are covered; 56 runs observed no audio. These are startup prefixes, not
whole-game coverage or evidence of audio HLE support.
