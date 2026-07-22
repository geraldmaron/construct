---
title: Continuous-work truth reconciliation — final report
description: Top-level summary of the 2026-07 continuous-work audit: 8 work packages, headline findings, and the resulting E1-E6 remediation program.
intake: none
---

# Construct Continuous Operational Work — Adversarial Audit Final Report

**Audit epic:** `construct-4uxq0` · **Date:** 2026-07-16 · **Baseline:** `main=a2e7118e`, `staging=cfdcc3c5`, PR#408=`95dbe687`, PR#409=`be3ba748`, PR#410=`1c99ae38`, audit branch `feat/wjap9-p1.2-graph-vocabulary@38576396`

---

## 1. Executive finding

Construct is trying to become a governed operational teammate: point it at sources, assign durable responsibilities, and it continuously accumulates context and completes bounded work, locally and on AWS, with identical semantics. A great deal of the necessary machinery already exists — a real flow-engine checkpoint system with genuine atomic persistence, a real governed-write envelope with idempotency-key computation, a real Oracle daemon that idempotently raises beads, a real (if underused) Postgres queue with row-locking and leases. **The problem is not absence of parts; it's that the parts don't compose into one honest system, and the tracker used to coordinate the work claims more of it is finished than actually is.**

Two findings dominate everything else:

1. **The tracker doesn't reflect git reality.** Three epics (`construct-36frs`, `construct-p4cba`, `construct-wjap9`, 15 beads total) were closed "Fixed"/"6/6 complete" — but zero of `36frs`/`p4cba`'s commits are reachable from `main` or `staging` (they exist only on the open PR branches), and `wjap9`'s commits, while real and tested, sit on an unmerged branch too. Worse: three of `p4cba`'s six "complete" children contain the exact class of defect this audit was commissioned to find — a directive-execution lifecycle that stamps its own "I ran" timestamp before it has run anything, silently starving the one real executor of work to do.
2. **What's live on `main` today is mostly inert or quietly dishonest, not "unfinished."** Reasoning is opt-in and off by default (fine, conservative). But two daemon jobs achieve "success" by calling methods a read-only provider never implements, catching the resulting crash, and reporting zero findings (`#409`, unmerged, fixes this honestly). Supervision templates invoke a CLI flag that doesn't exist, so crash-restart silently doesn't work. The one working write-drain function is called by nothing. No execution lease exists anywhere in the write path. The AWS deploy pipeline builds a Docker image from a Dockerfile that isn't in the repository and health-checks an endpoint no server implements. And Oracle — the system meant to catch all of this — has itself been silently dead for five days, its error message discarded by the very daemon contract that's supposed to keep it running.

**Recommended canonical model:** converge embed capabilities, PR #408's directives, and PR #410's watch-triggers into one **Standing Assignment** concept (ADR-A), formalizing nine existing subsystems (flow-engine checkpoints → Run, write-intent → Action Intent, approval queue → Approval Decision, sent-log → Outcome, etc.) rather than building anything new — of the model's 10 entities, only Standing Assignment itself is new (see [target-architecture.md](target-architecture.md)'s mapping table). Full detail: [target-architecture.md](target-architecture.md).

**Most important removals/consolidations:** retire "directive" and "embed capability" as user-facing concepts once Standing Assignment lands (ADR-A/B); do not merge PR #408 as-is — split it into three independently-gated slices; do not populate `construct-2ec1y`/`construct-dqgdc` until the AWS topology decision (ADR-L) is made, since the epic's current description already hardcodes one answer; purge the stale `~/.cx/` comments and the second/third project-identity derivations once ADR-J/K land.

---

## 2. Current-state truth matrix

44 rows, full detail in [truth-matrix.md](truth-matrix.md). Summary by status:

