---
title: Test-impact gating
description: "Shadow-to-gating promotion criteria for graph-derived CI test selection. Defines when impacted-only test runs become a required check."
---

Construct collects graph-derived test-impact data on every PR before it gates CI on that data. The shadow job runs the full suite, records which failures (if any) fell outside the graph's impacted set, and never fails the build. Promotion to gating is explicit, measured, and reversible.

## Shadow mode (current default)

On pull requests, `scripts/graph-impact-shadow.mjs`:

1. Computes `impacted_tests` from the living graph and the PR diff.
2. Runs the **full** discovered test suite (not the impacted subset).
3. Writes `.construct/shadow-impact.json` with `failed_tests`, `outlier_failures`, and `result` (`ok`, `outliers`, or `cannot_compute`).
4. Always exits 0. CI marks the step `continue-on-error: true`.

Fail-open: when the graph is stale, missing, or the diff touches graph-blind paths (`.github/workflows/**`, `package-lock.json`, `scripts/ci/**`), the artifact records `cannot_compute` instead of returning a wrong impacted set.

## Promotion criteria

Gating activates only when **all** of the following hold over the evaluation window:

| Criterion | Value | Rationale |
|---|---|---|
| `minEligibleRuns` | **30** | Enough PR samples to trust the trend; small samples over-fit to lucky runs. |
| `maxOutlierRuns` | **0** | Any failure outside the impacted set is a missed recall event; gating would have skipped that test file. |
| `windowDays` | **90** | Recent signal only; graph topology and suite shape drift over longer horizons. |

An **eligible** run is one whose artifact `result` is `ok` or `outliers` (not `cannot_compute`).

### Metrics (derived, not stored in artifacts)

Per run, from existing artifact fields:

- **Recall** = `(failed_tests - outlier_failures) / failed_tests.length` when any test file failed; otherwise `null`.
- **Precision** = `true_positives / impacted_tests.length` where true positives are failed files that were in the impacted set; `null` when the impacted set is empty.

The promotion report pools eligible runs in the window and also reports aggregate recall and precision across them.

### Verdict

- `not-promoted`: criteria not met. The gating job exits 0 without running impacted-only tests. Shadow collection continues.
- `promoted`: criteria met. The gating job runs impacted-only tests as a required check and fails loud on compute errors, impacted test failures, or outlier failures in the companion shadow artifact.

Until real CI history satisfies the threshold, the repo ships the promotion-report tooling and gating scaffold in **tooling-only** mode (`not-promoted`).

## Commands and artifacts

```bash
# Promotion report against archived shadow history (default: .construct/shadow-history/)
node scripts/graph-impact-promotion-report.mjs --json

# Gating job entrypoint (no-op until promoted unless forced for local proof)
node scripts/graph-impact-gate.mjs --base origin/main
```

CI archives each PR's `.construct/shadow-impact.json` as a workflow artifact and appends it to a rolling `.construct/shadow-history/` cache so the promotion report can aggregate across runs.

## Reversibility

Gating is controlled by promotion data, not a one-way delete of the shadow path:

- `CONSTRUCT_GRAPH_IMPACT_GATING=0` forces shadow-only mode even when criteria are met.
- `CONSTRUCT_GRAPH_IMPACT_FORCE_GATING=1` forces gating for local proof (does not bypass graph compute errors).
- The shadow job keeps running after promotion so recall can be re-measured and the flip can be reversed if outliers reappear.

## Related surfaces

- `construct graph verify` (construct-4uxq0.11.10): blocking graph integrity guardrail; composes with gating but does not replace impact selection.
- `scripts/shadow-lib.mjs`: shared graph impact read, metrics, and promotion evaluation.
- `docs/guides/concepts/gates-and-enforcement.mdx`: defense-in-depth gate layers.
