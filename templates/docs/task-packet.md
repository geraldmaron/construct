# Task Packet: {goal}

- **Dispatched**: {YYYY-MM-DD HH:MM}
- **Source**: Construct
- **Target Worker Profile**: {role}
- **Track**: immediate | focused | orchestrated
- **Status**: dispatched | accepted | done | blocked | needs-main-input

<!--
The shape emitted by Construct when dispatching to a Worker Profile. Mirrors producer→consumer
Capability postconditions in `registry/capabilities.json`. Required fields below are validated at
handoff — a packet missing any required field BLOCKED_CONTRACTs at handoff. The profile's response
is one terminal state (DONE | BLOCKED | NEEDS_MAIN_INPUT), referencing this packet by id.
-->

## Goal
<!-- One sentence: what success looks like, in the user's voice. Specific and falsifiable; an outcome the specialist can verify they hit. -->

## Intent
<!-- One of: research | implementation | investigation | evaluation | fix. The deterministic policy in lib/orchestration-policy.mjs:INTENT_CLASSES is the source of truth; do not invent new classes. -->

## Work category
<!-- One of: visual | deep | quick | writing | analysis. Drives the model tier. Authority: lib/orchestration-policy.mjs:WORK_CATEGORIES. -->

## Risk flags
<!-- Subset of: architecture, security, dataIntegrity, ui, docs, ai. Drives whether challenge/review profiles join the chain. Authority: lib/orchestration-policy.mjs:detectRiskFlags. -->

## Acceptance criteria
<!-- The conditions that, when all met, mean DONE. Each criterion is verifiable (a test, a check, an observable). Subjective criteria ("looks good") are not acceptable; restate them as observable behavior. -->

| # | Criterion | Verification |
|---|---|---|
| 1 | {restated, falsifiable} | {test name / check / observable} |

## Context
<!-- The minimum the specialist needs to start: file paths, prior decisions, related bd ids, intake packet id, the user's exact language. Link, don't paraphrase. -->

## Constraints
<!-- Hard limits the specialist must respect: budget, timeline, contract boundaries, parts of the system that are off-limits, prior decisions that are not being revisited. -->

## Handoff candidates
<!-- Worker Profiles this packet may legitimately route to next. Defaults read from registry/worker-profiles/<id>.json → handoffCandidates. -->

## Approval gates
<!-- If the work crosses an approval boundary (commit, push, scope change, irreversible action), name it here. Construct must surface these to the user; the specialist must not bypass. -->

## Verification plan
<!-- How DONE will be confirmed before the chain closes: test runs, doctor checks, smoke tests, manual review. The specialist proves DONE against this plan, not against a vibe. -->
