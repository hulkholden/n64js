# Active-RSP idle diagnostics

Separate instrumented replays; these wall times are excluded from throughput results. RSP instruction counts measure executed guest work, not host CPU time.

## mario, VIs 1321–1920

| Counter | Baseline | Prototype |
| --- | ---: | ---: |
| fragmentRuns | 28,325,782 | 12,224,164 |
| compiledOps | 267,022,099 | 267,022,099 |
| interpretedOps | 3,096,252 | 3,096,252 |
| rspInstructions | 100,525,264 | 100,525,264 |
| activeRSPIdleBatches | 0 | 81,204 |
| activeRSPIdleOps | 0 | 32,365,333 |
| fragmentCompilations | 276 | 276 |
| speedHackRSPActive | 16,188,643 | 16,188,643 |
| speedHackSkippedCycles | 667,213,728 | 667,213,728 |

Dispatch change: **-56.84%**. Total CPU instructions (compiled + interpreted): 270,118,351 → 270,118,351.

Cumulative generated source: 9,331,355 → 9,331,465 bytes. Instrumented tracing/codegen/Function time: 219.79 → 232.04 ms. These single compilation probes include diagnostic overhead and are not statistical timing estimates.

Saved final-state differences: none.

## diddy, VIs 121–720

| Counter | Baseline | Prototype |
| --- | ---: | ---: |
| fragmentRuns | 5,147,274 | 4,546,762 |
| compiledOps | 71,268,080 | 71,268,080 |
| interpretedOps | 14,392,600 | 14,392,600 |
| rspInstructions | 21,178,673 | 21,178,673 |
| activeRSPIdleBatches | 0 | 4,961 |
| activeRSPIdleOps | 0 | 1,210,926 |
| fragmentCompilations | 575 | 575 |
| speedHackRSPActive | 605,652 | 605,652 |
| speedHackSkippedCycles | 851,671,420 | 851,671,420 |

Dispatch change: **-11.67%**. Total CPU instructions (compiled + interpreted): 85,660,680 → 85,660,680.

Cumulative generated source: 4,610,310 → 4,610,420 bytes. Instrumented tracing/codegen/Function time: 116.85 → 124.85 ms. These single compilation probes include diagnostic overhead and are not statistical timing estimates.

Saved final-state differences: none.

## goldeneye, VIs 121–720

| Counter | Baseline | Prototype |
| --- | ---: | ---: |
| fragmentRuns | 17,488,213 | 3,390,126 |
| compiledOps | 70,610,524 | 70,610,524 |
| interpretedOps | 8,090,509 | 8,090,509 |
| rspInstructions | 36,722,539 | 36,722,539 |
| activeRSPIdleBatches | 0 | 95,998 |
| activeRSPIdleOps | 0 | 28,387,935 |
| fragmentCompilations | 478 | 478 |
| speedHackRSPActive | 14,197,808 | 14,197,808 |
| speedHackSkippedCycles | 858,630,967 | 858,630,967 |

Dispatch change: **-80.61%**. Total CPU instructions (compiled + interpreted): 78,701,033 → 78,701,033.

Cumulative generated source: 3,597,251 → 3,597,361 bytes. Instrumented tracing/codegen/Function time: 91.66 → 86.77 ms. These single compilation probes include diagnostic overhead and are not statistical timing estimates.

Saved final-state differences: none.

## Rendered GoldenEye gameplay, VIs 2595–3134

| Counter | Baseline | Prototype |
| --- | ---: | ---: |
| fragmentRuns | 35,696,567 | 35,398,495 |
| completedCompiledOps | 436,771,356 | 436,771,356 |
| steps | 443,521,909 | 443,521,909 |
| haltedSteps | 409,973,037 | 409,973,037 |
| rspInstructions | 33,548,872 | 33,548,872 |
| idleBatches | 0 | 2,415 |
| idleOps | 0 | 600,974 |
| guards | 0 | 2,415 |
| hits | 0 | 2,415 |
| compilations | 797 | 797 |
| sourceBytes | 4,111,964 | 4,111,964 |
| constructionMs | 39.2 | 37.6 |

Dispatch change: **-0.84%**. Generated-source change: **0.00%**.

Batch coverage: **0.138%** of compiled CPU instructions. Across the full 3134-VI replay, generated source grows 72,577,863 → 72,577,973 bytes: just 110 added bytes, compiled before the gameplay window. Full-replay Function construction is 241.0 → 238.8 ms (single diagnostic probe).

Function construction excludes source generation and later host-JIT optimization. Source bytes are cumulative new JavaScript bodies, not resident host machine code. Generated hot bodies are retained in the raw diagnostic JSON.

The focused DMA test separately demonstrates the legacy two-step-before-NOP-charge discrepancy. Both compiled paths retain the same result at that boundary; the interpreter differs. The discrepancy remains outside this dispatch-only prototype and is not counted as an interpreter-equal case.
