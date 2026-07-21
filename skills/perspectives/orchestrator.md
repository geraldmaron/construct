---
name: perspectives-orchestrator
description: Provides perspective-specific anti-patterns, failure modes, and counter-moves for Worker Profile execution.
inputs: [task-context, request]
artifactType: perspective-guidance
perspective: orchestrator
applies_to:
  - orchestrator
inherits: null
version: 2
scopes:
  - rnd
cap: 1
---
# Orchestrator. Perspective guidance

Load before drafting. Check the draft against each failure mode.

### 1. Dispatching before classifying
**Symptom**: every request becomes a multi-agent plan before intent and track are named.
**Counter-move**: classify first; choose the smallest adequate path; only then recruit.

### 2. Too many perspectives
**Symptom**: profiles repeat the same lens and hand the same conclusion back.
**Counter-move**: dispatch only agents whose priors differ materially from one already on the plan.

### 3. Routing around blockers
**Symptom**: BLOCKED / NEEDS_MAIN_INPUT is hidden by another handoff or a parallel path.
**Counter-move**: surface the blocker from the main session before starting the next wave.

### 4. Ceremony over outcome
**Symptom**: every phase runs even when there is no signal to consume.
**Counter-move**: name the phase output; skip empty phases with an explicit reason.

### 5. Rubber-stamp challenge
**Symptom**: challenge finds nothing because it barely tested the risky claim.
**Counter-move**: rerun challenge with sharper constraints whenever risk is non-trivial.

### 6. Losing the ask
**Symptom**: profiles optimize a different problem than the original request.
**Counter-move**: carry the original request through every handoff and verify it at synthesis.

### 7. Skipping quality gates
**Symptom**: "simple" work ships without review because ceremony feels oversized.
**Counter-move**: keep verification; shrink the gate, do not delete it.

### 8. Exposing internals
**Symptom**: final output narrates each profile's turn instead of the answer.
**Counter-move**: synthesize in Construct's voice; keep profile internals in the handoff, not the deliverable.

### 9. Ruminating instead of acting
**Symptom**: repeated reasoning without a read, dispatch, or answer.
**Counter-move**: after two passes without new evidence, act or ask.

### 10. Bulk reading before routing
**Symptom**: large reads just to decide who should work.
**Counter-move**: probe with search/glob/small reads first; deep-read only after the owner is named.

## Sequencing methodology

- **Graph first**: map input→output; parallelize only when independent.
- **Waves**: dispatch the ready set; next wave starts at the slowest landing.
- **Critical path**: total time is the longest chain; on-path profiles delay everything downstream.
- **Bound fan-out**: cap concurrency to what the consumer can absorb.

## Ship Check

- Classified; smallest path selected; dependency graph drawn; fewest waves; critical path named.
- Distinct ownership; blockers surfaced; original ask matches final output; verification exists for implementation.
