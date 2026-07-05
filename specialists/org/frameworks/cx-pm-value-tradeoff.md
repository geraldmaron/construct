---
id: cx-pm-value-tradeoff
version: 1
appliesToRole: product-manager
summary: >-
  Walks a product decision from user value through the tradeoff space to a
  prioritization call, then closes with testable acceptance criteria.
steps:
  - id: user-value
    move: Name the user and the job
    question: Whose problem is this and what job are they hiring it for?
    emits: value-statement
    cites: source
  - id: tradeoffs
    move: Surface the tradeoff space
    question: What does choosing this cost, and who bears it?
    emits: tradeoff-table
    cites: source
  - id: prioritization
    move: Make the call and say what it defers
    question: Given the tradeoffs, what ships now and what is explicitly deferred?
    emits: prioritization-call
    cites: prior-step
  - id: acceptance-criteria
    move: Write acceptance criteria that can fail
    question: For each requirement, what observable, binary check proves it's done?
    emits: acceptance-criteria
    cites: prior-step
---

Run these four moves in order on every product decision that reaches a PRD,
meta-PRD, or backlog proposal. Each move produces one labeled output; do not
skip a move because the answer "seems obvious" — an obvious answer still
needs its citation.

**user-value.** Name a specific user (a role, a segment, an account — not
"users" in the abstract) and the job they are hiring this feature for. The
`value-statement` output cites the customer note, support ticket, research
artifact, or intake packet the user reality came from. If no such source
exists yet, the value statement is `unknown` — do not infer a persona to fill
the gap (see `rules/common/no-fabrication.md`).

**tradeoffs.** For the value statement above, list what this choice costs and
who bears the cost: engineering time, a deferred feature, a support burden, a
technical constraint accepted. The `tradeoff-table` output cites the same
kind of source as the value statement — a tradeoff is not a tradeoff until
someone bears it, and that someone is named.

**prioritization.** Given the tradeoff table, state what ships now and what is
explicitly deferred, and why the deferred item can wait. The
`prioritization-call` output cites the tradeoff table (`prior-step`) — the
call is a function of the tradeoffs surfaced, not a separate judgment made in
isolation.

**acceptance-criteria.** Convert the prioritization call into acceptance
criteria that are binary pass/fail testable — see `skills/roles/product-manager.md`
for the anti-pattern of subjective criteria. Each criterion in
`acceptance-criteria` cites the prioritization call it operationalizes
(`prior-step`). A criterion nobody can fail to meet is not a criterion.

Good output: a value statement naming a specific user and a cited job, a
tradeoff table naming who bears each cost, a prioritization call that states
what is deferred and why, and acceptance criteria that could actually fail a
real build. Bad output: "users want this," an uncited tradeoff, a
prioritization call with no rejected alternative, or an acceptance criterion
like "works well."
