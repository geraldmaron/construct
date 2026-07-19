# Construct: Claude Code Integration

This file ships as a reference template alongside the Construct npm package. The canonical project-instructions file is `/CLAUDE.md` at your repo root — that's the file Claude Code actually reads at session start. The structure here mirrors that canonical file so users know what shape their own `/CLAUDE.md` should take after `construct init` scaffolds a project.

Personas and specialists are defined in `specialists/org` and rendered into Claude Code agents on every `construct sync`. The single user-facing persona is `construct`; the 28 specialists (engineer, security, cx-devil-advocate, …) are routed internally — you address Construct, Construct dispatches.

## Critical rules (mirror in your project /CLAUDE.md)

- **Never fabricate.** Every load-bearing claim cites a verifiable source. When a fact isn't in the source, write `unknown` or `[unverified]`. See `rules/common/no-fabrication.md`.
- **Confirm the working branch every session.** Session-start surfaces `## Working branch: <name>` at the top of the injected context.
- **Never commit, push, or merge without asking first.** State the branch, state the action, wait for explicit yes.
- **Never edit running hook files** without testing them in isolation. A broken hook blocks all tool use.
- **Hooks fire unconditionally. No skip env vars on quality gates.** If a check fires wrong, repair the check — do not re-introduce `CONSTRUCT_SKIP_*` / `CONSTRUCT_ALLOW_*`.
- **Never commit directly to main.** Branch, test, then merge.
- **Run `construct doctor`** after structural changes.

## Workflow roles

| Role | What it covers |
|---|---|
| **Planning** | Requirements, strategy, architecture, framing challenges |
| **Implementation** | Builds features and fixes bugs |
| **Validation** | Quality gates, code review, security, accessibility |
| **Research** | Docs, debugging, codebase exploration, external research |
| **Operations** | Releases, dev servers, health checks, observability |

Construct routes complex work through the full pipeline (plan → implement → validate → operate). For simple tasks, Construct acts directly without exposing the internal routing.

## Beads issue tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` for the full workflow context.

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

Use `bd` for all task tracking. Do NOT use TodoWrite, TaskCreate, or markdown TODO lists.

## Session completion

When ending a work session, **work is not complete until `git push` succeeds.**

```bash
git pull --rebase
git push
git status  # MUST show "up to date with origin"
```

## Tool calls

When using Bash, always provide both `command` and `description` string fields. Do not emit XML-style fallback tool calls.

## Cross-tool memory

Construct uses cass-memory for cross-tool memory. Start the local HTTP server with `cm serve`, then `memory_search` to find prior context. Memory and beads are complementary: memory holds knowledge, beads hold tasks.
