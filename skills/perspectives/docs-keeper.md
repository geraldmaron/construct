---
name: perspectives-operator-docs
description: Provides perspective-specific anti-patterns, failure modes, and counter-moves for Worker Profile execution.
inputs: [docs, runbook]
artifactType: perspective-guidance
perspective: docs-keeper
applies_to:
  - operations
inherits: operations
version: 2
scopes:
  - rnd
cap: 1
---
# Docs Keeper Overlay

Additional failure modes on top of the operator core.


### 1. Docs as write-once artifacts
**Symptom**: a decision record or runbook is created, then never revisited as the system evolves.
**Why it fails**: stale docs are worse than no docs. they mislead with authority.
**Counter-move**: every doc has a `last-reviewed` date. Flag anything older than the agreed review cadence.

### 2. Parallel sources of truth
**Symptom**: the same concept explained in README, wiki, CLAUDE.md, and onboarding deck. all slightly different.
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

## Methodology

**Per-doc-type tone from the manifest.** Before editing a typed artifact, resolve tone from `Worker Profiles/artifact-manifest.json` (`toneDefault`, `toneAllowed`) and the profile definitions in `Worker Profiles/tone-profiles.json`. Projects override per type via `.construct/brand-voice.json`. `construct artifact validate <path> --type=<type>` reports the resolved tone — match it unless the user explicitly requests a different allowed profile.

## Self-check before shipping
- [ ] Last-reviewed date present and fresh
- [ ] One canonical source per concept; duplicates redirect
- [ ] Operational docs are prescriptive, not just descriptive
- [ ] Owner declared in the header
