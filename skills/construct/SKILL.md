---
name: construct
description: >-
  Construct is bound to this project. Use it to remember what the person
  asks to keep, to manage an outcome through a resolved workflow, or to set
  up a standing outcome an external clock fires. Answer plain questions
  plainly and record nothing; stand down when nothing is asked of Construct.
license: Apache-2.0
metadata:
  version: 2.0.0
---

# Construct in this session

Construct is a project-bound operating layer. It is not a chat, not a
second agent, and never a reason to leave this session. You do the work here;
Construct remembers, resolves, gates, records, and hands back.

## Start

Call `bootstrap` once. It returns the project binding, how complete setup is,
the questions still open, source and registry health, what this session may
do, open decisions, active runs, and a recommended next action. Do not load
skill bodies, source contents, or the whole context; ask for what a step
needs with `project_context` and `skills`, one topic at a time.

If setup questions are open, put them to the person in ordinary words and
relay each answer with `decide`.

## Recognize the four kinds of request

1. **Answer.** A question ("What does this function do?"). Answer it from
   your own access. Record nothing. Do not start anything.
2. **Remember.** "Remember that…", "Record that…", "Note: …". Call `remember`
   with the person's wording and the kind it is (decision, constraint,
   principle, note, outcome). One record, nothing else: no run, no tasks,
   no staff, no follow-up questions about roles or approvals.
3. **Manage an outcome.** "Review this against our design principles",
   "Write the requirements for…". Call `classify_request` when unsure, then
   `workflows` with `resolve` to learn whether the fitting workflow can run
   here and what would stop it. Only then `start_outcome`.
4. **Maintain a standing outcome.** "Every January, compare strategies to
   active work and capacity." Explain what the standing workflow needs
   (sources, freshness, a clock, permissions, overlap policy) and define it
   with the person; the clock is theirs, the ledger is Construct's.

Ask only when choosing a higher kind would change work, cost, persistence,
permissions, or external side effects and the wording does not settle it.
Never promote a question into work, or a note into a run.

## Do the work here

After `start_outcome`, loop:

- `claim_work` returns the next step, its inputs, and the skill bound to it.
  Ask for the skill's text with `includeSkillBody` only for that step.
  Follow the step's instructions and the skill's method.
- Read only the sources the step names. Every material finding cites what
  it rests on.
- `submit_work` with the step's declared outputs and your evidence
  entries. Validators run; a failure comes back with what to fix, and the
  step is retried if its policy allows. Say `noData` when there was nothing
  to work on.
- If `claim_work` returns a decision instead of work, the run is waiting on
  the person. Put the question to them in plain words with its options;
  relay their answer with `decide`. An approval covers exactly the action
  asked about and expires; never ask for more than the step needs, and
  never assume an answer.

Stay in this session. Do not spawn another agent or run another host
because one is installed. Do not run Construct's command line to do the
work; the command line is for setup and inspection by the person.

## Finish and hand back

When `run_status` shows the run succeeded, hand the person the deliverable:
what it found, what it did not do, what they can do next. A finished step
does not make the deliverable trusted; if the workflow challenges its
deliverable, say what the challenge found. Only the person's judgment,
relayed with `promote_deliverable`, accepts or finalizes it.

If a run is blocked, say plainly what is missing and the smallest step that
would clear it. Never work around a missing source, permission, or skill.

## Stand down

When the person asks nothing of Construct, apply nothing: answer, and move
on. When they ask about principles or sources you cannot find, ask, do not
invent. When a judgment is licensed (legal, medical, regulated, fiduciary),
prepare the material and hand it to a qualified person; it is not yours or
Construct's to give.
