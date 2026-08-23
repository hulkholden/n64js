# Benchmarks

The end-to-end benchmark runs the emulator without graphics or audio output. ROM files are always supplied on the command line; no local ROM path is stored in the repository.

```sh
bun run benchmark --rom /path/to/rom.z64
```

Multiple ROMs can be measured in one invocation:

```sh
bun run benchmark --rom /path/to/first.z64 --rom /path/to/second.z64
```

Each sample creates and boots a fresh emulator, runs an unmeasured warm-up, then measures a fixed number of emulated CPU cycles. ROM loading and emulator initialization are excluded from timing. Human-readable output includes every sample, the median throughput, median absolute deviation, and a final CPU-state fingerprint.

Use JSON output for comparisons or CI artifacts:

```sh
bun run benchmark --rom /path/to/rom.z64 --json > benchmark.json
```

Run `bun run benchmark --help` for cycle, sample, and chunk-size options. For meaningful comparisons, use the same ROMs and arguments, close unrelated CPU-intensive applications, keep the machine on AC power, and record the Bun version and machine type reported in the JSON output.
