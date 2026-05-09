<!--
skills/roles/architect.md — Anti-pattern guidance for the Architect role.

## Improvement Note (auto-generated 2026-04-29)
- Improve specificity in technical guidance; provide detailed steps or code snippets rather than vague suggestions.
- Ensure that responses directly address the user's request; avoid unrelated topics or general advice that doesn't pertain to the task.
- Incorporate thorough explanations for any proposed solutions or changes to clarify their importance and methodology.

Loaded at sync time to inline role-specific failure modes into specialist agent prompts.
Covers common failure modes for the architect domain and counter-moves to avoid them.
Applies to: cx-architect, cx-rd-lead.
-->
---
role: architect
applies_to: [cx-architect, cx-rd-lead]
inherits: null
version: 1
---
# Architect — Role guidance

Load this before drafting. These are the failure modes that separate strong role output from weak role output — check your draft against each.


### 1. Premature tech choice
**Symptom**: the design names a specific database, framework, or cloud service before the requirements have been stated.
**Why it fails**: anchors the team on a tool the problem may not need. Alternatives go unexplored.
**Counter-move**: state requirements first. Name candidates second. Pick last, with the reason tied to the requirements.

### 2. Decisions without alternatives
**Symptom**: the doc presents one option as the recommendation with no serious comparison.
**Why it fails**: reviewers cannot tell whether the decision was made or merely assumed.
**Counter-move**: document at least two real alternatives with specific reasons each was rejected. A straw-man alternative is worse than none.

### 3. Ignoring operational burden
**Symptom**: the design optimizes for build-time elegance and ignores who operates the system at 3am.
**Why it fails**: elegant systems become unmaintainable once they have real users; on-call pays the cost forever.
**Counter-move**: include an operations section. Who pages, what breaks, how it is observed, how it is rolled back.

### 4. Reversibility blindness
**Symptom**: no statement of whether the decision is a one-way door (irreversible) or a two-way door (cheap to undo).
**Why it fails**: one-way doors get the same debate-depth as two-way doors; teams over-deliberate on the reversible and under-deliberate on the permanent.
**Counter-move**: label every major decision as one-way or two-way and match the evidence burden to it.

### 5. Boundary vagueness
**Symptom**: modules, services, or teams are drawn with arrows but the contracts — inputs, outputs, failure modes — are not specified.
**Why it fails**: each team implements its own interpretation; the integration surfaces the gaps in production.
**Counter-move**: every boundary has a contract. Every contract names its failure modes.

### 6. Scaling for the fantasy case
**Symptom**: the design is sized for a load that requires 100x of current users, which the business has no plan to reach.
**Why it fails**: pays today's cost for tomorrow's hypothetical. The hypothetical never arrives, or arrives in a different shape.
**Counter-move**: size for current load plus the one-year plan. Note the scaling assumption. Revisit when reality deviates.

### 7. Ignoring the migration
**Symptom**: the design describes the end state but not the path from here to there.
**Why it fails**: migration is where projects die. "Cut over the weekend" rarely works.
**Counter-move**: include a migration plan with phases, dual-run strategy, rollback points, and the failure modes of each phase.

### 8. Reinventing over reusing
**Symptom**: a custom solution for a problem a mature tool already solves, justified by thin differentiation.
**Why it fails**: the team now owns the maintenance of both the product and a worse version of an existing tool.
**Counter-move**: survey existing tools honestly. If building, articulate exactly what the existing tools fail to do.

## Self-check before shipping

- [ ] Requirements are stated before tech choices
- [ ] At least two real alternatives considered and rejected with reasons
- [ ] Operations section names on-call, observability, rollback
- [ ] Every major decision labeled one-way or two-way
- [ ] Every boundary has a specified contract, including failure modes
- [ ] Scaling assumptions are named and tied to the business plan
- [ ] Migration path is explicit with phases and rollback points
- [ ] Build-vs-buy is justified when building
