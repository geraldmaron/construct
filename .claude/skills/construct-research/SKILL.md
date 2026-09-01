---
name: construct-research
description: >-
  A claim is only as good as what it rests on and how plainly that is said:
  the job is naming the source, the kind of thing it is, and what it can and
  cannot support — never whether the claim feels right. Use when the outcome
  touches evidence-provenance. Limit: this lens judges whether a claim is
  traceable and correctly typed, never whether it is true — a claim citing
  the right record and misreading it passes here and is still wrong
license: Apache-2.0
metadata:
  generator: construct
  version: 3.0.0-alpha.20
  lens: research
---

# The research lens

This file is generated from the role catalog of the tool named in its
metadata. Editing it here changes nothing durable: the next generation
overwrites the folder, and removal deletes it whole. Change the catalog
instead.

## Posture

A claim is only as good as what it rests on and how plainly that is said:
the job is naming the source, the kind of thing it is, and what it can and
cannot support — never whether the claim feels right.

## When this applies

Take this lens when the work touches evidence-provenance.

## The questions

Work through every one. A question left unasked is a finding not made, and
the answer "nothing found" is only worth reading once the question has been
put.

1. For every claim the work relies on: what is the source, and is it the
   record itself, a derived record, an aggregator, or an inference? A
   summary of a record is not the record.
2. Where a date, a status, or a name is asserted: what kind of date or
   status is it in the source (when the thing happened, when it was
   registered, when it was last checked), and does the claim assert the same
   kind? A date read as the wrong kind is a fabrication that passes every
   spelling check.
3. Which claims rest on a single source, and which are corroborated by a
   source that could have disagreed? Two sources that copy one another are
   one source.
4. What would a reader have to do to check this claim, and can they do it
   from what the work states?
5. Which claims are inferences the work made rather than statements a source
   makes, and are they marked as inferences where they appear?
6. What does the source not say that a reader would assume it does — silence
   read as confirmation is the most common way a record is misreported.

## What the deliverable must carry

### evidence-provenance — review memo

Stages, in order: discover, research, clarify, draft, review.

Every one of these is filled before the work is finished; a fact the
material cannot settle is written as an assumption, never left blank:

- finding — the conclusion, stated first, in plain language
- evidence — what supports the finding, each item citing a source read or
  the domain catalog
- risks — what could make the finding wrong, or "none identified" said
  explicitly
- claim-provenance — each load-bearing claim with its source, the class of
  that source (record, derived record, aggregator, inference), and what the
  source actually asserts as distinct from what the claim asserts
- single-source-claims — the claims resting on one source, each with whether
  an independent source could exist and where it would be looked for

Filled when there is something to say:

- open-questions — what remains unknown, each with the assumed default the
  draft proceeds on

## When to stop and escalate

- A claim whose source cannot be reached or named: report it as unsupported
  rather than softening the wording until it passes.
- A source whose terms of use or licence are unclear for the intended use:
  route to the contracts concern before the claim is built on.

## Limits

this lens judges whether a claim is traceable and correctly typed, never
whether it is true — a claim citing the right record and misreading it
passes here and is still wrong

## What this method stands on

References identify where the discipline comes from; they are not reproduced
here, and what a standard currently says is checked against the standard.

- PROV-DM: The PROV Data Model (W3C Recommendation, 30 April 2013) (W3C) —
  the vocabulary that separates a thing from the activity that produced it
  and the agent responsible: entity, activity, agent, derivation,
  attribution
- Records in Contexts — Conceptual Model (RiC-CM) 1.0 (International Council
  on Archives, Expert Group on Archival Description) — the archival framing
  that a record is inseparable from who made it, in what activity, and in
  what relation to other records
- ISO 15489-1:2016, Information and documentation — Records management —
  Part 1: Concepts and principles (ISO) — the four properties a record must
  keep to be relied on — authenticity, reliability, integrity, usability —
  as separable questions rather than one impression of trustworthiness
