# PR system-test coverage

`.github/workflows/systemtest.yml` defines `ROM_REVISION` and builds that
nemu64-test commit from source on every PR. That value selects the checkout and
cache key, is verified by the build helper, and appears in the comparison report. It uses
upstream's pinned Rust nightly and nust64 0.4.1. Both the PR merge revision and
its base SHA run the exact same ROMs with the same harness and Bun version.
No ROM binary is committed here. Build caches avoid repeating dependency work.

The default upstream `base` selection is split into three ROMs:

| Group | Test modules |
|---|---|
| main | Everything except `tlb` and `tlb64` |
| tlb | `tlb`, including cross-page instruction execution |
| tlb64 | `tlb64`, including XKPHYS data loads |

Each includes StartupTest and TearDownTest. The build helper adds conditional
attributes to test registrations and temporary Cargo features in the separate
ROM source checkout. It does not change test bodies. Without a `ci-*` feature,
the original selection is preserved. Timing, cycle-accuracy and stress features
are not enabled in CI.

Each group/revision runs in a fresh Bun process, with a five-billion-cycle limit
and a 120-second wall-clock limit. An explicit ROM storm-abort message terminates
the emulator immediately. A storm never counts as a completed test run.

The Actions summary compares failures by test name and argument text, including
failure multiplicity. Existing failures are permitted; increased failures in
shared coverage fail the check. When a baseline storm is fixed, failures in
newly reached tests are reported separately, without calling them regressions.
An unchanged storm is permitted only when the stopping test and entire reached
test-heading sequence match. It is prominently reported as partial coverage.
New/changed storms, timeouts, empty runs, missing results, errors and lost
coverage fail the check. Full logs, JSON results and the ROMs are uploaded as an
artifact. There are no PR comments or write-token permissions.

Initial local validation: the main group completes 4,508 cases with 143 existing
failures. TLB stops at the 64-bit linear cross-page test; tlb64 stops at the
0x90 XKPHYS load test. Tests after these stops remain unverified. Splitting groups
can change state-dependent behaviour, so this supplements full-suite local runs.

## Local use

Set `ROM_REVISION` in your shell to the value in the workflow, then install
the Rust toolchain declared in the ROM checkout and the ROM packager:

```sh
git clone https://github.com/thelemmy/nemu64-test.git /tmp/nemu64-test
cd /tmp/nemu64-test
git checkout "$ROM_REVISION"
rustup show
cargo +stable install nust64 --version 0.4.1 --locked
```

From the n64js root:

```sh
bun tools/systemtest/build.js /tmp/nemu64-test /tmp/systemtest-roms \
  --revision "$(git -C /tmp/nemu64-test rev-parse HEAD)"
bun src/systemtest/run.js . /tmp/systemtest-roms/main.z64 /tmp/main.json
```

The runner exits 0 for a clean completed run, 1 for completed runs with failures,
and 2 for incomplete/error runs. To opt into upstream categories or build fewer
groups, use e.g. `--features base,timing --categories main,tlb`. The default CI
comparison expects all three groups; keep its group list and workflow loop in
sync if changing that policy.

To compare two checkouts, run the same `src/systemtest/run.js` for each group
against each checkout, naming outputs `base-main.json`, `pr-main.json`, etc.
Then run `bun src/systemtest/compare.js <results-directory> <rom-revision>`. Each target checkout
needs its dependencies installed. Use an external timeout for unattended runs;
the emulator cycle limit cannot interrupt a synchronous host-side deadlock.

For the unsplit suite, run `cargo run --release --locked` in the ROM checkout
(without `ci-*` features), then use `bun src/systemtest/run.js . <rom> <result.json>` from n64js.
That adapter recognizes the current summary and storm-abort messages.

`bun run headless <rom> [max-cycles]` is a generic bounded ROM run: reaching its
cycle budget normally exits successfully, without interpreting test results.
Other ROM protocols can use the exported `runHeadless` function and supply an
`onOutput(line)` callback that returns true to stop execution. The caller
interprets completion, failures and timeouts; the generic runner handles cycle
limits, emulator errors, and restoring console capture. Runs within a process
must be sequential.

When updating the ROM pin, change `ROM_REVISION` in the workflow. Verify the registration guards, parsed failure totals, all three
completion/stopping points and a same-revision comparison before enabling it.
