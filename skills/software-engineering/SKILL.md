---
name: software-engineering
description: >-
  Reviews or shapes an implementation for correctness evidence, scope,
  reversibility, dependencies, and operability. Use when the person says
  things like: tests pass but I have a bad feeling about this; look at this
  PR before I merge; is this migration safe to roll back; it works on my
  machine, what am I missing; is this the right way to build it; review this
  code. Not for style alone.
license: Apache-2.0
metadata:
  version: 1.0.0
  source: geraldmaron/construct
---
# Software engineering

A pack of obligations for changes someone will ship. It reviews and shapes
implementations for the evidence behind them, the scope they claim, the way
back if they are wrong, the dependencies they take, and how they behave at
three in the morning. It is not a style guide and not a language tutor.

## 1. Scope - and when to stand down

Engage when an implementation, migration, dependency choice, or
implementation plan is about to be merged, run, or committed to, and being
wrong costs real work or real data. Stand down on style and naming alone, on
questions about how a language or library works, and on design questions
with no implementation in view (the architecture pack owns those). Applying
nothing is a designed outcome.

## 2. Obligations

Every deliverable this pack owns carries the slots in
`references/obligations.md`: correctness evidence, scope, reversibility,
dependencies, operability, principle conformance. An empty slot is written
as empty ("no test covers the retry path") and never filled by guessing.

## 3. Doctrine

The review posture follows Google's code-review guide: the reviewer owes the
author a decision and its reasons, and approves what improves the codebase
rather than what is perfect. Delivery risk is read through the DORA
measures: small batches, fast restore. A dependency change is judged against
the version's own promise (semantic versioning) and its own changelog, never
against a guess. Untested code gets characterization tests before it is
changed (Feathers). Sources, with review dates, are in
`references/sources.md`; cite the one a finding leans on, and never invent a
rule the sources do not state.

## 4. Procedure

1. Read the change and the confirmed principles and constraints that govern
   this code; cite them.
2. Run the project's own checks when the session can (tests, lint,
   typecheck); record the exact command and result. A skipped or failed job
   is reported as such, whatever the author says.
3. Fill each obligation slot with evidence or the word unverified.
4. List findings by severity with the smallest fix stated, not designed.
5. Name what must go to another pack: authoritative data stores and
   irreversible migrations to system-architecture, boundaries and secrets to
   security-privacy.
6. Write the deliverable from `assets/implementation-review.md` or
   `assets/implementation-plan.md`.

## 5. Checks

Deterministic before judgment: the test command ran and its result is
recorded; every material finding cites a file, line, log, or test; the
deliverable has a summary, findings, and assumptions. A review that names
no evidence is incomplete, not wrong.

## 6. Limits and escalation

This pack reviews implementations; it does not decide architecture, sign
off security, or judge legal exposure. When a change reaches into those, it
says so and hands the specific question over. A correctness claim the
session could not test is never promoted to passed.
