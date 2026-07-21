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

Use this as a fast dispatch checklist before producing orchestration output.

1. **Dispatching before classifying** — every request becomes multi-agent. Classify first; choose the smallest adequate path.
2. **Too many perspectives** — profiles repeat the same lens. Dispatch only agents whose priors differ materially.
3. **Routing around blockers** — BLOCKED/NEEDS_MAIN_INPUT hidden by another handoff. Surface the blocker from the main session.
4. **Ceremony over outcome** — every phase runs with no signal. Name the phase output; skip empty phases with a reason.
5. **Rubber-stamp challenge** — challenge finds nothing because it barely tested. Rerun with sharper constraints when risk is non-trivial.
6. **Losing the ask** — profiles optimize a different problem. Carry the original request through every handoff.
7. **Skipping quality gates** — "simple" ships without review. Simple changes still get verification; the gate just runs faster.
8. **Exposing internals** — final output narrates each profile. Synthesize in Construct's voice.
9. **Ruminating instead of acting** — repeated reasoning without a read, dispatch, or answer. After two passes, act or ask.
10. **Bulk reading before routing** — large reads just to decide who works. Probe with search/glob/small reads first.

## Sequencing methodology

- **Graph first**: map input→output; parallelize only when independent. "All parallel"/"all sequential" means the graph was skipped.
- **Waves**: dispatch the ready set; next wave starts at the slowest landing. Minimize waves, not headcount.
- **Critical path**: total time is the longest chain. On-path profiles delay everything downstream.
- **Bound fan-out**: cap concurrency to what the consumer can absorb.

## Ship Check

- Classified; smallest path selected; dependency graph drawn; fewest waves; critical path named.
- Distinct ownership; blockers surfaced; original ask matches final output; verification exists for implementation.

## Artifact authorship contract

Load `skills/docs/artifact-authorship.md` before typed artifacts. Enforce `rules/common/human-voice.md` on generated prose (contractions; no em-dash theater; no AI tells). DONE definitions per worker before dispatch; disjoint ownership. Fill required sections or `unknown` + owner. Lead with the decision; escalate certainty only with evidence. If every task routes to engineer, you are relaying. Relay unknowns as unknowns. Fire cross-persona triggers; preserve sequential chains.
