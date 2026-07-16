---
title: Target architecture — Standing Assignment model
description: Canonical target architecture and 15 ADR decisions proposed by the continuous-work audit.
intake: none
---

# Target Architecture — Canonical Continuous-Work Model

## Framing (per audit constraint: converge, don't add a parallel concept)

The assignment's 10-entity model (Source Target, Standing Assignment, Trigger Policy, Run, Evidence Cursor, Action Intent, Approval Decision, Action Attempt, Outcome, Assurance Finding) maps onto existing Construct machinery for nine of the ten entities — only Standing Assignment itself is new (see the mapping table below and its "Net" line). The correct move is **formalize and close gaps in what exists**, not build new subsystems:

| Assignment entity | Existing Construct machinery it formalizes |
|---|---|
| Source Target | `sources.targets[]` config + provider manifests (already real) |
| Standing Assignment | **New canonical concept** — supersedes: embed capabilities (`lib/embed/capability-jobs.mjs`), #408's `directives[]`, #410's `watch` triggers. These three are the "overlapping concepts" the audit brief warns against; only one should survive. |
| Trigger Policy | Currently split three ways: daemon `setInterval` cadences, `directives[].trigger` (branch), `watch.intervalMinutes` (branch). Converges into one. |
| Run | Flow engine's `createRun`/`advanceRun` (`lib/flows/engine.mjs`) + checkpoint persistence — the one genuinely atomic subsystem in the codebase. Reuse its persistence pattern for Run state everywhere. |
| Evidence Cursor | `lib/sources/watch.mjs` `lastSeenHead`/`lastSeenHash` — real, but currently advances at detection time, not after processing (truth-matrix row 13). Needs a cursor-accepted-after-evidence-durable rule. |
| Action Intent | `lib/writes/write-intent.mjs` — real, typed, `KNOWN_PROVIDERS` needs the namespace fix (row 27). |
| Approval Decision | `lib/embed/approval-queue.mjs` `ApprovalQueue` — real, needs atomicity + cross-process reload fix (row 20). |
| Action Attempt | `lib/writes/envelope.mjs` `writeWithEnvelope` — real, needs the error-type-swallow fix (row 18) and execution leases (row 22, entirely absent). |
| Outcome | `lib/writes/sent-log.mjs` — real, needs atomicity + error-surfacing fix (row 19). |
| Assurance Finding | Oracle's gap objects (`lib/oracle/synthesize.mjs`) — real, needs the evidence-status vocabulary expansion (row 24) and the invariant registry (see Oracle miss report). |

**Net: one new concept (Standing Assignment as the unifying trigger/scheduling model) plus formalization of nine existing subsystems.** This satisfies constraint #7-9 (preserve orchestrator-worker direction, reuse the flow engine, don't build a second workflow engine) and the explicit instruction not to create a parallel concept alongside embed/directives/capabilities.

## Recommended target shape

