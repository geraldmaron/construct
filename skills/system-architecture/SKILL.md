---
name: system-architecture
description: >-
  Reviews or frames a system design for boundaries, coupling, data
  ownership, and failure paths. Use when the person says things like: two
  teams keep writing to the same table; should this service own its own
  database; we're splitting the monolith, where do the seams go; every
  request goes through four hops; how should these pieces talk to each
  other; is this design going to scale. Not for the line-by-line code, and
  not for who owns what organisationally.
license: Apache-2.0
metadata:
  version: 1.0.0
  source: geraldmaron/construct
---
# System architecture

A pack of obligations for the shape of a system: what owns what, what may
know what, what breaks when a neighbor fails, and what becomes hard to undo.
It reviews designs and writes decision records. It does not review code;
the engineering pack does that.

## 1. Scope - and when to stand down

Engage when a system design, service boundary, data-ownership choice, or
platform adoption is about to be committed to, or when its record must be
written so a later reader can audit it. Stand down on diffs and
implementation detail, on questions about how a tool works, and on scope or
priority questions with no design in view. Applying nothing is a designed
outcome.

## 2. Obligations

Every deliverable carries `references/obligations.md`: boundaries,
coupling, data ownership, failure modes, reversibility, measured properties.
A property nobody measured is written as unmeasured, never assumed.

## 3. Doctrine

Decisions are recorded as ADRs: context, decision, alternatives,
consequences, and never rewritten once accepted (a new record supersedes).
Diagrams are read at a stated level (the C4 model) so a boundary claim is
compared with the code at the same level. Claimed properties are held to
fitness functions: a scale or availability claim is a measurement or it is
unmeasured. Team boundaries are design forces (Conway; Team Topologies), so
an ownership finding names the team as well as the component. Sources with
review dates are in `references/sources.md`; cite the one a finding leans
on, and never invent a principle the sources and the project's constitution
do not state.

## 4. Procedure

1. Read the design and the confirmed boundaries and invariants; cite them.
2. Compare the stated boundaries with the code's imports and the data's
   actual owners; every disagreement is a finding with both citations.
3. Walk each dependency through slow, wrong, and gone.
4. Name what the design makes hard to undo and when that moment arrives.
5. For each claimed property, find the measurement or write unmeasured.
6. Write `assets/architecture-review.md`, or `assets/adr.md` when the task
   is the record; hand security and data-movement questions to
   security-privacy and reversal costs above the accepted posture to the
   person as a decision.

## 5. Checks

Deterministic before judgment: every boundary and ownership claim cites a
document, diagram, or code component; the deliverable carries a summary,
findings, and assumptions; no claimed property lacks a status.

## 6. Limits and escalation

This pack judges shape, not code, and never the legality of a data flow.
It raises rather than resolves any decision whose reversal cost exceeds the
project's accepted risk posture. A property it could not measure stays
unmeasured in the record.
