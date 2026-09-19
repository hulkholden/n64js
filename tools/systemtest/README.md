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
