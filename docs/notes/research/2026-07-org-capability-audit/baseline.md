---
intake: none
---

# Org-Capability Audit & Remediation — Phase 0 Baseline

Captured: 2026-07-13 · Branch: `fix/bash-log-secret-redaction` (staging tip `1b4eb843` + 4 local
commits, stacked audit branch to follow once this PR merges) · Program plan:
`~/.claude/plans/you-are-working-in-snuggly-bunny.md`.

This file records repo state and command output at program start. Evidence, not analysis.
Confidence labels: **confirmed** (observed directly here), **unverified** (claimed by tooling,
not independently re-run).

## Branch & working tree

- `fix/bash-log-secret-redaction` rebased onto `origin/staging` (`1b4eb843`), 4 local commits:
  the secret-redaction fix (`c518a043`, bead `construct-fperd`), a pre-existing comment-lint
  warning fix required by the rebase (`9ac881d3`), a capability-catalog regen for drift already
  present on staging (`4768f0c4`), and a test-corpus-inventory regen for the same reason
  (`1cef275d`). Package version at this tip: `1.5.5` (staging already promoted past the `1.5.4`
  seen at program kickoff).
- The audit program's own branch (`audit/org-capability`) will be cut from this branch's tip
  once the fperd PR is opened/merged, per the user's approved land-first decision.

## `construct doctor` (confirmed, run 2026-07-13T18:3x)

62 passed / 4 warnings / 0 failed. Warnings: (1) beads hygiene — 1 stuck in_progress, 2 possible
merge-drift; (2) reconciliation drift — legacy `.cx/` layout pending fold into `.construct/`;
(3) reconciliation drift — 1 unused `.cursor` adapter directory. `Contract violations (none in
last 24h)` — **note: this reads the local `.construct/contract-violations.jsonl` window, which is
empty/stale in this checkout; it does not reflect the oracle's separately-reported "20 violations
in the last 24h" (bead `construct-1xeqw`), which reads a different aggregation.** Not yet
reconciled — flagged for Wave 1 (H6b/c gives contract violations a real, current-schema source).
`specialists will only PLAN (fix: set orchestration.workerBackend=provider + a key)` — confirms
the default inline backend, consistent with the orchestration exploration findings.

## `construct audit specialists --json` (confirmed)

12 specialists, **all 12 have `grade: "strong"`** (single distinct value across the array) —
confirms H1 exactly as found by exploration (`lib/audit-specialists.mjs:167`). 53 role overlays,
also all graded from static metadata. Saved: `audit-specialists-baseline.json` (not committed —
regenerate via the same command; this file documents the shape/count only).

## `construct certify status --json` (confirmed)

No `specialist.*` capability rows appear in the output at all — not even a single shared
`specialist.prompt.normal` verdict repeated across all 12 (which is what the exploration/design
findings describe as the code's *intended* wiring, `status.mjs:92-105`). Several `release`-
criticality capabilities show `status: "never-run"` (e.g. `surfaces.opencode-primary`,
`demo.tape-fallback`, `research.project-search`, `publish.distribution`,
`diagram.graceful-render`, `document.auto-docs`). `artifact.release-gate` and
`document.ingest.local` show `pass` from a run in this same session (`lastRunAt` ~18:36 UTC,
i.e. the `release:check` run triggered them). **Correction to the plan's H2.2 design**: since no
specialist rows exist in `certify status` today, the "one-verdict-for-all" bug described in
exploration must be reproduced with a targeted `construct certify run` before H2.2 lands, not
assumed present in this baseline — re-verify at H2.2 start.

## `construct orchestrate preflight --json` (confirmed)

`verdict: "pass"`, `attached: true`, `reasonCode: "attached"`, `observationScope: "local-probe"`.
`requiredTools: [orchestration_policy, orchestration_run]` both present. `observedTools` (17,
core-tier) does **not** include `suggest_skills` or `list_skills` — confirms the H4.3 finding
that these are long-tail, not core. Both appear instead in `reachableTools` (the long-tail set
behind `call`). Confirms host-capability negotiation is currently self-reported
(`observationScope: local-probe`, not `host-session`) — consistent with the H9 finding that
`hostExecutionViability` requires an actual host-session probe this local CLI invocation can't
produce.

## `.construct/contract-violations.jsonl` (confirmed, local artifact, gitignored)

Pre-existing local file (not committed, `.gitignore:134`) contains real historical
`CONTRACT_VIOLATION` records from an earlier local workflow run (`2026-07-07`), corroborating the
exploration finding independent of the oracle's own count: violations reference **pre-ADR-0065
roles** (`architect-to-platform-engineer` — `platform-engineer` was folded into `cx-engineer` by
the roster consolidation) and a stale verdict enum member (`'LGTM'` not in
`APPROVED|APPROVED_WITH_WARNINGS|BLOCKED`). Direct evidence that the 36 contract definitions
carry 29-role-era field/enum expectations that will need reconciliation before H6b/c's block-mode
flip (deferred bead D1) — supports the plan's decision to ship H6b/c in **warn-mode** first.

## `npm run release:check` (confirmed, two runs)

First run (pre-fix): failed on `catalog:validate --check` (drift from `certify:document-io` +
`monitor`/`participation` CLI commands landing on staging without a catalog regen — fixed,
`4768f0c4`) and on `tests/test-corpus-inventory.test.mjs` (3 failures, all traced to the new
redaction functional test lacking an inventory entry — fixed, `1cef275d`). Both gaps exist
because PR/staging CI runs a single-runner subset (`construct-wrfcx`, already an open P1 bead)
rather than the full gate — this program's own commits were the first `release:check` run against
them. Second run in progress at baseline-capture time; result to be recorded before the fperd PR
is opened.

## Known degradations carried into the program (not yet fixed)

- Oracle overseer: stale "degraded" verdict (2d old at program start), producer stalled, 5
  approvals pending, `.cx/workflow.json` missing — pre-existing, out of program scope unless a
  Wave-1 fix directly resolves a listed gap (H6b/c does, for `contract-violations`).
- `construct-wrfcx` (P1, full-matrix CI never gates staging) — directly explains both
  release:check failures above; not itself a program deliverable, cross-linked only.
