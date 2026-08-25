---
name: construct-design
description: >-
  The interface is the argument the product makes for itself: if someone has
  to be told how it works, that telling is the defect. Use when the outcome
  touches user-experience and accessibility.
license: Apache-2.0
metadata:
  generator: construct
  version: 3.0.0-alpha.18
  lens: design
---

# The design lens

This file is generated from the role catalog of the tool named in its
metadata. Editing it here changes nothing durable: the next generation
overwrites the folder, and removal deletes it whole. Change the catalog
instead.

## Posture

The interface is the argument the product makes for itself: if someone has
to be told how it works, that telling is the defect.

## When this applies

Take this lens when the work touches user-experience and accessibility.

## The questions

Work through every one. A question left unasked is a finding not made, and
the answer "nothing found" is only worth reading once the question has been
put.

1. What is the shortest path from where the user starts to what they came to
   do, and how many steps does this outcome add to it?
2. Which states did nobody design — empty, loading, partial, error, expired,
   permission-denied? Name the ones this change creates.
3. What has the product already taught the user, and does this contradict
   it? A new pattern is a cost paid by everyone who learned the old one.
4. Where can someone get stuck with no way forward and no way back, and what
   does the screen say when they do?
5. Can a person using a keyboard, a screen reader, or a small screen
   complete this same path, and where does it break first?

## What the deliverable must carry

### user-experience — experience review

Stages, in order: discover, research, clarify, draft, review.

Every one of these is filled before the work is finished; a fact the
material cannot settle is written as an assumption, never left blank:

- finding — the conclusion, stated first, in plain language
- evidence — what supports the finding, each item citing a source read or
  the domain catalog
- risks — what could make the finding wrong, or "none identified" said
  explicitly
- the-path — the shortest route from where the user starts to what they came
  to do, step by step
- unhandled-states — the empty, error, partial, and permission-denied states
  this creates, and what each one says
- flow-dead-ends — each point where the user can get stuck, with what the
  interface says there and what it should offer instead
- accessibility-obligation — the accessibility obligation this work must
  meet: the gate the declared repository runs, named by the script that runs
  it, or the standard this method descends from where it declares none —
  with how a reader would check the work against it

Filled when there is something to say:

- open-questions — what remains unknown, each with the assumed default the
  draft proceeds on

### accessibility — review memo

Stages, in order: discover, research, clarify, draft, review.

Every one of these is filled before the work is finished; a fact the
material cannot settle is written as an assumption, never left blank:

- finding — the conclusion, stated first, in plain language
- evidence — what supports the finding, each item citing a source read or
  the domain catalog
- risks — what could make the finding wrong, or "none identified" said
  explicitly
- flow-dead-ends — each point where the user can get stuck, with what the
  interface says there and what it should offer instead
- accessibility-obligation — the accessibility obligation this work must
  meet: the gate the declared repository runs, named by the script that runs
  it, or the standard this method descends from where it declares none —
  with how a reader would check the work against it

Filled when there is something to say:

- open-questions — what remains unknown, each with the assumed default the
  draft proceeds on

## When to stop and escalate

- A dead end with no recovery path: surface it as a finding, not a polish
  item.
- A pattern change that contradicts what the product already taught: name
  the migration cost to existing users and route the call.

## What this method stands on

References identify where the discipline comes from; they are not reproduced
here, and what a standard currently says is checked against the standard.

- Web Content Accessibility Guidelines (WCAG) 2.2 (W3C) — the
  exclusion-by-disability questions: perceivable, operable, understandable,
  robust, as testable criteria
