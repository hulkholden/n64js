# Offline audio microcode catalogue

Build a catalogue from the [raw corpus](audio-microcode-corpus.md), then compare
representative tasks without executing ROMs:

```sh
bun run audio-microcode-catalogue /path/to/corpus \
  --output build/catalogue.json --markdown build/catalogue.md
bun run audio-microcode-catalogue --compare /path/to/left/run /path/to/right/run \
  --left-task 1 --right-task 1 --output build/comparison.json
```

The same run may appear on both sides to investigate changes during execution.
Ordinals are one-based. Both commands verify the entire published capture
prefix, including records after a selected task, and create output files
exclusively. They never rewrite capture reports. Keep outputs local: comparisons
contain captured game bytes and disassembly.

## Identity and evidence

The catalogue deliberately separates three things:

- A **captured image ID** identifies the original snapshot, including raw
  windows, task pointers and previous IMEM contents. These remain in the corpus.
- An **exact variant ID** hashes the loader interpretation, load address,
  issues, and SHA-256 hashes of the complete interpreted code and data images.
  Nothing is trimmed or masked. Each variant has task counts, run indices,
  provisional fingerprints and a representative task/image reference.
- A **provisional fingerprint** is the existing structural detector's result.
  It is a way to organize the audit, not an independent training label.

Each run has its source provenance and report hash. Both run-level and
fingerprint-level summaries count unique byte images and report varying ranges
for interpreted code/data and all four raw fields. Ranges are half-open byte
offsets. Missing bytes also count as differences, so a short or empty window
cannot masquerade as an unchanged one. Variation within a run is distinguishable
from variation between ROMs. Repeated task references count as tasks, not new
captured images. Duplicate input directories are processed once; outputs are
ordered deterministically apart from timing/analyzer metadata.

`variants[].reference.run` indexes `runs`; `reference.task` selects the task
for the comparison command, and `reference.imageId` checks the selected image.
Run directories are recorded as supplied by corpus discovery. If the archive
moves, use the relocated run directory; report hashes and image IDs remain valid.

Comparisons show every differing byte range. Data and task-header differences
include hex bytes; code and IMEM differences include instruction words, one
word of surrounding context, and the existing RSP disassembler's annotations.
Addresses stay unresolved for unsupported loaders, raw code from a direct IMEM
loader, and raw code beyond the interpreted load. Partial or undecodable words
retain their hex bytes. This is **linear decoding**, not proof of execution or
reachability; IMEM can contain the previous task's code.

Observed stability does not establish immutability. Conversely, different exact
variants do not necessarily mean different programs: loaders can copy unrelated
RAM after the executable, and data windows can contain mutable state. Neither
stable-byte masks nor family names should silently define an HLE identity.

See the [September 26 audit](audio-microcode-audit-20260926.md) for the corpus
results, reviewed distinctions, and an overlay capture gap found by this pass.
