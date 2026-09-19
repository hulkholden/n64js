# Audio microcode inventory validation

Run on 2026-09-19, based on `d7c71e2` with the audio observation changes.
See [the research and detection rules](audio-microcode-detection.md) for what a
family and fingerprint establish, and what they do not.

## Complete scan

All 858 ROM files under `/Volumes/Data/Roms` were scanned: 858 distinct canonical
ROM hashes, including regional releases and revisions. Four independent batch
workers used the same unchanged source, seed 1, 600 VI events, a 5,000,000,000-cycle
limit, and a 60-second timeout per ROM. Audio ran through RSP LLE. The runtime
was Bun 1.3.14 on macOS arm64.

The scan source hash was
`90e8d5737334889cfebf949c34c420d6c4f97290d6eb7486f0211f9006e68e49`.

| Run outcome | ROMs |
| --- | ---: |
| Reached 600 VI events | 826 |
| Halted | 20 |
| Timed out | 9 |
| Reached cycle limit | 3 |

All 858 reports were readable through the standard inventory summary/query
commands, with no report validation errors or missing audio collectors. Partial
runs retain their observations; they are not treated as successful completion.

The scan recorded **402,996 audio tasks in 795 ROMs**. No audio task was observed
in the other 63 within the run budget. Every audio-observed ROM had one stable
fingerprint throughout its run, for 25 distinct fingerprints overall. No
observed image was marked invalid.

| Initial classification | ROMs | Fingerprints |
| --- | ---: | ---: |
| ABI1 | 534 | 4 |
| NAUDIO | 176 | 5 |
| NEAD | 49 | 10 |
| Unknown | 36 | 6 |

These are observation counts, not an independently established accuracy score.
The frame/input budget does not cover every menu, music track, gameplay state,
or later microcode overlay.

## Follow-up validation

The complete scan exposed a narrow dispatcher assumption: Doubutsu no Mori
loads adjacent command words from fixed DMEM addresses. The detector now accepts
adjacent words on the same base, including nonzero offsets. Review also found a
static control-flow edge case: recording a branch delay slot must not prevent
exploring it as a separate handler entry. Both fixes have synthetic regressions
that failed before the change and pass afterwards.

The complete scan's reports are preserved. Separate follow-up runs use one ROM
for each of its 25 observed fingerprints, with the same seed and run budgets.
The control-flow correction changed the fingerprint of the NEAD revision shared
by Pokemon Stadium 2 and Majora's Mask, so all nine other ROMs with that original
fingerprint were also retested. All ten consistently acquired the same corrected
fingerprint, with their family and task counts unchanged.

There were **34 follow-up runs: 33 reached 600 VI events and Rogue Squadron
timed out with the same audio observation as the complete scan**. Twenty-three
entire audio collector snapshots were identical. The remaining eleven changed
only as expected: the ten corrected NEAD fingerprints, plus Doubutsu no Mori's
new NEAD classification and fingerprint. All 34 retained their original task
counts and one stable fingerprint per ROM.

The follow-up source hash was
`f7050fb7cac2f01ee287ae0f3da54ef5a774974c1f77ea2d33cb8bb5e94a2e6d`.
Taking the latest result for each retested ROM gives:

| Reviewed classification | ROMs | Fingerprints |
| --- | ---: | ---: |
| ABI1 | 534 | 4 |
| NAUDIO | 176 | 5 |
| NEAD | 50 | 11 |
| Unknown | 35 | 5 |

Thus 760 of the 795 audio-observed ROMs have a structural family assignment.
The 35 unknowns include the alternate bootstrap in Jet Force Gemini and
Mickey's Speedway, and programs without the supported dispatcher, such as
Resident Evil 2 and Rogue Squadron. They are not assigned a default family.
These reviewed totals combine the original scan and explicit follow-ups; they
are not a second complete scan with the final source.

Both Tetrisphere ROMs completed the full scan, each with one ABI1 fingerprint
across 585/587 audio tasks. The USA retest reproduced its entire audio collector
snapshot. Its observed code differs from Mario's despite an identical dispatch
table; it retains a separate revision fingerprint.

Checks at this stage: **566 tests passed**, lint passed, production build passed, and
`git diff --check` passed. The detector tests use synthetic programs; the
independent real-microcode handler checks are described in the research notes.

## Shared decoder refactor

Instruction fields and named opcode/register constants subsequently moved into
`src/decode_rsp.js`, shared by the audio detector, RSP interpreter and RSP
disassembler. Its constant naming and bit-field comments follow the pattern in
[PR #46](https://github.com/hulkholden/n64js/pull/46). `findDispatchers` now includes
an assembly example and explains its symbolic register tracking.

A comparison against the pre-refactor detector gave identical classifications
and fingerprint inputs for 17 captured programs and every one of Tetrisphere's
585 audio tasks over 600 VI events. The live check also compared task snapshots.
The full suite now has **570 passing tests**; lint, production build and
`git diff --check` pass. The scan source hashes above retain their original
provenance.

## Local artifacts

Full reports and manifests are in `build/audio-inventory`; representative retests
are in `build/audio-inventory-review`. Both are ignored build artifacts. No ROM
images or captured microcode bytes are included in the repository.
`build/audio-detection/final-analysis.json` contains the combined counts, source
hashes, retest report paths and remaining unknown ROMs.

```sh
bun run inventory-summary build/audio-inventory
bun run inventory-query build/audio-inventory --audio-microcode Unknown
bun run inventory-summary build/audio-inventory-review
```
