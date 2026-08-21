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
  version: 0.3.0
  source: geraldmaron/construct
---

# Context mapping

A working method for the step everyone skips: establishing how a system
actually hangs together before changing it. It exists because the default
behavior of a capable model dropped into unfamiliar ground is confident
navigation by resemblance - this looks like a standard layout, so the
relationships are assumed standard; the folder is named billing, so it must
own billing; the last person mentioned is assumed the owner. The feeling of
familiarity arrives long before actual familiarity does, and work done in
that gap is where wrong-assumption costs live: the dependency changed
without telling its dependents, the "owner" who left last year, the module
two things secretly write to.

Every rule below is mandatory when this skill is engaged. The map is a
draft until its verification record is complete.

## 1. Scope - and when to stand down

Engage this method when acting inside a system you did not build and do not
currently hold in your head - inheriting a codebase, service, program, or
vendor relationship; onboarding to a domain; integrating with something
new; resuming ground that has shifted since you last held it - and a wrong
assumption about how parts relate would cost real work.

Stand down when the actor already holds the map: working ground you know
needs no ceremony, and re-mapping it performatively is waste. Stand down
for tasks too small to be endangered - a one-line fix in a file whose
neighbors don't matter proceeds on its own. The test: name the relationship
assumptions this task rests on; if there are none, or all are ones you
could defend if challenged, proceed without the method and say so in one
line.

## 2. What this skill is not

This file is a method, not a memory. It does not persist anything between
sessions, and a map built with it lives only as long as the document it is
written into. That is a designed limit, stated so it is never discovered as
a disappointment: the map is an **artifact the user owns** - a plain-text
document kept wherever the user keeps documents - not state this skill
holds. Where the environment has a persistent store (a memory system, a
knowledge graph, an engine that tracks entities and provenance), the store
keeps and re-serves the map, and this skill's job narrows to governing what
a good map contains and how mapped facts earn their place. Where there is
no store, the map's home is the user's own repository of record, and
re-reading it at the start of work is part of the method (§6).

## 3. The map

One page, exactly this shape. Small systems fill it thinly; that is
correct, not underuse.

```
Context map: <system>
Status: draft | final — Created: <date> — Last updated: <date>
Mapped by: <who> — Contributors: <others, models named> — Tags: <for retrieval>
For: <the task or decision this map serves>

Entities
- <name> — <what it is, one clause> — [seen: read | ran | was-told | inferred]

Relationships   (typed; one per line; no untyped arrows)
- <A> owns <B> — [seen: ...]
- <A> depends-on <B> — <what breaks if B changes> — [seen: ...]
- <A> feeds <B> — <what flows> — [seen: ...]
- <A> blocks <B> — <until what> — [seen: ...]
- <A> supersedes <B> — <since when, and what still reads B> — [seen: ...]

Obligations     (what a part owes, and to whom)
- <entity> owes <what> to <whom> — <source of the obligation> — [seen: ...]

Boundaries      (explicitly outside this map, on purpose)
- <thing> — <why out of scope for this task>

Unknowns        (first-class entries, each classified)
- <question> — [not-yet-looked | looked-and-unclear | unknowable-from-here]
```

The relationship types are closed on purpose: owns, depends-on, feeds,
blocks, supersedes. A relationship that fits none of them is either two of
them (write both) or not yet understood (it goes to unknowns). Untyped
lines and vague arrows are how maps lie - "A ↔ B" records that a
relationship exists while hiding that the mapper does not know what it is.

## 4. Evidence discipline

Every mapped fact carries how it was observed, one of four:

- **read** - you saw the primary thing: the code, the config, the contract,
  the org page, the document.
- **ran** - you executed or exercised it and observed the behavior.
- **was-told** - a person or document asserted it; name which. Your own
  recollection of a system you built or ran counts here too, named as
  self-testimony ("was-told: own memory") - memory of building a thing is
  testimony about it, not a fresh look at it. What you were told is real
  evidence and still not the same as seeing it.
- **inferred** - you concluded it from structure, naming, or resemblance.
  Inference is allowed and must be visible, because it is exactly the
  channel false familiarity arrives through.

The observed failure this section exists for: a dependency asserted from a
folder name - `inferred` presented as `read`. One wrong evidence tag can
cost more than an empty map, because the map's whole value is that a
reader can tell which facts are load-bearing.

Two escalation rules: a relationship the task will lean on hard is upgraded
before leaning - inferred or was-told becomes read or ran, or the gap moves
to unknowns. And a fact that two sources state differently is recorded as
conflicting, with both sources, not silently resolved toward the newer or
more convenient one.

## 5. Unknowns are the map's spine

A map with zero unknowns is a red flag, not a finished map - it means the
mapper stopped asking before the system stopped surprising. Unknowns are
first-class entries, each classified:

