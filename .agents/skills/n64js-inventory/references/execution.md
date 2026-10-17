# Execution and recovery

Helpers use Python 3 on macOS/Linux (the runner uses `fcntl` advisory locks) and the repository's Bun inventory CLIs. Check runtime and paths on another machine.

## Prepare

Use absolute paths and a new archive directory. Confirm the intended completed full baseline and desired merged revision.

```sh
python3 .agents/skills/n64js-inventory/scripts/prepare.py \
  --repo /path/to/n64js --revision RESOLVED_COMMIT \
  --baseline /path/to/inventory/comparisons/PRIOR_RUN \
  --rom-root /path/to/roms \
  --output /path/to/inventory/comparisons/NEW_TIMESTAMP
```

Preparation derives seeds/settings from manifests, snapshots Bun, creates a detached worktree, installs locked dependencies, and copies runner/analyzer/config into the archive. Default Bun is the retained baseline runtime; use `--bun` deliberately. Mismatched runtimes or unsupported settings fail. Failed preparation leaves its directory for inspection; correct the cause and choose a new output directory.

For a first baseline or intentionally changed settings, use the native CLI with documented settings; these helpers target matched comparisons.

Before launch, use the saved runtime/checkout for a short run of one verified existing ROM, with its report outside `runs/`. Confirm success, provenance and working IPC. Focused inventory tests are useful when the runner/runtime changed.

## Launch and monitor

Launch `python3 ARCHIVE/runner.py ARCHIVE` using `subprocess.Popen` with an argument list, `start_new_session=True`, `stdin=DEVNULL`, `close_fds=True`, and stdout/stderr to `runner.log`. Save PID/exact command in `launch.json`. Avoid shell interpolation of filenames.

The runner holds an OS lock (`runner.lock`), uses `caffeinate` where available, and executes one worker at a time. Batch exit 1 means a finished scan containing ROM failures. Command/storage failures remain failures. It retains first/last 1 MiB of process stderr while draining all output; structured reports are never truncated. Each attempt preserves its logs and timing.

Use manifests and timing for progress; count all terminal outcomes. A quiet or capped text log does not indicate a stall. Include paired-replay time in estimates. A user-authorized heartbeat should name the archive, expected cohort/settings, no-duplicate-launch rule, silent healthy-state behavior, final review/delivery and pause-on-completion.

## Recovery

Inspect timing, manifest modification times, PIDs/commands and logs. Never start a second active runner. After interruption:

```text
python3 ARCHIVE/runner.py ARCHIVE --resume
```

Native resume verifies revision, source hash, runtime and settings. Remove a stale native scan `.lock` only after confirming no process uses it. The persistent `runner.lock` file is harmless: its advisory lock releases on exit.

After a finished batch, regenerate derived data and missing rechecks with:

```text
python3 ARCHIVE/runner.py ARCHIVE --analyze-only
```

This overwrites derived reports, so preserve human-reviewed versions separately first. Raw reports remain unchanged. For analysis without emulation, with config and both summaries already present:

```text
python3 ARCHIVE/analyze.py ARCHIVE
```

The generic hot list requires human review for repeated timeouts, changed failure stages, later merges and existing trackers. Keep ROM bytes and saves local.
