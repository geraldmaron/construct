---
id: cx-ops-dependency-sequencing
version: 1
appliesToRole: operations
summary: >-
  Walks an approved plan from dependency mapping through critical path and
  ownership to a risk register that names timeline-slippage checks.
steps:
  - id: dependency-mapping
    move: Map what blocks what
    question: For each task, what must complete before it can start?
    emits: dependency-graph
    cites: source
  - id: critical-path
    move: Trace the longest dependent chain
    question: Which sequence of blocking tasks sets the floor on total duration?
    emits: sequenced-tasks
    cites: prior-step
  - id: ownership
    move: Name one owner per task
    question: Who is accountable for each task in the sequence, by name or role?
    emits: ownership-matrix
    cites: source
  - id: verification
    move: Attach a verification gate to each task
    question: What check proves this task is actually done, not just started?
    emits: verification-gates
    cites: prior-step
  - id: slippage-risk
    move: Register what could slip and by how much
    question: Where in the sequence is slack thinnest, and what early signal shows slippage?
    emits: slippage-risk
    cites: prior-step
---

Run these five moves in order whenever an architect's decision hands off a
plan for execution. Each move produces one labeled output; a plan is not
executable until all five exist.

**dependency-mapping.** For every task in the incoming plan, name what must
finish first. The `dependency-graph` output cites the contract, manifest, or
runtime config the dependency is based on — not an assumption about how
teams "usually" sequence work. A task with no stated dependency is either
truly independent or the dependency has not yet been found; say which.

**critical-path.** Using the dependency graph, trace the longest chain of
blocking tasks — the sequence that sets the floor on how fast this can ship
regardless of parallel capacity. `sequenced-tasks` cites the dependency graph
(`prior-step`): the sequence is derived from the graph, not from a
convenient story about task order.

**ownership.** For every task, name one accountable owner — a person or a
named role, never "the team" or a placeholder. `ownership-matrix` cites the
same source class as the dependency graph: an owner is asserted because a
manifest, org chart, or prior handoff says so, not invented to fill the
matrix.

**verification.** Attach a concrete verification gate to each task: the
check that proves the task is actually complete. `verification-gates` cites
the sequenced tasks (`prior-step`) — a gate with no corresponding task, or a
task with no gate, is an incomplete plan.

**slippage-risk.** Identify where slack is thinnest on the critical path and
what early, observable signal would show slippage before the deadline
arrives. `slippage-risk` cites the verification gates (`prior-step`): the
risk register is built from the same gates that will actually fire, not a
generic list of things that could go wrong.

Good output: a dependency graph with named sources, a critical path derived
from that graph, an ownership matrix with no placeholder owners,
verification gates that map one-to-one to tasks, and a slippage risk entry
naming an observable early signal. Bad output: "everything can start now"
(no dependencies drawn), an owner named "the team," or a verification gate
that just restates the task description.
