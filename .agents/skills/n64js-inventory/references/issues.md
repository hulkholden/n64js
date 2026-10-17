# Issue publication

Publish only when the task authorizes filing issues. Search both open and closed issues by title, ROM and exception/microcode signatures. Read closure comments and relevant merged PRs: resolved recognition/reporting may leave implementation unsupported; later merges may already fix the snapshot's failure.

Separate distinct regressions or implementation gaps. A shared-path cohort is useful for investigation, but do not assert a common cause without evidence. Cross-link overlapping cases. An unchanged timeout or empty collector alone is not a newly proven bug; use a bounded investigation only when there is actionable evidence.

Each issue should contain the concrete symptom and expected behavior; whether new, persistent, newly exposed or unsupported; full tested/control revisions; Bun, graphics/input policy and budgets; ROM names and normalized SHA-256; per-seed scan/replay/control observations; relevant stack or command context; a portable reproducer; a bounded next step; and related issues/PRs. State when current main has not been replayed.

For public bodies, inline compact reproducible evidence, omit ROM data and unrelated host/account details, and strip home directories from stacks. Use repo-relative paths or verified commit permalinks. Local archive paths are optional maintainer notes, not public evidence links.

Use existing labels: `compatibility` for ROM-specific findings, `performance` for timing/profile work, and `bug` for demonstrated defects where consistent with repository practice. Do not invent labels or assign people/milestones unnecessarily.

Publish with a structured connector or `gh issue create --body-file`. On an ambiguous result, search for the title before retrying to avoid duplicates. Verify title/body/labels afterward; save URLs and skipped-case dispositions alongside the report.
