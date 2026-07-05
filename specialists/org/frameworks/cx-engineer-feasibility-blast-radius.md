---
id: cx-engineer-feasibility-blast-radius
version: 1
appliesToRole: engineer
summary: >-
  Walks an implementation task from a feasibility read through an effort
  class to a blast-radius assessment naming what could break in integration.
steps:
  - id: read-first
    move: Read the existing pattern before writing
    question: What does the code that already does something similar look like?
    emits: feasibility-assessment
    cites: source
  - id: effort-class
    move: Classify the effort
    question: Given the existing pattern, is this a small, medium, or large change?
    emits: effort-class
    cites: prior-step
  - id: debt-check
    move: Name debt this change takes on or pays down
    question: Does this change introduce a shortcut, or does it retire one?
    emits: debt-note
    cites: source
  - id: blast-radius
    move: Trace what else could break
    question: What callers, seams, or integration points does this change touch beyond its own file?
    emits: blast-radius
    cites: prior-step
---

Run these four moves before writing implementation code. Each move produces
one labeled output; skipping "read-first" is the specific failure mode this
framework exists to prevent.

**read-first.** Grep and read the files this change will touch and the
files that already solve something similar. `feasibility-assessment` cites
file:line for every claim about existing behavior or convention — never a
remembered API shape or an assumed function signature. If the existing
pattern is genuinely absent, the assessment says so and names what was
searched.

**effort-class.** Given what read-first found, classify the change as S/M/L
— matching the `complexity` enum already used in `lib/contract-schemas/decision.json`
tasks, so the classification is legible to the architect who assigned the
task. `effort-class` cites the feasibility assessment (`prior-step`): the
class follows from what the code actually looks like, not from a guess made
before reading it.

**debt-check.** Name any technical debt this change introduces (a shortcut,
a TODO, a workaround) or retires (removing dead code, fixing a known
sharp edge). `debt-note` cites the specific file:line the debt lives in or
the run/test that shows a shortcut is gone — debt is never asserted in the
abstract.

**blast-radius.** Trace every caller, seam, or integration point this change
touches beyond the file being edited — the place where "it works in
isolation and breaks in integration" would show up. `blast-radius` cites the
effort class and feasibility assessment (`prior-step`): the radius is
derived from what was actually read, not a boilerplate "should be low risk."

Good output: a feasibility assessment citing file:line for every claim, an
effort class that matches the actual diff size once written, a debt note
that names a specific shortcut or a specific removal, and a blast-radius
list naming actual callers or integration seams. Bad output: "should be
straightforward," an effort class assigned before reading any code, or a
blast-radius section that says "low risk" with no callers named.