- **Embed daemon** is demoted from "the product" to an **internal scheduler host** — it becomes the process that ticks Standing Assignments due for evaluation, same role it already plays for its 19 built-in jobs, just with directives/capabilities/watch-triggers unified into one assignment type instead of three.
- **Oracle** is repositioned from occasional executor-of-last-resort (its current, accidental role for directives per row 8) to **pure assurance consumer**: it evaluates evidence envelopes and raises findings/beads; it should never be the only path by which a Standing Assignment's action actually executes. The current defect (directive execution silently depends on Oracle because the daemon never executes) is a symptom of not having this boundary drawn cleanly — a Standing Assignment's action plane must run independent of whether Oracle happens to observe it.
- **Action plane** (envelope + sent-log + approval queue + leases) becomes the single mandatory path for every external mutation, matching the assignment's explicit rule ("no specialist, Oracle action, daemon job, MCP tool, or provider-specific helper may bypass that plane"). Concretely this means the drain (row 21) gets wired in, but only after leases (row 22) exist — wiring the drain first would manufacture the exact duplicate-mutation P0 the audit is trying to prevent.
- **"Embed" as a name/boundary**: recommend it survives as the *internal* scheduler/daemon name (it's descriptive and has supervision tooling already, once fixed), but the *product-facing* vocabulary becomes Standing Assignment / Run / Trigger — "embed capability" and "directive" both retire as user-facing terms once ADR-A lands. This is a naming/API-surface decision, not a rewrite.
- **AWS topology**: deferred to ADR-L (user decision required — the three options carry materially different cost/complexity tradeoffs that aren't the audit's call to make unilaterally). Recommend against pre-populating `construct-2ec1y` until that ADR resolves (its current description hardcodes the long-running control-plane answer).

## Control flow (target)

1. Standing Assignment evaluated on Trigger Policy (interval/cron/webhook/source-change/manual) → daemon tick.
2. Evidence Cursor probed; if no meaningful change and no forced full-review, **stop here** — no reasoning tokens spent (already partially true for capability jobs via the reasoning-executor gate; needs to generalize to Standing Assignments overall).
3. Meaningful change detected → Run created, checkpointed via flow-engine pattern.
4. Bounded specialist/flow execution (reuse orchestration/flow engine — no new engine).
5. Output validated against contract → Action Intent(s) produced, or artifact-only.
6. Action Intent → Approval Decision (policy-gated: deny/draft/approve/autonomous-within-budget).
7. Approved intents drain into the Action Plane: lease acquired → Action Attempt → provider write → reconciliation → Outcome recorded (sent-log).
8. Assurance Findings raised by Oracle from the evidence envelopes this run produced, on its own independent cadence — never a precondition for the run's own completion.

## Data flow / trust boundary
All source content (git commits, Jira issues, Slack messages, Confluence pages) is untrusted input to any specialist/reasoning step — separated from system instructions per existing MCP/broker conventions. No change recommended here beyond what the security-hardening bead (E6/E-security) enumerates from Phase 13 of the assignment.

## Provider boundary
Two-stack model (read-oriented data-source manifests vs. governed-write adapters) is architecturally sound and should **stay** — the fix needed is the namespace canonicalization (ADR-E), not a redesign.

## Local vs AWS
Both run the identical assignment/run/trigger/action/assurance contracts; only the backend for run-store, intake-queue, and action-plane storage changes (filesystem/sqlite locally, Postgres for team/AWS). This is already how the orchestration run store is designed (`resolveRunStore`) — extend the same pattern to Standing Assignment state and the action plane rather than inventing a separate AWS-only model.

---

# ADR Beads (created in bd as children of construct-4uxq0.4 / WP4)

Each is a decision record, not a document — see bd for full content (options/evidence/consequences/reversibility/downstream-blocked-beads).

| ADR | Decision | Owner |
|---|---|---|
| A | Canonical continuous-work model + terminology (Standing Assignment supersedes directives/capabilities/watch) | User (audit drafts) |
| B | Does "embed" survive as product-facing name | User |
| C | Atomic persistence standard (adopt checkpoint.mjs temp+rename pattern everywhere) | Audit |
| D | Delivery semantics: at-least-once + leases + idempotency for external writes | Audit drafts, User ratifies |
| E | Provider-ID namespace canonicalization | Audit |
| F | Provider certification ladder + production gate level | Audit ladder, User gate |
| G | Oracle 3-layer assurance + evidence-status vocabulary | Audit design, User ratifies |
| H | Job truth-status vocabulary (ran/supported/evidenceFresh/resultStatus/error) | Audit |
| I | Test-isolation standard (hermetic state roots, enforced for all state classes) | Audit |
| J/K | Single project identity + state-root consolidation | Audit drafts, User ratifies (migration) |
| L | AWS topology (event-driven worker / long-running control-plane / direct scheduled tasks) | User |
| M | Actuation default posture (opt-in reasoning, approval-default policy) | User |
| N | Approval/drain lifecycle (single-record vs lease-guarded batch drain) | Audit drafts, User decides |
| O | Jira API migration plan | Audit |

Critical path: **ADR-C and ADR-D are audit-decidable now** (atomic persistence and lease/idempotency semantics are engineering facts, not product choices) and unblock every P0 bead. ADR-A/B are the only hard gates on the #408 directives slice and on epic/CLI naming — everything else can proceed in parallel with those pending.
