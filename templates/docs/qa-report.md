# QA Report: {feature-or-bd-id}

- **Date**: {YYYY-MM-DD}
- **QA**: qa (or named human)
- **Scope**: {feature / PR / bd-id / acceptance-criteria source}
- **Verdict**: PASS | FAIL | BLOCKED
- **Status**: draft | final

<!--
Coverage is a hypothesis about quality, not proof of it. Every PASS / FAIL verdict cites the
test name + run log line. Every coverage claim cites the report file. If a report isn't
available, the verdict is `unknown` — not an estimate.
-->

## Acceptance criteria

| Criterion | Verdict | Test name | Log line / artifact |
|---|---|---|---|
| {restated from the source — PRD, bd issue, design doc} | PASS / FAIL / unknown | `tests/path/to/test.mjs > "name"` | `{path or trace id}` |

## Coverage

| Layer | % | Source |
|---|---|---|
| Unit | {NN}% | `{coverage report path}` |
| Integration | {NN}% | `{report or "not run"}` |
| E2E | {NN}% | `{report or "not run"}` |

## Test pyramid assessment
<!-- Target ratio is unit:integration:E2E ≈ 70:20:10. Note the actual mix and the gap. Tests that exist but don't exercise the acceptance criterion are coverage without behavior — name them. -->

## Findings

| Test | Result | Log line / repro | Edge case it exercises |
|---|---|---|---|
| `{test name}` | PASS / FAIL / flaky | `{log line or repro steps}` | {what could break in production} |

## Coverage gaps
<!-- Acceptance criteria that lack a corresponding assertion, or assertions that don't exercise the acceptance criterion. Each gap names the missing test and what it should assert. -->

## Determinism
<!-- Tests that re-run with different results. Cite the run history (pass rate over N runs). A single failure is not flake; a single pass is not stable. -->

## Handoff

- test failures to fix → `next:engineer`
- root cause investigation → `next:debugger`
- flaky tests to stabilize → `next:qa`
