# Measurements

Baseline `19c9550`; Apple M4, macOS 26.5.2; Bun 1.3.14 and Playwright 1.58.2 / Chromium 145.0.7632.6, ANGLE Metal.

Five adjacent pairs per workload, alternating baseline-first and prototype-first. Each sample uses a fresh emulator/process or browser context. All accepted timings were collected after the competing Chrome workload was paused; the earlier contended samples were discarded. Values below are median ± median absolute deviation (MAD), not confidence intervals. Positive paired changes mean faster execution.

| Workload | Baseline VI/s ± MAD | Prototype VI/s ± MAD | Paired changes, in order | Median paired change |
| --- | ---: | ---: | --- | ---: |
| Super Mario 64, VI 121–720 | 153.71 ± 1.41 | 153.40 ± 0.15 | -2.03%, -1.46%, +1.28%, -2.88%, +0.74% | -1.46% |
| Super Mario 64, VI 1321–1920 | 90.68 ± 0.50 | 89.72 ± 1.46 | -0.67%, +0.55%, -2.54%, -0.79%, -5.24% | -0.79% |
| Diddy Kong Racing (v1.1), VI 121–720 | 239.35 ± 2.66 | 238.98 ± 0.07 | +2.08%, +0.14%, -1.52%, -1.28%, -0.05% | -0.05% |
| Diddy Kong Racing (v1.1), VI 1321–1920 | 141.94 ± 1.11 | 141.17 ± 1.59 | -0.42%, -0.46%, -2.43%, +0.53%, -2.08% | -0.46% |
| GoldenEye 007, VI 121–720 | 259.90 ± 2.30 | 255.15 ± 6.11 | -1.35%, -0.18%, -11.66%, -4.17%, -0.36% | -1.35% |
| GoldenEye 007, VI 1321–1920 | 161.88 ± 0.43 | 159.26 ± 0.09 | -3.02%, -1.39%, -1.44%, -4.68%, -1.90% | -1.90% |
| GoldenEye Dam loading, VI 1660–2399 (Chromium) | 43.59 ± 0.43 | 43.41 ± 0.22 | -0.88%, +2.91%, +1.40%, +1.16%, -0.79% | +1.16% |
| GoldenEye Dam stationary, VI 2595–3134 (Chromium) | 47.00 ± 0.43 | 47.19 ± 0.24 | +0.40%, +2.03%, +2.28%, +0.74%, -0.21% | +0.74% |

All 10 browser samples have identical recorded CPU/FPU/COP0/RAM/RSP/device/event state: **true**. First-pair canvas screenshots are byte-identical. The screenshots show the stationary Dam scene:

| Baseline | Prototype |
| --- | --- |
| ![Baseline Dam](browser/baseline.png) | ![Prototype Dam](browser/prototype.png) |

Raw per-run durations, rates, states and settings are retained in [headless.json](headless.json) and [browser/browser.json](browser/browser.json).
