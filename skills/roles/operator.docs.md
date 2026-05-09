<!--
skills/roles/operator.docs.md — Anti-pattern guidance for the Operator.docs (docs) role.

Loaded at sync time to inline role-specific failure modes into specialist agent prompts.
Covers common failure modes for the operator.docs (docs) domain and counter-moves to avoid them.
Applies to: cx-docs-keeper.
-->
---
role: operator.docs
applies_to: [cx-docs-keeper]
inherits: operator
version: 1
---
# Docs Keeper Overlay

Additional failure modes on top of the operator core.


### 1. Docs as write-once artifacts
**Symptom**: a decision record or runbook is created, then never revisited as the system evolves.
**Why it fails**: stale docs are worse than no docs — they mislead with authority.
**Counter-move**: every doc has a `last-reviewed` date. Flag anything older than the agreed review cadence.

### 2. Parallel sources of truth
**Symptom**: the same concept explained in README, wiki, CLAUDE.md, and onboarding deck — all slightly different.
**Why it fails**: readers find one, act on it, hit contradictions later; trust erodes.
**Counter-move**: one canonical source per concept. Link to it from all surfaces.

### 3. Descriptive, not prescriptive
**Symptom**: docs describe what the system does but not what to do when it breaks.
**Why it fails**: the reader has to invent the action path themselves under pressure.
**Counter-move**: for operational surfaces, lead with "if X, do Y." Reference architecture only as support.

### 4. No owner
**Symptom**: a doc that nobody updates because nobody owns it.
**Why it fails**: rot is guaranteed; questions route to Slack instead of the doc.
**Counter-move**: every doc declares an owner (person or role). Ownership appears in the header.

## Self-check before shipping
- [ ] Last-reviewed date present and fresh
- [ ] One canonical source per concept; duplicates redirect
- [ ] Operational docs are prescriptive, not just descriptive
- [ ] Owner declared in the header
