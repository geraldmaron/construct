---
name: requirements-structuring
description: Turns an intent - "we should build X" - into a requirements
  artifact someone could build from and a stranger could verify against.
  Outcomes, constraints, assumptions, and already-made decisions separated
  and labeled; every acceptance criterion an observation a stranger could
  make; non-goals stated; open questions earned, not dumped. Shapes for a
  full PRD, a one-page brief, and a change-request addendum. Use when
  scoping a feature, product, program, or change - "write the requirements",
  "spec this out", "turn this idea into a PRD", or when a build is starting
  on requirements that exist only as conversation. Not for work whose
  requirements are already obvious and small (a rename, a config change, a
  well-understood fix) - state the one-line intent and proceed - and not for
  the decision of WHETHER to build, which is a decision-framing problem to
  surface, not to specify around.
license: Apache-2.0
metadata:
  version: 0.5.0
  source: geraldmaron/construct
---

# Requirements structuring

A working method for the artifact between an intent and a build. Default
failure: restate the request longer, mix wants with assumed how, write
unchecked acceptance ("works well"), leave exclusions unstated, dump open
questions the author could have answered.

Every rule below is mandatory when this skill is engaged.

## 1. Scope - and when to stand down

Engage when work will be built, bought, or committed to on the artifact's
strength, and requirements currently live in conversation or someone's head.

Stand down when requirements are already obvious and small - rename, config
flip, well-understood fix. One-line intent and proceed. Stand down
differently when the real question is *whether*, not *what*: surface the
undecided decision rather than specifying around it. If decision-framing is
present it governs that step; if not, name the undecided thing at the top
and mark contingent parts. Applying nothing is a designed outcome.

## 2. The four-way separation

Sort everything into four labeled lists before filling a document shape:

- **Outcomes** - what is true when done, as observable results, not
  features. Implementation-shaped entries become outcomes-by-asking-why, or
  constraints if genuinely mandated.
- **Constraints** - falsifiable limits with a source. No source → demote to
  preference.
- **Assumptions** - `[assumed]`, what would settle it, what breaks if wrong.
- **Decided** - attributed decisions already made. Unattributable "decisions"
  are assumptions.

Load-bearing facts: cited or `[unverified]`. If investigative-research is
present it governs deep verification; otherwise marks stay honest.

## 3. The checkability rule

Every acceptance criterion is an observation a stranger could make without
asking anyone. Test: could two people disagree whether it is met? If yes,
not a criterion yet.

- "Works well" → the hidden measurement, or delete.
- "Is fast" → operation, load, number, where the number comes from -
  invented thresholds labeled chosen, by whom.
- "Handles errors gracefully" → enumerated failures and what the user sees.
- Unchecked criteria are scope theater - delete or name who checks when.

## 4. Non-goals are claims

Deliberate exclusions in their own section, one line each with reason.
Unstated exclusions grow scope by silence. A non-goal that keeps being
argued is usually an undecided decision filed as an exclusion - surface it.

## 5. Open questions are earned

Before shipping a question: could the author have settled it from held
material, something reachable, or one bounded pass? If yes, settle it.
Remainders name why unsettled (authority, access, or a named person's
decision), who answers, and what is blocked.

## 6. Priority honesty

Buckets: critical path / now / next / later. Critical path is only what the
outcome is impossible without. If more than roughly a third lands in the
top bucket, re-sort with "what would we actually drop first?"

## 7. The shapes

Full PRD, one-page brief, and change-request addendum:
[references/document-shapes.md](references/document-shapes.md).

## 8. Closing gates

1. Separated - four lists correct; implementations converted or justified.
2. Checkable - every criterion passes the disagree-test; thresholds labeled.
3. Non-goals stated - each with reason.
4. Questions earned - why, who, what blocked.
5. Priorities honest - top bucket only critical path.
6. Decision surfaced - hidden whether-decisions named at the top.

## Closing record

When finalizing, use
[references/verification-record.md](references/verification-record.md).
Method sources: [references/sources.md](references/sources.md).
