---
title: Custom specialists and teams
description: "Author your own specialist or team without touching the built-in roster: scaffold, validate, sync, and confirm it resolves through orchestration."
---

`construct specialist create <id> --custom` and `construct team create <id>` scaffold a user-authored specialist or team into your own config layer — never into `specialists/org/`, the built-in roster. This is the mechanism for adding a specialist Construct doesn't ship, without forking core or waiting on a roster change upstream.

Prefer a visual surface? `construct studio` opens the **Org Studio** — a local, zero-dependency web app (`http://127.0.0.1:4321`) for authoring specialists, teams, relationships (contracts), and fences without editing JSON. It shows a live topology graph (specialists and teams as nodes, contracts as handoff edges, team membership dashed), inspector forms with inline validation, and route/fence previews. Every write goes through the same `lib/registry/org-api.mjs` writer this page's CLI commands use, so its validation is byte-for-byte identical and its output lands in the same tiers below. Export/import round-trips the whole project topology as one JSON payload. The server binds to loopback only and refuses cross-origin requests — it is a personal authoring tool, not a shared service.

If you're a Construct maintainer adding to the *built-in* roster itself, see [Add a custom agent](/guides/cookbook/add-a-custom-agent) instead — that page edits `specialists/org/` directly, which this one deliberately does not touch.

## Where custom records live

Three tiers merge into the same registry every built-in specialist resolves through (`lib/registry/loader.mjs`), builtin → user → project, later tiers winning on id collision — the same precedence ADR-0052 establishes for provider manifests:

| Tier | Path | Scope | Flag |
|---|---|---|---|
| builtin | `specialists/org/**` | ships with Construct | — |
| user | `~/.construct/org/**` | every project on your machine | `--user` |
| project | `<project>/.cx/org/**` | this project only, git-tracked | default |

A project-tier record overrides a user-tier record with the same id, which overrides a builtin one. Omit `--user` and you get the project tier: git-tracked, reviewable in a PR, shipped with the project.

## Worked example

Suppose your project has a recurring "Widget" surface that no built-in specialist owns. You want a `cx-widget-specialist` on its own team.

### 1. Create the team first

A team needs an **owner role** and at least one specialist whose `role` matches it before the registry validates — create the team, then the specialist that fills it:

```bash
construct team create widget-team \
  --owner=widget-specialist \
  --charter="Owns the Widget product surface end to end, from intake to release." \
  --roles=widget-specialist \
  --escalation=widget-specialist,orchestrator
```

This writes `.cx/org/teams/widget-team.json`:

```json
{
  "name": "widget-team",
  "owner": "widget-specialist",
  "roles": ["widget-specialist"],
  "specialists": [],
  "decisionRights": [],
  "forbiddenDecisions": [],
  "escalationPath": ["widget-specialist", "orchestrator"],
  "charter": "Owns the Widget product surface end to end, from intake to release.",
  "contact": {}
}
```

### 2. Create the specialist

```bash
construct specialist create widget-specialist --custom \
  --role=widget-specialist \
  --team=widget-team \
  --description="Builds and reviews the Widget subsystem end to end." \
  --skills=frontend-design/accessibility \
  --fence-paths="docs/widgets/**" \
  --model-tier=standard \
  --handoff=engineer,qa
```

This writes `.cx/org/specialists/cx-widget-specialist.json` and a prompt stub at `.cx/org/prompts/cx-widget-specialist.md` (fill in the stub with the specialist's actual voice and operating instructions — the scaffold only gets the registry entry validation-clean, not the prose).

### 3. Sync and confirm

```bash
construct sync
construct team show widget-team
```

`construct sync` clears the registry cache and reloads — no daemon restart, the same reload path it already runs for every other org change. `cx-widget-specialist` now resolves through `getSpecialist('widget-specialist')` / `getTeam('widget-team')` exactly like a built-in specialist, and is visible to `orchestration_policy` / `orchestration_run` specialist selection.

## Required fields and why

`lib/registry/custom-schema.mjs` validates before anything is written; every error names the field and what to fix:

- **`role`** — must match the owning team's `owner` field, or the merged registry fails `team-no-owner-specialist`.
- **`team`** (`--team`) — must reference an existing team id (builtin, user, or project tier). An unknown team fails fast with the known-team list attached, and a suggested `construct team create` command.
- **`modelTier`** (`--model-tier`) — one of `fast | standard | reasoning`.
- **`skills`** (`--skills`, comma-separated) — one or more `<bundle>/<skill>` references (e.g. `frontend-design/accessibility`).
- **`fence`** (`--fence-paths`, comma-separated globs) — the permission boundary; at least one path glob is required.
- **`description`** — at least 20 characters; it's what orchestration reads to decide whether to route to this specialist.
- **`handoffCandidates`** (`--handoff`, optional) — the delegation spec: which roles this specialist hands work off to.

A team additionally requires **`owner`** and **`charter`** (>= 20 characters, the one-paragraph mission statement).

## User-scope example

To make a specialist available across every project on your machine, add `--user` to either command:

```bash
construct team create gadget-team --owner=gadget-specialist \
  --charter="Owns the Gadget product surface across every project on this machine." --user

construct specialist create gadget-specialist --custom --user \
  --role=gadget-specialist --team=gadget-team \
  --description="Builds and reviews the Gadget subsystem across every project." \
  --skills=frontend-design/accessibility --fence-paths="docs/gadgets/**"
```

These land under `~/.construct/org/teams/gadget-team.json` and `~/.construct/org/specialists/cx-gadget-specialist.json` — not git-tracked, not project-scoped, available to `construct` wherever you run it on this machine.

## Overriding a builtin

Because tiers merge by id, a user- or project-tier file with the same id as a builtin specialist patches it: e.g. `.cx/org/specialists/cx-engineer.json` with just `{ "modelTier": "reasoning" }` upgrades that one project's `cx-engineer` model tier without touching `specialists/org/specialists/cx-engineer.json`.

## Reference

- `construct specialist create <id> --custom --role=<role> --team=<team-id> --description="…" --skills=<bundle/skill,…> --fence-paths=<glob,…> [--model-tier=fast|standard|reasoning] [--handoff=role,…] [--tools=Read,Grep,…] [--user] [--force]`
- `construct team create <id> --owner=<role> --charter="…" [--roles=role,…] [--specialists=cx-a,…] [--decision-rights=a,…] [--forbidden=a,…] [--escalation=role,orchestrator] [--group=<group-id>] [--user] [--force]`
