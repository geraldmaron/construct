---
name: decision-framing
description: Disciplined framing for decisions that will be expensive to
  revisit - one recommendation backed by honestly generated options, a
  stated do-nothing baseline, a reversibility class, the strongest objection
  in its own words, a pre-mortem, and a decision record a later reader can
  audit without the conversation that produced it. Use when someone must
  choose between real alternatives and being wrong has a cost - architecture
  and vendor choices, build-vs-buy, sequencing and investment calls,
  organizational or strategic direction, any "which way should we go"
  question whose answer someone will act on. Not for decisions already made
  (help execute instead), choices with one viable option (say so and
  proceed), or reversible low-stakes picks where deciding fast beats
  deciding well - answer those directly and skip this method entirely.
license: Apache-2.0
metadata:
  version: 0.3.0
  source: geraldmaron/construct
---

# Decision framing

A working method for decisions whose record must survive the decider now
and the reader a year later who asks what we were thinking. Default
failure: collapse to the first coherent option, present a fake menu,
bury the recommendation, treat do-nothing as unthinkable, record nothing.

Every step below is mandatory when this skill is engaged.

## 1. Scope - and when to stand down

Engage when a real choice exists and will carry weight: someone will build,
buy, commit, reorganize, or forgo because of it, and reversing has a cost.

Stand down - and say so in one sentence - when: the decision is already
made (help execute); one viable option (say why others are not); or a
cheap reversible pick (answer fast and try it). Full apparatus on a
two-way door is a failure of this skill. If stakes are unclear, ask one
question rather than guessing. Applying nothing is a designed outcome.

## 2. Frame before options

Write four things before listing options:

- **The decision, in one sentence, as a choice.** "Choose how X will Y" -
  not a topic, not a smuggled conclusion. Keep asking "in service of what?"
  until it is a choice between outcomes.
- **Who decides, and who is consulted.** No identifiable decider means
  this is a discussion; stand down.
- **Reversibility class**, with reasoning:
  - *Reversible* - undo costs about what doing cost. Usually stand down.
  - *Costly to reverse* - undoable at real expense.
  - *One-way* - practically irreversible. When unsure, class upward.
- **Do-nothing baseline as a real option.** Costs accrued, options that
  expire, risks that grow or shrink - including when do-nothing is best.

Constraints (falsifiable, disqualify) and preferences (weights) in two
labeled lists. A preference stated as a constraint quietly deletes options.

## 3. Options honestly generated

- Two to five real options, each in a paragraph its advocate would sign.
- At least one option the framer does not favor, same depth. Often
  do-nothing or "the boring incumbent, used harder."
- Named, not numbered.
- Disqualified options stay visible with the constraint that removed them.

## 4. Trade-off discipline

- Consequences per option against three to six criteria, concrete enough
  to be wrong - never bare adjectives.
- Facts cited or `[unverified]`; inferences stated as such; assumptions
  `[assumed]`. If investigative-research is present it governs deep
  evidence work; otherwise marks stay honest.
- No invented thresholds - sourced, or labeled as a chosen line by whom.
- Contested comparisons: options as columns, criteria as rows. Uncontested:
  prose is enough.

## 5. One recommendation, then its strongest enemy

- Exactly one recommendation, first, one sentence, to the decider. Tie:
  cheaper-to-reverse, and say so.
- Strongest objection under its own heading, in its advocate's words.
- What would change the answer - revisit-when triggers.
- Verdict in the record: proposed | accepted | accepted with controls |
  needs validation | rejected. Not yet seen by the decider stays proposed.

## 6. The pre-mortem

Assume the recommendation was followed and failed. Write the most likely
specific story, the early signal, and whether anything cheap now makes
failure survivable. A generic pre-mortem was not performed. If it
materially weakened the recommendation, say so and revisit §5.

## 7. The decision record

Exact skeleton:
[references/decision-record.md](references/decision-record.md).

## 8. Closing gates

1. Framed as a choice - sentence, decider, reversibility, do-nothing.
2. Constraints separated from preferences; disqualifications tied.
3. Rivals real - at least one unfavored option; disqualified visible.
4. Consequences concrete - facts marked; no invented thresholds.
5. One recommendation with a verdict from the four.
6. Strongest objection in its own words.
7. Pre-mortem - story, signal, whether it weakened the recommendation.
8. Record complete - every line filled or `not established`.

## Closing record

When finalizing, use
[references/verification-record.md](references/verification-record.md).
Method sources: [references/sources.md](references/sources.md).
