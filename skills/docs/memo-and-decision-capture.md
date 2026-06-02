---
name: docs-memo-and-decision-capture
description: "Use when: a decision, status update, or announcement needs to be captured as a short, durable memo that states the decision, its rationale, and what changes."
inputs: [decision-context]
artifactType: memo
---
# Memo & Decision Capture

Use this skill when a decision, status update, or announcement needs to be captured as a short, durable memo.

A good memo is short and load-bearing: a reader six months later should understand what was decided, why, and what it changed — without attending the meeting. Length is not value; a memo that buries the decision under context has failed.

## Steps

1. **Lead with the decision or update** in the first sentence. The reader should not have to hunt for it.
2. **State the context** in 2–4 sentences: what prompted this, what problem it addresses.
3. **Record the rationale** — why this option over the alternatives actually considered. If alternatives were weighed, name them and why they lost.
4. **State what changes** as a result: who does what differently, what is now in or out of scope.
5. **List action items** with owners, if any.
6. **Date and attribute** the memo. A memo without a date is not durable.

## Output shape

```
# Memo: <subject>
_<date> · <author>_

**Decision/Update:** <one sentence>

## Context
<2–4 sentences>

## Rationale
<why this, over what alternatives>

## What changes
- <change> — owner: <name>
```

## Verification bar

- The decision/update is stated in the first sentence, unhedged where the decision is firm.
- Rationale references only alternatives actually considered — no invented options.
- The memo is dated and attributed.
- Nothing load-bearing is asserted that the source context does not support; unknowns are written as `unknown`.
