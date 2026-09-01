---
name: construct-product
description: >-
  Scope is a set of promises; the job is finding the promise the
  organization has made twice, incompatibly. Use when the outcome touches
  product-scoping.
license: Apache-2.0
metadata:
  generator: construct
  version: 3.0.0-alpha.20
  lens: product
---

# The product lens

This file is generated from the role catalog of the tool named in its
metadata. Editing it here changes nothing durable: the next generation
overwrites the folder, and removal deletes it whole. Change the catalog
instead.

## Posture

Scope is a set of promises; the job is finding the promise the organization
has made twice, incompatibly.

## When this applies

Take this lens when the work touches product-scoping.

## The questions

Work through every one. A question left unasked is a finding not made, and
the answer "nothing found" is only worth reading once the question has been
put.

1. Do any two commitments contradict — strategy against specification,
   specification against public statement? Cite both sides.
2. Where does field evidence — tickets, user reports, incident notes —
   contradict an assumption the plan is built on?
3. What is explicitly out of scope, and is anything relying on it anyway?
4. How will anyone know it worked — is the success measure stated, and does
   the data for it exist?

## What the deliverable must carry

### product-scoping — product requirements document

Stages, in order: discover, research, clarify, draft, review.

Every one of these is filled before the work is finished; a fact the
material cannot settle is written as an assumption, never left blank:

- finding — the conclusion, stated first, in plain language
- evidence — what supports the finding, each item citing a source read or
  the domain catalog
- risks — what could make the finding wrong, or "none identified" said
  explicitly
- users-and-problem — who this serves and the problem it solves for them,
  cited to the material or [unverified]
- in-scope — what this outcome includes, with a checkable criterion for each
  — a name, a version, a place to look — or an explicit stated absence,
  never left silent
- out-of-scope — what it deliberately excludes, so growth is visible as
  growth
- success-measures — how the user will know it worked — each one checkable,
  cited or [unverified]
- commitment-conflicts — commitments that cannot both hold, each side cited,
  with who owns the call

Filled when there is something to say:

- open-questions — what remains unknown, each with the assumed default the
  draft proceeds on
- phasing — what ships first and what deliberately waits, with the reason
  for the split

## When to stop and escalate

- Two commitments that cannot both hold: frame the tradeoff with both cited
  and put it in the decision inbox.

## What this method stands on

No primary standard grounds this method: Product scoping practice has no
primary standard; its literature is advocacy. The lens’s discipline is
carried by its slot structure — scope in and out, checkable success measures
— which the template enforces directly.
