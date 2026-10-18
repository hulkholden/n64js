# Indiana Jones RSP execution

The `dd57a04e` graphics microcode now runs on the RSP even when graphics mode
is HLE. The dispatcher hands it off before executing any commands or scheduling
HLE completion. Its raw RDP output uses the existing WebGL renderer. The next
ordinary graphics task can still use HLE.

An in-list HLE microcode load cannot safely restart an already partially
executed task, so loading this identity from HLE raises
`UnsupportedMicrocodeError`. Rogue Squadron and Battle for Naboo retain their
separate identities and dispatch policies.

## Task and synchronization contract

These observations come from the USA ROM below, including its locally captured
RSP instructions and register activity. No ROM or microcode bytes are included.
Addresses refer to the initial code image mapped at IMEM `0x1000`; overlays can
replace instructions at those addresses.

- Startup at `0x1d60` clears SIG1 (yielded) and SIG2 (task done). It reads the
  task's command pointer at `OSTask + 0x30`, output-buffer start/end at
  `+0x28/+0x2c`, and yield buffer at `+0x38`. In the first observed task these
  were `0x6b1108`, `0x6f1000/0x6f7ff0`, and `0xae010`, respectively.
- The list reader at `0x106c..0x1094` DMA-loads `0x108` bytes into DMEM
  `0x270`. The first word supplies the next block pointer; commands start at
  `0x278` and run to `0x378`. The saved next pointer is at `0x5a0` and the
  current block address at `0x5a4`. This is an eight-byte header followed by
  `0x100` bytes of commands, not a flat GBI0 list.
- The dispatcher uses tables in DMEM and loads code overlays from offsets
  relative to `OSTask.ucode`. The loader at `0x1174` derives the DMA length,
  destination, and source offset from packed halfwords. Running the instructions
  retains the game's vector arithmetic, overlay changes, and nested lists.
- The command loop checks SP SIG0 (yield request) at `0x1020`. The resume path
  at `0x1e30` restores a full DMEM image from the yield buffer and recovers the
  saved command cursor. The CPU and RSP continue to share the actual SP status
  and DMA devices. A trace observed the microcode clearing SIG1/SIG2 and setting
  SIG2 before BREAK; the dispatcher does neither on its behalf.
- Output accumulates in DMEM starting at `0xe80`. The routine at
  `0x10dc..0x115c` checks DPC start-valid/current before reusing output space,
  DMA-writes the packet range to RDRAM, waits for DMA completion, then publishes
  `DPC_END`. DP interrupts come from FullSync in that packet stream. An SP task
  start or yield/resume is not itself a DP completion.

The LLE path advances with the CPU's existing execution budget, one RSP
instruction at a time. A linked-list or signal wait cannot enter an unbounded
synchronous HLE parser. Headless callers that skip drawing still execute the
RSP's memory and interrupt effects. This uses the existing approximate RSP/DP
timing and experimental RDP renderer; it does not establish cycle accuracy.

## Fixtures

`src/headless/headless_env.test.js` uses synthetic identification bytes and a
small original RSP program, not captured game code. Its two linked blocks
exercise input DMA, output DMA, SetFillColor, PipeSync, and FullSync. The CPU
initially leaves a self-link in place; a bounded CPU run returns with the RSP
active and no completion interrupt. Guest CPU stores then publish the final
block, which changes RAM/render state and signals DP and SP completion once.
Both drawing and headless skipping modes are covered, followed by an ordinary
HLE task. An in-list load test guards against accidentally parsing this protocol
as GBI0.

## Rendered validation

- Base: `49f058d5c2c84a1a673274aa142a00aaac3658c5`.
- ROM: **Indiana Jones and the Infernal Machine (USA).z64**, header identity
  `15cc9daf883d721a`, normalized SHA-256
  `6e127e592f098a28c92d2032d71c56af1412e5dd189fe792d9238b12a0928c59`.
- Environment: macOS arm64, Bun 1.3.14, Playwright 1.58.2 Chromium
  `145.0.7632.6`, WebGL2 with ANGLE Metal. Graphics HLE, audio HLE (this game's
  unrecognized audio microcode falls back to LLE), internal/canvas scale 1,
  CRT off, compatibility defaults, fresh save state, controller 1 connected.
- Paired runs: neutral input from boot through VI 1,800. CPU execution was
  driven to fixed VI checkpoints; captures used the actual browser renderer.
  Both runs reached 2,836,486,536 CPU operations. The same `/tmp/perf.lock` was
  held for each run, sequentially. These are compatibility checks, not speed
  measurements.

| Observation through VI 1,800 | Before | After |
| --- | ---: | ---: |
| Recognized graphics task starts | 1,005 | 1,962 |
| DP interrupts | 1,005 (fabricated by skip) | 1,005 (RDP FullSync) |
| Draw-time texture formats | none | I4, I8, CI4, CI8, RGBA16, RGBA32 |
| Fatal halts / browser exceptions | 0 / 0 | 0 / 0 |

At VI 400 the baseline displays sparse framebuffer garbage; the new path
renders the copyright screen, text, and Expansion Pak model. At VI 1,500 the
new path renders the animated LucasArts logo, followed by the Factor 5 sequence
at VI 1,800. These visible scenes, rather than the VI count or task-completion
count alone, validate graphics progress. Screenshots in the pull request use
matching checkpoints and settings.

A further fresh browser run reached the title menu at VI 3,000 with neutral
input. Start was held over VI intervals `[3600, 3605)` and `[3900, 3905)`, then A
over `[4200, 4205)`; all other input remained neutral. The name-entry screen
rendered at VI 4,000 and showed the entered `A` at VI 4,300. That run ended at
6,742,486,536 CPU operations, with 6,026 graphics starts, 3,090 FullSync
interrupts, and no fatal halt or browser exception. It used the same rendering
settings and exclusive lock as the paired captures.

The experimental raw RDP renderer and RSP interpretation cost remain relevant.
This validation establishes intro and interactive menu rendering, not complete
game accuracy or full-speed gameplay.