- **not-yet-looked** - a place to look exists; nobody has.
- **looked-and-unclear** - examined, still ambiguous; say what was examined
  and what remains unclear.
- **unknowable-from-here** - requires access, authority, or a person this
  work does not have; name which.

These three read identically as blank space and must not be, because they
demand different responses: the first is cheap work, the second is real
work, the third is a handoff. An unknown discovered mid-task is added at
discovery, not at write-up. Promoting an unknown to a mapped fact requires
evidence (§4) - never the passage of time.

## 6. Refresh honesty

The map is dated, and the date is load-bearing. Acting on a map is acting
on the system as of that date; where the gap is wide or the system moves
fast, the method's first step is a refresh pass - re-verify the
relationships the task leans on, not the whole map. A refresh that finds
drift records what changed (the superseded entry stays visible with its
supersessor); a map silently corrected is a map whose reader can no longer
tell what was learned when. If a persistent store maintains the map (§2),
refresh discipline becomes its job, and this section governs what a
refresh must check.

## 7. The handoff test

The map is finished when a stranger with your access could act safely in
this context from the map alone: they would know what they may change,
what they must not touch, whom to ask, and where the dragons are. Read the
map once as that stranger; every place you would silently supply missing
knowledge from your own head is a line the map is missing. This test is
the point of the artifact - a map only its author can use is notes, not a
map.

## 8. The closing gates

Before the map is called final - work shown, not work claimed:

1. **Typed throughout** - every relationship uses the closed type set; no
   untyped arrows; misfits recorded as unknowns (§3).
2. **Evidence tagged** - every entity, relationship, and obligation carries
   read / ran / was-told / inferred; conflicts recorded as conflicts (§4).
3. **Load-bearing upgraded** - relationships the task leans on are read or
   ran, or the gap is an unknown (§4).
4. **Unknowns present and classified** - each one of the three kinds; zero
   unknowns justified explicitly if claimed (§5).
5. **Dated** - the as-of date is present, and stale ground the task
   touches was refreshed (§6).
6. **Handoff passes** - the stranger test was actually run, and what it
   added is visible (§7).

## 9. The verification record

The map ends with a short block, exactly this shape:

```
Verification record
- Typed throughout:   answered — <n> relationships, all typed
- Evidence tagged:    answered — read <n> / ran <n> / was-told <n> / inferred <n>
- Load-bearing upgraded: answered — <which, and to what> | none lean hard
- Unknowns classified: answered — <n> unknowns: <n>/<n>/<n> by kind | zero, justified at <where>
- Dated:              answered — created <date>, last updated <date> | refreshed: <what>
- Handoff passes:     answered — run as stranger; added: <what, or nothing>
```

A gate that was not done says `not done - <reason>` in its slot. It is
never deleted, never skipped silently.

The record is presence, not quality: whether the entities chosen are the
ones that matter is judgment, and the record never claims to have
automated it.


Two rules travel with this record wherever skills compose. When several
skills govern one deliverable, the skill that owns the deliverable's shape
produces its full record, and every other skill contributes exactly one
line to that same block - its name, then its verdict or a one-clause gate
summary - never a second full block, because stacked records are how
ceremony buries content. And every "see <where>" in any record carries a
short quoted fragment of what it points to, not a bare location - a
pointer that cannot quote its target is pointing at nothing, and the
fragment is what makes an empty answer visible to a reader who can only
check presence.

## 10. What is enforced, and by what

Nothing in this file is machine-enforced by this file. The typing, the
evidence tags, and the record are obligations on you, made checkable for
the reader - that visibility is the enforcement tier this skill carries
everywhere it goes. An environment with a persistent store or a provenance
engine adds a deterministic tier on top - it can keep the map, re-serve
it, and enforce the refresh; this file works identically with or without
one, and never claims a tier it is not running under.

## References

Method identified, not incorporated - these name where the discipline comes
from, and reading them is not required to follow it:

- PROV-DM, W3C Recommendation, 2013 - entities, activities, and agents as
  the minimal vocabulary of who-did-what-to-what (§3's ancestor).
- Naur, "Programming as Theory Building," 1985 - the system's real
  structure lives in a theory its builders hold, and is lost, not
  transferred, by artifacts alone - why the handoff test exists (§7).
- Weinberg, *An Introduction to General Systems Thinking*, 1975 - the
  observer's frame determines which entities exist; naming the frame is
  part of the map.
- Records in Contexts (RiC-CM) 1.0, International Council on Archives -
  relationships as first-class described things with their own provenance.
- Brandolini, *Introducing EventStorming* - mapping a domain by surfacing
  disagreement between people who each thought they held the map.
