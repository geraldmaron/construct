---
name: context-mapping
description: Before acting inside an unfamiliar or half-familiar system - a
  codebase, an organization, a program, a domain - its context is mapped
  first - entities, typed relationships (owns, depends-on, feeds, blocks,
  supersedes), obligations, boundaries, and unknowns as first-class
  entries, each mapped fact naming how it was observed. Produces a dated,
  one-page context map a stranger could act safely from. Use when starting
  work in a system you did not build, inheriting a service or program,
  onboarding to a domain, integrating with something new, or whenever a
  wrong assumption about how parts relate would cost real work. Not when
  the actor already holds the map (acting on known ground needs no
  ceremony), and not for tasks too small to be endangered by a wrong
  relationship - just do those. This file holds the method only; it does
  not remember anything between sessions, and where a memory or knowledge
  store is present, the store keeps the map and this skill governs what a
  good map contains.
license: Apache-2.0
metadata:
  version: 0.4.0
  source: geraldmaron/construct
---

# Context mapping

A working method for establishing how a system hangs together before
changing it. The default failure is confident navigation by resemblance -
folder names as ownership, standard layouts assumed, last person mentioned
as owner. Work done in that gap is where wrong-assumption costs live.

Every rule below is mandatory when this skill is engaged.

## 1. Scope - and when to stand down

Engage when acting inside a system you did not build and do not currently
hold in your head - inheriting a codebase, service, program, or vendor
relationship; onboarding; integrating; resuming ground that has shifted -
and a wrong relationship assumption would cost real work.

Stand down when you already hold the map. Stand down for tasks too small
to be endangered - a one-line fix whose neighbors don't matter. Test: name
the relationship assumptions this task rests on; if none, or all
defensible if challenged, proceed without the method and say so in one
line. Applying nothing is a designed outcome.

## 2. What this skill is not

This file is a method, not a memory. It does not persist between sessions.
The map is an **artifact the user owns** - plain text kept where the user
keeps documents. Where a persistent store exists, the store keeps and
re-serves the map; this skill governs what a good map contains. Where
there is no store, re-reading the map at the start of work is part of the
method (§6).

## 3. The map

One page with entities, typed relationships, obligations, boundaries, and
classified unknowns. Exact skeleton:
[references/map-template.md](references/map-template.md).

Relationship types are closed: owns, depends-on, feeds, blocks,
supersedes. Misfits are two types or unknowns - never untyped arrows.

## 4. Evidence discipline

Every mapped fact carries how it was observed:

- **read** - you saw the primary thing.
- **ran** - you executed it and observed behavior.
- **was-told** - a person or document asserted it; name which. Own memory
  of building counts as `was-told: own memory`.
- **inferred** - concluded from structure, naming, or resemblance - allowed
  and must be visible.

Failure this exists for: a dependency asserted from a folder name -
`inferred` presented as `read`.

Escalation: a relationship the task leans on hard is upgraded to read or
ran, or the gap moves to unknowns. Conflicting sources are recorded as
conflicting, both named - not silently resolved.

## 5. Unknowns are the map's spine

Zero unknowns is a red flag. Classify each:

- **not-yet-looked** - a place to look exists; nobody has.
- **looked-and-unclear** - examined, still ambiguous; say what was examined.
- **unknowable-from-here** - needs access, authority, or a person this work
  lacks; name which.

These demand different responses: cheap work, real work, handoff. Add
unknowns at discovery. Promoting to a mapped fact requires evidence (§4).

## 6. Refresh honesty

The map is dated, and the date is load-bearing. Where the gap is wide or
the system moves fast, first step is a refresh pass on relationships the
task leans on. Drift records what changed; superseded entries stay
visible. Silent correction destroys provenance. If a store maintains the
map (§2), refresh becomes its job under this section's rules.

## 7. The handoff test

Finished when a stranger with your access could act safely from the map
alone: what they may change, what not to touch, whom to ask, where the
dragons are. Read once as that stranger; every place you silently supply
knowledge is a missing line.

## 8. Closing gates

1. Typed throughout - closed type set; no untyped arrows.
2. Evidence tagged - every entity, relationship, obligation; conflicts as
   conflicts.
3. Load-bearing upgraded - lean-on relationships are read/ran or unknown.
4. Unknowns present and classified - zero justified explicitly if claimed.
5. Dated - as-of present; stale ground the task touches was refreshed.
6. Handoff passes - stranger test run; additions visible.

## Closing record

When finalizing, use
[references/verification-record.md](references/verification-record.md).
Method sources: [references/sources.md](references/sources.md).
