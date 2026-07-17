---
title: PR reconciliation plan (#408/#409/#410)
description: Merge-order plan and disposition for the three long-lived unmerged branches this audit reconciled against main/staging.
intake: none
---

# PR Reconciliation Plan — #408, #409, #410

All three based on `main@a2e7118e`. None are independent features — #408∩#409 conflict on `lib/embed/daemon.mjs`; #408∩#410 conflict on `tests/AUDIT.md` + `tests/capabilities/corpus-inventory.json`; #408∩#410 also share an unreconciled conceptual overlap (two parallel polling models).

## Recommended order: #409 → #410 (trimmed) → #408 (blocked, split)

### 1. Merge #409 first (`chore/ws-a-truth-hygiene`, head `be3ba748`)
- **True purpose:** truth hygiene — converts two false-success daemon jobs (execution-gap, roadmap) into honest skip/error reporting, DORMANT-stamps the dead AWS deploy pipeline, fixes phantom doc references.
- **Correctness/security blockers:** none found. Small (+128/−107, 25 files), diff matches its description accurately (verified in WP evidence — this PR is the one that does NOT overstate itself).
- **Tests:** verified real (typeof-guard tests for the two daemon jobs).
- **Rebase order:** none needed — it's first.
- **Recommendation: merge as-is.** Its conflict with #408 on `daemon.mjs` is *correct pressure* — #408 must rebase onto these honesty guards, not the other way around.
- **Gate:** none beyond standard review. No ADR prerequisite.
- **Requires user approval to actually merge** (per ground rules).

### 2. #410 (`feat/cross-source-watch`, head `1c99ae38`) — merge trimmed
- **True purpose:** generic git source-provider manifest + `resolveCorpusRemote` fallback + schema widening (drops the stale `provider` enum) + stages an unused `watch` config block.
- **Confirmed defect:** the `watch` block is accepted by the schema but **silently dropped** by `normalizeConfigTarget()` (`lib/config/source-targets.mjs:224`) — no consumer anywhere in the repo. This is exactly the "public configuration is incorrect" merge-blocker class (truth-matrix row 10).
- **Recommendation: split the PR.**
  - **Land now:** generic git manifest, corpus-remote fallback, schema enum removal — all independently correct and covered by real functional tests (`source-watch-git.functional.test.mjs`, confirmed to exist and pass in isolation on the branch).
  - **Defer:** the `watch` schema block — it returns once ADR-A picks the canonical trigger model (Standing Assignment), at which point it becomes part of that unified schema rather than a second, disconnected polling concept.
- **ADR prerequisite:** **none** for the trimmed scope. ADR-A only gates the deferred `watch` portion.
- **Coordination note:** #410's head (`1c99ae38`) is an ancestor of the current branch `feat/wjap9-p1.2-graph-vocabulary` (which adds P1.2-P1.6 cross-source-watch work on top). Merging #410 first, then rebasing the current branch's remaining unmerged commits (`d6ae003a`, `38576396`) onto post-merge main, is the clean path — those commits' content (watch.mjs, staleness-ledger, doctor watcher, functional tests) is unrelated to the deferred `watch`-schema-block issue and can proceed independently once ADR-A additionally confirms the cursor-semantics fix (evidence-cursor-advances-after-processing, not at-detection) is scoped correctly.

### 3. #408 (`fix/ws-b-followups`, head `95dbe687`) — do not merge as-is; block and split
- **True purpose:** the entire actuation stack — `lib/writes/`, `lib/directives/`, governed adapters (adds Slack), write-intent-drain daemon job, directive-runner job, Oracle directive-execution branch, `writes`/`directives` config surface.
- **Confirmed merge-blockers (all traced to file:line in WP evidence):**
  1. Duplicate `"writes"` schema key (`schemas/project-config.schema.json` lines 146 & 157) — public-config-incorrect class, P0-5.
  2. Daemon stderr instructs a nonexistent CLI command (`construct directives run <id>`) — CLI registers only `list|status`.
  3. Directive-runner writes `lastRunAt` on due-**detection**, not execution — Oracle's `executeDirective` (the only real executor, itself double-opt-in-gated) reads the same state and can conclude the directive is no longer due, so the directive silently never runs. False success in a safety-critical lifecycle path — P0-4.
  4. `writes`/`directives` config keys absent from `FIELD_RULES` (`lib/config/schema.mjs`) — the PR's own new config surface triggers "unknown fields will be ignored" and is refused entirely in strict mode.
  5. Jira transport uses a deprecated `createmeta` endpoint and an already-largely-removed `search` endpoint (confirmed live against Atlassian's current API during WP1).
  6. Namespace mismatch: embed proposals name providers `atlassian-jira`/`slack`; write control-plane `KNOWN_PROVIDERS = ['jira','github','confluence']`.
- **Tests:** the PR body's "716/716 passing" claim does not certify the above — none of these are things a green test suite would catch (they're config-shape, lifecycle-semantics, and external-API-currency defects, not logic bugs the existing tests exercise).
- **Recommendation: keep the branch open as source-of-record; do not merge; supersede with a three-part split, each independently gated:**
  - **408a — Governed adapters + namespace fix.** Slack adapter, provider-ID canonicalization. Gated on ADR-E (namespace) and P0-1/P0-2 (sent-log/approval-queue atomicity, since the new Slack adapter writes through the same broken persistence layer).
  - **408b — Write-intent-drain wiring.** Gated on ADR-D (leases) and P0-3. **Do not wire the drain before leases exist** — doing so would manufacture the exact duplicate-external-mutation P0 this audit is trying to prevent, worse than the current disconnected-but-safe state.
  - **408c — Directives → Standing Assignments.** Gated on ADR-A (canonical model — directives shouldn't survive as a separate concept) and the lifecycle fixes (P0-4 due-stamp-after-execution, P0-5 config integrity). This slice should be re-authored against the Standing Assignment model rather than patched in place, since ADR-A is expected to supersede the directive concept entirely.
- **Nothing is cherry-picked without its own bead** — 408a/408b/408c are tracked as their own beads under the reconciled `construct-p4cba` epic (see WP6).

## Synthetic-merge coherence check
A synthetic merge of all three as-is would **not** be coherent: #408 and #410 leave two unreconciled polling/trigger models in the merged config schema (directives[].trigger.intervalMinutes vs. sources.targets[].watch.intervalMinutes) with no arbitration, plus #408's own internal defects. The recommended sequencing (409 clean → 410 trimmed → 408 split-and-gated) avoids ever landing that incoherent combined state.

## Does #408 need a canonical-config ADR before it exposes public configuration?
**Yes, for the directives portion (408c) — no, for 408a/408b.** 408a (adapters) and 408b (drain wiring) don't touch `sources.targets[]` or introduce new user-facing schema; only 408c does, and that's precisely the slice ADR-A gates.
