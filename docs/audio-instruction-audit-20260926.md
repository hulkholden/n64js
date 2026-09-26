# Audio instruction DMA audit — 2026-09-26

This extends the [task-start evidence audit](audio-microcode-audit-20260926.md)
with actual instruction DMA observations. Captures use revision
`fc8d0d810d18c6244fe63b173e417b900bd6f620`, source SHA-256
`0427c5e598e7e879ad6f5e3006bc3451e39ad80a0d6fc8ceb5d32f8778ab78b0`,
and Bun 1.3.14. The pinned checkout, runtime, configurations, reports and raw
captures are retained locally at
`/Volumes/Data/n64js-inventory/diagnostics/2026-09-26-audio-instruction-corpus`.
Captured game bytes and disassemblies are not committed.

The observer records resulting IMEM states after audio-owned RDRAM-to-IMEM
DMA. It preserves every occurrence and its task association, including queued
loads, repeated identical copies and restores. These are post-execution
observations for reviewing identities. The eventual lean classifier must use
information available before executing the task; DMA histories cannot be its
features. Audio still executes through LLE, and the provisional detector is
unchanged.

## Collection and fidelity

The main sweep repeats the previous corpus's 858 input files with seed 1,
600 VIs, a 5-billion-cycle limit, a 60-second wall-clock limit, the same seeded
controller policy and four sequential shards. The Bun binary is identical to
the previous sweep (SHA-256
`e0c90ec15d33363e6b70713d56bc3b2c7585c17f40a0fe0f8fd9305901d4e233`).
Canonical ROM hashes and settings, rather than names or filesystem order,
identify matched runs.

All 858 canonical ROM hashes match the previous cohort, with no added or missing
inputs. Collection and replay took 1,829 seconds (30.5 minutes). Results:

| Measure | Result |
| --- | ---: |
| Completed / halted / timed out | 840 / 15 / 3 |
| Audio tasks / task-start snapshots | 420,234 / 188,765 |
| Instruction DMA occurrences | 406,224 |
| Distinct resulting IMEM images across the corpus | 37,801 |
| Tasks with multiple instruction loads | 1,147, across 3 ROMs |
| Runs with no audio tasks | 56 |
| Published compressed capture bytes | 2,023,601,959 |
| Live / offline collector matches | 858 / 858 |

All 839 previously completed ROMs completed again. The 15 halts are unchanged.
All-Star Baseball 2001 reached 600 VIs instead of timing out at 586; its extra
11 audio tasks account for the corpus's task-count increase. The other three
timeouts remain timeouts. This is not a performance benchmark or evidence of
an emulation fix: the wall-clock cutoff is sensitive to host load.

All audio and graphics collectors match the baseline in 857 runs; All-Star
Baseball's additional progress is the only difference. Guest results, including
cycles and failure context, match in 855 runs after excluding host stack paths
and line numbers. The other two differences are checkpoint progress in existing
timeouts: `(C) MUSHROOM &NU15:5` reached 60 rather than 50 million cycles, and
Pocket Monsters Stadium reached VI 25 rather than 22. No previously completed
run acquired a failure requiring a regression recheck.

The offline catalogue contains 24 provisional fingerprints and 74,109 exact
interpreted code/data variants. Neither count is an independent program label.
All 406,224 instruction loads use one row with no skip: 401,388 main loads at
`0x1080`, and 2,418 of each `0x1680` shape described below. Thirty-six audio
runs have no later instruction DMA (18,846 tasks); direct-loaded IMEM is already
present in their task-start snapshots. Multi-row wrapping and queued ownership
are covered by tests, rather than demonstrated by this particular corpus.

A nine-ROM pilot used the same settings. All nine outcomes and task-start
collectors matched the previous corpus: eight completed and Battle for Naboo
halted at its existing failure. It captured 3,689 tasks and 7,275 instruction
loads. All live collectors matched offline replay. The new reader also replayed
all 858 legacy version-1 captures without changing their recorded collectors.
Legacy load coverage remains unknown (`null`), distinct from a measured zero.

### Task-start bytes can change before DMA

An independent offline check compared available task-start raw code bytes with
their recorded DMA destinations, and checked that bytes outside each transfer
were unchanged. All 64,531,584 checked untouched bytes matched. However, 5,202
loads across ten ROMs differed from a few bytes in the earlier source window:
Wave Race variants, Virtual Pool, Waialae and Harukanaru Augusta. The varying
offsets and examples are retained in `source-differences.json`.

Bounded live rechecks of the first eight loads in each of those ten ROMs
confirmed the distinction: **all 80 captured loads match RDRAM at DMA time**,
while the source bytes have changed since task start. This is additional
evidence against treating the complete copied window as immutable program
identity. It does not by itself establish whether each changing field is code
or data. `full-source-check.json`, `live-source-*.json` and the diagnostic
scripts retain the checks. The pilot and all extended cohorts had no such
source differences and no changes outside their DMA destinations.

