---
name: operating-fleet-health-routing
description: fleet-level gap routing and bounded-auto policy for orchestrator's absorbed fleet-health synthesis duty (formerly cx-oracle). Use when handling an Oracle synthesis packet or any systemic-gap remediation routing.
inputs: [oracle-synthesis-packet]
artifactType: guidance
---
# Fleet-health routing (absorbed from cx-oracle, construct-rf26.11)

Loaded on demand via `get_skill("operating/fleet-health-routing")`.

`cx-oracle` retired as a standalone specialist at construct-rf26.11 (the roster-consolidation pass): it had no footprint of its own in `skills/perspectives/` and its declared skills were already just `ai/orchestration-workflow` (the Orchestrator's own) plus a borrowed reference to what is now the Reviewer role's trace overlay. Its meta-controller function — synthesizing fleet-health gaps from the Oracle read model and routing remediation to the specialists who own it — is folded into `orchestrator`. This skill is the verbatim reference for that duty; do not paraphrase the routing table or bounded-auto policy from memory.

## Scope boundary

Diagnose fleet-level health and route work; do not implement fixes directly unless the gap is purely informational. Never commit, push, or merge as part of fleet-health routing.

## Anti-fabrication contract

Every gap cited must trace to a signal in the Oracle read model or a durable artifact path the operator can re-verify. Do not invent violation counts, success rates, or parity summaries. When a signal is absent, write `unknown`.

## Inputs

An Oracle synthesis packet:
- `verdict` — `healthy` | `attention` | `degraded`
- `gaps[]` — `{ id, severity, signal, detail, remediationRoute: { primary, secondary, gateType } }`
- `recommendedActions[]` — `{ kind, summary, classification?, remediationRoute: { primary, gateType } }`
- `readModel` — optional full snapshot from `collectReadModel`

Treat `readModel.parity`, `readModel.contractViolations`, `readModel.doctorLog`, `readModel.outcomes`, `readModel.alignmentCensus`, and `readModel.teamGovernance` as authoritative for their domains.

## Routing table

| Gap signal | Primary specialist | Secondary |
|---|---|---|
| `parity-drift` | engineer | operations (if front-door rule stale) |
| `contract-violations` | owning producer specialist from `contractId` | reviewer |
| `doctor-escalation` | operations | operations (beads issue) |
| `outcomes-degradation` | reviewer (fleet-trace triage mode) | specialist named in degraded role |
| `census-stale` / alignment | architect | operations |
| `observations-empty` | researcher (explorer mode) | engineer |
| `team-understaffed` | operations | orchestrator (escalation) |
| `escalation-path-broken` | operations | architect (registry) |
| `team-decision-violation` | operations | orchestrator (role assignment) |
| `cross-team-handoff-blocked` | operations | owning team specialist |

Note on the last four rows: the pre-consolidation routing table sent team-governance signals to `cx-rd-lead` (retired). This skill repoints them to `operations`, which already owns dependency/ownership mapping and delivery logistics — the closer functional match — rather than to `architect` (rd-lead's other absorbed function, pre-architecture framing). This is a construct-rf26.11 judgment call distinct from the rd-lead retirement itself; flag for reviewer override if a different owner is preferred.

## Bounded-auto policy (do not override)

- **Auto** (may execute without approval): `census-run`, `registry-validate`, `adapters-sync` (tool repo only)
- **Approve** (queue to `.construct/oracle/pending.jsonl`): specialist dispatch, doctor follow-up, trace review, outcomes aggregate
- **Deny**: git push/commit, destructive deletes, force sync

## Output format

```
ORACLE ROUTING — {date}

VERDICT: {verdict}

GAPS:
  [{severity}] {id} — {detail}
    signal: {signal}
    route: {worker-profile}
    handoff: {one-line DONE definition}

AUTO (already executed or skipped):
  {kind}: {status}

APPROVAL QUEUE:
  {id} {kind} — {summary}

BLOCKED:
  {reason or "none"}
```

Return DONE when every high-severity gap has a routed handoff or explicit approval-queue entry. Return BLOCKED when a required signal is missing and remediation cannot be scoped. Return NEEDS_MAIN_INPUT when human approval is required before any specialist dispatch.
