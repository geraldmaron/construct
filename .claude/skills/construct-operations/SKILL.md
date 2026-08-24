---
name: construct-operations
description: >-
  Everything ships into someone's night shift: the question is who is woken,
  by what signal, and what they can actually do at that hour. Use when the
  outcome touches operations.
license: Apache-2.0
metadata:
  generator: construct
  version: 3.0.0-alpha.15
  lens: operations
---

# The operations lens

This file is generated from the role catalog of the tool named in its
metadata. Editing it here changes nothing durable: the next generation
overwrites the folder, and removal deletes it whole. Change the catalog
instead.

## Posture

Everything ships into someone's night shift: the question is who is woken,
by what signal, and what they can actually do at that hour.

## When this applies

Take this lens when the work touches operations.

## The questions

Work through every one. A question left unasked is a finding not made, and
the answer "nothing found" is only worth reading once the question has been
put.

1. When this fails, how does anyone find out — an alert, a customer, or a
   quarterly report? Name the detection path or say there is none.
2. Who answers when it breaks, and do they have the access and the runbook
   to fix it without waking whoever built it?
3. What support burden does this create per week once it is live — new
   ticket categories, new questions, new manual steps?
4. What is the rollback, and has anyone confirmed it works after the point
   of no return (a migration, a published message, a charged card)?
5. What does this cost to keep alive — the recurring maintenance nobody
   budgets because it is not a feature?

## What the deliverable must carry

### operations — operability review

Stages, in order: discover, research, clarify, draft, review.

Every one of these is filled before the work is finished; a fact the
material cannot settle is written as an assumption, never left blank:

- finding — the conclusion, stated first, in plain language
- evidence — what supports the finding, each item citing a source read or
  the domain catalog
- risks — what could make the finding wrong, or "none identified" said
  explicitly
- failure-paths — how this breaks, each with how anyone would find out
- ownership — who answers when it breaks and what access they need to fix it
- rollback — how to undo it, including past any irreversible step, or the
  plain statement that there is none
- operability-gaps — each failure path with its detection signal and its
  owner, or the gap named where one of the three is missing
- performance-obligation — the performance obligation this work must meet:
  the gate the declared repository runs, named by the script that runs it,
  or the standard this method descends from where it declares none — with
  how a reader would check the work against it

Filled when there is something to say:

- open-questions — what remains unknown, each with the assumed default the
  draft proceeds on

## When to stop and escalate

- A failure path with no detection: surface it as a finding — an outage
  nobody notices is the expensive kind.
- A change with no rollback past an irreversible step: route it as a
  decision, not a caveat.

## What this method stands on

References identify where the discipline comes from; they are not reproduced
here, and what a standard currently says is checked against the standard.

- Site Reliability Engineering (the SRE book) (Google / O’Reilly) —
  detection, ownership, and toil framing: every failure path needs a signal,
  an owner, and a stated cost to keep alive
