---
title: Cross-team handoff
description: Transfer ownership of in-flight work between teams without losing context, blockers, or open decisions. Template-driven artifacts plus optional procedure plans — no dedicated handoff procedure.
---

A handoff fails when the receiving team has to reconstruct context the sending team already had. Construct does not ship a `cross-team-handoff` procedure. Run handoffs as three linked artifacts from shipped templates, each with explicit owners in Beads.

## Discover procedures

```bash
construct procedure list
```

Procedure definitions live in `registry/procedures/*.json`. For a bounded drafting plan (not auto-generated docs), `memo-draft` fits a status summary; use the templates below for the full handoff pack.

## Scaffold the artifact pack

| Path | Template | Purpose |
|---|---|---|
| `docs/handoffs/<feature>/state.md` | `templates/docs/memo.md` | Current state: what's shipped, what's behind a flag, what's regressed |
| `docs/handoffs/<feature>/blockers.md` | `templates/docs/runbook.md` | Open blockers, each with owner, last-touched timestamp, escalation path |
| `docs/handoffs/<feature>/decisions.md` | `templates/docs/adr.md` | Decisions made, alternatives rejected, what's still load-bearing |

The receiving owner reads in this order — state first (what's true now), blockers second (what to clear), decisions third (what not to relitigate).

## Optional procedure plan

```bash
construct procedure invoke --json --procedure-id memo-draft \
  --text 'Cross-team handoff state summary for vector-retrieval-v2 from platform to growth'
```

`construct procedure invoke` returns a **plan only**. Worker Profiles author each artifact from the templates above.

## Bead chain

Track the handoff in Beads at creation:

```
<feature>-handoff-state · in_progress · assignee=<from_owner>
<feature>-handoff-blockers · in_progress · assignee=<to_owner>
<feature>-handoff-decisions · in_progress · assignee=<to_owner>
```

The sending team closes `state` when the doc is accurate; the receiving team closes `blockers` and `decisions` when they've read and signed off.

## Pair with

- [Onboard a new engineer](/guides/cookbook/onboard-a-new-engineer) — for solo onboardings; the cross-team handoff is for work-in-flight, not for fresh roles.
- [Track research findings](/guides/cookbook/track-research-findings) — to cite the research that backs each decision in the decision log.
