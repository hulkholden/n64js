# Offline audio reference identities

The initial reference classifier established two reviewed ABI1 identities before
attempting to minimize a fingerprint. It hashed complete reviewed ranges of
task-start bytes, without structural fingerprints, game names, ROM hashes or
instruction-DMA observations as classifier inputs. That initial change did not
alter runtime dispatch or audio HLE.

The current manifest is extended by the [20-identity review](audio-microcode-coverage.md),
including NAudio, NEAD/direct entry and descriptor programs. Historical counts
and the original twelve examples below describe the initial review.

```sh
bun run audio-microcode-reference /path/to/corpus --output build/reference.json
bun run audio-microcode-reference /path/to/full/corpus --check \
  --output build/reference-checked.json
```

The command reads version-1 and version-2 captures, validates each entire
published prefix, and creates outputs exclusively. Reports contain analyzer and
manifest hashes, source provenance, coverage, ambiguous results, representative
task/image references and a cross-tab with the structural detector. Family
agreement is a diagnostic, not independent proof of a program identity.

`--check` requires all twelve reviewed examples to be present and match their
expected identities, with no ambiguities or family disagreements. It therefore
fails for a subset missing examples. Unknown tasks are expected and do not
themselves fail the check. The examples are matched by canonical ROM/image hashes
only **after** classification; these hashes never enter the classifier.

## Reviewed ranges

Offsets below are relative to the raw code or data window. End offsets are
exclusive. The manifest stores SHA-256 digests, not captured instruction bytes.
Identity names describe these observations; they are not SDK release names.

| Identity | Code range | Data range | Reviewed distinction |
| --- | --- | --- | --- |
| `abi1-standard-mixer` | `[0, 0xe20)` | `[0, 0x2c0)` | Shared by Mario USA and European Tetrisphere, among others |
| `abi1-tetrisphere-us-mixer` | `[0, 0xdf0)` | `[0, 0x2c0)` | US Tetrisphere's distinct mixer loop |

The [original audit](audio-microcode-audit-20260926.md) establishes the mixer
distinction. Both programs load at IMEM `0x1080`. The standard program's last
reviewed instruction is the delay slot at `0x1e98`, followed by one padding
word. US Tetrisphere ends at its delay slot at `0x1e6c`; the adjacent bytes form
a different table rather than more of this program. The reference includes
every byte before those boundaries, including gaps and padding, rather than
just the words reached by the existing structural traversal.

Within these ranges, the indirect branches are the dispatcher at `0x110c`,
the command-fetch return at `0x117c` (its destination is saved from the link
register), and DMA subroutine returns at `0x11a8`/`0x11d4`. The valid ABI1
dispatcher entries reside at data `[0x10, 0x30)` and point into the reviewed
program. The complete `[0, 0x2c0)` data prefix includes this table, vector
constants and the resampling coefficient table starting at `0xc0`. The
resampler sets that table base at `0x191c`; the reference retains the complete
table, not merely the handler addresses. This is also the complete initialized
data image in the corpus's tasks declaring a `0x2c0`-byte data DMA.

The two programs have the **same data-prefix hash**. A dispatch-table-only
signature would conflate them. Their full reviewed code hashes differ. Other
ABI1 programs, including GoldenEye and Diddy Kong Racing, deliberately remain
unknown in this initial manifest; the family label alone is insufficient.

## Establishing the loading layout

The reference rechecks the actual bootstrap in task-start IMEM. It does not
trust the saved `loader`, `loadAddress`, interpreted code/data or declared code
size. Two exact bootstrap programs have been reviewed:

| Bootstrap | IMEM range | Final jump and delay slot |
| --- | --- | --- |
| `rspboot-204` | `[0x1000, 0x10cc)` | `0x10c4` / `0x10c8` |
| `rspboot-208` | `[0x1000, 0x10d0)` | `0x10c8` / `0x10cc` |

The 204-byte program occurs in both 208-byte and 256-byte CPU loads. Its bytes
after `0x10cc` are padding or adjacent data; treating the declared load size as
the executable size would manufacture a third loader identity. Every loader
instruction, including its complete initial data-loading path and status
checks, is protected by the hash.

Both programs load task data to DMEM zero, then copy exactly `0xf80` code bytes
to IMEM `0x1080`, wait and jump to that address. The data transfer rounds up to
eight bytes. The classifier requires aligned non-null code/data pointers,
complete captured source windows, enough loaded data for the constants, and a
data transfer ending no later than DMEM `0xfc0`. A longer transfer could overwrite
the task header before the bootstrap reads its code pointer. The declared code
size is intentionally ignored because these instructions never read it.

Only the reviewed program/data prefixes determine identity. Source addresses,
command-list pointers and lengths, previous IMEM after the bootstrap and copied
tails do not. The [instruction audit](audio-instruction-audit-20260926.md)
demonstrates why copying a region does not make all its bytes immutable code.
The new classification API accepts only `image.raw`, so future post-execution
evidence cannot accidentally become an input.

