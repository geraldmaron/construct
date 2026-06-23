---
title: Cross-team handoff
description: Transfer ownership of in-flight work between teams without losing context, blockers, or open decisions. One template, one tracker chain.
---

A handoff fails when the receiving team has to reconstruct context the sending team already had. The `cross-team-handoff` workflow refuses to ship without three things: a current-state summary, a clean blockers list, and an explicit decision log. Everything else (PR links, runbooks, owner) flows from those.

## Run it

```bash
construct workflow new cross-team-handoff \
  --input feature_name="vector-retrieval-v2" \
  --input from_team="platform" \
  --input to_team="growth" \
  --input from_owner="Sam Park" \
  --input to_owner="Riley Chen"
```

The CLI prompts for any missing inputs and accepts free-form context inline.

## What it creates

| Path | Template | Purpose |
|---|---|---|
| `docs/handoffs/<feature>/state.md` | `templates/docs/handoff.md` | Current state: what's shipped, what's behind a flag, what's regressed |
| `docs/handoffs/<feature>/blockers.md` | `templates/docs/runbook.md` | Open blockers, each with owner, last-touched timestamp, escalation path |
| `docs/handoffs/<feature>/decisions.md` | `templates/docs/adr.md` | Decisions made, alternatives rejected, what's still load-bearing |

The receiving owner reads in this order — state first (what's true now), blockers second (what to clear), decisions third (what not to relitigate).

## Bead chain

The workflow stamps a beads chain at creation:

```
<feature>-handoff-state · in_progress · assignee=<from_owner>
<feature>-handoff-blockers · in_progress · assignee=<to_owner>
<feature>-handoff-decisions · in_progress · assignee=<to_owner>
```

The sending team closes `state` when the doc is accurate; the receiving team closes `blockers` and `decisions` when they've read and signed off. The doctor's `Handoff hygiene` check refuses to mark the workflow complete until all three close.

## Inspect or modify the template

```bash
construct workflow show cross-team-handoff
```

YAML at [`templates/workflows/cross-team-handoff.yml`](https://github.com/geraldmaron/construct/blob/main/templates/workflows/cross-team-handoff.yml). Add inputs (e.g. `slo_target`, `oncall_rotation`) or wire additional artifacts (a service-map snapshot, a customer-impact note) into the artifacts block.

## Pair with

- [Onboard a new engineer](/cookbook/onboard-a-new-engineer) — for solo onboardings; the cross-team handoff is for work-in-flight, not for fresh roles.
- [Track research findings](/cookbook/track-research-findings) — to cite the research that backs each decision in the decision log.
