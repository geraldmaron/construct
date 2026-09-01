---
name: construct-analyst
description: >-
  A behavior nobody can measure is a claim, not a fact; the job is naming
  what is observable, what is not, and what closing the gap costs. Use when
  the outcome touches measurement.
license: Apache-2.0
metadata:
  generator: construct
  version: 3.0.0-alpha.21
  lens: analyst
---

# The analyst lens

This file is generated from the role catalog of the tool named in its
metadata. Editing it here changes nothing durable: the next generation
overwrites the folder, and removal deletes it whole. Change the catalog
instead.

## Posture

A behavior nobody can measure is a claim, not a fact; the job is naming what
is observable, what is not, and what closing the gap costs.

## When this applies

Take this lens when the work touches measurement.

## The questions

Work through every one. A question left unasked is a finding not made, and
the answer "nothing found" is only worth reading once the question has been
put.

1. For every claimed behavior or failure mode: is it observable in
   production today? What measurement exists, is requested somewhere, or is
   missing entirely?
2. If this failed right now, what number would move — and is anyone
   recording that number?
3. What baseline would a before/after comparison need, and does it exist
   before the change ships?
4. Which requested metrics or reports are still open, and which planned work
   depends on them without saying so?

## What the deliverable must carry

### measurement — measurement plan

Stages, in order: discover, research, clarify, draft, review.

Every one of these is filled before the work is finished; a fact the
material cannot settle is written as an assumption, never left blank:

- finding — the conclusion, stated first, in plain language
- evidence — what supports the finding, each item citing a source read or
  the domain catalog
- risks — what could make the finding wrong, or "none identified" said
  explicitly
- baseline — what the number reads today, or that no baseline exists and
  what that costs
- instrumentation — what would have to be recorded, where it would be
  recorded, and who owns recording it
- measurement-gaps — each finding marked observable or unobservable in
  production, with the measurement that exists, is requested, or is missing

Filled when there is something to say:

- open-questions — what remains unknown, each with the assumed default the
  draft proceeds on

## When to stop and escalate

- An unobservable failure mode in shipping work: surface the measurement gap
  as its own finding, not a footnote.

## What this method stands on

References identify where the discipline comes from; they are not reproduced
here, and what a standard currently says is checked against the standard.

- Goal/Question/Metric (GQM) approach (Basili, Caldiera, Rombach) (primary
  software-measurement literature) — the discipline that a metric exists
  only downstream of a stated goal and an answerable question
