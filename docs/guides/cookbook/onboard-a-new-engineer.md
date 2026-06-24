---
title: Onboard a new engineer
description: Drive day-1 setup through the week-1 checkpoint via the engineering-onboarding workflow. Scaffolds onboarding brief, access checklist, and milestone handoff artifacts in one CLI call.
---

The `engineering-onboarding` workflow template runs the new-engineer onboarding ritual end-to-end: the brief, the access checklist, the week-1 milestones, and the handoff at the end. One CLI invocation; every artifact lands under `docs/onboarding/<engineer>/` and is owned by a tracker-backed plan from the moment it's created.

## Run it

```bash
construct workflow new engineering-onboarding \
  --input engineer_name="Riley Chen" \
  --input team_name="platform" \
  --input manager_name="Sam Park" \
  --input start_date="2026-06-10"
```

The CLI prompts for any missing inputs. Each prompt carries a default; press Enter to accept.

## What it creates

| Path | Source template | Purpose |
|---|---|---|
| `docs/onboarding/<engineer>/brief.md` | `templates/docs/onboarding.md` | Day-1 brief: team, manager, start date, scope of work |
| `docs/onboarding/<engineer>/access-runbook.md` | `templates/docs/runbook.md` | Access checklist (repos, services, secrets, on-call rotation) |
| `docs/onboarding/<engineer>/week-1-handoff.md` | `templates/docs/handoff.md` | First checkpoint: what shipped, what's blocked, who to ask |

Every artifact has a stamped `intake_id` and a `cx_doc_id` so doctor's traceability check sees it from day one.

## Inspect or modify the template

```bash
construct workflow show engineering-onboarding
construct workflow list
```

The YAML lives at [`templates/workflows/engineering-onboarding.yml`](https://github.com/geraldmaron/construct/blob/main/templates/workflows/engineering-onboarding.yml). Add or rename input fields, change the artifact list, or swap template paths — `construct workflow` reads it at invocation, no rebuild needed.

## Pair with

- [Track research findings](/guides/cookbook/track-research-findings) — when onboarding involves bringing the engineer up to speed on a specific area of the codebase or a recent architectural decision.
- [Cross-team handoff](/guides/cookbook/cross-team-handoff) — when the new engineer is taking ownership of work in flight from another team.
