# Context map template

One page, exactly this shape. Small systems fill it thinly; that is
correct, not underuse.

```
Context map: <system>
Status: draft | final - Created: <date> - Last updated: <date>
Mapped by: <who> - Contributors: <others, models named> - Tags: <for retrieval>
For: <the task or decision this map serves>

Entities
- <name> - <what it is, one clause> - [seen: read | ran | was-told | inferred]

Relationships   (typed; one per line; no untyped arrows)
- <A> owns <B> - [seen: ...]
- <A> depends-on <B> - <what breaks if B changes> - [seen: ...]
- <A> feeds <B> - <what flows> - [seen: ...]
- <A> blocks <B> - <until what> - [seen: ...]
- <A> supersedes <B> - <since when, and what still reads B> - [seen: ...]

Obligations     (what a part owes, and to whom)
- <entity> owes <what> to <whom> - <source of the obligation> - [seen: ...]

Boundaries      (explicitly outside this map, on purpose)
- <thing> - <why out of scope for this task>

Unknowns        (first-class entries, each classified)
- <question> - [not-yet-looked | looked-and-unclear | unknowable-from-here]
```

Relationship types are closed: owns, depends-on, feeds, blocks, supersedes.
A relationship that fits none is either two of them (write both) or not yet
understood (unknowns). Untyped arrows hide that the mapper does not know.
