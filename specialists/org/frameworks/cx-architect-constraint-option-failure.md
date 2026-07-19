---
id: architect-constraint-option-failure
version: 1
appliesToRole: architect
summary: >-
  Walks a design decision from constraint mapping through scored options to
  the failure modes the chosen option must survive.
steps:
  - id: constraint-mapping
    move: Name the invariants and the constraints
    question: What are the invariants, and what breaks if they're violated?
    emits: constraint-map
    cites: source
  - id: option-scoring
    move: Score each option against the constraints
    question: For each candidate approach, how well does it satisfy the constraint map, and at what cost?
    emits: option-scoring
    cites: prior-step
  - id: decision
    move: Choose and name what was rejected
    question: Given the scores, which option is chosen, and why were the others rejected?
    emits: decision-record
    cites: prior-step
  - id: failure-modes
    move: Enumerate how the chosen option fails
    question: Under what conditions does the chosen option break, and what is the blast radius of that failure?
    emits: failure-modes
    cites: prior-step
---

Run these four moves before an ADR is written. Each move produces one
labeled output; the framework exists to prevent decisions that emerged from
code rather than from deliberate, documented tradeoffs.

**constraint-mapping.** Name the system's invariants — the properties that
must hold — and the constraints (technical, organizational, regulatory) that
bound the solution space. `constraint-map` cites the source the invariant or
constraint comes from: an existing contract, a data model, a compliance
requirement, a prior ADR. An invented invariant is worse than no invariant —
write `unknown` when a constraint is suspected but not confirmed.

**option-scoring.** For every candidate approach (including "do nothing"),
score it against the constraint map: what it satisfies, what it costs, what
it risks. `option-scoring` cites the constraint map (`prior-step`) — a score
is a function of the constraints named, not a separate intuition about which
option "feels right."

**decision.** Choose the option the scoring favors and name specifically why
the others were rejected — this is the ADR's Rejected Alternatives section.
`decision-record` cites the option scoring (`prior-step`): the chosen option
follows from the scores, and the rejection reasons are the scoring
dimensions the losing options failed on, not a generic "didn't fit."

**failure-modes.** For the chosen option, enumerate the conditions under
which it breaks and the blast radius of that failure — this is the ADR's
Consequences and Reversibility material. `failure-modes` cites the decision
record (`prior-step`): the failure modes are specific to what was actually
chosen, not a boilerplate risk list that would apply to any option.

Good output: a constraint map with cited invariants, option scores that show
their work against those constraints, a decision record with ≥2 rejected
alternatives and specific rejection reasons, and failure modes that name
concrete breaking conditions and their blast radius. Bad output: a decision
with no rejected alternatives (the decision defaulted), constraints asserted
without a source, or failure modes that just restate generic engineering
risk ("could have bugs").
