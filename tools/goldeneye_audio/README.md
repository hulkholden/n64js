# GoldenEye streaming audio validation

This harness uses a privately supplied `GoldenEye 007 (USA).z64`; it never
bundles ROM code or sample data. The reference SHA-256 is
`2cdcec8a9f0cb6e36337f3ee39d8ad105dc8afa6ba1c02d466e8f5b771f9a162`.

Build both checkouts with `bun install --frozen-lockfile && bun run build`.
Run from the prototype checkout, with Playwright 1.58.2 and its Chromium installed:

```sh
# Every accelerated block, against the original RSP instructions, including
# scalar/vector registers, accumulator, flags, PC/delay state and all SP memory.
bun tools/goldeneye_audio/verify.mjs /path/to/GoldenEye.z64 /tmp/blocks.json

# Separate instrumented rendered run: compare DMA read/write fingerprints,
# completion ordering, PCM and final machine state; do not use these timings.
node tools/goldeneye_audio/browser.mjs /path/to/baseline /path/to/prototype \
  /path/to/GoldenEye.z64 /tmp/audio-diagnostic 1 diagnostic

# At least five sequential pairs, alternating order, without instrumentation.
node tools/goldeneye_audio/browser.mjs /path/to/baseline /path/to/prototype \
  /path/to/GoldenEye.z64 /tmp/audio-timing 5
```

The browser harness starts a local server, creates a fresh Chromium context for
every run, disables RAF-driven emulation, seeds CPU random replacement with
`0x12345678` (LCG multipliers 1664525 and 1013904223), and follows the controller
sequence in issue #165. Fresh defaults are HLE graphics/audio, render scale 1,
and CRT off. Loading spans VI 1659–2399; stationary Dam gameplay spans
VI 2594–3134. Screenshots confirm the final scene. Audio stays enabled throughout.
Keep timing runs separate from other CPU-heavy work. Diagnostic JSON includes
private memory fingerprints, not the underlying ROM or sample bytes.

## Execution contract

PI activity still prevents synchronous whole-task HLE. For the exact reviewed
GoldenEye program only, streaming tasks can accelerate resampler and envelope
DSP loops while the real RSP program owns all command fetches, sample/state
DMAs, waits, semaphore writes, status changes and completion interrupts. This
is hybrid command execution; it does not label the entire task as completed HLE.

Each bounded loop iteration consumes exactly its original number of RSP steps
(37–64). It accesses only SP-local memory. Its results become visible on the
last step. A CPU/debugger SP-memory or PC access, SP DMA, RDP XBUS read, halt or single-step
request first executes the elapsed prefix in LLE, making the exact intermediate
state visible before that access. Reset discards uncommitted work. No RDRAM
write is rolled back or replayed. Unsupported counts, active SP DMA, other
microcodes, and changed executable bytes use LLE at their current instruction.
Unknown command domains run the original command handler; no eager preflight
reads future command batches or samples. Quiet tasks retain the existing
whole-task transaction and rollback contract.

The task-start classifier still validates the full reviewed identity. The
stream executor owns a copy of that code and checks the actual loaded IMEM
after each IMEM DMA. CPU/debugger writes to SP memory revoke acceleration.
Fused four-tap filtering preserves intermediate saturation; fused envelope
mixing retains the complete 48-bit accumulator, including 32-bit carries.

No new CPU event is scheduled. This preserves the existing RSP-step/event
relationship even in compiled fragments and does not depend on resolving
issue #174. Hardware timing remains the emulator's existing approximation:
one RSP instruction opportunity per CPU step, and eagerly copied PI/SP DMA
bytes followed by estimated completion events. The change does not improve
that hardware model or claim hardware-cycle accuracy; its contract is exact
agreement with LLE in this model, including the opportunity to submit later PI
transfers across idle gaps.

`rspInstructions` counts instructions actually interpreted. `rspAudioHLEBlocks`
counts completed local DSP iterations; `rspAudioHLECycles` counts their original
RSP steps, including interpreted scaffolding. The latter is not additional time
and must not be added to the other instruction counter.

Use `node tools/goldeneye_audio/report.mjs /tmp/audio-timing/browser.json` to
compare final state and report individual ms/VI values, median, range and median
absolute deviation. The same command on the diagnostic JSON checks each ordered
trace event and reports the first discrepancy, if any.

For a second streaming title, run the smoke harness in separate processes, for
example with Blast Corps (USA) (Rev 1):

```sh
bun tools/goldeneye_audio/smoke.mjs /path/to/baseline /path/to/BlastCorps.z64 600 /tmp/blast-baseline.json
bun tools/goldeneye_audio/smoke.mjs /path/to/prototype /path/to/BlastCorps.z64 600 /tmp/blast-prototype.json
diff /tmp/blast-baseline.json /tmp/blast-prototype.json
```

Recorded results and variation are in [RESULTS.md](RESULTS.md).
