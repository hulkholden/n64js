# Audio classifier inventory integration

Observed audio tasks now use the [browser classifier](audio-microcode-lean.md)
before RSP execution. `Hardware` creates one classifier lazily and reuses its
bounded, full-byte-verified cache across tasks. Reset drops the cache; separate
emulator instances own separate classifiers.

The existing `onAudioTask` callback receives `(image, classification)`. The image
is the same owned task-start snapshot used for raw capture; the classifier sees
only `image.raw`. Callback return values remain ignored. Tasks still execute
through LLE (or the existing Disabled option), including recognized programs.
When no audio observer is installed, no snapshot or classification work occurs.

## Report schema

New inventory reports use version 2 of `audio.taskMicrocodes`. Existing structural
families, fingerprints and evidence are retained. Each structural group adds a
`classifications` array of distinct results with task counts, for example:

```json
"classifications": [
  {
    "status": "known",
    "identity": "abi1-standard-mixer",
    "family": "ABI1",
    "bootstrap": "rspboot-204",
    "tasks": 2
  },
  {
    "status": "unknown",
    "identity": null,
    "family": "Unknown",
    "reason": "unreviewed-constants",
    "tasks": 1
  }
]
```

A structural fingerprint can omit constants or other bytes protected by the
reviewed identity. Assigning one identity to the whole group would hide those
differences. Counts therefore cover every observed result, including unknown
and ambiguous results. They sum to the group's task count; group counts sum to
the collector total. Readers reject malformed results or inconsistent counts.

The structural family's `ABI1` and a nested classification's `Unknown` are not
contradictory: the program can resemble ABI1 without matching a reviewed identity.
Recognition identifies reviewed code/constants, not HLE compatibility.

## Queries and replay

```sh
bun run inventory-query /path/to/inventory --audio-identity abi1-standard-mixer
bun run inventory-query /path/to/inventory --audio-identity unknown
bun run inventory-query /path/to/inventory --audio-identity ambiguous
bun run audio-microcode-replay /path/to/corpus --check
```

Identity queries are case insensitive. A version-1 collector has no identity
evidence, so it is reported as unknown evidence, not as an observed `unknown`
classification. An empty version-2 collector means no identities were observed.
Existing family queries accept both collector versions. Multiple query filters
apply to the same report, not necessarily the same task. Inventory summaries
retain the nested classifications and their counts.

Replay recomputes version-2 identities from captured bytes, without trusting
saved labels. Version-1 reports keep their original structural-only comparison.
Offline structural catalogues continue to emit version 1. Raw capture formats,
image hashes and instruction-load observations are unchanged; collector version
and raw capture version are independent.

## Validation boundary

Integration tests cover classifier reuse/reset/isolation, skipped work without
an observer, unchanged dispatch, mixed outcomes within one structural group,
query validation and replay detection of altered classifications.

Live validation uses selected ROMs and the settings from their saved captures.
It compares fresh task-start results with the independent native-crypto reference,
checks raw task/instruction sequences and retained structural reports, and
replays the new captures. This is a targeted integration check, not a new full
inventory or evidence of HLE correctness.

## Live results

The integration was validated at clean revision
`4596ea824dc133cebd8f26a4f470fd55ee2d9a58`, source SHA-256
`ecab6d3fe86e1e5cf6223b69ef7fb4d7654f86e0634a5f93adf4fd4716299132`,
using Bun 1.3.14. Each case replayed its saved seed-1 random-controller settings:
600 VI retraces, 5 billion CPU-cycle limit, 60-second timeout and graphics HLE.
Audio remained LLE. The saved captures used revision
`fc8d0d810d18c6244fe63b173e417b900bd6f620` with the same Bun version.

| ROM | Audio tasks | Result on every task |
| --- | ---: | --- |
| Super Mario 64 USA | 588 | `abi1-standard-mixer` |
| Tetrisphere Europe | 587 | `abi1-standard-mixer` |
| Tetrisphere USA | 585 | `abi1-tetrisphere-us-mixer` |
| Diddy Kong Racing USA Rev 1 | 298 | Unknown: `unreviewed-code` |
| GoldenEye 007 Japan | 285 | Unknown: `unreviewed-code` |
| Jet Force Gemini Europe | 298 | Unknown: `unreviewed-bootstrap` |

All six runs completed. Every one of the 2,641 task classifications agreed with
the independent native-crypto reference and the saved task's classification.
The ordered raw task and 2,641 instruction-load sequences matched exactly,
including byte-verified image IDs, frame/cycle positions and DMA metadata.
Emulated outcomes, structural audio records and all graphics collectors were
unchanged. Both the old structural-only and new identity-aware collectors
replayed exactly. All six reviewed example images were present and correct.

All 1,494 tests, lint and the browser build passed. The targeted runs do not
replace the prior full-corpus classifier comparison or establish HLE behavior.
Pinned source/runtime, raw captures, report hashes, commands and the independent
comparison script are retained locally at
`/Volumes/Data/n64js-inventory/diagnostics/2026-09-27-audio-classifier-integration`.