## Observed overlays

### Indiana Jones and Battle for Naboo

Both USA pilot captures load the main program at IMEM `0x1080` (`0xf80` bytes),
then repeatedly copy code at `0x1680`. The two later lengths are `0x918` and
`0x1a8`. The longer copy reproduces the main-code image; the shorter copy
changes it. Task 1 in each game has five loads: main, long, short, long, short.
The observer retains the long copy even when it does not change any IMEM bytes.

Across the pilot, Indiana Jones has 586 main loads and 1,206 copies of each
later shape; Naboo has 297 main loads and 587 copies of each later shape.
Both use the same two complete resulting IMEM images in these runs. That is
evidence of shared observed code, not proof of equivalent command inputs or
whole-game behavior.

| ROM | Canonical ROM SHA-256 prefix | Pilot run | Task / local load comparison |
| --- | --- | --- | --- |
| Indiana Jones USA | `6e127e592f098` | `1151fa33-9912-4fc0-8e67-cf95ab494517` | 1 / 1 versus 3 |
| Battle for Naboo USA | `515b2302fefe` | `f558f4d9-cfab-4bee-8c03-9e370001331f` | 1 / 1 versus 3 |

### Perfect Dark

The 600-VI startup window missed the overlay predicted by the earlier static
analysis. Two additional four-ROM cohorts extended execution to 2,400 VIs,
with a 5-billion-cycle limit and a 120-second timeout. One kept the controller
neutral; the other pressed Start for two VIs after 240 neutral VIs, waited
120 VIs, pressed Start for another two VIs, then remained neutral. Both
completed all four ROMs and produced 4,646 tasks and 5,038 instruction loads.
These settings differ from the full sweep and are reported separately.

In Perfect Dark Europe, the first overlay appears at **VI 2,147**, in audio
task **933**. It copies **`0x9c0` bytes to IMEM `0x1238`**, exactly the length
predicted from task-start data `0x0c = 0x09bf` and the SP DMA rounding rule.
The source is the task's code pointer plus `0xf80`. The first `0x80` source
bytes already available in the task-start raw window match the captured
overlay. The subsequent `0xdc8`-byte copy restores the exact full main IMEM
image. There are 196 overlay loads and 196 restores in each extended run;
125 tasks have multiple loads.

Reproduce this from `extended-neutral/corpus/runs/5b55a1ed-4a01-4129-853d-7554aa736011`
(ROM hash prefix `8e432b1a5f4c`). Compare task 933's local load 1 with load 2;
load 3 is the restore. Their run-wide load ordinals are 933, 934 and 935.
The archive's `overlay-evidence.json` retains complete transfer metadata,
report hashes and the prefix/restoration checks.

### Rare custom loaders and remaining coverage

Jet Force Gemini USA and Mickey's Speedway USA execute their custom bootstrap
and load `0xf80` bytes to IMEM `0x1080`; observation does not depend on the
provisional detector recognizing that loader. Their DMA enqueue PCs differ
from the standard bootstrap (`0x18` versus `0x1c`).

The 2,400-VI runs observed only the initial program DMA per task in Banjo-Tooie,
Jet Force Gemini and Mickey. A further neutral-input cohort extended these three
to 7,200 VIs, with a 20-billion-cycle limit and 180-second timeout. All completed,
recording 9,877 tasks and 9,877 main-program loads, with no later overlays. All
three live collectors matched replay. These runs are retained separately under
`extended-7200-neutral`.

This does not disprove the overlay paths identified in their task-start
code/data. In particular, Perfect Dark's captured overlay does not supply
Banjo-Tooie's distinct `0x848`-byte overlay. These candidate identities remain
incomplete pending execution coverage of those paths, likely requiring more
targeted input than waiting through startup.

## Using the evidence

The [catalogue commands](audio-microcode-catalogue.md) replay the entire
published stream, aggregate ordered load sequences and compare selected IMEM
states without executing ROMs. Load selectors are local to the selected task;
records also retain run-wide ordinals. The archive retains raw streams, replay
output, comparison output, audit scripts and checksums so later passes do not
depend on this emulator revision's interpretation.

Distinct IMEM hashes are not a count of microcode programs: main DMA can copy
changing non-code tails, and the unchanged bootstrap/previous contents remain
in each complete snapshot. Sequences are observed prefixes, including a
possibly unfinished final task. A startup sweep cannot establish all gameplay
paths or independent semantic ground truth. Review complete code and relevant
constant inputs before accepting HLE identities or minimizing fingerprints.
