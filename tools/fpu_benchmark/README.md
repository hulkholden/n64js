# GoldenEye single-precision multiply experiment (#341)

The production fast path accepts only MUL.S with round-to-nearest, normal
operands and a normal rounded result. A product of two f32 significands is exact
in JavaScript's f64 intermediate. The existing exception helper handles inexact
status/traps, and the destination is written only after exception resolution.
All other cases use the unchanged generic operation table and result handling.

The benchmark scripts run separately from normal emulation; production code
contains no counters or benchmark switches. See [RESULTS.md](RESULTS.md) for
measurements, limitations and the retention decision.

## Reproduction

Install the pinned dependencies (`bun install`) and Playwright's Chromium
(`bunx playwright install chromium`). Supply your own GoldenEye 007 (USA) ROM;
no ROM or save files are included. Its SHA-256 must be
`2cdcec8a9f0cb6e36337f3ee39d8ad105dc8afa6ba1c02d466e8f5b771f9a162`
to reproduce the recorded results.

Create a baseline snapshot of revision `6e9fbd8`, link its dependencies and build
both revisions. Run these commands from the repository root:

```sh
ROM='/path/to/GoldenEye 007 (USA).z64'
baseline=$(mktemp -d)
git archive 6e9fbd8 | tar -x -C "$baseline"
ln -s "$PWD/node_modules" "$baseline/node_modules"
(cd "$baseline" && bun run build)
bun run build

# Separate diagnostic run: operation/classes, FCSR modes, reservoir of operands.
node tools/fpu_benchmark/goldeneye.js "$baseline" . "$ROM" /tmp/fpu-profile 1 single-diagnostic

# Five fresh-browser pairs, order B/P, P/B, B/P, P/B, B/P; no profiling.
node tools/fpu_benchmark/goldeneye.js "$baseline" . "$ROM" /tmp/fpu-timings 5

# Actual fast-path hits: the first root is used for single-diagnostic runs.
node tools/fpu_benchmark/goldeneye.js . . "$ROM" /tmp/fpu-hits 1 single-diagnostic
```

The scripts bind only to localhost and read the ROM locally. Each run starts a
fresh browser with empty storage, HLE graphics/audio, native render scale and CRT
off, with WebAudio output explicitly resumed. RAF callbacks are disabled. CPU random replacement uses an LCG seeded with
`0x12345678`, multiplier 1664525 and increment 1013904223. Emulation advances
synchronously to VI boundaries using the controller sequence in
[the shared protocol](https://github.com/hulkholden/n64js/issues/165).
Loading is VI 1659–2399; stationary Dam gameplay is VI 2594–3134. Screenshots
confirm the scene. `browser.json` includes timings, runtime/build/ROM hashes,
final state digests, PC, delay PC, Count, pending events and generated-code size.
Diagnostic timings include instrumentation and must not be used as performance
results. Keep all timing runs sequential and free of other CPU-heavy work.

For microbenchmarks, copy the same harness into the baseline snapshot so both
builds use the same inputs and loop:

```sh
mkdir -p "$baseline/tools/fpu_benchmark"
cp tools/fpu_benchmark/micro.js "$baseline/tools/fpu_benchmark/"
bun build "$baseline/tools/fpu_benchmark/micro.js" --format=esm --outfile="$baseline/build/fpu-micro.js"
bun build tools/fpu_benchmark/micro.js --format=esm --outfile=build/fpu-micro.js
node tools/fpu_benchmark/micro_browser.js "$baseline" . /tmp/fpu-profile/browser.json /tmp/fpu-micro.json 5

# Optional Bun/JSC check of the same workloads.
bun "$baseline/tools/fpu_benchmark/micro.js" /tmp/fpu-profile/browser.json
bun tools/fpu_benchmark/micro.js /tmp/fpu-profile/browser.json
```

Each browser/workload warms up 200,000 multiplies, then measures five batches of
two million. Inputs include generated normal values, signed zeros, trapped
exceptions and 4096-entry deterministic reservoirs from loading/gameplay. Input
setup and consumed result/FCSR/trap checksums are included; browser startup,
construction and profiling are excluded. Microbenchmarks use FR=1; correctness tests cover both FR mappings. Fallback-heavy workloads expose the
cost of failed guards. Microbenchmarks are helper throughput, not game speed.
