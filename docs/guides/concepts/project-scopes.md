---
title: Project scopes — .construct, .cx, the state root, and user home
description: Where Construct writes state, what belongs in git, and how intake differs from the tool install.
---

Construct splits state across five roots. Mixing them is the usual source of “why is this in git?” or “why did my disk fill up?” confusion.

## The three-way split (ADR-0027, ADR-0066)

A host project directory carries only two kinds of Construct-authored content, plus one deliberate exception:

1. **Config-layer (committed text)** — `construct.config.json`, `.cx/context.md`, user-authored custom specialists/teams/templates, and ADR-0027's marker blocks (`AGENTS.md`/`CLAUDE.md` fenced regions). Small, human-legible, meant to travel with the repo.
2. **Machine-scoped heavy state** — traces, orchestration runs, worker logs, the LanceDB vector index, and the docling/whisper bootstrap venvs. None of this is project-relative any more: it lives at `~/.construct/projects/<key>/`, keyed by a derivation stable across every clone/worktree of the same git remote (ADR-0066), resolved through `lib/state-root.mjs`'s `resolveStateRoot`/`resolveStateDir`/`resolveStatePath`. A fresh `construct init` never scaffolds these directories — they appear only once the corresponding subsystem first writes.
3. **Beads (`.beads/`)** — the deliberate exception. Issue history is project content, not machine state (ADR-0026), so it stays project-local and travels with the repository regardless of size.

Everything else Construct writes under a project's `.cx/` is a small, project-local *runtime marker* — intake state, the living graph, oracle verdicts, observations, knowledge, workflow/task-graph JSON — gitignored but not "heavy" in ADR-0066's sense (none of it was migrated; each has enough independent readers duplicating its path that moving the writer alone would split-brain reader and writer, so migration is deliberately deferred category by category).

## Scope table

| Location | Scope | Purpose | Commit to git? |
|---|---|---|---|
| `templates/**` | Package (Construct repo) | Shipped demos, scripts, PDF themes, doc templates | Yes |
| `docs/**` | Package / project docs | ADRs, cookbooks, durable research that informed decisions | Yes |
| `.construct/` (project root) | Host project | Launcher staged by `construct init`; runs hooks via `.construct/run.mjs` | No (gitignored) |
| `.cx/` (project root) | Host project — config-layer + small runtime markers | `context.md`/`context.json`, `workflow.json`, intake, oracle, observations, knowledge, the living graph, project research briefs, recorded demos | No (gitignored) |
| `.beads/` (project root) | Host project — issue history | Dolt-backed issue database (ADR-0026) | Yes (git-native sync) |
| `~/.construct/projects/<key>/` | User machine, per-project | Traces, orchestration runs, worker logs, the LanceDB vector index, docling/whisper bootstrap venvs (ADR-0066) | No |
| `~/.construct/` | User machine | `config.env`, credentials, doctor state, auth tokens | No |
| `~/.cx/` | User machine | Cross-project telemetry, role-pending queue, embed daemon logs when no project marker | No |

**Project marker:** a directory containing `.cx/` or `.construct/` (`lib/project-root.mjs`). Writers call `resolveProjectScopedPath()` to target `<project>/.cx/<file>`; without a marker they fall back to `~/.cx/`. Writers that resolve through `lib/state-root.mjs` instead target `~/.construct/projects/<key>/<file>`, keyed off the same project root rather than a marker.

## What lives under `.cx/` (host project, config-layer + small runtime markers)

| Subtree | Subsystem | Hand-edit? |
|---|---|---|
| `.cx/context.md` / `.cx/context.json` | Session handoff context | Yes |
| `.cx/workflow.json` | Workflow/task state (`lib/workflow-state.mjs`) | Via CLI/MCP workflow tools |
| `.cx/intake/` | Intake triage queue (`pending/`, `processed/`, `skipped/`, `quarantine/`, `dead-letter/`) | Via `construct intake` CLI |
| `.cx/knowledge/` | Ingested / curated knowledge | Yes (see [knowledge layout](/guides/concepts/knowledge-layout)) |
| `.cx/research/` | Project research briefs (working) | Yes |
| `.cx/graph/` | The living dependency/workflow graph store | No |
| `.cx/task-graphs/` | Task graph JSON (soft-warn disk budget) | No |
| `.cx/observations/` | Machine observations + entity graph | No |
| `.cx/oracle/` | Oracle verdicts, routing, pending actions | No |
| `.cx/demos/` | Recorded demo outputs (`.mp4`, project `.tape` overrides) | Optional override tapes |
| `.cx/publish/` | `construct publish` outputs | No |

**Intake** has one visible drop zone — the project-root `inbox/` — feeding the gitignored `.cx/intake/` triage queue. **Construct the package** does not keep a `.cx/` tree in git; shipped demos live in `templates/demos/`.

## What lives under `~/.construct/projects/<key>/` (machine-scoped heavy state, ADR-0066)

| Subtree | Subsystem | Resolver |
|---|---|---|
| `traces/` | Session trace shards | `lib/worker/trace.mjs`, `lib/telemetry/client.mjs` |
| `runtime/orchestration/runs/` | Orchestration run records (Mode-A filesystem store) | `lib/orchestration/run-store.mjs` |
| `runtime/worker/` | Worker execution logs | `lib/resources/budget.mjs` |
| `runtime/docling/` | Shared docling venv | `lib/runtime/uv-bootstrap.mjs` |
| `runtime/whisper/` | Whisper model cache | `lib/runtime/whisper-bootstrap.mjs` |
| `context-repos/<targetId>/` | Cloned content cache for corpus source targets (`sources sync`); `<targetId>.meta.json` sibling holds remote/ref/HEAD/last-fetch | `lib/sources/repo-cache.mjs` |
| `lancedb/` | LanceDB vector index (unless `CONSTRUCT_LANCEDB_PATH` overrides it) | `lib/storage/vector-client.mjs`, `lib/storage/admin.mjs` |

`<key>` is `deriveProjectKey(projectRoot)`: the normalized git origin remote when one exists (so every clone/worktree of the same repository shares state), otherwise a hash of the canonical absolute project path. A project that still carries a non-empty `.cx/runtime/`, `.cx/traces/`, or `.cx/lancedb/` from before this split is flagged by `construct doctor` as legacy state — no auto-migration shim; the durable copy already lives at the state root, so the old directory is a manual `rm -rf` once confirmed unneeded.

## Construct package repo vs host project

`isConstructPackageRepo()` (`lib/host-disposition.mjs`) detects the Construct tool repository. There:

- `.cx/**` is fully gitignored (no exceptions).
- `construct init` does not stage `.construct/` into the package repo.
- Shipped VHS tapes live in `templates/demos/tapes/`; ADR-cited research inputs live in `docs/notes/research/decision-input/`.

Consumer projects created with `construct init` get `.cx/` gitignored via `IGNORED_PATTERNS` and accumulate config-layer + small runtime-marker state locally, while heavy state accumulates at `~/.construct/projects/<key>/`.

## Related

- [Knowledge layout](/guides/concepts/knowledge-layout) — `.cx/knowledge/` subdirs
- [Intake and triage](/guides/concepts/intake-and-triage) — inbox → intake packets
- [Host disposition](/guides/concepts/architecture) — ADR-0027 ignored patterns
- [ADR-0066](/decisions/adr/0066-config-layer-project-footprint) — the machine-scoped heavy-state split this page documents
