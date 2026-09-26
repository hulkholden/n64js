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

Version 1 captures, for every observed audio task:

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
pointers are followed. The capture has task-start scope: it does not observe
later DMA overlays or self-modification. Boot code outside IMEM and code/data
pointers outside RDRAM cannot be reconstructed from these windows alone.

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
count, task/image counts and live collector. A timeout or interrupted write may
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
