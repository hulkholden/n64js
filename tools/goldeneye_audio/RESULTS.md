# GoldenEye streaming audio results — 2026-10-10

Baseline: `19c9550` (main). Apple M4, macOS arm64 (Darwin 25.5.0),
Bun 1.3.14, Node 24.13.1, Playwright 1.58.2, Chromium 145.0.7632.6,
ANGLE Metal. ROM SHA-256 and exact controller/VI protocol are in [README.md](README.md).
Both builds used HLE graphics and audio, render scale 1 and CRT off.
WebAudio was running in every timing run. Each run used a fresh browser context;
RAF was disabled, emulation advanced synchronously, and CPU RNG was seeded.
Timing runs were sequential and isolated from other CPU-heavy validation work.

## Uninstrumented timing

Loading: VI 1659–2399 (740 VIs). Stationary rendered Dam gameplay:
VI 2594–3134 (540 VIs). Units below are **milliseconds per VI**, not game FPS.

| Pair | Order | Loading baseline | Loading prototype | Gameplay baseline | Gameplay prototype |
| --- | --- | ---: | ---: | ---: | ---: |
| 1 | B → P | 27.215 | 26.341 | 25.489 | 23.631 |
| 2 | P → B | 28.303 | 25.812 | 26.872 | 24.866 |
| 3 | B → P | 26.843 | 27.379 | 25.370 | 25.536 |
| 4 | P → B | 27.632 | 27.277 | 26.531 | 25.696 |
| 5 | B → P | 28.326 | 28.158 | 27.667 | 25.780 |

| Statistic | Loading baseline | Loading prototype | Gameplay baseline | Gameplay prototype |
| --- | ---: | ---: | ---: | ---: |
| Median | 27.632 | 27.277 | 26.531 | 25.536 |
| Minimum | 26.843 | 25.812 | 25.370 | 23.631 |
| Maximum | 28.326 | 28.158 | 27.667 | 25.780 |
| Median absolute deviation | 0.671 | 0.881 | 1.042 | 0.244 |

The median gameplay cost fell **3.8%**, from 26.531 to 25.536 ms/VI.
Individual paired gameplay changes ranged from 0.7% slower to 7.5% faster.
The loading median fell **1.3%**; that small change is within the observed
run-to-run variation. These results do not establish a loading speedup.

All five pairs ended with identical CPU/FPU/RSP state, full RAM and SP memory,
device registers and event deadlines. The final rendered Dam scene was also
identical. The measured prototype build SHA-256 was
`793749ffeab3f01558349d4f38633e5144235b3ed39d9c589672d6ba9c186707`.
The subsequent final change adds an RDP XBUS visibility hook; it does not alter
the timed audio code. The final diagnostic observed **zero XBUS reads**, and again matched every
event and PCM byte fingerprint. Its build SHA-256 was
`ad06b290a0519ed7730fcb26e7eadf534133a77273f6b8d46b0c0cdd761390ee`.

## Correctness and RSP work

The independent block differential ran the real RSP instructions from each
block's exact entry state, then compared the accelerated result. It checked
**990,284 resampler blocks and 860,205 envelope blocks** through VI 3134,
across 1,552 audio tasks, with **zero differences** in all SP bytes, scalar and
vector registers, accumulator, flags, and PC/delay state.

A separate rendered diagnostic matched **720,538 ordered events**, including
command/sample/state DMA reads, output writes, task completion/status changes,
and AI PCM buffers. The aggregate 4,558,720 PCM bytes had the same SHA-256:
`9936b64b9958d11e8cde42f29e997eb89411876a7f5ca779b2fdd15113ab52de`.
This verifies unchanged synthesized audio; no subjective listening claim is made.

In the stationary 540-VI window:

| Measure | Baseline | Prototype |
| --- | ---: | ---: |
| Audio tasks | 270 | 270 |
| Tasks using streamed DSP HLE | 0 | 270 |
| Completed accelerated DSP blocks | 0 | 232,314 |
| Interpreted RSP instructions | 33,548,872 | 30,386,698 |

That is **9.4% fewer interpreted RSP instructions**. All loader/DMA and completion
instructions remain on the real RSP path. The task share describes hybrid HLE
participation, not whole-task synchronous HLE completion.

Blast Corps (USA) (Rev 1), a different streaming-audio title using
`abi1-diddy-blast-mixer`, matched through 600 VIs and 297 audio tasks. CPU/FPU/RSP,
RAM/SP memory, device/event state and aggregate PCM agreed. PCM SHA-256:
`1fa86d7a5748683ad9e72827a177f96522d4a29ee9f7ae606379df09629217d6`.

Synthetic regressions cover active PI DMA, an idle gap followed by another
transfer, a quiet interval, every interruption point in a deferred block,
CPU/debugger memory/PC access, SP DMA reads and IMEM replacement, RDP XBUS reads,
halt, single-step, reset, unsupported counts/commands, all envelope branch paths,
accumulator overflow and profiling enabled/disabled.

The existing LLE DMA visibility and instruction timing approximations remain;
see the execution contract in [README.md](README.md). No new CPU event deadlines
were introduced, so this work does not change the MMIO timing issue in #174.

Final checks: `bun test` (**2,198 passed**), `bun run lint`, and `bun run build` all pass.
