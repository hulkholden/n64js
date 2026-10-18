# Recipe: parallel inventory, ignoring performance issues

Use this profile to compare compatibility and graphics HLE warnings across the full ROM collection with several emulators running concurrently. It does not measure emulator performance. Reaching the VI limit still does not establish correct gameplay, pixels or sound.

## Reusable request

> Use $n64js-inventory to run a complete inventory in parallel mode, ignoring performance issues. Fetch origin/main and sync main before pinning the scan. Use four emulator workers, 1,800 VIs, a 5-billion-cycle limit and a 180-second timeout per run, with seeds 1–3 and fresh saves. Compare against the latest completed full inventory. Report compatibility changes and graphics HLE warnings per ROM, including warning deltas. Recheck suspected regressions sequentially on both pinned versions with the same current settings. Keep performance comparisons out of the report.

Four workers and 180 seconds are the starting profile demonstrated by the October 2026 scan, not universal defaults. Honor explicit user overrides and validate the selected concurrency on the current host. Keep the scan's settings fixed once launched. This request does not itself authorize filing issues or scheduling notifications.

## Freeze the source, inputs and comparison profile

1. Fetch `origin/main` explicitly and verify the fetched commit against the remote `refs/heads/main` (or GitHub's `branches/main`). Do not infer main from a possibly stale `origin/HEAD` or `origin/master`. Fast-forward a clean local main when requested; preserve unrelated work or a diverged branch. Pin a separate clean scan checkout to the verified commit and record the timestamp and full SHA. Keep it and the baseline checkout unchanged through all rechecks.
2. Select the latest appropriate **completed full** baseline. Freeze the current ROM paths and size/mtime metadata, canonical byte-order-normalized hashes and seeds. Keep aliases of one canonical ROM together when sharding so native per-scan deduplication works; preserve each path's disposition. Keep regional/revision variants distinct. Record additions, removals and unidentified inputs. Derive expected counts from this cohort rather than hard-coding 858 ROMs.
3. Retain the runtime binary/version/hash, source hash, exact commands, dependency lockfile and observation-only patches. Use locked dependency installation and a real-ROM preflight. If a warning collector patch is needed, record its base and resulting commit and verify that it only observes behavior. Missing historical collector coverage is unknown.
4. Record an explicit comparison profile in the archive. Keep VI/cycle budgets, seeds, input policy/RNG, HLE graphics/audio, null renderer and fresh-save behavior matched. Check effective defaults as well as serialized settings; audio mode has historically been absent from the settings schema. Declare any other difference instead of silently accepting it.

For the usual profile, save `parallelWorkers: 4`, `timeoutMs: 180000`, the baseline timeout/worker count, and `performanceComparison: false`. A sequential 60-second baseline is valid for this compatibility comparison only with the timeout difference disclosed. Elapsed scan time and recent completion rate may support an operational ETA, never a speed, latency, throughput or performance-regression comparison between emulator revisions.

## Coordinate native batches

The repository's native `inventory-batch` CLI runs sequentially. Parallelism comes from a coordinator running a bounded number of **disjoint native queues**, each with one isolated emulator at a time. Four shards across three seeds produce twelve manifests, with at most four active emulators, not twelve.

The bundled `prepare.py`, `runner.py` and `analyze.py` are **not parallel adapters**: preparation/coverage checks assume one manifest per seed, the runner launches one batch, comparison rejects changed settings, and old-code controls replay the baseline report's settings. Do not invent a `--parallel` flag or bypass those checks. Reuse an inspected parallel coordinator from a retained successful archive when available, copying it into the new archive; otherwise implement the coordination below around the native CLI and verify it on a miniature cohort before a full scan.

- Save a stable shard plan and exact frozen file arguments before launch. Each path belongs to one shard; each shard gets every requested seed. Pass file arguments rather than rediscovering ROM directories after launch. Do not shard by launching several complete corpus scans.
- One durable supervisor holds an archive-specific exclusive advisory lock to prevent duplicate launches and the system-wide exclusive advisory `/tmp/perf.lock` throughout preflight, all concurrent queues and sequential rechecks. Open the latter without truncating; wait for its owner, acquire `fcntl.flock(..., LOCK_EX)`, then write session/PID/start metadata. A queued lock wait is normal. The supervisor permits its own workers to overlap while excluding other cooperating timing-sensitive jobs.
- Use argument arrays with `subprocess.Popen`, a detached supervisor session, saved PIDs/commands, and child process groups that can be stopped and waited for. Drain every worker's diagnostic pipe continuously while retaining bounded head/tail logs; never truncate structured reports. On cancellation or harness failure, stop and reap every batch and emulator before clearing lock metadata while still locked, unlocking and closing. Never remove or replace `/tmp/perf.lock`.
- Give queues distinct scan directories under the archive's `runs/`. Native batches create a manifest per seed and print all their scan directories before emulation starts. Save that mapping to the shard plan. A coordinator that prepares manifests itself must use and validate the current native schema; never modify manifests underneath live workers.

The native command for **one shard**, launched by that supervisor with the retained Bun and pinned checkout, is equivalent to:

```text
bun run inventory-batch ROM_FROM_THIS_SHARD ... --output-dir ARCHIVE \
  --seed 1 --seed 2 --seed 3 \
  --frames 1800 --max-cycles 5000000000 --timeout-ms 180000
```

This is a command template, not a standalone parallel launcher. Each queue receives only its saved shard's file list. Native batch exit 1 means it finished with ROM failures; command/storage errors and missing reports are harness failures. Keep the archive/runtime outside the source checkout so report writes do not dirty the pinned code.

Before the full scan, exercise all selected workers with a small set of real ROMs at the intended VI budget. Verify overlapping emulator workers, valid terminal reports, source/runtime/settings, bounded logging, cancellation cleanup and resume preserving existing raw reports. Reuse an already validated coordinator without repeating unrelated tests; revalidate behavior affected by changes. Do not launch the full corpus while another supervisor or pilot is still active.

## Monitor, resume and audit

Count terminal entries across **all shard manifests**, grouping by seed; do not assume one manifest per seed. Check actual process liveness and advancing reports in addition to saved state. Save lock-wait, preflight, scan, recheck and completion states. Estimate remaining time from completed work and pending shards, including sequential recheck time.

On interruption, confirm no supervisor, coordinator, batch or worker remains, then resume through the same lock-owning supervisor. Each queue resumes its existing scan directories using repeated `--resume` arguments, with no new input/settings arguments. Never start a new full batch over existing results. If a launch failed before its scan-directory mapping was saved, reconcile saved manifests against the shard plan before retrying. Back up reviewed derived documents before regenerating them; preserve raw reports.

Before claiming completion, audit:

- Every frozen path has a terminal disposition for every seed; shard membership is complete and disjoint. Aliases may share a report within a scan, but there is exactly one canonical hash/seed result across shards.
- Every planned report is present, well formed and consistent with its manifest; investigate missing, unidentified, duplicate and unmatched results. Check the baseline too, and report cohort additions/removals explicitly.
- Input metadata, clean pinned source/revision/hash and retained runtime/hash are unchanged. Actual report settings agree within each snapshot except for the planned seed values. Across snapshots, permit only the declared profile differences; do not globally disable settings validation.

## Compare compatibility and warnings

Join results by canonical hash and seed. Produce machine-readable and Markdown comparisons with completion counts, ROMs completing all/some/no seeds, early-stop reasons and graphics task/draw/texture coverage. Keep these categories separate:

| Observation | Interpretation / next step |
| --- | --- |
| Previous hard halt/error becomes complete | Hard-failure recovery; record the old failure evidence. |
| Previous timeout becomes complete | Budget-sensitive recovery when timeout/concurrency changed; not proof of an emulator fix or speedup. |
| Formerly complete run now stops early | Candidate regression; replay sequentially on both versions as below. |
| Both complete but graphics activity disappears | Coverage candidate; inspect tasks, draws and textures and run a matched control. Completion alone can miss this. |
| Repeated timeouts | Retain the outcome and progress evidence, but do not file or rank it as a performance regression from this scan. |

For a candidate, replay the **current report** on both retained versions, one emulator at a time, under `/tmp/perf.lock`. This gives both sides the same current timeout, VI/cycle limits and input policy; replay validates the ROM hash. Save both original reports and new replay provenance. Do not replay the old report on the baseline if its timeout differs. If the old version cannot accept the current settings, document an unverified control rather than silently substituting settings.

Classify reproduced hard failures, repeated timing-sensitive timeouts, non-reproducing cases, failed baseline controls and unverified cases separately. For graphics losses, record matched task/draw/texture evidence without claiming an unobserved black screen. CPU framebuffer rendering or input waits can explain empty HLE collectors. Zero completion candidates means no completion rechecks were required; it does not imply graphics coverage was unchanged or that rechecks ran.

For the per-ROM warning report, compare exact microcode-family/type groups by canonical hash/seed. The observation collector counts `GBIMicrocode.warn` calls before console suppression, records first context, and caps distinct groups at 512 per run with explicit dropped-occurrence totals. Verify the actual collector version and reconcile totals/coverage on both snapshots. Report checkpoint-only lower bounds, drops, missing collectors, changed execution windows and warning renames. Longer timeouts, different paths and parallel load can change observed counts; newly observed or absent warnings alone do not prove introduced or fixed bugs. WebGL-specific warnings and ordinary console diagnostics are outside this collector.

Deliver the compatibility summary, reviewed hot list and per-ROM warning totals/deltas with evidence links. State the concurrency/timeout difference and performance exclusion near the summary. Check existing issue states and later merges when prioritizing, keeping later-code findings separate from the pinned scan. Do not create or update issues unless the user requested it. If an existing authorized heartbeat follows the run, keep it quiet while healthy and pause it after delivering the reviewed results.
