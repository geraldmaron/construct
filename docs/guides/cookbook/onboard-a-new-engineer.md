---
title: Onboard a new engineer
description: Scaffold onboarding brief, access checklist, and week-1 checkpoint artifacts from shipped templates. No dedicated onboarding procedure — discover live procedures with construct procedure list.
---

Construct ships an onboarding template but no `engineering-onboarding` procedure. Onboarding is a template-driven artifact workflow: copy the shipped templates, stamp provenance, and track milestones in Beads.

## Discover procedures

```bash
construct procedure list
```

Live procedure definitions live in `registry/procedures/*.json`. None of the shipped procedures scaffold a full onboarding pack; use the templates below directly or pair with `memo-draft` when you only need a status memo plan.

## Scaffold the artifact pack

| Path | Source template | Purpose |
|---|---|---|
| `docs/onboarding/<engineer>/brief.md` | `templates/docs/onboarding.md` | Day-1 brief: team, manager, start date, scope of work |
| `docs/onboarding/<engineer>/access-runbook.md` | `templates/docs/runbook.md` | Access checklist (repos, services, secrets, on-call rotation) |
| `docs/onboarding/<engineer>/week-1-memo.md` | `templates/docs/memo.md` | First checkpoint: what shipped, what's blocked, who to ask |

Author through your host's artifact workflow (see [Generate artifacts](/guides/cookbook/generate-artifacts)) or copy each template manually, fill placeholders, and run `construct docs:verify` before publishing.

Every artifact should carry a stamped `intake_id` and `cx_doc_id` so doctor's traceability check sees it from day one.

## Optional procedure plan

When you want a bounded orchestration plan (not auto-generated docs):

```bash
construct procedure invoke --json --procedure-id memo-draft \
  --text 'Draft week-1 onboarding checkpoint for Riley Chen on platform team'
```

`construct procedure invoke` returns a **plan only** — Worker Profiles still author the memo from `templates/docs/memo.md`.

## Pair with

- [Track research findings](/guides/cookbook/track-research-findings) — when onboarding involves bringing the engineer up to speed on a specific area of the codebase or a recent architectural decision.
- [Cross-team handoff](/guides/cookbook/cross-team-handoff) — when the new engineer is taking ownership of work in flight from another team.
