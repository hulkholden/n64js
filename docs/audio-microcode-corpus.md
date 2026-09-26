# Audio microcode corpus

Capture task-start observations once, then analyze them without running ROMs:

```sh
bun run inventory /path/to/game.z64 --audio-corpus build/audio-corpus --output build/game.json
bun run inventory-batch /Volumes/Data/Roms --output-dir build/audio-scan --audio-corpus build/audio-corpus
bun run audio-microcode-replay build/audio-corpus --check --output build/audio-analysis.json
```

The batch command records the absolute corpus destination in each scan manifest;
`--resume` preserves it. Completed reports are reused. Retrying an interrupted
ROM creates a separate capture run; the earlier partial evidence is retained.
Use different directories for the inventory root and the corpus root.
The corpus is local data containing game code. Keep it under ignored `build/`
or outside the repository; do not commit captured bytes.

## Evidence and provenance

Each inventory invocation creates `runs/<uuid>/report.json` and
`runs/<uuid>/tasks.jsonl.gz` under the corpus directory, even if no audio task is
observed. The report contains the canonical ROM hash, emulator revision and
dirty flag, a hash of emulator source/package/lockfile contents, Bun version,
seed, input policy, execution budgets, outcome and live collector. Capture files
are resolved relative to their containing directory when replaying, so an
archive can be moved without access to its original ROM or output paths.

Both capture versions retain, for every observed audio task:

- The complete 64-byte task header, including the original pointers and sizes.
- All 4 KiB of IMEM at task start, including the loaded bootstrap.
- Up to 4 KiB of RDRAM at each microcode code/data pointer, independently of the
  declared sizes and classifier. Windows stop at the end of RAM; null or
  out-of-RAM pointers produce empty windows. These are raw windows, **not a
  claim that every byte is executable or constant**.
- The current loader's interpreted code/data images, load address, declared
  sizes and issues, so the existing detector can be replayed exactly.
- A one-based audio task ordinal, VI count and elapsed emulated cycles.

Snapshots own their bytes before emulation continues. No command list or sample
pointers are followed. Version 1 has task-start scope and does not observe
later DMA overlays. Boot code outside IMEM and code/data
pointers outside RDRAM cannot be reconstructed from these windows alone.

## Instruction DMA (version 2)

New inventory captures also record DMA reads into IMEM issued during audio
tasks. The optional observer copies all 4 KiB of IMEM **after the actual memory
copy**, before RSP execution continues. This includes overlays and restores,
independent of loader recognition. DMEM reads, SP-to-RDRAM writes and transfers
issued while halted or running non-audio tasks are excluded. The initial
bootstrap/direct-loaded code is already in the task-start snapshot.

Each occurrence records the audio task ordinal, a run-wide load ordinal,
source and destination addresses, decoded DMA row length/count/skip, RSP PC at
enqueue, and frame/cycles at copy time. The queued transfer retains its task
association if it executes after that task halts or a new task starts. PC is
diagnostic state at enqueue, not proof that an RSP instruction issued the DMA
(the CPU can write SP registers too). Memory copies occur synchronously when
the transfer starts in this emulator; the later completion event is not the
snapshot boundary.

`instruction-image` records hold resulting IMEM bytes, deduplicated within each
run by SHA-256 of the bytes. `instruction-load` records reference those images;
every occurrence is retained, including repeated identical loads. Multi-row
transfers and wrapping use the actual copied IMEM. The snapshot is the final
state of that atomic copy, not a separate source payload for each row. Metadata
publishes `loads` and `instructionImages` alongside the existing counters. All
records share the same checkpoint prefix and integrity checks.

The reader accepts versions 1 and 2. `readAudioCaptureEvents` yields task starts
and instruction loads in recorded order. The original `readAudioCapture` API
still yields only starts, while validating the entire stream. Old captures have
unknown instruction-load coverage, represented by `instructionLoads: null` in
analyses; a version-2 run with zero loads has a recorded zero.

These are **post-execution observations used to review identities**, not inputs
available to the eventual task-start classifier. That classifier must use
pre-execution information. Ordered sequences are observed prefixes, not proof
of task completion or all possible paths: VI budgets/timeouts may stop mid-task.
Direct CPU writes to IMEM after task start are outside this DMA observer's scope.
Normal runs without `--audio-corpus` do not enable the observer or copy IMEM on
DMA. Emulation, audio dispatch and the provisional detector remain unchanged.

## Storage and interrupted runs

The stream contains `image` records followed by `task` references. An image ID
is SHA-256 of its encoded snapshot (all fields, including raw evidence).
Identical snapshots are stored once **within a run**. Changed scratch bytes,
task pointers, unreachable instructions and non-dispatch constants are retained
even if the structural classifier produces the same revision fingerprint.
There is no deduplication based on ROM name, family or classifier output.

Records are buffered until an inventory checkpoint and appended as complete
gzip members. Compression reduces repeated content across snapshots without
discarding differences. The worker flushes before sending the checkpoint; the
parent atomically publishes the report with the corresponding compressed byte
count, task/image/load counts and live collector. A timeout or interrupted write may
leave extra bytes after this prefix. Offline replay reads only the published
prefix. Missing bytes, gzip corruption, changed image hashes, invalid references
and mismatched counts are errors, not an empty corpus.

The capture adds copying, hashing, compression and disk I/O to an inventory run.
It is intended for data collection, not performance benchmarking. Audio still
executes through LLE. Ordinary browser emulation has no inventory observer.

## Offline analysis

`audio-microcode-replay` accepts one or more corpus roots or individual capture
run directories. It emits current analyzer provenance, elapsed time, per-run
classifications, captured task/image counts, source provenance and whether the
new collector exactly matches the saved live collector. `--check` exits 1 on a
mismatch; missing live collectors are reported separately. An empty collector
means zero observed tasks. It is distinct from a worker failing before collection
started. Timeout and still-running reports retain their partial status.

`--output` creates a new file exclusively. To keep successive analyses, choose
different names. It never updates the captured report or its labels.

For a new classifier, consume the async `readAudioCapture(directory, capture)`
iterator in `src/inventory/audio_microcode_capture.js`. Each yielded task has
`imageId`, `image`, `task`, `frame` and `cycles`; `image.raw` is independent of
the existing structural detector. `readCaptureReport` reads and validates the
capture metadata. The replay module demonstrates aggregation into reports.

The current labels are hypotheses derived from program structure. Agreement
with the live detector verifies capture/replay fidelity, not classification
accuracy or HLE compatibility. Independent review of distinct programs and
additional gameplay coverage are still needed before training a lean classifier.

Use the [offline catalogue and comparison tools](audio-microcode-catalogue.md)
to audit raw differences before accepting a program identity. The
[September 26 audit](audio-microcode-audit-20260926.md) records the full group
inventory and an instruction-overlay capture gap found during that review.
