# Audio microcode evidence audit — 2026-09-26

The subsequent [instruction DMA audit](audio-instruction-audit-20260926.md)
follows up the capture gaps identified here with observed code loads and
restores. This document retains the findings and limits of the original
task-start-only corpus.

This audit uses the 858-ROM, seed-1, 600-VI startup corpus captured at
`d7942d979c057c94bf892cea1c105f73c637d7e7`, source SHA-256
`d1b91209e832a19238d5a48590ab491ba395d9a8fb610efa60154663ecf35ee1`.
The local archive is
`/Volumes/Data/n64js-inventory/diagnostics/2026-09-26-audio-microcode-corpus`.
It contains 420,223 tasks and 188,761 raw snapshots; 56 runs observed no audio
and four are partial timeout captures. An earlier replay matched all 858 live
collectors; that establishes capture fidelity, not classification accuracy.

The new [catalogue command](audio-microcode-catalogue.md) audited the complete
published streams in about 32 seconds. It found **74,106 exact interpreted
code/data variants under 24 provisional fingerprints**. It retains all those
variants, with representative image references and source/report hashes. They
are evidence, not 74,106 different microcode programs. No runtime classification
or HLE dispatch changes are made by this audit.

## Complete group inventory

Fingerprint prefixes below are unique in this corpus. The JSON catalogue has
full hashes and per-ROM references. Code/data columns count exact byte images
within each group, including copied tails and data beyond constants. Names are
examples or descriptions, never matching rules.

| Fingerprint prefix | Provisional family | Example(s) | ROMs | Code images | Data images |
| --- | --- | --- | ---: | ---: | ---: |
| `7c0f60b4b4de` | ABI1 | Mario, European Tetrisphere, many others | 530 | 27078 | 35663 |
| `2b0edf46d083` | ABI1 | US Tetrisphere | 1 | 519 | 431 |
| `5b79d4bccd61` | ABI1 | Blast Corps, Diddy Kong Racing | 8 | 2 | 2 |
| `ea8d6eb4a5d2` | ABI1 | GoldenEye | 3 | 857 | 514 |
| `a14c06703cec` | NAUDIO | Smash Bros., many others | 161 | 5409 | 2176 |
| `125b6a4f9200` | NAUDIO | Banjo-Kazooie | 4 | 1 | 1 |
| `4fd99eaedbd2` | NAUDIO | Donkey Kong 64 | 4 | 2 | 21 |
| `f08144fb1262` | NAUDIO | Perfect Dark, Banjo-Tooie | 8 | 1 | 2 |
| `947859371172` | NAUDIO | Conker | 2 | 1 | 1 |
| `032d85e54885` | NEAD | Wave Race Shindou | 1 | 1 | 1 |
| `3b5c699ed59f` | NEAD | Star Fox, Lylat Wars | 4 | 1 | 1 |
| `a5575a25984c` | NEAD | Star Fox revision | 1 | 1 | 1 |
| `3edeab7fdda9` | NEAD | Yoshi's Story | 3 | 1 | 1 |
| `7097322cb20f` | NEAD | Mario Shindou | 1 | 1 | 1 |
| `77077c430a54` | NEAD | Ocarina, Japanese Majora revisions | 17 | 3 | 1 |
| `80f90cef0353` | NEAD | Majora, Pokémon Stadium 2 | 10 | 1 | 1 |
| `82cce67b0dc5` | NEAD | 1080 Snowboarding | 2 | 2 | 1 |
| `b6b84a72d577` | NEAD | F-Zero X | 3 | 1771 | 1 |
| `edf4dcfedda0` | NEAD | Mario Kart, Wave Race | 7 | 3458 | 1 |
| `fa66fe6db17a` | NEAD | Animal Forest | 1 | 1 | 1 |
| `893196ac4143` | Unknown | TWINE, Gauntlet, Hydro Thunder, Rush, Tarzan, NBA Showtime, Rugrats | 17 | 588 | 1184 |
| `01f77ceb3142` | Unknown | Resident Evil 2, Polaris | 4 | 4 | 4 |
| `5fef2e44b340` | Unknown | Indiana Jones, Battle for Naboo | 3 | 1 | 94 |
| `06e592ad6006` | Unknown | Jet Force Gemini, Mickey's Speedway | 7 | 1 | 1 |

## Reviewed distinctions

### Mario and Tetrisphere

US Mario's code is identical across the large ABI1 group through code offset
`0xe20` (exclusive); all observed variation begins at or beyond that boundary.
Its final statically reached instruction is the delay slot at PC `0x1e98`
(offset `0xe18`); the immediately following word is padding. The common data
prefix is `0x2c0` bytes. Longer captured data images vary after that prefix.
These observations explain much of the exact-variant explosion without
discarding any bytes or proving that all tail bytes are irrelevant.

