---
name: n64js-inventory
description: Run or resume an n64js ROM inventory, compare it with a saved baseline, verify regressions, and produce a compatibility report and prioritized issue list. Use for corpus sweeps and inventory comparisons, not ordinary single-ROM debugging or benchmarks.
---

# N64js inventory

Produce a reproducible corpus comparison and evidence-backed next actions. Use the repository's inventory commands; do not modify emulator behavior to obtain better results.

## Find the inputs

- Locate the user's ROM directories and retained inventory archives from task context or local configuration. Keep system-test ROMs separate from the commercial cohort unless requested.
- Inspect `baselines/` and `comparisons/`, their manifests and timing. Choose the latest appropriate **completed full** inventory unless the user names another. Partial diagnostics, pilots and the most recently modified directory are not necessarily a full baseline.
- Inspect seeds, budgets, input policy, runtime and canonical hashes. Do not hard-code the previous ROM count or permanently select a dated baseline.
- Resolve the requested source revision to a commit and report the snapshot boundary before launch. Use the latest merged revision when requested; keep unmerged work separate. A long scan stays pinned even if more fixes merge overnight.
- A request to run an inventory authorizes its local scan and report; invocation alone does not authorize publishing GitHub issues or adding a future notification automation. Preserve existing task authorization rather than asking twice.

## Run reliably

Read [references/execution.md](references/execution.md) when preparing, launching or recovering a run. Bundled helpers archive a clean checkout and Bun, run the batch sequentially, bound diagnostic logs, compare summaries and replay completion regressions with old-code controls.

- Match the baseline settings. Historical runs used seeds 1–3, 1,800 VI retraces, 5 billion cycles, 60 seconds, Bun 1.3.14, random-controller v1 and HLE. These are examples, not permanent defaults.
- Match by byte-order-normalized SHA-256 and seed, never filename. Preserve regional/revision variants; deduplicate byte-order aliases. Report added, removed and unidentified images separately.
- Run a short real-ROM preflight before thousands of workers. Missing modules, ROM paths or runtime are harness failures, not compatibility results.
- Retain structured reports, manifests, runtime/source provenance and replay evidence. Continuously drain diagnostic pipes but cap stored text: an earlier unbounded log reached 30 GB.
- Expect hours. Freeze discovered inputs, keep the host awake where appropriate, launch durably, and verify reports advance. Estimate remaining time from completed seeds/recent throughput.
- If automatic follow-up is requested, use a thread heartbeat that is quiet while healthy, reviews the finished report, and pauses after delivery. A saved `running` status alone is not proof of life; check manifests and processes.

## Compare and review

The helpers create `summary.json`, `baseline-summary.json`, `comparison.json`, `rechecks.json`, `report.md` and `hot-list.md`. Review machine-generated priorities before delivery.

- Verify every input has a terminal disposition and every expected hash/seed is accounted for. Check settings, source revision/hash, runtime, malformed reports and unmatched identities. Never present a partial scan as a full comparison.
- Report run completion, ROMs completing every/some/no seeds, and early-stop reasons. Keep completion gains, newly failing cases, changed failures and coverage changes distinct.
- Recheck formerly completed runs that now stop early on both retained checkouts with original settings. Replays validate the ROM hash; keep original reports immutable. Missing controls remain unverified.
- Separate repeated hard failures, timing-sensitive timeouts, non-reproducing cases, failed old-code controls and harness errors. Repeated timeouts alone do not establish performance or emulation regressions; graphics workload may have increased.
- Inspect VI counts and graphics/texture coverage as well as status. A timed-out game can advance from a few VIs to hundreds; a completed game can gain graphics activity without an outcome change.
- Group leads by stack, command path and microcode identity, not only exception wording. A shared stack is not proof of a shared root cause.
- Inspect later merges before prioritizing. Mark addressed failures for validation on newer code; don't fold later results into the scan or reopen fixed bugs.
- Completion means reaching a VI budget, not correct gameplay, pixels or sound. HLE/null-renderer observations produce no pixels. Empty textures may mean CPU framebuffer rendering, input waits, stalls or collector gaps. Missing historic collectors are unknown, not regressions.

Deliver concise before/after figures, notable improvements, classified regressions, a prioritized hot list and evidence links, backed by a machine-readable diff.

## Tracking issues, when requested

Read [references/issues.md](references/issues.md). Search open and closed issues and relevant merged PRs, file bounded findings, distinguish regressions from persistent gaps, apply existing `compatibility` and `performance` labels as appropriate, and verify the created issues. Skill invocation alone does not authorize publication.
