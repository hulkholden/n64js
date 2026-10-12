# COP1 memory instruction effects (#386)

Baseline: `6e9fbd8927cb04fb69d8f9a5ed8f4484ac0abaac`; implementation: `a8d638a9bfb1954e7581b088bad3dda929fc4822`.

Unchecked LWC1/LDC1/SWC1/SDC1 use the existing audited memory boilerplate.
The first usability-checked access remains generic. The change preserves memory
helpers, PC/fragmentOps materialization, dynamic delay targets, exception and
interrupt ordering, and all RSP/interruption checks. Arithmetic helpers are unchanged.

## Rendered GoldenEye

GoldenEye 007 (USA), Dam, 00 Agent, stationary at spawn; HLE graphics/audio,
internal render scale 1, CRT off. Chrome 154 on macOS/Apple M4, WebGL renderer
`ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)`.
Bun 1.3.14 minified builds. ROM SHA-256:
`2cdcec8a9f0cb6e36337f3ee39d8ad105dc8afa6ba1c02d466e8f5b771f9a162`.

Each sample reloads the page and boots a fresh emulator with cleared local storage,
RAF disabled, and deterministic CP0 Random input (seed `0x12345678`, LCG
`seed = imul(seed, 1664525) + 1013904223`, unsigned, divided by 2^32).
The browser process is shared between runs; these are not fresh-process samples.
Profiling and diagnostic instrumentation are disabled during throughput measurements.
The replay is in [driver.mjs](driver.mjs).

The measured window begins after VI 2594 and includes VIs **2595–3134** (540 VIs).
Loading is separately recorded over VIs 1660–2399. No inputs are held during the
measured gameplay window. An independent menu capture confirms 00 Agent.
All ten end snapshots match exactly: CPU/FPU, RAM, RSP state/memory, device
registers, event queue, PC/delayPC and CPU count. The first pair's canvas PNGs
also have identical SHA-256 (`96a21d168479cb6e0c532b35f78028173f66fc63d6a79438092259a2b44ffbb0`).
This is equality of the captured fields, not a proof covering all games or all internal state.

| Pair | Order | Baseline ms | Prototype ms | VI/s change |
| --- | --- | ---: | ---: | ---: |
| 1 | baseline, prototype | 8991.5 | 8872.4 | +1.34% |
| 2 | prototype, baseline | 9153.0 | 13161.8 | -30.46% |
| 3 | baseline, prototype | 9445.7 | 9008.4 | +4.85% |
| 4 | prototype, baseline | 9422.1 | 9298.8 | +1.33% |
| 5 | baseline, prototype | 9280.2 | 9107.9 | +1.89% |

Median paired throughput change: **+1.34%**, range **−30.46% to +4.85%**.
Baseline elapsed time: median 9,280.2 ms, sample SD 190.2 ms, range 8,991.5–9,445.7 ms.
Prototype: median 9,107.9 ms, sample SD 1,835.7 ms, range 8,872.4–13,161.8 ms.
The slow second-pair prototype sample is retained. These noisy shared-host
measurements do not establish a reliable end-to-end speedup. Rates refer to VI
retraces, not rendered game frames. Individual samples and snapshots are in
[timings.json](timings.json); some early rows lack the user-agent field, added
outside timed work during the run.

## Generated code

The retained cache contains 28,216,528 baseline source bytes and 27,596,819
prototype source bytes (**−2.20%**). These are emitted ASCII JavaScript bytes,
not JIT machine-code size or execution counts. Full before/after source for each
fragment is retained in the adjacent `baseline-*.js.txt` and `prototype-*.js.txt` files.

| Fragment | Source bytes, before → after | PC guards | RSP steps (both) | stuffToDo checks (both) |
| --- | ---: | ---: | ---: | ---: |
| `0x7f0b0688` | 9,626 → 8,779 | 23 → 15 | 25 | 46 |
| `0x7f0b05c0` | 4,129 → 4,040 | 11 → 10 | 11 | 19 |
| `0x7f057f28` | 15,228 → 14,688 | 40 → 34 | 40 | 65 |
| `0x7f0581f4` | 9,387 → 8,676 | 21 → 15 | 24 | 40 |

## Compilation cost

A separate instrumented pair uses the same replay and matches the ten timed
snapshots. Time around `addOpToFragment` includes tracing/code generation and
Function construction, with instrumentation overhead; it does not measure later
host-JIT optimization. Combined costs through VI 2594 are **779.4 ms → 705.6 ms**;
the measured 540-VI window adds **123.3 ms → 107.5 ms**, giving totals of
**902.7 ms → 813.1 ms**. This single diagnostic pair is descriptive, not statistically
reliable evidence of compilation speedup. See [compilation.json](compilation.json).

The diagnostic source copy wraps `addOpToFragment` as follows; initialize
`globalThis.cop1CompileStats = { generationAndConstructionMs: 0 }` before loading
and running the emulator, and snapshot that field before and after the window:

```js
function addOpToFragment(...args) {
  const start = performance.now();
  try { return addOpToFragmentMeasured(...args); }
  finally {
    globalThis.cop1CompileStats.generationAndConstructionMs += performance.now() - start;
  }
}
// Rename the original addOpToFragment to addOpToFragmentMeasured.
```

## Reproduce the uninstrumented pairs

Build separate baseline and prototype checkouts using `bun run build`, then:

```sh
node docs/benchmarks/cop1-memory-effects/server.mjs   /path/to/baseline /path/to/prototype /path/to/GoldenEye.z64 /path/to/results
```

Open `http://127.0.0.1:8386/` in Chrome. The local page runs five alternating pairs
and saves individual timings, state hashes, code and the first-pair screenshots.
Use an idle host, close other emulator tasks, and do not run profilers or tests
while timing. Stop the server after the page title reports completed run 10.
The server exposes the supplied ROM only on localhost; no ROM is included here.

## Correctness checks

- `bun test`: 2,462 pass, zero failures (80 added tests).
- `bun run lint`, `bun run build`, `git diff --check`: pass.
- All four new unchecked-memory source-guard tests fail on the unmodified baseline.
- Production interpreter/tracer/compiler/dispatcher comparisons cover both FR modes,
  raw bits, cached/uncached/TLB RAM, changed delay-slot targets, usability failures
  and Status writes, alignment/TLB faults, deferred PCs, completed instruction counts,
  MMIO interrupts and an RSP started by SWC1 before a following LWC1.
- With PR #382 (`48f0512`) applied in a separate checkout, 883 focused tests pass.
  Its AI-length and SP-DMA tests were also exercised with an initial MFC1 so their
  COP1 memory accesses use the unchecked path. #382 is not part of this PR; the
  existing MMIO event-time defect on main is outside this change.