| Status | Count | Representative rows |
|---|---|---|
| production-usable | 3 | Flow-engine checkpoints (31), Oracle bead auto-raise (25), read-side provider manifests (26) |
| usable-with-limitations | 6 | Embed daemon core, generic git provider, staleness ledger, doctor watcher, monitor CLI, orchestration run store |
| implemented-but-disconnected | 2 | `drainApprovedWriteIntents` (21), Postgres queue lease machinery (35) |
| opt-in-unproven | 1 | Embed capability reasoning executor (2) |
| partial | 5 | Cursor-at-detection semantics (13), Oracle verdict vocabulary (24), governed-write manifest namespace (27), provider-write requirements (30-adjacent) |
| scaffold | 4 | Directives subsystem (7), presets (3), deterministic PR review (40), intake filesystem-queue (34) |
| dead | 7 | Watch-field drop (10), execution leases (22), Slack governed adapter on main (28), root Dockerfile/worker Dockerfile/auth-status handler (36-38) |
| stale | 3 | Jira search endpoint (29), AWS workflow undocumented dormancy on main (39), Oracle daemon (23) |
| contradicted | 13 | Supervision `--foreground` (4), both false-success daemon jobs (5-6), directive lifecycle (8-9), dual polling models (11), monitor/watch overlap (17), envelope error-swallow (18), sent-log/approval-queue atomicity (19-20), worker duplicate-execution window (33), triple project identity (41), sterility guard gap (42), false "follow-up filed" claims (43), tracker-vs-git mismatch (44) |
| unknown-evidence-failed | 1 | ADF-compliance re-verification for the Jira adapter (30) |

---

## 3. Oracle miss report

Full detail in [oracle-miss-report.md](oracle-miss-report.md). **Four systemic miss classes** explain nearly every gap:

- **M1 Vocabulary gap** — `healthy`/`attention`/`degraded` cannot express dormant, opt-in-unproven, or false-success.
- **M2 Scope gap** — Oracle never inspects PR branches, deploy templates, or tracker-vs-git consistency.
- **M3 Liveness gap (meta-miss)** — Oracle didn't just miss defects, it missed *its own death*: self-shut-down 5 days ago, and the one watcher meant to catch that (`oracle-liveness.mjs`) depends on the doctor daemon, which died at nearly the same time.
- **M4 Integration gap** — bd and git are two unreconciled sources of truth; no invariant ever asks whether a closed bead's SHA is reachable from main.

12-item invariant-registry seed produced, headline: `closed-bead-sha-reachable-from-main-or-annotated`.

---

## 4. Target architecture

Full detail in [target-architecture.md](target-architecture.md). One new concept (Standing Assignment), nine formalized existing subsystems, embed daemon demoted to internal scheduler host, Oracle repositioned as pure assurance consumer rather than accidental executor-of-last-resort. 15 ADR beads created (`construct-4uxq0.4.1`–`.15`, ADR-A through ADR-O) with owner, options, evidence, consequences, reversibility, and downstream-blocked beads in each.

---

## 5. Gap and risk register (condensed — full detail is the truth matrix + beads)

