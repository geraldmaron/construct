---
title: Project scopes — .construct, .cx, and user home
description: Where Construct writes state, what belongs in git, and how intake differs from the tool install.
---

Construct uses four storage roots. Mixing them is the usual source of “why is this in git?” confusion.

## Scope table

| Location | Scope | Purpose | Commit to git? |
|---|---|---|---|
| `templates/**` | Package (Construct repo) | Shipped demos, scripts, PDF themes, doc templates | Yes |
| `docs/**` | Package / project docs | ADRs, cookbooks, durable research that informed decisions | Yes |
| `.construct/` (project root) | Host project | Launcher staged by `construct init`; runs hooks via `.construct/run.mjs` | No (gitignored) |
| `.cx/` (project root) | Host project runtime | Intake, oracle, observations, chat sessions, audit trails, project research briefs, recorded demos | No (gitignored) |
| `~/.construct/` | User machine | `config.env`, credentials, doctor state, auth tokens | No |
| `~/.cx/` | User machine | Cross-project telemetry, role-pending queue, embed daemon logs when no project marker | No |

**Project marker:** a directory containing `.cx/` or `.construct/` (`lib/project-root.mjs`). Writers call `resolveProjectScopedPath()` to target `<project>/.cx/<file>`; without a marker they fall back to `~/.cx/`.

## What lives under `.cx/` (host project only)

| Subtree | Subsystem | Hand-edit? |
|---|---|---|
| `.cx/intake/` | Intake triage queue (`pending/`, `processed/`, `skipped/`, `quarantine/`, `dead-letter/`) | Via `construct intake` CLI |
| `.cx/knowledge/` | Ingested / curated knowledge | Yes (see [knowledge layout](/guides/concepts/knowledge-layout)) |
| `.cx/research/` | Project research briefs (working) | Yes |
| `.cx/observations/` | Machine observations + entity graph | No |
| `.cx/oracle/` | Oracle verdicts, routing, pending actions | No |
| `.cx/traces/` | Session trace shards | No |
| `.cx/chat-sessions/` | Construct chat transcripts | No |
| `.cx/demos/` | Recorded demo outputs (`.mp4`, project `.tape` overrides) | Optional override tapes |
| `.cx/context.md` | Session handoff context | Yes |
| `.cx/publish/` | `construct publish` outputs | No |

**Intake** has one visible drop zone — the project-root `inbox/` — feeding the gitignored `.cx/intake/` triage queue. **Construct the package** does not keep a `.cx/` tree in git; shipped demos live in `templates/demos/`.

## Construct package repo vs host project

`isConstructPackageRepo()` (`lib/host-disposition.mjs`) detects the Construct tool repository. There:

- `.cx/**` is fully gitignored (no exceptions).
- `construct init` does not stage `.construct/` into the package repo.
- Shipped VHS tapes live in `templates/demos/tapes/`; ADR-cited research inputs live in `docs/notes/research/decision-input/`.

Consumer projects created with `construct init` get `.cx/` gitignored via `IGNORED_PATTERNS` and accumulate runtime state locally.

## Related

- [Knowledge layout](/guides/concepts/knowledge-layout) — `.cx/knowledge/` subdirs
- [Intake and triage](/guides/concepts/intake-and-triage) — inbox → intake packets
- [Host disposition](/guides/concepts/architecture) — ADR-0027 ignored patterns
