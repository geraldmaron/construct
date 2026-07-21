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

Load this before drafting. These are the failure modes that separate strong orchestration from weak orchestration. Check your draft against each.

### 1. Dispatching before classifying
**Symptom**: every request becomes a multi-agent plan before intent and track are named.
**Why it fails**: burns budget on the wrong path and hides the smallest adequate answer.
**Counter-move**: classify first; choose the smallest adequate path; only then recruit.

### 2. Too many perspectives
**Symptom**: profiles repeat the same lens and hand the same conclusion back.
**Why it fails**: noise looks like rigor; the consumer cannot tell who owns the call.
**Counter-move**: dispatch only agents whose priors differ materially from one already on the plan.

### 3. Routing around blockers
**Symptom**: BLOCKED / NEEDS_MAIN_INPUT is hidden by another handoff or a parallel path.
**Why it fails**: the main session never sees the real stop condition.
**Counter-move**: surface the blocker from the main session before starting the next wave.

### 4. Ceremony over outcome
**Symptom**: every phase runs even when there is no signal to consume.
**Why it fails**: empty phases invent work and delay the decision.
**Counter-move**: name the phase output; skip empty phases with an explicit reason.

### 5. Rubber-stamp challenge
**Symptom**: challenge finds nothing because it barely tested the risky claim.
**Why it fails**: high-risk work ships with false confidence.
**Counter-move**: rerun challenge with sharper constraints whenever risk is non-trivial.

### 6. Losing the ask
**Symptom**: profiles optimize a different problem than the original request.
**Why it fails**: polished output that does not answer the user.
**Counter-move**: carry the original request through every handoff and verify it at synthesis.

### 7. Skipping quality gates
**Symptom**: "simple" work ships without review because ceremony feels oversized.
**Why it fails**: small changes still break contracts; the gate was the safety net.
**Counter-move**: keep verification; shrink the gate, do not delete it.

### 8. Exposing internals
**Symptom**: final output narrates each profile's turn instead of the answer.
**Why it fails**: the user asked for a result, not a cast list.
**Counter-move**: synthesize in Construct's voice; keep profile internals in the handoff, not the deliverable.

### 9. Ruminating instead of acting
**Symptom**: repeated reasoning without a read, dispatch, or answer.
**Why it fails**: latency grows while evidence stays flat.
**Counter-move**: after two passes without new evidence, act or ask.

### 10. Bulk reading before routing
**Symptom**: large reads just to decide who should work.
**Why it fails**: burns context before ownership is clear.
**Counter-move**: probe with search/glob/small reads first; deep-read only after the owner is named.

## Sequencing methodology

- **Graph first**: map input→output; parallelize only when independent. "All parallel"/"all sequential" means the graph was skipped.
- **Waves**: dispatch the ready set; next wave starts at the slowest landing. Minimize waves, not headcount.
- **Critical path**: total time is the longest chain. On-path profiles delay everything downstream.
- **Bound fan-out**: cap concurrency to what the consumer can absorb.

## Ship Check

- Classified; smallest path selected; dependency graph drawn; fewest waves; critical path named.
- Distinct ownership; blockers surfaced; original ask matches final output; verification exists for implementation.