| Severity | Issue | Evidence | Bead |
|---|---|---|---|
| P0 | sent-log silent-swallow + non-atomic rewrite | `lib/writes/sent-log.mjs:65-82` | `construct-4uxq0.9.1` |
| P0 | approval-queue non-atomic + cross-process dedup gap | `lib/embed/approval-queue.mjs:225-233` | `construct-4uxq0.9.2` |
| P0 | no execution leases anywhere | repo-wide grep, zero matches | `construct-4uxq0.9.3` |
| P0 | directive due-stamp before execution | `lib/embed/daemon.mjs` directive-runner (PR #408) | `construct-4uxq0.10.2` |
| P0 | duplicate schema key + FIELD_RULES gap | `schemas/project-config.schema.json:146,157` | `construct-4uxq0.10.1` |
| P0 | test-sterility guard incomplete | `tests/helpers/sterile-host-env.mjs` only fingerprints audit-trail.jsonl | `construct-4uxq0.14.1` |
| P1 (11 items) | see E1/E2/E4/E5/E6 P1 children | — | `construct-4uxq0.{9,10,12,13,14}.*` |
| P2/P3/P4 | AWS deploy, team mode, tenancy, semantic-review expansion | — | E3/E5 P2s, `construct-2ec1y`, `construct-dqgdc` |

---

## 6. PR reconciliation plan

Full detail in [pr-reconciliation.md](pr-reconciliation.md). **Order: #409 (merge as-is) → #410 (merge trimmed, drop the dead `watch` block) → #408 (do not merge; split into 408a/408b/408c, each independently ADR-gated).**

---

## 7. Beads created or updated

**Created:** 1 audit epic (`construct-4uxq0`) + 8 WP children + 15 ADR beads + 6 new epics (E1–E6) + 37 epic-children + 1 standalone meta-finding bead = **68 new beads**.

**Updated (annotated, R1, kept closed):** `construct-36frs` (+3 children), `construct-p4cba.1/.2/.5`, `construct-wjap9` (+6 children).

**Reopened (R2 — acceptance not truly met):** `construct-p4cba` (epic itself — false "6/6 complete" close reason), `construct-p4cba.3`, `construct-p4cba.4`, `construct-p4cba.6`.

**Priority-adjusted:** `construct-36w10` P3→P2 (gates ADR-J/K), `construct-dqgdc` P2→P3 (per the assignment's own priority rubric).

**Annotated only (no status change):** `construct-2ec1y` (do-not-populate-before-ADR-L), `construct-72gqn.21` (ready-vs-deferred anomaly, out of scope), `construct-nl9f` (confirmed distinct, left untouched).

Full IDs, titles, and reasons: see the `bd show`/`bd list --parent construct-4uxq0` output — every bead above is independently re-readable via `bd show <id>`.

---

## 8. Critical path

1. **ADR-C, ADR-D** (audit-decidable now, engineering facts not product choices) → unblock all 6 P0 beads.
2. **6 P0 beads land** (E1 ×3, E2 ×2, E6 ×1) — safe to parallelize once their ADR gates clear.
3. **ADR-A/B/E/G/I** (user decisions, can be requested in parallel with P0 work) → unblock 408a/408c, evidence-vocabulary, sterility-infra ADR gate.
4. **#409 merges** (no gate) → **#410 trimmed merges** → **current-branch wjap9 delta merges** (E2 sequence).
5. **408a → 408b (post-lease) → 408c (post ADR-A)** — the PR #408 split, strictly gated in this order.
6. **E4 Oracle-assurance work + E5 provider certification** proceed in parallel with the above once their ADRs (G, F, O) land.
7. **Local production milestone**: E6 complete (supervision fix, sterility infra, state-root consolidation, go/no-go health model).
8. **ADR-L (AWS topology, user decision)** → **AWS single-tenant milestone** (E3 P2s + `construct-2ec1y` rescoped and populated).
9. **Team-mode milestone**: `construct-2ec1y` implementation, then `construct-dqgdc` (explicitly deferred, P3).

---

## 9. Production go/no-go criteria

- **Local:** E6 complete — supervision crash-restart actually works, sterility guard covers all real-state classes, one canonical project identity, explicit health model (not "process is alive") passes.
- **AWS single-tenant:** ADR-L resolved, root Dockerfile + worker Dockerfile + `/api/auth/status` handler actually exist, deploy workflow targets are real, E1 P0s + E3 lease/cursor work complete (duplicate-mutation and duplicate-execution windows closed before anything runs unattended in the cloud).
- **Team mode:** `construct-2ec1y` populated and implemented post-ADR-L, worker lease/heartbeat wiring (E3) certified against the real production call path (E5), Postgres intake queue exercised end-to-end.
- **Enterprise:** `construct-dqgdc` (multi-team, stronger tenancy) — explicitly deferred, no criteria defined yet by design.

---

## 10. Decision log

**Decisions made by this audit (Layer 1, engineering facts):** ADR-C (atomic persistence standard), ADR-E (namespace canonicalization direction), ADR-H (job truth vocabulary), ADR-I (test-isolation standard), ADR-O (Jira migration plan).

**Decisions deferred to the user:** ADR-A (canonical model ratification), ADR-B (embed naming), ADR-D (delivery-semantics ratification), ADR-F (certification gate level), ADR-G (evidence-vocabulary ratification), ADR-J/K (identity/state-root migration — low reversibility), ADR-L (AWS topology — low reversibility once built), ADR-M (actuation default posture), ADR-N (drain lifecycle model).

**Evidence still required:** live Jira sandbox certification (Phase 15 of the assignment, not performed in this audit — recommend as part of E5's Jira migration bead); ADF-compliance re-verification against the adapter's actual current code (truth-matrix row 30, flagged `unknown-evidence-failed`); exact root cause of Oracle's 3 consecutive thrown ticks (error is architecturally unrecoverable from disk — fixing `lib/daemons/contract.mjs`'s error-swallow, per E4's liveness bead, is a prerequisite to ever finding this out empirically).

**Blocked beads:** everything downstream of ADR-A/B/D/F/G/J/K/L/M/N per the dependency graph wired in bd (`bd dep tree construct-4uxq0` — zero cycles confirmed).

---

## 11. Deletion and migration list

- **Stale docs/comments:** `~/.cx/` path comments across `lib/embed/cli.mjs`, `lib/embed/daemon.mjs`, `lib/embed/approval-queue.mjs`, `lib/oracle/index.mjs` (post-ADR-0074 XDG migration, never updated).
- **Dead deployment artifacts:** `deploy.yml`/`aws-smoke.yml` DORMANT-stamping (lands with #409); eventual deletion of the terraform ECS health-check target once ADR-L resolves and either a real handler is built or the target is rewritten.
- **Obsolete concepts (pending ADR-A/B):** `lib/directives/` (PR #408, retiring), the `sources.targets[].watch` schema block as currently staged (PR #410, deferred not deleted — returns reconciled), `lib/embed/presets/*.mjs` + their 4 acceptance tests (pending the wire-or-delete decision gated on ADR-B/M).
- **Duplicate paths (pending ADR-J/K):** 2 of the 3 project-identity derivations, 2 of the 3 physical state roots.
- **Compatibility shims:** none identified as needing removal — the audit found missing safeguards (leases, atomicity), not excess legacy shims.
- **State/config migrations:** project-identity key migration (ADR-J, low reversibility, real user data), state-root consolidation (ADR-K, depends on J).
- **Stale tracker artifact:** `.beads/embeddeddolt.broken-20260507-2225/` — a stale broken DB copy noted during WP0 reconnaissance, candidate for cleanup outside this audit's scope (flagging, not touching).

---

## Sterility verification

Before/after snapshot of all three real state roots (`~/.construct/projects/`, `~/.local/state/construct/`, repo `.construct/`) plus the previously-leaky tmpdir root, taken at audit start and again now:

- `~/.construct/projects/`: **byte-identical**, zero diff.
- Tmpdir `.construct` root: **absent both times** — the previously-flagged leak did not recur (no `npm test` was run this audit).
- `~/.local/state/construct/` and repo `.construct/`: legitimate growth only — `audit-trail.jsonl` grew because Construct's own audit trail correctly recorded this session's real bash/MCP activity, `.cx/context.{json,md}` updated via normal session-context mechanics, new `bash-logs/*.log` files from the harness's own command logging. **No test-induced state pollution occurred.**

All 68 new/modified beads are independently re-readable via `bd show <id>`; `bd dep cycles` confirms an acyclic graph.

## Outstanding user-approval items (queued, not executed)

1. Merge PR #409 as-is.
2. Merge PR #410 trimmed (drop the `watch` schema block).
3. Merge the current branch's cross-source-watch delta (`38576396`) to main.
4. `bd dolt push` to publish all bead mutations from this audit to the shared Dolt remote.
5. `git push` of this session's work (none — the audit made zero code changes; nothing to push except bd's own Dolt sync, item 4).
6. ADR-A, ADR-B, ADR-D, ADR-F, ADR-G, ADR-J, ADR-K, ADR-L, ADR-M, ADR-N — ratification decisions, see §10.

No merges, pushes, or code changes have been made. This audit produced beads and four markdown artifacts only.
