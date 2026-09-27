# Browser audio classifier

This implements the two identities in the [offline reference](audio-microcode-reference.md)
as a synchronous browser module. It accepts the same raw task-start windows and
returns the same known, unknown and ambiguous results. It is not yet called by
the emulator, and does not select HLE handlers.

```js
import { createAudioMicrocodeClassifier } from './src/hle/audio_microcode_classifier.js';
const classify = createAudioMicrocodeClassifier();
const result = classify(image.raw);
```

The reviewed manifest is shared with the reference. Task-layout checks and the
hash implementation are independent, allowing the offline native-crypto
reference to detect implementation mistakes. The browser has no Node imports,
external dependencies or asynchronous work. Its bounded SHA-256 implementation
follows [FIPS 180-4](https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.180-4.pdf).

## What is minimized

Recognition retains the reference's complete SHA-256 digests over every reviewed
bootstrap, code and constants byte. Sampling a few words alone would accept
changes elsewhere in those ranges. This implementation minimizes repeated work
without changing the evidence required for recognition.

There is one cache entry per distinct range length, separately for bootstrap,
code and data. A hit requires comparing **every byte** against a private copy of
the previous input. The caller's buffer identity, guest addresses and previous
result are insufficient. Both known and unknown range matches can be reused.
Task headers and source-window bounds are revalidated on every call.

The current manifest retains 8,300 copied bytes in five entries, plus bounded
hash scratch space. Cache size does not grow with task count. Unreviewed bytes
are not installed as new signatures: a cache miss still uses the manifest's
original SHA-256 rules. Results and cached snapshots cannot be mutated through
the objects returned to callers.

The retained alternatives are:

- `uncached`: calculate every required digest on every call.
- `cached`: compare the full protected range before reusing its digest match.

An initial experiment also checked a middle word before comparing a cached
range. It showed no consistent improvement in Chromium, so this probe is not
part of the retained implementation. Its results and matching source revision
are preserved in the local evidence archive.

## Reproduce validation and measurement

```sh
bun run audio-microcode-lean /path/to/corpus --output build/new-lean-audit --browser
# Repeat the browser phase without rereading captures or repeating the Bun benchmark.
bun run audio-microcode-lean --browser-samples build/new-lean-audit/samples.json \
  --output build/new-browser-measurement
```

Inputs may be version-1 or version-2 corpora or individual capture directories;
multiple inputs are accepted. The output directory must be new. The browser
option uses the repository's pinned Playwright Chromium installation. No ROMs
are executed and no capture files are modified.

The browser loads large sample sets through a loopback HTTP endpoint, outside
the automation protocol. `--browser-samples` reuses the saved inputs and expected
results; it does not replace the full-stream audit.

The command compares both strategies with the native reference on **every
task occurrence**, including repeated images and unknown programs. It validates
complete published streams, including instruction records that are never
classifier inputs. All twelve reviewed examples must be present and correct.
Mismatches fail the run and retain representative task/image references.

`audit.json` records source/manifest/report hashes and comparison counts.
`samples.json` holds the first four consecutive task occurrences per run plus
reviewed cases; it contains captured bytes and must stay outside version control.
`bun.json` and `chromium.json` hold correctness checks and timing distributions.
The browser report also pins the bundle and sample hashes and Chromium version.

Timing starts after loading, decoding, construction and warmup. Seven rounds
rotate strategy order and report median, minimum, maximum and each individual
measurement in microseconds per call. Results are consumed through a checksum.
Workloads include 64-call blocks per ROM, deterministically shuffled samples,
and repeated Mario/US Tetrisphere tasks. The blocks repeat the four sampled
occurrences; they are controlled workloads, not end-to-end game profiles.
The Bun native reference is a host-side comparison, not a browser alternative.

Tests compare the browser hash with native SHA-256 for all 4,097 supported input
lengths, including padding boundaries and unaligned views. Chromium repeats this
against Web Crypto. Both engines also check every protected-byte mutation of
the real Mario and US Tetrisphere examples (9,004 changes per strategy), restored
identities and excluded-tail changes. Synthetic unit tests exercise invalid
headers, short windows, ambiguous manifests and mutation of cached input buffers.

## Corpus results

The final comparison used clean revision
`ca52ce2c09009821c1795c9e73bab266e8f92e16`, source SHA-256
`9a84b880f4d22f5ca8e290a1559933ccb76b32e1dfc08046e56c7245b516fdb5`,
with Bun 1.3.14 on an Apple M4 (macOS arm64). The reviewed manifest hash remains
`95aa41602aa7cd37b6a4fa2ffb30a2da0f5583c3793425a7ff8ef92c158a8bff`.

| Saved captures | Runs | Tasks | Recognized | Unknown | Disagreements |
| --- | ---: | ---: | ---: | ---: | ---: |
| Version 2 full corpus | 858 | 420,234 | 292,037 | 128,197 | 0 |
| Version 1 full corpus | 858 | 420,223 | 292,026 | 128,197 | 0 |
| Pilot and extended captures | 20 | 22,858 | 1,760 | 21,098 | 0 |

Both strategies agree with the reference across all 863,315 task occurrences
and 386,731 captured images. All twelve reviewed cases match, with no ambiguities.
This preserves the reference's limited coverage; it does not turn unreviewed
programs into recognized ones. All 1,491 repository tests, lint and build pass.

Chromium 145.0.7632.6 reproduced all 6,492 sampled results and both strategies
passed 9,004 protected-byte mutations, restored identities and two excluded-tail
checks each. Its SHA-256 output matched Web Crypto for all 4,097 input lengths.

Median classification cost in Chromium, in microseconds per call:

| Workload | Uncached | Full-byte cache |
| --- | ---: | ---: |
| 64-call ROM blocks | 60.83 | 4.03 |
| Shuffled images | 64.20 | 32.38 |
| Repeated Mario USA | 67.31 | 2.71 |
| Repeated Tetrisphere USA | 67.53 | 2.71 |

For repeated US Tetrisphere, cached measurements ranged from 2.697 to 2.713 µs.
The corresponding Bun median was 1.994 µs. Shuffling demonstrates the cost of
cache misses: caching does not make cold hashes free. These are classification
costs, not emulator speedups, and exclude creating the task snapshot.

The browser phase used harness revision
`33a2e04fbb0b17c778408065ada5fadb178d7f6a`, source SHA-256
`b84a8e6facf2ee2b29ac06d86ced47ad2ea34d01ce6d68d1fb5dfe939c65f835`.
Only sample transport changed after the corpus/Bun run. The classifier and
measurement sources, browser bundle and saved sample hash are identical across
those revisions. Reports retain both pins and all seven timing rounds.

Source, runtime, full reports and reproduction instructions are archived at
`/Volumes/Data/n64js-inventory/diagnostics/2026-09-27-audio-lean-classifier`.

## Integration boundary

The next change can install one classifier instance per emulator and expose the
result through inventory reporting. It should preserve the raw task-start input
contract and retain LLE for unknown programs. Recognition is still a reviewed
program identity, not certification of HLE equivalence for arbitrary command
streams or entry states. Expanding the manifest requires further review.
