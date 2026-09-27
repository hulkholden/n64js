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
