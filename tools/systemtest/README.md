# PR system-test coverage

The [system-test workflow](../../.github/workflows/systemtest.yml) builds
nemu64-test from source and compares the PR against its base using the same ROMs
and harness. Refer to the workflow for the source revision, test selection,
toolchain, limits and commands.

Tests are split into groups so a hang in one area does not block coverage
elsewhere. This provides baseline regression coverage and supplements full-suite
testing; an unchanged failure or exception storm does not imply correctness.

The comparison distinguishes regressions within existing coverage from failures
in newly reached tests. Known storms remain visible as partial coverage.
See the [comparison code](../../src/systemtest/compare.js) for the exact policy
and the Actions summary and artifacts for results from each run.

## Debug a CI failure

Start with the Actions summary to identify the affected group (`main`, `tlb` or
`tlb64`) and whether the failure is a regression, lost coverage or an incomplete
run. Download the `n64-systemtest` artifact and compare `base-<group>.json` with
`pr-<group>.json`; the matching `.log` files contain the emulator's test output.

To reproduce locally, follow the workflow's toolchain setup and ROM build
commands using the recorded `ROM_REVISION`. Install dependencies in both the
base and PR checkouts with `bun ci`. Run the PR's
[`src/systemtest/run.js`](../../src/systemtest/run.js) harness against each
checkout in a separate process, using the same ROMs and limits, then run
[`src/systemtest/compare.js`](../../src/systemtest/compare.js) on the results.
The workflow contains the full commands and expected result filenames.

A worker's nonzero exit code can represent existing test failures or a known
exception storm. Use the comparison result to determine whether the PR regressed;
a missing result or an unexpected incomplete run still fails the check.