## Evidence and validation

Review uses the frozen corpus at
`/Volumes/Data/n64js-inventory/diagnostics/2026-09-26-audio-instruction-corpus`,
captured with `fc8d0d810d18c6244fe63b173e417b900bd6f620`. Task 1 of the following
runs anchors the positive identities and bootstrap review:

| Example | Canonical ROM SHA-256 prefix | Capture run |
| --- | --- | --- |
| Mario USA | `17ce077343c6` | `a4f48e53-58f8-45ab-8c7d-796b40e44130` |
| Tetrisphere Europe | `1bb4ed1ef078` | `35faeff9-c657-4633-a001-1cc3b8804269` |
| Tetrisphere USA | `f7cbc93ac273` | `1634d96c-8e10-42f9-b3d3-47c2b2235610` |
| 204-byte bootstrap, padded to 208 | `f6a18d9691ae` | `00b75e1d-fc9e-4a0e-ae3d-0b92908aa6f7` |
| 208-byte bootstrap | `230372b76ca9` | `032104d7-d125-43c3-8926-5df35a3e82d0` |
| 204-byte bootstrap in a 256-byte load | `95bea6307555` | `11ebe0e5-8bff-4ebb-8170-512e5e45a744` |

`audio_reference_examples.js` also freezes deliberately unknown examples for
GoldenEye, Diddy Kong Racing, Jet Force Gemini, Indiana Jones, Perfect Dark and
Banjo-Tooie. These expectations identify review scope; an unknown result is not
a claim that a ROM lacks audio or that its ABI family is unknown.

Repository tests use synthetic programs and manifests. Local mutation checks
also change each byte of the real Mario and US Tetrisphere protected ranges
individually: all 9,004 altered examples are rejected. Replacing their excluded
tails leaves the identity unchanged. The local verification output retains
capture report hashes and image IDs; game bytes are not committed.

Both full saved corpora passed `--check`, including all twelve examples, with
zero ambiguous tasks or structural-family disagreements:

| Capture format | Runs | Tasks | Recognized | Unknown |
| --- | ---: | ---: | ---: | ---: |
| Version 1 | 858 | 420,223 | 292,026 | 128,197 |
| Version 2 | 858 | 420,234 | 292,037 | 128,197 |

In version 2, the standard identity covers 291,452 tasks across 530 ROMs;
US Tetrisphere adds 585 tasks from one ROM. The remaining 271 ROMs have
unreviewed code or bootstraps, and 56 runs contain no captured audio tasks.
Per-ROM classifications and task counts agree between capture versions except
for eleven additional standard-identity tasks from All-Star Baseball 2001,
whose newer run reached the full capture budget.

Twenty additional pilot, longer-duration and Start-input captures produced
1,760 recognized and 21,098 unknown tasks, again with no ambiguities or family
disagreements. Their six present review examples all matched; the other six
examples are absent from this subset, so it was audited without `--check`.
The Rare overlay candidates remain unknown.

Reports and reproduction evidence are archived at
`/Volumes/Data/n64js-inventory/diagnostics/2026-09-27-audio-reference-classifier`.
The analyzer ran from clean revision
`29f27f008c1bb4892d7b4c5c52dfa6360f15e4a8` with Bun 1.3.14, source SHA-256
`88529f2dab96389914c524563a94c9f68740386dce0ef66358df1a819514b057`
and manifest SHA-256
`95aa41602aa7cd37b6a4fa2ffb30a2da0f5583c3793425a7ff8ef92c158a8bff`.
Each full audit took approximately 28 seconds, including capture I/O and the
structural diagnostic; this is not a classifier-only benchmark. All 1,484
repository tests, lint and the build passed. These checks replay saved captures
without executing ROMs again.

## Limits and the next classifier

These are reviewed identities for normal ABI1 command use, not a proof that
arbitrary malformed commands cannot redirect execution or overwrite memory.
Command streams, samples and per-task state are inputs, not part of program
identity. Recognition does not certify every input, entry state or an HLE
implementation's equivalence. Unknown/ambiguous results must remain distinct
from recognized identities, with LLE retained when runtime support is added.

The unresolved Rare overlays stay unknown. Positive identities are not inferred
from the absence of later IMEM loads during a startup run. Expanding coverage
requires another explicit code/constants/loader review and new independent
examples, not importing more provisional fingerprints as labels.

A lean classifier can now be measured against this reference over saved raw
images. Matching the corpus is one criterion; rejecting the protected-byte
mutations and preserving unknown cases are others. A tiny signature that selects
the right captured example but accepts a changed mixer or coefficient table is
not a replacement for the reference's identity check.

The [browser classifier](audio-microcode-lean.md) keeps these full-range checks
and measures caching against this independent reference.
