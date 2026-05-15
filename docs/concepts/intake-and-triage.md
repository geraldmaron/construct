---
title: Intake and triage
description: How signals dropped into `.cx/inbox/` become triaged R&D work routed to the right specialist persona.
---

Construct treats every file that lands in `.cx/inbox/` as a candidate R&D signal — a bug report, a customer comment, an experiment hypothesis, an incident note, a competitor PDF — and routes it through a deterministic triage path before any agent reads it.

This page explains the R&D intake loop, the triage taxonomy, the on-disk layout, and the `construct intake` CLI you use to drive it.

## The R&D loop

Signals enter on the left, outcomes leave on the right:

```
signal → framing → hypothesis → research → artifact
       → design → implementation → evaluation → release → operations → memory
```

Each `rdStage` is a checkpoint in that loop. Triage assigns one stage to each signal so the agent knows where in the loop the work picks up — a stack-trace bug enters at `implementation`; a customer NPS drop enters at `signal`; a CVE disclosure enters at `operations`.

## What happens when a file lands in `.cx/inbox/`

1. The embed daemon's reactive watcher (`lib/embed/inbox-live-watcher.mjs`) picks the file up within a second or two.
2. The inbox ingester normalizes it into markdown under `~/.cx/knowledge/` and indexes it for retrieval.
3. `prepareIntakeForIngestedFile` runs four deterministic preparation steps:
   - **lane suggestion** via `lib/docs-routing.mjs` (postmortem? PRD? ADR?)
   - **related-doc retrieval** via the hybrid corpus query
   - **excerpt extraction** for the agent to see without reopening the file
   - **R&D triage** via `classifyRdIntake` (keyword/heuristic, no LLM)
4. The result is written to `.cx/intake/pending/<id>.json`.
5. At the next session start, the hook surfaces a one-line summary per pending packet:

   ```
   ## Pending R&D intake (3)
   - login-feedback.md → bug / implementation · owner: debugger · next: diagnose
   - competitor-pricing.md → research / research · owner: business-strategist · next: research
   - hallucination-trace.md → eval-finding / evaluation · owner: evaluator · next: evaluate
   ```

The daemon never calls an LLM. The model spend stays with the agent in the user's editor.

## Triage taxonomy

`classifyRdIntake` returns a triage block with nine fields. Three of them are enums.

### `intakeType` — what kind of signal this is

| Type | Examples |
|---|---|
| `user-signal` | customer feedback, NPS comments, support tickets, churn signals |
| `bug` | stack traces, error reports, regressions, crashes |
| `requirement` | feature requests, PRD drafts, acceptance criteria, success metrics |
| `research` | competitor scans, market research, pricing teardowns |
| `experiment` | hypotheses, spikes, prototypes, falsifiable plans |
| `eval-finding` | hallucinations, score regressions, judge-rubric findings |
| `architecture` | ADR drafts, RFC drafts, system-design tradeoffs |
| `incident` | outages, SLO/SLA breaches, latency spikes, pages |
| `launch-asset` | release notes, version bumps, ship candidates |
| `ops` | runbooks, cron jobs, capacity plans, dependency upgrades |
| `security` | CVEs, vulnerabilities, secret leaks, exploit reports |
| `legal-compliance` | GDPR, license audits, DPA reviews |
| `unknown` | nothing matched — agent decides |

### `rdStage` — where in the R&D loop the signal enters

`signal`, `framing`, `hypothesis`, `research`, `artifact`, `design`, `implementation`, `evaluation`, `release`, `operations`, `unknown`.

### `recommendedAction` — what the next move is

`summarize`, `clarify`, `research`, `create-hypothesis`, `draft-prd`, `draft-rfc`, `draft-adr`, `create-experiment`, `diagnose`, `implement`, `evaluate`, `release-review`, `create-runbook`, `archive`.

### Other fields

- `primaryOwner` — persona name from `agents/registry.json` (e.g. `debugger`, `product-manager`, `sre`).
- `recommendedChain` — ordered handoff sequence (e.g. `['debugger', 'engineer', 'qa', 'reviewer']`).
- `risk` — `low`, `medium`, or `high`.
- `requiresApproval` — `true` when the action is high-risk enough to need human confirmation.
- `confidence` — `[0, 1]` driven by keyword-match density.
- `rationale` — one-line explanation of why this classification was picked.

## Classification heuristics

The classifier is deterministic: same input → same output, no LLM. It builds a signal corpus from the filename, the extracted excerpt, and the titles of related docs, then scores it against keyword sets per `intakeType`. Ties break in favor of higher-stakes classes — `security` beats `research` when both match, `incident` beats `architecture`, etc.

This is a fast-tier classifier, not a final answer. The agent in the user's editor reads the packet and does the actual analysis: does this signal overlap with an existing PRD? Contradict an ADR? Need an RFC? The triage block is a routing hint, not a verdict.

## On-disk layout

```
<project>/.cx/intake/
  pending/
    2026-05-14T15-22-08-login-feedback.json    — newly arrived signal
  processed/
    2026-05-13T11-04-19-payment-postmortem.json — agent finished
  skipped/
    2026-05-12T09-47-30-noise-pdf.json          — agent intentionally skipped
```

Each `<id>.json` carries: `id`, `createdAt`, `status`, `intake` (sourcePath, outputPath, characters, knowledgeSubdir), `triage` (the nine fields above), `suggestion` (lane), `related` (top-K artifacts), `excerpt`, `query`. Status transitions add `processedAt + processedBy + notes` or `skippedAt + skippedBy + reason`.

## CLI

```bash
construct intake list                  # ID, type, stage, owner, action
construct intake show <id>             # full packet — triage, excerpt, related artifacts
construct intake done <id> [--notes=…] # move pending → processed
construct intake skip <id> [--reason=…] # move pending → skipped, audit trail preserved
construct intake reopen <id>           # processed or skipped → pending
```

In `solo` mode the queue is the filesystem (`.cx/intake/`). In `team` and `enterprise` modes the same CLI talks to a Postgres-backed queue with row-locked worker claims; the contract is identical.

## See also

- [Deployment model](/concepts/deployment-model) — solo vs team vs enterprise topology.
- [Beads and durable state](/concepts/beads-and-state) — how triaged work becomes tracked work.
- [Gates and enforcement](/concepts/gates-and-enforcement) — what the agent must satisfy before closing intake.
