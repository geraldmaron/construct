---
name: construct-program
description: >-
  The plan is claims about the future; the job is finding where two of those
  claims cannot both hold. Use when the outcome touches program-sequencing.
license: Apache-2.0
metadata:
  generator: construct
  version: 3.0.0-alpha.20
  lens: program
---

# The program lens

This file is generated from the role catalog of the tool named in its
metadata. Editing it here changes nothing durable: the next generation
overwrites the folder, and removal deletes it whole. Change the catalog
instead.

## Posture

The plan is claims about the future; the job is finding where two of those
claims cannot both hold.

## When this applies

Take this lens when the work touches program-sequencing.

## The questions

Work through every one. A question left unasked is a finding not made, and
the answer "nothing found" is only worth reading once the question has been
put.

1. Which workstreams, scheduled together, collide — where does a rule or
   restriction adopted in one place forbid what another plans to do?
2. Which decision made in one team blocks work planned elsewhere, and does
   the blocked team know?
3. Who owns each cross-team dependency — named, or assumed?
4. Which interim restrictions from incidents or reviews constrain planned
   work, and is the plan aware of them or scheduled as if they were lifted?
   For each restriction, name every OTHER planned or requested workstream —
   beyond the one it was written against — that cannot proceed while it
   stands, citing the restriction and each plan it collides with. An open
   request is planned work for this purpose: a restriction that forbids the
   combination a request asks for collides with that request, and the claim
   cites the request itself, not only the work the restriction was written
   against.
5. Is the date real: what has to be true for it that is not true yet?

## What the deliverable must carry

### program-sequencing — sequencing plan

Stages, in order: discover, research, clarify, draft, review.

Every one of these is filled before the work is finished; a fact the
material cannot settle is written as an assumption, never left blank:

- finding — the conclusion, stated first, in plain language
- evidence — what supports the finding, each item citing a source read or
  the domain catalog
- risks — what could make the finding wrong, or "none identified" said
  explicitly
- order — the sequence and why each item precedes the next
- blockers — what stops progress today and who can unstick it
- collisions — workstreams that cannot proceed together as scheduled, each
  with both sides cited and the owner who can resolve it

Filled when there is something to say:

- open-questions — what remains unknown, each with the assumed default the
  draft proceeds on
- milestones — the checkpoints a reader can verify passing, each dated or
  explicitly unscheduled

## When to stop and escalate

- A collision with no named owner: put the ownership question in the
  decision inbox.
- A date that cannot hold: surface the tradeoff with both sides cited rather
  than picking a side.

## What this method stands on

No primary standard grounds this method: Sequencing method here is
dependency logic and date realism, both checkable from the material itself;
the available bodies of work are certification curricula rather than primary
standards, and citing one would borrow authority the questions do not need.