US Tetrisphere differs in the mixer itself: the branch at PC `0x1e2c` and loop
starting at `0x1e5c` differ, and its statically reached code ends at `0x1e6c`.
It must remain a distinct candidate from Mario. European Tetrisphere has
Mario's mixer sequence and the same common code/data prefixes. A game's name
therefore cannot stand in for its program identity. That regional finding does
not establish equivalent performance or whole-game audio behavior.

Reproduce the comparisons with task 1 of these capture runs:

| ROM | Canonical ROM SHA-256 prefix | Capture run |
| --- | --- | --- |
| Mario USA | `17ce077343c6` | `8693bae9-f80b-4d2b-825c-0d234a9e37e3` |
| Tetrisphere USA | `f7cbc93ac273` | `e88f8521-3bd9-4c39-a129-5f14a8f96fa5` |
| Tetrisphere Europe | `1bb4ed1ef078` | `452aca2c-9fc5-4e6f-a40c-13239a317b90` |

### Identical main code, different overlay inputs

Perfect Dark and Banjo-Tooie share all `0xf80` bytes of interpreted code and the
same provisional fingerprint. Their data differs at offset `0x0c`: the halfword
is `0x09bf` for Perfect Dark and `0x0847` for Banjo-Tooie. This controls a DMA:

1. The startup code adds the task's code base to the word at data offset `0x08`,
   initially `0x0f80`, establishing an RDRAM source beyond the main image.
2. At PCs `0x1214`–`0x1220`, it loads the destination from data `0x0e`
   (`0x1238`), source from `0x08`, and length from `0x0c`.
3. The subroutine at `0x117c` writes these to the SP DMA registers. The program
   waits, then jumps to `0x1238`.

The length values request `0x9c0` and `0x848` bytes respectively under the SP
DMA length rule in `src/devices/sp.js`. The raw code window contains only
`0x80` bytes beyond offset `0xf80`, so most of each overlay is **not captured**.
In the representative runs below, the residual IMEM snapshot before task 2
contains the restored main code at `0x1238`, rather than the overlay source
prefix. Previous-task IMEM therefore does not fill this gap in those snapshots.
The static traversal can decode the pre-DMA bytes at the destination; it cannot
establish the loaded program's behavior. Keep these as separate candidates and
mark both incomplete until their overlays have been captured and compared.

Representative task-1 runs are Perfect Dark
`11089bd5-33cd-48de-aac6-4b063978a349` (ROM hash `8e432b1a5f4c`) and Banjo-Tooie
`e7b8dbfd-8593-48a0-a9d0-ffa41fc12a50` (ROM hash `9ec37fba6890`).

### Why the Unknown groups remain unresolved

The 17-ROM `893196ac4143` group has identical code through offset `0xf40`
(exclusive). Differences occur after its final statically reached return/delay
slot at `0x1fac`/`0x1fb0`. Its entry reads a task data pointer and DMAs structured
data to DMEM `0x250`, then processes descriptor fields and calls synthesis
routines. It does not exhibit the 64-bit command/table dispatcher required by
the current detector. This is evidence for a different command interface, not
evidence of broken capture or of 17 different programs. The `01f77ceb3142` group
has a similar entry structure but different code; its code differences within
the group start at offset `0xf41`, beyond the final reached delay slot `0x1fb8`.
Neither group receives an invented ABI label in this PR.

The Indiana Jones/Naboo group has one exact interpreted code image, but 94 data
images. Its task entry likewise reads descriptors; it also stores the task's
code base at DMEM `0x278`. Code beyond the last statically reached instruction
contains further plausible instructions. Shared static fingerprints do not
justify removing this region or assuming no overlays/indirect entry points.
Further control-flow and DMA evidence is needed before HLE selection.

The seven Jet Force Gemini/Mickey captures share one exact interpreted
code/data variant. Their `0x180`-byte bootstrap differs from the recognized
standard loader: it performs additional checks and uses a different register
and instruction sequence for loading the program. The main image contains the
paired command loads, shift/mask, halfword-table load and register jump of a
command dispatcher. The bootstrap's DMA setup points to IMEM `0x1080`, but the
runtime detector currently reports an unsupported loader before checking the
main program. Its data also describes an overlay (`0x0c = 0x08b7`), so merely
recognizing that bootstrap would not complete the program inventory.

## Consequence for the next PR

This is an evidence catalogue with reviewed distinctions and explicit unresolved
cases, **not yet ground truth for complete program/HLE identities**. No masks
or labels are accepted just because they fit the 24 existing fingerprints.

Before minimizing a fingerprint, extend capture to record instruction DMA
payloads/destinations during audio tasks, preserving order and task provenance.
That follows actual execution and covers custom loaders without encoding a
list of known ROMs or blindly enlarging a task-start window. Rerun the affected
titles first and establish overlay coverage; startup-only execution will still
not prove coverage of every gameplay path. Then review the combined code and
constant inputs, including the Perfect Dark/Banjo-Tooie distinction, and freeze
explicit candidate identities for the lean classifier's offline tests.
